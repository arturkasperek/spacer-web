import * as THREE from "three";
import type { Vob, World } from "@kolarz3/zenkit";
import { getVobType } from "../../vob-utils";

export type FreepointSpot = {
  vobId: number;
  nameUpper: string;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
};

type SpotReservation = {
  byNpcInstanceIndex: number;
  untilMs: number;
  confirmedOnSpot: boolean;
};

export type FreepointReservationInfo = {
  spotVobId: number;
  byNpcInstanceIndex: number;
  untilMs: number;
};

type NpcPose = { x: number; y: number; z: number };

let worldRef: World | null = null;
let spotIndex: FreepointSpot[] | null = null;
let spotIndexById: Map<number, FreepointSpot> | null = null;
const reservations = new Map<number, SpotReservation>();
const reservationsByNpc = new Map<number, Set<number>>();
const npcPosByInstanceIndex = new Map<number, NpcPose>();

const FPBOX_DIMENSION = 50;
const FPBOX_DIMENSION_Y = 200;

const toUpperKey = (s: string): string => (s || "").trim().toUpperCase();

function deleteReservation(spotVobId: number): void {
  const res = reservations.get(spotVobId);
  if (res) {
    const s = reservationsByNpc.get(res.byNpcInstanceIndex);
    if (s) {
      s.delete(spotVobId);
      if (s.size === 0) reservationsByNpc.delete(res.byNpcInstanceIndex);
    }
  }
  reservations.delete(spotVobId);
}

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
    1,
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
    const rawName =
      ((vob as any).vobName as string | undefined) || vob.name || (vob as any).objectName || "";
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
  spotIndexById = new Map(spots.map((s) => [s.vobId, s]));
  return spots;
}

function isInSpotBBox(spot: FreepointSpot, npcPos: NpcPose): boolean {
  const dx = npcPos.x - spot.position.x;
  const dy = npcPos.y - spot.position.y;
  const dz = npcPos.z - spot.position.z;
  return (
    Math.abs(dx) <= FPBOX_DIMENSION &&
    Math.abs(dy) <= FPBOX_DIMENSION_Y &&
    Math.abs(dz) <= FPBOX_DIMENSION
  );
}

function isSpotInUseByNpc(spot: FreepointSpot, npcInstanceIndex: number): boolean {
  const res = reservations.get(spot.vobId);
  if (!res || res.byNpcInstanceIndex !== npcInstanceIndex) return false;
  // ZenGin's zCVobSpot::IsOnFP is only an ownership check (inUseVob == vob).
  // The bbox check belongs to IsAvailable(), which may clear ownership if the owner left the box.
  // We mimic that split: "in use by" means "reserved by", regardless of current position.
  return true;
}

function isSpotAvailable(
  spot: FreepointSpot,
  requesterNpcInstanceIndex: number,
  nowMs: number,
): boolean {
  const res = reservations.get(spot.vobId);
  if (!res) return true;

  // Match ZenGin's zCVobSpot::IsAvailable() semantics:
  // - The owner can "auto-release" the spot early if they are no longer inside the FP bbox.
  // - Other NPCs can't force-release within the hold window (timer).
  if (res.byNpcInstanceIndex === requesterNpcInstanceIndex) {
    const holderPos = npcPosByInstanceIndex.get(res.byNpcInstanceIndex);
    if (holderPos && isInSpotBBox(spot, holderPos)) {
      res.confirmedOnSpot = true;
      reservations.set(spot.vobId, res);
    } else if (res.confirmedOnSpot) {
      deleteReservation(spot.vobId);
    }
    return true;
  }
  if (nowMs < res.untilMs) return false;

  const holderPos = npcPosByInstanceIndex.get(res.byNpcInstanceIndex);
  if (holderPos && isInSpotBBox(spot, holderPos)) return false;

  deleteReservation(spot.vobId);
  return true;
}

export function setFreepointsWorld(world: World | null): void {
  worldRef = world;
  spotIndex = null;
  spotIndexById = null;
  reservations.clear();
  reservationsByNpc.clear();
}

export function updateNpcWorldPosition(instanceIndex: number, pos: NpcPose): void {
  if (!Number.isFinite(instanceIndex)) return;
  const nextPos = { x: pos.x, y: pos.y, z: pos.z };
  npcPosByInstanceIndex.set(instanceIndex, nextPos);

  // Keep reservations responsive even if the script loop is gated on "EM empty".
  // If an NPC leaves a spot after having been confirmed inside its bbox at least once,
  // release it immediately (mirrors "owner left bbox" auto-release behavior).
  const owned = reservationsByNpc.get(instanceIndex);
  if (!owned || owned.size === 0) return;
  if (!spotIndexById) return;

  for (const spotVobId of Array.from(owned)) {
    const res = reservations.get(spotVobId);
    if (!res || res.byNpcInstanceIndex !== instanceIndex) {
      owned.delete(spotVobId);
      continue;
    }
    if (!res.confirmedOnSpot) continue;
    const spot = spotIndexById.get(spotVobId);
    if (!spot) continue;
    if (!isInSpotBBox(spot, nextPos)) {
      deleteReservation(spotVobId);
    }
  }
}

export function removeNpcWorldPosition(instanceIndex: number): void {
  npcPosByInstanceIndex.delete(instanceIndex);
}

export function getNpcWorldPosition(instanceIndex: number): NpcPose | null {
  const p = npcPosByInstanceIndex.get(instanceIndex);
  return p ? { x: p.x, y: p.y, z: p.z } : null;
}

export function getFreepointReservationsSnapshot(): FreepointReservationInfo[] {
  const out: FreepointReservationInfo[] = [];
  for (const [spotVobId, res] of reservations.entries()) {
    out.push({ spotVobId, byNpcInstanceIndex: res.byNpcInstanceIndex, untilMs: res.untilMs });
  }
  return out;
}

export function getFreepointSpotsSnapshot(): ReadonlyArray<FreepointSpot> {
  return ensureSpotIndex();
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
  options?: FindFreepointOptions,
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
    if (!queryKeys.some((q) => s.nameUpper.indexOf(q) >= 0)) continue;
    if (!isSpotAvailable(s, npcInstanceIndex, nowMs)) continue;
    if (avoidCurrentSpot && isSpotInUseByNpc(s, npcInstanceIndex)) continue;
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

export function reserveFreepoint(
  spotVobId: number,
  npcInstanceIndex: number,
  holdMs: number,
): void {
  const nowMs = Date.now();
  reservations.set(spotVobId, {
    byNpcInstanceIndex: npcInstanceIndex,
    untilMs: nowMs + Math.max(0, holdMs),
    confirmedOnSpot: false,
  });
  let s = reservationsByNpc.get(npcInstanceIndex);
  if (!s) {
    s = new Set<number>();
    reservationsByNpc.set(npcInstanceIndex, s);
  }
  s.add(spotVobId);
}

export function clearNpcFreepointReservations(npcInstanceIndex: number): void {
  const s = reservationsByNpc.get(npcInstanceIndex);
  if (!s || s.size === 0) return;
  for (const spotVobId of Array.from(s)) {
    deleteReservation(spotVobId);
  }
  reservationsByNpc.delete(npcInstanceIndex);
}

export function acquireFreepointForNpc(
  npcInstanceIndex: number,
  freepointName: string,
  options?: FindFreepointOptions & { holdMs?: number },
): FreepointSpot | null {
  const spot = findFreepointForNpc(npcInstanceIndex, freepointName, options);
  if (!spot) return null;
  reserveFreepoint(spot.vobId, npcInstanceIndex, options?.holdMs ?? 30_000);
  return spot;
}

export function isFreepointAvailableForNpc(
  npcInstanceIndex: number,
  freepointName: string,
  checkDistance: boolean,
): boolean {
  // Gothic uses oCNpc::FindSpot(name, checkDistance, dist=700) for most FP queries.
  return Boolean(
    findFreepointForNpc(npcInstanceIndex, freepointName, { checkDistance, dist: 700 }),
  );
}

export function isNpcOnFreepoint(
  npcInstanceIndex: number,
  freepointName: string,
  dist: number = 100,
): boolean {
  const npcPos = npcPosByInstanceIndex.get(npcInstanceIndex);
  if (!npcPos) return false;
  // Gothic's Npc_IsOnFP() does: FindSpot(name, checkDistance=true, dist=100), then spot->IsOnFP(npc).
  // zCVobSpot::IsOnFP is only an ownership check (inUseVob == npc); bbox membership is handled in IsAvailable().
  // In spacer-web, freepoints can be vertically offset from walkable ground (missing collision / stacked geometry),
  // so we allow a wider vertical search window than `dist`.
  const spot = findFreepointForNpc(npcInstanceIndex, freepointName, {
    checkDistance: true,
    dist,
    distY: Math.max(dist, FPBOX_DIMENSION_Y),
    avoidCurrentSpot: false,
  });
  if (!spot) return false;
  const res = reservations.get(spot.vobId);
  if (!res || res.byNpcInstanceIndex !== npcInstanceIndex) return false;
  if (!isInSpotBBox(spot, npcPos)) return false;
  if (!res.confirmedOnSpot) {
    res.confirmedOnSpot = true;
    reservations.set(spot.vobId, res);
  }
  return true;
}
