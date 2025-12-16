import { useMemo, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { World, ZenKit } from '@kolarz3/zenkit';
import { createStreamingState, shouldUpdateStreaming, getItemsToLoadUnload, disposeObject3D } from './distance-streaming';
import type { NpcData } from './types';
import { findActiveRoutineWaypoint, getMapKey, createNpcMesh } from './npc-utils';
import { findVobByName } from './vob-utils';
import { createHumanCharacterInstance, type CharacterCaches, type CharacterInstance } from './character/human-character.js';
import { preloadAnimationSequences } from "./character/animation.js";
import { createHumanLocomotionController, HUMAN_LOCOMOTION_PRELOAD_ANIS, type LocomotionController, type LocomotionMode } from "./npc-locomotion";
import { createWaypointMover, type WaypointMover } from "./npc-waypoint-mover";
import { WORLD_MESH_NAME, setObjectOriginOnFloor } from "./ground-snap";
import {
  collectNpcWorldCollisionDebugSnapshot,
  applyNpcWorldCollisionXZ,
  createNpcWorldCollisionContext,
  updateNpcSlopeSlideXZ,
  type NpcMoveConstraintResult,
  type NpcWorldCollisionConfig,
} from "./npc-world-collision";
import { getNpcCollisionDumpSeq } from "./npc-collision-debug";

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
  const didPreloadAnimationsRef = useRef(false);
  const waypointMoverRef = useRef<WaypointMover | null>(null);
  const worldMeshRef = useRef<THREE.Object3D | null>(null);
  const warnedNoWorldMeshRef = useRef(false);
  const pendingGroundSnapRef = useRef<THREE.Group[]>([]);
  const cavalornGroupRef = useRef<THREE.Group | null>(null);
  const collisionCtx = useMemo(() => createNpcWorldCollisionContext(), []);
  const collisionDumpSeqRef = useRef(0);
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
      const fallback = Math.min(89, walkDeg + 20);
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
    shift: false,
  });
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
          manualKeysRef.current.shift = pressed;
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

  // Convert NPC data to renderable NPCs with spawnpoint positions (only compute positions, not render)
  const npcsWithPositions = useMemo(() => {
    if (!world || !enabled || npcs.size === 0) {
      return [];
    }

    const renderableNpcs: Array<{ npcData: NpcData; position: THREE.Vector3 }> = [];
    const CURRENT_HOUR = 10; // Assume current time is 10:00
    const CURRENT_MINUTE = 0;

    for (const [, npcData] of npcs.entries()) {
      let position: [number, number, number] | null = null;
      let waypointName: string | null = null;

      // Priority 1: Check routine waypoint at current time (10:00)
      const routineWaypoint = findActiveRoutineWaypoint(npcData.dailyRoutine, CURRENT_HOUR, CURRENT_MINUTE);
      if (routineWaypoint) {
        waypointName = routineWaypoint;
      } else {
        // Priority 2: Fall back to spawnpoint if no routine is active
        waypointName = npcData.spawnpoint;
      }

      // First, try to find waypoint by name (matching original engine behavior)
      const wpResult = world.findWaypointByName(waypointName);

      if (wpResult.success && wpResult.data) {
        const wp = wpResult.data;
        // Convert Gothic coordinates to Three.js coordinates: (-x, y, z)
        position = [
          -wp.position.x,
          wp.position.y,
          wp.position.z
        ];
      } else {
        // If waypoint not found, try to find VOB by name (fallback)
        const vobs = world.getVobs();
        const vobCount = vobs.size();

        for (let i = 0; i < vobCount; i++) {
          const rootVob = vobs.get(i);
          const foundVob = findVobByName(rootVob, waypointName);

          if (foundVob) {
            // Convert Gothic coordinates to Three.js coordinates: (-x, y, z)
            position = [
              -foundVob.position.x,
              foundVob.position.y,
              foundVob.position.z
            ];
            break;
          }
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
  }, [world, npcsKey, enabled]);

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
    }
    allNpcsByIdRef.current = byId;
    allNpcsByInstanceIndexRef.current = byIdx;
    npcItemsRef.current = items;
  }, [npcsWithPositions]);

  useEffect(() => {
    waypointMoverRef.current = world ? createWaypointMover(world) : null;
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
    const ground = ensureWorldMesh();
    if (!ground) {
      const beforeX = npcGroup.position.x;
      const beforeZ = npcGroup.position.z;
      npcGroup.position.x = desiredX;
      npcGroup.position.z = desiredZ;
      const moved = Math.abs(npcGroup.position.x - beforeX) > 1e-6 || Math.abs(npcGroup.position.z - beforeZ) > 1e-6;
      return { blocked: false, moved };
    }
    return applyNpcWorldCollisionXZ(collisionCtx, npcGroup, desiredX, desiredZ, ground, dt, collisionConfig);
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

      const symbolName = (npcData.symbolName || "").trim().toUpperCase();
      const displayName = (npcData.name || "").trim().toUpperCase();
      const isCavalorn = symbolName.includes("CAVALORN") || displayName === "CAVALORN";
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
        const npcGroup = createNpcMesh(npc.npcData, npc.position);
        loadedNpcsRef.current.set(item.id, npcGroup);
        npcGroup.userData.moveConstraint = applyMoveConstraint;
        {
          const symbolName = (npc.npcData.symbolName || "").trim().toUpperCase();
          const displayName = (npc.npcData.name || "").trim().toUpperCase();
          const isCavalorn = symbolName.includes("CAVALORN") || displayName === "CAVALORN";
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

          const speed = keys.shift ? manualControlSpeeds.run : manualControlSpeeds.walk;
          const desiredX = npcGroup.position.x + tmpManualDir.x * speed * dt;
          const desiredZ = npcGroup.position.z + tmpManualDir.z * speed * dt;
          const r = applyMoveConstraint(npcGroup, desiredX, desiredZ, dt);
          if (r.moved) npcGroup.userData.lastMoveDirXZ = { x: tmpManualDir.x, z: tmpManualDir.z };

          const yaw = Math.atan2(tmpManualDir.x, tmpManualDir.z);
          tmpManualDesiredQuat.setFromAxisAngle(tmpManualUp, yaw);
          const t = 1 - Math.exp(-10 * dt);
          npcGroup.quaternion.slerp(tmpManualDesiredQuat, t);

          movedThisFrame = movedThisFrame || r.moved;
        }

        locomotionMode = movedThisFrame ? (manualKeysRef.current.shift ? "run" : "walk") : "idle";
      } else {
        const moveResult = waypointMoverRef.current?.update(npcId, npcGroup, delta);
        movedThisFrame = Boolean(moveResult?.moved);
        locomotionMode = moveResult?.mode ?? "idle";
        tryingToMoveThisFrame = locomotionMode !== "idle";
      }

      // ZenGin-like slope sliding:
      // if the ground is steeper than `maxGroundAngleRad`, the character can't walk up and will slip down,
      // playing `s_Slide` / `s_SlideB` while the slide is active.
      {
        const shouldConsiderSlide =
          isManualCavalorn || Boolean(npcGroup.userData.isScriptControlled) || tryingToMoveThisFrame || Boolean(npcGroup.userData.isSliding);
        if (shouldConsiderSlide) {
          const ground = ensureWorldMesh();
          if (ground) {
            const s = updateNpcSlopeSlideXZ(collisionCtx, npcGroup, ground, delta, collisionConfig);
            if (s.active) {
              movedThisFrame = movedThisFrame || s.moved;
              tryingToMoveThisFrame = true;
              locomotionMode = s.mode;
            }
          }
        }
      }

      if (instance) {
        const locomotion = npcGroup.userData.locomotion as LocomotionController | undefined;
        locomotion?.update(instance, locomotionMode);
      }

      // Keep NPCs glued to the ground while moving, and also while *trying* to move:
      // if we get blocked on stairs/walls, Y can otherwise stay stale (and we never recover).
      if (movedThisFrame || tryingToMoveThisFrame) {
        // Keep moving NPCs glued to the ground (throttled) even if waypoint Y is slightly off.
        const ground = ensureWorldMesh();
        if (ground) {
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
            const predicted = predictGroundYFromPlane(plane, npcGroup.position.x, npcGroup.position.z);
            if (predicted != null) {
              npcGroup.userData.groundYTarget = predicted;
            }
          }

          if (now - lastSample >= SAMPLE_INTERVAL) {
            npcGroup.userData.lastGroundSampleAt = now;
            npcGroup.getWorldPosition(tmpGroundSampleWorldPos);
            const minWalkableNy = Math.cos(collisionConfig.maxGroundAngleRad);
            const minSlideNy = Math.cos(collisionConfig.maxSlideAngleRad);
            const hit =
              sampleGroundHitForMove(tmpGroundSampleWorldPos, ground, {
                clearance: 4,
                rayStartAbove: 50,
                maxDownDistance: 5000,
                preferClosestToY: tmpGroundSampleWorldPos.y,
                // Prefer only walkable surfaces as "floor" (avoid snapping to walls/risers/undersides).
                minHitNormalY: minWalkableNy,
              }) ||
              // If no walkable surface exists, accept steeper "ground" up to slide2 threshold so the NPC
              // can transition into slope sliding instead of getting stuck with a stale floor plane.
              (minSlideNy < minWalkableNy
                ? sampleGroundHitForMove(tmpGroundSampleWorldPos, ground, {
                    clearance: 4,
                    rayStartAbove: 50,
                    maxDownDistance: 5000,
                    preferClosestToY: tmpGroundSampleWorldPos.y,
                    minHitNormalY: minSlideNy,
                  })
                : null);
            if (hit) {
              const targetY = hit.targetY;
              // Avoid snapping to far-away floors/ceilings (ZenGin has similar step-height gating).
              const MAX_STEP_UP = 250;
              const MAX_STEP_DOWN = 800;
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

    // One-shot debug dump (button-triggered).
    const dumpSeq = getNpcCollisionDumpSeq();
    if (dumpSeq !== collisionDumpSeqRef.current) {
      collisionDumpSeqRef.current = dumpSeq;
      const cavalorn = cavalornGroupRef.current;
      const ground = ensureWorldMesh();
      if (cavalorn && ground) {
        const moveDirXZ = (cavalorn.userData.lastMoveDirXZ as { x: number; z: number } | undefined) ?? null;
        const snapshot = collectNpcWorldCollisionDebugSnapshot(collisionCtx, cavalorn, ground, moveDirXZ, collisionConfig);
        try {
          console.log("[NPCCollisionDebugJSON]" + JSON.stringify(snapshot));
        } catch (e) {
          console.log("[NPCCollisionDebugJSON]" + JSON.stringify({ error: String(e) }));
        }
      } else {
        console.log("[NPCCollisionDebugJSON]" + JSON.stringify({ error: "Cavalorn or WORLD_MESH not ready" }));
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
