import type { RoutineEntry } from "./types";

export type Aabb = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

const normalizeNameKey = (name: string): string => (name || "").trim().toUpperCase();

const createEmptyAabb = (): Aabb => ({
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  minZ: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
  maxZ: Number.NEGATIVE_INFINITY,
});

const expandAabbByPoint = (aabb: Aabb, p: { x: number; y: number; z: number }) => {
  if (p.x < aabb.minX) aabb.minX = p.x;
  if (p.y < aabb.minY) aabb.minY = p.y;
  if (p.z < aabb.minZ) aabb.minZ = p.z;
  if (p.x > aabb.maxX) aabb.maxX = p.x;
  if (p.y > aabb.maxY) aabb.maxY = p.y;
  if (p.z > aabb.maxZ) aabb.maxZ = p.z;
};

const isAabbValid = (aabb: Aabb): boolean =>
  aabb.minX <= aabb.maxX && aabb.minY <= aabb.maxY && aabb.minZ <= aabb.maxZ;

export const aabbIntersects = (a: Aabb, b: Aabb): boolean =>
  a.minX <= b.maxX &&
  a.maxX >= b.minX &&
  a.minY <= b.maxY &&
  a.maxY >= b.minY &&
  a.minZ <= b.maxZ &&
  a.maxZ >= b.minZ;

export const createAabbAroundPoint = (
  center: { x: number; y: number; z: number },
  halfExtents: { x: number; y: number; z: number }
): Aabb => ({
  minX: center.x - halfExtents.x,
  minY: center.y - halfExtents.y,
  minZ: center.z - halfExtents.z,
  maxX: center.x + halfExtents.x,
  maxY: center.y + halfExtents.y,
  maxZ: center.z + halfExtents.z,
});

/**
 * Builds a ZenGin-style "routine waybox" for an NPC: a single AABB that bounds *all* routine waypoints
 * that exist in the current waynet (engine default `intervall = 24`).
 *
 * Returns `null` when the routine references no existing waynet waypoint at all.
 */
export const buildRoutineWaybox = (
  routine: RoutineEntry[] | undefined,
  waypointPosIndex: Map<string, { x: number; y: number; z: number }>
): Aabb | null => {
  if (!routine || routine.length === 0) return null;

  const aabb = createEmptyAabb();
  let found = 0;

  for (const entry of routine) {
    const key = normalizeNameKey(entry?.waypoint ?? "");
    if (!key) continue;
    const pos = waypointPosIndex.get(key);
    if (!pos) continue;
    expandAabbByPoint(aabb, pos);
    found += 1;
  }

  if (found === 0 || !isAabbValid(aabb)) return null;
  return aabb;
};

