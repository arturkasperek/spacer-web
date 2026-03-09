import {
  type NpcIntent,
  type NpcSnapshotMessage,
  type NpcWorkerInboundMessage,
} from "./npc-physics-worker-protocol";
import { createNpcStateBuffer } from "./npc-physics-state-buffer";

export type NpcPhysicsWorkerClientOptions = {
  snapshotStaleMs?: number;
};

export type NpcPhysicsWorkerDiagnostics = {
  reconnectCount: number;
  workerErrorCount: number;
  snapshotReceivedCount: number;
  snapshotOutOfOrderCount: number;
  snapshotDropGapCount: number;
  maxObservedTickGap: number;
  lastSnapshotTick: number | null;
  lastSnapshotReceivedAtMs: number | null;
  lastIntentSentAtMs: number | null;
};

const DEFAULT_SNAPSHOT_STALE_MS = 500;

export class NpcPhysicsWorkerClient {
  private readonly snapshotStaleMs: number;
  private worker: Worker | null = null;
  private readonly stateBuffer = createNpcStateBuffer(128);
  private workerToMainTimeOffsetMs: number | null = null;
  private worldGeometry: { vertices: Float32Array; indices: Uint32Array } | null = null;
  private reconnectCount = 0;
  private workerErrorCount = 0;
  private snapshotReceivedCount = 0;
  private snapshotOutOfOrderCount = 0;
  private snapshotDropGapCount = 0;
  private maxObservedTickGap = 0;
  private lastSnapshotTick: number | null = null;
  private lastSnapshotReceivedAtMs: number | null = null;
  private lastIntentSentAtMs: number | null = null;

  constructor(options?: NpcPhysicsWorkerClientOptions) {
    this.snapshotStaleMs = Math.max(
      100,
      Number(options?.snapshotStaleMs ?? DEFAULT_SNAPSHOT_STALE_MS),
    );
  }

  start() {
    if (this.worker || typeof Worker === "undefined") return;
    this.spawnWorker();
  }

  stop() {
    if (!this.worker) return;
    this.post({ type: "npc_worker_stop" });
    this.worker.terminate();
    this.worker = null;
    this.stateBuffer.clear();
    this.workerToMainTimeOffsetMs = null;
    this.lastSnapshotTick = null;
    this.lastSnapshotReceivedAtMs = null;
    this.lastIntentSentAtMs = null;
  }

  pushIntents(frameId: number, intents: NpcIntent[]) {
    if (!this.worker) return;
    const nowMs = performance.now();
    this.lastIntentSentAtMs = nowMs;
    this.post({
      type: "npc_intent_batch",
      frameId,
      sentAtMs: nowMs,
      intents,
    });
    this.maybeReconnectForStaleSnapshot();
  }

  setWorldGeometry(vertices: Float32Array, indices: Uint32Array) {
    this.worldGeometry = { vertices: vertices.slice(), indices: indices.slice() };
    if (!this.worker) return;
    this.postWorldGeometry();
  }

  samplePairs(nowMs: number, interpolationDelayMs: number) {
    const renderTimeMs = nowMs - interpolationDelayMs;
    return this.stateBuffer.sample(renderTimeMs);
  }

  sampleLatestStates() {
    return this.stateBuffer.sampleLatest();
  }

  getDiagnostics(): NpcPhysicsWorkerDiagnostics {
    return {
      reconnectCount: this.reconnectCount,
      workerErrorCount: this.workerErrorCount,
      snapshotReceivedCount: this.snapshotReceivedCount,
      snapshotOutOfOrderCount: this.snapshotOutOfOrderCount,
      snapshotDropGapCount: this.snapshotDropGapCount,
      maxObservedTickGap: this.maxObservedTickGap,
      lastSnapshotTick: this.lastSnapshotTick,
      lastSnapshotReceivedAtMs: this.lastSnapshotReceivedAtMs,
      lastIntentSentAtMs: this.lastIntentSentAtMs,
    };
  }

  private spawnWorker() {
    const worker = new Worker("/src/npc/physics/npc-physics.worker.ts", {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<NpcSnapshotMessage>) => {
      const msg = event.data;
      if (!msg || msg.type !== "npc_snapshot") return;
      const receiveNowMs = performance.now();
      // Worker and main thread may have different `performance.now()` time origins.
      // Align snapshot times to main-thread clock so interpolation samples correctly.
      if (this.workerToMainTimeOffsetMs == null) {
        this.workerToMainTimeOffsetMs = receiveNowMs - msg.simTimeMs;
      }
      this.snapshotReceivedCount += 1;
      this.lastSnapshotReceivedAtMs = receiveNowMs;
      if (this.lastSnapshotTick != null) {
        const tickGap = msg.simTick - this.lastSnapshotTick;
        if (tickGap <= 0) this.snapshotOutOfOrderCount += 1;
        if (tickGap > 1) this.snapshotDropGapCount += 1;
        if (tickGap > this.maxObservedTickGap) this.maxObservedTickGap = tickGap;
      }
      const offset = this.workerToMainTimeOffsetMs;
      const accepted = this.stateBuffer.push({
        ...msg,
        simTimeMs: msg.simTimeMs + offset,
        generatedAtMs: msg.generatedAtMs + offset,
      });
      if (accepted) this.lastSnapshotTick = msg.simTick;
      else this.snapshotOutOfOrderCount += 1;
    };
    worker.onerror = () => {
      this.workerErrorCount += 1;
      this.reconnectWorker();
    };
    worker.onmessageerror = () => {
      this.workerErrorCount += 1;
      this.reconnectWorker();
    };
    this.worker = worker;
    this.post({ type: "npc_worker_init" });
    this.postWorldGeometry();
  }

  private reconnectWorker() {
    if (!this.worker) return;
    try {
      this.worker.terminate();
    } catch {
      // no-op: worker may already be terminated.
    }
    this.worker = null;
    this.stateBuffer.clear();
    this.workerToMainTimeOffsetMs = null;
    this.lastSnapshotTick = null;
    this.lastSnapshotReceivedAtMs = null;
    this.reconnectCount += 1;
    this.spawnWorker();
  }

  private maybeReconnectForStaleSnapshot() {
    if (!this.worker) return;
    if (this.lastIntentSentAtMs == null) return;
    if (this.lastSnapshotReceivedAtMs == null) return;
    if (this.lastIntentSentAtMs - this.lastSnapshotReceivedAtMs <= this.snapshotStaleMs) return;
    this.reconnectWorker();
  }

  private post(msg: NpcWorkerInboundMessage) {
    if (!this.worker) return;
    this.worker.postMessage(msg);
  }

  private postWorldGeometry() {
    if (!this.worker) return;
    if (!this.worldGeometry) return;
    const verts = this.worldGeometry.vertices.slice();
    const inds = this.worldGeometry.indices.slice();
    this.worker.postMessage(
      {
        type: "npc_worker_world_geometry",
        vertices: verts.buffer,
        indices: inds.buffer,
      },
      [verts.buffer, inds.buffer],
    );
  }
}
