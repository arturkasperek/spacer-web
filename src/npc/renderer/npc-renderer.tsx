import { useMemo, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { usePlayerInput } from "../../player/player-input-context";
import * as THREE from "three";
import type { World, ZenKit } from "@kolarz3/zenkit";
import { createStreamingState, disposeObject3D } from "../../world/distance-streaming";
import type { NpcData } from "../../shared/types";
import { getMapKey } from "../data/npc-utils";
import { type CharacterCaches } from "../../character/character-instance";
import { preloadAnimationSequences } from "../../character/animation";
import { AssetManager } from "../../shared/asset-manager";
import { HUMAN_LOCOMOTION_PRELOAD_ANIS, type LocomotionMode } from "../physics/npc-locomotion";
import { createWaypointMover, type WaypointMover } from "../navigation/npc-waypoint-mover";
import {
  clearNpcFreepointReservations,
  setFreepointsWorld,
  updateNpcWorldPosition,
  removeNpcWorldPosition,
} from "../world/npc-freepoints";
import { clearNpcEmRuntimeState } from "../combat/npc-em-runtime";
import { clearNpcEmQueueState } from "../combat/npc-em-queue";
import { ModelScriptRegistry } from "../../shared/model-script-registry";
import { NPC_RENDER_TUNING, useNpcPhysics } from "../physics/npc-physics";
import { useWorldTime } from "../../world/world-time";
import { createFreepointOwnerOverlay } from "../../world/freepoint-owner-overlay";
import { buildRoutineWaybox, type Aabb } from "../world/npc-routine-waybox";
import { setWaynetWaypointPositions } from "../../waynet/waynet-index";
import { buildNpcWorldIndices } from "../world/npc-world-indices";
import { computeNpcsWithPositions } from "./npc-renderer-data";
import { loadNpcCharacter as loadNpcCharacterImpl } from "./npc-character-loader";
import { setPlayerPoseFromObject3D } from "../../player/player-runtime";
import { createTickNpc } from "./npc-tick-npc";
import { getNpcRuntimeId } from "./npc-renderer-utils";
import { useNpcManualControl } from "./hooks/use-npc-manual-control";
import { useNpcAnimationState } from "./hooks/use-npc-animation-state";
import { useNpcCombatTick } from "./hooks/use-npc-combat-tick";
import { useNpcStreaming } from "./hooks/use-npc-streaming";
import { NpcPhysicsWorkerClient } from "../physics/npc-physics-worker-client";
import type { NpcIntent } from "../physics/npc-physics-worker-protocol";
import { writeNpcPhysicsStateToGroup } from "../physics/npc-physics-main-adapter";
import {
  type FrameContext,
  tickCombatStage,
  tickScriptsStage,
  tickStreamingStage,
  tickTeleportDebugStage,
  tickWorldSyncStage,
} from "./npc-frame-stages";
import { createJumpDebugTextSprite } from "./npc-jump-debug-label";
import {
  clearNpcRuntimeValue,
  ensureNpcUserData,
  getNpcRuntimeValue,
  setNpcRuntimeValue,
} from "./npc-runtime-state";

export interface NpcRendererProps {
  world: World | null;
  zenKit: ZenKit | null;
  npcs: Map<number, NpcData>;
  cameraPosition?: THREE.Vector3;
  enabled?: boolean;
  showKccCapsule?: boolean;
  showGroundProbeRay?: boolean;
  showJumpDebugRange?: boolean;
  hideHero?: boolean;
  worldColliderData?: { vertices: Float32Array; indices: Uint32Array } | null;
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
export function NpcRenderer({
  world,
  zenKit,
  npcs,
  cameraPosition,
  enabled = true,
  showKccCapsule = false,
  showGroundProbeRay = false,
  showJumpDebugRange = false,
  hideHero = false,
  worldColliderData = null,
}: NpcRendererProps) {
  const { scene, camera } = useThree();
  const NPC_WORKER_INTERPOLATION_DELAY_MS = 16;
  const NPC_WORKER_AUTHORITATIVE = true;
  const npcsGroupRef = useRef<THREE.Group | null>(null);
  const worldTime = useWorldTime();
  const playerInput = usePlayerInput();
  const tmpManualForward = useMemo(() => new THREE.Vector3(), []);
  const tmpEmRootMotionWorld = useMemo(() => new THREE.Vector3(), []);
  const tmpManualDesiredQuat = useMemo(() => new THREE.Quaternion(), []);
  const tmpManualUp = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const tmpTeleportForward = useMemo(() => new THREE.Vector3(), []);
  const tmpTeleportDesiredQuat = useMemo(() => new THREE.Quaternion(), []);
  const characterAssetManager = useMemo(() => new AssetManager(), []);
  const characterCachesRef = useRef<CharacterCaches>({
    assetManager: characterAssetManager,
  });
  const modelScriptRegistryRef = useRef<ModelScriptRegistry | null>(null);
  const didPreloadAnimationsRef = useRef(false);
  const waypointMoverRef = useRef<WaypointMover | null>(null);
  const physicsFrameRef = useRef(0);
  const playerGroupRef = useRef<THREE.Group | null>(null);
  const npcPhysicsWorkerClientRef = useRef<NpcPhysicsWorkerClient | null>(null);
  const workerFrameIntentsRef = useRef<Map<string, NpcIntent>>(new Map());
  const workerLogicPositionRef = useRef<Map<string, THREE.Vector3>>(new Map());
  const workerKnownNpcIdsRef = useRef<Set<string>>(new Set());
  const workerWorldGeometrySentRef = useRef(false);

  // ZenGin-like streaming (routine "wayboxes" + active-area bbox intersection)
  const loadedNpcsRef = useRef(new Map<string, THREE.Group>()); // npc id -> THREE.Group
  const {
    kccConfig,
    getNpcVisualRoot,
    applyMoveConstraint,
    trySnapNpcToGroundWithRapier,
    removeNpcKccCollider,
  } = useNpcPhysics({
    loadedNpcsRef,
    physicsFrameRef,
    playerGroupRef,
    showKccCapsule,
    showGroundProbeRay,
    showJumpDebugRange,
  });

  useEffect(() => {
    if (!enabled) {
      workerKnownNpcIdsRef.current.clear();
      npcPhysicsWorkerClientRef.current?.stop();
      npcPhysicsWorkerClientRef.current = null;
      workerWorldGeometrySentRef.current = false;
      return;
    }
    const client = new NpcPhysicsWorkerClient();
    client.start();
    npcPhysicsWorkerClientRef.current = client;
    workerWorldGeometrySentRef.current = false;
    return () => {
      workerKnownNpcIdsRef.current.clear();
      client.stop();
      if (npcPhysicsWorkerClientRef.current === client) npcPhysicsWorkerClientRef.current = null;
      workerWorldGeometrySentRef.current = false;
    };
  }, [enabled]);

  useEffect(() => {
    workerWorldGeometrySentRef.current = false;
  }, [world]);
  useEffect(() => {
    workerWorldGeometrySentRef.current = false;
  }, [worldColliderData]);

  const allNpcsRef = useRef<Array<{ npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>>([]); // All NPC data
  const allNpcsByIdRef = useRef(
    new Map<string, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>(),
  );
  const npcItemsRef = useRef<Array<{ id: string; waybox: Aabb }>>([]);
  const NPC_LOAD_DISTANCE = 5000; // Active-area half size in X/Z for loading
  const NPC_UNLOAD_DISTANCE = 6000; // Active-area half size in X/Z for unloading (hysteresis)
  const NPC_ACTIVE_BBOX_HALF_Y = 100000; // Effectively ignore Y for active-area checks

  // Streaming state using shared utility
  const streamingState = useRef(createStreamingState());

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

  const freepointOwnerOverlayRef = useRef<ReturnType<typeof createFreepointOwnerOverlay> | null>(
    null,
  );

  const {
    manualControlHeroEnabled,
    manualKeysRef,
    manualRunToggleRef,
    teleportHeroSeqRef,
    teleportHeroSeqAppliedRef,
    manualAttackSeqRef,
    manualAttackSeqAppliedRef,
    manualJumpSeqRef,
    manualJumpSeqAppliedRef,
  } = useNpcManualControl();

  const { combatRuntimeRef, attachCombatBindings, runCombatTick } = useNpcCombatTick();

  const ensureJumpDebugLabel = (npcGroup: THREE.Group) => {
    const ud = ensureNpcUserData(npcGroup);
    let root = getNpcRuntimeValue(ud, "jumpDebugLabelRoot") as THREE.Group | undefined;
    let setText = getNpcRuntimeValue(ud, "jumpDebugLabelSetText");
    if (!root || !setText) {
      const visualRoot = ud.visualRoot ?? npcGroup;
      const label = createJumpDebugTextSprite("jump_debug");
      root = new THREE.Group();
      root.name = "jump-debug-label-root";
      root.position.set(0, 178, 0);
      root.add(label.sprite);
      visualRoot.add(root);
      setNpcRuntimeValue(ud, "jumpDebugLabelRoot", root);
      setNpcRuntimeValue(ud, "jumpDebugLabelSetText", label.setText);
      setText = label.setText;
    }
    return { root, setText };
  };

  // Create a stable serialized key from the Map for dependency tracking
  const npcsKey = getMapKey(npcs);

  // Build quick lookup maps for waypoints and VOBs so routine-based positioning doesn't re-scan the whole world.
  // This is synchronous so spawnpoint/routine resolution never races the index-build effect.
  const { waypointPosIndex, waypointDirIndex, vobPosIndex, vobDirIndex } = useMemo(
    () => buildNpcWorldIndices(world),
    [world],
  );

  const npcRoutineWayboxIndex = useMemo(() => {
    const out = new Map<number, Aabb | null>();
    if (!world || !enabled || npcs.size === 0) return out;

    for (const [npcRuntimeId, npcData] of npcs.entries()) {
      const waybox = buildRoutineWaybox(npcData.dailyRoutine, waypointPosIndex);
      out.set(npcRuntimeId, waybox);
    }
    return out;
  }, [world, enabled, npcsKey, waypointPosIndex]);

  const {
    estimateAnimationDurationMs,
    getNearestWaypointDirectionQuat,
    getAnimationMetaForNpc,
    resolveNpcAnimationRef,
  } = useNpcAnimationState({
    characterCachesRef,
    modelScriptRegistryRef,
    waypointPosIndex,
    waypointDirIndex,
  });

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
  }, [
    world,
    npcsKey,
    enabled,
    worldTime.hour,
    worldTime.minute,
    npcRoutineWayboxIndex,
    waypointPosIndex,
    vobPosIndex,
  ]);

  // Store NPCs with positions for streaming
  useEffect(() => {
    allNpcsRef.current = npcsWithPositions;
    const byId = new Map<string, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>();
    const items: Array<{ id: string; waybox: Aabb }> = [];
    for (const entry of npcsWithPositions) {
      const id = getNpcRuntimeId(entry.npcData);
      byId.set(id, entry);
      items.push({ id, waybox: entry.waybox });
      updateNpcWorldPosition(entry.npcData.instanceIndex, {
        x: entry.position.x,
        y: entry.position.y,
        z: entry.position.z,
      });
    }
    allNpcsByIdRef.current = byId;
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
      const ud = ensureNpcUserData(npcGroup);
      ud.isDisposed = true;
      const npcData = ud.npcData;
      if (npcData) {
        clearNpcFreepointReservations(npcData.instanceIndex);
        removeNpcWorldPosition(npcData.instanceIndex);
        clearNpcEmRuntimeState(npcData.instanceIndex);
        clearNpcEmQueueState(npcData.instanceIndex);
        waypointMoverRef.current?.clearForNpc?.(npcId);
      }
      const instance = ud.characterInstance;
      const isLoading = Boolean(ud.modelLoading);
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
    const ud = ensureNpcUserData(npcGroup);
    const npcId = ud.npcId as string | undefined;
    if (!npcId) return;
    const entry = allNpcsByIdRef.current.get(npcId);
    if (entry) entry.position.copy(npcGroup.position);
  };

  useEffect(() => {
    if (!enabled) return;
    if (!zenKit) return;
    if (didPreloadAnimationsRef.current) return;
    didPreloadAnimationsRef.current = true;

    void preloadAnimationSequences(zenKit, characterCachesRef.current.assetManager, "HUMANS", [
      ...HUMAN_LOCOMOTION_PRELOAD_ANIS,
      "T_STAND_2_JUMP",
      "T_RUNL_2_JUMP",
      "S_JUMP",
      "T_JUMP_2_STAND",
      "S_HANG",
      "T_HANG_2_STAND",
      "T_1HATTACKL",
      "T_1HATTACKR",
      "T_2HATTACKL",
    ]);
  }, [enabled, zenKit]);

  useEffect(() => {
    if (enabled) return;
    setPlayerPoseFromObject3D(null);
    if (!npcsGroupRef.current) return;
    for (const [npcId, npcGroup] of loadedNpcsRef.current.entries()) {
      const ud = ensureNpcUserData(npcGroup);
      ud.isDisposed = true;
      clearNpcRuntimeValue(ud, "jumpDebugLabelRoot");
      clearNpcRuntimeValue(ud, "jumpDebugLabelSetText");
      removeNpcKccCollider(npcGroup);
      const npcData = ud.npcData;
      if (npcData) {
        clearNpcFreepointReservations(npcData.instanceIndex);
        removeNpcWorldPosition(npcData.instanceIndex);
        clearNpcEmRuntimeState(npcData.instanceIndex);
        clearNpcEmQueueState(npcData.instanceIndex);
        waypointMoverRef.current?.clearForNpc?.(npcId);
      }
      const instance = ud.characterInstance;
      const isLoading = Boolean(ud.modelLoading);
      if (instance && !isLoading) instance.dispose();
      npcsGroupRef.current.remove(npcGroup);
      disposeObject3D(npcGroup);
      if (playerGroupRef.current === npcGroup) playerGroupRef.current = null;
    }
    loadedNpcsRef.current.clear();
  }, [enabled, removeNpcKccCollider]);

  useEffect(() => {
    if (!zenKit) return;
    if (modelScriptRegistryRef.current) return;
    modelScriptRegistryRef.current = new ModelScriptRegistry({
      zenKit,
      fetchBinary: (url: string) => characterCachesRef.current.assetManager.fetchBinary(url),
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

  const updateNpcStreaming = useNpcStreaming({
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
    npcLoadDistance: NPC_LOAD_DISTANCE,
    npcUnloadDistance: NPC_UNLOAD_DISTANCE,
    npcActiveBboxHalfY: NPC_ACTIVE_BBOX_HALF_Y,
  });

  const resolveFrameCameraPos = () => cameraPosition || (camera ? camera.position : undefined);
  const isWorkerDrivenNpc = (npcGroup: THREE.Group) =>
    NPC_WORKER_AUTHORITATIVE && playerGroupRef.current !== npcGroup;
  const restoreWorkerLogicPositions = () => {
    const loaded = loadedNpcsRef.current;
    const logicPos = workerLogicPositionRef.current;
    for (const [npcId, npcGroup] of loaded.entries()) {
      if (!isWorkerDrivenNpc(npcGroup)) {
        logicPos.delete(npcId);
        continue;
      }
      const p = logicPos.get(npcId);
      if (!p) continue;
      npcGroup.position.copy(p);
    }
    for (const npcId of logicPos.keys()) {
      if (!loaded.has(npcId)) logicPos.delete(npcId);
    }
  };
  const captureWorkerLogicPositions = () => {
    const loaded = loadedNpcsRef.current;
    const logicPos = workerLogicPositionRef.current;
    for (const [npcId, npcGroup] of loaded.entries()) {
      if (!isWorkerDrivenNpc(npcGroup)) {
        logicPos.delete(npcId);
        continue;
      }
      const existing = logicPos.get(npcId);
      if (existing) existing.copy(npcGroup.position);
      else logicPos.set(npcId, npcGroup.position.clone());
    }
  };
  const syncWorkerNpcMembership = () => {
    if (!NPC_WORKER_AUTHORITATIVE) return;
    const client = npcPhysicsWorkerClientRef.current;
    const loaded = loadedNpcsRef.current;
    const currentWorkerNpcIds = new Set<string>();
    for (const [npcId, npcGroup] of loaded.entries()) {
      const ud = ensureNpcUserData(npcGroup);
      const workerDriven = isWorkerDrivenNpc(npcGroup);
      setNpcRuntimeValue(ud, "workerAuthoritative", workerDriven);
      if (!workerDriven) {
        clearNpcRuntimeValue(ud, "workerStateAtMs");
        continue;
      }
      currentWorkerNpcIds.add(npcId);
    }
    const removedNpcIds: string[] = [];
    for (const npcId of workerKnownNpcIdsRef.current) {
      if (!currentWorkerNpcIds.has(npcId)) removedNpcIds.push(npcId);
    }
    if (client && removedNpcIds.length > 0) {
      client.removeNpcs(removedNpcIds);
    }
    workerKnownNpcIdsRef.current = currentWorkerNpcIds;
  };
  const applyWorkerStateInterpolated = (
    npcGroup: THREE.Group,
    prev: {
      px: number;
      py: number;
      pz: number;
      vx: number;
      vy: number;
      vz: number;
      grounded: boolean;
      falling: boolean;
      sliding: boolean;
      jumpActive: boolean;
    },
    next: {
      px: number;
      py: number;
      pz: number;
      vx: number;
      vy: number;
      vz: number;
      grounded: boolean;
      falling: boolean;
      sliding: boolean;
      jumpActive: boolean;
    },
    alpha: number,
  ) => {
    const a = THREE.MathUtils.clamp(alpha, 0, 1);
    writeNpcPhysicsStateToGroup(npcGroup, {
      px: prev.px + (next.px - prev.px) * a,
      py: prev.py + (next.py - prev.py) * a,
      pz: prev.pz + (next.pz - prev.pz) * a,
      vx: prev.vx + (next.vx - prev.vx) * a,
      vy: prev.vy + (next.vy - prev.vy) * a,
      vz: prev.vz + (next.vz - prev.vz) * a,
      grounded: a < 0.5 ? prev.grounded : next.grounded,
      falling: a < 0.5 ? prev.falling : next.falling,
      sliding: a < 0.5 ? prev.sliding : next.sliding,
      jumpActive: a < 0.5 ? prev.jumpActive : next.jumpActive,
    });
    const ud = ensureNpcUserData(npcGroup);
    setNpcRuntimeValue(ud, "workerAuthoritative", true);
    setNpcRuntimeValue(ud, "workerStateAtMs", performance.now());
  };
  const applyWorkerStateLatest = (
    npcGroup: THREE.Group,
    latest: {
      px: number;
      py: number;
      pz: number;
      vx: number;
      vy: number;
      vz: number;
      grounded: boolean;
      falling: boolean;
      sliding: boolean;
      jumpActive: boolean;
    },
  ) => {
    writeNpcPhysicsStateToGroup(npcGroup, {
      px: latest.px,
      py: latest.py,
      pz: latest.pz,
      vx: latest.vx,
      vy: latest.vy,
      vz: latest.vz,
      grounded: latest.grounded,
      falling: latest.falling,
      sliding: latest.sliding,
      jumpActive: latest.jumpActive,
    });
    const ud = ensureNpcUserData(npcGroup);
    setNpcRuntimeValue(ud, "workerAuthoritative", true);
    setNpcRuntimeValue(ud, "workerStateAtMs", performance.now());
  };

  const applyMoveConstraintForTick = (
    npcGroup: THREE.Group,
    desiredX: number,
    desiredZ: number,
    deltaSeconds: number,
  ) => {
    if (!isWorkerDrivenNpc(npcGroup)) {
      return applyMoveConstraint(npcGroup, desiredX, desiredZ, deltaSeconds);
    }

    const npcData = (npcGroup.userData as any)?.npcData as NpcData | undefined;
    const npcId = getNpcRuntimeId(npcData);
    const moved =
      Math.abs(desiredX - npcGroup.position.x) > 1e-6 ||
      Math.abs(desiredZ - npcGroup.position.z) > 1e-6;
    const existing = workerFrameIntentsRef.current.get(npcId);
    // `tickNpc` issues a final keepalive call with desired == current position.
    // In worker-authoritative mode this would otherwise overwrite a real movement intent
    // computed earlier in the same frame (e.g. manual hero movement).
    if (!moved && existing) return { moved: false };

    const intent: NpcIntent = {
      npcId,
      inputSeq: physicsFrameRef.current,
      desiredX,
      desiredY: npcGroup.position.y,
      desiredZ,
      jumpRequested: Boolean((npcGroup.userData as any)?._kccJumpActive),
    };
    workerFrameIntentsRef.current.set(npcId, intent);
    return { moved };
  };

  const trySnapNpcToGroundForTick = (npcGroup: THREE.Group) => {
    if (!isWorkerDrivenNpc(npcGroup)) return trySnapNpcToGroundWithRapier(npcGroup);
    return true;
  };

  const tickNpc = createTickNpc({
    loadedNpcsRef,
    getNpcVisualRoot,
    playerGroupRef,
    hideHero,
    showJumpDebugRange,
    ensureJumpDebugLabel,
    attachCombatBindings,
    manualControlHeroEnabled,
    trySnapNpcToGroundWithRapier: trySnapNpcToGroundForTick,
    playerInput,
    manualAttackSeqRef,
    manualAttackSeqAppliedRef,
    manualJumpSeqRef,
    manualJumpSeqAppliedRef,
    combatRuntimeRef,
    resolveNpcAnimationRef,
    manualKeysRef,
    manualRunToggleRef,
    manualControlSpeeds,
    tmpManualForward,
    tmpEmRootMotionWorld,
    tmpManualDesiredQuat,
    tmpManualUp,
    applyMoveConstraint: applyMoveConstraintForTick,
    waypointMoverRef,
    estimateAnimationDurationMs,
    getNearestWaypointDirectionQuat,
    getAnimationMetaForNpc,
    kccConfig,
    motionDebugLastRef,
  });

  // Frame pipeline: keep stages explicit to reduce cognitive load and side-effect coupling.
  useFrame((_state, delta) => {
    if (NPC_WORKER_AUTHORITATIVE) workerFrameIntentsRef.current.clear();
    if (NPC_WORKER_AUTHORITATIVE) restoreWorkerLogicPositions();
    const frameCtx: FrameContext = {
      loadedNpcsRef,
      waypointMoverRef,
      playerGroupRef,
    };
    const physicsFrame = tickStreamingStage({
      physicsFrameRef,
      allNpcsRef,
      updateNpcStreaming,
      freepointOwnerOverlayRef,
      enabled,
    });
    if (NPC_WORKER_AUTHORITATIVE) syncWorkerNpcMembership();
    if (!enabled || loadedNpcsRef.current.size === 0) return;

    tickWorldSyncStage(frameCtx);
    tickScriptsStage(frameCtx);
    tickTeleportDebugStage({
      teleportHeroSeqAppliedRef,
      teleportHeroSeqRef,
      playerGroupRef,
      camera,
      tmpTeleportForward,
      tmpTeleportDesiredQuat,
      tmpManualUp,
      persistNpcPosition,
    });

    const cameraPos = resolveFrameCameraPos();
    if (!cameraPos) return;

    tickNpc(delta, physicsFrame, cameraPos);
    if (NPC_WORKER_AUTHORITATIVE) captureWorkerLogicPositions();

    const workerClient = npcPhysicsWorkerClientRef.current;
    if (workerClient) {
      if (!workerWorldGeometrySentRef.current && worldColliderData) {
        const { vertices, indices } = worldColliderData;
        if (vertices.length > 0 && indices.length > 0) {
          workerClient.setWorldGeometry(vertices, indices);
          workerWorldGeometrySentRef.current = true;
        }
      }
      const intents: NpcIntent[] = [];
      if (NPC_WORKER_AUTHORITATIVE) {
        for (const [npcId, npcGroup] of loadedNpcsRef.current.entries()) {
          if (!isWorkerDrivenNpc(npcGroup)) continue;
          const fromTick = workerFrameIntentsRef.current.get(npcId);
          if (fromTick) intents.push(fromTick);
          else {
            intents.push({
              npcId,
              inputSeq: physicsFrame,
              desiredX: npcGroup.position.x,
              desiredY: npcGroup.position.y,
              desiredZ: npcGroup.position.z,
              jumpRequested: Boolean((npcGroup.userData as any)?._kccJumpActive),
            });
          }
        }
      } else {
        for (const [npcId, npcGroup] of loadedNpcsRef.current.entries()) {
          intents.push({
            npcId,
            inputSeq: physicsFrame,
            desiredX: npcGroup.position.x,
            desiredY: npcGroup.position.y,
            desiredZ: npcGroup.position.z,
            jumpRequested: Boolean((npcGroup.userData as any)?._kccJumpActive),
          });
        }
      }
      workerClient.pushIntents(physicsFrame, intents);

      const sampledPairs = workerClient.samplePairs(
        performance.now(),
        NPC_WORKER_INTERPOLATION_DELAY_MS,
      );
      const sampledLatest = NPC_WORKER_AUTHORITATIVE ? workerClient.sampleLatestStates() : null;
      if (sampledPairs && NPC_WORKER_AUTHORITATIVE) {
        for (const [npcId, pair] of sampledPairs.entries()) {
          const npcGroup = loadedNpcsRef.current.get(npcId);
          if (!npcGroup) continue;
          if (!isWorkerDrivenNpc(npcGroup)) continue;
          applyWorkerStateInterpolated(npcGroup, pair.prev, pair.next, pair.alpha);
        }
      } else if (sampledLatest && NPC_WORKER_AUTHORITATIVE) {
        for (const [npcId, latest] of sampledLatest.entries()) {
          const npcGroup = loadedNpcsRef.current.get(npcId);
          if (!npcGroup) continue;
          if (!isWorkerDrivenNpc(npcGroup)) continue;
          applyWorkerStateLatest(npcGroup, latest);
        }
      } else if (sampledPairs && !NPC_WORKER_AUTHORITATIVE) {
        for (const [npcId, pair] of sampledPairs.entries()) {
          const npcGroup = loadedNpcsRef.current.get(npcId);
          if (!npcGroup) continue;
          if (!isWorkerDrivenNpc(npcGroup)) continue;
          applyWorkerStateInterpolated(npcGroup, pair.prev, pair.next, pair.alpha);
        }
      }
    }

    tickCombatStage({
      delta,
      loadedNpcsRef,
      runCombatTick,
      resolveNpcAnimationRef,
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
          const ud = ensureNpcUserData(npcGroup);
          ud.isDisposed = true;
          clearNpcRuntimeValue(ud, "jumpDebugLabelRoot");
          clearNpcRuntimeValue(ud, "jumpDebugLabelSetText");
          removeNpcKccCollider(npcGroup);
          const instance = ud.characterInstance;
          const isLoading = Boolean(ud.modelLoading);
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
