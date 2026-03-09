import { NpcPhysicsWorkerClient } from "./npc-physics-worker-client";
import type { NpcSnapshotMessage } from "./npc-physics-worker-protocol";

type MockWorkerInstance = {
  postMessage: jest.Mock;
  terminate: jest.Mock;
  onmessage: ((event: MessageEvent<NpcSnapshotMessage>) => void) | null;
};

describe("NpcPhysicsWorkerClient", () => {
  const originalWorker = global.Worker;
  let createdWorker: MockWorkerInstance | null = null;

  beforeEach(() => {
    createdWorker = null;
    const WorkerMock = jest.fn().mockImplementation(() => {
      createdWorker = {
        postMessage: jest.fn(),
        terminate: jest.fn(),
        onmessage: null,
      };
      return createdWorker;
    });
    (global as any).Worker = WorkerMock;
  });

  afterEach(() => {
    (global as any).Worker = originalWorker;
  });

  it("starts worker and sends init message", () => {
    const client = new NpcPhysicsWorkerClient();
    client.start();

    expect(global.Worker).toHaveBeenCalledTimes(1);
    expect(createdWorker).not.toBeNull();
    expect(createdWorker?.postMessage).toHaveBeenCalledWith({ type: "npc_worker_init" });
  });

  it("pushes intent batch to worker", () => {
    const client = new NpcPhysicsWorkerClient();
    client.start();

    client.pushIntents(7, [
      {
        npcId: "npc-1",
        inputSeq: 7,
        desiredX: 10,
        desiredY: 0,
        desiredZ: 20,
        jumpRequested: false,
      },
    ]);

    expect(createdWorker?.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "npc_intent_batch",
        frameId: 7,
        intents: [
          {
            npcId: "npc-1",
            inputSeq: 7,
            desiredX: 10,
            desiredY: 0,
            desiredZ: 20,
            jumpRequested: false,
          },
        ],
      }),
    );
  });

  it("stores incoming snapshots and returns sampled pairs", () => {
    const perfSpy = jest.spyOn(performance, "now");
    perfSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1016.67);

    const client = new NpcPhysicsWorkerClient();
    client.start();

    const mkSnapshot = (simTick: number, simTimeMs: number, px: number): NpcSnapshotMessage => ({
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
    });

    createdWorker?.onmessage?.({
      data: mkSnapshot(10, 1000, 10),
    } as MessageEvent<NpcSnapshotMessage>);
    createdWorker?.onmessage?.({
      data: mkSnapshot(11, 1016.67, 20),
    } as MessageEvent<NpcSnapshotMessage>);

    const sampled = client.samplePairs(1030, 20); // renderTime ~1010 (between tick 10 and 11)
    expect(sampled).not.toBeNull();
    expect(sampled?.get("npc-1")).toBeDefined();
    const latest = client.sampleLatestStates();
    expect(latest).not.toBeNull();
    expect(latest?.get("npc-1")?.px).toBe(20);
    perfSpy.mockRestore();
  });

  it("stops worker and clears state", () => {
    const client = new NpcPhysicsWorkerClient();
    client.start();
    client.stop();

    expect(createdWorker?.postMessage).toHaveBeenCalledWith({ type: "npc_worker_stop" });
    expect(createdWorker?.terminate).toHaveBeenCalledTimes(1);

    const sampledAfterStop = client.samplePairs(1000, 20);
    expect(sampledAfterStop).toBeNull();
  });

  it("handles start/stop/start lifecycle race safely", () => {
    const client = new NpcPhysicsWorkerClient();
    client.start();
    const firstWorker = createdWorker;
    client.stop();
    client.start();

    expect(global.Worker).toHaveBeenCalledTimes(2);
    expect(firstWorker?.terminate).toHaveBeenCalledTimes(1);
    expect(createdWorker?.postMessage).toHaveBeenCalledWith({ type: "npc_worker_init" });
  });

  it("no-ops pushIntents when worker is not started", () => {
    const client = new NpcPhysicsWorkerClient();
    expect(() =>
      client.pushIntents(1, [
        {
          npcId: "npc-1",
          inputSeq: 1,
          desiredX: 0,
          desiredY: 0,
          desiredZ: 0,
          jumpRequested: false,
        },
      ]),
    ).not.toThrow();
    expect(createdWorker).toBeNull();
  });
});
