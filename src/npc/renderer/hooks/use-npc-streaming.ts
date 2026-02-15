import { useCallback, type MutableRefObject } from "react";
import type * as THREE from "three";
import { updateNpcStreaming as updateNpcStreamingImpl } from "../../world/npc-streaming";
import type { Aabb } from "../../world/npc-routine-waybox";
import type { NpcData } from "../../../types";

export function useNpcStreaming(params: {
  enabled: boolean;
  world: any;
  cameraPosition: THREE.Vector3 | undefined;
  camera: THREE.Camera;
  streamingState: MutableRefObject<any>;
  npcItemsRef: MutableRefObject<Array<{ id: string; waybox: Aabb }>>;
  loadedNpcsRef: MutableRefObject<Map<string, THREE.Group>>;
  allNpcsRef: MutableRefObject<Array<{ npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>>;
  allNpcsByIdRef: MutableRefObject<
    Map<string, { npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>
  >;
  npcsGroupRef: MutableRefObject<THREE.Group | null>;
  scene: THREE.Scene;
  kccConfig: any;
  applyMoveConstraint: (npcGroup: THREE.Group, x: number, z: number, dt: number) => any;
  trySnapNpcToGroundWithRapier: (npcGroup: THREE.Group) => boolean;
  loadNpcCharacter: (npcGroup: THREE.Group, npcData: NpcData) => Promise<any>;
  removeNpcKccCollider: (npcGroup: THREE.Object3D) => void;
  waypointMoverRef: MutableRefObject<any>;
  playerGroupRef: MutableRefObject<THREE.Group | null>;
  manualControlHeroEnabled: boolean;
  waypointDirIndex: Map<string, THREE.Quaternion>;
  vobDirIndex: Map<string, THREE.Quaternion>;
  npcLoadDistance: number;
  npcUnloadDistance: number;
  npcActiveBboxHalfY: number;
}) {
  return useCallback(() => {
    return updateNpcStreamingImpl({
      enabled: params.enabled,
      world: params.world,
      cameraPosition: params.cameraPosition,
      camera: params.camera,
      streamingState: params.streamingState,
      npcItemsRef: params.npcItemsRef,
      loadedNpcsRef: params.loadedNpcsRef,
      allNpcsRef: params.allNpcsRef,
      allNpcsByIdRef: params.allNpcsByIdRef,
      npcsGroupRef: params.npcsGroupRef,
      scene: params.scene,
      kccConfig: params.kccConfig,
      applyMoveConstraint: params.applyMoveConstraint,
      trySnapNpcToGroundWithRapier: params.trySnapNpcToGroundWithRapier,
      loadNpcCharacter: params.loadNpcCharacter,
      removeNpcKccCollider: params.removeNpcKccCollider,
      waypointMoverRef: params.waypointMoverRef,
      playerGroupRef: params.playerGroupRef,
      manualControlHeroEnabled: params.manualControlHeroEnabled,
      waypointDirIndex: params.waypointDirIndex,
      vobDirIndex: params.vobDirIndex,
      NPC_LOAD_DISTANCE: params.npcLoadDistance,
      NPC_UNLOAD_DISTANCE: params.npcUnloadDistance,
      NPC_ACTIVE_BBOX_HALF_Y: params.npcActiveBboxHalfY,
    });
  }, [
    params.enabled,
    params.world,
    params.cameraPosition,
    params.camera,
    params.streamingState,
    params.npcItemsRef,
    params.loadedNpcsRef,
    params.allNpcsRef,
    params.allNpcsByIdRef,
    params.npcsGroupRef,
    params.scene,
    params.kccConfig,
    params.applyMoveConstraint,
    params.trySnapNpcToGroundWithRapier,
    params.loadNpcCharacter,
    params.removeNpcKccCollider,
    params.waypointMoverRef,
    params.playerGroupRef,
    params.manualControlHeroEnabled,
    params.waypointDirIndex,
    params.vobDirIndex,
    params.npcLoadDistance,
    params.npcUnloadDistance,
    params.npcActiveBboxHalfY,
  ]);
}
