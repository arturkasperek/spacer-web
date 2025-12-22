import * as THREE from "three";

export type VobColliderEntry = {
  key: string;
  mesh: THREE.Mesh;
  aabb: THREE.Box3;
};

type Registry = {
  cellSize: number;
  cells: Map<string, string[]>;
  colliders: Map<string, VobColliderEntry>;
  vobKeyToColliderKeys: Map<string, string[]>;
};

const registry: Registry = {
  cellSize: 1200,
  cells: new Map(),
  colliders: new Map(),
  vobKeyToColliderKeys: new Map(),
};

const cellKey = (ix: number, iz: number) => `${ix},${iz}`;

function addColliderToCells(entry: VobColliderEntry) {
  const cs = registry.cellSize;
  const minIx = Math.floor(entry.aabb.min.x / cs);
  const maxIx = Math.floor(entry.aabb.max.x / cs);
  const minIz = Math.floor(entry.aabb.min.z / cs);
  const maxIz = Math.floor(entry.aabb.max.z / cs);
  for (let ix = minIx; ix <= maxIx; ix++) {
    for (let iz = minIz; iz <= maxIz; iz++) {
      const k = cellKey(ix, iz);
      const arr = registry.cells.get(k);
      if (arr) arr.push(entry.key);
      else registry.cells.set(k, [entry.key]);
    }
  }
}

function computeWorldAabb(mesh: THREE.Mesh, out: THREE.Box3) {
  mesh.updateWorldMatrix(true, false);

  const geom = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!geom) {
    out.makeEmpty();
    return;
  }

  if (!geom.boundingBox) geom.computeBoundingBox();
  const bb = geom.boundingBox;
  if (!bb) {
    out.makeEmpty();
    return;
  }

  out.copy(bb).applyMatrix4(mesh.matrixWorld);
}

function isMeshCollidable(mesh: THREE.Mesh) {
  // For safety, only register meshes that are explicitly marked as collidable by their owning VOB.
  return Boolean((mesh.userData as any)?.isCollidableVob);
}

export function registerCollidableVobObject(vobKey: string, root: THREE.Object3D) {
  // In Jest we mock Three.js; skip registry work there.
  if (typeof (THREE as any).Box3 !== "function") return;
  unregisterCollidableVobObject(vobKey);

  const colliderKeys: string[] = [];
  let childIndex = 0;

  root.traverse((obj) => {
    if (!(obj as any).isMesh) return;
    const mesh = obj as THREE.Mesh;
    if (!isMeshCollidable(mesh)) return;

    const key = `${vobKey}:${childIndex++}`;
    const aabb = new THREE.Box3();
    computeWorldAabb(mesh, aabb);
    if (aabb.isEmpty()) return;

    const entry: VobColliderEntry = { key, mesh, aabb };
    registry.colliders.set(key, entry);
    addColliderToCells(entry);
    colliderKeys.push(key);
  });

  if (colliderKeys.length) {
    registry.vobKeyToColliderKeys.set(vobKey, colliderKeys);
  }
}

export function unregisterCollidableVobObject(vobKey: string) {
  const keys = registry.vobKeyToColliderKeys.get(vobKey);
  if (!keys?.length) return;

  // Remove collider entries.
  for (const k of keys) registry.colliders.delete(k);
  registry.vobKeyToColliderKeys.delete(vobKey);

  // Rebuild cell map (simpler and safe; unregister is relatively rare vs per-frame queries).
  registry.cells.clear();
  for (const entry of registry.colliders.values()) addColliderToCells(entry);
}

export function queryCollidableVobMeshesXZ(
  x: number,
  z: number,
  radius: number,
  options?: { maxResults?: number }
): THREE.Mesh[] {
  // In Jest we mock Three.js; registry is inactive there.
  if (typeof (THREE as any).Box3 !== "function") return [];
  const cs = registry.cellSize;
  const r = Math.max(0, radius);
  const minIx = Math.floor((x - r) / cs);
  const maxIx = Math.floor((x + r) / cs);
  const minIz = Math.floor((z - r) / cs);
  const maxIz = Math.floor((z + r) / cs);

  const seen = new Set<string>();
  const candidates: VobColliderEntry[] = [];

  for (let ix = minIx; ix <= maxIx; ix++) {
    for (let iz = minIz; iz <= maxIz; iz++) {
      const arr = registry.cells.get(cellKey(ix, iz));
      if (!arr) continue;
      for (const k of arr) {
        if (seen.has(k)) continue;
        seen.add(k);
        const entry = registry.colliders.get(k);
        if (!entry) continue;
        // Quick reject: circle vs expanded AABB in XZ.
        const minX = entry.aabb.min.x - r;
        const maxX = entry.aabb.max.x + r;
        const minZ = entry.aabb.min.z - r;
        const maxZ = entry.aabb.max.z + r;
        if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
        candidates.push(entry);
      }
    }
  }

  const maxResults = Math.max(1, options?.maxResults ?? 32);
  if (candidates.length <= maxResults) return candidates.map((c) => c.mesh);

  // Keep the closest colliders (by distance to AABB center) to bound worst-case CPU.
  candidates.sort((a, b) => {
    const acx = (a.aabb.min.x + a.aabb.max.x) * 0.5;
    const acz = (a.aabb.min.z + a.aabb.max.z) * 0.5;
    const bcx = (b.aabb.min.x + b.aabb.max.x) * 0.5;
    const bcz = (b.aabb.min.z + b.aabb.max.z) * 0.5;
    const da = (acx - x) * (acx - x) + (acz - z) * (acz - z);
    const db = (bcx - x) * (bcx - x) + (bcz - z) * (bcz - z);
    return da - db;
  });

  return candidates.slice(0, maxResults).map((c) => c.mesh);
}
