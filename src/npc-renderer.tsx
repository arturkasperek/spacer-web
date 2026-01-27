import { useMemo, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { usePlayerInput } from "./player-input-context";
import * as THREE from "three";
import type { World, ZenKit } from '@kolarz3/zenkit';
import { createStreamingState, disposeObject3D } from './distance-streaming';
import type { NpcData } from './types';
import { getMapKey } from './npc-utils';
import { type CharacterCaches, type CharacterInstance } from './character/character-instance.js';
import { preloadAnimationSequences } from "./character/animation.js";
import { fetchBinaryCached } from "./character/binary-cache.js";
import { createHumanLocomotionController, HUMAN_LOCOMOTION_PRELOAD_ANIS, type LocomotionController, type LocomotionMode } from "./npc-locomotion";
import { createWaypointMover, type WaypointMover } from "./npc-waypoint-mover";
import { clearNpcFreepointReservations, setFreepointsWorld, updateNpcWorldPosition, removeNpcWorldPosition } from "./npc-freepoints";
import { clearNpcEmRuntimeState, updateNpcEventManager } from "./npc-em-runtime";
import { clearNpcEmQueueState } from "./npc-em-queue";
import { getNpcModelScriptsState } from "./npc-model-scripts";
import { ModelScriptRegistry } from "./model-script-registry";
import { NPC_RENDER_TUNING, useNpcPhysics } from "./npc-physics";
import { useWorldTime } from "./world-time";
import { createFreepointOwnerOverlay } from "./freepoint-owner-overlay";
import { buildRoutineWaybox, type Aabb } from "./npc-routine-waybox";
import { setWaynetWaypointPositions } from "./waynet-index";
import { buildNpcWorldIndices } from "./npc-world-indices";
import { computeNpcsWithPositions } from "./npc-renderer-data";
import { loadNpcCharacter as loadNpcCharacterImpl } from "./npc-character-loader";
import { updateNpcStreaming as updateNpcStreamingImpl } from "./npc-streaming";
import { tickNpcDaedalusStateLoop } from "./npc-daedalus-loop";
import { createCombatRuntime } from "./combat/combat-runtime";
import { setPlayerPoseFromObject3D } from "./player-runtime";
import { useCameraDebug } from "./camera-debug-context";

interface NpcRendererProps {
  world: World | null;
  zenKit: ZenKit | null;
  npcs: Map<number, NpcData>;
  cameraPosition?: THREE.Vector3;
  enabled?: boolean;
}

/**
 * NPC Renderer Component - renders NPCs at spawnpoint locations with ZenGin-like streaming
 * Uses imperative Three.js rendering (like VOBs) for better performance
 * 
 * Features:
 * - Looks up spawnpoints by name (waypoints first, then VOBs) - matching original engine behavior
 * - Renders NPCs as character models with name labels (falls back to green placeholder while loading)
 * - Handles coordinate conversion from Gothic to Three.js space
 * - Waybox-based streaming: loads NPCs when the camera active area intersects their routine waybox
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
  const npcsGroupRef = useRef<THREE.Group | null>(null);
  const worldTime = useWorldTime();
  const cameraDebug = useCameraDebug();
  const playerInput = usePlayerInput();
  const tmpManualForward = useMemo(() => new THREE.Vector3(), []);
  const tmpEmRootMotionWorld = useMemo(() => new THREE.Vector3(), []);
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
  const physicsFrameRef = useRef(0);
  const playerGroupRef = useRef<THREE.Group | null>(null);

  // ZenGin-like streaming (routine "wayboxes" + active-area bbox intersection)
  const loadedNpcsRef = useRef(new Map<string, THREE.Group>()); // npc id -> THREE.Group
  const { kccConfig, getNpcVisualRoot, applyMoveConstraint, trySnapNpcToGroundWithRapier, removeNpcKccCollider } =
    useNpcPhysics({ loadedNpcsRef, physicsFrameRef, playerGroupRef });

  const allNpcsRef = useRef<Array<{ npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>>([]); // All NPC data
  const allNpcsByIdRef = useRef(new Map<string, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>());
  const allNpcsByInstanceIndexRef = useRef(new Map<number, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>());
  const npcItemsRef = useRef<Array<{ id: string; waybox: Aabb }>>([]);
  const NPC_LOAD_DISTANCE = 5000; // Active-area half size in X/Z for loading
  const NPC_UNLOAD_DISTANCE = 6000; // Active-area half size in X/Z for unloading (hysteresis)
  const NPC_ACTIVE_BBOX_HALF_Y = 100000; // Effectively ignore Y for active-area checks

  // Streaming state using shared utility
  const streamingState = useRef(createStreamingState());

  // Keep arrow-key hero control available even in free camera mode.
  const manualControlHeroEnabled = true;

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

  const manualControlSpeeds = NPC_RENDER_TUNING.manualControlSpeeds;

  const freepointOwnerOverlayRef = useRef<ReturnType<typeof createFreepointOwnerOverlay> | null>(null);

  const manualKeysRef = useRef({
    up: false,
    down: false,
    left: false,
    right: false,
  });
  const manualRunToggleRef = useRef(false);
  const teleportHeroSeqRef = useRef(0);
  const teleportHeroSeqAppliedRef = useRef(0);
  const manualAttackSeqRef = useRef(0);
  const manualAttackSeqAppliedRef = useRef(0);
  const combatRuntimeRef = useRef(createCombatRuntime());

  useEffect(() => {
    if (!manualControlHeroEnabled) return;

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
        case "Space":
          if (pressed && !e.repeat) manualAttackSeqRef.current += 1;
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
  }, [manualControlHeroEnabled]);

  // Debug helper: teleport the hero in front of the camera (works in both camera modes).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyT") return;
      if (e.repeat) return;
      teleportHeroSeqRef.current += 1;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown as any);
  }, []);

  // Create a stable serialized key from the Map for dependency tracking
  const npcsKey = getMapKey(npcs);

  // Build quick lookup maps for waypoints and VOBs so routine-based positioning doesn't re-scan the whole world.
  // This is synchronous so spawnpoint/routine resolution never races the index-build effect.
  const { waypointPosIndex, waypointDirIndex, vobPosIndex, vobDirIndex } = useMemo(() => buildNpcWorldIndices(world), [world]);

  const npcRoutineWayboxIndex = useMemo(() => {
    const out = new Map<number, Aabb | null>();
    if (!world || !enabled || npcs.size === 0) return out;

    for (const [, npcData] of npcs.entries()) {
      const waybox = buildRoutineWaybox(npcData.dailyRoutine, waypointPosIndex);
      out.set(npcData.instanceIndex, waybox);
    }
    return out;
  }, [world, enabled, npcsKey, waypointPosIndex]);

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
      const scripts = getNpcModelScriptsState(npcInstanceIndex);
      const fallbackModel = (scripts?.baseScript || "HUMANS").trim().toUpperCase() || "HUMANS";
      const modelName = (meta?.model || fallbackModel).trim().toUpperCase() || fallbackModel;
      const blendInMs = Number.isFinite(meta?.blendIn) ? Math.max(0, (meta!.blendIn as number) * 1000) : undefined;
      const blendOutMs = Number.isFinite(meta?.blendOut) ? Math.max(0, (meta!.blendOut as number) * 1000) : undefined;
      return { animationName: (animationName || "").trim(), modelName, blendInMs, blendOutMs };
    };
  }, [getAnimationMetaForNpc]);

  // Convert NPC data to renderable NPCs with spawnpoint positions (only compute positions, not render)
  const npcsWithPositions = useMemo(() => {
    return computeNpcsWithPositions({
      world,
      enabled,
      npcs,
      hour: worldTime.hour,
      minute: worldTime.minute,
      npcRoutineWayboxIndex,
      waypointPosIndex,
      vobPosIndex,
      loadedNpcsRef,
    });
  }, [world, npcsKey, enabled, worldTime.hour, worldTime.minute, npcRoutineWayboxIndex, waypointPosIndex, vobPosIndex]);

  // Store NPCs with positions for streaming
  useEffect(() => {
    allNpcsRef.current = npcsWithPositions;
    const byId = new Map<string, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>();
    const byIdx = new Map<number, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>();
    const items: Array<{ id: string; waybox: Aabb }> = [];
    for (const entry of npcsWithPositions) {
      const id = `npc-${entry.npcData.instanceIndex}`;
      byId.set(id, entry);
      byIdx.set(entry.npcData.instanceIndex, entry);
      items.push({ id, waybox: entry.waybox });
      updateNpcWorldPosition(entry.npcData.instanceIndex, { x: entry.position.x, y: entry.position.y, z: entry.position.z });
    }
    allNpcsByIdRef.current = byId;
    allNpcsByInstanceIndexRef.current = byIdx;
    npcItemsRef.current = items;
    streamingState.current.isFirstUpdate.current = true;

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
      if (npcData) {
        clearNpcFreepointReservations(npcData.instanceIndex);
        removeNpcWorldPosition(npcData.instanceIndex);
        clearNpcEmRuntimeState(npcData.instanceIndex);
        clearNpcEmQueueState(npcData.instanceIndex);
        waypointMoverRef.current?.clearForNpc?.(npcId);
      }
      const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
      const isLoading = Boolean(npcGroup.userData.modelLoading);
      if (instance && !isLoading) instance.dispose();
      if (npcsGroupRef.current) npcsGroupRef.current.remove(npcGroup);
      disposeObject3D(npcGroup);
      loadedNpcsRef.current.delete(npcId);
      if (playerGroupRef.current === npcGroup) playerGroupRef.current = null;
    }
  }, [npcsWithPositions]);

  useEffect(() => {
    waypointMoverRef.current = world ? createWaypointMover(world) : null;
  }, [world]);

  useEffect(() => {
    // Expose a read-only waypoint position index to VM externals (e.g. `Npc_GetDistToWP`).
    // Keep it free of Three.js objects.
    const positions = new Map<string, { x: number; y: number; z: number }>();
    for (const [k, v] of waypointPosIndex.entries()) {
      positions.set(k, { x: v.x, y: v.y, z: v.z });
    }
    setWaynetWaypointPositions(positions);
  }, [waypointPosIndex]);

  useEffect(() => {
    freepointOwnerOverlayRef.current?.dispose();
    freepointOwnerOverlayRef.current = createFreepointOwnerOverlay(scene);
    return () => {
      freepointOwnerOverlayRef.current?.dispose();
      freepointOwnerOverlayRef.current = null;
    };
  }, [scene]);

  useEffect(() => {
    setFreepointsWorld(world);
    freepointOwnerOverlayRef.current?.onWorldChanged();
  }, [world]);


  const persistNpcPosition = (npcGroup: THREE.Group) => {
    const npcData = npcGroup.userData.npcData as NpcData | undefined;
    if (!npcData) return;
    const entry = allNpcsByInstanceIndexRef.current.get(npcData.instanceIndex);
    if (entry) entry.position.copy(npcGroup.position);
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
      [...HUMAN_LOCOMOTION_PRELOAD_ANIS, "T_1HATTACKL", "T_1HATTACKR", "T_2HATTACKL"]
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
    return loadNpcCharacterImpl(npcGroup, npcData, {
      zenKit,
      characterCachesRef,
      modelScriptRegistryRef,
      waypointMoverRef,
      getNpcVisualRoot,
    });
  };

  // Streaming NPC loader - loads/unloads based on intersection with routine wayboxes (ZenGin-like)
  const updateNpcStreaming = () => {
    return updateNpcStreamingImpl({
      enabled,
      world,
      cameraPosition,
      camera,
      streamingState,
      npcItemsRef,
      loadedNpcsRef,
      allNpcsRef,
      allNpcsByIdRef,
      npcsGroupRef,
      scene,
      kccConfig,
      applyMoveConstraint,
      trySnapNpcToGroundWithRapier,
      loadNpcCharacter,
      removeNpcKccCollider,
      waypointMoverRef,
      playerGroupRef,
      manualControlHeroEnabled,
      waypointDirIndex,
      vobDirIndex,
      NPC_LOAD_DISTANCE,
      NPC_UNLOAD_DISTANCE,
      NPC_ACTIVE_BBOX_HALF_Y,
    });
  };

  // Streaming update via useFrame
  useFrame((_state, delta) => {
    const physicsFrame = ++physicsFrameRef.current;
    if (allNpcsRef.current.length > 0) {
      updateNpcStreaming();
    }

    freepointOwnerOverlayRef.current?.update(Boolean(enabled));

    if (!enabled || loadedNpcsRef.current.size === 0) return;

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
    tickNpcDaedalusStateLoop({ loadedNpcsRef, waypointMoverRef });

    // Keep a lightweight hero pose snapshot for camera follow (no Three.js refs).
    setPlayerPoseFromObject3D(playerGroupRef.current);

    // Debug helper: teleport the hero in front of the camera.
    if (teleportHeroSeqAppliedRef.current !== teleportHeroSeqRef.current) {
      const player = playerGroupRef.current;
      const cam = camera;
      if (player && cam) {
        cam.getWorldDirection(tmpTeleportForward);
        tmpTeleportForward.y = 0;
        if (tmpTeleportForward.lengthSq() < 1e-8) tmpTeleportForward.set(0, 0, -1);
        else tmpTeleportForward.normalize();

        const TELEPORT_DISTANCE = 220;
        const targetX = cam.position.x + tmpTeleportForward.x * TELEPORT_DISTANCE;
        const targetY = cam.position.y + 50;
        const targetZ = cam.position.z + tmpTeleportForward.z * TELEPORT_DISTANCE;
        player.position.x = targetX;
        player.position.y = targetY;
        player.position.z = targetZ;

        // Face the same direction as the camera.
        const yaw = Math.atan2(tmpTeleportForward.x, tmpTeleportForward.z);
        tmpTeleportDesiredQuat.setFromAxisAngle(tmpManualUp, yaw);
        player.quaternion.copy(tmpTeleportDesiredQuat);

        player.userData._kccSnapped = false;
        player.userData._kccVy = 0;
        player.userData._kccGrounded = false;
        player.userData._kccStableGrounded = false;
        player.userData._kccGroundedFor = 0;
        player.userData._kccUngroundedFor = 0;
        player.userData._kccSlideSpeed = 0;
        player.userData.isFalling = true;
        player.userData.isSliding = false;

        persistNpcPosition(player);
        teleportHeroSeqAppliedRef.current = teleportHeroSeqRef.current;
      }
    }

    const cameraPos = cameraPosition || (camera ? camera.position : undefined);
    if (!cameraPos) return;

    for (const npcGroup of loadedNpcsRef.current.values()) {
      const visualRoot = getNpcVisualRoot(npcGroup);
      const sprite = visualRoot.children.find((child) => child instanceof THREE.Sprite) as THREE.Sprite | undefined;
      if (sprite) {
        sprite.lookAt(cameraPos);
      }

      const healthBar = (npcGroup.userData as any)?.healthBar as
        | { root?: THREE.Object3D; fill?: THREE.Object3D; width?: number; setText?: (text: string) => void }
        | undefined;
      if (healthBar?.root) {
        healthBar.root.lookAt(cameraPos);
      }

      const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
      if (instance) {
        instance.update(delta);
      }

      const npcData = npcGroup.userData.npcData as NpcData | undefined;
      if (!npcData) continue;

      if (healthBar?.root && healthBar?.fill && typeof healthBar.width === "number" && Number.isFinite(healthBar.width)) {
        const info = (npcData.npcInfo || {}) as any;
        const rawHp = Number(info.hp);
        const rawHpMax = Number(info.hpmax ?? info.hpMax);
        const hp = Number.isFinite(rawHp) ? Math.max(0, Math.floor(rawHp)) : 0;
        const hpMax = Number.isFinite(rawHpMax) ? Math.max(0, Math.floor(rawHpMax)) : 0;
        const ratio =
          hpMax > 0 ? Math.max(0, Math.min(1, hp / hpMax))
            : 1;

        const fill = healthBar.fill as any;
        if (fill?.scale) fill.scale.x = ratio;
        if (fill?.position) fill.position.x = -healthBar.width / 2 + (healthBar.width * ratio) / 2;
        if (healthBar.setText) {
          healthBar.setText(hpMax > 0 ? `${hp}/${hpMax}` : `${hp}/?`);
        }
      }

      const npcId = `npc-${npcData.instanceIndex}`;
      {
        const ud: any = npcGroup.userData ?? (npcGroup.userData = {});
        if (typeof ud.requestMeleeAttack !== "function") {
          ud.requestMeleeAttack = (opts?: any) => {
            combatRuntimeRef.current.ensureNpc(npcData);
            return combatRuntimeRef.current.requestMeleeAttack(npcData.instanceIndex, opts);
          };
        }
        if (typeof ud.getCombatState !== "function") {
          ud.getCombatState = () => combatRuntimeRef.current.getState(npcData.instanceIndex);
        }
      }
      let movedThisFrame = false;
      let locomotionMode: LocomotionMode = "idle";
      const runtimeMotionDebug = typeof window !== "undefined" && Boolean((window as any).__npcMotionDebug);
      const shouldLogMotion = runtimeMotionDebug && playerGroupRef.current === npcGroup;
      trySnapNpcToGroundWithRapier(npcGroup);

	      const isManualHero = manualControlHeroEnabled && playerGroupRef.current === npcGroup;
	      if (isManualHero) {
        let pendingMouseYawRad = 0;
        const dDeg = playerInput.consumeMouseYawDelta();
        if (Number.isFinite(dDeg) && dDeg !== 0) {
          pendingMouseYawRad = (dDeg * Math.PI) / 180;
        }
        const nowMs = Date.now();

        if (manualAttackSeqAppliedRef.current !== manualAttackSeqRef.current) {
          manualAttackSeqAppliedRef.current = manualAttackSeqRef.current;
          combatRuntimeRef.current.ensureNpc(npcData);
          const ok = combatRuntimeRef.current.requestMeleeAttack(npcData.instanceIndex, { kind: "left" });
          if (!ok) {
            try {
              const st = combatRuntimeRef.current.getState(npcData.instanceIndex);
              console.warn("[combat] melee attack request rejected", { npc: npcData.instanceIndex, state: st });
            } catch {
              // ignore
            }
          } else {
            // Start the attack animation immediately (hit resolution is still done in the global combat update).
            combatRuntimeRef.current.update({
              nowMs: Date.now(),
              dtSeconds: 0,
              loadedNpcs: [npcGroup],
              resolveAnim: resolveNpcAnimationRef,
            });
          }
        }

        const MAX_DT = 0.05;
        const MAX_STEPS = 8;
        let remaining = Math.max(0, delta);

        const manualUd: any = npcGroup.userData ?? (npcGroup.userData = {});
        const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
        const wantLean = true;
        let didTurnInPlaceThisFrame = false;
        let lastTurnSign = 0;

        const mouseYawRate = pendingMouseYawRad / Math.max(1e-6, Math.max(0, delta));

        for (let step = 0; step < MAX_STEPS && remaining > 0; step++) {
          const dt = Math.min(remaining, MAX_DT);
          remaining -= dt;

          const keys = manualKeysRef.current;
          const mouseYawThisStep = mouseYawRate * dt;
          // In Gothic: ArrowRight turns right (clockwise when looking from above).
          const turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
          const move = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
          if (turn === 0 && move === 0 && Math.abs(mouseYawThisStep) < 1e-6) break;

          // Gothic-like manual controls:
          // - ArrowLeft/ArrowRight: turn in place (and lean slightly when moving)
          // - ArrowUp/ArrowDown: move forward/back along current facing
          tmpManualForward.set(0, 0, 1).applyQuaternion(npcGroup.quaternion);
          tmpManualForward.y = 0;
          if (tmpManualForward.lengthSq() < 1e-8) tmpManualForward.set(0, 0, 1);
          else tmpManualForward.normalize();

          const currentYaw = Math.atan2(tmpManualForward.x, tmpManualForward.z);
          // OpenGothic-like manual turn speed: 90 deg/s, with optional debug override.
          const baseTurnSpeedDeg = 90;
          const turnSpeedDeg = cameraDebug.state.heroTurnSpeedOverrideDeg ?? baseTurnSpeedDeg;
          const turnSpeed = (turnSpeedDeg * Math.PI) / 180; // rad/sec
          const desiredYaw = currentYaw + turn * turnSpeed * dt + mouseYawThisStep;
          tmpManualDesiredQuat.setFromAxisAngle(tmpManualUp, desiredYaw);
          // Apply rotation directly (no extra smoothing), so turning speed matches intended rate.
          npcGroup.quaternion.copy(tmpManualDesiredQuat);

          // Recompute forward after rotation update for movement integration.
          tmpManualForward.set(0, 0, 1).applyQuaternion(npcGroup.quaternion);
          tmpManualForward.y = 0;
          if (tmpManualForward.lengthSq() < 1e-8) tmpManualForward.set(0, 0, 1);
          else tmpManualForward.normalize();

          const speed = manualRunToggleRef.current ? manualControlSpeeds.run : manualControlSpeeds.walk;
          let desiredX = npcGroup.position.x;
          let desiredZ = npcGroup.position.z;
          if (move !== 0) {
            desiredX += tmpManualForward.x * speed * dt * move;
            desiredZ += tmpManualForward.z * speed * dt * move;
          }

          const r = applyMoveConstraint(npcGroup, desiredX, desiredZ, dt);
          if (r.moved) npcGroup.userData.lastMoveDirXZ = { x: tmpManualForward.x * move, z: tmpManualForward.z * move };

          movedThisFrame = movedThisFrame || r.moved;

          if (move === 0 && (turn !== 0 || Math.abs(mouseYawThisStep) >= 1e-6)) {
            didTurnInPlaceThisFrame = true;
            lastTurnSign = turn !== 0 ? turn : (mouseYawThisStep < 0 ? -1 : 1);
            (manualUd as any)._manualLastTurnAtMs = nowMs;
            (manualUd as any)._manualLastTurnSign = lastTurnSign;
          }
        }

	        // Procedural lean while turning (Gothic-like "bank" into the turn).
	        // Note: this is purely visual (model tilt), not physics.
        if (wantLean && instance?.object) {
          const keys = manualKeysRef.current;
          const turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
          const move = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
          const maxLeanRad = manualRunToggleRef.current ? 0.17 : 0.12; // ~10deg / ~7deg
          const targetRoll = move !== 0 ? -turn * maxLeanRad : 0;

          let roll = manualUd._manualLeanRoll as number | undefined;
          if (typeof roll !== "number" || !Number.isFinite(roll)) roll = 0;
          const k = 1 - Math.exp(-14 * Math.max(0, delta));
          roll = roll + (targetRoll - roll) * k;
          manualUd._manualLeanRoll = roll;

	          // Apply only to the visual model so UI (name/HP) doesn't tilt.
	          instance.object.rotation.z = roll;
	        }

	        const keysNow = manualKeysRef.current;
	        const turnNow = (keysNow.left ? 1 : 0) - (keysNow.right ? 1 : 0);
	        const moveNow = (keysNow.up ? 1 : 0) - (keysNow.down ? 1 : 0);
	        const manualLocomotionMode: LocomotionMode = moveNow !== 0 ? (manualRunToggleRef.current ? "run" : "walk") : "idle";

	        // Turn-in-place animation (Gothic/Zengin uses dedicated turn animations).
	        // Keep this separate from `_emSuppressLocomotion` used by combat and script one-shots.
	        if (instance) {
	          const suppressByCombatOrScript = Boolean((npcGroup.userData as any)._emSuppressLocomotion);
	          const wasTurning = Boolean((manualUd as any)._manualWasTurningInPlace);
            const lastTurnAtMs = Number((manualUd as any)._manualLastTurnAtMs);
            const graceMs = 300;
            const withinGrace =
              moveNow === 0 && Number.isFinite(lastTurnAtMs) && (nowMs - lastTurnAtMs) >= 0 && (nowMs - lastTurnAtMs) < graceMs;
            const shouldTurnAnim = moveNow === 0 && (didTurnInPlaceThisFrame || withinGrace);
            (manualUd as any)._manualWasTurningInPlace = shouldTurnAnim;

	          if (shouldTurnAnim && !suppressByCombatOrScript) {
	            (manualUd as any)._manualSuppressLocomotion = true;
              const signFromHistory = Number((manualUd as any)._manualLastTurnSign);
              const effSign = didTurnInPlaceThisFrame
                ? lastTurnSign
                : (Number.isFinite(signFromHistory) && signFromHistory !== 0 ? signFromHistory : lastTurnSign || 1);
	            const rightTurn = effSign < 0;

            // Use actual human anim names present in `/ANIMS/_COMPILED` (no `S_TURN*` in the base set).
            const name = rightTurn ? "t_RunTurnR" : "t_RunTurnL";
            const prev = (manualUd as any)._manualTurnAnim as string | undefined;
            (manualUd as any)._manualTurnAnim = name;

	            if ((prev || "").toUpperCase() !== name.toUpperCase()) {
                const ref = resolveNpcAnimationRef(npcData.instanceIndex, name);
                instance.setAnimation(name, {
                  modelName: ref.modelName,
                  loop: true,
                  resetTime: true,
                  blendInMs: ref.blendInMs,
                  blendOutMs: ref.blendOutMs,
                  fallbackNames: [
	                  rightTurn ? "t_WalkwTurnR" : "t_WalkwTurnL",
	                  rightTurn ? "t_SneakTurnR" : "t_SneakTurnL",
	                  "s_Run",
	                ],
	              });
	            }
	          } else {
	            delete (manualUd as any)._manualSuppressLocomotion;
	            delete (manualUd as any)._manualTurnAnim;

	            // When we stop turning:
	            // - if we start moving this frame (even while holding turn), force locomotion to re-apply so we
	            //   don't end up sliding with an idle/turn pose due to locomotion state being stale.
	            // - otherwise restore idle immediately.
	            if (wasTurning && !suppressByCombatOrScript) {
	              if (manualLocomotionMode !== "idle") {
	                const fresh = createHumanLocomotionController();
	                npcGroup.userData.locomotion = fresh;
	                fresh.update(instance, manualLocomotionMode, (name) => resolveNpcAnimationRef(npcData.instanceIndex, name));
	              } else if (moveNow === 0 && turnNow === 0) {
                  const ref = resolveNpcAnimationRef(npcData.instanceIndex, "s_Run");
	                instance.setAnimation("s_Run", {
                    modelName: ref.modelName,
                    loop: true,
                    resetTime: true,
                    blendInMs: ref.blendInMs,
                    blendOutMs: ref.blendOutMs,
                    fallbackNames: ["s_Run"],
                  });
	              }
	            }
	          }
	        }

	        locomotionMode = manualLocomotionMode;
	      } else {
        const mover = waypointMoverRef.current;
        const em = updateNpcEventManager(npcData.instanceIndex, npcId, npcGroup, delta, {
          mover,
          estimateAnimationDurationMs,
          getNearestWaypointDirectionQuat,
          getAnimationMeta: getAnimationMetaForNpc,
          getFallbackAnimationModelName: (idx) => getNpcModelScriptsState(idx).baseScript,
        });
        movedThisFrame = Boolean(em.moved);
        locomotionMode = em.mode ?? "idle";
      }

      // Apply animation root motion during script-driven one-shot animations (AI_PlayAni / Npc_PlayAni).
      // This makes e.g. dance/attack "step" animations move the NPC like in the original engine.
      if (!isManualHero && instance && Boolean((npcGroup.userData as any)._emSuppressLocomotion)) {
        const d = (instance.object as any)?.userData?.__rootMotionDelta as { x: number; y: number; z: number } | undefined;
        if (d && (Math.abs(d.x) > 1e-6 || Math.abs(d.z) > 1e-6)) {
          tmpEmRootMotionWorld.set(d.x, 0, d.z).applyQuaternion(npcGroup.quaternion);
          const desiredX = npcGroup.position.x + tmpEmRootMotionWorld.x;
          const desiredZ = npcGroup.position.z + tmpEmRootMotionWorld.z;
          const r = applyMoveConstraint(npcGroup, desiredX, desiredZ, delta);
          if (r.moved) {
            const lenSq = tmpEmRootMotionWorld.x * tmpEmRootMotionWorld.x + tmpEmRootMotionWorld.z * tmpEmRootMotionWorld.z;
            if (lenSq > 1e-8) {
              const inv = 1 / Math.sqrt(lenSq);
              npcGroup.userData.lastMoveDirXZ = { x: tmpEmRootMotionWorld.x * inv, z: tmpEmRootMotionWorld.z * inv };
            }
          }
          movedThisFrame = movedThisFrame || r.moved;
        }
      }

      // Ensure KCC is stepped at least once per frame for gravity/snap-to-ground,
      // even if scripts didn't request any movement this tick.
      if ((npcGroup.userData as any)._kccLastFrame !== physicsFrame) {
        applyMoveConstraint(npcGroup, npcGroup.position.x, npcGroup.position.z, delta);
      }

		      // Falling has priority over ground locomotion animations.
		      if (Boolean(npcGroup.userData.isFalling)) {
		        const ud: any = npcGroup.userData ?? (npcGroup.userData = {});
		        const wasFalling = Boolean(ud._wasFalling);
		        ud._wasFalling = true;
		        // Distance-based fallDown like ZenGin: switch after a vertical drop threshold.
		        const yNow = npcGroup.position.y;
		        let startY = (ud._fallDownStartY as number | undefined);
		        let minY = (ud._fallDownMinY as number | undefined);
		        if (!wasFalling || typeof startY !== "number" || !Number.isFinite(startY)) startY = yNow;
		        if (!wasFalling || typeof minY !== "number" || !Number.isFinite(minY)) minY = yNow;
		        if (yNow < minY) minY = yNow;
		        const distY = Math.max(0, startY - minY);
		        ud._fallDownStartY = startY;
		        ud._fallDownMinY = minY;
		        ud._fallDownDistY = distY;
		        ud._fallAnimT = 0;
		        locomotionMode = distY < (kccConfig.fallDownHeight ?? 0) - 1e-6 ? "fallDown" : "fall";
		      }
	      // Sliding has priority over walk/run/idle (but not over falling).
	      else if (Boolean(npcGroup.userData.isSliding)) {
	        (npcGroup.userData as any)._wasFalling = false;
	        (npcGroup.userData as any)._fallAnimT = 0;
	        (npcGroup.userData as any)._fallDownStartY = undefined;
	        (npcGroup.userData as any)._fallDownMinY = undefined;
	        (npcGroup.userData as any)._fallDownDistY = 0;
	        locomotionMode = "slide";
	      } else {
	        (npcGroup.userData as any)._wasFalling = false;
	        (npcGroup.userData as any)._fallAnimT = 0;
	        (npcGroup.userData as any)._fallDownStartY = undefined;
	        (npcGroup.userData as any)._fallDownMinY = undefined;
	        (npcGroup.userData as any)._fallDownDistY = 0;
	      }

      if (instance) {
        const locomotion = npcGroup.userData.locomotion as LocomotionController | undefined;
        const suppress = Boolean((npcGroup.userData as any)._emSuppressLocomotion) || Boolean((npcGroup.userData as any)._manualSuppressLocomotion);
        const scriptIdle = ((npcGroup.userData as any)._emIdleAnimation as string | undefined) || undefined;

        // While the event-manager plays a one-shot animation, do not override it with locomotion/idle updates.
        if (!suppress) {
          if (scriptIdle && locomotionMode === "idle") {
            const ref = resolveNpcAnimationRef(npcData.instanceIndex, scriptIdle);
            instance.setAnimation(ref.animationName, {
              modelName: ref.modelName,
              loop: true,
              resetTime: false,
              blendInMs: ref.blendInMs,
              blendOutMs: ref.blendOutMs,
            });
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
        const periodicMs = runtimeMotionDebug ? 100 : 250;
        const shouldEmitPeriodic = (runtimeMotionDebug || isSlidingNow || isFallingNow) && nowMs - lastPeriodicAtMs > periodicMs;

        if (shouldEmit || shouldEmitPeriodic) {
          const payload = {
            t: nowMs,
            npcPos: { x: npcGroup.position.x, y: npcGroup.position.y, z: npcGroup.position.z },
            locomotionMode,
            isFalling: isFallingNow,
            isSliding: isSlidingNow,
            kcc: (npcGroup.userData as any)._kccDbg,
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

    }

    // Combat update after movement tick: for now only melee hit resolution for loaded NPCs.
    combatRuntimeRef.current.update({
      nowMs: Date.now(),
      dtSeconds: Math.max(0, delta),
      loadedNpcs: loadedNpcsRef.current.values(),
      resolveAnim: resolveNpcAnimationRef,
    });
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setPlayerPoseFromObject3D(null);
      if (npcsGroupRef.current) {
        scene.remove(npcsGroupRef.current);
        // Dispose all NPCs
        for (const npcGroup of loadedNpcsRef.current.values()) {
          npcGroup.userData.isDisposed = true;
          removeNpcKccCollider(npcGroup);
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
