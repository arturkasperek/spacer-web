import * as THREE from "three";
import type { Vob, World } from "@kolarz3/zenkit";
import { getVobType } from "./vob-utils";

export type FreepointSpot = {
  vobId: number;
  nameUpper: string;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
};

type SpotReservation = {
  byNpcInstanceIndex: number;
  untilMs: number;
};

type NpcPose = { x: number; y: number; z: number };

let worldRef: World | null = null;
let spotIndex: FreepointSpot[] | null = null;
const reservations = new Map<number, SpotReservation>();
const npcPosByInstanceIndex = new Map<number, NpcPose>();

const FPBOX_DIMENSION = 50;
const FPBOX_DIMENSION_Y = 200;

const toUpperKey = (s: string): string => (s || "").trim().toUpperCase();

function expandFreepointQueryKey(keyUpper: string): string[] {
  if (!keyUpper) return [];
  // Scripts often use group names like "STAND" rather than explicit "FP_*" names.
  // Some "stand" states still use generic roam points when no dedicated stand FP exists nearby.
  // This avoids picking unrelated far-away stand-only spots (e.g. FP_STAND_DEMENTOR_17) when ROAM is closer.
  if (keyUpper === "STAND") return ["FP_STAND", "FP_ROAM"];
  if (keyUpper.startsWith("FP_")) return [keyUpper];
  return [`FP_${keyUpper}`];
}

function iterVobsDepthFirst(root: Vob, out: Vob[]) {
  out.push(root);
  const children = root.children;
  const n = children?.size?.() ?? 0;
  for (let i = 0; i < n; i++) {
    const child = children.get(i);
    if (child) iterVobsDepthFirst(child, out);
  }
}

function getVobWorldTransform(vob: Vob): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  const rotArray = (vob as any).rotation?.toArray?.();
  const m: number[] = [];
  if (rotArray && typeof rotArray.size === "function" && typeof rotArray.get === "function") {
    const n = rotArray.size();
    for (let i = 0; i < n; i++) m.push(rotArray.get(i));
  } else {
    m.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
  }

  const transformMat = new THREE.Matrix4();
  transformMat.set(
    -m[0],
    -m[3],
    -m[6],
    -(vob.position?.x ?? 0),
    m[1],
    m[4],
    m[7],
    vob.position?.y ?? 0,
    m[2],
    m[5],
    m[8],
    vob.position?.z ?? 0,
    0,
    0,
    0,
    1
  );

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  transformMat.decompose(pos, quat, scale);
  return { pos, quat };
}

function ensureSpotIndex(): FreepointSpot[] {
  if (spotIndex) return spotIndex;
  const world = worldRef;
  if (!world) return [];

  const roots = world.getVobs();
  const all: Vob[] = [];
  const rootCount = roots.size();
  for (let i = 0; i < rootCount; i++) {
    const v = roots.get(i);
    if (v) iterVobsDepthFirst(v, all);
  }

  const spots: FreepointSpot[] = [];
  for (const vob of all) {
    const type = getVobType(vob);
    if (type !== 11) continue; // zCVobSpot
    const rawName = ((vob as any).vobName as string | undefined) || vob.name || (vob as any).objectName || "";
    const nameUpper = toUpperKey(rawName);
    if (!nameUpper) continue;
    const { pos, quat } = getVobWorldTransform(vob);
    spots.push({
      vobId: vob.id,
      nameUpper,
      position: { x: pos.x, y: pos.y, z: pos.z },
      quaternion: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
    });
  }

  spotIndex = spots;
  return spots;
}

function isInSpotBBox(spot: FreepointSpot, npcPos: NpcPose): boolean {
  const dx = npcPos.x - spot.position.x;
  const dy = npcPos.y - spot.position.y;
  const dz = npcPos.z - spot.position.z;
  return Math.abs(dx) <= FPBOX_DIMENSION && Math.abs(dy) <= FPBOX_DIMENSION_Y && Math.abs(dz) <= FPBOX_DIMENSION;
}

function isSpotInUseByNpc(spot: FreepointSpot, npcInstanceIndex: number, npcPos: NpcPose): boolean {
  const res = reservations.get(spot.vobId);
  if (!res || res.byNpcInstanceIndex !== npcInstanceIndex) return false;
  // ZenGin's zCVobSpot::IsOnFP is a "who owns the spot" flag (inUseVob == vob),
  // and IsAvailable() keeps/clears that ownership based on whether the owner is still
  // inside the freepoint bbox (±50, ±100, ±50). We approximate that behavior here.
  return isInSpotBBox(spot, npcPos);
}

function isSpotAvailable(spot: FreepointSpot, requesterNpcInstanceIndex: number, nowMs: number): boolean {
  const res = reservations.get(spot.vobId);
  if (!res) return true;
  if (res.byNpcInstanceIndex === requesterNpcInstanceIndex) return true;
  if (nowMs < res.untilMs) return false;

  const holderPos = npcPosByInstanceIndex.get(res.byNpcInstanceIndex);
  if (holderPos && isInSpotBBox(spot, holderPos)) return false;

  reservations.delete(spot.vobId);
  return true;
}

export function setFreepointsWorld(world: World | null): void {
  worldRef = world;
  spotIndex = null;
  reservations.clear();
}

export function updateNpcWorldPosition(instanceIndex: number, pos: NpcPose): void {
  if (!Number.isFinite(instanceIndex)) return;
  npcPosByInstanceIndex.set(instanceIndex, { x: pos.x, y: pos.y, z: pos.z });
}

export function removeNpcWorldPosition(instanceIndex: number): void {
  npcPosByInstanceIndex.delete(instanceIndex);
}

export function getNpcWorldPosition(instanceIndex: number): NpcPose | null {
  const p = npcPosByInstanceIndex.get(instanceIndex);
  return p ? { x: p.x, y: p.y, z: p.z } : null;
}

export type FindFreepointOptions = {
  checkDistance?: boolean;
  dist?: number;
  distY?: number;
  avoidCurrentSpot?: boolean;
};

export function findFreepointForNpc(
  npcInstanceIndex: number,
  freepointName: string,
  options?: FindFreepointOptions
): FreepointSpot | null {
  const spots = ensureSpotIndex();
  const npcPos = npcPosByInstanceIndex.get(npcInstanceIndex);
  if (!npcPos) return null;

  const key = toUpperKey(freepointName);
  if (!key) return null;
  const queryKeys = expandFreepointQueryKey(key);
  if (queryKeys.length === 0) return null;

  const dist = options?.dist ?? 2000;
  const distY = options?.distY ?? dist;
  const checkDistance = options?.checkDistance ?? true;
  const avoidCurrentSpot = options?.avoidCurrentSpot ?? !checkDistance;
  const nowMs = Date.now();

  const bboxMinX = npcPos.x - dist;
  const bboxMaxX = npcPos.x + dist;
  const bboxMinY = npcPos.y - distY;
  const bboxMaxY = npcPos.y + distY;
  const bboxMinZ = npcPos.z - dist;
  const bboxMaxZ = npcPos.z + dist;

  const candidates: FreepointSpot[] = [];
  for (const s of spots) {
    const p = s.position;
    if (p.x < bboxMinX || p.x > bboxMaxX) continue;
    if (p.y < bboxMinY || p.y > bboxMaxY) continue;
    if (p.z < bboxMinZ || p.z > bboxMaxZ) continue;
    if (!queryKeys.some(q => s.nameUpper.indexOf(q) >= 0)) continue;
    if (!isSpotAvailable(s, npcInstanceIndex, nowMs)) continue;
    if (avoidCurrentSpot && isSpotInUseByNpc(s, npcInstanceIndex, npcPos)) continue;
    candidates.push(s);
  }

  if (candidates.length === 0) return null;

  if (checkDistance) {
    candidates.sort((a, b) => {
      const dax = a.position.x - npcPos.x;
      const day = a.position.y - npcPos.y;
      const daz = a.position.z - npcPos.z;
      const dbx = b.position.x - npcPos.x;
      const dby = b.position.y - npcPos.y;
      const dbz = b.position.z - npcPos.z;
      return dax * dax + day * day + daz * daz - (dbx * dbx + dby * dby + dbz * dbz);
    });
  }

  return candidates[0] ?? null;
}

export function reserveFreepoint(spotVobId: number, npcInstanceIndex: number, holdMs: number): void {
  const nowMs = Date.now();
  reservations.set(spotVobId, { byNpcInstanceIndex: npcInstanceIndex, untilMs: nowMs + Math.max(0, holdMs) });
}

export function acquireFreepointForNpc(
  npcInstanceIndex: number,
  freepointName: string,
  options?: FindFreepointOptions & { holdMs?: number }
): FreepointSpot | null {
  const spot = findFreepointForNpc(npcInstanceIndex, freepointName, options);
  if (!spot) return null;
  reserveFreepoint(spot.vobId, npcInstanceIndex, options?.holdMs ?? 30_000);
  return spot;
}

export function isFreepointAvailableForNpc(npcInstanceIndex: number, freepointName: string, checkDistance: boolean): boolean {
  // Gothic uses oCNpc::FindSpot(name, checkDistance, dist=700) for most FP queries.
  return Boolean(findFreepointForNpc(npcInstanceIndex, freepointName, { checkDistance, dist: 700 }));
}

export function isNpcOnFreepoint(npcInstanceIndex: number, freepointName: string, dist: number = 100): boolean {
  const npcPos = npcPosByInstanceIndex.get(npcInstanceIndex);
  if (!npcPos) return false;
  // Gothic's Npc_IsOnFP() does: FindSpot(name, checkDistance=true, dist=100), then spot->IsOnFP(npc).
  // zCVobSpot::IsOnFP checks "ownership" (inUseVob == npc), and IsAvailable() keeps/clears ownership
  // based on whether the owner is still inside the freepoint bbox.
  // In spacer-web, freepoints can be vertically offset from walkable ground (missing collision / stacked geometry),
  // so we allow a wider vertical search window than `dist` while still keeping the original bbox ownership check.
  const spot = findFreepointForNpc(npcInstanceIndex, freepointName, {
    checkDistance: true,
    dist,
    distY: Math.max(dist, FPBOX_DIMENSION_Y),
    avoidCurrentSpot: false,
  });
  if (!spot) return false;
  return isSpotInUseByNpc(spot, npcInstanceIndex, npcPos);
}
