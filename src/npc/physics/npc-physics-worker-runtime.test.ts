import { createNpcPhysicsWorkerRuntime } from "./npc-physics-worker-runtime";
import type { NpcIntent } from "./npc-physics-worker-protocol";

const mkIntent = (desiredX: number, desiredZ: number): NpcIntent => ({
  npcId: "npc-1",
  inputSeq: 1,
  desiredX,
  desiredY: 0,
  desiredZ,
  jumpRequested: false,
});

describe("npc-physics-worker-runtime", () => {
  it("advances sim tick and produces snapshots", () => {
    const rt = createNpcPhysicsWorkerRuntime({ now: () => 1000 });
    rt.applyIntentBatch([mkIntent(100, 0)], 1000);
    rt.tick(1000);
    const snap = rt.makeSnapshot(1000);

    expect(rt.getSimTick()).toBe(1);
    expect(snap.simTick).toBe(1);
    expect(snap.states.length).toBe(1);
  });

  it("moves toward desired position", () => {
    const rt = createNpcPhysicsWorkerRuntime({ tickMs: 1000 / 60, now: () => 1000 });
    rt.applyIntentBatch([mkIntent(0, 0)], 1000);
    rt.tick(1000);
    rt.applyIntentBatch([mkIntent(120, 0)], 1001);
    rt.tick(1000);

    const st = rt.getState("npc-1");
    expect(st).toBeDefined();
    expect(st?.px).toBe(120);
    expect((st?.vx ?? 0) > 0).toBe(true);
  });

  it("expires stale intent by timeout and stops movement", () => {
    const rt = createNpcPhysicsWorkerRuntime({
      tickMs: 1000 / 60,
      intentTimeoutMs: 50,
      now: () => 1000,
    });
    rt.applyIntentBatch([mkIntent(500, 0)], 1000);
    rt.tick(1000);
    const pxAfterFirstTick = rt.getState("npc-1")?.px ?? 0;

    rt.tick(1070);
    const st = rt.getState("npc-1");
    expect(st).toBeDefined();
    expect(st?.vx).toBe(0);
    expect(st?.vz).toBe(0);
    expect(st?.px).toBe(pxAfterFirstTick);
  });

  it("updates multiple NPCs independently", () => {
    const rt = createNpcPhysicsWorkerRuntime({ now: () => 1000 });
    rt.applyIntentBatch(
      [
        { npcId: "a", inputSeq: 1, desiredX: 100, desiredY: 0, desiredZ: 0, jumpRequested: false },
        { npcId: "b", inputSeq: 1, desiredX: 0, desiredY: 0, desiredZ: 100, jumpRequested: false },
      ],
      1000,
    );
    rt.tick(1000);

    const a = rt.getState("a");
    const b = rt.getState("b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect((a?.px ?? 0) > 0).toBe(true);
    expect((b?.pz ?? 0) > 0).toBe(true);
  });
});
