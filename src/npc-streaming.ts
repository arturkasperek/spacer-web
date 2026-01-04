import type { MutableRefObject } from "react";
import * as THREE from "three";
import type { World } from "@kolarz3/zenkit";
import { disposeObject3D, shouldUpdateStreaming, type StreamingState } from "./distance-streaming";
import type { NpcData } from "./types";
import { isCavalornNpcData } from "./npc-renderer-utils";
import { aabbIntersects, createAabbAroundPoint, type Aabb } from "./npc-routine-waybox";
import { createNpcMesh } from "./npc-utils";
import { spreadSpawnXZ } from "./npc-spawn-spread";
import { getNpcSpawnOrder } from "./vm-manager";
import { clearNpcFreepointReservations } from "./npc-freepoints";
import { clearNpcEmRuntimeState } from "./npc-em-runtime";
import { clearNpcEmQueueState } from "./npc-em-queue";
import type { CharacterInstance } from "./character/character-instance.js";
import type { WaypointMover } from "./npc-waypoint-mover";

export function updateNpcStreaming({
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
  cavalornGroupRef,
  manualControlCavalornEnabled,
  NPC_LOAD_DISTANCE,
  NPC_UNLOAD_DISTANCE,
  NPC_ACTIVE_BBOX_HALF_Y,
}: {
  enabled: boolean;
  world: World | null;
  cameraPosition: THREE.Vector3 | undefined;
  camera: THREE.Camera | undefined;
  streamingState: MutableRefObject<StreamingState>;
  npcItemsRef: MutableRefObject<Array<{ id: string; waybox: Aabb }>>;
  loadedNpcsRef: MutableRefObject<Map<string, THREE.Group>>;
  allNpcsRef: MutableRefObject<Array<{ npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>>;
  allNpcsByIdRef: MutableRefObject<Map<string, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>>;
  npcsGroupRef: MutableRefObject<THREE.Group | null>;
  scene: THREE.Scene;
  kccConfig: { radius: number };
  applyMoveConstraint: (npcGroup: THREE.Group, desiredX: number, desiredZ: number, dt: number) => { blocked: boolean; moved: boolean };
  trySnapNpcToGroundWithRapier: (npcGroup: THREE.Group) => boolean;
  loadNpcCharacter: (npcGroup: THREE.Group, npcData: NpcData) => Promise<void> | void;
  removeNpcKccCollider: (npcGroup: THREE.Object3D) => void;
  waypointMoverRef: MutableRefObject<WaypointMover | null>;
  cavalornGroupRef: MutableRefObject<THREE.Group | null>;
  manualControlCavalornEnabled: boolean;
  NPC_LOAD_DISTANCE: number;
  NPC_UNLOAD_DISTANCE: number;
  NPC_ACTIVE_BBOX_HALF_Y: number;
}) {
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

  const { shouldUpdate, cameraPos } = shouldUpdateStreaming(streamingState.current, effectiveCameraPos, config);

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
    // Never unload the manually-controlled player character; otherwise, moving the camera away from
    // the routine waybox would despawn Cavalorn and make long-range teleports impossible.
    if (manualControlCavalornEnabled) {
      const g = loadedNpcsRef.current.get(id);
      const npcData = g?.userData?.npcData as NpcData | undefined;
      if ((g?.userData as any)?.isCavalorn === true || isCavalornNpcData(npcData) || isCavalornNpcData(entry.npcData)) {
        continue;
      }
    }
    toUnload.push(id);
  }

  // Ensure Cavalorn is always loadable when manual control is enabled, even if the camera is far from his routine waybox.
  if (manualControlCavalornEnabled && cavalornGroupRef.current == null) {
    for (const [id, entry] of allNpcsByIdRef.current.entries()) {
      if (!isCavalornNpcData(entry.npcData)) continue;
      if (!loadedNpcsRef.current.has(id) && !toLoad.includes(id)) toLoad.push(id);
      break;
    }
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
      if (isCavalornNpcData(npc.npcData)) {
        npcGroup.userData.isCavalorn = true;
        cavalornGroupRef.current = npcGroup;
      }
    }

    // Ensure NPCs group exists
    if (!npcsGroupRef.current) {
      const group = new THREE.Group();
      group.name = "NPCs";
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
}

