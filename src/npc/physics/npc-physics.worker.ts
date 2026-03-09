/// <reference lib="webworker" />

import type { NpcSnapshotMessage, NpcWorkerInboundMessage } from "./npc-physics-worker-protocol";
import { createNpcPhysicsWorkerRuntime } from "./npc-physics-worker-runtime";

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;
let timerId: number | null = null;
const runtime = createNpcPhysicsWorkerRuntime();
const TICK_MS = 1000 / 60;

const tick = () => {
  runtime.tick();
  const msg: NpcSnapshotMessage = runtime.makeSnapshot();
  ctx.postMessage(msg);
};

const startLoop = () => {
  if (timerId != null) return;
  timerId = ctx.setInterval(tick, TICK_MS);
};

const stopLoop = () => {
  if (timerId == null) return;
  ctx.clearInterval(timerId);
  timerId = null;
};

ctx.onmessage = (event: MessageEvent<NpcWorkerInboundMessage>) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "npc_worker_init") {
    startLoop();
    return;
  }

  if (msg.type === "npc_worker_stop") {
    stopLoop();
    runtime.clear();
    return;
  }

  if (msg.type === "npc_intent_batch") {
    runtime.applyIntentBatch(msg.intents, msg.sentAtMs);
  }
};

export {};
