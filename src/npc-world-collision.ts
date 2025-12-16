import * as THREE from "three";

export type NpcWorldCollisionConfig = {
  radius: number;
  scanHeight: number;
  scanHeights?: number[];
  stepHeight: number;
  maxGroundAngleRad: number;
  minWallNormalY: number;
  enableWallSlide: boolean;
};

export type NpcWorldCollisionContext = {
  raycaster: THREE.Raycaster;
  normalMatrix: THREE.Matrix3;
  tmpOrigin: THREE.Vector3;
  tmpDir: THREE.Vector3;
  tmpNormal: THREE.Vector3;
  tmpPlanarNormal: THREE.Vector3;
  tmpNext: THREE.Vector3;
};

export function createNpcWorldCollisionContext(): NpcWorldCollisionContext {
  const raycaster = new THREE.Raycaster();
  // When world mesh has BVH acceleratedRaycast, this speeds up intersections.
  (raycaster as any).firstHitOnly = true;
  return {
    raycaster,
    normalMatrix: new THREE.Matrix3(),
    tmpOrigin: new THREE.Vector3(),
    tmpDir: new THREE.Vector3(),
    tmpNormal: new THREE.Vector3(),
    tmpPlanarNormal: new THREE.Vector3(),
    tmpNext: new THREE.Vector3(),
  };
}

const predictGroundYFromPlane = (
  plane: { nx: number; ny: number; nz: number; px: number; py: number; pz: number; clearance: number },
  x: number,
  z: number
): number | null => {
  const ny = plane.ny;
  if (!Number.isFinite(ny) || Math.abs(ny) < 1e-6) return null;
  const dx = x - plane.px;
  const dz = z - plane.pz;
  const y = plane.py - (plane.nx * dx + plane.nz * dz) / ny;
  if (!Number.isFinite(y)) return null;
  return y + plane.clearance;
};

const worldNormalFromHit = (ctx: NpcWorldCollisionContext, hit: THREE.Intersection): THREE.Vector3 | null => {
  const faceNormal = hit.face?.normal;
  if (!faceNormal) return null;
  ctx.tmpNormal.copy(faceNormal);
  ctx.normalMatrix.getNormalMatrix(hit.object.matrixWorld);
  ctx.tmpNormal.applyMatrix3(ctx.normalMatrix).normalize();
  return ctx.tmpNormal;
};

export type NpcMoveConstraintResult = { blocked: boolean; moved: boolean };

const shouldTreatAsObstacle = (normalY: number, sampleHeight: number, config: NpcWorldCollisionConfig) => {
  // At torso/head heights we treat *any* horizontal intersection as an obstacle.
  // This catches cases where only the upper body clips into steep terrain/overhangs.
  if (sampleHeight >= config.scanHeight) return true;
  // Near-feet probes ignore "ground-like" surfaces but still react to steep faces/walls.
  return normalY <= config.minWallNormalY;
};

const orientNormalAgainstRayXZ = (nx: number, ny: number, nz: number, rayDirX: number, rayDirZ: number) => {
  // World meshes can have inconsistent winding; ensure the normal points *against* our incoming ray in XZ.
  // This makes push-out and wall-slide direction stable.
  const d = nx * rayDirX + nz * rayDirZ;
  if (d > 0) return { nx: -nx, ny: -ny, nz: -nz };
  return { nx, ny, nz };
};

export type NpcCollisionDebugRayHit = {
  distance: number;
  point: { x: number; y: number; z: number };
  normal?: { x: number; y: number; z: number };
  faceIndex?: number | null;
  objectName?: string;
};

export type NpcCollisionDebugRaySample = {
  origin: { x: number; y: number; z: number };
  dir: { x: number; y: number; z: number };
  height: number;
  lateral: number;
  hits: NpcCollisionDebugRayHit[];
};

export function collectNpcCollisionRayDebug(
  ctx: NpcWorldCollisionContext,
  worldMesh: THREE.Object3D,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  options: { maxHits?: number; far?: number }
): NpcCollisionDebugRayHit[] {
  const raycaster = ctx.raycaster;
  const prevFirstHitOnly = (raycaster as any).firstHitOnly;
  (raycaster as any).firstHitOnly = false;
  raycaster.ray.origin.copy(origin);
  raycaster.ray.direction.copy(dir);
  raycaster.near = 0;
  raycaster.far = options.far ?? 500;
  const hits = raycaster.intersectObject(worldMesh, true);
  (raycaster as any).firstHitOnly = prevFirstHitOnly;

  const maxHits = Math.max(1, options.maxHits ?? 6);
  const out: NpcCollisionDebugRayHit[] = [];
  for (const h of hits.slice(0, maxHits)) {
    const n = worldNormalFromHit(ctx, h);
    out.push({
      distance: Number(h.distance.toFixed(3)),
      point: { x: Number(h.point.x.toFixed(3)), y: Number(h.point.y.toFixed(3)), z: Number(h.point.z.toFixed(3)) },
      normal: n ? { x: Number(n.x.toFixed(3)), y: Number(n.y.toFixed(3)), z: Number(n.z.toFixed(3)) } : undefined,
      faceIndex: (h as any).faceIndex ?? null,
      objectName: h.object?.name || undefined,
    });
  }
  return out;
}

export function collectNpcWorldCollisionDebugSnapshot(
  ctx: NpcWorldCollisionContext,
  npcGroup: THREE.Object3D,
  worldMesh: THREE.Object3D,
  moveDirXZ: { x: number; z: number } | null,
  config: NpcWorldCollisionConfig
): {
  atMs: number;
  npcPos: { x: number; y: number; z: number };
  groundYTarget?: number;
  groundPlane?: unknown;
  moveDirXZ: { x: number; z: number } | null;
  forwardSamples: NpcCollisionDebugRaySample[];
  radialProbes: NpcCollisionDebugRaySample[];
  config: NpcWorldCollisionConfig;
} {
  const heights = config.scanHeights?.length ? config.scanHeights : [config.scanHeight];
  const forward = new THREE.Vector3(moveDirXZ?.x ?? 0, 0, moveDirXZ?.z ?? 0);
  if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
  forward.normalize();

  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const lateral = config.radius * 0.75;
  const lateralOffsets = [0, lateral, -lateral];

  const base = npcGroup.position;
  const forwardSamples: NpcCollisionDebugRaySample[] = [];
  for (const hY of heights) {
    for (const off of lateralOffsets) {
      const o = new THREE.Vector3(base.x + right.x * off, base.y + hY, base.z + right.z * off);
      forwardSamples.push({
        origin: { x: Number(o.x.toFixed(3)), y: Number(o.y.toFixed(3)), z: Number(o.z.toFixed(3)) },
        dir: { x: Number(forward.x.toFixed(3)), y: 0, z: Number(forward.z.toFixed(3)) },
        height: hY,
        lateral: Number(off.toFixed(3)),
        hits: collectNpcCollisionRayDebug(ctx, worldMesh, o, forward, { far: 400, maxHits: 8 }),
      });
    }
  }

  // Radial probes to detect penetrations when standing still / non-forward collisions.
  const radialProbes: NpcCollisionDebugRaySample[] = [];
  const probeFar = config.radius + 50;
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const d = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    for (const hY of heights) {
      const o = new THREE.Vector3(base.x, base.y + hY, base.z);
      radialProbes.push({
        origin: { x: Number(o.x.toFixed(3)), y: Number(o.y.toFixed(3)), z: Number(o.z.toFixed(3)) },
        dir: { x: Number(d.x.toFixed(3)), y: 0, z: Number(d.z.toFixed(3)) },
        height: hY,
        lateral: 0,
        hits: collectNpcCollisionRayDebug(ctx, worldMesh, o, d, { far: probeFar, maxHits: 6 }),
      });
    }
  }

  return {
    atMs: Date.now(),
    npcPos: { x: base.x, y: base.y, z: base.z },
    groundYTarget: (npcGroup.userData as any).groundYTarget as number | undefined,
    groundPlane: (npcGroup.userData as any).groundPlane,
    moveDirXZ,
    forwardSamples,
    radialProbes,
    config,
  };
}

export function applyNpcWorldCollisionXZ(
  ctx: NpcWorldCollisionContext,
  npcGroup: THREE.Object3D,
  desiredX: number,
  desiredZ: number,
  worldMesh: THREE.Object3D,
  _deltaSeconds: number,
  config: NpcWorldCollisionConfig
): NpcMoveConstraintResult {
  const fromX = npcGroup.position.x;
  const fromZ = npcGroup.position.z;
  const dx = desiredX - fromX;
  const dz = desiredZ - fromZ;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-8) return { blocked: false, moved: false };

  // Step/slope gating based on the last sampled ground triangle plane (updated by ground snapping).
  const plane = (npcGroup.userData as any).groundPlane as
    | { nx: number; ny: number; nz: number; px: number; py: number; pz: number; clearance: number }
    | undefined;
  const currentGroundY = (npcGroup.userData as any).groundYTarget as number | undefined;
  if (plane && typeof currentGroundY === "number") {
    const predicted = predictGroundYFromPlane(plane, desiredX, desiredZ);
    if (predicted != null) {
      const dy = predicted - currentGroundY;
      if (dy > config.stepHeight) return { blocked: true, moved: false };

      const minNormalY = Math.cos(config.maxGroundAngleRad);
      // Only block steep slopes when going uphill (otherwise descending would feel artificially constrained).
      if (dy > 0.5 && plane.ny < minNormalY) return { blocked: true, moved: false };
    }
  }

  // Spacing ray in movement direction to avoid going into walls/cliffs.
  ctx.tmpDir.set(dx / dist, 0, dz / dist);
  const heights = config.scanHeights?.length ? config.scanHeights : [config.scanHeight];
  const rayLen = dist + config.radius;
  const raycaster = ctx.raycaster;

  const prevFirstHitOnly = (raycaster as any).firstHitOnly;
  (raycaster as any).firstHitOnly = true;

  // Sample multiple rays to account for the full body volume (head/torso/feet and width).
  // This is a simplified version of ZenGin's spacing rays + low ceiling checks.
  const rightX = -ctx.tmpDir.z;
  const rightZ = ctx.tmpDir.x;
  const lateral = config.radius * 0.75;
  const lateralOffsets = [0, lateral, -lateral];

  let bestHitDist = Number.POSITIVE_INFINITY;
  let bestHitNx = 0,
    bestHitNy = 0,
    bestHitNz = 0;

  for (const hY of heights) {
    for (const off of lateralOffsets) {
      ctx.tmpOrigin.set(fromX + rightX * off, npcGroup.position.y + hY, fromZ + rightZ * off);
      raycaster.ray.origin.copy(ctx.tmpOrigin);
      raycaster.ray.direction.copy(ctx.tmpDir);
      raycaster.near = 0;
      raycaster.far = rayLen;

      const hits = raycaster.intersectObject(worldMesh, true);
      if (!hits.length) continue;

      for (const h of hits) {
        const n = worldNormalFromHit(ctx, h);
        if (!n) continue;
        const oriented = orientNormalAgainstRayXZ(n.x, n.y, n.z, ctx.tmpDir.x, ctx.tmpDir.z);
        if (!shouldTreatAsObstacle(oriented.ny, hY, config)) continue;
        if (h.distance < bestHitDist) {
          bestHitDist = h.distance;
          bestHitNx = oriented.nx;
          bestHitNy = oriented.ny;
          bestHitNz = oriented.nz;
        }
        break;
      }
    }
  }

  (raycaster as any).firstHitOnly = prevFirstHitOnly;

  if (!Number.isFinite(bestHitDist)) {
    npcGroup.position.x = desiredX;
    npcGroup.position.z = desiredZ;
    return { blocked: false, moved: true };
  }

  const allowed = Math.max(0, bestHitDist - config.radius);
  const clampedLen = Math.min(dist, allowed);
  const newX = fromX + ctx.tmpDir.x * clampedLen;
  const newZ = fromZ + ctx.tmpDir.z * clampedLen;

  npcGroup.position.x = newX;
  npcGroup.position.z = newZ;

  // If we're effectively "inside" an overhang/wall at some sampled height, push out a little along the planar normal.
  // This helps avoid cases where only the head/torso penetrates, while the feet are still clear.
  if (bestHitDist < config.radius - 1e-3) {
    ctx.tmpPlanarNormal.set(bestHitNx, bestHitNy, bestHitNz);
    ctx.tmpPlanarNormal.y = 0;
    const len2 = ctx.tmpPlanarNormal.lengthSq();
    if (len2 > 1e-8) {
      ctx.tmpPlanarNormal.multiplyScalar(1 / Math.sqrt(len2));
      const push = Math.min(25, config.radius - bestHitDist + 0.5);
      npcGroup.position.x += ctx.tmpPlanarNormal.x * push;
      npcGroup.position.z += ctx.tmpPlanarNormal.z * push;
    }
  }

  if (!config.enableWallSlide || clampedLen >= dist - 1e-6) {
    return { blocked: clampedLen < dist - 1e-6, moved: clampedLen > 1e-6 };
  }

  // Basic wall sliding: try to spend the remaining displacement along the wall tangent in XZ.
  ctx.tmpPlanarNormal.set(bestHitNx, bestHitNy, bestHitNz);
  ctx.tmpPlanarNormal.y = 0;
  if (ctx.tmpPlanarNormal.lengthSq() < 1e-8) {
    return { blocked: true, moved: clampedLen > 1e-6 };
  }
  ctx.tmpPlanarNormal.normalize();

  const remaining = dist - clampedLen;
  ctx.tmpNext.copy(ctx.tmpDir).multiplyScalar(remaining);
  const dot = ctx.tmpNext.dot(ctx.tmpPlanarNormal);
  ctx.tmpNext.addScaledVector(ctx.tmpPlanarNormal, -dot);
  const slideLen = ctx.tmpNext.length();
  if (slideLen < 1e-6) return { blocked: true, moved: clampedLen > 1e-6 };

  const slideDirX = ctx.tmpNext.x / slideLen;
  const slideDirZ = ctx.tmpNext.z / slideLen;

  // Cast again along slide direction to keep clearance.
  ctx.tmpOrigin.set(npcGroup.position.x, npcGroup.position.y + config.scanHeight, npcGroup.position.z);
  raycaster.ray.origin.copy(ctx.tmpOrigin);
  raycaster.ray.direction.set(slideDirX, 0, slideDirZ);
  raycaster.near = 0;
  raycaster.far = slideLen + config.radius;

  (raycaster as any).firstHitOnly = true;
  const slideHits = raycaster.intersectObject(worldMesh, true);
  (raycaster as any).firstHitOnly = prevFirstHitOnly;

  let slideAllowed = slideLen;
  for (const h of slideHits) {
    const n = worldNormalFromHit(ctx, h);
    if (!n) continue;
    const oriented = orientNormalAgainstRayXZ(n.x, n.y, n.z, slideDirX, slideDirZ);
    if (!shouldTreatAsObstacle(oriented.ny, config.scanHeight, config)) continue;
    slideAllowed = Math.max(0, Math.min(slideAllowed, h.distance - config.radius));
    break;
  }

  npcGroup.position.x += slideDirX * slideAllowed;
  npcGroup.position.z += slideDirZ * slideAllowed;

  const totalMoved = Math.hypot(npcGroup.position.x - fromX, npcGroup.position.z - fromZ);
  return { blocked: totalMoved < dist - 1e-6, moved: totalMoved > 1e-6 };
}
