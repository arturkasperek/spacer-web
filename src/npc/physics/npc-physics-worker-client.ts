import {
  type NpcIntent,
  type NpcSnapshotMessage,
  type NpcWorkerInboundMessage,
} from "./npc-physics-worker-protocol";
import { createNpcStateBuffer } from "./npc-physics-state-buffer";

export class NpcPhysicsWorkerClient {
  private worker: Worker | null = null;
  private readonly stateBuffer = createNpcStateBuffer(128);
  private workerToMainTimeOffsetMs: number | null = null;

  start() {
    if (this.worker || typeof Worker === "undefined") return;
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
      const offset = this.workerToMainTimeOffsetMs;
      this.stateBuffer.push({
        ...msg,
        simTimeMs: msg.simTimeMs + offset,
        generatedAtMs: msg.generatedAtMs + offset,
      });
    };
    this.worker = worker;
    this.post({ type: "npc_worker_init" });
  }

  stop() {
    if (!this.worker) return;
    this.post({ type: "npc_worker_stop" });
    this.worker.terminate();
    this.worker = null;
    this.stateBuffer.clear();
    this.workerToMainTimeOffsetMs = null;
  }

  pushIntents(frameId: number, intents: NpcIntent[]) {
    if (!this.worker) return;
    this.post({
      type: "npc_intent_batch",
      frameId,
      sentAtMs: performance.now(),
      intents,
    });
  }

  samplePairs(nowMs: number, interpolationDelayMs: number) {
    const renderTimeMs = nowMs - interpolationDelayMs;
    return this.stateBuffer.sample(renderTimeMs);
  }

  sampleLatestStates() {
    return this.stateBuffer.sampleLatest();
  }

  private post(msg: NpcWorkerInboundMessage) {
    if (!this.worker) return;
    this.worker.postMessage(msg);
  }
}
