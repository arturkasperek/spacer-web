export type NpcCircleCollider = {
  x: number;
  z: number;
  radius: number;
  y?: number;
};

export type ConstrainCircleMoveXZResult = {
  x: number;
  z: number;
  blocked: boolean;
};

/**
 * Constrains a desired XZ move so the moving circle doesn't overlap any other circles.
 *
 * This is a lightweight approximation of ZenGin-style dynamic character collisions:
 * - other NPCs are treated as non-penetrable cylinders (circle in XZ)
 * - we don't push other NPCs; we clamp the mover to the contact boundary
 * - a small separation slop avoids jitter from numerical noise
 */
export function constrainCircleMoveXZ(params: {
  startX: number;
  startZ: number;
  desiredX: number;
  desiredZ: number;
  radius: number;
  colliders: readonly NpcCircleCollider[];
  maxIterations?: number;
  separationSlop?: number;
  y?: number;
  maxYDelta?: number;
}): ConstrainCircleMoveXZResult {
  const maxIterations = Math.max(1, Math.floor(params.maxIterations ?? 3));
  const separationSlop = Math.max(0, params.separationSlop ?? 0.05);

  const moveX = params.desiredX - params.startX;
  const moveZ = params.desiredZ - params.startZ;
  const moveLen = Math.hypot(moveX, moveZ);
  const invMoveLen = moveLen > 1e-8 ? 1 / moveLen : 0;

  let x = params.desiredX;
  let z = params.desiredZ;
  let blocked = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    let adjustedThisIter = false;

    for (const c of params.colliders) {
      if (params.maxYDelta != null && params.y != null && c.y != null) {
        if (Math.abs(params.y - c.y) > params.maxYDelta) continue;
      }

      const rr = params.radius + c.radius + separationSlop;
      const rrSq = rr * rr;
      const dx = x - c.x;
      const dz = z - c.z;
      const distSq = dx * dx + dz * dz;
      if (distSq >= rrSq) continue;

      blocked = true;

      let nx: number;
      let nz: number;
      if (distSq < 1e-10) {
        // Fully overlapped. Clamp to the "near side" relative to the attempted movement.
        if (invMoveLen > 0) {
          nx = -moveX * invMoveLen;
          nz = -moveZ * invMoveLen;
        } else {
          nx = 1;
          nz = 0;
        }
      } else {
        const invDist = 1 / Math.sqrt(distSq);
        nx = dx * invDist;
        nz = dz * invDist;
      }

      const nextX = c.x + nx * rr;
      const nextZ = c.z + nz * rr;
      if (Math.abs(nextX - x) > 1e-7 || Math.abs(nextZ - z) > 1e-7) adjustedThisIter = true;
      x = nextX;
      z = nextZ;
    }

    if (!adjustedThisIter) break;
  }

  return { x, z, blocked };
}

