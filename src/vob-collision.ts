import type { World } from "@kolarz3/zenkit";

export type VobAabb = {
  vobId: number;
  vobName: string;
  type: number;
  cdStatic: boolean;
  cdDynamic: boolean;
  vobStatic: boolean;
  physicsEnabled: boolean;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type VobCollisionIndex = {
  cellSize: number;
  aabbs: VobAabb[];
  cells: Map<string, number[]>;
  seen: Uint32Array;
  queryId: number;
};

const cellKey = (ix: number, iz: number) => `${ix},${iz}`;

const isFiniteAabb = (a: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }) =>
  Number.isFinite(a.minX) &&
  Number.isFinite(a.minY) &&
  Number.isFinite(a.minZ) &&
  Number.isFinite(a.maxX) &&
  Number.isFinite(a.maxY) &&
  Number.isFinite(a.maxZ);

const addToCells = (cells: Map<string, number[]>, cellSize: number, aabb: VobAabb, aabbIndex: number) => {
  const minIx = Math.floor(aabb.minX / cellSize);
  const maxIx = Math.floor(aabb.maxX / cellSize);
  const minIz = Math.floor(aabb.minZ / cellSize);
  const maxIz = Math.floor(aabb.maxZ / cellSize);
  for (let ix = minIx; ix <= maxIx; ix++) {
    for (let iz = minIz; iz <= maxIz; iz++) {
      const k = cellKey(ix, iz);
      const arr = cells.get(k);
      if (arr) arr.push(aabbIndex);
      else cells.set(k, [aabbIndex]);
    }
  }
};

const collectWorldVobAabbs = (world: World): VobAabb[] => {
  const roots = world.getVobs() as any;
  const out: VobAabb[] = [];
  const stack: any[] = [];

  const pushVob = (vob: any) => {
    if (!vob) return;
    stack.push(vob);
  };

  const rootCount = typeof roots?.size === "function" ? roots.size() : 0;
  for (let i = 0; i < rootCount; i++) pushVob(roots.get(i));

  while (stack.length) {
    const v = stack.pop();

    const bbox = v?.bbox;
    const cdStatic = Boolean(v?.cdStatic);
    const cdDynamic = Boolean(v?.cdDynamic);
    const vobStatic = Boolean(v?.vobStatic);
    const physicsEnabled = Boolean(v?.physicsEnabled);

    if (bbox?.min && bbox?.max && (cdStatic || cdDynamic)) {
      // Spacer-web world is mirrored on X (scale.x = -1). Mirror AABB accordingly.
      const minX = -bbox.max.x;
      const maxX = -bbox.min.x;
      const minY = bbox.min.y;
      const maxY = bbox.max.y;
      const minZ = bbox.min.z;
      const maxZ = bbox.max.z;

      const aabb: VobAabb = {
        vobId: Number(v?.id ?? -1),
        vobName: String(v?.vobName ?? ""),
        type: Number(v?.type ?? -1),
        cdStatic,
        cdDynamic,
        vobStatic,
        physicsEnabled,
        minX,
        minY,
        minZ,
        maxX,
        maxY,
        maxZ,
      };
      if (Number.isFinite(aabb.vobId) && aabb.vobId >= 0 && isFiniteAabb(aabb)) {
        out.push(aabb);
      }
    }

    const children = v?.children as any;
    const childCount = typeof children?.size === "function" ? children.size() : 0;
    for (let i = 0; i < childCount; i++) pushVob(children.get(i));
  }

  return out;
};

export function buildVobCollisionIndex(world: World, options?: { cellSize?: number }): VobCollisionIndex {
  const cellSize = Math.max(128, options?.cellSize ?? 1000);
  const aabbs = collectWorldVobAabbs(world);
  const cells = new Map<string, number[]>();
  for (let i = 0; i < aabbs.length; i++) {
    addToCells(cells, cellSize, aabbs[i], i);
  }
  return { cellSize, aabbs, cells, seen: new Uint32Array(Math.max(1, aabbs.length)), queryId: 0 };
}

export type NpcVobCollisionResult = { x: number; z: number; collided: boolean };

const verticalOverlaps = (
  npcY: number,
  npcHeight: number,
  aabb: { minY: number; maxY: number },
  extra: number
): boolean => {
  const y0 = npcY;
  const y1 = npcY + npcHeight;
  return y1 + extra >= aabb.minY && y0 - extra <= aabb.maxY;
};

const resolveSingleAabbXZ = (
  x: number,
  z: number,
  radius: number,
  aabb: { minX: number; maxX: number; minZ: number; maxZ: number },
  eps: number
): { x: number; z: number; collided: boolean } => {
  const minX = aabb.minX - radius;
  const maxX = aabb.maxX + radius;
  const minZ = aabb.minZ - radius;
  const maxZ = aabb.maxZ + radius;

  if (x < minX || x > maxX || z < minZ || z > maxZ) return { x, z, collided: false };

  const dLeft = x - minX;
  const dRight = maxX - x;
  const pushX = dLeft < dRight ? -(dLeft + eps) : dRight + eps;

  const dBack = z - minZ;
  const dFront = maxZ - z;
  const pushZ = dBack < dFront ? -(dBack + eps) : dFront + eps;

  if (Math.abs(pushX) < Math.abs(pushZ)) {
    return { x: x + pushX, z, collided: true };
  }
  return { x, z: z + pushZ, collided: true };
};

export function resolveNpcVobCollisionXZ(
  index: VobCollisionIndex,
  npc: { y: number },
  desired: { x: number; z: number },
  config: { radius: number; scanHeight: number },
  options?: { maxIterations?: number }
): NpcVobCollisionResult {
  const maxIterations = Math.max(1, options?.maxIterations ?? 4);
  const radius = Math.max(0, config.radius);
  const npcHeight = Math.max(0, config.scanHeight);
  const eps = 1e-3;

  let x = desired.x;
  let z = desired.z;
  let collided = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    let didAdjust = false;

    const q = ++index.queryId;
    if (q === 0xffffffff) {
      index.queryId = 1;
      index.seen.fill(0);
    }

    const cellSize = index.cellSize;
    const minIx = Math.floor((x - radius) / cellSize);
    const maxIx = Math.floor((x + radius) / cellSize);
    const minIz = Math.floor((z - radius) / cellSize);
    const maxIz = Math.floor((z + radius) / cellSize);

    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iz = minIz; iz <= maxIz; iz++) {
        const arr = index.cells.get(cellKey(ix, iz));
        if (!arr) continue;
        for (const aabbIndex of arr) {
          if (aabbIndex < 0 || aabbIndex >= index.aabbs.length) continue;
          if (index.seen[aabbIndex] === index.queryId) continue;
          index.seen[aabbIndex] = index.queryId;

          const aabb = index.aabbs[aabbIndex];
          if (!verticalOverlaps(npc.y, npcHeight, aabb, 20)) continue;

          const r = resolveSingleAabbXZ(x, z, radius, aabb, eps);
          if (r.collided) {
            x = r.x;
            z = r.z;
            collided = true;
            didAdjust = true;
          }
        }
      }
    }

    if (!didAdjust) break;
  }

  return { x, z, collided };
}

