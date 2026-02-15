import type { ZenKit, DaedalusScript, DaedalusVm } from "@kolarz3/zenkit";
import type { NpcSpawnCallback, RoutineEntry, NpcVisual } from "./types";
import {
  getNpcWorldPosition,
  isFreepointAvailableForNpc,
  isNpcOnFreepoint,
} from "./npc/world/npc-freepoints";
import { enqueueNpcEmMessage, requestNpcEmClear } from "./npc/combat/npc-em-queue";
import {
  addNpcOverlayModelScript,
  removeNpcOverlayModelScript,
  setNpcBaseModelScript,
} from "./npc/scripting/npc-model-scripts";
import { normalizeMdsToScriptKey } from "./model-script-registry";
import { getWorldTime } from "./world-time";
import { getNpcRoutineWaypointName } from "./npc/scripting/npc-routine-runtime";
import { getWaynetWaypointPosition } from "./waynet-index";
import { HERO_SYMBOL_NAME, normalizeNameKey } from "./npc/renderer/npc-renderer-utils";

// Re-export types for consumers
export type { NpcSpawnCallback } from "./types";

export interface VmLoadResult {
  script: DaedalusScript;
  vm: DaedalusVm;
}

let runtimeVm: DaedalusVm | null = null;
const npcVisualsByIndex = new Map<number, NpcVisual>();

// ---------------------------------------------------------------------------
// NPC spawn order (Wld_InsertNpc call order)
// ---------------------------------------------------------------------------
//
// In ZenGin, actual insertion/update order is driven by internal world/spawn-manager lists.
// In spacer-web, we can approximate deterministic insertion order by remembering the order
// in which the VM requested spawns via `Wld_InsertNpc`.
const npcSpawnOrderByInstance = new Map<number, number>();
let nextNpcSpawnOrder = 1;

export function getNpcSpawnOrder(npcInstanceIndex: number): number | null {
  if (!Number.isFinite(npcInstanceIndex) || npcInstanceIndex <= 0) return null;
  return npcSpawnOrderByInstance.get(npcInstanceIndex) ?? null;
}

function recordNpcSpawnOrder(npcInstanceIndex: number): void {
  if (!Number.isFinite(npcInstanceIndex) || npcInstanceIndex <= 0) return;
  if (!npcSpawnOrderByInstance.has(npcInstanceIndex)) {
    npcSpawnOrderByInstance.set(npcInstanceIndex, nextNpcSpawnOrder++);
  }
}

export function __resetNpcSpawnOrderForTests(): void {
  npcSpawnOrderByInstance.clear();
  nextNpcSpawnOrder = 1;
}

// ---------------------------------------------------------------------------
// Script state-time (Npc_GetStateTime / Npc_SetStateTime)
// ---------------------------------------------------------------------------
//
// In the original engine, `Npc_GetStateTime` returns the elapsed time (seconds)
// since the current state started (or since `Npc_SetStateTime` was called).
// Many TA_* state loops use this for "every N seconds do random idle ani" logic.
//
// We advance it from the NPC renderer's VM tick (currently throttled to ~2Hz).
const npcStateTimeSeconds = new Map<number, number>();

export function advanceNpcStateTime(npcInstanceIndex: number, deltaSeconds: number): void {
  if (!Number.isFinite(npcInstanceIndex) || npcInstanceIndex <= 0) return;
  const prev = npcStateTimeSeconds.get(npcInstanceIndex) ?? 0;
  const next = prev + Math.max(0, deltaSeconds);
  npcStateTimeSeconds.set(npcInstanceIndex, next);
}

export function getNpcStateTime(npcInstanceIndex: number): number {
  return npcStateTimeSeconds.get(npcInstanceIndex) ?? 0;
}

export function setNpcStateTime(npcInstanceIndex: number, seconds: number): void {
  if (!Number.isFinite(npcInstanceIndex) || npcInstanceIndex <= 0) return;
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  npcStateTimeSeconds.set(npcInstanceIndex, s);
}

export function getRuntimeVm(): DaedalusVm | null {
  return runtimeVm;
}

/**
 * Load Daedalus script from hardcoded path
 */
export async function loadDaedalusScript(
  zenKit: ZenKit,
  scriptPath: string = "/SCRIPTS/_COMPILED/GOTHIC.DAT",
): Promise<{ script: DaedalusScript; loadResult: any }> {
  const response = await fetch(scriptPath);
  if (!response.ok) {
    throw new Error(`Failed to fetch script file: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const script = zenKit.createDaedalusScript();
  const loadResult = script.loadFromArray(uint8Array);

  if (!loadResult.success) {
    throw new Error(`Failed to load script: ${script.getLastError() || "Unknown error"}`);
  }

  return { script, loadResult };
}

/**
 * Create VM instance from loaded script
 */
export function createVm(zenKit: ZenKit, script: DaedalusScript): DaedalusVm {
  return zenKit.createDaedalusVm(script);
}

/**
 * Helper to register a single external function
 */
const registeredExternals = new Set<string>();

function registerExternalSafe(
  vm: DaedalusVm,
  funcName: string,
  callback: (...args: any[]) => any,
): void {
  if (!vm.hasSymbol(funcName)) {
    return;
  }

  try {
    vm.registerExternal(funcName, callback);
    registeredExternals.add(funcName);
  } catch (error) {
    // Function might not be external or already registered, ignore
    console.debug(`Could not register external ${funcName}:`, error);
  }
}

/**
 * Get NPC information from VM by instance symbol index
 * Uses qualified class names to access properties after initialization
 */
function getNpcInfo(vm: DaedalusVm, npcInstanceIndex: number): Record<string, any> {
  const info: Record<string, any> = {
    instanceIndex: npcInstanceIndex,
  };

  // Get symbol name from index
  const nameResult = vm.getSymbolNameByIndex(npcInstanceIndex);
  if (nameResult.success && nameResult.data) {
    info.symbolName = nameResult.data;

    // Important: many NPC instances call functions with `self` during instance initialization
    // (e.g. `b_setattributestochapter(self, ...)`). Make sure `self` is set before init.
    try {
      vm.setGlobalSelf(nameResult.data);
    } catch {
      // ignore
    }

    // Initialize the instance explicitly - this executes the instance definition code
    const initResult = vm.initInstanceByIndex(npcInstanceIndex);
    if (!initResult.success) {
      console.warn(
        `⚠️  Failed to initialize NPC instance ${npcInstanceIndex}: ${initResult.errorMessage}`,
      );
      // Continue trying to read properties even if initialization failed, as some might be static
    }

    // Get NPC properties using qualified class names
    // Properties are available after initialization
    const properties = [
      { qualified: "C_NPC.name", type: "string", key: "name" },
      { qualified: "C_NPC.id", type: "int", key: "id" },
      { qualified: "C_NPC.guild", type: "int", key: "guild" },
      { qualified: "C_NPC.level", type: "int", key: "level" },
    ];

    for (const prop of properties) {
      try {
        if (prop.type === "string") {
          const value = vm.getSymbolString(prop.qualified, nameResult.data);
          if (value && value.trim() !== "") {
            info[prop.key] = value;
          }
        } else {
          const value = vm.getSymbolInt(prop.qualified, nameResult.data);
          if (value !== undefined && value !== null) {
            info[prop.key] = value;
          }
        }
      } catch (e) {
        // Property access failed, skip
      }
    }

    const getIntSafe = (qualified: string): number | null => {
      try {
        const v = vm.getSymbolInt(qualified, nameResult.data);
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      } catch {
        return null;
      }
    };

    // HP/HPMax (works with ZenKit versions that support `symbol[index]` parsing; falls back gracefully otherwise).
    const hpFallback = getIntSafe("C_NPC.attribute"); // ATR_HITPOINTS (index 0)
    let hp = getIntSafe("C_NPC.attribute[ATR_HITPOINTS]");
    let hpmax = getIntSafe("C_NPC.attribute[ATR_HITPOINTS_MAX]");

    if ((hp === 0 || hp == null) && typeof hpFallback === "number" && hpFallback !== 0)
      hp = hpFallback;
    if ((hpmax === 0 || hpmax == null) && typeof hpFallback === "number" && hpFallback !== 0)
      hpmax = hpFallback;

    if (typeof hp === "number") info.hp = hp;
    if (typeof hpmax === "number") info.hpmax = hpmax;

    // If we couldn't fetch max HP separately, assume full HP at spawn (common in scripts).
    if (
      typeof info.hp === "number" &&
      Number.isFinite(info.hp) &&
      (!("hpmax" in info) || info.hpmax === 0)
    ) {
      info.hpmax = info.hp;
    }
  }

  return info;
}

const symbolIndexCacheByVm = new WeakMap<DaedalusVm, Map<string, number | null>>();

function findSymbolIndexByName(vm: DaedalusVm, name: string): number | null {
  const key = normalizeNameKey(name);
  if (!key) return null;
  let cache = symbolIndexCacheByVm.get(vm);
  if (!cache) {
    cache = new Map();
    symbolIndexCacheByVm.set(vm, cache);
  }
  if (cache.has(key)) return cache.get(key) ?? null;

  const count = Number(vm.symbolCount);
  if (!Number.isFinite(count) || count <= 0) {
    cache.set(key, null);
    return null;
  }

  for (let i = 0; i < count; i++) {
    const r = vm.getSymbolNameByIndex(i);
    if (!r.success || !r.data) continue;
    if (normalizeNameKey(r.data) === key) {
      cache.set(key, i);
      return i;
    }
  }

  cache.set(key, null);
  return null;
}

/**
 * Register external functions with specific implementations
 */
export function registerVmExternals(vm: DaedalusVm, onNpcSpawn?: NpcSpawnCallback): void {
  const verboseVmLogsEnabled = (() => {
    try {
      if (typeof window === "undefined") return false;
      const qs = new URLSearchParams(window.location.search);
      return qs.get("vmDebug") === "1" || qs.get("vmLog") === "1";
    } catch {
      return false;
    }
  })();

  // Store routine entries for the currently processing NPC
  let currentRoutineEntries: RoutineEntry[] = [];
  npcVisualsByIndex.clear();

  const isTimeBetweenLikeZenGin = (
    h1: number,
    m1: number,
    h2: number,
    m2: number,
    nowH: number,
    nowM: number,
  ): boolean => {
    const time1 = Math.floor(h1) * 60 + Math.floor(m1);
    let time2 = Math.floor(h2) * 60 + Math.floor(m2);
    // ZenGin: "end time minus 1 minute" to avoid overlaps (unless both times are equal).
    if (time2 !== time1) time2 -= 1;
    const worldTime = Math.floor(nowH) * 60 + Math.floor(nowM);
    if (time2 < time1) return worldTime >= time1 || worldTime <= time2;
    return time1 <= worldTime && worldTime <= time2;
  };

  // World-time externals (used widely in scripts, including some routine schedulers).
  registerExternalSafe(vm, "Wld_GetDay", () => getWorldTime().day);
  registerExternalSafe(vm, "Wld_GetHour", () => getWorldTime().hour);
  registerExternalSafe(vm, "Wld_GetMinute", () => getWorldTime().minute);
  registerExternalSafe(vm, "Wld_IsTime", (h1: number, m1: number, h2: number, m2: number) => {
    const t = getWorldTime();
    return isTimeBetweenLikeZenGin(h1, m1, h2, m2, t.hour, t.minute) ? 1 : 0;
  });

  const getInstanceIndexFromArg = (arg: any): number | null => {
    if (typeof arg === "number" && Number.isFinite(arg)) return arg;
    if (arg && typeof arg === "object") {
      const idx = (arg as any).symbol_index;
      if (typeof idx === "number" && Number.isFinite(idx)) return idx;
    }
    return null;
  };

  const parseNpcAndNameArgs = (a: any, b: any): { npcIndex: number | null; name: string } => {
    // Daedalus scripts typically call Wld_IsFPAvailable(self, "FP_ROAM") / AI_GotoFP(self, "FP_ROAM"),
    // but we accept both orders defensively.
    let npcArg = a;
    let nameArg = b;
    if (typeof a === "string" && typeof b !== "string") {
      npcArg = b;
      nameArg = a;
    }
    const npcIndex = getInstanceIndexFromArg(npcArg);
    const name = typeof nameArg === "string" ? nameArg : "";
    return { npcIndex, name };
  };

  const normalizeVisualName = (name: string): string => {
    if (!name) return "";
    return name
      .trim()
      .replace(/\.(ASC|MDM|MDH|MDL|MMS|MMB)$/i, "")
      .replace(/\.+$/, "")
      .toUpperCase();
  };

  const registerMdlSetVisualBody = (name: string) => {
    registerExternalSafe(
      vm,
      name,
      (
        npc: any,
        body_mesh: string,
        body_tex: number,
        skin: number,
        head_mesh: string,
        head_tex: number,
        teeth_tex: number,
        armor_inst: number,
      ) => {
        const npcIndex = getInstanceIndexFromArg(npc);
        if (!npcIndex || npcIndex <= 0) return;

        npcVisualsByIndex.set(npcIndex, {
          bodyMesh: normalizeVisualName(body_mesh),
          bodyTex: body_tex ?? 0,
          skin: skin ?? 0,
          headMesh: normalizeVisualName(head_mesh),
          headTex: head_tex ?? 0,
          teethTex: teeth_tex ?? 0,
          armorInst: armor_inst ?? -1,
        });
      },
    );
  };

  const registerMdlSetVisual = (name: string) => {
    registerExternalSafe(vm, name, (npc: any, mdsName: any) => {
      const npcIndex = getInstanceIndexFromArg(npc);
      const mds = typeof mdsName === "string" ? mdsName : "";
      if (!npcIndex || !mds) return;
      const key = normalizeMdsToScriptKey(mds);
      if (!key) return;
      setNpcBaseModelScript(npcIndex, key);
    });
  };

  const registerMdlApplyOverlayMds = (name: string) => {
    registerExternalSafe(vm, name, (npc: any, mdsName: any) => {
      const npcIndex = getInstanceIndexFromArg(npc);
      const mds = typeof mdsName === "string" ? mdsName : "";
      if (!npcIndex || !mds) return;
      const key = normalizeMdsToScriptKey(mds);
      if (!key) return;
      addNpcOverlayModelScript(npcIndex, key);
    });
  };

  const registerMdlRemoveOverlayMds = (name: string) => {
    registerExternalSafe(vm, name, (npc: any, mdsName: any) => {
      const npcIndex = getInstanceIndexFromArg(npc);
      const mds = typeof mdsName === "string" ? mdsName : "";
      if (!npcIndex || !mds) return;
      const key = normalizeMdsToScriptKey(mds);
      if (!key) return;
      removeNpcOverlayModelScript(npcIndex, key);
    });
  };

  const registerMdlApplyOverlayMdsTimed = (name: string) => {
    registerExternalSafe(vm, name, (npc: any, mdsName: any) => {
      const npcIndex = getInstanceIndexFromArg(npc);
      const mds = typeof mdsName === "string" ? mdsName : "";
      if (!npcIndex || !mds) return;
      const key = normalizeMdsToScriptKey(mds);
      if (!key) return;
      addNpcOverlayModelScript(npcIndex, key);
    });
  };

  // Register Wld_InsertNpc with detailed logging implementation
  // Note: Also try uppercase version for compatibility
  const registerWldInsertNpc = (name: string) => {
    registerExternalSafe(vm, name, (npcInstanceIndex: number, spawnpoint: string) => {
      if (npcInstanceIndex <= 0) {
        console.warn(`⚠️  WLD_INSERTNPC: Invalid NPC instance index: ${npcInstanceIndex}`);
        return;
      }

      recordNpcSpawnOrder(npcInstanceIndex);

      const npcInfo = getNpcInfo(vm, npcInstanceIndex);

      // Format output similar to test script
      const nameStr = npcInfo.symbolName || `NPC[${npcInstanceIndex}]`;
      const details = [];

      if (npcInfo.name && npcInfo.name.trim() !== "") {
        details.push(`Name: "${npcInfo.name}"`);
      }
      if (npcInfo.id !== undefined && npcInfo.id !== null) {
        details.push(`ID: ${npcInfo.id}`);
      }
      if (npcInfo.guild !== undefined && npcInfo.guild !== null) {
        details.push(`Guild: ${npcInfo.guild}`);
      }
      if (npcInfo.level !== undefined && npcInfo.level !== null) {
        details.push(`Level: ${npcInfo.level}`);
      }
      if (
        npcInfo.hp !== undefined &&
        npcInfo.hpmax !== undefined &&
        (npcInfo.hp !== 0 || npcInfo.hpmax !== 0)
      ) {
        details.push(`HP: ${npcInfo.hp}/${npcInfo.hpmax}`);
      }

      const detailsStr = details.length > 0 ? ` (${details.join(", ")})` : "";
      if (verboseVmLogsEnabled) {
        console.log(`👤 Wld_InsertNpc: ${nameStr} at "${spawnpoint}"${detailsStr}`);
      }

      // Reset routine entries for this NPC
      currentRoutineEntries = [];

      // Check if NPC has a daily_routine property and call it
      if (npcInfo.symbolName) {
        try {
          const dailyRoutineSymbol = vm.getSymbolInt("C_NPC.daily_routine", npcInfo.symbolName);
          if (dailyRoutineSymbol && dailyRoutineSymbol > 0) {
            // daily_routine is a function symbol index, get the function name
            const routineFuncNameResult = vm.getSymbolNameByIndex(dailyRoutineSymbol);
            if (routineFuncNameResult.success && routineFuncNameResult.data) {
              if (verboseVmLogsEnabled) {
                console.log(`  ↳ Calling daily_routine: ${routineFuncNameResult.data}()`);
              }

              // Set self to the NPC instance before calling the routine
              vm.setGlobalSelf(npcInfo.symbolName);

              // Call the daily routine function
              const callResult = vm.callFunction(routineFuncNameResult.data, []);
              if (!callResult.success) {
                console.warn(
                  `  ⚠️  Failed to call daily_routine ${routineFuncNameResult.data}: ${callResult.errorMessage}`,
                );
              }
            }
          }
        } catch (e) {
          // daily_routine property might not exist or be accessible, ignore
        }
      }

      // Emit NPC spawn event if callback is provided
      if (onNpcSpawn) {
        const visual = npcVisualsByIndex.get(npcInstanceIndex);
        onNpcSpawn({
          instanceIndex: npcInstanceIndex,
          symbolName: nameStr,
          name: npcInfo.name,
          spawnpoint: spawnpoint,
          npcInfo: npcInfo,
          dailyRoutine: currentRoutineEntries.length > 0 ? [...currentRoutineEntries] : undefined,
          visual,
        });
      }

      // Clear entries after spawning
      currentRoutineEntries = [];
    });
  };

  // -----------------------------------------------------------------------------------
  // Freepoints (zCVobSpot) - ZenGin-like externals
  // -----------------------------------------------------------------------------------

  const SCRIPT_FREEPOINT_DIST = 700;

  registerExternalSafe(vm, "Wld_IsFPAvailable", (npc: any, fpName: any) => {
    const { npcIndex, name } = parseNpcAndNameArgs(npc, fpName);
    if (!npcIndex) return 0;
    return isFreepointAvailableForNpc(npcIndex, name, true) ? 1 : 0;
  });

  registerExternalSafe(vm, "Wld_IsNextFPAvailable", (npc: any, fpName: any) => {
    const { npcIndex, name } = parseNpcAndNameArgs(npc, fpName);
    if (!npcIndex) return 0;
    return isFreepointAvailableForNpc(npcIndex, name, false) ? 1 : 0;
  });

  registerExternalSafe(vm, "Npc_IsOnFP", (npc: any, fpName: any) => {
    const { npcIndex, name } = parseNpcAndNameArgs(npc, fpName);
    if (!npcIndex) return 0;
    return isNpcOnFreepoint(npcIndex, name, 100) ? 1 : 0;
  });

  registerExternalSafe(vm, "AI_GotoFP", (npc: any, fpName: any) => {
    const { npcIndex, name } = parseNpcAndNameArgs(npc, fpName);
    if (!npcIndex || !name) return;
    enqueueNpcEmMessage(npcIndex, {
      type: "gotoFreepoint",
      freepointName: name,
      checkDistance: true,
      dist: SCRIPT_FREEPOINT_DIST,
      locomotionMode: "walk",
    });
  });

  registerExternalSafe(vm, "AI_GotoNextFP", (npc: any, fpName: any) => {
    const { npcIndex, name } = parseNpcAndNameArgs(npc, fpName);
    if (!npcIndex || !name) return;
    enqueueNpcEmMessage(npcIndex, {
      type: "gotoFreepoint",
      freepointName: name,
      checkDistance: false,
      dist: SCRIPT_FREEPOINT_DIST,
      locomotionMode: "walk",
    });
  });

  // Movement / animation actions (minimal, queued via NPC EM)
  registerExternalSafe(vm, "AI_GotoWP", (npc: any, wpName: any) => {
    const { npcIndex, name } = parseNpcAndNameArgs(npc, wpName);
    if (!npcIndex) return;
    const resolved = name && name.trim() ? name : getNpcRoutineWaypointName(npcIndex);
    if (!resolved) return;
    enqueueNpcEmMessage(npcIndex, {
      type: "gotoWaypoint",
      waypointName: resolved,
      locomotionMode: "walk",
    });
  });

  // Distance helpers (used heavily by TA_* states)
  registerExternalSafe(vm, "Npc_GetDistToWP", (npc: any, wpName: any) => {
    const { npcIndex, name } = parseNpcAndNameArgs(npc, wpName);
    if (!npcIndex) return 0;
    const resolved = name && name.trim() ? name : getNpcRoutineWaypointName(npcIndex);
    if (!resolved) return 0;
    const npcPos = getNpcWorldPosition(npcIndex);
    if (!npcPos) return 0;
    const wpPos = getWaynetWaypointPosition(resolved);
    if (!wpPos) return 0;
    const dx = wpPos.x - npcPos.x;
    const dz = wpPos.z - npcPos.z;
    return Math.floor(Math.sqrt(dx * dx + dz * dz));
  });

  registerExternalSafe(vm, "AI_AlignToWP", (npc: any) => {
    const npcIndex = getInstanceIndexFromArg(npc);
    if (!npcIndex) return;
    enqueueNpcEmMessage(npcIndex, { type: "alignToWaypoint" });
  });

  registerExternalSafe(vm, "AI_AlignToFP", (npc: any) => {
    const npcIndex = getInstanceIndexFromArg(npc);
    if (!npcIndex) return;
    enqueueNpcEmMessage(npcIndex, { type: "alignToFreepoint" });
  });

  registerExternalSafe(vm, "AI_PlayAni", (npc: any, aniName: any) => {
    const { npcIndex, name } = parseNpcAndNameArgs(npc, aniName);
    if (!npcIndex || !name) return;
    enqueueNpcEmMessage(npcIndex, { type: "playAni", animationName: name, loop: false });
  });

  registerExternalSafe(vm, "AI_Wait", (npc: any, seconds: any) => {
    const npcIndex = getInstanceIndexFromArg(npc);
    const secs = Number(seconds);
    if (!npcIndex || !Number.isFinite(secs)) return;
    enqueueNpcEmMessage(npcIndex, { type: "waitMs", durationMs: Math.max(0, secs) * 1000 });
  });

  registerExternalSafe(vm, "AI_WaitMS", (npc: any, ms: any) => {
    const npcIndex = getInstanceIndexFromArg(npc);
    const dur = Number(ms);
    if (!npcIndex || !Number.isFinite(dur)) return;
    enqueueNpcEmMessage(npcIndex, { type: "waitMs", durationMs: Math.max(0, dur) });
  });

  registerExternalSafe(vm, "Npc_ClearAIQueue", (npc: any) => {
    const npcIndex = getInstanceIndexFromArg(npc);
    if (!npcIndex) return;
    requestNpcEmClear(npcIndex);
  });

  // State time helpers used by many TA_* state loops
  registerExternalSafe(vm, "Npc_GetStateTime", (npc: any) => {
    const npcIndex = getInstanceIndexFromArg(npc);
    if (!npcIndex) return 0;
    return getNpcStateTime(npcIndex);
  });

  registerExternalSafe(vm, "Npc_SetStateTime", (npc: any, seconds: any) => {
    const npcIndex = getInstanceIndexFromArg(npc);
    const secs = Number(seconds);
    if (!npcIndex || !Number.isFinite(secs)) return;
    setNpcStateTime(npcIndex, secs);
  });

  const registerNpcGetDistToNpc = (name: string) => {
    registerExternalSafe(vm, name, (a: any, b: any) => {
      const aIdx = getInstanceIndexFromArg(a);
      const bIdx = getInstanceIndexFromArg(b);
      if (aIdx == null || bIdx == null || aIdx <= 0 || bIdx <= 0) return 1_000_000;
      const ap = getNpcWorldPosition(aIdx);
      const bp = getNpcWorldPosition(bIdx);
      if (!ap || !bp) return 1_000_000;
      const dx = ap.x - bp.x;
      const dz = ap.z - bp.z;
      return Math.floor(Math.hypot(dx, dz));
    });
  };

  registerNpcGetDistToNpc("Npc_GetDistToNpc");
  registerNpcGetDistToNpc("NPC_GETDISTTONPC");

  const registerNpcGetHeightToNpc = (name: string) => {
    registerExternalSafe(vm, name, (a: any, b: any) => {
      const aIdx = getInstanceIndexFromArg(a);
      const bIdx = getInstanceIndexFromArg(b);
      if (aIdx == null || bIdx == null || aIdx <= 0 || bIdx <= 0) return 1_000_000;
      const ap = getNpcWorldPosition(aIdx);
      const bp = getNpcWorldPosition(bIdx);
      if (!ap || !bp) return 1_000_000;
      return Math.floor(Math.abs(ap.y - bp.y));
    });
  };

  registerNpcGetHeightToNpc("Npc_GetHeightToNpc");
  registerNpcGetHeightToNpc("NPC_GETHEIGHTTONPC");

  // Register both PascalCase (from externals.d) and UPPERCASE (legacy) versions
  registerWldInsertNpc("Wld_InsertNpc");
  registerWldInsertNpc("WLD_INSERTNPC");

  registerMdlSetVisual("Mdl_SetVisual");
  registerMdlSetVisual("MDL_SETVISUAL");

  registerMdlSetVisualBody("Mdl_SetVisualBody");
  registerMdlSetVisualBody("MDL_SETVISUALBODY");

  registerMdlApplyOverlayMds("Mdl_ApplyOverlayMds");
  registerMdlApplyOverlayMds("Mdl_ApplyOverlayMDS");
  registerMdlApplyOverlayMds("MDL_APPLYOVERLAYMDS");

  registerMdlApplyOverlayMdsTimed("Mdl_ApplyOverlayMDSTimed");
  registerMdlApplyOverlayMdsTimed("MDL_APPLYOVERLAYMDSTIMED");

  registerMdlRemoveOverlayMds("Mdl_RemoveOverlayMds");
  registerMdlRemoveOverlayMds("Mdl_RemoveOverlayMDS");
  registerMdlRemoveOverlayMds("MDL_REMOVEOVERLAYMDS");

  // Helper: Get NPC name without re-initializing (safe to call during NPC execution)
  const getNpcNameSafe = (npcInstanceIndex: number): string => {
    let npcName = `NPC[${npcInstanceIndex}]`;
    const nameResult = vm.getSymbolNameByIndex(npcInstanceIndex);
    if (nameResult.success && nameResult.data) {
      const symbolName = nameResult.data;

      // Check if this is the special $INSTANCE_HELP or similar helper variable
      // These start with special characters (char code 255) and represent "self"
      if (symbolName.includes("INSTANCE_HELP") || symbolName.startsWith("$")) {
        // This is a helper variable representing the current instance (self)
        // We can't directly get "self", so we'll show it as the helper variable
        // The actual NPC context is already set via setGlobalSelf before calling the routine
        npcName = "self";
      } else {
        npcName = symbolName;
        // Try to get the actual name property
        try {
          const displayName = vm.getSymbolString("C_NPC.name", symbolName);
          if (displayName && displayName.trim() !== "") {
            npcName = displayName;
          }
        } catch (e) {
          // Name property not accessible, use symbol name
        }
      }
    }
    return npcName;
  };

  // Helper: Get state function name from symbol index
  const getStateName = (stateIndex: number): string => {
    if (stateIndex <= 0) return "Unknown";
    const stateNameResult = vm.getSymbolNameByIndex(stateIndex);
    return stateNameResult.success && stateNameResult.data ? stateNameResult.data : "Unknown";
  };

  // Register TA (Time Assignment) - Sets NPC daily routine with hour precision
  registerExternalSafe(
    vm,
    "TA",
    (
      npcInstanceIndex: number,
      start_h: number,
      stop_h: number,
      state: number,
      waypoint: string,
    ) => {
      if (npcInstanceIndex <= 0) {
        console.warn(`⚠️  TA: Invalid NPC instance index: ${npcInstanceIndex}`);
        return;
      }

      const npcName = getNpcNameSafe(npcInstanceIndex);
      const stateName = getStateName(state);

      if (verboseVmLogsEnabled) {
        console.log(
          `📅 TA: ${npcName} | ${start_h}:00 - ${stop_h}:00 | State: ${stateName} | Waypoint: "${waypoint}"`,
        );
      }

      // Collect routine entry
      currentRoutineEntries.push({
        start_h,
        stop_h,
        state: stateName,
        waypoint,
      });
    },
  );

  // Register TA_Min (Time Assignment with Minutes) - Sets NPC daily routine with minute precision
  registerExternalSafe(
    vm,
    "TA_Min",
    (
      npcInstanceIndex: number,
      start_h: number,
      start_m: number,
      stop_h: number,
      stop_m: number,
      state: number,
      waypoint: string,
    ) => {
      if (npcInstanceIndex <= 0) {
        console.warn(`⚠️  TA_Min: Invalid NPC instance index: ${npcInstanceIndex}`);
        return;
      }

      const npcName = getNpcNameSafe(npcInstanceIndex);
      const stateName = getStateName(state);

      // Format time with leading zeros for minutes
      const startTime = `${start_h}:${start_m.toString().padStart(2, "0")}`;
      const stopTime = `${stop_h}:${stop_m.toString().padStart(2, "0")}`;

      if (verboseVmLogsEnabled) {
        console.log(
          `📅 TA_Min: ${npcName} | ${startTime} - ${stopTime} | State: ${stateName} | Waypoint: "${waypoint}"`,
        );
      }

      // Collect routine entry
      currentRoutineEntries.push({
        start_h,
        start_m,
        stop_h,
        stop_m,
        state: stateName,
        waypoint,
      });
    },
  );
}

/**
 * Register empty/no-op external functions to prevent warnings
 * These functions don't have specific implementations yet
 *
 * Functions are categorized by return type:
 * - void: no-op functions
 * - int: return 0
 * - instance/C_NPC/C_ITEM: return null instance ({ symbol_index: -1 })
 * - string: return empty string
 * - float: return 0.0
 */
export function registerEmptyExternals(vm: DaedalusVm): void {
  // Functions that return void - called during startup/initialization
  const voidExternals = [
    // World functions
    "Wld_InsertItem",
    "Wld_SetTime",
    "Wld_AssignRoomToGuild",
    "Wld_AssignRoomToNpc",
    "Wld_InsertNpc",
    "Wld_InsertNpcAndRespawn",
    "Wld_InsertObject",
    "Wld_ExchangeGuildAttitudes",
    "Wld_PlayEffect",
    "Wld_RemoveNpc",
    "Wld_SendTrigger",
    "Wld_SendUntrigger",
    "Wld_SetGuildAttitude",
    "Wld_SetMobRoutine",
    "Wld_SetObjectRoutine",
    "Wld_SpawnNpcRange",
    "Wld_StopEffect",

    // Video/Game functions
    "PlayVideo",
    "PlayVideoEx",
    "ExitGame",
    "ExitSession",
    "IntroduceChapter",
    "Perc_SetRange",

    // Item/NPC creation functions
    "CreateInvItems",
    "CreateInvItem",
    "EquipItem",

    // Model/Visual functions
    "Mdl_SetVisual",
    "Mdl_SetVisualBody",
    "Mdl_SetModelScale",
    "Mdl_SetModelFatness",
    "Mdl_ApplyOverlayMDS",
    "Mdl_ApplyOverlayMDSTimed",
    "Mdl_ApplyRandomAni",
    "Mdl_ApplyRandomAniFreq",
    "Mdl_ApplyRandomFaceAni",
    "Mdl_RemoveOverlayMDS",
    "Mdl_StartFaceAni",

    // NPC functions
    "Npc_SetTalentSkill",
    "Npc_SetTalentValue",
    "Npc_SetToFistMode",
    "Npc_SetToFightMode",
    "Npc_ChangeAttribute",
    "Npc_ClearAIQueue",
    "Npc_ClearInventory",
    "Npc_CreateSpell",
    "Npc_ExchangeRoutine",
    "Npc_GiveItem",
    "Npc_LearnSpell",
    "Npc_MemoryEntry",
    "Npc_MemoryEntryGuild",
    "Npc_PercDisable",
    "Npc_PercEnable",
    "Npc_PerceiveAll",
    "Npc_PlayAni",
    "Npc_SendPassivePerc",
    "Npc_SendSinglePerc",
    "Npc_SetAttitude",
    "Npc_SetKnowsPlayer",
    "Npc_SetPercTime",
    "Npc_SetRefuseTalk",
    "Npc_SetStateTime",
    "Npc_SetTarget",
    "Npc_SetTempAttitude",
    "Npc_StopAni",

    // AI functions (all void)
    "AI_AimAt",
    "AI_AlignToFP",
    "AI_AlignToWP",
    "AI_Ask",
    "AI_AskText",
    "AI_Attack",
    "AI_CanSeeNpc",
    "AI_CombatReactToDamage",
    "AI_ContinueRoutine",
    "AI_Defend",
    "AI_Dodge",
    "AI_DrawWeapon",
    "AI_DropItem",
    "AI_DropMob",
    "AI_EquipArmor",
    "AI_EquipBestArmor",
    "AI_EquipBestMeleeWeapon",
    "AI_EquipBestRangedWeapon",
    "AI_FinishingMove",
    "AI_Flee",
    "AI_GotoFP",
    "AI_GotoItem",
    "AI_GotoNextFP",
    "AI_GotoNpc",
    "AI_GotoSound",
    "AI_GotoWP",
    "AI_LookAt",
    "AI_LookAtNpc",
    "AI_Output",
    "AI_OutputSVM",
    "AI_OutputSVM_Overlay",
    "AI_PlayAni",
    "AI_PlayAniBS",
    "AI_PlayCutscene",
    "AI_PlayFX",
    "AI_PointAt",
    "AI_PointAtNpc",
    "AI_ProcessInfos",
    "AI_Quicklook",
    "AI_ReadyMeleeWeapon",
    "AI_ReadyRangedWeapon",
    "AI_ReadySpell",
    "AI_RemoveWeapon",
    "AI_SetNpcsToState",
    "AI_SetWalkmode",
    "AI_ShootAt",
    "AI_Snd_Play",
    "AI_Snd_Play3D",
    "AI_StandUp",
    "AI_StandUpQuick",
    "AI_StartState",
    "AI_StopAim",
    "AI_StopFX",
    "AI_StopLookAt",
    "AI_StopPointAt",
    "AI_StopProcessInfos",
    "AI_TakeItem",
    "AI_TakeMob",
    "AI_Teleport",
    "AI_TurnAway",
    "AI_TurnToNpc",
    "AI_TurnToSound",
    "AI_UnequipArmor",
    "AI_UnequipWeapons",
    "AI_UnreadySpell",
    "AI_UseItem",
    "AI_UseItemToState",
    "AI_Wait",
    "AI_WaitForQuestion",
    "AI_WaitMS",
    "AI_WaitTillEnd",
    "AI_WhirlAround",
    "AI_WhirlAroundToSource",

    // Document functions
    "Doc_Font",
    "Doc_MapCoordinates",
    "Doc_Open",
    "Doc_Print",
    "Doc_PrintLine",
    "Doc_PrintLines",
    "Doc_SetFont",
    "Doc_SetLevel",
    "Doc_SetLevelCoords",
    "Doc_SetMargins",
    "Doc_SetPage",
    "Doc_SetPages",
    "Doc_Show",

    // Log functions
    "Log_AddEntry",
    "Log_CreateTopic",
    "Log_SetTopicStatus",

    // Mission functions
    "Mis_AddMissionEntry",
    "Mis_RemoveMission",
    "Mis_SetStatus",

    // Mob functions
    "Mob_CreateItems",

    // Print functions
    "Print",
    "PrintDebug",
    "PrintDebugCh",
    "PrintDebugInst",
    "PrintDebugInstCh",
    "PrintMulti",
    "PrintScreen",

    // Routine functions
    "Rtn_Exchange",

    // Sound functions
    "Snd_Play",
    "Snd_Play3D",

    // TA (Time Assignment) functions - TA and TA_Min have specific implementations
    "TA_BeginOverlay",
    "TA_CS",
    "TA_EndOverlay",
    "TA_RemoveOverlay",

    // Info/Dialog functions
    "Info_AddChoice",
    "Info_ClearChoices",

    // Deprecated/legacy functions
    "Game_InitEngIntl",
    "Game_InitEnglish",
    "Game_InitGerman",
    "SetPercentDone",
    "Tal_Configure",
  ];

  // Additional externals needed for instance initialization (void)
  const initExternals = [
    "B_SetAttributesToChapter", // Set attributes to chapter (void)
    "B_CreateAmbientInv", // Create ambient inventory (void)
    "B_SetNpcVisual", // Set NPC visual (void)
    "B_GiveNpcTalents", // Give NPC talents (void)
    "B_SetFightSkills", // Set fight skills (void)
  ];

  // Functions that return int (return 0/false)
  const intExternals = [
    "Npc_IsDead",
    "Hlp_IsValidNpc",
    "Hlp_IsValidItem",
    "Hlp_IsItem",
    "Hlp_GetInstanceID",
    "Hlp_CutscenePlayed",
    "Hlp_StrCmp",
    "InfoManager_HasFinished",
    "Mis_GetStatus",
    "Mis_OnTime",
    "Mob_HasItems",
    "NPC_GiveInfo",
    "Npc_AreWeStronger",
    "Npc_CanSeeItem",
    "Npc_CanSeeNpc",
    "Npc_CanSeeNpcFreeLOS",
    "Npc_CanSeeSource",
    "Npc_CheckAvailableMission",
    "Npc_CheckInfo",
    "Npc_CheckOfferMission",
    "Npc_CheckRunningMission",
    "Npc_DeleteNews",
    "Npc_GetActiveSpell",
    "Npc_GetActiveSpellCat",
    "Npc_GetActiveSpellIsScroll",
    "Npc_GetActiveSpellLevel",
    "Npc_GetAttitude",
    "Npc_GetBodyState",
    "Npc_GetComrades",
    "Npc_GetDistToItem",
    "Npc_GetDistToNpc",
    "Npc_GetDistToPlayer",
    "Npc_GetDistToWP",
    "Npc_GetGuildAttitude",
    "Npc_GetHeightToItem",
    "Npc_GetHeightToNpc",
    "Npc_GetInvItem",
    "Npc_GetInvItemBySlot",
    "Npc_GetLastHitSpellCat",
    "Npc_GetLastHitSpellID",
    "Npc_GetNextTarget",
    "Npc_GetPermAttitude",
    "Npc_GetPortalGuild",
    "Npc_GetStateTime",
    "Npc_GetTalentSkill",
    "Npc_GetTalentValue",
    "Npc_GetTarget",
    "Npc_GetTrueGuild",
    "Npc_HasBodyFlag",
    "Npc_HasDetectedNpc",
    "Npc_HasEquippedArmor",
    "Npc_HasEquippedMeleeWeapon",
    "Npc_HasEquippedRangedWeapon",
    "Npc_HasEquippedWeapon",
    "Npc_HasItems",
    "Npc_HasNews",
    "Npc_HasOffered",
    "Npc_HasRangedWeaponWithAmmo",
    "Npc_HasReadiedMeleeWeapon",
    "Npc_HasReadiedRangedWeapon",
    "Npc_HasReadiedWeapon",
    "Npc_HasSpell",
    "Npc_IsAiming",
    "Npc_IsDetectedMobOwnedByGuild",
    "Npc_IsDetectedMobOwnedByNpc",
    "Npc_IsDrawingSpell",
    "Npc_IsDrawingWeapon",
    "Npc_IsInCutscene",
    "Npc_IsInFightMode",
    "Npc_IsInPlayersRoom",
    "Npc_IsInRoutine",
    "Npc_IsInState",
    "Npc_IsNear",
    "Npc_IsNewsGossip",
    "Npc_IsNextTargetAvailable",
    "Npc_IsOnFP",
    "Npc_IsPlayer",
    "Npc_IsPlayerInMyRoom",
    "Npc_IsVoiceActive",
    "Npc_IsWayBlocked",
    "Npc_KnowsInfo",
    "Npc_KnowsPlayer",
    "Npc_OwnedByGuild",
    "Npc_OwnedByNpc",
    "Npc_RefuseTalk",
    "Npc_RemoveInvItem",
    "Npc_RemoveInvItems",
    "Npc_SetActiveSpellInfo",
    "Npc_SetTrueGuild",
    "Npc_StartItemReactModules",
    "Npc_WasInState",
    "Npc_WasPlayerInMyRoom",
    "PlayVideo",
    "PlayVideoEx",
    "PrintDialog",
    "Snd_GetDistToSource",
    "Snd_IsSourceItem",
    "Snd_IsSourceNpc",
    "Wld_DetectItem",
    "Wld_DetectNpc",
    "Wld_DetectNpcEx",
    "Wld_DetectNpcExAtt",
    "Wld_DetectPlayer",
    "Wld_GetDay",
    "Wld_GetFormerPlayerPortalGuild",
    "Wld_GetGuildAttitude",
    "Wld_GetMobState",
    "Wld_GetPlayerPortalGuild",
    "Wld_IsFPAvailable",
    "Wld_IsMobAvailable",
    "Wld_IsNextFPAvailable",
    "Wld_IsRaining",
    "Wld_IsTime",
    "Wld_RemoveItem",
    "AI_PrintScreen",
    "AI_UseMob",
    "Doc_Create",
    "Doc_CreateMap",
    "FloatToInt",
  ];

  // Functions that return instance/C_NPC/C_ITEM (return null instance object)
  const instanceExternals = [
    "Hlp_GetNpc",
    "Npc_GetLookAtTarget",
    "Npc_GetNewsOffender",
    "Npc_GetNewsVictim",
    "Npc_GetNewsWitness",
    "Npc_GetPortalOwner",
    "Wld_GetFormerPlayerPortalOwner",
    "Wld_GetPlayerPortalOwner",
    "Npc_GetEquippedArmor",
    "Npc_GetEquippedMeleeWeapon",
    "Npc_GetEquippedRangedWeapon",
    "Npc_GetReadiedWeapon",
  ];

  // Functions that return string (return empty string)
  const stringExternals = [
    "ConcatStrings",
    "FloatToString",
    "IntToString",
    "Npc_GetDetectedMob",
    "Npc_GetNearestWP",
    "Npc_GetNextWP",
  ];

  // Functions that return float (return 0.0)
  const floatExternals = ["IntToFloat"];

  // Register void functions
  voidExternals.forEach((funcName) => {
    if (registeredExternals.has(funcName)) return;
    registerExternalSafe(vm, funcName, () => {
      // Empty implementation
    });
  });

  // Register initialization externals (void)
  initExternals.forEach((funcName) => {
    if (registeredExternals.has(funcName)) return;
    registerExternalSafe(vm, funcName, () => {
      // Empty implementation for void functions
    });
  });

  // Register Hlp_Random (returns int) - simple implementation
  registerExternalSafe(vm, "Hlp_Random", (bound: number) => {
    return Math.floor(Math.random() * (bound || 100));
  });

  // Register int-returning functions (return 0)
  intExternals.forEach((funcName) => {
    if (registeredExternals.has(funcName)) return;
    registerExternalSafe(vm, funcName, () => 0);
  });

  // Register instance-returning functions (return null instance object)
  // Must return an object with symbol_index: -1, not null, to avoid WASM binding errors
  instanceExternals.forEach((funcName) => {
    if (registeredExternals.has(funcName)) return;
    registerExternalSafe(vm, funcName, () => ({ symbol_index: -1 }));
  });

  // Register string-returning functions (return empty string)
  stringExternals.forEach((funcName) => {
    if (registeredExternals.has(funcName)) return;
    registerExternalSafe(vm, funcName, () => "");
  });

  // Register float-returning functions (return 0.0)
  floatExternals.forEach((funcName) => {
    if (registeredExternals.has(funcName)) return;
    registerExternalSafe(vm, funcName, () => 0);
  });
}

/**
 * Call startup function in VM
 */
export function callStartupFunction(
  vm: DaedalusVm,
  functionName: string = "startup_newworld",
): boolean {
  if (!vm.hasSymbol(functionName)) {
    console.warn(`Startup function '${functionName}' not found in VM`);
    return false;
  }

  try {
    const callResult = vm.callFunction(functionName, []);
    if (!callResult.success) {
      console.error(
        `Failed to call startup function: ${callResult.errorMessage || "Unknown error"}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Exception calling startup function: ${errorMsg}`);
    return false;
  }
}

/**
 * Complete VM loading workflow
 */
export async function loadVm(
  zenKit: ZenKit,
  scriptPath: string = "/SCRIPTS/_COMPILED/GOTHIC.DAT",
  startupFunction: string = "startup_newworld",
  onNpcSpawn?: NpcSpawnCallback,
  heroSpawnpointName: string = "START",
): Promise<VmLoadResult> {
  // Load script
  const { script } = await loadDaedalusScript(zenKit, scriptPath);

  // Create VM
  const vm = createVm(zenKit, script);

  // Register external functions with specific implementations
  registerVmExternals(vm, onNpcSpawn);

  // Register empty external functions to prevent warnings
  registerEmptyExternals(vm);

  // Set up global context variables (self and other)
  // These are used by some scripts during initialization
  const selfNpcName = "NONE_100_XARDAS";
  const otherNpcName = "PC_HERO";

  if (vm.hasSymbol(selfNpcName)) {
    vm.setGlobalSelf(selfNpcName);
  }
  if (vm.hasSymbol(otherNpcName)) {
    vm.setGlobalOther(otherNpcName);
  }

  // Call startup function
  callStartupFunction(vm, startupFunction);

  // Spawn the player hero explicitly. In the original engine, the player character is created by the engine
  // (not by Daedalus scripts calling `Wld_InsertNpc`), so we replicate that here.
  if (onNpcSpawn) {
    try {
      const heroIndex = findSymbolIndexByName(vm, HERO_SYMBOL_NAME);
      if (heroIndex != null && heroIndex > 0) {
        recordNpcSpawnOrder(heroIndex);
        const heroInfo = getNpcInfo(vm, heroIndex);
        const visual = npcVisualsByIndex.get(heroIndex);
        onNpcSpawn({
          instanceIndex: heroIndex,
          symbolName: heroInfo.symbolName || HERO_SYMBOL_NAME,
          name: heroInfo.name,
          spawnpoint: heroSpawnpointName,
          npcInfo: heroInfo,
          dailyRoutine: undefined,
          visual,
        });
      } else {
        console.warn(
          `[VM] Could not find hero instance '${HERO_SYMBOL_NAME}' (index: ${String(heroIndex)})`,
        );
      }
    } catch (e) {
      console.warn("[VM] Failed to spawn hero NPC:", e);
    }
  }

  runtimeVm = vm;

  return {
    script,
    vm,
  };
}
