import { useMemo, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { usePlayerInput } from "./player-input-context";
import * as THREE from "three";
import type { World, ZenKit } from "@kolarz3/zenkit";
import { createStreamingState, disposeObject3D } from "./distance-streaming";
import type { NpcData } from "./types";
import { getMapKey } from "./npc-utils";
import { type CharacterCaches, type CharacterInstance } from "./character/character-instance.js";
import { preloadAnimationSequences } from "./character/animation.js";
import { fetchBinaryCached } from "./character/binary-cache.js";
import { HUMAN_LOCOMOTION_PRELOAD_ANIS, type LocomotionMode } from "./npc-locomotion";
import { createWaypointMover, type WaypointMover } from "./npc-waypoint-mover";
import {
  clearNpcFreepointReservations,
  setFreepointsWorld,
  updateNpcWorldPosition,
  removeNpcWorldPosition,
} from "./npc-freepoints";
import { clearNpcEmRuntimeState } from "./npc-em-runtime";
import { clearNpcEmQueueState } from "./npc-em-queue";
import { ModelScriptRegistry } from "./model-script-registry";
import { NPC_RENDER_TUNING, useNpcPhysics } from "./npc-physics";
import { useWorldTime } from "./world-time";
import { createFreepointOwnerOverlay } from "./freepoint-owner-overlay";
import { buildRoutineWaybox, type Aabb } from "./npc-routine-waybox";
import { setWaynetWaypointPositions } from "./waynet-index";
import { buildNpcWorldIndices } from "./npc-world-indices";
import { computeNpcsWithPositions } from "./npc-renderer-data";
import { loadNpcCharacter as loadNpcCharacterImpl } from "./npc-character-loader";
import { setPlayerPoseFromObject3D } from "./player-runtime";
import { createTickNpc } from "./npc-tick-npc";
import { useNpcManualControl } from "./npc-renderer-hooks/use-npc-manual-control";
import { useNpcAnimationState } from "./npc-renderer-hooks/use-npc-animation-state";
import { useNpcCombatTick } from "./npc-renderer-hooks/use-npc-combat-tick";
import { useNpcStreaming } from "./npc-renderer-hooks/use-npc-streaming";
import {
  type FrameContext,
  tickCombatStage,
  tickScriptsStage,
  tickStreamingStage,
  tickTeleportDebugStage,
  tickWorldSyncStage,
} from "./npc-frame-stages";

function createJumpDebugTextSprite(initialText: string): {
  sprite: THREE.Sprite;
  setText: (text: string) => void;
} {
  if (typeof document === "undefined") {
    throw new Error("document is not available");
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get 2D context");
  }

  canvas.width = 512;
  canvas.height = 192;
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.1,
    depthTest: false,
    depthWrite: false,
  } as any);
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(165, 62, 1);

  let lastText = "";
  const draw = (text: string) => {
    const t = String(text ?? "");
    if (t === lastText) return;
    lastText = t;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(18, 22, 24, 0.82)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(70, 220, 120, 0.9)";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

    const lines = t.split("\n");
    ctx.font = "bold 34px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let y = 16;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? "#8dff9d" : "#f2fff4";
      ctx.fillText(lines[i], 16, y);
      y += 42;
      if (y > canvas.height - 30) break;
    }
    texture.needsUpdate = true;
  };

  draw(initialText);
  return { sprite, setText: draw };
}

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
}: NpcRendererProps) {
  const { scene, camera } = useThree();
  const npcsGroupRef = useRef<THREE.Group | null>(null);
  const worldTime = useWorldTime();
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

  const allNpcsRef = useRef<Array<{ npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>>([]); // All NPC data
  const allNpcsByIdRef = useRef(
    new Map<string, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>(),
  );
  const allNpcsByInstanceIndexRef = useRef(
    new Map<number, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>(),
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
    const ud: any = npcGroup.userData ?? (npcGroup.userData = {});
    let root = ud._jumpDebugLabelRoot as THREE.Group | undefined;
    let setText = ud._jumpDebugLabelSetText as ((text: string) => void) | undefined;
    if (!root || !setText) {
      const visualRoot = (ud.visualRoot as THREE.Object3D | undefined) ?? npcGroup;
      const label = createJumpDebugTextSprite("jump_debug");
      root = new THREE.Group();
      root.name = "jump-debug-label-root";
      root.position.set(0, 178, 0);
      root.add(label.sprite);
      visualRoot.add(root);
      ud._jumpDebugLabelRoot = root;
      ud._jumpDebugLabelSetText = label.setText;
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

    for (const [, npcData] of npcs.entries()) {
      const waybox = buildRoutineWaybox(npcData.dailyRoutine, waypointPosIndex);
      out.set(npcData.instanceIndex, waybox);
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
    const byIdx = new Map<number, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>();
    const items: Array<{ id: string; waybox: Aabb }> = [];
    for (const entry of npcsWithPositions) {
      const id = `npc-${entry.npcData.instanceIndex}`;
      byId.set(id, entry);
      byIdx.set(entry.npcData.instanceIndex, entry);
      items.push({ id, waybox: entry.waybox });
      updateNpcWorldPosition(entry.npcData.instanceIndex, {
        x: entry.position.x,
        y: entry.position.y,
        z: entry.position.z,
      });
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
      [
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
      ],
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

  const tickNpc = createTickNpc({
    loadedNpcsRef,
    getNpcVisualRoot,
    playerGroupRef,
    hideHero,
    showJumpDebugRange,
    ensureJumpDebugLabel,
    attachCombatBindings,
    manualControlHeroEnabled,
    trySnapNpcToGroundWithRapier,
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
    applyMoveConstraint,
    waypointMoverRef,
    estimateAnimationDurationMs,
    getNearestWaypointDirectionQuat,
    getAnimationMetaForNpc,
    kccConfig,
    motionDebugLastRef,
  });

  // Frame pipeline: keep stages explicit to reduce cognitive load and side-effect coupling.
  useFrame((_state, delta) => {
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
