/// <reference lib="webworker" />

import type { NpcSnapshotMessage, NpcWorkerInboundMessage } from "./npc-physics-worker-protocol";
import { createNpcPhysicsWorkerRuntime } from "./npc-physics-worker-runtime";

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;
const runtime = createNpcPhysicsWorkerRuntime();
let isRunning = false;

const publishSnapshot = (nowMs?: number) => {
  const msg: NpcSnapshotMessage = runtime.makeSnapshot(nowMs);
  ctx.postMessage(msg);
};

ctx.onmessage = (event: MessageEvent<NpcWorkerInboundMessage>) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "npc_worker_init") {
    isRunning = true;
    return;
  }

  if (msg.type === "npc_worker_stop") {
    isRunning = false;
    runtime.clear();
    return;
  }

  if (msg.type === "npc_worker_world_geometry") {
    runtime.setWorldGeometry(msg.vertices, msg.indices).catch(() => {
      // Keep worker alive and continue with fallback bridge movement.
    });
    return;
  }

  if (msg.type === "npc_worker_remove") {
    runtime.removeNpcs(msg.npcIds);
    return;
  }

  if (msg.type === "npc_intent_batch") {
    if (!isRunning) return;
    runtime.applyIntentBatch(msg.intents, msg.sentAtMs);
    runtime.tick(msg.sentAtMs);
    publishSnapshot(msg.sentAtMs);
  }
};

export {};
