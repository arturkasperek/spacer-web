import { useMemo, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useRapier } from "@react-three/rapier";
import type { World, ZenKit } from '@kolarz3/zenkit';
import { createStreamingState, shouldUpdateStreaming, disposeObject3D } from './distance-streaming';
import type { NpcData } from './types';
import { findActiveRoutineWaypoint, getMapKey, createNpcMesh } from './npc-utils';
import { createHumanoidCharacterInstance, type CharacterCaches, type CharacterInstance } from './character/character-instance.js';
import { createCreatureCharacterInstance } from "./character/creature-character.js";
import { preloadAnimationSequences } from "./character/animation.js";
import { fetchBinaryCached } from "./character/binary-cache.js";
import { createHumanLocomotionController, HUMAN_LOCOMOTION_PRELOAD_ANIS, type LocomotionController, type LocomotionMode } from "./npc-locomotion";
import { createWaypointMover, type WaypointMover } from "./npc-waypoint-mover";
import { clearNpcFreepointReservations, setFreepointsWorld, updateNpcWorldPosition, removeNpcWorldPosition } from "./npc-freepoints";
import { clearNpcEmRuntimeState, updateNpcEventManager, __getNpcEmActiveJob } from "./npc-em-runtime";
import { __getNpcEmQueueState, clearNpcEmQueueState, requestNpcEmClear } from "./npc-em-queue";
import { getNpcModelScriptsState, setNpcBaseModelScript } from "./npc-model-scripts";
import { ModelScriptRegistry } from "./model-script-registry";
import { constrainCircleMoveXZ, type NpcCircleCollider } from "./npc-npc-collision";
import { spreadSpawnXZ } from "./npc-spawn-spread";
import { getNpcSpawnOrder, getRuntimeVm } from "./vm-manager";
import { advanceNpcStateTime, setNpcStateTime } from "./vm-manager";
import { getWorldTime, useWorldTime } from "./world-time";
import { createFreepointOwnerOverlay } from "./freepoint-owner-overlay";
import { aabbIntersects, buildRoutineWaybox, createAabbAroundPoint, type Aabb } from "./npc-routine-waybox";
import { setNpcRoutineRuntime } from "./npc-routine-runtime";
import { setWaynetWaypointPositions } from "./waynet-index";

interface NpcRendererProps {
  world: World | null;
  zenKit: ZenKit | null;
  npcs: Map<number, NpcData>;
  cameraPosition?: THREE.Vector3;
  enabled?: boolean;
}

type MoveConstraintResult = { blocked: boolean; moved: boolean };

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
  const { world: rapierWorld, rapier } = useRapier();
  const npcsGroupRef = useRef<THREE.Group>(null);
  const worldTime = useWorldTime();
  const tmpManualForward = useMemo(() => new THREE.Vector3(), []);
  const tmpManualRight = useMemo(() => new THREE.Vector3(), []);
  const tmpManualDir = useMemo(() => new THREE.Vector3(), []);
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
  const cavalornGroupRef = useRef<THREE.Group | null>(null);

  const kccConfig = useMemo(() => {
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

    const getGroundStickSpeed = () => {
      const fallback = 140;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcGroundStickSpeed");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0 || v > 5000) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const getGroundStickMaxDistance = () => {
      const fallback = 6;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcGroundStickMax");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0 || v > 200) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const getGroundSnapDownEps = () => {
      const fallback = 0.5;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcGroundSnapDownEps");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0 || v > 50) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const getGroundRecoverDistance = () => {
      const fallback = 30;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcGroundRecover");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0 || v > 500) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const getGroundRecoverRayStartAbove = () => {
      const fallback = 60;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcGroundRecoverAbove");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0 || v > 5000) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const getSlopeSpeedCompEnabled = () => {
      const fallback = true;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcSlopeSpeedComp");
        if (raw == null) return fallback;
        if (raw === "0" || raw === "false") return false;
        if (raw === "1" || raw === "true") return true;
        return fallback;
      } catch {
        return fallback;
      }
    };

    const getSlopeSpeedCompMaxFactor = () => {
      const fallback = 1.5;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcSlopeSpeedCompMax");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 1 || v > 5) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const getSlideBlockUphillEnabled = () => {
      const fallback = true;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcSlideBlockUphill");
        if (raw == null) return fallback;
        if (raw === "0" || raw === "false") return false;
        if (raw === "1" || raw === "true") return true;
        return fallback;
      } catch {
        return fallback;
      }
    };

    const getFallDownSeconds = () => {
      const fallback = 1.0;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcFallDownSeconds");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0 || v > 5) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const getVisualSmoothEnabled = () => {
      const fallback = true;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcVisualSmooth");
        if (raw == null) return fallback;
        if (raw === "0" || raw === "false") return false;
        if (raw === "1" || raw === "true") return true;
        return fallback;
      } catch {
        return fallback;
      }
    };

    const getVisualSmoothHalfLifeUp = () => {
      const fallback = 0.08;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcVisualSmoothUp");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0 || v > 2) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const getVisualSmoothHalfLifeDown = () => {
      const fallback = 0.03;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcVisualSmoothDown");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0 || v > 2) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const getVisualSmoothMaxDown = () => {
      const fallback = 12;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcVisualSmoothMaxDown");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0 || v > 200) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const getVisualSmoothMaxUp = () => {
      const fallback = 2;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcVisualSmoothMaxUp");
        if (raw == null) return fallback;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0 || v > 50) return fallback;
        return v;
      } catch {
        return fallback;
      }
    };

    const walkDeg = getMaxSlopeDeg();
    return {
      radius: 35,
      capsuleHeight: 170,
      stepHeight: 60,
      // Slopes:
      // - climb if slope <= maxSlopeClimbAngle
      // - slide if slope > minSlopeSlideAngle
      maxSlopeClimbAngle: THREE.MathUtils.degToRad(walkDeg),
      minSlopeSlideAngle: THREE.MathUtils.degToRad(walkDeg),
      // Gravity tuning (ZenGin-like defaults).
      gravity: 981,
      maxFallSpeed: 8000,
      // How fast we "stick" down while grounded (helps when going downhill on ramps/stairs).
      // Units: distance units per second (Gothic scale is ~cm).
      groundStickSpeed: getGroundStickSpeed(),
      // Clamp the stick-to-ground translation per frame to avoid snapping down big ledges.
      groundStickMaxDistance: getGroundStickMaxDistance(),
      // A tiny always-on downward component while grounded to let Rapier's snap-to-ground work
      // even when moving with `desired.y = 0` (required by the KCC docs).
      groundSnapDownEps: getGroundSnapDownEps(),
      // Recovery snap when we briefly lose `computedGrounded()` on edges while going downhill.
      groundRecoverDistance: getGroundRecoverDistance(),
      groundRecoverRayStartAbove: getGroundRecoverRayStartAbove(),
      // Small clearance to avoid visual ground intersection.
      groundClearance: 4,

      // Counter-act KCC's horizontal slowdown when climbing slopes/steps.
      slopeSpeedCompEnabled: getSlopeSpeedCompEnabled(),
      slopeSpeedCompMaxFactor: getSlopeSpeedCompMaxFactor(),
      // When sliding on too-steep slopes, prevent input from pushing uphill (can cause slide→fall jitter).
      slideBlockUphillEnabled: getSlideBlockUphillEnabled(),
      // Falling animation blending (ZenGin-like: fallDown before fall).
      fallDownSeconds: getFallDownSeconds(),

      // Visual-only smoothing (applied to a child group so physics stays exact).
      visualSmoothEnabled: getVisualSmoothEnabled(),
      visualSmoothHalfLifeUp: getVisualSmoothHalfLifeUp(),
      visualSmoothHalfLifeDown: getVisualSmoothHalfLifeDown(),
      visualSmoothMaxDown: getVisualSmoothMaxDown(),
      visualSmoothMaxUp: getVisualSmoothMaxUp(),
    };
  }, []);

  const kccRef = useRef<any>(null);

  const getNpcVisualRoot = (npcGroup: THREE.Group): THREE.Object3D => {
    const ud: any = npcGroup.userData ?? {};
    const root = ud.visualRoot as THREE.Object3D | undefined;
    if (root && (root as any).isObject3D) return root;
    const found = npcGroup.getObjectByName?.("npc-visual-root") as THREE.Object3D | null;
    return found ?? npcGroup;
  };

  const updateNpcVisualSmoothing = (npcGroup: THREE.Group, dt: number) => {
    const visualRoot = getNpcVisualRoot(npcGroup);
    if (visualRoot === npcGroup) return;
    const ud: any = npcGroup.userData ?? (npcGroup.userData = {});

    if (!kccConfig.visualSmoothEnabled) {
      visualRoot.position.y = 0;
      ud._visSmoothY = undefined;
      return;
    }

    const targetY = npcGroup.position.y;
    let smoothY = ud._visSmoothY as number | undefined;
    if (typeof smoothY !== "number" || !Number.isFinite(smoothY)) smoothY = targetY;

    const halfLife = targetY > smoothY ? kccConfig.visualSmoothHalfLifeUp : kccConfig.visualSmoothHalfLifeDown;
    if (halfLife > 0 && dt > 0) {
      const alpha = 1 - Math.pow(2, -dt / halfLife);
      smoothY = smoothY + (targetY - smoothY) * alpha;
    } else {
      smoothY = targetY;
    }

    // Clamp so we never render above physics (avoids "floating"), and only allow limited lag below.
    const maxDown = kccConfig.visualSmoothMaxDown;
    const maxUp = kccConfig.visualSmoothMaxUp;
    let offset = smoothY - targetY;
    if (offset > maxUp) offset = maxUp;
    if (offset < -maxDown) offset = -maxDown;
    smoothY = targetY + offset;

    ud._visSmoothY = smoothY;
    visualRoot.position.y = smoothY - targetY;
  };

  useEffect(() => {
    if (!rapierWorld) return;
    if (!rapier) return;

    const getOffset = () => {
      const fallback = 1; // 1 unit ~ 1cm in Gothic scale; avoids "sticky" edges.
      try {
        const raw = new URLSearchParams(window.location.search).get("npcKccOffset");
        if (raw == null) return fallback;
        const v = Number(raw);
        return Number.isFinite(v) && v > 0 ? v : fallback;
      } catch {
        return fallback;
      }
    };

    const getSnapDistance = () => {
      // Helps keep contact when going down ramps/stair-like slopes.
      const fallback = 20;
      try {
        const raw = new URLSearchParams(window.location.search).get("npcKccSnap");
        if (raw == null) return fallback;
        const v = Number(raw);
        return Number.isFinite(v) && v >= 0 ? v : fallback;
      } catch {
        return fallback;
      }
    };

    const controller = rapierWorld.createCharacterController(getOffset());
    controller.setSlideEnabled(true);
    controller.setMaxSlopeClimbAngle(kccConfig.maxSlopeClimbAngle);
    controller.setMinSlopeSlideAngle(kccConfig.minSlopeSlideAngle);

    const minWidth = Math.max(1, kccConfig.radius * 0.5);
    controller.enableAutostep(kccConfig.stepHeight, minWidth, false);

    const snap = getSnapDistance();
    if (snap > 0) controller.enableSnapToGround(snap);
    else if (typeof (controller as any).disableSnapToGround === "function") (controller as any).disableSnapToGround();

    controller.setApplyImpulsesToDynamicBodies(false);
    controller.setCharacterMass(1);

    kccRef.current = controller;
    return () => {
      try {
        rapierWorld.removeCharacterController(controller);
      } catch {
        // Best-effort cleanup.
      }
      if (kccRef.current === controller) kccRef.current = null;
    };
  }, [rapierWorld, rapier, kccConfig.maxSlopeClimbAngle, kccConfig.minSlopeSlideAngle, kccConfig.radius, kccConfig.stepHeight]);

  const ensureNpcKccCollider = (npcGroup: THREE.Object3D) => {
    if (!rapierWorld || !rapier) return null;
    const ud: any = npcGroup.userData ?? {};
    const handle: number | undefined = ud._kccColliderHandle;
    const height = kccConfig.capsuleHeight;
    ud._kccCapsuleHeight = height;

    if (typeof handle === "number") {
      const existing = rapierWorld.getCollider(handle);
      if (existing) {
        const centerY = npcGroup.position.y + height / 2;
        existing.setTranslation({ x: npcGroup.position.x, y: centerY, z: npcGroup.position.z });
        return existing;
      }
      delete ud._kccColliderHandle;
    }

    const halfHeight = Math.max(0, height / 2 - kccConfig.radius);
    const desc = rapier.ColliderDesc.capsule(halfHeight, kccConfig.radius);

    // Collision groups:
    // - WORLD: membership=1
    // - NPC: membership=2, filter=world only (ignore other NPCs; npc-npc is handled separately).
    const NPC_MEMBERSHIP = 0x0002;
    const NPC_FILTER = 0x0001;
    desc.setCollisionGroups((NPC_MEMBERSHIP << 16) | NPC_FILTER);

    const collider = rapierWorld.createCollider(desc);
    ud._kccColliderHandle = collider.handle;
    npcGroup.userData = ud;

    const centerY = npcGroup.position.y + height / 2;
    collider.setTranslation({ x: npcGroup.position.x, y: centerY, z: npcGroup.position.z });
    return collider;
  };

  const removeNpcKccCollider = (npcGroup: THREE.Object3D) => {
    if (!rapierWorld) return;
    const ud: any = npcGroup.userData ?? {};
    const handle: number | undefined = ud._kccColliderHandle;
    if (typeof handle !== "number") return;
    try {
      const collider = rapierWorld.getCollider(handle);
      if (collider) rapierWorld.removeCollider(collider, true);
    } catch {
      // Best-effort cleanup.
    }
    delete ud._kccColliderHandle;
  };

  // ZenGin-like streaming (routine "wayboxes" + active-area bbox intersection)
  const loadedNpcsRef = useRef(new Map<string, THREE.Group>()); // npc id -> THREE.Group
  const allNpcsRef = useRef<Array<{ npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>>([]); // All NPC data
  const allNpcsByIdRef = useRef(new Map<string, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>());
  const allNpcsByInstanceIndexRef = useRef(new Map<number, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>());
  const npcItemsRef = useRef<Array<{ id: string; waybox: Aabb }>>([]);
  const NPC_LOAD_DISTANCE = 5000; // Active-area half size in X/Z for loading
  const NPC_UNLOAD_DISTANCE = 6000; // Active-area half size in X/Z for unloading (hysteresis)
  const NPC_ACTIVE_BBOX_HALF_Y = 100000; // Effectively ignore Y for active-area checks

  // Streaming state using shared utility
  const streamingState = useRef(createStreamingState());

  const manualControlCavalornEnabled = useMemo(() => {
    try {
      return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("controlCavalorn");
    } catch {
      return false;
    }
  }, []);

  const motionDebugFromQuery = useMemo(() => {
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

  const freepointOwnerOverlayRef = useRef<ReturnType<typeof createFreepointOwnerOverlay> | null>(null);

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
      return { animationName: (animationName || "").trim(), modelName };
    };
  }, [getAnimationMetaForNpc]);

  // Convert NPC data to renderable NPCs with spawnpoint positions (only compute positions, not render)
  const npcsWithPositions = useMemo(() => {
    if (!world || !enabled || npcs.size === 0) {
      return [];
    }

    const renderableNpcs: Array<{ npcData: NpcData; position: THREE.Vector3; waybox: Aabb }> = [];
    const CURRENT_HOUR = worldTime.hour;
    const CURRENT_MINUTE = worldTime.minute;

    for (const [, npcData] of npcs.entries()) {
      let position: [number, number, number] | null = null;
      let waypointName: string | null = null;

      const routineWaybox = npcRoutineWayboxIndex.get(npcData.instanceIndex) ?? null;

      // ZenGin-like behavior: routine-driven NPC spawning depends on routine "wayboxes" derived from
      // existing waynet waypoints. If a routine references no existing waypoint at all, the original game
      // effectively never spawns the NPC. Mimic that by not rendering it.
      if (npcData.dailyRoutine && npcData.dailyRoutine.length > 0 && !routineWaybox) continue;

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
        const pos = new THREE.Vector3(position[0], position[1], position[2]);
        const waybox =
          routineWaybox ??
          createAabbAroundPoint(pos, {
            x: 1,
            y: 1,
            z: 1,
          });
        renderableNpcs.push({
          npcData,
          position: pos,
          waybox,
        });
      } else {
        const source = routineWaypoint ? `routine waypoint "${routineWaypoint}"` : `spawnpoint "${npcData.spawnpoint}"`;
        console.warn(`⚠️ Could not find ${source} (waypoint or VOB) for NPC ${npcData.symbolName}`);
      }
    }

    return renderableNpcs;
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
      if (cavalornGroupRef.current === npcGroup) cavalornGroupRef.current = null;
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

  const applyMoveConstraint = (npcGroup: THREE.Group, desiredX: number, desiredZ: number, dt: number): MoveConstraintResult => {
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
      const selfRadius = kccConfig.radius * 0.6;
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

    const controller = kccRef.current;
    if (!controller || !rapier || !rapierWorld) {
      const beforeX = npcGroup.position.x;
      const beforeZ = npcGroup.position.z;
      npcGroup.position.x = desiredX;
      npcGroup.position.z = desiredZ;
      const moved = Math.abs(npcGroup.position.x - beforeX) > 1e-6 || Math.abs(npcGroup.position.z - beforeZ) > 1e-6;
      updateNpcVisualSmoothing(npcGroup, Math.min(Math.max(dt, 0), 0.05));
      npcGroup.userData._kccLastFrame = physicsFrameRef.current;
      return { blocked: Boolean(npcGroup.userData._npcNpcBlocked), moved };
    }

    const collider = ensureNpcKccCollider(npcGroup);
    if (!collider) {
      const beforeX = npcGroup.position.x;
      const beforeZ = npcGroup.position.z;
      npcGroup.position.x = desiredX;
      npcGroup.position.z = desiredZ;
      const moved = Math.abs(npcGroup.position.x - beforeX) > 1e-6 || Math.abs(npcGroup.position.z - beforeZ) > 1e-6;
      updateNpcVisualSmoothing(npcGroup, Math.min(Math.max(dt, 0), 0.05));
      npcGroup.userData._kccLastFrame = physicsFrameRef.current;
      return { blocked: Boolean(npcGroup.userData._npcNpcBlocked), moved };
    }

    const dtClamped = Math.min(Math.max(dt, 0), 0.05);
    const fromX = npcGroup.position.x;
    const fromZ = npcGroup.position.z;
    let dx = desiredX - fromX;
    let dz = desiredZ - fromZ;
    let desiredDistXZ = Math.hypot(dx, dz);

    const ud: any = npcGroup.userData ?? (npcGroup.userData = {});
    const wasStableGrounded = Boolean(ud._kccStableGrounded ?? ud._kccGrounded);
    const wasSliding = Boolean(ud.isSliding);
    let vy = (ud._kccVy as number | undefined) ?? 0;

    // If we were sliding last frame, prevent any input from pushing along the slope direction.
    // This keeps slide speed stable and avoids slide→fall jitter from trying to "fight" the slope.
    if (kccConfig.slideBlockUphillEnabled && wasSliding && desiredDistXZ > 1e-6) {
      const n = ud._kccGroundNormal as { x: number; y: number; z: number } | undefined;
      const ny = n?.y ?? 0;
      if (n && Number.isFinite(n.x) && Number.isFinite(ny) && Number.isFinite(n.z) && ny > 0.2) {
        // Downhill direction is the gravity vector projected onto the ground plane.
        // We only care about XZ to decide what is "uphill" vs "downhill".
        let sx = ny * n.x;
        let sz = ny * n.z;
        const sLen = Math.hypot(sx, sz);
        if (sLen > 1e-6) {
          sx /= sLen;
          sz /= sLen;
          const along = dx * sx + dz * sz; // >0 means towards downhill; <0 means uphill
          if (Math.abs(along) > 1e-6) {
            dx -= along * sx;
            dz -= along * sz;
            desiredX = fromX + dx;
            desiredZ = fromZ + dz;
            desiredDistXZ = Math.hypot(dx, dz);
            ud._slideBlockedAlong = along;
          } else {
            ud._slideBlockedAlong = 0;
          }
        }
      }
    }

    // Small downward component helps snap-to-ground and keeps the character "glued" to slopes/steps.
    let dy = vy * dtClamped;
    let stickDown = 0;
    if (wasStableGrounded) {
      const snapDown = kccConfig.groundSnapDownEps;
      if (snapDown > 0 && dy > -snapDown) dy = -snapDown;

      // Only apply extra "stick" when idle. When moving uphill over steps/ramps, a forced downward component
      // can noticeably slow down climbing or even prevent autostep from triggering.
      if (desiredDistXZ < 1e-3) {
        stickDown = Math.min(kccConfig.groundStickSpeed * dtClamped, kccConfig.groundStickMaxDistance);
        if (stickDown > 0 && dy > -stickDown) dy = -stickDown;
      }
    }

    try {
      const WORLD_MEMBERSHIP = 0x0001;
      const filterGroups = (WORLD_MEMBERSHIP << 16) | WORLD_MEMBERSHIP;

      const computeBestGroundNormal = () => {
        let best: { x: number; y: number; z: number } | null = null;
        const n = controller.numComputedCollisions?.() ?? 0;
        for (let i = 0; i < n; i++) {
          const c = controller.computedCollision?.(i);
          const normal = c?.normal1;
          const nx = normal?.x;
          const ny = normal?.y;
          const nz = normal?.z;
          if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) continue;
          if (!best || ny > best.y) best = { x: nx, y: ny, z: nz };
        }
        return best;
      };

      let boostApplied = false;
      let boostFactor = 1;

      controller.computeColliderMovement(collider, { x: dx, y: dy, z: dz }, rapier.QueryFilterFlags.EXCLUDE_SENSORS, filterGroups);
      let move = controller.computedMovement();
      let bestGroundNormal: { x: number; y: number; z: number } | null = null;
      let bestGroundNy: number | null = null;
      try {
        bestGroundNormal = computeBestGroundNormal();
        bestGroundNy = bestGroundNormal?.y ?? null;
      } catch {
        bestGroundNormal = null;
        bestGroundNy = null;
      }

      // Slope/step speed compensation: KCC tends to reduce the XZ component by ~normal.y when it has to climb.
      // This can make climbing ramps/step-like slopes feel slower than flat ground.
      if (
        kccConfig.slopeSpeedCompEnabled &&
        desiredDistXZ > 1e-6 &&
        move.y > 1e-3 &&
        bestGroundNy != null &&
        bestGroundNy > 0.2 &&
        bestGroundNy < 0.999
      ) {
        const moveXZ = Math.hypot(move.x, move.z);
        const ratio = moveXZ / desiredDistXZ;
        if (ratio < 0.98 && Math.abs(ratio - bestGroundNy) < 0.2) {
          boostFactor = Math.min(1 / bestGroundNy, kccConfig.slopeSpeedCompMaxFactor);
          if (boostFactor > 1.001) {
            controller.computeColliderMovement(
              collider,
              { x: dx * boostFactor, y: dy, z: dz * boostFactor },
              rapier.QueryFilterFlags.EXCLUDE_SENSORS,
              filterGroups
            );
            move = controller.computedMovement();
            try {
              bestGroundNormal = computeBestGroundNormal();
              bestGroundNy = bestGroundNormal?.y ?? null;
            } catch {
              // ignore
            }
            boostApplied = true;
          }
        }
      }

      const cur = collider.translation();
      const next = { x: cur.x + move.x, y: cur.y + move.y, z: cur.z + move.z };
      collider.setTranslation(next);

      const capsuleHeight = (ud._kccCapsuleHeight as number | undefined) ?? kccConfig.capsuleHeight;
      npcGroup.position.set(next.x, next.y - capsuleHeight / 2, next.z);

      const rawGroundedNow = Boolean(controller.computedGrounded?.() ?? false);
      ud._kccGrounded = rawGroundedNow;

      // Integrate gravity for the next frame (semi-implicit):
      // - If grounded now: reset vertical speed.
      // - If not grounded: apply gravity.
      if (rawGroundedNow) {
        vy = 0;
      } else {
        vy -= kccConfig.gravity * dtClamped;
        if (vy < -kccConfig.maxFallSpeed) vy = -kccConfig.maxFallSpeed;
      }

      // `bestGroundNy` is computed from the KCC collisions to classify steep slopes.
      ud._kccGroundNy = bestGroundNy;
      ud._kccGroundNormal = bestGroundNormal;

      // Stable grounded/falling state with hysteresis to prevent 1-frame flicker in animations.
      const FALL_GRACE_S = 0.08;
      const LAND_GRACE_S = 0.02;
      const FALL_VY_THRESHOLD = -20;

      let groundedFor = (ud._kccGroundedFor as number | undefined) ?? 0;
      let ungroundedFor = (ud._kccUngroundedFor as number | undefined) ?? 0;
      let stableGrounded = Boolean(ud._kccStableGrounded ?? rawGroundedNow);

      if (rawGroundedNow) {
        groundedFor += dtClamped;
        ungroundedFor = 0;
        if (!stableGrounded && groundedFor >= LAND_GRACE_S) stableGrounded = true;
      } else {
        groundedFor = 0;
        ungroundedFor += dtClamped;
        if (stableGrounded && ungroundedFor >= FALL_GRACE_S && vy <= FALL_VY_THRESHOLD) stableGrounded = false;
      }

      ud._kccGroundedFor = groundedFor;
      ud._kccUngroundedFor = ungroundedFor;
      ud._kccStableGrounded = stableGrounded;

      ud._kccVy = vy;

      // If we are not grounded, attempt a lightweight ray-based recovery snap to avoid edge flicker on ramps/stairs.
      // This uses Rapier queries only (no legacy world mesh code).
      let recoveredToGround = false;
      let groundRayToi: number | null = null;
      let groundRayNormalY: number | null = null;
      let groundRayColliderHandle: number | null = null;
      if (!rawGroundedNow && (wasStableGrounded || stableGrounded) && vy <= 0 && kccConfig.groundRecoverDistance > 0) {
        try {
          const WORLD_MEMBERSHIP = 0x0001;
          const filterGroups = (WORLD_MEMBERSHIP << 16) | WORLD_MEMBERSHIP;
          const filterFlags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
          const feetY = npcGroup.position.y;
          const startAbove = kccConfig.groundRecoverRayStartAbove;
          const maxToi = startAbove + kccConfig.groundRecoverDistance;
          const ray = new rapier.Ray(
            { x: npcGroup.position.x, y: feetY + startAbove, z: npcGroup.position.z },
            { x: 0, y: -1, z: 0 }
          );
          const hit = rapierWorld.castRayAndGetNormal(ray, maxToi, true, filterFlags, filterGroups, collider);
          if (hit) {
            groundRayToi = hit.timeOfImpact;
            groundRayNormalY = hit.normal?.y ?? null;
            groundRayColliderHandle = hit.collider?.handle ?? null;

            const minNy = Math.cos(kccConfig.maxSlopeClimbAngle + 1e-3);
            const nyOk = typeof groundRayNormalY === "number" && Number.isFinite(groundRayNormalY) && groundRayNormalY >= minNy;
            if (nyOk) {
              const p = ray.pointAt(hit.timeOfImpact);
              const deltaDownToHit = feetY - p.y;
              if (deltaDownToHit >= -1e-3 && deltaDownToHit <= kccConfig.groundRecoverDistance + 1e-3) {
                // Consider ourselves grounded again (even if we don't adjust Y), to avoid 1-frame fall flicker at edges.
                recoveredToGround = true;

                const targetFeetY = Math.min(feetY, p.y + kccConfig.groundClearance);
                const drop = feetY - targetFeetY;
                if (drop > 1e-3) {
                  collider.setTranslation({
                    x: npcGroup.position.x,
                    y: targetFeetY + capsuleHeight / 2,
                    z: npcGroup.position.z,
                  });
                  npcGroup.position.y = targetFeetY;
                }

                vy = 0;
                ud._kccVy = 0;
                stableGrounded = true;
                groundedFor = Math.max(groundedFor, LAND_GRACE_S);
                ungroundedFor = 0;
                ud._kccGroundedFor = groundedFor;
                ud._kccUngroundedFor = ungroundedFor;
                ud._kccStableGrounded = true;
              }
            }
          }
        } catch {
          // ignore
        }
      }

      ud.isFalling = !stableGrounded;

      let isSliding = false;
      if (stableGrounded && bestGroundNy != null) {
        const ny = Math.max(-1, Math.min(1, bestGroundNy));
        const slopeAngle = Math.acos(ny);
        isSliding = slopeAngle > kccConfig.maxSlopeClimbAngle + 1e-3;
      }
      ud.isSliding = isSliding;

      updateNpcVisualSmoothing(npcGroup, dtClamped);

      const isMotionDebugRuntime =
        typeof window !== "undefined" && Boolean((window as any).__npcMotionDebug) && cavalornGroupRef.current === npcGroup;
      const shouldStoreKccDbg = (motionDebugFromQuery || isMotionDebugRuntime) && cavalornGroupRef.current === npcGroup;
      if (shouldStoreKccDbg) {
        const dbg =
          (ud._kccDbg as any) ??
          (ud._kccDbg = {
            dt: 0,
            desired: { x: 0, y: 0, z: 0 },
            computed: { x: 0, y: 0, z: 0 },
            stickDown: 0,
            groundedRaw: false,
            groundedStable: false,
            vy: 0,
            groundedFor: 0,
            ungroundedFor: 0,
            groundNy: null as number | null,
            collisions: 0,
            groundRay: null as any,
            recoveredToGround: false,
            slopeBoost: null as any,
            slideBlock: null as any,
          });
        dbg.dt = dtClamped;
        dbg.desired.x = dx;
        dbg.desired.y = dy;
        dbg.desired.z = dz;
        dbg.computed.x = move.x;
        dbg.computed.y = move.y;
        dbg.computed.z = move.z;
        dbg.stickDown = stickDown;
        dbg.groundedRaw = rawGroundedNow;
        dbg.groundedStable = stableGrounded;
        dbg.vy = vy;
        dbg.groundedFor = groundedFor;
        dbg.ungroundedFor = ungroundedFor;
        dbg.groundNy = bestGroundNy;
        dbg.collisions = controller.numComputedCollisions?.() ?? 0;
        dbg.groundRay =
          groundRayToi != null
            ? { toi: groundRayToi, normalY: groundRayNormalY, colliderHandle: groundRayColliderHandle }
            : null;
        dbg.recoveredToGround = recoveredToGround;
        dbg.slopeBoost = boostApplied ? { factor: boostFactor } : null;
        dbg.slideBlock =
          kccConfig.slideBlockUphillEnabled && wasSliding
            ? { wasSliding: true, blockedAlong: (ud._slideBlockedAlong as number | undefined) ?? null }
            : null;
      }

      const movedDistXZ = Math.hypot(npcGroup.position.x - fromX, npcGroup.position.z - fromZ);
      const blocked = desiredDistXZ > 1e-6 && movedDistXZ < desiredDistXZ - 1e-3;
      ud._kccLastFrame = physicsFrameRef.current;
      return { blocked: Boolean(ud._npcNpcBlocked) || blocked, moved: movedDistXZ > 1e-6 };
    } catch {
      // If Rapier throws for any reason, we keep behavior stable by applying the raw desired translation.
      const beforeX = npcGroup.position.x;
      const beforeZ = npcGroup.position.z;
      npcGroup.position.x = desiredX;
      npcGroup.position.z = desiredZ;
      const moved = Math.abs(npcGroup.position.x - beforeX) > 1e-6 || Math.abs(npcGroup.position.z - beforeZ) > 1e-6;
      updateNpcVisualSmoothing(npcGroup, dtClamped);
      ud._kccLastFrame = physicsFrameRef.current;
      return { blocked: Boolean(ud._npcNpcBlocked), moved };
    }
  };

  const persistNpcPosition = (npcGroup: THREE.Group) => {
    const npcData = npcGroup.userData.npcData as NpcData | undefined;
    if (!npcData) return;
    const entry = allNpcsByInstanceIndexRef.current.get(npcData.instanceIndex);
    if (entry) entry.position.copy(npcGroup.position);
  };

  const trySnapNpcToGroundWithRapier = (npcGroup: THREE.Group): boolean => {
    if (!rapierWorld || !rapier) return false;
    const ud: any = npcGroup.userData ?? (npcGroup.userData = {});
    if (ud._kccSnapped === true) return true;

    const collider = ensureNpcKccCollider(npcGroup);
    if (!collider) return false;

    const x = npcGroup.position.x;
    const z = npcGroup.position.z;

    const castDown = (rayStartAbove: number, maxDownDistance: number) => {
      const WORLD_MEMBERSHIP = 0x0001;
      const filterGroups = (WORLD_MEMBERSHIP << 16) | WORLD_MEMBERSHIP;
      const filterFlags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
      const ray = new rapier.Ray({ x, y: npcGroup.position.y + rayStartAbove, z }, { x: 0, y: -1, z: 0 });
      const maxToi = rayStartAbove + maxDownDistance;
      const minNormalY = 0.2;

      let bestToi: number | null = null;
      rapierWorld.intersectionsWithRay(
        ray,
        maxToi,
        true,
        (hit: any) => {
          const toi = hit?.timeOfImpact ?? 0;
          const ny = hit?.normal?.y ?? 0;
          if (!Number.isFinite(toi) || toi < 0) return true;
          if (!Number.isFinite(ny) || ny < minNormalY) return true;
          if (bestToi == null || toi < bestToi) bestToi = toi;
          return true;
        },
        filterFlags,
        filterGroups,
        collider
      );

      if (bestToi == null) return null;
      const p = ray.pointAt(bestToi);
      return { y: p.y };
    };

    const hit = castDown(50, 5000) || castDown(2000, 20000);
    if (!hit) return false;

    const feetY = hit.y + kccConfig.groundClearance;
    collider.setTranslation({ x, y: feetY + kccConfig.capsuleHeight / 2, z });
    npcGroup.position.y = feetY;

    ud._kccVy = 0;
    ud._kccGrounded = true;
    ud._kccStableGrounded = true;
    ud._kccGroundedFor = 0;
    ud._kccUngroundedFor = 0;
    ud._kccSnapped = true;
    ud.isFalling = false;
    ud.isSliding = false;

    // Reset visual smoothing so we don't keep an offset across teleports/spawns.
    ud._visSmoothY = npcGroup.position.y;
    const visualRoot = getNpcVisualRoot(npcGroup);
    if (visualRoot !== npcGroup) visualRoot.position.y = 0;
    return true;
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
      const bodyMesh = (visual?.bodyMesh || "").trim().toUpperCase();
      const isHuman = bodyMesh.startsWith("HUM_");

      let instance: CharacterInstance | null = null;
      const visualParent = getNpcVisualRoot(npcGroup);
      if (isHuman || !bodyMesh) {
        instance = await createHumanoidCharacterInstance({
          zenKit,
          caches: characterCachesRef.current,
          parent: visualParent,
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
      } else {
        const scripts = getNpcModelScriptsState(npcData.instanceIndex);
        const baseScript = (scripts?.baseScript || "").trim().toUpperCase();
        const modelKey = baseScript && baseScript !== "HUMANS" ? baseScript : bodyMesh;
        if (baseScript === "HUMANS" && modelKey && modelKey !== "HUMANS") {
          setNpcBaseModelScript(npcData.instanceIndex, modelKey);
        }
        modelScriptRegistryRef.current?.startLoadScript(modelKey);

        instance = await createCreatureCharacterInstance({
          zenKit,
          caches: characterCachesRef.current,
          parent: visualParent,
          modelKey,
          meshKey: bodyMesh,
          animationName: "s_Run",
          loop: true,
          mirrorX: true,
          rootMotionTarget: "self",
          applyRootMotion: false,
          align: "ground",
        });

        if (!instance && modelKey !== bodyMesh) {
          instance = await createCreatureCharacterInstance({
            zenKit,
            caches: characterCachesRef.current,
            parent: visualParent,
            modelKey: bodyMesh,
            meshKey: bodyMesh,
            animationName: "s_Run",
            loop: true,
            mirrorX: true,
            rootMotionTarget: "self",
            applyRootMotion: false,
            align: "ground",
          });
        }
      }
      if (npcGroup.userData.isDisposed) return;

      if (!instance) {
        const mesh = (visual?.bodyMesh || "").trim();
        console.warn(`Failed to create NPC character model for ${npcData.symbolName}${mesh ? ` (mesh: ${mesh})` : ""}`);
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
        placeholder.parent?.remove(placeholder);
        disposeObject3D(placeholder);
      }

      const visualRoot = getNpcVisualRoot(npcGroup);
      const sprite = visualRoot.children.find((child) => child instanceof THREE.Sprite) as THREE.Sprite | undefined;
      const modelObj = instance.object;
      if (sprite && modelObj) {
        visualRoot.updateMatrixWorld(true);
        modelObj.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(modelObj);
        const center = box.getCenter(new THREE.Vector3());
        const topWorld = new THREE.Vector3(center.x, box.max.y, center.z);
        const topLocal = visualRoot.worldToLocal(topWorld);
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

  // Streaming NPC loader - loads/unloads based on intersection with routine wayboxes (ZenGin-like)
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

    if (!shouldUpdate) return;

    const loadBox = createAabbAroundPoint(cameraPos, {
      x: config.loadDistance,
      y: NPC_ACTIVE_BBOX_HALF_Y,
      z: config.loadDistance,
    });
    const unloadBox = createAabbAroundPoint(cameraPos, {
      x: config.unloadDistance,
      y: NPC_ACTIVE_BBOX_HALF_Y,
      z: config.unloadDistance,
    });

    const toLoad: string[] = [];
    for (const item of npcItemsRef.current) {
      if (loadedNpcsRef.current.has(item.id)) continue;
      if (!aabbIntersects(item.waybox, loadBox)) continue;
      toLoad.push(item.id);
    }
    toLoad.sort((a, b) => {
      const ai = Number(String(a).slice(4));
      const bi = Number(String(b).slice(4));
      if (!Number.isFinite(ai) || !Number.isFinite(bi)) return a.localeCompare(b);
      const ao = getNpcSpawnOrder(ai);
      const bo = getNpcSpawnOrder(bi);
      if (ao != null && bo != null && ao !== bo) return ao - bo;
      if (ao != null && bo == null) return -1;
      if (ao == null && bo != null) return 1;
      return ai - bi;
    });

    const toUnload: string[] = [];
    for (const id of loadedNpcsRef.current.keys()) {
      const entry = allNpcsByIdRef.current.get(id);
      if (!entry) continue;
      if (aabbIntersects(entry.waybox, unloadBox)) continue;
      toUnload.push(id);
    }

    // Load new NPCs
    for (const npcId of toLoad) {
      const npc = allNpcsByIdRef.current.get(npcId);
      if (!npc) continue;

      // Create NPC mesh imperatively
      // If multiple NPCs share the same spawn waypoint, spread them slightly in XZ so they don't start fully overlapped.
      // (ZenGin would typically resolve this via dynamic character collision; we do a simple deterministic spread here.)
      const spreadRadius = kccConfig.radius * 0.6;
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
      loadedNpcsRef.current.set(npcId, npcGroup);
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
      npcGroup.userData._kccSnapped = false;
      trySnapNpcToGroundWithRapier(npcGroup);

      // Load real model asynchronously (replaces placeholder)
      void loadNpcCharacter(npcGroup, npc.npcData);
    }

    // Unload NPCs outside the active area (with hysteresis)
    for (const npcId of toUnload) {
      const npcGroup = loadedNpcsRef.current.get(npcId);
      if (npcGroup && npcsGroupRef.current) {
        npcGroup.userData.isDisposed = true;
        removeNpcKccCollider(npcGroup);
        const npcData = npcGroup.userData.npcData as NpcData | undefined;
        if (npcData) {
          clearNpcFreepointReservations(npcData.instanceIndex);
          clearNpcEmRuntimeState(npcData.instanceIndex);
          clearNpcEmQueueState(npcData.instanceIndex);
          waypointMoverRef.current?.clearForNpc?.(npcId);
        }
        const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
        const isLoading = Boolean(npcGroup.userData.modelLoading);
        if (instance && !isLoading) instance.dispose();
        npcsGroupRef.current.remove(npcGroup);
        disposeObject3D(npcGroup);
        loadedNpcsRef.current.delete(npcId);
        if (cavalornGroupRef.current === npcGroup) cavalornGroupRef.current = null;
      }
    }
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
    {
      const vm = getRuntimeVm();
      if (vm) {
        const t = getWorldTime();
        const nowMs = Date.now();
        const groups = Array.from(loadedNpcsRef.current.values());
        groups.sort((a, b) => {
          const ia = (a?.userData?.npcData as NpcData | undefined)?.instanceIndex ?? 0;
          const ib = (b?.userData?.npcData as NpcData | undefined)?.instanceIndex ?? 0;
          const ao = getNpcSpawnOrder(ia);
          const bo = getNpcSpawnOrder(ib);
          if (ao != null && bo != null && ao !== bo) return ao - bo;
          if (ao != null && bo == null) return -1;
          if (ao == null && bo != null) return 1;
          return ia - ib;
        });
        for (const g of groups) {
          if (!g || g.userData.isDisposed) continue;
          const npcData = g.userData.npcData as NpcData | undefined;
          if (!npcData?.dailyRoutine || !npcData.symbolName) continue;

          // Unlike older spacer-web builds, we do not gate state-loop execution based on distance to the routine waypoint.
          // The original engine relies on zCEventManager job semantics (and FindSpot filtering) rather than such gating.

          const nextAt = (g.userData as any)._aiLoopNextAtMs as number | undefined;
          if (typeof nextAt === "number" && nextAt > nowMs) continue;
          (g.userData as any)._aiLoopNextAtMs = nowMs + 500; // 2Hz

          const currentTime = t.hour * 60 + t.minute;
          let desiredEntry: { state: string; waypoint: string; startM: number; stopM: number } | null = null;
          for (const r of npcData.dailyRoutine) {
            const startM = r.start_h * 60 + (r.start_m ?? 0);
            const stopM = r.stop_h * 60 + (r.stop_m ?? 0);
            const wraps = stopM < startM;
            const isActive = wraps ? currentTime >= startM || currentTime < stopM : currentTime >= startM && currentTime < stopM;
            if (isActive && r.state) {
              desiredEntry = { state: r.state, waypoint: r.waypoint, startM, stopM };
              break;
            }
          }
          if (!desiredEntry) {
            setNpcRoutineRuntime(npcData.instanceIndex, null);
            delete (g.userData as any)._aiActiveStateName;
            delete (g.userData as any)._aiActiveRoutineKey;
            delete (g.userData as any)._aiActiveRoutineWaypoint;
            delete (g.userData as any)._aiActiveRoutineStartM;
            delete (g.userData as any)._aiActiveRoutineStopM;
            continue;
          }

          const desiredKey = `${desiredEntry.state}|${(desiredEntry.waypoint || "").trim().toUpperCase()}|${desiredEntry.startM}|${desiredEntry.stopM}`;
          const currentKey = (g.userData as any)._aiActiveRoutineKey as string | undefined;
          const currentState = (g.userData as any)._aiActiveStateName as string | undefined;

          const npcId = `npc-${npcData.instanceIndex}`;
          const mover = waypointMoverRef.current;
          const moveState = mover?.getMoveState?.(npcId);
          const emJob = __getNpcEmActiveJob(npcData.instanceIndex);
          const q = __getNpcEmQueueState(npcData.instanceIndex);
          const emEmpty =
            !emJob &&
            !(moveState && moveState.done === false) &&
            !q?.clearRequested &&
            (q?.queue?.length ?? 0) === 0;

          const pending = (g.userData as any)._aiPendingRoutine as
            | { key: string; state: string; waypoint: string; startM: number; stopM: number; sinceMs: number }
            | undefined;

          const activateRoutineEntry = (
            nextState: string,
            nextKey: string,
            nextWaypoint: string,
            startM: number,
            stopM: number,
            opts?: { forceClear?: boolean }
          ) => {
            // Update the routine runtime before calling the entry function so builtins like
            // `Npc_GetDistToWP(self, self.wp)` / `AI_GotoWP(self, self.wp)` resolve to the NEW routine waypoint.
            setNpcRoutineRuntime(npcData.instanceIndex, {
              stateName: nextState,
              waypointName: nextWaypoint,
              startMinute: startM,
              stopMinute: stopM,
            });

            vm.setGlobalSelf(npcData.symbolName);

            if (opts?.forceClear) {
              requestNpcEmClear(npcData.instanceIndex);
            }

            if (currentState) {
              const endFnCandidates = [`${currentState}_end`, `${currentState}_END`];
              const endFn = endFnCandidates.find((fn) => vm.hasSymbol(fn));
              if (endFn) {
                try {
                  vm.callFunction(endFn, []);
                } catch {
                  // Ignore state-end failures; scripts expect this to be best-effort.
                }
              }
            }

            const entryFnCandidates = [nextState, nextState.toUpperCase()];
            const entryFn = entryFnCandidates.find((fn) => vm.hasSymbol(fn));
            if (entryFn) {
              try {
                vm.callFunction(entryFn, []);
              } catch {
                // Ignore entry failures; the loop tick may still be useful.
              }
            }

            (g.userData as any)._aiActiveStateName = nextState;
            (g.userData as any)._aiActiveRoutineKey = nextKey;
            (g.userData as any)._aiActiveRoutineWaypoint = (nextWaypoint || "").trim().toUpperCase();
            (g.userData as any)._aiActiveRoutineStartM = startM;
            (g.userData as any)._aiActiveRoutineStopM = stopM;
            setNpcStateTime(npcData.instanceIndex, 0);
            (g.userData as any)._aiLoopLastAtMs = nowMs;
          };

          // Advance script state time regardless of EM state (ZenGin-style: stateTime advances even while EM is busy).
          {
            const lastAt = (g.userData as any)._aiLoopLastAtMs as number | undefined;
            const dtSec = typeof lastAt === "number" ? Math.max(0, (nowMs - lastAt) / 1000) : 0;
            (g.userData as any)._aiLoopLastAtMs = nowMs;
            advanceNpcStateTime(npcData.instanceIndex, dtSec);
          }

          // ZenGin-like "EM empty" gating:
          // - don't start/switch routine states while EM is busy,
          // - don't run `_loop` while EM is busy (prevents repeated enqueue spam),
          // - defer routine changes until EM becomes empty, with a last-resort timeout.
          const FORCE_AFTER_MS = 60_000;

          if (!currentKey || !currentState) {
            if (emEmpty) {
              activateRoutineEntry(desiredEntry.state, desiredKey, desiredEntry.waypoint, desiredEntry.startM, desiredEntry.stopM);
              delete (g.userData as any)._aiPendingRoutine;
            } else {
              (g.userData as any)._aiPendingRoutine = {
                key: desiredKey,
                state: desiredEntry.state,
                waypoint: (desiredEntry.waypoint || "").trim().toUpperCase(),
                startM: desiredEntry.startM,
                stopM: desiredEntry.stopM,
                sinceMs: nowMs,
              };
              continue;
            }
          } else {
            if (currentKey !== desiredKey) {
              if (!pending || pending.key !== desiredKey) {
                (g.userData as any)._aiPendingRoutine = {
                  key: desiredKey,
                  state: desiredEntry.state,
                  waypoint: (desiredEntry.waypoint || "").trim().toUpperCase(),
                  startM: desiredEntry.startM,
                  stopM: desiredEntry.stopM,
                  sinceMs: nowMs,
                };
              }
            } else if (pending) {
              delete (g.userData as any)._aiPendingRoutine;
            }

            const p = (g.userData as any)._aiPendingRoutine as
              | { key: string; state: string; waypoint: string; startM: number; stopM: number; sinceMs: number }
              | undefined;
            if (p && p.key !== currentKey) {
              const waitedMs = Math.max(0, nowMs - (p.sinceMs ?? nowMs));
              if (emEmpty || waitedMs >= FORCE_AFTER_MS) {
                activateRoutineEntry(p.state, p.key, p.waypoint, p.startM, p.stopM, { forceClear: !emEmpty });
                delete (g.userData as any)._aiPendingRoutine;
              } else {
                // While waiting for EM to become empty, do not run the old state's loop.
                continue;
              }
            }

            if (!emEmpty) {
              // If EM is busy, do not run loop ticks for this NPC.
              continue;
            }
          }

          const runningState = ((g.userData as any)._aiActiveStateName as string | undefined) || desiredEntry.state;
          const runningWaypoint = ((g.userData as any)._aiActiveRoutineWaypoint as string | undefined) || (desiredEntry.waypoint || "").trim().toUpperCase();
          const runningStartM = (g.userData as any)._aiActiveRoutineStartM as number | undefined;
          const runningStopM = (g.userData as any)._aiActiveRoutineStopM as number | undefined;
          if (runningState && runningWaypoint) {
            setNpcRoutineRuntime(npcData.instanceIndex, {
              stateName: runningState,
              waypointName: runningWaypoint,
              startMinute: typeof runningStartM === "number" ? runningStartM : desiredEntry.startM,
              stopMinute: typeof runningStopM === "number" ? runningStopM : desiredEntry.stopM,
            });
          }

          const loopFnCandidates = [`${runningState}_loop`, `${runningState}_LOOP`];
          const loopFn = loopFnCandidates.find((fn) => vm.hasSymbol(fn));
          if (!loopFn) continue;

          vm.setGlobalSelf(npcData.symbolName);
          vm.callFunction(loopFn, []);
        }
      }
    }

    // Debug helper: teleport Cavalorn in front of the camera (manual control only).
    if (manualControlCavalornEnabled && teleportCavalornSeqAppliedRef.current !== teleportCavalornSeqRef.current) {
      const cavalorn = cavalornGroupRef.current;
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

        cavalorn.userData._kccSnapped = false;
        cavalorn.userData._kccVy = 0;
        cavalorn.userData._kccGrounded = false;
        cavalorn.userData._kccStableGrounded = false;
        cavalorn.userData._kccGroundedFor = 0;
        cavalorn.userData._kccUngroundedFor = 0;
        trySnapNpcToGroundWithRapier(cavalorn);

        persistNpcPosition(cavalorn);
        teleportCavalornSeqAppliedRef.current = teleportCavalornSeqRef.current;
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

      const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
      if (instance) {
        instance.update(delta);
      }

      const npcData = npcGroup.userData.npcData as NpcData | undefined;
      if (!npcData) continue;
      const npcId = `npc-${npcData.instanceIndex}`;
      let movedThisFrame = false;
      let locomotionMode: LocomotionMode = "idle";
      const runtimeMotionDebug = typeof window !== "undefined" && Boolean((window as any).__npcMotionDebug);
      const shouldLogMotion = (motionDebugFromQuery || runtimeMotionDebug) && cavalornGroupRef.current === npcGroup;
      trySnapNpcToGroundWithRapier(npcGroup);

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
          getFallbackAnimationModelName: (idx) => getNpcModelScriptsState(idx).baseScript,
        });
        movedThisFrame = Boolean(em.moved);
        locomotionMode = em.mode ?? "idle";
      }

      // Apply animation root motion during script-driven one-shot animations (AI_PlayAni / Npc_PlayAni).
      // This makes e.g. dance/attack "step" animations move the NPC like in the original engine.
      if (!isManualCavalorn && instance && Boolean((npcGroup.userData as any)._emSuppressLocomotion)) {
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
        let t = (ud._fallAnimT as number | undefined) ?? 0;
        t = wasFalling ? t + delta : 0;
        ud._wasFalling = true;
        ud._fallAnimT = t;
        locomotionMode = t < kccConfig.fallDownSeconds ? "fallDown" : "fall";
      }
      // Sliding has priority over walk/run/idle (but not over falling).
      else if (Boolean(npcGroup.userData.isSliding)) {
        (npcGroup.userData as any)._wasFalling = false;
        (npcGroup.userData as any)._fallAnimT = 0;
        locomotionMode = "slide";
      } else {
        (npcGroup.userData as any)._wasFalling = false;
        (npcGroup.userData as any)._fallAnimT = 0;
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

  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
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
