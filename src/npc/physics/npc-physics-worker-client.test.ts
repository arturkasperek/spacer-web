import { NpcPhysicsWorkerClient } from "./npc-physics-worker-client";
import type { NpcSnapshotMessage } from "./npc-physics-worker-protocol";

type MockWorkerInstance = {
  postMessage: jest.Mock;
  terminate: jest.Mock;
  onmessage: ((event: MessageEvent<NpcSnapshotMessage>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: MessageEvent<any>) => void) | null;
};

describe("NpcPhysicsWorkerClient", () => {
  const originalWorker = global.Worker;
  let createdWorkers: MockWorkerInstance[] = [];

  beforeEach(() => {
    createdWorkers = [];
    const WorkerMock = jest.fn().mockImplementation(() => {
      const worker: MockWorkerInstance = {
        postMessage: jest.fn(),
        terminate: jest.fn(),
        onmessage: null,
        onerror: null,
        onmessageerror: null,
      };
      createdWorkers.push(worker);
      return worker;
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
    expect(createdWorkers[0]).toBeDefined();
    expect(createdWorkers[0]?.postMessage).toHaveBeenCalledWith({ type: "npc_worker_init" });
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

    expect(createdWorkers[0]?.postMessage).toHaveBeenCalledWith(
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

  it("sends world geometry to worker", () => {
    const client = new NpcPhysicsWorkerClient();
    client.start();
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const indices = new Uint32Array([0, 1, 2]);
    client.setWorldGeometry(vertices, indices);

    expect(createdWorkers[0]?.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "npc_worker_world_geometry",
        vertices: expect.any(ArrayBuffer),
        indices: expect.any(ArrayBuffer),
      }),
      expect.any(Array),
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

    createdWorkers[0]?.onmessage?.({
      data: mkSnapshot(10, 1000, 10),
    } as MessageEvent<NpcSnapshotMessage>);
    createdWorkers[0]?.onmessage?.({
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

    expect(createdWorkers[0]?.postMessage).toHaveBeenCalledWith({ type: "npc_worker_stop" });
    expect(createdWorkers[0]?.terminate).toHaveBeenCalledTimes(1);

    const sampledAfterStop = client.samplePairs(1000, 20);
    expect(sampledAfterStop).toBeNull();
  });

  it("handles start/stop/start lifecycle race safely", () => {
    const client = new NpcPhysicsWorkerClient();
    client.start();
    const firstWorker = createdWorkers[0];
    client.stop();
    client.start();

    expect(global.Worker).toHaveBeenCalledTimes(2);
    expect(firstWorker?.terminate).toHaveBeenCalledTimes(1);
    expect(createdWorkers[1]?.postMessage).toHaveBeenCalledWith({ type: "npc_worker_init" });
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
    expect(createdWorkers.length).toBe(0);
  });

  it("reconnects worker when worker emits error", () => {
    const client = new NpcPhysicsWorkerClient();
    client.start();
    client.setWorldGeometry(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      new Uint32Array([0, 1, 2]),
    );

    createdWorkers[0]?.onerror?.(new Event("error"));

    expect(global.Worker).toHaveBeenCalledTimes(2);
    expect(createdWorkers[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(createdWorkers[1]?.postMessage).toHaveBeenCalledWith({ type: "npc_worker_init" });
    expect(createdWorkers[1]?.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "npc_worker_world_geometry",
        vertices: expect.any(ArrayBuffer),
        indices: expect.any(ArrayBuffer),
      }),
      expect.any(Array),
    );
    const diag = client.getDiagnostics();
    expect(diag.workerErrorCount).toBe(1);
    expect(diag.reconnectCount).toBe(1);
  });

  it("detects out-of-order and dropped snapshot gaps in diagnostics", () => {
    const perfSpy = jest.spyOn(performance, "now");
    perfSpy
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1010)
      .mockReturnValueOnce(1020)
      .mockReturnValueOnce(1030);

    const client = new NpcPhysicsWorkerClient();
    client.start();
    const worker = createdWorkers[0];
    worker?.onmessage?.({
      data: {
        type: "npc_snapshot",
        simTick: 10,
        simTimeMs: 1000,
        generatedAtMs: 1000,
        states: [],
      },
    } as unknown as MessageEvent<NpcSnapshotMessage>);
    worker?.onmessage?.({
      data: {
        type: "npc_snapshot",
        simTick: 13,
        simTimeMs: 1016.67,
        generatedAtMs: 1016.67,
        states: [],
      },
    } as unknown as MessageEvent<NpcSnapshotMessage>);
    worker?.onmessage?.({
      data: {
        type: "npc_snapshot",
        simTick: 12,
        simTimeMs: 1033.34,
        generatedAtMs: 1033.34,
        states: [],
      },
    } as unknown as MessageEvent<NpcSnapshotMessage>);

    const diag = client.getDiagnostics();
    expect(diag.snapshotReceivedCount).toBe(3);
    expect(diag.snapshotDropGapCount).toBe(1);
    expect(diag.snapshotOutOfOrderCount).toBeGreaterThan(0);
    expect(diag.maxObservedTickGap).toBe(3);
    perfSpy.mockRestore();
  });

  it("reconnects when snapshots become stale while intents are being sent", () => {
    const perfSpy = jest.spyOn(performance, "now");
    perfSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1601);

    const client = new NpcPhysicsWorkerClient({ snapshotStaleMs: 500 });
    client.start();
    createdWorkers[0]?.onmessage?.({
      data: {
        type: "npc_snapshot",
        simTick: 1,
        simTimeMs: 1000,
        generatedAtMs: 1000,
        states: [],
      },
    } as unknown as MessageEvent<NpcSnapshotMessage>);

    client.pushIntents(2, [
      {
        npcId: "npc-1",
        inputSeq: 2,
        desiredX: 1,
        desiredY: 0,
        desiredZ: 0,
        jumpRequested: false,
      },
    ]);

    expect(global.Worker).toHaveBeenCalledTimes(2);
    expect(createdWorkers[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(createdWorkers[1]?.postMessage).toHaveBeenCalledWith({ type: "npc_worker_init" });
    expect(client.getDiagnostics().reconnectCount).toBe(1);
    perfSpy.mockRestore();
  });
});
