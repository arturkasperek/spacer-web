import * as THREE from "three";

export const WORLD_MESH_NAME = "WORLD_MESH";

export type SetOnFloorOptions = {
  maxDownDistance?: number;
  rayStartAbove?: number;
  clearance?: number;
  minHitNormalY?: number;
  /**
   * If provided, pick the ray hit whose Y is closest to this reference height.
   * Useful when multiple surfaces exist above/below (e.g. bridges/ceilings).
   */
  preferClosestToY?: number;
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

  const targetY = getGroundHitY(objWorldPos, ground, { maxDownDistance, rayStartAbove, clearance });
  if (targetY == null) return false;
  const desiredWorldPos = objWorldPos.clone();
  desiredWorldPos.y = targetY;

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

export function getGroundHitY(worldPos: THREE.Vector3, ground: THREE.Object3D, options?: SetOnFloorOptions): number | null {
  const AnyTHREE: any = THREE as any;
  if (!AnyTHREE.Raycaster) return null;

  const maxDownDistance = options?.maxDownDistance ?? 10000;
  const rayStartAbove = options?.rayStartAbove ?? 1000;
  const clearance = options?.clearance ?? 4;
  const minHitNormalY = options?.minHitNormalY;
  const preferClosestToY = options?.preferClosestToY;

  const rayOrigin = worldPos.clone();
  rayOrigin.y = worldPos.y + rayStartAbove;
  const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, rayStartAbove + maxDownDistance);
  ground.updateMatrixWorld(true);
  const hits = raycaster.intersectObject(ground, true);
  if (!hits.length) return null;

  const pickClosest = (candidateHits: typeof hits) => {
    if (!candidateHits.length) return null;
    if (typeof preferClosestToY !== "number") return candidateHits[0];
    let best = candidateHits[0];
    let bestScore = Math.abs((best.point?.y ?? 0) + clearance - preferClosestToY);
    for (let i = 1; i < candidateHits.length; i++) {
      const h = candidateHits[i];
      const score = Math.abs((h.point?.y ?? 0) + clearance - preferClosestToY);
      if (score < bestScore) {
        best = h;
        bestScore = score;
      }
    }
    return best;
  };

  if (typeof minHitNormalY === "number") {
    const candidates: typeof hits = [];
    for (const hit of hits) {
      const faceNormal = hit.face?.normal;
      if (!faceNormal) {
        candidates.push(hit);
        continue;
      }
      const n = faceNormal.clone();
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      n.applyMatrix3(normalMatrix).normalize();
      if (n.y >= minHitNormalY) candidates.push(hit);
    }
    const best = pickClosest(candidates);
    return best ? best.point.y + clearance : null;
  }

  const best = pickClosest(hits);
  return best ? best.point.y + clearance : null;
}

export function setObjectOnFloor(object: THREE.Object3D, ground: THREE.Object3D, options?: SetOnFloorOptions): boolean {
  const AnyTHREE: any = THREE as any;
  if (!AnyTHREE.Box3 || !AnyTHREE.Raycaster) return false;

  object.updateMatrixWorld(true);
  const maxDownDistance = options?.maxDownDistance ?? 10000;
  const rayStartAbove = options?.rayStartAbove ?? 1000;
  const clearance = options?.clearance ?? 4;
  const minHitNormalY = options?.minHitNormalY;

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

  let hitY: number | null = null;
  if (typeof minHitNormalY === "number") {
    for (const hit of hits) {
      const faceNormal = hit.face?.normal;
      if (!faceNormal) {
        hitY = hit.point.y;
        break;
      }
      const n = faceNormal.clone();
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      n.applyMatrix3(normalMatrix).normalize();
      if (n.y >= minHitNormalY) {
        hitY = hit.point.y;
        break;
      }
    }
    if (hitY == null) return false;
  } else {
    hitY = hits[0].point.y;
  }
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
