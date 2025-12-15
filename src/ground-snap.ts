import * as THREE from "three";

export const WORLD_MESH_NAME = "WORLD_MESH";

export type SetOnFloorOptions = {
  maxDownDistance?: number;
  rayStartAbove?: number;
  clearance?: number;
};

export function findWorldMesh(scene: unknown): THREE.Object3D | null {
  const s: any = scene;
  if (!s) return null;
  if (typeof s.getObjectByName === "function") {
    return s.getObjectByName(WORLD_MESH_NAME) ?? null;
  }
  return null;
}

export function setObjectOriginOnFloor(object: THREE.Object3D, ground: THREE.Object3D, options?: SetOnFloorOptions): boolean {
  const AnyTHREE: any = THREE as any;
  if (!AnyTHREE.Raycaster) return false;

  object.updateMatrixWorld(true);
  ground.updateMatrixWorld(true);

  const maxDownDistance = options?.maxDownDistance ?? 10000;
  const rayStartAbove = options?.rayStartAbove ?? 1000;
  const clearance = options?.clearance ?? 4;

  const objWorldPos = new THREE.Vector3();
  object.getWorldPosition(objWorldPos);

  const rayOrigin = objWorldPos.clone();
  rayOrigin.y += rayStartAbove;
  const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, rayStartAbove + maxDownDistance);
  const hits = raycaster.intersectObject(ground, true);
  if (!hits.length) return false;

  const hitY = hits[0].point.y;
  const desiredWorldPos = objWorldPos.clone();
  desiredWorldPos.y = hitY + clearance;

  if (!object.parent) {
    object.position.y = desiredWorldPos.y;
    return true;
  }

  const localBefore = object.parent.worldToLocal(objWorldPos.clone());
  const localAfter = object.parent.worldToLocal(desiredWorldPos.clone());
  const localDelta = localAfter.sub(localBefore);
  object.position.add(localDelta);
  return true;
}

export function setObjectOnFloor(object: THREE.Object3D, ground: THREE.Object3D, options?: SetOnFloorOptions): boolean {
  const AnyTHREE: any = THREE as any;
  if (!AnyTHREE.Box3 || !AnyTHREE.Raycaster) return false;

  object.updateMatrixWorld(true);
  const maxDownDistance = options?.maxDownDistance ?? 10000;
  const rayStartAbove = options?.rayStartAbove ?? 1000;
  const clearance = options?.clearance ?? 4;

  const bbox = new THREE.Box3().setFromObject(object);
  const objWorldPos = new THREE.Vector3();
  object.getWorldPosition(objWorldPos);

  const diff = objWorldPos.y - bbox.min.y;

  const rayOrigin = objWorldPos.clone();
  rayOrigin.y += rayStartAbove;
  const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, rayStartAbove + maxDownDistance);

  ground.updateMatrixWorld(true);
  const hits = raycaster.intersectObject(ground, true);
  if (!hits.length) return false;

  const hitY = hits[0].point.y;
  const desiredWorldPos = objWorldPos.clone();
  desiredWorldPos.y = hitY + diff + clearance;

  if (!object.parent) {
    object.position.y = desiredWorldPos.y;
    return true;
  }

  // Apply delta in local space so we preserve the desired world-space X/Z even if the parent is transformed.
  const localBefore = object.parent.worldToLocal(objWorldPos.clone());
  const localAfter = object.parent.worldToLocal(desiredWorldPos.clone());
  const localDelta = localAfter.sub(localBefore);
  object.position.add(localDelta);
  return true;
}

export function setObjectOriginOnFloorInScene(object: THREE.Object3D, scene: unknown, options?: SetOnFloorOptions): boolean {
  const ground = findWorldMesh(scene);
  if (!ground) return false;
  return setObjectOriginOnFloor(object, ground, options);
}

export function setObjectOnFloorInScene(object: THREE.Object3D, scene: unknown, options?: SetOnFloorOptions): boolean {
  const ground = findWorldMesh(scene);
  if (!ground) return false;
  return setObjectOnFloor(object, ground, options);
}
