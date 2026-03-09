import type { NpcSnapshotMessage, NpcSnapshotState } from "./npc-physics-worker-protocol";

export type NpcStatePair = {
  prev: NpcSnapshotState;
  next: NpcSnapshotState;
  alpha: number;
};

type SnapshotSlot = NpcSnapshotMessage | null;

const clamp01 = (v: number) => {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
};

export function createNpcStateBuffer(capacity = 128) {
  const size = Math.max(8, Math.floor(capacity));
  const slots: SnapshotSlot[] = Array.from({ length: size }, () => null);
  let latestTick = -1;

  const push = (snapshot: NpcSnapshotMessage): boolean => {
    if (!Number.isFinite(snapshot.simTick)) return false;
    if (snapshot.simTick <= latestTick) return false;
    latestTick = snapshot.simTick;
    slots[snapshot.simTick % size] = snapshot;
    return true;
  };

  const getPairForRender = (
    renderTimeMs: number,
  ): { a: NpcSnapshotMessage; b: NpcSnapshotMessage } | null => {
    let prev: NpcSnapshotMessage | null = null;
    let next: NpcSnapshotMessage | null = null;

    for (const snap of slots) {
      if (!snap) continue;
      const t = snap.simTimeMs;
      if (t <= renderTimeMs && (!prev || t > prev.simTimeMs)) prev = snap;
      if (t >= renderTimeMs && (!next || t < next.simTimeMs)) next = snap;
    }

    if (!prev || !next) return null;
    if (prev.simTick >= next.simTick) return null;
    return { a: prev, b: next };
  };

  const sample = (renderTimeMs: number): Map<string, NpcStatePair> | null => {
    const pair = getPairForRender(renderTimeMs);
    if (!pair) return null;

    const out = new Map<string, NpcStatePair>();
    const dt = Math.max(1e-6, pair.b.simTimeMs - pair.a.simTimeMs);
    const alpha = clamp01((renderTimeMs - pair.a.simTimeMs) / dt);

    const byIdB = new Map<string, NpcSnapshotState>();
    for (const s of pair.b.states) byIdB.set(s.npcId, s);

    for (const aState of pair.a.states) {
      const bState = byIdB.get(aState.npcId);
      if (!bState) continue;
      out.set(aState.npcId, { prev: aState, next: bState, alpha });
    }

    return out;
  };

  const clear = () => {
    for (let i = 0; i < slots.length; i++) slots[i] = null;
    latestTick = -1;
  };

  return {
    push,
    sample,
    clear,
    capacity: size,
    getLatestTick: () => latestTick,
  } as const;
}
