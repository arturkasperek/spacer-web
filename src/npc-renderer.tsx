import { useMemo, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { World, ZenKit } from '@kolarz3/zenkit';
import { createStreamingState, shouldUpdateStreaming, getItemsToLoadUnload, disposeObject3D } from './distance-streaming';
import type { NpcData } from './types';
import { findActiveRoutineWaypoint, getMapKey, createNpcMesh } from './npc-utils';
import { createHumanCharacterInstance, type CharacterCaches, type CharacterInstance } from './character/human-character.js';
import { preloadAnimationSequences } from "./character/animation.js";
import { fetchBinaryCached } from "./character/binary-cache.js";
import { createHumanLocomotionController, HUMAN_LOCOMOTION_PRELOAD_ANIS, type LocomotionController, type LocomotionMode } from "./npc-locomotion";
import { createWaypointMover, type WaypointMover } from "./npc-waypoint-mover";
import { WORLD_MESH_NAME, setObjectOriginOnFloor } from "./ground-snap";
import { setFreepointsWorld, updateNpcWorldPosition, removeNpcWorldPosition } from "./npc-freepoints";
import { updateNpcEventManager } from "./npc-em-runtime";
import { enqueueNpcEmMessage, requestNpcEmClear } from "./npc-em-queue";
import { getNpcModelScriptsState } from "./npc-model-scripts";
import { ModelScriptRegistry } from "./model-script-registry";
import {
  applyNpcWorldCollisionXZ,
  createNpcWorldCollisionContext,
  updateNpcFallY,
  updateNpcSlopeSlideXZ,
  type NpcMoveConstraintResult,
  type NpcWorldCollisionConfig,
} from "./npc-world-collision";
import { constrainCircleMoveXZ, type NpcCircleCollider } from "./npc-npc-collision";
import { spreadSpawnXZ } from "./npc-spawn-spread";
import { getRuntimeVm } from "./vm-manager";
import { advanceNpcStateTime, setNpcStateTime } from "./vm-manager";
import { getWorldTime, useWorldTime } from "./world-time";

interface NpcRendererProps {
  world: World | null;
  zenKit: ZenKit | null;
  npcs: Map<number, NpcData>;
  cameraPosition?: THREE.Vector3;
  enabled?: boolean;
}

/**
 * NPC Renderer Component - renders NPCs at spawnpoint locations with distance-based streaming
 * Uses imperative Three.js rendering (like VOBs) for better performance
 * 
 * Features:
 * - Looks up spawnpoints by name (waypoints first, then VOBs) - matching original engine behavior
 * - Renders NPCs as character models with name labels (falls back to green placeholder while loading)
 * - Handles coordinate conversion from Gothic to Three.js space
 * - Distance-based streaming: only renders NPCs near the camera for performance
 * - Prioritizes routine waypoints: NPCs are positioned at their routine waypoint for the current time (10:00)
 * 
 * Waypoint lookup priority:
 * 1. Routine waypoint active at current time (10:00) - highest priority
 * 2. Spawnpoint waypoint/VOB (fallback if no active routine)
 * 
 * Spawnpoint lookup order (for the selected waypoint name):
 * 1. Waypoint by name
 * 2. VOB by name (searches entire VOB tree)
 * 3. If neither found, shows warning
 */
export function NpcRenderer({ world, zenKit, npcs, cameraPosition, enabled = true }: NpcRendererProps) {
  const { scene, camera } = useThree();
  const npcsGroupRef = useRef<THREE.Group>(null);
  const worldTime = useWorldTime();
  const tmpObjWorldPos = useMemo(() => new THREE.Vector3(), []);
  const tmpDesiredWorldPos = useMemo(() => new THREE.Vector3(), []);
  const tmpLocalBefore = useMemo(() => new THREE.Vector3(), []);
  const tmpLocalAfter = useMemo(() => new THREE.Vector3(), []);
  const tmpGroundSampleWorldPos = useMemo(() => new THREE.Vector3(), []);
  const groundRaycasterRef = useRef<THREE.Raycaster | null>(null);
  const tmpMoveNormalMatrix = useMemo(() => new THREE.Matrix3(), []);
  const tmpMoveNormal = useMemo(() => new THREE.Vector3(), []);
  const tmpMoveHitPoint = useMemo(() => new THREE.Vector3(), []);
  const tmpManualForward = useMemo(() => new THREE.Vector3(), []);
  const tmpManualRight = useMemo(() => new THREE.Vector3(), []);
  const tmpManualDir = useMemo(() => new THREE.Vector3(), []);
  const tmpManualDesiredQuat = useMemo(() => new THREE.Quaternion(), []);
  const tmpManualUp = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const tmpTeleportForward = useMemo(() => new THREE.Vector3(), []);
  const tmpTeleportDesiredQuat = useMemo(() => new THREE.Quaternion(), []);
  const characterCachesRef = useRef<CharacterCaches>({
    binary: new Map(),
    textures: new Map(),
    materials: new Map(),
    animations: new Map(),
  });
  const modelScriptRegistryRef = useRef<ModelScriptRegistry | null>(null);
  const didPreloadAnimationsRef = useRef(false);
  const waypointMoverRef = useRef<WaypointMover | null>(null);
  const routineTickKeyRef = useRef<string>("");
  const worldMeshRef = useRef<THREE.Object3D | null>(null);
  const warnedNoWorldMeshRef = useRef(false);
  const pendingGroundSnapRef = useRef<THREE.Group[]>([]);
  const cavalornGroupRef = useRef<THREE.Group | null>(null);
  const collisionCtx = useMemo(() => createNpcWorldCollisionContext(), []);
  const collisionConfig = useMemo<NpcWorldCollisionConfig>(() => {
    const getMaxSlopeDeg = () => {
      // Calibrated so that the steepest "rock stairs" remain climbable, but steeper terrain blocks movement.
      // Override for tuning via `?npcMaxSlopeDeg=...`.
      const fallback = 43;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcMaxSlopeDeg");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v <= 0 || v >= 89) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const getSlide2SlopeDeg = (walkDeg: number) => {
      // ZenGin defaults: walk ~50°, slide2 ~70°; keep the same +20° relationship for our tuned threshold.
      // Override for tuning via `?npcSlide2Deg=...`.
      const fallback = Math.min(89, Math.max(70, walkDeg + 20));
      try {
        const raw = new URLSearchParams(window.location.search).get("npcSlide2Deg");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v <= 0 || v >= 89) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const walkDeg = getMaxSlopeDeg();
    return {
      radius: 35,
      scanHeight: 110,
      scanHeights: [50, 110, 170],
      stepHeight: 60,
      maxStepDown: 800,
      // Rock stairs are about as steep as we want to allow. Anything steeper should block movement.
      maxGroundAngleRad: THREE.MathUtils.degToRad(walkDeg),
      maxSlideAngleRad: THREE.MathUtils.degToRad(getSlide2SlopeDeg(walkDeg)),
      minWallNormalY: 0.4,
      enableWallSlide: true,

      // Slide tuning (ZenGin-style: gravity projected on slope plane + damping).
      slideGravity: 981,
      slideFriction: 1.0,
      maxSlideSpeed: 1200,
      slideLeaveGraceSeconds: 2.5,
      maxSlideAngleEpsRad: THREE.MathUtils.degToRad(3),

      // Fall tuning (ZenGin-like defaults) + a small ledge nudge to commit off edges.
      landHeight: 10,
      fallGravity: 981,
      maxFallSpeed: 8000,
      fallBackoffDistance: 20,
    };
  }, []);

  // Distance-based streaming
  const loadedNpcsRef = useRef(new Map<string, THREE.Group>()); // npc id -> THREE.Group
  const allNpcsRef = useRef<Array<{ npcData: NpcData; position: THREE.Vector3 }>>([]); // All NPC data
  const allNpcsByIdRef = useRef(new Map<string, { npcData: NpcData; position: THREE.Vector3 }>());
  const allNpcsByInstanceIndexRef = useRef(new Map<number, { npcData: NpcData; position: THREE.Vector3 }>());
  const npcItemsRef = useRef<Array<{ id: string; position: THREE.Vector3 }>>([]);
  const NPC_LOAD_DISTANCE = 5000; // Load NPCs within this distance
  const NPC_UNLOAD_DISTANCE = 6000; // Unload NPCs beyond this distance

  // Streaming state using shared utility
  const streamingState = useRef(createStreamingState());

  const manualControlCavalornEnabled = useMemo(() => {
    try {
      return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("controlCavalorn");
    } catch {
      return false;
    }
  }, []);

  const motionDebugEnabled = useMemo(() => {
    try {
      if (typeof window === "undefined") return false;
      const qs = new URLSearchParams(window.location.search);
      // Gate noisy logs behind an explicit query param.
      // Accept legacy typo `montionDebug=1` too.
      return qs.get("motionDebug") === "1" || qs.get("montionDebug") === "1";
    } catch {
      return false;
    }
  }, []);

  const motionDebugLastRef = useRef<
    | {
        isFalling: boolean;
        isSliding: boolean;
        locomotionMode: LocomotionMode;
        lastWarnAtMs: number;
        lastPeriodicAtMs: number;
      }
    | undefined
  >(undefined);

  const manualControlSpeeds = useMemo(() => {
    const defaults = { walk: 180, run: 350 };
    try {
      if (typeof window === "undefined") return defaults;
      const qs = new URLSearchParams(window.location.search);
      const walkRaw = qs.get("cavalornSpeed");
      const runRaw = qs.get("cavalornRunSpeed");
      const walk = walkRaw != null ? Number(walkRaw) : defaults.walk;
      const run = runRaw != null ? Number(runRaw) : defaults.run;
      return {
        walk: Number.isFinite(walk) && walk > 0 ? walk : defaults.walk,
        run: Number.isFinite(run) && run > 0 ? run : defaults.run,
      };
    } catch {
      return defaults;
    }
  }, []);

  const manualKeysRef = useRef({
    up: false,
    down: false,
    left: false,
    right: false,
  });
  const manualRunToggleRef = useRef(false);
  const teleportCavalornSeqRef = useRef(0);
  const teleportCavalornSeqAppliedRef = useRef(0);

  useEffect(() => {
    if (!manualControlCavalornEnabled) return;

    const setKey = (e: KeyboardEvent, pressed: boolean) => {
      let handled = true;
      switch (e.code) {
        case "ArrowUp":
          manualKeysRef.current.up = pressed;
          break;
        case "ArrowDown":
          manualKeysRef.current.down = pressed;
          break;
        case "ArrowLeft":
          manualKeysRef.current.left = pressed;
          break;
        case "ArrowRight":
          manualKeysRef.current.right = pressed;
          break;
        case "ShiftLeft":
        case "ShiftRight":
          // Toggle run/walk on a single press (no hold).
          if (pressed && !e.repeat) manualRunToggleRef.current = !manualRunToggleRef.current;
          break;
        case "KeyT":
          if (pressed && !e.repeat) teleportCavalornSeqRef.current += 1;
          break;
        default:
          handled = false;
      }

      if (handled) e.preventDefault();
    };

    const onKeyDown = (e: KeyboardEvent) => setKey(e, true);
    const onKeyUp = (e: KeyboardEvent) => setKey(e, false);

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown as any);
      window.removeEventListener("keyup", onKeyUp as any);
    };
  }, [manualControlCavalornEnabled]);

  // Create a stable serialized key from the Map for dependency tracking
  const npcsKey = getMapKey(npcs);

  const normalizeNameKey = (name: string): string => (name || "").trim().toUpperCase();

  // Build quick lookup maps for waypoints and VOBs so routine-based positioning doesn't re-scan the whole world.
  // This is synchronous so spawnpoint/routine resolution never races the index-build effect.
  const { waypointPosIndex, waypointDirIndex, vobPosIndex } = useMemo(() => {
    const wpIndex = new Map<string, THREE.Vector3>();
    const wpDirIndex = new Map<string, THREE.Quaternion>();
    const vobIndex = new Map<string, THREE.Vector3>();

    if (!world) return { waypointPosIndex: wpIndex, waypointDirIndex: wpDirIndex, vobPosIndex: vobIndex };

    try {
      const waypointsVector = world.getAllWaypoints() as any;
      const waypointCount = waypointsVector.size();
      for (let i = 0; i < waypointCount; i++) {
        const wp = waypointsVector.get(i);
        if (!wp?.name) continue;
        const key = normalizeNameKey(wp.name);
        if (!key) continue;
        wpIndex.set(key, new THREE.Vector3(-wp.position.x, wp.position.y, wp.position.z));

        const dir = (wp as any).direction as { x: number; y: number; z: number } | undefined;
        if (dir && (dir.x !== 0 || dir.y !== 0 || dir.z !== 0)) {
          const direction = new THREE.Vector3(-dir.x, dir.y, dir.z);
          const up = new THREE.Vector3(0, 1, 0);
          const matrix = new THREE.Matrix4();
          matrix.lookAt(new THREE.Vector3(0, 0, 0), direction, up);
          const q = new THREE.Quaternion().setFromRotationMatrix(matrix);
          const yRot = new THREE.Quaternion().setFromAxisAngle(up, Math.PI);
          q.multiply(yRot);
          wpDirIndex.set(key, q);
        }
      }
    } catch {
      // ignore
    }

    const stack: any[] = [];
    try {
      const roots = world.getVobs();
      const rootCount = roots.size();
      for (let i = 0; i < rootCount; i++) {
        const root = roots.get(i);
        if (root) stack.push(root);
      }
    } catch {
      // ignore
    }

    while (stack.length > 0) {
      const v = stack.pop();
      if (!v) continue;
      const keys = [
        v.name as string | undefined,
        (v as any).vobName as string | undefined,
        (v as any).objectName as string | undefined,
      ];
      for (const k of keys) {
        const kk = k ? normalizeNameKey(k) : "";
        if (!kk) continue;
        if (!vobIndex.has(kk)) {
          vobIndex.set(kk, new THREE.Vector3(-v.position.x, v.position.y, v.position.z));
        }
      }

      const children = v.children;
      const n = children?.size?.() ?? 0;
      for (let i = 0; i < n; i++) {
        const child = children.get(i);
        if (child) stack.push(child);
      }
    }

    return { waypointPosIndex: wpIndex, waypointDirIndex: wpDirIndex, vobPosIndex: vobIndex };
  }, [world]);

  const estimateAnimationDurationMs = useMemo(() => {
    return (modelName: string, animationName: string): number | null => {
      const caches = characterCachesRef.current;
      const base = (modelName || "HUMANS").trim().toUpperCase() || "HUMANS";
      const key = `${base}:${(animationName || "").trim().toUpperCase()}`;
      const seq: any = caches?.animations?.get(key);
      const dur = seq?.totalTimeMs;
      return typeof dur === "number" && Number.isFinite(dur) && dur > 0 ? dur : null;
    };
  }, []);

  const getNearestWaypointDirectionQuat = useMemo(() => {
    return (pos: THREE.Vector3): THREE.Quaternion | null => {
      const wpPos = waypointPosIndex;
      const wpDir = waypointDirIndex;
      let bestKey: string | null = null;
      let bestD2 = Infinity;
      for (const [k, p] of wpPos.entries()) {
        if (!wpDir.has(k)) continue;
        const dx = p.x - pos.x;
        const dz = p.z - pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestKey = k;
        }
      }
      if (!bestKey) return null;
      const q = wpDir.get(bestKey);
      return q ? q.clone() : null;
    };
  }, []);

  const getAnimationMetaForNpc = useMemo(() => {
    return (npcInstanceIndex: number, animationName: string) => {
      const reg = modelScriptRegistryRef.current;
      if (!reg) return null;
      const scripts = getNpcModelScriptsState(npcInstanceIndex);
      return reg.getAnimationMetaForNpc(scripts, animationName);
    };
  }, []);

  const resolveNpcAnimationRef = useMemo(() => {
    return (npcInstanceIndex: number, animationName: string) => {
      const meta = getAnimationMetaForNpc(npcInstanceIndex, animationName);
      const modelName = (meta?.model || "HUMANS").trim().toUpperCase() || "HUMANS";
      return { animationName: (animationName || "").trim(), modelName };
    };
  }, [getAnimationMetaForNpc]);

  // Convert NPC data to renderable NPCs with spawnpoint positions (only compute positions, not render)
  const npcsWithPositions = useMemo(() => {
    if (!world || !enabled || npcs.size === 0) {
      return [];
    }

    const renderableNpcs: Array<{ npcData: NpcData; position: THREE.Vector3 }> = [];
    const CURRENT_HOUR = worldTime.hour;
    const CURRENT_MINUTE = worldTime.minute;

    for (const [, npcData] of npcs.entries()) {
      let position: [number, number, number] | null = null;
      let waypointName: string | null = null;

      // ZenGin-like behavior: routine-driven NPC spawning depends on routine "wayboxes" derived from
      // existing waynet waypoints. If a routine references no existing waypoint at all, the original game
      // effectively never spawns the NPC. Mimic that by not rendering it.
      if (npcData.dailyRoutine && npcData.dailyRoutine.length > 0) {
        let hasAnyRoutineWaypointInWaynet = false;
        for (const r of npcData.dailyRoutine) {
          const k = normalizeNameKey(r?.waypoint ?? "");
          if (k && waypointPosIndex.has(k)) {
            hasAnyRoutineWaypointInWaynet = true;
            break;
          }
        }
        if (!hasAnyRoutineWaypointInWaynet) {
          continue;
        }
      }

      // Priority 1: Check routine waypoint at current time (10:00)
      const routineWaypoint = findActiveRoutineWaypoint(npcData.dailyRoutine, CURRENT_HOUR, CURRENT_MINUTE);
      if (routineWaypoint) {
        waypointName = routineWaypoint;
      } else {
        // Priority 2: Fall back to spawnpoint if no routine is active
        waypointName = npcData.spawnpoint;
      }

      const npcId = `npc-${npcData.instanceIndex}`;
      const loaded = loadedNpcsRef.current.get(npcId);
      if (loaded && !loaded.userData.isDisposed) {
        position = [loaded.position.x, loaded.position.y, loaded.position.z];
      } else if (waypointName) {
        const key = normalizeNameKey(waypointName);
        const wpPos = waypointPosIndex.get(key);
        if (wpPos) {
          position = [wpPos.x, wpPos.y, wpPos.z];
        } else {
          const vPos = vobPosIndex.get(key);
          if (vPos) position = [vPos.x, vPos.y, vPos.z];
        }
      }

      if (position) {
        renderableNpcs.push({
          npcData,
          position: new THREE.Vector3(position[0], position[1], position[2])
        });
      } else {
        const source = routineWaypoint ? `routine waypoint "${routineWaypoint}"` : `spawnpoint "${npcData.spawnpoint}"`;
        console.warn(`⚠️ Could not find ${source} (waypoint or VOB) for NPC ${npcData.symbolName}`);
      }
    }

    return renderableNpcs;
  }, [world, npcsKey, enabled, worldTime.hour, worldTime.minute, waypointPosIndex, vobPosIndex]);

  // Store NPCs with positions for streaming
  useEffect(() => {
    allNpcsRef.current = npcsWithPositions;
    const byId = new Map<string, { npcData: NpcData; position: THREE.Vector3 }>();
    const byIdx = new Map<number, { npcData: NpcData; position: THREE.Vector3 }>();
    const items: Array<{ id: string; position: THREE.Vector3 }> = [];
    for (const entry of npcsWithPositions) {
      const id = `npc-${entry.npcData.instanceIndex}`;
      byId.set(id, entry);
      byIdx.set(entry.npcData.instanceIndex, entry);
      items.push({ id, position: entry.position });
      updateNpcWorldPosition(entry.npcData.instanceIndex, { x: entry.position.x, y: entry.position.y, z: entry.position.z });
    }
    allNpcsByIdRef.current = byId;
    allNpcsByInstanceIndexRef.current = byIdx;
    npcItemsRef.current = items;

    // If some NPCs disappeared from the computed list (e.g. we decided they should never be spawned),
    // make sure we also unload any already-loaded instances immediately.
    const toRemove: string[] = [];
    for (const id of loadedNpcsRef.current.keys()) {
      if (!byId.has(id)) toRemove.push(id);
    }
    for (const npcId of toRemove) {
      const npcGroup = loadedNpcsRef.current.get(npcId);
      if (!npcGroup) continue;
      npcGroup.userData.isDisposed = true;
      const npcData = npcGroup.userData.npcData as NpcData | undefined;
      if (npcData) removeNpcWorldPosition(npcData.instanceIndex);
      const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
      const isLoading = Boolean(npcGroup.userData.modelLoading);
      if (instance && !isLoading) instance.dispose();
      if (npcsGroupRef.current) npcsGroupRef.current.remove(npcGroup);
      disposeObject3D(npcGroup);
      loadedNpcsRef.current.delete(npcId);
      if (cavalornGroupRef.current === npcGroup) cavalornGroupRef.current = null;
    }
  }, [npcsWithPositions]);

  useEffect(() => {
    waypointMoverRef.current = world ? createWaypointMover(world) : null;
  }, [world]);

  useEffect(() => {
    setFreepointsWorld(world);
  }, [world]);

  useEffect(() => {
    worldMeshRef.current = null;
    pendingGroundSnapRef.current = [];
    warnedNoWorldMeshRef.current = false;
  }, [world]);

  const ensureWorldMesh = (): THREE.Object3D | null => {
    if (worldMeshRef.current) return worldMeshRef.current;
    const found = scene.getObjectByName(WORLD_MESH_NAME);
    if (found) {
      worldMeshRef.current = found;
      return found;
    }
    return null;
  };

  const applyMoveConstraint = (npcGroup: THREE.Group, desiredX: number, desiredZ: number, dt: number): NpcMoveConstraintResult => {
    // Dynamic NPC-vs-NPC collision (XZ only): prevent passing through other loaded NPCs.
    // This runs before the world collision solver so we don't "push into walls" while clamping to other NPCs.
    {
      const startX = npcGroup.position.x;
      const startZ = npcGroup.position.z;
      const origDesiredX = desiredX;
      const origDesiredZ = desiredZ;
      const origDx = origDesiredX - startX;
      const origDz = origDesiredZ - startZ;
      const origDist = Math.hypot(origDx, origDz);
      // Use a slightly smaller radius for NPC-vs-NPC than for NPC-vs-world so characters can get closer.
      const selfRadius = collisionConfig.radius * 0.6;
      const selfY = npcGroup.position.y;
      const colliders: NpcCircleCollider[] = (npcGroup.userData._npcCollidersScratch as NpcCircleCollider[] | undefined) ?? [];
      colliders.length = 0;
      npcGroup.userData._npcCollidersScratch = colliders;

      let pool: NpcCircleCollider[] = (npcGroup.userData._npcColliderPool as NpcCircleCollider[] | undefined) ?? [];
      npcGroup.userData._npcColliderPool = pool;
      let poolIdx = 0;

      for (const other of loadedNpcsRef.current.values()) {
        if (other === npcGroup) continue;
        if (!other || other.userData.isDisposed) continue;
        if (Math.abs(other.position.y - selfY) > 200) continue;

        const otherData = other.userData.npcData as NpcData | undefined;
        let c = pool[poolIdx];
        if (!c) {
          c = { id: undefined, x: 0, z: 0, radius: selfRadius, y: 0 };
          pool[poolIdx] = c;
        }
        poolIdx++;

        c.id = otherData?.instanceIndex;
        c.x = other.position.x;
        c.z = other.position.z;
        c.radius = selfRadius;
        c.y = other.position.y;
        colliders.push(c);
      }

      if (colliders.length > 0) {
        const runConstraint = (x: number, z: number) =>
          constrainCircleMoveXZ({
            startX,
            startZ,
            desiredX: x,
            desiredZ: z,
            radius: selfRadius,
            colliders,
            maxIterations: 3,
            separationSlop: 0.05,
            y: selfY,
            maxYDelta: 200,
          });

        const constrained = runConstraint(desiredX, desiredZ);
        desiredX = constrained.x;
        desiredZ = constrained.z;
        npcGroup.userData._npcNpcBlocked = constrained.blocked;

        // If two NPCs walk directly into each other, a pure "no-penetration" clamp can deadlock them.
        // ZenGin resolves this with dynamic character collision/physics and local steering. We emulate that
        // by attempting a small deterministic sidestep when we are blocked and made little/no progress.
        const afterDx = desiredX - startX;
        const afterDz = desiredZ - startZ;
        const afterDist = Math.hypot(afterDx, afterDz);
        const dirX = origDist > 1e-8 ? origDx / origDist : 0;
        const dirZ = origDist > 1e-8 ? origDz / origDist : 0;
        const progress = afterDx * dirX + afterDz * dirZ; // signed forward progress
        const lowProgress = progress < origDist * 0.15 && afterDist < origDist * 0.25;

        // Track sustained low-progress blocking to detect NPC-vs-NPC deadlocks (used for candidate-direction escape).
        {
          let streak = (npcGroup.userData._npcDeadlockStreak as number | undefined) ?? 0;
          const isCandidate = constrained.blocked && dt > 0 && origDist > 1e-6 && lowProgress;
          npcGroup.userData._npcDeadlockStreak = isCandidate ? streak + dt : 0;
        }

        if (constrained.blocked && dt > 0 && origDist > 1e-6 && lowProgress) {
          // Pick a stable side relative to the closest collider so the pair chooses opposite sides.
          let closestId: number | null = null;
          let closestDist = Infinity;
          for (const c of colliders) {
            if (typeof c.id !== "number") continue;
            const d = Math.hypot(startX - c.x, startZ - c.z);
            if (d < closestDist) {
              closestDist = d;
              closestId = c.id;
            }
          }

          const npcData = npcGroup.userData.npcData as NpcData | undefined;
          const idx = npcData?.instanceIndex ?? 0;
          let preferredSide = idx % 2 === 0 ? 1 : -1;
          if (closestId != null && closestId !== idx) preferredSide = idx < closestId ? 1 : -1;
          let side = (npcGroup.userData.avoidSide as number | undefined) ?? preferredSide;
          if (side !== 1 && side !== -1) side = 1;
          npcGroup.userData.avoidSide = side;

          const trySide = (s: number) => {
            const perpX = -dirZ * s;
            const perpZ = dirX * s;
            // Keep the sidestep gentle; the main forward movement is still towards the waypoint.
            const step = Math.min(selfRadius * 0.9, 180 * dt);
            const fwd = Math.min(origDist, 40 * dt);
            const a = runConstraint(startX + dirX * fwd + perpX * step, startZ + dirZ * fwd + perpZ * step);
            if (!a.blocked) return a;
            // If forward+side is blocked, try pure lateral separation (useful for head-on deadlocks).
            return runConstraint(startX + perpX * step, startZ + perpZ * step);
          };

          let a = trySide(side);
          if (!a.blocked && (Math.abs(a.x - startX) > 1e-6 || Math.abs(a.z - startZ) > 1e-6)) {
            desiredX = a.x;
            desiredZ = a.z;
            npcGroup.userData._npcNpcBlocked = false;
          } else {
            const b = trySide(-side);
            if (!b.blocked && (Math.abs(b.x - startX) > 1e-6 || Math.abs(b.z - startZ) > 1e-6)) {
              desiredX = b.x;
              desiredZ = b.z;
              npcGroup.userData._npcNpcBlocked = false;
              npcGroup.userData.avoidSide = -side;
            } else {
              const deadlockStreak = (npcGroup.userData._npcDeadlockStreak as number | undefined) ?? 0;
              // Start more aggressive resolution a bit earlier than the logging threshold.
              // In practice, small oscillations can keep resetting the streak before 0.35s while the group remains stuck.
              const deadlocked = deadlockStreak >= 0.25;

              if (deadlocked) {
                // Candidate direction search: sample several short moves around the NPC and pick the best
                // collision-free option that still makes reasonable progress towards the desired direction.
                const baseYaw = Math.atan2(dirX, dirZ);
                const samples = 24;
                // Keep the candidate displacement bounded by the caller's requested step for this frame.
                // Larger radii can look like "teleporting" and break animation pacing.
                const stepDist = origDist;
                const radii = [stepDist];

                let best: { x: number; z: number; score: number; yaw: number; radius: number; progress: number; clearance: number } | null =
                  null;

                const scoreCandidate = (x: number, z: number) => {
                  const distToDesired = Math.hypot(x - origDesiredX, z - origDesiredZ);
                  const dx = x - startX;
                  const dz = z - startZ;
                  const progress = dx * dirX + dz * dirZ;

                  let minClearance = Number.POSITIVE_INFINITY;
                  for (const c of colliders) {
                    const d = Math.hypot(x - c.x, z - c.z) - selfRadius - (c.radius ?? selfRadius);
                    if (d < minClearance) minClearance = d;
                  }
                  if (!Number.isFinite(minClearance)) minClearance = 0;

                  // Prefer staying near the requested move, but also prioritize gaining clearance and forward progress.
                  const score = minClearance * 2.5 + progress * 1.0 - distToDesired * 0.25;
                  return { score, progress, clearance: minClearance };
                };

                for (const r of radii) {
                  for (let i = 0; i < samples; i++) {
                    const yaw = baseYaw + (i / samples) * Math.PI * 2;
                    const cx = startX + Math.sin(yaw) * r;
                    const cz = startZ + Math.cos(yaw) * r;
                    const c = runConstraint(cx, cz);
                    if (c.blocked) continue;
                    const movedDist = Math.hypot(c.x - startX, c.z - startZ);
                    if (movedDist < 1e-6) continue;

                    const s = scoreCandidate(c.x, c.z);
                    // Discard candidates that would still end up in penetration after constraints (very rare, but safe).
                    if (s.clearance < -0.05) continue;
                    if (!best || s.score > best.score) {
                      best = { x: c.x, z: c.z, score: s.score, yaw, radius: r, progress: s.progress, clearance: s.clearance };
                    }
                  }
                }

                if (best) {
                  desiredX = best.x;
                  desiredZ = best.z;
                  npcGroup.userData._npcNpcBlocked = false;

                  // Signal the mover to temporarily steer in the chosen direction (so the character turns and walks away),
                  // then wait a bit to help clear traffic jams. The mover handles the actual steering and waiting.
                  {
                    const nowMs = Date.now();
                    const steerUntil = (npcGroup.userData._npcTrafficSteerUntilMs as number | undefined) ?? 0;
                    if (!(steerUntil > nowMs)) {
                      npcGroup.userData._npcTrafficSteerYaw = best.yaw;
                      npcGroup.userData._npcTrafficSteerUntilMs = nowMs + 500;
                      npcGroup.userData._npcTrafficSteerPendingWait = true;
                      npcGroup.userData._npcTrafficSteerMoved = false;
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        npcGroup.userData._npcNpcBlocked = false;
      }
    }

    const ground = ensureWorldMesh();
    if (!ground) {
      const beforeX = npcGroup.position.x;
      const beforeZ = npcGroup.position.z;
      npcGroup.position.x = desiredX;
      npcGroup.position.z = desiredZ;
      const moved = Math.abs(npcGroup.position.x - beforeX) > 1e-6 || Math.abs(npcGroup.position.z - beforeZ) > 1e-6;
      return { blocked: Boolean(npcGroup.userData._npcNpcBlocked), moved };
    }
    const worldRes = applyNpcWorldCollisionXZ(collisionCtx, npcGroup, desiredX, desiredZ, ground, dt, collisionConfig);
    return { blocked: Boolean(npcGroup.userData._npcNpcBlocked) || worldRes.blocked, moved: worldRes.moved };
  };

  const persistNpcPosition = (npcGroup: THREE.Group) => {
    const npcData = npcGroup.userData.npcData as NpcData | undefined;
    if (!npcData) return;
    const entry = allNpcsByInstanceIndexRef.current.get(npcData.instanceIndex);
    if (entry) entry.position.copy(npcGroup.position);
  };

  const setWorldYFromWorldPos = (object: THREE.Object3D, objWorldPos: THREE.Vector3, desiredWorldY: number) => {
    tmpDesiredWorldPos.copy(objWorldPos);
    tmpDesiredWorldPos.y = desiredWorldY;

    if (!object.parent) {
      object.position.y = desiredWorldY;
      return;
    }

    tmpLocalBefore.copy(objWorldPos);
    object.parent.worldToLocal(tmpLocalBefore);
    tmpLocalAfter.copy(tmpDesiredWorldPos);
    object.parent.worldToLocal(tmpLocalAfter);
    tmpLocalAfter.sub(tmpLocalBefore);
    object.position.add(tmpLocalAfter);
  };

  const smoothWorldY = (object: THREE.Object3D, targetWorldY: number, deltaSeconds: number) => {
    // Inspired by ZenGin's surface-alignment smoothing: keep motion continuous and avoid hard snaps.
    // We treat uphill differently to prevent the character from lagging behind the terrain and clipping into it.
    const SMOOTH_UP = 30; // snappier uphill
    const SMOOTH_DOWN = 14; // gentler downhill
    object.getWorldPosition(tmpObjWorldPos);

    const dt = Math.min(Math.max(0, deltaSeconds), 0.05);
    const dyToTarget = targetWorldY - tmpObjWorldPos.y;
    const smooth = dyToTarget >= 0 ? SMOOTH_UP : SMOOTH_DOWN;
    const alpha = 1 - Math.exp(-smooth * dt);
    const desired = tmpObjWorldPos.y + dyToTarget * alpha;

    // Clamp vertical speed to avoid popping on steep terrain / noisy hits.
    const maxUp = 4500 * dt;
    const maxDown = 1500 * dt;
    const maxDy = dyToTarget >= 0 ? maxUp : maxDown;
    let clamped = tmpObjWorldPos.y + Math.max(-maxDy, Math.min(maxDy, desired - tmpObjWorldPos.y));

    // Never allow significant penetration below the sampled ground height (helps uphill clipping).
    const PENETRATION_ALLOW = 2;
    const minY = targetWorldY - PENETRATION_ALLOW;
    if (clamped < minY) {
      // Avoid hard snapping to the ground target (causes visible stepping on steep slopes).
      // Instead, converge quickly but smoothly when we are below the desired ground height.
      const below = minY - clamped;
      const recoverAlpha = 1 - Math.exp(-40 * dt);
      clamped = Math.min(minY, clamped + below * recoverAlpha);
    }

    setWorldYFromWorldPos(object, tmpObjWorldPos, clamped);
  };

  const sampleGroundHitForMove = (
    worldPos: THREE.Vector3,
    ground: THREE.Object3D,
    options: {
      clearance: number;
      rayStartAbove: number;
      maxDownDistance: number;
      preferClosestToY: number;
      minHitNormalY?: number;
    }
  ): { targetY: number; point: THREE.Vector3; normal: THREE.Vector3 } | null => {
    if (!groundRaycasterRef.current) groundRaycasterRef.current = new THREE.Raycaster();
    const raycaster = groundRaycasterRef.current;
    const prevFirstHitOnly = (raycaster as any).firstHitOnly;
    // We need the full hit list to pick the best surface when multiple intersections exist.
    (raycaster as any).firstHitOnly = false;
    raycaster.ray.origin.set(worldPos.x, worldPos.y + options.rayStartAbove, worldPos.z);
    raycaster.ray.direction.set(0, -1, 0);
    raycaster.near = 0;
    raycaster.far = options.rayStartAbove + options.maxDownDistance;
    const hits = raycaster.intersectObject(ground, false);
    (raycaster as any).firstHitOnly = prevFirstHitOnly;
    if (!hits.length) return null;

    const isCollidableHit = (hit: THREE.Intersection): boolean => {
      const obj: any = hit.object as any;
      if (!obj?.isMesh) return true;
      const noColl: boolean[] | undefined = obj.userData?.noCollDetByMaterialId;
      if (!noColl) return true;
      const tri = hit.faceIndex ?? -1;
      if (tri < 0) return true;
      const ids: Int32Array | undefined = obj.geometry?.userData?.materialIds;
      const matId = ids && tri < ids.length ? ids[tri] : null;
      if (matId == null) return true;
      return !noColl[matId];
    };

    let best: THREE.Intersection | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestNormalY = -Infinity;

    for (const hit of hits) {
      if (!isCollidableHit(hit)) continue;
      const faceNormal = hit.face?.normal;
      let normalY: number | null = null;
      if (faceNormal) {
        tmpMoveNormal.copy(faceNormal);
        tmpMoveNormalMatrix.getNormalMatrix(hit.object.matrixWorld);
        tmpMoveNormal.applyMatrix3(tmpMoveNormalMatrix).normalize();
        // Flip only when we're likely hitting the back-face of a floor (surface at/below the query point).
        // Allow a small window above the current position to recover from minor penetrations (stairs/steps),
        // while still preventing snapping to distant roofs/ceilings.
        const FLIP_MAX_ABOVE = 20;
        if (tmpMoveNormal.y < 0 && hit.point.y <= worldPos.y + FLIP_MAX_ABOVE) tmpMoveNormal.multiplyScalar(-1);
        normalY = tmpMoveNormal.y;
        if (typeof options.minHitNormalY === "number" && normalY < options.minHitNormalY) continue;
      }

      const y = hit.point.y + options.clearance;
      const score = Math.abs(y - options.preferClosestToY);
      if (score < bestScore - 1e-6) {
        best = hit;
        bestScore = score;
        bestNormalY = normalY ?? bestNormalY;
      } else if (Math.abs(score - bestScore) <= 1e-6 && (normalY ?? -Infinity) > bestNormalY) {
        // Tie-breaker: prefer the more "up-facing" normal to reduce noisy steep faces.
        best = hit;
        bestScore = score;
        bestNormalY = normalY ?? bestNormalY;
      }
    }

    if (!best) return null;

    const faceNormal = best.face?.normal;
    if (faceNormal) {
      tmpMoveNormal.copy(faceNormal);
      tmpMoveNormalMatrix.getNormalMatrix(best.object.matrixWorld);
      tmpMoveNormal.applyMatrix3(tmpMoveNormalMatrix).normalize();
      const FLIP_MAX_ABOVE = 20;
      if (tmpMoveNormal.y < 0 && best.point.y <= worldPos.y + FLIP_MAX_ABOVE) tmpMoveNormal.multiplyScalar(-1);
    } else {
      tmpMoveNormal.set(0, 1, 0);
    }

    tmpMoveHitPoint.copy(best.point);
    return { targetY: best.point.y + options.clearance, point: tmpMoveHitPoint, normal: tmpMoveNormal };
  };

  const predictGroundYFromPlane = (
    plane: { nx: number; ny: number; nz: number; px: number; py: number; pz: number; clearance: number },
    x: number,
    z: number
  ): number | null => {
    const ny = plane.ny;
    if (!Number.isFinite(ny) || Math.abs(ny) < 1e-5) return null;
    const dx = x - plane.px;
    const dz = z - plane.pz;
    const y = plane.py - (plane.nx * dx + plane.nz * dz) / ny;
    if (!Number.isFinite(y)) return null;
    return y + plane.clearance;
  };

  const snapNpcToGroundOrDefer = (npcGroup: THREE.Group) => {
    const ground = ensureWorldMesh();
    if (!ground) {
      if (!warnedNoWorldMeshRef.current) {
        warnedNoWorldMeshRef.current = true;
      }
      pendingGroundSnapRef.current.push(npcGroup);
      return false;
    }

    if (!groundRaycasterRef.current) groundRaycasterRef.current = new THREE.Raycaster();

    // Prefer a short ray from just above the NPC to avoid snapping to roofs/terrain above interior spaces.
    // Fallback to a longer ray only if needed.
    const ok =
      setObjectOriginOnFloor(npcGroup, ground, { clearance: 4, rayStartAbove: 50, maxDownDistance: 5000, raycaster: groundRaycasterRef.current, recursive: false, firstHitOnly: true }) ||
      setObjectOriginOnFloor(npcGroup, ground, { clearance: 4, rayStartAbove: 2000, maxDownDistance: 20000, raycaster: groundRaycasterRef.current, recursive: false, firstHitOnly: true });
    if (!ok) {
      pendingGroundSnapRef.current.push(npcGroup);
    } else {
      npcGroup.userData.groundSnapped = true;
      persistNpcPosition(npcGroup);
    }
    return ok;
  };

  useEffect(() => {
    if (!enabled) return;
    if (!zenKit) return;
    if (didPreloadAnimationsRef.current) return;
    didPreloadAnimationsRef.current = true;

    void preloadAnimationSequences(
      zenKit,
      characterCachesRef.current.binary,
      characterCachesRef.current.animations,
      "HUMANS",
      HUMAN_LOCOMOTION_PRELOAD_ANIS
    );
  }, [enabled, zenKit]);

  useEffect(() => {
    if (!zenKit) return;
    if (modelScriptRegistryRef.current) return;
    modelScriptRegistryRef.current = new ModelScriptRegistry({
      zenKit,
      fetchBinary: (url: string) => fetchBinaryCached(url, characterCachesRef.current.binary),
    });
    modelScriptRegistryRef.current.startLoadScript("HUMANS");
  }, [zenKit]);

  const loadNpcCharacter = async (npcGroup: THREE.Group, npcData: NpcData) => {
    if (!zenKit) return;
    const visual = npcData.visual;
    const visualKey = visual
      ? `${visual.bodyMesh}|${visual.bodyTex}|${visual.skin}|${visual.headMesh}|${visual.headTex}|${visual.teethTex}|${visual.armorInst}`
      : 'default';

    if (npcGroup.userData.characterInstance && npcGroup.userData.visualKey === visualKey) return;
    if (npcGroup.userData.characterInstance && npcGroup.userData.visualKey !== visualKey) {
      const existing = npcGroup.userData.characterInstance as CharacterInstance;
      existing.dispose();
      npcGroup.userData.characterInstance = null;
    }

    npcGroup.userData.modelLoading = true;
    npcGroup.userData.visualKey = visualKey;

    try {
      const instance = await createHumanCharacterInstance({
        zenKit,
        caches: characterCachesRef.current,
        parent: npcGroup,
        animationName: 's_Run',
        loop: true,
        mirrorX: true,
        rootMotionTarget: "self",
        applyRootMotion: false,
        align: 'ground',
        bodyMesh: visual?.bodyMesh,
        bodyTex: visual?.bodyTex,
        skin: visual?.skin,
        headMesh: visual?.headMesh,
        headTex: visual?.headTex,
        teethTex: visual?.teethTex,
        armorInst: visual?.armorInst,
      });
      if (npcGroup.userData.isDisposed) return;

      if (!instance) {
        console.warn(`Failed to create NPC character model for ${npcData.symbolName}`);
        return;
      }

      npcGroup.userData.characterInstance = instance;
      npcGroup.userData.locomotion = createHumanLocomotionController();
      (npcGroup.userData.characterInstance as CharacterInstance).update(0);
      if (npcGroup.userData.isDisposed) return;

      const npcId = `npc-${npcData.instanceIndex}`;
      npcGroup.userData.startMoveToWaypoint = (targetWaypointName: string, options?: any) => {
        return waypointMoverRef.current?.startMoveToWaypoint(npcId, npcGroup, targetWaypointName, options) ?? false;
      };
      npcGroup.userData.startMoveToFreepoint = (freepointName: string, options?: any) => {
        return waypointMoverRef.current?.startMoveToFreepoint(npcId, npcGroup, freepointName, options) ?? false;
      };

      const symbolName = (npcData.symbolName || "").trim().toUpperCase();
      const displayName = (npcData.name || "").trim().toUpperCase();
      const isCavalorn = symbolName === "BAU_4300_ADDON_CAVALORN" || displayName === "CAVALORN";
      if (isCavalorn) {
        npcGroup.userData.isCavalorn = true;
        cavalornGroupRef.current = npcGroup;
      }

      const placeholder = npcGroup.getObjectByName('npc-placeholder');
      if (placeholder) {
        npcGroup.remove(placeholder);
        disposeObject3D(placeholder);
      }

      const sprite = npcGroup.children.find(child => child instanceof THREE.Sprite) as THREE.Sprite | undefined;
      const modelObj = instance.object;
      if (sprite && modelObj) {
        npcGroup.updateMatrixWorld(true);
        modelObj.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(modelObj);
        const center = box.getCenter(new THREE.Vector3());
        const topWorld = new THREE.Vector3(center.x, box.max.y, center.z);
        const topLocal = npcGroup.worldToLocal(topWorld);
        sprite.position.y = topLocal.y + 25;
      }

      npcGroup.userData.modelLoaded = true;
    } catch (error) {
      console.warn(`Failed to load NPC character model for ${npcData.symbolName}:`, error);
    } finally {
      npcGroup.userData.modelLoading = false;
      if (npcGroup.userData.isDisposed) {
        const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
        if (instance) instance.dispose();
        disposeObject3D(npcGroup);
      }
    }
  };

  // Streaming NPC loader - loads/unloads based on camera distance
  const updateNpcStreaming = () => {
    if (!enabled || allNpcsRef.current.length === 0 || !world) {
      return;
    }

    const config = {
      loadDistance: NPC_LOAD_DISTANCE,
      unloadDistance: NPC_UNLOAD_DISTANCE,
      updateThreshold: 100,
      updateInterval: 10,
    };

    // Use the Three.js camera position directly if cameraPosition prop is not provided or is at origin
    const effectiveCameraPos = cameraPosition || (camera ? camera.position : undefined);

    const { shouldUpdate, cameraPos } = shouldUpdateStreaming(
      streamingState.current,
      effectiveCameraPos,
      config
    );

    if (shouldUpdate) {
      // Convert NPCs to streamable items with positions for distance checking
      const npcItems = npcItemsRef.current;

      // Keep already-loaded NPCs in sync with their latest computed positions
      for (const [id, npcGroup] of loadedNpcsRef.current.entries()) {
        const entry = allNpcsByIdRef.current.get(id);
        if (entry) npcGroup.position.copy(entry.position);
      }

      // Find NPCs to load/unload using shared utility
      const { toLoad, toUnload } = getItemsToLoadUnload(
        npcItems,
        cameraPos,
        config,
        loadedNpcsRef.current
      );

      // Load new NPCs
      for (const item of toLoad) {
        const npc = allNpcsByIdRef.current.get(item.id);
        if (!npc) continue;

        // Create NPC mesh imperatively
        // If multiple NPCs share the same spawn waypoint, spread them slightly in XZ so they don't start fully overlapped.
        // (ZenGin would typically resolve this via dynamic character collision; we do a simple deterministic spread here.)
        const spreadRadius = collisionConfig.radius * 0.6;
        const existing: Array<{ x: number; z: number; y?: number }> = [];
        for (const other of loadedNpcsRef.current.values()) {
          if (!other || other.userData.isDisposed) continue;
          existing.push({ x: other.position.x, z: other.position.z, y: other.position.y });
        }
        const spread = spreadSpawnXZ({
          baseX: npc.position.x,
          baseZ: npc.position.z,
          baseY: npc.position.y,
          existing,
          minSeparation: spreadRadius * 2 + 0.05,
          maxTries: 24,
          maxYDelta: 200,
        });
        if (spread.applied) {
          npc.position.x = spread.x;
          npc.position.z = spread.z;
        }

        const npcGroup = createNpcMesh(npc.npcData, npc.position);
        loadedNpcsRef.current.set(item.id, npcGroup);
        npcGroup.userData.moveConstraint = applyMoveConstraint;
        {
          const symbolName = (npc.npcData.symbolName || "").trim().toUpperCase();
          const displayName = (npc.npcData.name || "").trim().toUpperCase();
          const isCavalorn = symbolName === "BAU_4300_ADDON_CAVALORN" || displayName === "CAVALORN";
          if (isCavalorn) {
            npcGroup.userData.isCavalorn = true;
            cavalornGroupRef.current = npcGroup;
          }
        }

        // Ensure NPCs group exists
        if (!npcsGroupRef.current) {
          const group = new THREE.Group();
          group.name = 'NPCs';
          npcsGroupRef.current = group;
          scene.add(group);
        }
        npcsGroupRef.current.add(npcGroup);
        snapNpcToGroundOrDefer(npcGroup);

        // Load real model asynchronously (replaces placeholder)
        void loadNpcCharacter(npcGroup, npc.npcData);
      }

      // Unload distant NPCs
      for (const npcId of toUnload) {
        const npcGroup = loadedNpcsRef.current.get(npcId);
        if (npcGroup && npcsGroupRef.current) {
          npcGroup.userData.isDisposed = true;
          const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
          const isLoading = Boolean(npcGroup.userData.modelLoading);
          if (instance && !isLoading) instance.dispose();
          npcsGroupRef.current.remove(npcGroup);
          disposeObject3D(npcGroup);
          loadedNpcsRef.current.delete(npcId);
          if (cavalornGroupRef.current === npcGroup) cavalornGroupRef.current = null;
        }
      }
    }
  };

  // Streaming update via useFrame
  useFrame((_state, delta) => {
    if (allNpcsRef.current.length > 0) {
      updateNpcStreaming();
    }

    if (!enabled || loadedNpcsRef.current.size === 0) return;

    // Routine steering: make sure loaded NPCs actually move to the active routine waypoint/spot for the current time.
    // This keeps things simple: routines at least relocate NPCs when the clock changes.
    {
      const t = getWorldTime();
      const key = `${t.day}:${t.hour}:${t.minute}`;
      if (routineTickKeyRef.current !== key) {
        routineTickKeyRef.current = key;
        const DIST_TO_ROUTE_WP = 500; // TA_DIST_SELFWP_MAX in original scripts
        for (const g of loadedNpcsRef.current.values()) {
          if (!g || g.userData.isDisposed) continue;
          const npcData = g.userData.npcData as NpcData | undefined;
          if (!npcData) continue;

          const isManualCavalorn = manualControlCavalornEnabled && cavalornGroupRef.current === g;
          if (isManualCavalorn) continue;

          const routineWp = findActiveRoutineWaypoint(npcData.dailyRoutine, t.hour, t.minute);
          const desired = routineWp || npcData.spawnpoint;
          if (!desired) continue;

          const prevDesired = (g.userData as any)._routineDesired as string | undefined;
          (g.userData as any)._routineDesired = desired;

          const targetKey = normalizeNameKey(desired);
          const wpPos = waypointPosIndex.get(targetKey);
          const vPos = wpPos ? null : vobPosIndex.get(targetKey);
          const targetPos = wpPos ?? vPos;
          if (!targetPos) continue;

          const dx = targetPos.x - g.position.x;
          const dz = targetPos.z - g.position.z;
          const distXZ = Math.hypot(dx, dz);
          if (distXZ <= DIST_TO_ROUTE_WP) continue;

          // Only restart the route when the routine target changes; otherwise let the mover/deadlock solver do its job.
          const prevMoveTarget = (g.userData as any)._routineMoveTarget as string | undefined;
          if (prevMoveTarget === desired && prevDesired === desired) continue;

          // Route routine relocation through the per-NPC event manager queue so the inspector/debug UI reflects it.
          requestNpcEmClear(npcData.instanceIndex);
          if (wpPos) {
            enqueueNpcEmMessage(npcData.instanceIndex, { type: "gotoWaypoint", waypointName: desired, locomotionMode: "walk" });
          } else {
            enqueueNpcEmMessage(npcData.instanceIndex, {
              type: "gotoPosition",
              x: targetPos.x,
              y: targetPos.y,
              z: targetPos.z,
              locomotionMode: "walk",
            });
          }
          (g.userData as any)._routineMoveTarget = desired;
        }
      }
    }

    // Sync current world positions for all loaded NPCs before the VM/state-loop tick.
    // This ensures builtins like `Npc_IsOnFP` / `Wld_IsFPAvailable` see up-to-date coordinates.
    for (const g of loadedNpcsRef.current.values()) {
      if (!g || g.userData.isDisposed) continue;
      const npcData = g.userData.npcData as NpcData | undefined;
      if (!npcData) continue;
      updateNpcWorldPosition(npcData.instanceIndex, { x: g.position.x, y: g.position.y, z: g.position.z });
    }

    // Run a minimal Daedalus "state loop" tick for loaded NPCs.
    // This is what triggers scripts like `zs_bandit_loop()` that call `AI_GotoFP(...)`.
    {
      const vm = getRuntimeVm();
      if (vm) {
        const t = getWorldTime();
        const nowMs = Date.now();
        for (const g of loadedNpcsRef.current.values()) {
          if (!g || g.userData.isDisposed) continue;
          const npcData = g.userData.npcData as NpcData | undefined;
          if (!npcData?.dailyRoutine || !npcData.symbolName) continue;

          // Unlike older spacer-web builds, we do not gate state-loop execution based on distance to the routine waypoint.
          // The original engine relies on zCEventManager job semantics (and FindSpot filtering) rather than such gating.

          const nextAt = (g.userData as any)._aiLoopNextAtMs as number | undefined;
          if (typeof nextAt === "number" && nextAt > nowMs) continue;
          (g.userData as any)._aiLoopNextAtMs = nowMs + 500; // 2Hz

          const currentTime = t.hour * 60 + t.minute;
          let activeState: string | null = null;
          for (const r of npcData.dailyRoutine) {
            const startM = r.start_h * 60 + (r.start_m ?? 0);
            const stopM = r.stop_h * 60 + (r.stop_m ?? 0);
            const wraps = stopM < startM;
            const isActive = wraps ? currentTime >= startM || currentTime < stopM : currentTime >= startM && currentTime < stopM;
            if (isActive && r.state) {
              activeState = r.state;
              break;
            }
          }
          if (!activeState) continue;

          // On state switches the original engine calls:
          // - `<STATE>_end()` for the previous state (if present)
          // - `<STATE>()` for the new state (entry)
          // and resets the state timer. Many TA_* loops rely on entry to initialize aivars
          // (e.g. `AIV_TAPOSITION = NOTINPOS`).
          const prevState = (g.userData as any)._aiActiveStateName as string | undefined;
          if (prevState !== activeState) {
            vm.setGlobalSelf(npcData.symbolName);

            if (prevState) {
              const endFnCandidates = [`${prevState}_end`, `${prevState}_END`];
              const endFn = endFnCandidates.find((fn) => vm.hasSymbol(fn));
              if (endFn) {
                try {
                  vm.callFunction(endFn, []);
                } catch {
                  // Ignore state-end failures; scripts expect this to be best-effort.
                }
              }
            }

            const entryFnCandidates = [activeState, activeState.toUpperCase()];
            const entryFn = entryFnCandidates.find((fn) => vm.hasSymbol(fn));
            if (entryFn) {
              try {
                vm.callFunction(entryFn, []);
              } catch {
                // Ignore entry failures; the loop tick may still be useful.
              }
            }

            (g.userData as any)._aiActiveStateName = activeState;
            setNpcStateTime(npcData.instanceIndex, 0);
            (g.userData as any)._aiLoopLastAtMs = nowMs;
          }

          const loopFnCandidates = [`${activeState}_loop`, `${activeState}_LOOP`];
          const loopFn = loopFnCandidates.find((fn) => vm.hasSymbol(fn));
          if (!loopFn) continue;

          // Advance script state time by real elapsed time since the last loop tick for this NPC.
          const lastAt = (g.userData as any)._aiLoopLastAtMs as number | undefined;
          const dtSec = typeof lastAt === "number" ? Math.max(0, (nowMs - lastAt) / 1000) : 0;
          (g.userData as any)._aiLoopLastAtMs = nowMs;
          advanceNpcStateTime(npcData.instanceIndex, dtSec);

          vm.setGlobalSelf(npcData.symbolName);
          vm.callFunction(loopFn, []);
        }
      }
    }

    // Debug helper: teleport Cavalorn in front of the camera (manual control only).
    if (manualControlCavalornEnabled && teleportCavalornSeqAppliedRef.current !== teleportCavalornSeqRef.current) {
      const cavalorn = cavalornGroupRef.current;
      const ground = ensureWorldMesh();
      const cam = camera;
      if (cavalorn && cam) {
        cam.getWorldDirection(tmpTeleportForward);
        tmpTeleportForward.y = 0;
        if (tmpTeleportForward.lengthSq() < 1e-8) tmpTeleportForward.set(0, 0, -1);
        else tmpTeleportForward.normalize();

        const TELEPORT_DISTANCE = 220;
        const targetX = cam.position.x + tmpTeleportForward.x * TELEPORT_DISTANCE;
        const targetZ = cam.position.z + tmpTeleportForward.z * TELEPORT_DISTANCE;
        cavalorn.position.x = targetX;
        cavalorn.position.z = targetZ;

        // Face the same direction as the camera.
        const yaw = Math.atan2(tmpTeleportForward.x, tmpTeleportForward.z);
        tmpTeleportDesiredQuat.setFromAxisAngle(tmpManualUp, yaw);
        cavalorn.quaternion.copy(tmpTeleportDesiredQuat);

        // Reset slide state and force a fresh ground sample.
        cavalorn.userData.isSliding = false;
        cavalorn.userData.slideVelXZ = { x: 0, z: 0 };
        cavalorn.userData.lastGroundSampleAt = 0;
        cavalorn.userData._clock = 0;

        if (ground) {
          const minSlideNy = Math.cos(collisionConfig.maxSlideAngleRad);
          const hit =
            sampleGroundHitForMove(new THREE.Vector3(targetX, cam.position.y, targetZ), ground, {
              clearance: 4,
              rayStartAbove: 2000,
              maxDownDistance: 20000,
              preferClosestToY: cam.position.y,
              minHitNormalY: minSlideNy,
            }) ||
            sampleGroundHitForMove(new THREE.Vector3(targetX, cam.position.y, targetZ), ground, {
              clearance: 4,
              rayStartAbove: 2000,
              maxDownDistance: 20000,
              preferClosestToY: cam.position.y,
            });

          if (hit) {
            cavalorn.userData.groundPlane = {
              nx: hit.normal.x,
              ny: hit.normal.y,
              nz: hit.normal.z,
              px: hit.point.x,
              py: hit.point.y,
              pz: hit.point.z,
              clearance: 4,
            };
            cavalorn.userData.groundYTarget = hit.targetY;
            cavalorn.position.y = hit.targetY;
          } else {
            // Fallback to the previous ground snap method if we didn't find a floor from the camera height.
            snapNpcToGroundOrDefer(cavalorn);
          }
        } else {
          // If WORLD_MESH isn't ready yet, defer to the existing snap queue.
          snapNpcToGroundOrDefer(cavalorn);
        }

        persistNpcPosition(cavalorn);
        teleportCavalornSeqAppliedRef.current = teleportCavalornSeqRef.current;
      }
    }

    // If the world mesh arrives after NPCs were spawned, snap any pending NPCs in small batches.
    if (pendingGroundSnapRef.current.length > 0 && ensureWorldMesh()) {
      const batch = pendingGroundSnapRef.current.splice(0, 8);
      const ground = worldMeshRef.current!;
      if (!groundRaycasterRef.current) groundRaycasterRef.current = new THREE.Raycaster();
      const raycaster = groundRaycasterRef.current;
      for (const g of batch) {
        if (!g || g.userData.isDisposed) continue;
        const ok =
          setObjectOriginOnFloor(g, ground, { clearance: 4, rayStartAbove: 50, maxDownDistance: 5000, raycaster, recursive: false, firstHitOnly: true }) ||
          setObjectOriginOnFloor(g, ground, { clearance: 4, rayStartAbove: 2000, maxDownDistance: 20000, raycaster, recursive: false, firstHitOnly: true });
        if (!ok) {
          pendingGroundSnapRef.current.push(g);
        } else {
          g.userData.groundSnapped = true;
          persistNpcPosition(g);
        }
      }
    }

    const cameraPos = cameraPosition || (camera ? camera.position : undefined);
    if (!cameraPos) return;

    for (const npcGroup of loadedNpcsRef.current.values()) {
      const sprite = npcGroup.children.find(child => child instanceof THREE.Sprite) as THREE.Sprite | undefined;
      if (sprite) {
        sprite.lookAt(cameraPos);
      }

      const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
      if (instance) {
        instance.update(delta);
      }

      const npcData = npcGroup.userData.npcData as NpcData | undefined;
      if (!npcData) continue;
      const npcId = `npc-${npcData.instanceIndex}`;
      let movedThisFrame = false;
      let locomotionMode: LocomotionMode = "idle";
      let tryingToMoveThisFrame = false;
      const shouldLogMotion = motionDebugEnabled && cavalornGroupRef.current === npcGroup;

      // Falling has priority over everything else (no locomotion, no ground glue).
      const groundForNpc = ensureWorldMesh();
      if (groundForNpc && Boolean(npcGroup.userData.isFalling)) {
        const fall = updateNpcFallY(collisionCtx, npcGroup, groundForNpc, delta, collisionConfig);
        if (fall.active) {
          movedThisFrame = movedThisFrame || fall.moved;
          locomotionMode = fall.mode;
          tryingToMoveThisFrame = true;
        } else if (fall.landed) {
          movedThisFrame = true;
          locomotionMode = "idle";
          tryingToMoveThisFrame = false;
        }
      }

      if (Boolean(npcGroup.userData.isFalling)) {
        if (instance) {
          const locomotion = npcGroup.userData.locomotion as LocomotionController | undefined;
          locomotion?.update(instance, locomotionMode, (name) => resolveNpcAnimationRef(npcData.instanceIndex, name));
        }
        const entry = allNpcsByInstanceIndexRef.current.get(npcData.instanceIndex);
        if (entry) entry.position.copy(npcGroup.position);
        continue;
      }

      const isManualCavalorn = manualControlCavalornEnabled && cavalornGroupRef.current === npcGroup;
      if (isManualCavalorn) {
        const MAX_DT = 0.05;
        const MAX_STEPS = 8;
        let remaining = Math.max(0, delta);

        for (let step = 0; step < MAX_STEPS && remaining > 0; step++) {
          const dt = Math.min(remaining, MAX_DT);
          remaining -= dt;

          const keys = manualKeysRef.current;
          const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
          const z = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
          if (x === 0 && z === 0) break;
          tryingToMoveThisFrame = true;

          camera.getWorldDirection(tmpManualForward);
          tmpManualForward.y = 0;
          if (tmpManualForward.lengthSq() < 1e-8) tmpManualForward.set(0, 0, -1);
          else tmpManualForward.normalize();

          // Right vector in Three.js: up x forward
          tmpManualRight.crossVectors(tmpManualUp, tmpManualForward).normalize();

          tmpManualDir.copy(tmpManualForward).multiplyScalar(z).addScaledVector(tmpManualRight, x);
          if (tmpManualDir.lengthSq() < 1e-8) break;
          tmpManualDir.normalize();

          const speed = manualRunToggleRef.current ? manualControlSpeeds.run : manualControlSpeeds.walk;
          let desiredX = npcGroup.position.x + tmpManualDir.x * speed * dt;
          let desiredZ = npcGroup.position.z + tmpManualDir.z * speed * dt;

          const r = applyMoveConstraint(npcGroup, desiredX, desiredZ, dt);
          if (r.moved) npcGroup.userData.lastMoveDirXZ = { x: tmpManualDir.x, z: tmpManualDir.z };

          const yaw = Math.atan2(tmpManualDir.x, tmpManualDir.z);
          tmpManualDesiredQuat.setFromAxisAngle(tmpManualUp, yaw);
          const t = 1 - Math.exp(-10 * dt);
          npcGroup.quaternion.slerp(tmpManualDesiredQuat, t);

          movedThisFrame = movedThisFrame || r.moved;
        }

        locomotionMode = movedThisFrame ? (manualRunToggleRef.current ? "run" : "walk") : "idle";
      } else {
        const mover = waypointMoverRef.current;
        const em = updateNpcEventManager(npcData.instanceIndex, npcId, npcGroup, delta, {
          mover,
          estimateAnimationDurationMs,
          getNearestWaypointDirectionQuat,
          getAnimationMeta: getAnimationMetaForNpc,
        });
        movedThisFrame = Boolean(em.moved);
        locomotionMode = em.mode ?? "idle";
        tryingToMoveThisFrame = locomotionMode !== "idle" || Boolean(mover?.getMoveState(npcId)?.done === false);
      }

      // ZenGin-like slope sliding:
      // if the ground is steeper than `maxGroundAngleRad`, the character can't walk up and will slip down,
      // playing `s_Slide` / `s_SlideB` while the slide is active.
      {
        const plane = npcGroup.userData.groundPlane as
          | { nx: number; ny: number; nz: number; px: number; py: number; pz: number; clearance: number }
          | undefined;
        const slope =
          plane && Number.isFinite(plane.ny) ? Math.acos(Math.max(-1, Math.min(1, Math.abs(plane.ny)))) : 0;
        const isSteepGround = slope > collisionConfig.maxGroundAngleRad + 1e-6;
        const shouldConsiderSlide =
          isManualCavalorn ||
          Boolean(npcGroup.userData.isScriptControlled) ||
          tryingToMoveThisFrame ||
          Boolean(npcGroup.userData.isSliding) ||
          isSteepGround;
        if (shouldConsiderSlide) {
          if (groundForNpc) {
            const s = updateNpcSlopeSlideXZ(collisionCtx, npcGroup, groundForNpc, delta, collisionConfig);
            if (s.active) {
              movedThisFrame = movedThisFrame || s.moved;
              tryingToMoveThisFrame = true;
              locomotionMode = s.mode;
            }
          }
        }
      }

      // Start falling if we stepped off a ledge (ZenGin-style).
      // Run this AFTER slide update so slide/grace state can suppress unwanted fall starts.
      if (groundForNpc) {
        const fall = updateNpcFallY(collisionCtx, npcGroup, groundForNpc, 0, collisionConfig);
        if (fall.active) {
          movedThisFrame = movedThisFrame || fall.moved;
          locomotionMode = fall.mode;
          tryingToMoveThisFrame = true;
        } else if (fall.landed) {
          movedThisFrame = true;
          locomotionMode = "idle";
          tryingToMoveThisFrame = false;
        }
      }

      if (instance) {
        const locomotion = npcGroup.userData.locomotion as LocomotionController | undefined;
        const suppress = Boolean((npcGroup.userData as any)._emSuppressLocomotion);
        const scriptIdle = ((npcGroup.userData as any)._emIdleAnimation as string | undefined) || undefined;

        // While the event-manager plays a one-shot animation, do not override it with locomotion/idle updates.
        if (!suppress) {
          if (scriptIdle && locomotionMode === "idle") {
            const ref = resolveNpcAnimationRef(npcData.instanceIndex, scriptIdle);
            instance.setAnimation(ref.animationName, { modelName: ref.modelName, loop: true, resetTime: false });
          } else {
            locomotion?.update(instance, locomotionMode, (name) => resolveNpcAnimationRef(npcData.instanceIndex, name));
          }
        }
      }

      if (shouldLogMotion) {
        const isFallingNow = Boolean(npcGroup.userData.isFalling);
        const isSlidingNow = Boolean(npcGroup.userData.isSliding);
        const last = motionDebugLastRef.current;
        const lastMode = last?.locomotionMode ?? "idle";
        const shouldEmit =
          !last || last.isFalling !== isFallingNow || last.isSliding !== isSlidingNow || lastMode !== locomotionMode;

        const nowMs = Date.now();
        const lastPeriodicAtMs = last?.lastPeriodicAtMs ?? 0;
        const shouldEmitPeriodic = (isSlidingNow || isFallingNow) && nowMs - lastPeriodicAtMs > 250;

        if (shouldEmit || shouldEmitPeriodic) {
          const payload = {
            t: nowMs,
            npcPos: { x: npcGroup.position.x, y: npcGroup.position.y, z: npcGroup.position.z },
            locomotionMode,
            isFalling: isFallingNow,
            isSliding: isSlidingNow,
            locomotionRequested: instance ? (instance as any).__debugLocomotionRequested : undefined,
            fallDbg: (npcGroup.userData as any)._fallDbg,
            slideDbg: (npcGroup.userData as any)._slideDbg,
          };
          try {
            console.log("[NPCMotionDebugJSON]" + JSON.stringify(payload));
          } catch {
            console.log("[NPCMotionDebugJSON]" + String(payload));
          }
        }

        // Throttled warning when we are falling but we can't find a floor to land on.
        const lastWarnAtMs = last?.lastWarnAtMs ?? 0;
        const floorTargetY = (npcGroup.userData as any)?._fallDbg?.floorTargetY as number | null | undefined;
        const lastWarnNext = isFallingNow && floorTargetY == null && nowMs - lastWarnAtMs > 500 ? nowMs : lastWarnAtMs;
        if (lastWarnNext !== lastWarnAtMs) {
          try {
            console.log(
              "[NPCMotionDebugJSON]" +
                JSON.stringify({
                  t: nowMs,
                  warn: "fallingNoFloorHit",
                  npcPos: { x: npcGroup.position.x, y: npcGroup.position.y, z: npcGroup.position.z },
                  fallDbg: (npcGroup.userData as any)._fallDbg,
                })
            );
          } catch {
            // ignore
          }
        }

        motionDebugLastRef.current = {
          isFalling: isFallingNow,
          isSliding: isSlidingNow,
          locomotionMode,
          lastWarnAtMs: lastWarnNext,
          lastPeriodicAtMs: shouldEmitPeriodic ? nowMs : lastPeriodicAtMs,
        };
      }

      // Keep NPCs glued to the ground while moving, and also while *trying* to move:
      // if we get blocked on stairs/walls, Y can otherwise stay stale (and we never recover).
      if ((movedThisFrame || tryingToMoveThisFrame) && !Boolean(npcGroup.userData.isFalling)) {
        // Keep moving NPCs glued to the ground (throttled) even if waypoint Y is slightly off.
        if (groundForNpc) {
          if (!groundRaycasterRef.current) groundRaycasterRef.current = new THREE.Raycaster();

          const SAMPLE_INTERVAL = 0.05; // seconds (moving NPCs only; keeps uphill stable)
          const lastSample = (npcGroup.userData.lastGroundSampleAt as number | undefined) ?? 0;
          const now = ((npcGroup.userData._clock as number | undefined) ?? 0) + delta;
          npcGroup.userData._clock = now;

          // Between raycasts, predict the ground height from the last triangle plane.
          // This makes the target change continuously on slopes instead of in 50ms steps (main source of jitter).
          const plane = npcGroup.userData.groundPlane as
            | { nx: number; ny: number; nz: number; px: number; py: number; pz: number; clearance: number }
            | undefined;
          if (plane) {
            // Only use plane prediction for reasonably "ground-like" surfaces.
            // On very steep triangles (slide/cliff walls), y=f(x,z) becomes ill-conditioned and can explode.
            const minPredictNy = Math.cos(collisionConfig.maxGroundAngleRad);
            if (Number.isFinite(plane.ny) && plane.ny >= minPredictNy) {
              const predicted = predictGroundYFromPlane(plane, npcGroup.position.x, npcGroup.position.z);
              if (predicted != null) {
                npcGroup.userData.groundYTarget = predicted;
              }
            }
          }

          if (now - lastSample >= SAMPLE_INTERVAL) {
            npcGroup.userData.lastGroundSampleAt = now;
            npcGroup.getWorldPosition(tmpGroundSampleWorldPos);
            const minWalkableNy = Math.cos(collisionConfig.maxGroundAngleRad);
            const slideEps = collisionConfig.maxSlideAngleEpsRad ?? 0;
            const minSlideNy = Math.cos(Math.min(Math.PI / 2, collisionConfig.maxSlideAngleRad + slideEps));
            const isSlidingNow = Boolean(npcGroup.userData.isSliding);
            const planeForSlope = npcGroup.userData.groundPlane as
              | { nx: number; ny: number; nz: number; px: number; py: number; pz: number; clearance: number }
              | undefined;
            const slopeNow =
              planeForSlope && Number.isFinite(planeForSlope.ny)
                ? Math.acos(Math.max(-1, Math.min(1, Math.abs(planeForSlope.ny))))
                : 0;
            const isSteepNow = slopeNow > collisionConfig.maxGroundAngleRad + 1e-6;

            // While sliding/on steep terrain, don't "prefer walkable" hits first.
            // Otherwise we may snap to a walkable floor far below the cliff and break sliding.
            const primaryMinNy = isSlidingNow || isSteepNow ? minSlideNy : minWalkableNy;
            const secondaryMinNy = isSlidingNow || isSteepNow ? null : minSlideNy < minWalkableNy ? minSlideNy : null;

            const hit =
              sampleGroundHitForMove(tmpGroundSampleWorldPos, groundForNpc, {
                clearance: 4,
                rayStartAbove: 50,
                maxDownDistance: 5000,
                preferClosestToY: tmpGroundSampleWorldPos.y,
                minHitNormalY: primaryMinNy,
              }) ||
              (secondaryMinNy != null
                ? sampleGroundHitForMove(tmpGroundSampleWorldPos, groundForNpc, {
                    clearance: 4,
                    rayStartAbove: 50,
                    maxDownDistance: 5000,
                    preferClosestToY: tmpGroundSampleWorldPos.y,
                    minHitNormalY: secondaryMinNy,
                  })
                : null);
            if (hit) {
              const targetY = hit.targetY;
              // Avoid snapping to far-away floors/ceilings (ZenGin has similar step-height gating).
              const MAX_STEP_UP = 250;
              // While sliding, avoid snapping down huge drops (we should fall instead).
              const MAX_STEP_DOWN = isSlidingNow || isSteepNow ? 250 : 800;
              const dy = targetY - tmpGroundSampleWorldPos.y;
              if (dy <= MAX_STEP_UP && dy >= -MAX_STEP_DOWN) {
                npcGroup.userData.groundPlane = {
                  nx: hit.normal.x,
                  ny: hit.normal.y,
                  nz: hit.normal.z,
                  px: hit.point.x,
                  py: hit.point.y,
                  pz: hit.point.z,
                  clearance: 4,
                };

                // Keep target in sync with the sampled hit (plane prediction will carry it between samples).
                npcGroup.userData.groundYTarget = targetY;
              } else if (dy < -MAX_STEP_DOWN) {
                // Big drop: start falling physics (ZenGin uses `aboveFloor > stepHeight`).
                npcGroup.userData.isFalling = true;
                npcGroup.userData.fallStartY = npcGroup.userData.groundYTarget ?? tmpGroundSampleWorldPos.y;
                npcGroup.userData.fallVelY = 0;
                npcGroup.userData.isSliding = false;
                npcGroup.userData.slideVelXZ = { x: 0, z: 0 };
              }
            }
          }

          const targetY = npcGroup.userData.groundYTarget as number | undefined;
          if (typeof targetY === "number") {
            smoothWorldY(npcGroup, targetY, delta);
          }
        }
        const entry = allNpcsByInstanceIndexRef.current.get(npcData.instanceIndex);
        if (entry) entry.position.copy(npcGroup.position);
      }
    }

  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (npcsGroupRef.current) {
        scene.remove(npcsGroupRef.current);
        // Dispose all NPCs
        for (const npcGroup of loadedNpcsRef.current.values()) {
          npcGroup.userData.isDisposed = true;
          const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
          const isLoading = Boolean(npcGroup.userData.modelLoading);
          if (instance && !isLoading) instance.dispose();
          disposeObject3D(npcGroup);
        }
        loadedNpcsRef.current.clear();
        npcsGroupRef.current = null;
      }
    };
  }, [scene]);

  // Component doesn't render anything directly (uses imperative scene manipulation)
  return null;
}
