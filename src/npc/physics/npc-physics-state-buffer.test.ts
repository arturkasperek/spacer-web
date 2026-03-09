import { createNpcStateBuffer } from "./npc-physics-state-buffer";
import type { NpcSnapshotMessage } from "./npc-physics-worker-protocol";

function mkSnapshot(simTick: number, simTimeMs: number, px: number): NpcSnapshotMessage {
  return {
    type: "npc_snapshot",
    simTick,
    simTimeMs,
    generatedAtMs: simTimeMs,
    states: [
      {
        npcId: "npc-1",
        px,
        py: 0,
        pz: 0,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        vx: 0,
        vy: 0,
        vz: 0,
        grounded: true,
        falling: false,
        sliding: false,
        jumpActive: false,
      },
    ],
  };
}

describe("npc-physics-state-buffer", () => {
  it("accepts strictly increasing ticks and rejects out-of-order snapshots", () => {
    const buf = createNpcStateBuffer(16);
    expect(buf.push(mkSnapshot(10, 100, 10))).toBe(true);
    expect(buf.push(mkSnapshot(11, 116.67, 20))).toBe(true);

    // out-of-order / stale
    expect(buf.push(mkSnapshot(10, 100, 999))).toBe(false);
    expect(buf.push(mkSnapshot(9, 83.3, 999))).toBe(false);

    expect(buf.getLatestTick()).toBe(11);
  });

  it("samples interpolated pairs for render time between two snapshots", () => {
    const buf = createNpcStateBuffer(16);
    buf.push(mkSnapshot(100, 1000, 10));
    buf.push(mkSnapshot(101, 1016.67, 20));

    const sampled = buf.sample(1008.335); // midpoint
    expect(sampled).not.toBeNull();
    const pair = sampled?.get("npc-1");
    expect(pair).toBeDefined();
    expect(pair?.alpha).toBeGreaterThan(0.49);
    expect(pair?.alpha).toBeLessThan(0.51);
  });

  it("returns null when there is no valid S0/S1 pair", () => {
    const buf = createNpcStateBuffer(16);
    buf.push(mkSnapshot(1, 100, 0));

    expect(buf.sample(100)).toBeNull();
    expect(buf.sample(200)).toBeNull();
  });

  it("handles drop by interpolating over a larger gap", () => {
    const buf = createNpcStateBuffer(16);
    buf.push(mkSnapshot(200, 2000, 0));
    // dropped tick 201
    buf.push(mkSnapshot(202, 2033.34, 20));

    const sampled = buf.sample(2016.67);
    expect(sampled).not.toBeNull();
    const pair = sampled?.get("npc-1");
    expect(pair).toBeDefined();
    expect(pair?.alpha).toBeGreaterThan(0.49);
    expect(pair?.alpha).toBeLessThan(0.51);
  });

  it("overwrites old snapshots in ring buffer capacity and still samples newest timeline", () => {
    const buf = createNpcStateBuffer(8);
    for (let i = 1; i <= 9; i++) {
      buf.push(mkSnapshot(i, 1000 + i * 16, i));
    }

    const sampledOld = buf.sample(1032);
    expect(sampledOld).toBeNull();

    const sampledNew = buf.sample(1120);
    expect(sampledNew).not.toBeNull();
    expect(sampledNew?.get("npc-1")).toBeDefined();
  });

  it("clears buffer state", () => {
    const buf = createNpcStateBuffer(16);
    buf.push(mkSnapshot(1, 100, 0));
    buf.push(mkSnapshot(2, 116.67, 10));
    expect(buf.getLatestTick()).toBe(2);

    buf.clear();
    expect(buf.getLatestTick()).toBe(-1);
    expect(buf.sample(110)).toBeNull();
  });

  it("handles very large simTick values without overflow issues", () => {
    const buf = createNpcStateBuffer(32);
    const base = 9_007_199_254_740_900; // near Number.MAX_SAFE_INTEGER
    expect(buf.push(mkSnapshot(base, 1000, 10))).toBe(true);
    expect(buf.push(mkSnapshot(base + 1, 1016.67, 20))).toBe(true);
    const sampled = buf.sample(1008.335);
    expect(sampled).not.toBeNull();
    expect(sampled?.get("npc-1")).toBeDefined();
  });

  it("returns pair only for NPCs present in both snapshots", () => {
    const buf = createNpcStateBuffer(16);
    buf.push({
      ...mkSnapshot(1, 1000, 10),
      states: [
        mkSnapshot(1, 1000, 10).states[0],
        {
          ...mkSnapshot(1, 1000, 0).states[0],
          npcId: "npc-2",
          px: 1,
        },
      ],
    });
    buf.push({
      ...mkSnapshot(2, 1016.67, 20),
      states: [mkSnapshot(2, 1016.67, 20).states[0]],
    });

    const sampled = buf.sample(1008.335);
    expect(sampled).not.toBeNull();
    expect(sampled?.has("npc-1")).toBe(true);
    expect(sampled?.has("npc-2")).toBe(false);
  });

  it("ignores long out-of-order streak and keeps latest timeline", () => {
    const buf = createNpcStateBuffer(16);
    expect(buf.push(mkSnapshot(100, 1000, 10))).toBe(true);
    expect(buf.push(mkSnapshot(101, 1016.67, 20))).toBe(true);
    for (let t = 99; t >= 90; t--) {
      expect(buf.push(mkSnapshot(t, 900 + t, 999))).toBe(false);
    }
    expect(buf.getLatestTick()).toBe(101);
    const sampled = buf.sample(1008.335);
    expect(sampled).not.toBeNull();
  });
});
