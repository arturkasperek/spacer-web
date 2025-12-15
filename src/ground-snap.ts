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
  /**
   * Optional Raycaster instance to reuse between calls (avoids per-call allocations).
   */
  raycaster?: THREE.Raycaster;
  /**
   * Whether to recurse into children for raycasts (default: true).
   */
  recursive?: boolean;
  /**
   * Hint for BVH-accelerated raycasts: return only the closest hit.
   * Ignored by Three.js default raycast.
   */
  firstHitOnly?: boolean;
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

  const objWorldPos = new THREE.Vector3();
  object.getWorldPosition(objWorldPos);

  const targetY = getGroundHitY(objWorldPos, ground, options);
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
  const recursive = options?.recursive ?? true;
  const firstHitOnly = options?.firstHitOnly ?? false;

  const raycaster = options?.raycaster ?? new THREE.Raycaster();
  const prevFirstHitOnly = (raycaster as any).firstHitOnly;
  if (firstHitOnly) {
    (raycaster as any).firstHitOnly = true;
  }
  raycaster.ray.origin.set(worldPos.x, worldPos.y + rayStartAbove, worldPos.z);
  raycaster.ray.direction.set(0, -1, 0);
  raycaster.near = 0;
  raycaster.far = rayStartAbove + maxDownDistance;
  ground.updateMatrixWorld(true);
  const hits = raycaster.intersectObject(ground, recursive);
  if (firstHitOnly) {
    (raycaster as any).firstHitOnly = prevFirstHitOnly;
  }
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
  const recursive = options?.recursive ?? true;
  const firstHitOnly = options?.firstHitOnly ?? false;
  const raycaster = options?.raycaster ?? new THREE.Raycaster();
  const prevFirstHitOnly = (raycaster as any).firstHitOnly;
  if (firstHitOnly) (raycaster as any).firstHitOnly = true;

  const bbox = new THREE.Box3().setFromObject(object);
  const objWorldPos = new THREE.Vector3();
  object.getWorldPosition(objWorldPos);

  const diff = objWorldPos.y - bbox.min.y;

  const rayOrigin = objWorldPos.clone();
  rayOrigin.y += rayStartAbove;
  raycaster.ray.origin.copy(rayOrigin);
  raycaster.ray.direction.set(0, -1, 0);
  raycaster.near = 0;
  raycaster.far = rayStartAbove + maxDownDistance;

  ground.updateMatrixWorld(true);
  const hits = raycaster.intersectObject(ground, recursive);
  if (firstHitOnly) (raycaster as any).firstHitOnly = prevFirstHitOnly;
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
