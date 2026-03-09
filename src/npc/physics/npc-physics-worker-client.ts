import {
  type NpcIntent,
  type NpcSnapshotMessage,
  type NpcWorkerInboundMessage,
} from "./npc-physics-worker-protocol";
import { createNpcStateBuffer } from "./npc-physics-state-buffer";

export class NpcPhysicsWorkerClient {
  private worker: Worker | null = null;
  private readonly stateBuffer = createNpcStateBuffer(128);

  start() {
    if (this.worker || typeof Worker === "undefined") return;
    const worker = new Worker("/src/npc/physics/npc-physics.worker.ts", {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<NpcSnapshotMessage>) => {
      const msg = event.data;
      if (!msg || msg.type !== "npc_snapshot") return;
      this.stateBuffer.push(msg);
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

  private post(msg: NpcWorkerInboundMessage) {
    if (!this.worker) return;
    this.worker.postMessage(msg);
  }
}
