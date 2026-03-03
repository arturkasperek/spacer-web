import * as THREE from "three";

type DeferAabb = {
  id: string;
  nativeVobId: string;
  min: THREE.Vector3;
  max: THREE.Vector3;
  loaded: boolean;
};

export type NpcDeferProbe = {
  vobId: string;
  nativeVobId: string;
  loaded: boolean;
  inside: boolean;
  distance: number;
};

export type NpcModelDeferDecision = {
  defer: boolean;
  probePoint: THREE.Vector3;
  hit?: NpcDeferProbe;
  nearestUnloaded?: NpcDeferProbe;
  target?: NpcDeferProbe;
};

let aabbs: DeferAabb[] = [];

function toWorldAabbConservative(vob: any): { min: THREE.Vector3; max: THREE.Vector3 } | null {
  const b = vob?.bbox;
  const bmin = b?.min;
  const bmax = b?.max;
  if (!bmin || !bmax) return null;

  const rawMin = new THREE.Vector3(Number(bmin.x) || 0, Number(bmin.y) || 0, Number(bmin.z) || 0);
  const rawMax = new THREE.Vector3(Number(bmax.x) || 0, Number(bmax.y) || 0, Number(bmax.z) || 0);
  const rawCenter = rawMin.clone().add(rawMax).multiplyScalar(0.5);
  const rawDiag = rawMax.clone().sub(rawMin).length();
  const rawPos = new THREE.Vector3(
    Number(vob?.position?.x) || 0,
    Number(vob?.position?.y) || 0,
    Number(vob?.position?.z) || 0,
  );
  const centerToPos = rawCenter.distanceTo(rawPos);

  // Zen VOB bbox is often already in world-space; detect this first.
  // If bbox center is close to vob.position compared to bbox size, treat bbox as world-space.
  const looksWorldSpace = Number.isFinite(rawDiag) && centerToPos <= Math.max(150, rawDiag * 1.5);
  if (looksWorldSpace) {
    // Convert world-space bbox to renderer-space by mirroring X axis.
    const worldMin = new THREE.Vector3(-rawMax.x, rawMin.y, rawMin.z);
    const worldMax = new THREE.Vector3(-rawMin.x, rawMax.y, rawMax.z);
    return { min: worldMin, max: worldMax };
  }

  const localMin = rawMin;
  const localMax = rawMax;
  const localCenter = localMin.clone().add(localMax).multiplyScalar(0.5);
  const localHalf = localMax.clone().sub(localMin).multiplyScalar(0.5);
  const maxHalf = Math.max(localHalf.x, localHalf.y, localHalf.z);

  // Conservative world AABB without touching vob.rotation (can abort on stale handles).
  // We map center to world with mirrored X, then inflate uniformly by maxHalf to cover rotation.
  const worldCenter = new THREE.Vector3(
    -(Number(vob?.position?.x) || 0) - localCenter.x,
    (Number(vob?.position?.y) || 0) + localCenter.y,
    (Number(vob?.position?.z) || 0) + localCenter.z,
  );
  const worldHalf = new THREE.Vector3(maxHalf, maxHalf, maxHalf);
  const outMin = worldCenter.clone().sub(worldHalf);
  const outMax = worldCenter.clone().add(worldHalf);

  if (!Number.isFinite(outMin.x) || !Number.isFinite(outMax.x)) return null;
  return { min: outMin, max: outMax };
}

function isRelevantVobForNpcDefer(vob: any): boolean {
  if (!vob) return false;
  if (vob.showVisual === false) return false;
  const type = Number(vob?.visual?.type ?? -1);
  // Mesh/model/morph can occlude NPC spawn/snap in practice.
  return type === 1 || type === 2 || type === 5 || type === 6;
}

export function updateNpcVobDeferGate(
  allVobs: Array<{ id: string; vob: any }>,
  loadedIds: Set<string>,
): void {
  const next: DeferAabb[] = [];
  for (const entry of allVobs) {
    const vob = entry.vob;
    if (!isRelevantVobForNpcDefer(vob)) continue;
    const worldAabb = toWorldAabbConservative(vob);
    if (!worldAabb) continue;
    const loaded = loadedIds.has(entry.id);
    const nativeVobId = String(vob?.id ?? "");
    next.push({
      id: entry.id,
      nativeVobId,
      min: worldAabb.min,
      max: worldAabb.max,
      loaded,
    });
  }
  aabbs = next;
}

export function clearNpcVobDeferGate(): void {
  aabbs = [];
}

export function shouldDeferNpcModelLoad(
  npcWorldPos: THREE.Vector3,
  options?: { bottomOffset?: number; proximityDistance?: number },
): boolean {
  return inspectNpcModelDefer(npcWorldPos, options).defer;
}

const matchesTargetVobId = (boxId: string, nativeVobId: string, target?: string): boolean => {
  if (!target) return false;
  if (nativeVobId === target) return true;
  if (boxId === target) return true;
  return boxId.endsWith(`_${target}`);
};

export function inspectNpcModelDefer(
  npcWorldPos: THREE.Vector3,
  options?: { bottomOffset?: number; proximityDistance?: number; targetVobId?: string },
): NpcModelDeferDecision {
  const bottomOffset = options?.bottomOffset ?? 90;
  const proximityDistance = options?.proximityDistance ?? 200; // 2m
  const p = new THREE.Vector3(npcWorldPos.x, npcWorldPos.y - bottomOffset, npcWorldPos.z);
  let nearestUnloaded: NpcDeferProbe | undefined;
  let target: NpcDeferProbe | undefined;

  for (const box of aabbs) {
    const inside =
      p.x >= box.min.x &&
      p.x <= box.max.x &&
      p.y >= box.min.y &&
      p.y <= box.max.y &&
      p.z >= box.min.z &&
      p.z <= box.max.z;

    const dx = p.x < box.min.x ? box.min.x - p.x : p.x > box.max.x ? p.x - box.max.x : 0;
    const dy = p.y < box.min.y ? box.min.y - p.y : p.y > box.max.y ? p.y - box.max.y : 0;
    const dz = p.z < box.min.z ? box.min.z - p.z : p.z > box.max.z ? p.z - box.max.z : 0;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const probe: NpcDeferProbe = {
      vobId: box.id,
      nativeVobId: box.nativeVobId,
      loaded: box.loaded,
      inside,
      distance,
    };

    if (matchesTargetVobId(box.id, box.nativeVobId, options?.targetVobId)) {
      target = probe;
    }

    if (box.loaded) continue;
    if (!nearestUnloaded || probe.distance < nearestUnloaded.distance) {
      nearestUnloaded = probe;
    }
    if (inside || distance <= proximityDistance) {
      return { defer: true, probePoint: p, hit: probe, nearestUnloaded, target };
    }
  }

  return {
    defer: false,
    probePoint: p,
    nearestUnloaded,
    target,
  };
}
