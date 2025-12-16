import * as THREE from "three";
import { INTERSECTED, NOT_INTERSECTED, type MeshBVH } from "three-mesh-bvh";

class BvhCapsule {
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;

  constructor(start = new THREE.Vector3(), end = new THREE.Vector3(0, 1, 0), radius = 1) {
    this.start = start;
    this.end = end;
    this.radius = radius;
  }

  copy(other: BvhCapsule) {
    this.start.copy(other.start);
    this.end.copy(other.end);
    this.radius = other.radius;
    return this;
  }

  set(start: THREE.Vector3, end: THREE.Vector3, radius: number) {
    this.start.copy(start);
    this.end.copy(end);
    this.radius = radius;
    return this;
  }

  translate(v: THREE.Vector3) {
    this.start.add(v);
    this.end.add(v);
    return this;
  }

  intersectsBox(box: THREE.Box3) {
    const r = this.radius;
    const s = this.start;
    const e = this.end;
    return (
      this.#checkAabbAxis(s.x, s.y, e.x, e.y, box.min.x, box.max.x, box.min.y, box.max.y, r) &&
      this.#checkAabbAxis(s.x, s.z, e.x, e.z, box.min.x, box.max.x, box.min.z, box.max.z, r) &&
      this.#checkAabbAxis(s.y, s.z, e.y, e.z, box.min.y, box.max.y, box.min.z, box.max.z, r)
    );
  }

  #checkAabbAxis(
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    minx: number,
    maxx: number,
    miny: number,
    maxy: number,
    radius: number
  ) {
    return (
      (minx - p1x < radius || minx - p2x < radius) &&
      (p1x - maxx < radius || p2x - maxx < radius) &&
      (miny - p1y < radius || miny - p2y < radius) &&
      (p1y - maxy < radius || p2y - maxy < radius)
    );
  }
}

export type NpcWorldCollisionConfig = {
  radius: number;
  scanHeight: number;
  scanHeights?: number[];
  capsuleHeight?: number;
  stepHeight: number;
  maxStepDown?: number;
  maxGroundAngleRad: number;
  maxSlideAngleRad: number;
  minWallNormalY: number;
  enableWallSlide: boolean;

  slideGravity?: number;
  slideFriction?: number;
  maxSlideSpeed?: number;

  landHeight?: number;
  fallGravity?: number;
  maxFallSpeed?: number;
};

export type NpcWorldCollisionContext = {
  raycaster: THREE.Raycaster;
  normalMatrix: THREE.Matrix3;
  invMatrixWorld: THREE.Matrix4;
  invMatrixWorld3: THREE.Matrix3;
  tmpUpLocal: THREE.Vector3;
  tmpOrigin: THREE.Vector3;
  tmpDir: THREE.Vector3;
  tmpDelta: THREE.Vector3;
  tmpNormal: THREE.Vector3;
  tmpPlanarNormal: THREE.Vector3;
  tmpNext: THREE.Vector3;
  tmpCapsuleLocal: BvhCapsule;
  tmpCapsuleSeg: THREE.Line3;
  tmpTriPoint: THREE.Vector3;
  tmpCapsulePoint: THREE.Vector3;
};

export function createNpcWorldCollisionContext(): NpcWorldCollisionContext {
  const raycaster = new THREE.Raycaster();
  // When world mesh has BVH acceleratedRaycast, this speeds up intersections.
  (raycaster as any).firstHitOnly = true;
  return {
    raycaster,
    normalMatrix: new THREE.Matrix3(),
    invMatrixWorld: new THREE.Matrix4(),
    invMatrixWorld3: new THREE.Matrix3(),
    tmpUpLocal: new THREE.Vector3(0, 1, 0),
    tmpOrigin: new THREE.Vector3(),
    tmpDir: new THREE.Vector3(),
    tmpDelta: new THREE.Vector3(),
    tmpNormal: new THREE.Vector3(),
    tmpPlanarNormal: new THREE.Vector3(),
    tmpNext: new THREE.Vector3(),
    tmpCapsuleLocal: new BvhCapsule(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 1),
    tmpCapsuleSeg: new THREE.Line3(new THREE.Vector3(), new THREE.Vector3()),
    tmpTriPoint: new THREE.Vector3(),
    tmpCapsulePoint: new THREE.Vector3(),
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

const getMaterialIdForTriangle = (mesh: THREE.Mesh, triangleIndex: number): number | null => {
  if (!Number.isFinite(triangleIndex) || triangleIndex < 0) return null;
  const geom: any = mesh.geometry as any;
  const ids: Int32Array | undefined = geom?.userData?.materialIds;
  if (ids && triangleIndex < ids.length) return ids[triangleIndex];

  // Fallback: derive from geometry groups (range is in indices, 3 per triangle).
  const groups: THREE.BufferGeometry["groups"] | undefined = geom?.groups;
  if (!groups || !groups.length) return 0;
  const indexOffset = triangleIndex * 3;
  // Groups are added in order in our loader, so a linear scan is typically small.
  for (const g of groups) {
    if (indexOffset >= g.start && indexOffset < g.start + g.count) return g.materialIndex ?? 0;
  }
  return 0;
};

const isTriangleCollidable = (mesh: THREE.Mesh, triangleIndex: number): boolean => {
  const noColl: boolean[] | undefined = (mesh as any).userData?.noCollDetByMaterialId;
  if (!noColl) return true;
  const matId = getMaterialIdForTriangle(mesh, triangleIndex);
  if (matId == null) return true;
  return !noColl[matId];
};

const worldNormalFromHit = (ctx: NpcWorldCollisionContext, hit: THREE.Intersection): THREE.Vector3 | null => {
  const faceNormal = hit.face?.normal;
  if (!faceNormal) return null;
  ctx.tmpNormal.copy(faceNormal);
  ctx.normalMatrix.getNormalMatrix(hit.object.matrixWorld);
  ctx.tmpNormal.applyMatrix3(ctx.normalMatrix).normalize();
  // WORLD_MESH is mirrored via `scale.x = -1`, which flips normals unless corrected.
  // NormalMatrix doesn't guarantee a stable outward direction for negative determinants, so fix explicitly.
  if (hit.object.matrixWorld.determinant() < 0) ctx.tmpNormal.multiplyScalar(-1);
  return ctx.tmpNormal;
};

export type NpcMoveConstraintResult = { blocked: boolean; moved: boolean };

const sampleFloorAt = (
  ctx: NpcWorldCollisionContext,
  worldMesh: THREE.Object3D,
  x: number,
  z: number,
  startY: number,
  far: number,
  minNormalY: number
): { y: number; nx: number; ny: number; nz: number; px: number; py: number; pz: number } | null => {
  const raycaster = ctx.raycaster;
  const prevFirstHitOnly = (raycaster as any).firstHitOnly;
  (raycaster as any).firstHitOnly = false;
  raycaster.ray.origin.set(x, startY, z);
  raycaster.ray.direction.set(0, -1, 0);
  raycaster.near = 0;
  raycaster.far = far;
  const hits = raycaster.intersectObject(worldMesh, true);
  (raycaster as any).firstHitOnly = prevFirstHitOnly;
  if (!hits.length) return null;

  // Pick the first "floor-like" hit (uppermost surface), ignoring near-vertical faces.
  for (const h of hits) {
    if ((h.object as any).isMesh) {
      const faceIndex = h.faceIndex ?? -1;
      if (!isTriangleCollidable(h.object as THREE.Mesh, faceIndex)) continue;
    }
    const n = worldNormalFromHit(ctx, h);
    if (!n) continue;
    let nx = n.x,
      ny = n.y,
      nz = n.z;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    if (ny < minNormalY) continue;
    return {
      y: h.point.y,
      nx,
      ny,
      nz,
      px: h.point.x,
      py: h.point.y,
      pz: h.point.z,
    };
  }
  return null;
};

const findWorldCollisionMeshWithBVH = (root: THREE.Object3D): THREE.Mesh | null => {
  if ((root as any).isMesh && (root as any).geometry?.boundsTree) return root as THREE.Mesh;
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (found) return;
    if ((o as any).isMesh && (o as any).geometry?.boundsTree) found = o as THREE.Mesh;
  });
  return found;
};

const buildCapsuleLocal = (
  ctx: NpcWorldCollisionContext,
  originLocal: THREE.Vector3,
  config: NpcWorldCollisionConfig
): BvhCapsule => {
  const radius = config.radius;
  const capsuleHeight =
    config.capsuleHeight ??
    Math.max(config.scanHeight, ...(config.scanHeights?.length ? config.scanHeights : []));

  // Capsule is defined along "up" direction in collider space.
  // "originLocal" is the NPC origin (feet) in collider-local coordinates.
  ctx.tmpCapsuleLocal.radius = radius;
  ctx.tmpCapsuleLocal.start.copy(originLocal).addScaledVector(ctx.tmpUpLocal, radius);
  ctx.tmpCapsuleLocal.end.copy(originLocal).addScaledVector(ctx.tmpUpLocal, Math.max(radius, capsuleHeight - radius));
  return ctx.tmpCapsuleLocal;
};

const resolveCapsuleIntersections = (
  ctx: NpcWorldCollisionContext,
  bvh: MeshBVH,
  capsule: BvhCapsule,
  options: {
    maxIterations?: number;
    planarOnly?: boolean;
    minWalkableNy?: number;
    isTriangleCollidable?: (triangleIndex: number) => boolean;
  }
): { collided: boolean; pushDirWorldXZ?: { x: number; z: number } } => {
  const maxIterations = Math.max(1, options.maxIterations ?? 3);
  const planarOnly = options.planarOnly ?? true;
  const minWalkableNy = options.minWalkableNy ?? 0;
  let collided = false;
  let lastPushXZ: { x: number; z: number } | undefined;

  // We update the capsule in-place inside shapecast, so we need to re-run a few times for stability.
  for (let iter = 0; iter < maxIterations; iter++) {
    let didAdjust = false;
    ctx.tmpCapsuleSeg.start.copy(capsule.start);
    ctx.tmpCapsuleSeg.end.copy(capsule.end);

    bvh.shapecast({
      intersectsBounds: (box) => {
        return capsule.intersectsBox(box) ? INTERSECTED : NOT_INTERSECTED;
      },
      intersectsTriangle: (tri, triangleIndex) => {
        if (options.isTriangleCollidable && !options.isTriangleCollidable(triangleIndex)) return false;
        // Note: `tri` is an ExtendedTriangle instance.
        (tri as any).closestPointToSegment(ctx.tmpCapsuleSeg, ctx.tmpTriPoint, ctx.tmpCapsulePoint);

        // Compute a stable triangle normal oriented toward the capsule. WORLD_MESH can have inconsistent winding
        // (and can be mirrored), so we can't rely on the raw triangle normal direction for classification.
        (tri as any).getNormal(ctx.tmpNormal);
        ctx.tmpNext.copy(ctx.tmpCapsulePoint).sub(ctx.tmpTriPoint);
        if (ctx.tmpNormal.dot(ctx.tmpNext) < 0) ctx.tmpNormal.multiplyScalar(-1);

        // Classify triangle: treat ceilings / steep slopes as obstacles for XZ motion; ignore floor-like surfaces.
        // This reduces false positives on walkable ground and prevents tunneling into very steep terrain.
        const dotUp = ctx.tmpNormal.dot(ctx.tmpUpLocal);
        const isCeiling = dotUp < 0;
        const ny = Math.abs(dotUp);
        const isObstacle = isCeiling || ny < minWalkableNy;
        if (!isObstacle) return false;

        const distSq = ctx.tmpTriPoint.distanceToSquared(ctx.tmpCapsulePoint);
        const r = capsule.radius;
        if (distSq >= r * r) return false;

        const dist = Math.sqrt(Math.max(0, distSq));
        const depth = r - dist + 1e-4;

        // Push direction is the shortest vector from the triangle to the capsule segment.
        ctx.tmpDir.copy(ctx.tmpCapsulePoint).sub(ctx.tmpTriPoint);
        if (ctx.tmpDir.lengthSq() < 1e-12) {
          // Degenerate case; use triangle normal but orient it consistently.
          ctx.tmpDir.copy(ctx.tmpNormal);
          if (!Number.isFinite(ctx.tmpDir.x + ctx.tmpDir.y + ctx.tmpDir.z)) return false;
          const center = ctx.tmpOrigin.copy(capsule.end).add(capsule.start).multiplyScalar(0.5);
          const toCenter = center.sub(ctx.tmpTriPoint);
          if (ctx.tmpDir.dot(toCenter) < 0) ctx.tmpDir.multiplyScalar(-1);
        }

        if (planarOnly) {
          // Project out the up component (movement is constrained to XZ plane).
          ctx.tmpDir.addScaledVector(ctx.tmpUpLocal, -ctx.tmpDir.dot(ctx.tmpUpLocal));
          if (ctx.tmpDir.lengthSq() < 1e-10) {
            // If separation is mostly vertical (common on steep ramps), use the triangle normal projection instead.
            ctx.tmpDir.copy(ctx.tmpNormal);
            // Ensure normal points away from triangle towards capsule.
            const toCapsule = ctx.tmpNext.copy(ctx.tmpCapsulePoint).sub(ctx.tmpTriPoint);
            if (ctx.tmpDir.dot(toCapsule) < 0) ctx.tmpDir.multiplyScalar(-1);
            ctx.tmpDir.addScaledVector(ctx.tmpUpLocal, -ctx.tmpDir.dot(ctx.tmpUpLocal));
          }
        }

        const len2 = ctx.tmpDir.lengthSq();
        if (len2 < 1e-10) return false;

        ctx.tmpDir.multiplyScalar(depth / Math.sqrt(ctx.tmpDir.lengthSq()));

        capsule.translate(ctx.tmpDir);
        ctx.tmpCapsuleSeg.start.copy(capsule.start);
        ctx.tmpCapsuleSeg.end.copy(capsule.end);

        didAdjust = true;
        collided = true;
        lastPushXZ = { x: ctx.tmpDir.x, z: ctx.tmpDir.z };
        return false;
      },
    });

    if (!didAdjust) break;
  }

  return { collided, pushDirWorldXZ: lastPushXZ };
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

  // Use ground target height for collision, not the visual Y (which is smoothed and can temporarily lag behind),
  // otherwise the capsule can end up intersecting the terrain and appear "stuck" even on flat ground.
  // Use a conservative collision base height:
  // - Never below `groundYTarget` (prevents terrain penetration when visual Y lags behind due to smoothing)
  // - Never below the current object Y (prevents "sinking" into stairs when groundYTarget is stale/too low)
  const collisionBaseY =
    typeof currentGroundY === "number" ? Math.max(currentGroundY, npcGroup.position.y) : npcGroup.position.y;

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

  // Stair/step handling (ZenGin-like): sample floor height at the target XZ and pre-adjust the ground target.
  // This prevents the body from clipping into "step tops" when the vertical correction lags behind.
  if (typeof currentGroundY === "number") {
    const clearance = (plane?.clearance as number | undefined) ?? 4;
    const startY = currentGroundY + config.scanHeight + config.stepHeight + 5;
    const far = config.scanHeight + config.stepHeight * 2 + 50;
    const minFloorNyWalk = Math.cos(config.maxGroundAngleRad);
    const minFloorNySlide = Math.cos(config.maxSlideAngleRad);
    const floor =
      sampleFloorAt(ctx, worldMesh, desiredX, desiredZ, startY, far, minFloorNyWalk) ||
      (minFloorNySlide < minFloorNyWalk ? sampleFloorAt(ctx, worldMesh, desiredX, desiredZ, startY, far, minFloorNySlide) : null);
    if (floor) {
      const targetY = floor.y + clearance;
      const dy = targetY - currentGroundY;
      const maxDown = config.maxStepDown ?? 800;
      if (dy > config.stepHeight) return { blocked: true, moved: false };
      if (dy < -maxDown) return { blocked: true, moved: false };

      // Update the ground target/plane to the surface we're stepping onto.
      // (Renderer will smooth towards this; updating early avoids interpenetration on stairs.)
      (npcGroup.userData as any).groundYTarget = targetY;
      (npcGroup.userData as any).groundPlane = {
        nx: floor.nx,
        ny: floor.ny,
        nz: floor.nz,
        px: floor.px,
        py: floor.py,
        pz: floor.pz,
        clearance,
      };
    }
  }

  // Conservative obstacle clamp (BVH-accelerated raycasts when available):
  // Prevents tunneling through very thin/tilted surfaces by limiting how far we move before capsule resolution.
  // This keeps the behavior closer to OpenGothic/Bullet kinematic motion (no crossing through a wall in one frame).
  let clampedDist = dist;
  {
    const raycaster = ctx.raycaster;
    const prevFirstHitOnly = (raycaster as any).firstHitOnly;
    (raycaster as any).firstHitOnly = true;

    ctx.tmpDir.set(dx / dist, 0, dz / dist);
    const rightX = -ctx.tmpDir.z;
    const rightZ = ctx.tmpDir.x;
    const heights = config.scanHeights?.length ? config.scanHeights : [config.scanHeight];
    const lateral = config.radius * 0.75;
    const lateralOffsets = [0, lateral, -lateral];
    const minWalkableNy = Math.cos(config.maxGroundAngleRad);

    const far = dist + config.radius;
    for (const hY of heights) {
      for (const off of lateralOffsets) {
        ctx.tmpOrigin.set(fromX + rightX * off, collisionBaseY + hY, fromZ + rightZ * off);
        raycaster.ray.origin.copy(ctx.tmpOrigin);
        raycaster.ray.direction.copy(ctx.tmpDir);
        raycaster.near = 0;
        raycaster.far = far;

        const hits = raycaster.intersectObject(worldMesh, true);
        if (!hits.length) continue;

        const h = hits[0];
        if ((h.object as any).isMesh) {
          const faceIndex = h.faceIndex ?? -1;
          if (!isTriangleCollidable(h.object as THREE.Mesh, faceIndex)) continue;
        }
        const n = worldNormalFromHit(ctx, h);
        if (!n) continue;
        const ny = Math.abs(n.y);
        const isObstacle = ny < minWalkableNy;
        if (!isObstacle) continue;

        // Step-over exception: if this looks like a low "riser" and there is walkable floor right behind it
        // within `stepHeight`, then don't clamp movement here (we'll handle it via the capsule step-up retry).
        if (typeof currentGroundY === "number" && config.stepHeight > 0 && hY <= config.scanHeight + 1) {
          const clearance = (plane?.clearance as number | undefined) ?? 4;
          const probeDist = Math.min(far, h.distance + config.radius + 2);
          const probeX = fromX + ctx.tmpDir.x * probeDist;
          const probeZ = fromZ + ctx.tmpDir.z * probeDist;

          const startY = currentGroundY + config.scanHeight + config.stepHeight + 10;
          const downFar = config.scanHeight + config.stepHeight * 2 + 200;
          const floor = sampleFloorAt(ctx, worldMesh, probeX, probeZ, startY, downFar, minWalkableNy);
          if (floor) {
            const targetY = floor.y + clearance;
            const dy = targetY - currentGroundY;
            if (dy > 1 && dy <= config.stepHeight) continue;
          }
        }

        const allowed = Math.max(0, h.distance - config.radius);
        clampedDist = Math.min(clampedDist, allowed);
      }
    }

    (raycaster as any).firstHitOnly = prevFirstHitOnly;
  }

  // Update desired position after clamping.
  const moveScale = clampedDist < dist ? clampedDist / dist : 1;
  const moveDx = dx * moveScale;
  const moveDz = dz * moveScale;
  const moveDist = clampedDist;

  const desiredXClamped = fromX + moveDx;
  const desiredZClamped = fromZ + moveDz;

  const mesh = findWorldCollisionMeshWithBVH(worldMesh);
  if (!mesh) {
    // BVH not available (or not built yet) - fall back to a conservative clamp via a single spacing ray.
    ctx.tmpDir.set(dx / dist, 0, dz / dist);
    const raycaster = ctx.raycaster;
    const prevFirstHitOnly = (raycaster as any).firstHitOnly;
    (raycaster as any).firstHitOnly = true;
    ctx.tmpOrigin.set(fromX, npcGroup.position.y + config.scanHeight, fromZ);
    raycaster.ray.origin.copy(ctx.tmpOrigin);
    raycaster.ray.direction.copy(ctx.tmpDir);
    raycaster.near = 0;
    raycaster.far = dist + config.radius;
    const hits = raycaster.intersectObject(worldMesh, true);
    (raycaster as any).firstHitOnly = prevFirstHitOnly;
    if (!hits.length) {
      npcGroup.position.x = desiredXClamped;
      npcGroup.position.z = desiredZClamped;
      return { blocked: false, moved: true };
    }
    const hit = hits[0];
    const allowed = Math.max(0, hit.distance - config.radius);
    const clampedLen = Math.min(moveDist, allowed);
    npcGroup.position.x = fromX + ctx.tmpDir.x * clampedLen;
    npcGroup.position.z = fromZ + ctx.tmpDir.z * clampedLen;
    return { blocked: clampedLen < moveDist - 1e-6, moved: clampedLen > 1e-6 };
  }

  // BVH capsule-vs-triangle collision (OpenGothic-like body collider).
  mesh.updateWorldMatrix(true, false);
  ctx.invMatrixWorld.copy(mesh.matrixWorld).invert();
  ctx.invMatrixWorld3.setFromMatrix4(ctx.invMatrixWorld);
  ctx.tmpUpLocal.set(0, 1, 0).applyMatrix3(ctx.invMatrixWorld3);
  if (ctx.tmpUpLocal.lengthSq() < 1e-8) ctx.tmpUpLocal.set(0, 1, 0);
  else ctx.tmpUpLocal.normalize();

  const bvh = (mesh.geometry as any).boundsTree as MeshBVH | undefined;
  if (!bvh) {
    npcGroup.position.x = desiredXClamped;
    npcGroup.position.z = desiredZClamped;
    return { blocked: clampedDist < dist - 1e-6, moved: clampedDist > 1e-6 };
  }

  const minWalkableNy = Math.cos(config.maxGroundAngleRad);
  const triCollidable = (triIndex: number) => isTriangleCollidable(mesh, triIndex);

  // Convert NPC origin to collider local-space.
  ctx.tmpOrigin.set(fromX, collisionBaseY, fromZ).applyMatrix4(ctx.invMatrixWorld);

  // Convert movement delta to collider local-space (directional part only).
  ctx.tmpDelta.set(moveDx, 0, moveDz).applyMatrix3(ctx.invMatrixWorld3);

  const desiredLenLocal = Math.hypot(ctx.tmpDelta.x, ctx.tmpDelta.z);
  const radiusLocal = config.radius; // World uses uniform scaling for WORLD_MESH; treat as 1:1.
  const substeps = Math.min(8, Math.max(1, Math.ceil(desiredLenLocal / Math.max(1e-6, radiusLocal))));

  const capsule = buildCapsuleLocal(ctx, ctx.tmpOrigin, config);
  const stepDeltaLocalX = ctx.tmpDelta.x / substeps;
  const stepDeltaLocalY = ctx.tmpDelta.y / substeps;
  const stepDeltaLocalZ = ctx.tmpDelta.z / substeps;

  // If we're already intersecting obstacle geometry (e.g. due to snap/smoothing artifacts),
  // depenetrate first so we don't end up "stuck" in place.
  resolveCapsuleIntersections(ctx, bvh, capsule, { maxIterations: 6, planarOnly: true, minWalkableNy, isTriangleCollidable: triCollidable });

  for (let i = 0; i < substeps; i++) {
    const stepDelta = ctx.tmpDelta.set(stepDeltaLocalX, stepDeltaLocalY, stepDeltaLocalZ);
    capsule.translate(stepDelta);
    resolveCapsuleIntersections(ctx, bvh, capsule, { maxIterations: 3, planarOnly: true, minWalkableNy, isTriangleCollidable: triCollidable });
  }

  // Convert capsule-local back to NPC origin (feet).
  const originLocalAfter = ctx.tmpNext.copy(capsule.start).addScaledVector(ctx.tmpUpLocal, -capsule.radius);
  originLocalAfter.applyMatrix4(mesh.matrixWorld);

  const newX = originLocalAfter.x;
  const newZ = originLocalAfter.z;

  const movedDx = newX - fromX;
  const movedDz = newZ - fromZ;
  const movedDist = Math.hypot(movedDx, movedDz);

  npcGroup.position.x = newX;
  npcGroup.position.z = newZ;

  const blocked = movedDist < moveDist - 1e-4 || clampedDist < dist - 1e-6;
  const moved = movedDist > 1e-6;

  // Step-up attempt when blocked: try the same move from an elevated capsule position.
  if (blocked && typeof currentGroundY === "number" && config.stepHeight > 0) {
    const tryOriginLocal = ctx.tmpOrigin
      .set(fromX, collisionBaseY + config.stepHeight, fromZ)
      .applyMatrix4(ctx.invMatrixWorld);
    const stepCapsule = buildCapsuleLocal(ctx, tryOriginLocal, config);
    const stepDelta = ctx.tmpDelta.set(moveDx, 0, moveDz).applyMatrix3(ctx.invMatrixWorld3);
    stepCapsule.translate(stepDelta);
    resolveCapsuleIntersections(ctx, bvh, stepCapsule, { maxIterations: 4, planarOnly: true, minWalkableNy, isTriangleCollidable: triCollidable });

    const steppedOriginWorld = ctx.tmpNext.copy(stepCapsule.start).addScaledVector(ctx.tmpUpLocal, -stepCapsule.radius).applyMatrix4(mesh.matrixWorld);

    // Only accept the step if it improves forward progress in the requested direction.
    const forward = ctx.tmpDir.set(movedDx / dist, 0, movedDz / dist);
    if (forward.lengthSq() < 1e-8) forward.set(dx / dist, 0, dz / dist);
    const steppedDx = steppedOriginWorld.x - fromX;
    const steppedDz = steppedOriginWorld.z - fromZ;
    const forwardProgBefore = movedDx * forward.x + movedDz * forward.z;
    const forwardProgAfter = steppedDx * forward.x + steppedDz * forward.z;

    // Accept the step if it makes meaningful forward progress.
    // Use a scale-relative threshold so tiny per-frame deltas (small dt / slow speed) can still step up.
    const minGain = Math.max(1e-4, Math.min(0.5, moveDist * 0.2));
    if (forwardProgAfter > forwardProgBefore + minGain) {
      npcGroup.position.x = steppedOriginWorld.x;
      npcGroup.position.z = steppedOriginWorld.z;

      // Update ground target if we can see a floor at the stepped XZ.
      const clearance = (plane?.clearance as number | undefined) ?? 4;
      const startY = currentGroundY + config.scanHeight + config.stepHeight + 5;
      const far = config.scanHeight + (config.maxStepDown ?? 800) + config.stepHeight + 100;
      const minFloorNy = Math.cos(config.maxGroundAngleRad);
      const floor = sampleFloorAt(ctx, worldMesh, npcGroup.position.x, npcGroup.position.z, startY, far, minFloorNy);
      if (floor) {
        const targetY = floor.y + clearance;
        const dy = targetY - currentGroundY;
        const maxDown = config.maxStepDown ?? 800;
        if (dy <= config.stepHeight && dy >= -maxDown) {
          (npcGroup.userData as any).groundYTarget = targetY;
          (npcGroup.userData as any).groundPlane = {
            nx: floor.nx,
            ny: floor.ny,
            nz: floor.nz,
            px: floor.px,
            py: floor.py,
            pz: floor.pz,
            clearance,
          };
        }
      }

      const totalMoved = Math.hypot(npcGroup.position.x - fromX, npcGroup.position.z - fromZ);
      return { blocked: totalMoved < dist - 1e-4, moved: totalMoved > 1e-6 };
    }
  }

  return { blocked, moved };
}

export type NpcSlopeSlideMode = "slide" | "slideBack";

export type NpcSlopeSlideResult = {
  moved: boolean;
  active: boolean;
  mode: NpcSlopeSlideMode;
};

const getSlopeRadFromNy = (ny: number): number => {
  if (!Number.isFinite(ny)) return 0;
  return Math.acos(Math.max(-1, Math.min(1, ny)));
};

export function updateNpcSlopeSlideXZ(
  ctx: NpcWorldCollisionContext,
  npcGroup: THREE.Object3D,
  worldMesh: THREE.Object3D,
  deltaSeconds: number,
  config: NpcWorldCollisionConfig
): NpcSlopeSlideResult {
  const plane = (npcGroup.userData as any).groundPlane as
    | { nx: number; ny: number; nz: number; px: number; py: number; pz: number; clearance: number }
    | undefined;
  if (!plane) {
    (npcGroup.userData as any).isSliding = false;
    (npcGroup.userData as any).slideVelXZ = { x: 0, z: 0 };
    return { moved: false, active: false, mode: "slide" };
  }

  const ny = plane.ny;
  const slope = getSlopeRadFromNy(Math.abs(ny));
  const startSlope = config.maxGroundAngleRad;
  const maxSlope = config.maxSlideAngleRad;

  // ZenGin behavior: sliding only applies on surfaces steeper than the walkable threshold.
  // If the floor becomes walkable again, sliding ends immediately (no hysteresis).
  const shouldBeActive = slope > startSlope && slope < maxSlope - 1e-6;
  if (!shouldBeActive) {
    (npcGroup.userData as any).isSliding = false;
    (npcGroup.userData as any).slideVelXZ = { x: 0, z: 0 };
    return { moved: false, active: false, mode: "slide" };
  }

  // Compute downhill slide direction from the ground normal (ZenGin style):
  // slideDir = (up x n) x n, oriented so that it points downward.
  ctx.tmpNormal.set(plane.nx, plane.ny, plane.nz).normalize();
  ctx.tmpDir.set(0, 1, 0).cross(ctx.tmpNormal).cross(ctx.tmpNormal);
  if (ctx.tmpDir.y > 0) ctx.tmpDir.multiplyScalar(-1);
  ctx.tmpDir.y = 0;
  const len2 = ctx.tmpDir.lengthSq();
  if (len2 < 1e-10) {
    (npcGroup.userData as any).isSliding = false;
    (npcGroup.userData as any).slideVelXZ = { x: 0, z: 0 };
    return { moved: false, active: false, mode: "slide" };
  }
  ctx.tmpDir.multiplyScalar(1 / Math.sqrt(len2));

  const dt = Math.min(Math.max(0, deltaSeconds), 0.05);
  const g = config.slideGravity ?? 981;
  const friction = config.slideFriction ?? 1.0;
  const maxSpeed = config.maxSlideSpeed ?? 1200;

  const accel = g * Math.sin(slope);
  const state = ((npcGroup.userData as any).slideVelXZ as { x: number; z: number } | undefined) ?? { x: 0, z: 0 };
  let vx = state.x;
  let vz = state.z;

  vx += ctx.tmpDir.x * accel * dt;
  vz += ctx.tmpDir.z * accel * dt;

  // Exponential damping (matches dv/dt += -k*v style friction).
  const damping = Math.exp(-Math.max(0, friction) * dt);
  vx *= damping;
  vz *= damping;

  const sp = Math.hypot(vx, vz);
  if (sp > maxSpeed) {
    const s = maxSpeed / sp;
    vx *= s;
    vz *= s;
  }

  (npcGroup.userData as any).slideVelXZ = { x: vx, z: vz };
  (npcGroup.userData as any).isSliding = true;

  // Pick animation direction based on whether the NPC faces downhill.
  ctx.tmpPlanarNormal.set(0, 0, 1).applyQuaternion(npcGroup.quaternion);
  ctx.tmpPlanarNormal.y = 0;
  if (ctx.tmpPlanarNormal.lengthSq() < 1e-10) ctx.tmpPlanarNormal.set(0, 0, 1);
  else ctx.tmpPlanarNormal.normalize();
  const dotForward = ctx.tmpPlanarNormal.x * ctx.tmpDir.x + ctx.tmpPlanarNormal.z * ctx.tmpDir.z;
  const mode: NpcSlopeSlideMode = dotForward >= 0 ? "slide" : "slideBack";

  const beforeX = npcGroup.position.x;
  const beforeZ = npcGroup.position.z;
  const desiredX = beforeX + vx * dt;
  const desiredZ = beforeZ + vz * dt;

  const r = applyNpcWorldCollisionXZ(ctx, npcGroup, desiredX, desiredZ, worldMesh, dt, config);
  if (!r.moved) {
    // Damp velocity aggressively when wedged against obstacles.
    (npcGroup.userData as any).slideVelXZ = { x: vx * 0.15, z: vz * 0.15 };
  }

  return { moved: r.moved, active: true, mode };
}

export type NpcFallMode = "fallDown" | "fall" | "fallBack";

export type NpcFallResult = {
  moved: boolean;
  active: boolean;
  landed: boolean;
  mode: NpcFallMode;
  fallDistanceY: number;
};

const getPlanarForwardXZ = (ctx: NpcWorldCollisionContext, q: THREE.Quaternion): { x: number; z: number } => {
  ctx.tmpDir.set(0, 0, 1).applyQuaternion(q);
  ctx.tmpDir.y = 0;
  const len2 = ctx.tmpDir.lengthSq();
  if (len2 < 1e-10) return { x: 0, z: 1 };
  ctx.tmpDir.multiplyScalar(1 / Math.sqrt(len2));
  return { x: ctx.tmpDir.x, z: ctx.tmpDir.z };
};

export function updateNpcFallY(
  ctx: NpcWorldCollisionContext,
  npcGroup: THREE.Object3D,
  worldMesh: THREE.Object3D,
  deltaSeconds: number,
  config: NpcWorldCollisionConfig
): NpcFallResult {
  const dt = Math.min(Math.max(0, deltaSeconds), 0.05);
  const gravity = config.fallGravity ?? 981;
  const landHeight = config.landHeight ?? 10;
  const maxFallSpeed = config.maxFallSpeed ?? 8000;
  const minFloorNy = Math.cos(config.maxSlideAngleRad);
  const clearance = 4;

  const isFalling = Boolean((npcGroup.userData as any).isFalling);
  const groundYTarget = (npcGroup.userData as any).groundYTarget as number | undefined;

  // Sample floor below the NPC. We accept slopes up to slide2 angle (anything steeper is treated as a wall).
  const startY = npcGroup.position.y + 50;
  const floor = sampleFloorAt(ctx, worldMesh, npcGroup.position.x, npcGroup.position.z, startY, 20000, minFloorNy);

  const floorTargetY = floor ? floor.y + clearance : null;
  const contactY = typeof groundYTarget === "number" ? groundYTarget : npcGroup.position.y;
  const seemsGrounded = Math.abs(npcGroup.position.y - contactY) <= 20;
  const aboveFloor = floorTargetY != null ? contactY - floorTargetY : 0;

  if (!isFalling) {
    if (floorTargetY == null) {
      return { moved: false, active: false, landed: false, mode: "fallDown", fallDistanceY: 0 };
    }

    // ZenGin: if the character is more than stepHeight above the floor, start falling physics (unless stairs).
    // We don't have stair classification, so we approximate based on distance to floor only.
    if (seemsGrounded && aboveFloor > config.stepHeight) {
      (npcGroup.userData as any).isFalling = true;
      (npcGroup.userData as any).fallStartY = contactY;
      (npcGroup.userData as any).fallVelY = 0;
    } else {
      return { moved: false, active: false, landed: false, mode: "fallDown", fallDistanceY: 0 };
    }
  }

  // Integrate fall.
  const beforeY = npcGroup.position.y;
  let vy = ((npcGroup.userData as any).fallVelY as number | undefined) ?? 0;
  vy -= gravity * dt;
  vy = Math.max(-maxFallSpeed, Math.min(maxFallSpeed, vy));
  npcGroup.position.y += vy * dt;
  (npcGroup.userData as any).fallVelY = vy;

  const fallStartY = ((npcGroup.userData as any).fallStartY as number | undefined) ?? beforeY;
  const fallDistanceY = Math.max(0, fallStartY - npcGroup.position.y);

  // Land if we reached the floor (within landHeight).
  if (floorTargetY != null && npcGroup.position.y <= floorTargetY + landHeight) {
    npcGroup.position.y = floorTargetY;
    (npcGroup.userData as any).isFalling = false;
    (npcGroup.userData as any).fallVelY = 0;
    (npcGroup.userData as any).groundYTarget = floorTargetY;
    if (floor) {
      (npcGroup.userData as any).groundPlane = {
        nx: floor.nx,
        ny: floor.ny,
        nz: floor.nz,
        px: floor.px,
        py: floor.py,
        pz: floor.pz,
        clearance,
      };
    }
    return { moved: true, active: false, landed: true, mode: "fallDown", fallDistanceY };
  }

  // Mode selection: stay in fallDown for small drops, switch to fall/fallBack for deeper falls.
  let mode: NpcFallMode = "fallDown";
  const FALLDN_TO_FALL = 200;
  if (fallDistanceY >= FALLDN_TO_FALL) {
    const dir = (npcGroup.userData as any).lastMoveDirXZ as { x: number; z: number } | undefined;
    const fwd = getPlanarForwardXZ(ctx, npcGroup.quaternion);
    const dot = dir ? fwd.x * dir.x + fwd.z * dir.z : 1;
    mode = dot >= 0 ? "fall" : "fallBack";
  }

  return {
    moved: Math.abs(npcGroup.position.y - beforeY) > 1e-6,
    active: true,
    landed: false,
    mode,
    fallDistanceY,
  };
}
