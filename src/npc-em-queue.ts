export {};

// A lightweight, per-NPC message queue inspired by Gothic's zCEventManager.
// This module intentionally stays free of Three.js imports so it can be used by the VM bridge layer.

export type NpcEmLocomotion = "walk" | "run";

export type NpcEmQuat = { x: number; y: number; z: number; w: number };

export type NpcEmMessage =
  | {
      type: "gotoFreepoint";
      freepointName: string;
      checkDistance: boolean;
      dist: number;
      locomotionMode: NpcEmLocomotion;
    }
  | {
      type: "gotoWaypoint";
      waypointName: string;
      locomotionMode: NpcEmLocomotion;
    }
  | {
      type: "gotoPosition";
      x: number;
      y: number;
      z: number;
      finalQuat?: NpcEmQuat;
      locomotionMode: NpcEmLocomotion;
    }
  | { type: "alignToWaypoint" }
  | { type: "alignToFreepoint" }
  | { type: "waitMs"; durationMs: number }
  | {
      type: "playAni";
      animationName: string;
      loop?: boolean;
      fallbackNames?: string[];
      next?: { animationName: string; loop?: boolean; fallbackNames?: string[] };
    }
  | { type: "clear" };

type QueueState = {
  queue: NpcEmMessage[];
  clearRequested: boolean;
};

const queues = new Map<number, QueueState>();

function ensureState(npcInstanceIndex: number): QueueState {
  let s = queues.get(npcInstanceIndex);
  if (!s) {
    s = { queue: [], clearRequested: false };
    queues.set(npcInstanceIndex, s);
  }
  return s;
}

export function enqueueNpcEmMessage(npcInstanceIndex: number, msg: NpcEmMessage): void {
  const s = ensureState(npcInstanceIndex);
  if (msg.type === "clear") {
    s.clearRequested = true;
    s.queue.length = 0;
    return;
  }

  // Simple dedupe: avoid stacking identical consecutive commands (common in tight script loops).
  const last = s.queue[s.queue.length - 1];
  if (last && last.type === msg.type) {
    if (msg.type === "gotoWaypoint" && (last as any).waypointName === msg.waypointName) return;
    if (msg.type === "gotoFreepoint" && (last as any).freepointName === msg.freepointName) return;
    if (msg.type === "playAni" && (last as any).animationName === msg.animationName) return;
    if (msg.type === "waitMs" && (last as any).durationMs === msg.durationMs) return;
  }

  s.queue.push(msg);
}

export function requestNpcEmClear(npcInstanceIndex: number): void {
  const s = ensureState(npcInstanceIndex);
  s.clearRequested = true;
  s.queue.length = 0;
}

export function __getNpcEmQueueState(npcInstanceIndex: number): QueueState | undefined {
  return queues.get(npcInstanceIndex);
}

export function __ensureNpcEmQueueState(npcInstanceIndex: number): QueueState {
  return ensureState(npcInstanceIndex);
}

export function clearNpcEmQueueState(npcInstanceIndex: number): void {
  queues.delete(npcInstanceIndex);
}
