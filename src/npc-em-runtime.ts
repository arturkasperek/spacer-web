export {};

import * as THREE from "three";
import type { CharacterInstance } from "./character/human-character.js";
import type { LocomotionMode } from "./npc-locomotion";
import type { WaypointMover } from "./npc-waypoint-mover";
import { __ensureNpcEmQueueState, type NpcEmMessage } from "./npc-em-queue";

export type NpcEmUpdateContext = {
  mover: WaypointMover | null;
  nowMs?: () => number;
  estimateAnimationDurationMs?: (animationName: string) => number | null;
  getNearestWaypointDirectionQuat?: (pos: THREE.Vector3) => THREE.Quaternion | null;
};

type ActiveJob =
  | { type: "move" }
  | { type: "wait"; remainingMs: number }
  | { type: "turn"; targetQuat: THREE.Quaternion; timeoutMs: number }
  | { type: "playAni"; remainingMs: number };

const activeJobs = new Map<number, ActiveJob | null>();

export function __getNpcEmActiveJob(
  npcInstanceIndex: number
):
  | null
  | { type: "move" }
  | { type: "wait"; remainingMs: number }
  | { type: "turn"; timeoutMs: number }
  | { type: "playAni"; remainingMs: number } {
  const j = activeJobs.get(npcInstanceIndex) ?? null;
  if (!j) return null;
  if (j.type === "move") return { type: "move" };
  if (j.type === "wait") return { type: "wait", remainingMs: j.remainingMs };
  if (j.type === "turn") return { type: "turn", timeoutMs: j.timeoutMs };
  return { type: "playAni", remainingMs: j.remainingMs };
}

function isOverlayMessage(msg: NpcEmMessage): boolean {
  // For now we only model non-overlay jobs used by movement/animation.
  // This hook exists to make future overlay messages (look-at, output overlay) easy to add.
  void msg;
  return false;
}

function startMessageAsJob(
  npcId: string,
  npcGroup: THREE.Group,
  msg: NpcEmMessage,
  ctx: NpcEmUpdateContext
): ActiveJob | null {
  const mover = ctx.mover;
  switch (msg.type) {
    case "gotoWaypoint": {
      if (!mover) return null;
      const ok = mover.startMoveToWaypoint(npcId, npcGroup, msg.waypointName, { locomotionMode: msg.locomotionMode });
      if (!ok) return null;
      npcGroup.userData.isScriptControlled = true;
      return { type: "move" };
    }
    case "gotoPosition": {
      if (!mover) return null;
      const ok = mover.startMoveToPosition(npcId, npcGroup, new THREE.Vector3(msg.x, msg.y, msg.z), {
        locomotionMode: msg.locomotionMode,
        finalQuat: msg.finalQuat ? new THREE.Quaternion(msg.finalQuat.x, msg.finalQuat.y, msg.finalQuat.z, msg.finalQuat.w) : undefined,
      });
      if (!ok) return null;
      npcGroup.userData.isScriptControlled = true;
      return { type: "move" };
    }
    case "gotoFreepoint": {
      if (!mover) return null;
      const ok = mover.startMoveToFreepoint(npcId, npcGroup, msg.freepointName, {
        checkDistance: msg.checkDistance,
        dist: msg.dist,
        locomotionMode: msg.locomotionMode,
      });
      if (!ok) return null;
      npcGroup.userData.isScriptControlled = true;
      return { type: "move" };
    }
    case "alignToWaypoint": {
      const q = ctx.getNearestWaypointDirectionQuat?.(npcGroup.position.clone());
      if (!q) return null;
      return { type: "turn", targetQuat: q.clone(), timeoutMs: 1500 };
    }
    case "alignToFreepoint": {
      const st = mover?.getMoveState?.(npcId);
      const q = st?.finalQuat;
      if (!q) return null;
      return { type: "turn", targetQuat: q.clone(), timeoutMs: 1500 };
    }
    case "waitMs":
      return { type: "wait", remainingMs: Math.max(0, msg.durationMs) };
    case "playAni": {
      const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
      if (!instance) return null;
      const name = (msg.animationName || "").trim();
      if (!name) return null;

      const upper = name.toUpperCase();
      const isLoop = Boolean(msg.loop);

      // Heuristic: many Daedalus states use `AI_PlayAni(T_*...)` expecting the engine to settle into a looping
      // `S_*` pose (e.g. `T_STAND_2_LGUARD` -> `S_LGUARD`). The original engine resolves this via MDS `next`.
      // Our character controller needs an explicit `next`, so infer it for common patterns.
      let derivedNext: { animationName: string; loop?: boolean; fallbackNames?: string[] } | undefined;
      if (!isLoop && !msg.next) {
        const idx = upper.indexOf("_2_");
        if (idx >= 0 && idx + 3 < upper.length) {
          const after = upper.slice(idx + 3);
          if (after) derivedNext = { animationName: `S_${after}`, loop: true };
        } else if (upper.startsWith("T_")) {
          const parts = upper.split("_").filter(Boolean);
          const base = parts[1];
          if (base) derivedNext = { animationName: `S_${base}`, loop: true };
        }
      }

      // If this looks like a "leave pose" transition, clear any script-idle override after the ani.
      const clearsIdleOverride = upper.includes("_2_STAND");
      if (clearsIdleOverride) {
        delete (npcGroup.userData as any)._emIdleAnimation;
      } else if (derivedNext?.animationName) {
        (npcGroup.userData as any)._emIdleAnimation = derivedNext.animationName;
      }

      const dur = ctx.estimateAnimationDurationMs?.(name) ?? (isLoop ? 1_000_000 : 1500);
      (npcGroup.userData as any)._emSuppressLocomotion = true;
      instance.setAnimation(name, {
        loop: isLoop,
        resetTime: true,
        fallbackNames: msg.fallbackNames,
        next: msg.next
          ? {
              animationName: msg.next.animationName,
              loop: msg.next.loop ?? true,
              resetTime: true,
              fallbackNames: msg.next.fallbackNames,
            }
          : derivedNext
            ? {
                animationName: derivedNext.animationName,
                loop: derivedNext.loop ?? true,
                resetTime: true,
                fallbackNames: derivedNext.fallbackNames,
              }
            : undefined,
      });
      return { type: "playAni", remainingMs: isLoop ? 1_000_000 : Math.max(0, dur) };
    }
    case "clear": {
      // Clear is handled at a higher level.
      return null;
    }
  }
}

function finishActiveJob(npcInstanceIndex: number, npcGroup: THREE.Group): void {
  const job = activeJobs.get(npcInstanceIndex);
  if (job?.type === "playAni") {
    if (!(npcGroup.userData as any)._emIdleAnimation) {
      delete (npcGroup.userData as any)._emSuppressLocomotion;
    }
  }
  activeJobs.set(npcInstanceIndex, null);
}

export function updateNpcEventManager(
  npcInstanceIndex: number,
  npcId: string,
  npcGroup: THREE.Group,
  deltaSeconds: number,
  ctx: NpcEmUpdateContext
): { moved: boolean; mode: LocomotionMode } {
  const s = __ensureNpcEmQueueState(npcInstanceIndex);
  const mover = ctx.mover;

  if (s.clearRequested) {
    s.clearRequested = false;
    finishActiveJob(npcInstanceIndex, npcGroup);
    mover?.clearForNpc?.(npcId);
    delete (npcGroup.userData as any)._emSuppressLocomotion;
    delete (npcGroup.userData as any)._emIdleAnimation;
  }

  // Run any overlay messages (if we add them in the future) that are ahead of the current job.
  while (s.queue.length > 0 && isOverlayMessage(s.queue[0]!)) {
    s.queue.shift();
  }

  // If there is an active movement in the mover (e.g. routine movement started elsewhere),
  // treat it as the current non-overlay job and don't start new ones.
  const moverState = mover?.getMoveState?.(npcId);
  const moverBusy = Boolean(moverState && !moverState.done);

  let job = activeJobs.get(npcInstanceIndex) ?? null;
  if (!job && moverBusy) {
    const r = mover!.update(npcId, npcGroup, deltaSeconds);
    return { moved: r.moved, mode: r.mode };
  }

  // Start at most one non-overlay message per tick, like zCEventManager.
  if (!job && s.queue.length > 0) {
    // If the head message can't start yet (e.g. mover/model not ready), keep it and retry next tick.
    // For non-critical messages (align/playAni), drop them if they can't start to avoid stalling the queue.
    for (let tries = 0; tries < 4 && !job && s.queue.length > 0; tries++) {
      const next = s.queue[0]!;
      const started = startMessageAsJob(npcId, npcGroup, next, ctx);
      if (started) {
        s.queue.shift();
        job = started;
        activeJobs.set(npcInstanceIndex, job);
        break;
      }

      const shouldKeepMove =
        (next.type === "gotoWaypoint" || next.type === "gotoPosition" || next.type === "gotoFreepoint") && !ctx.mover;
      const shouldKeepPlayAni =
        next.type === "playAni" && !(npcGroup.userData as any).characterInstance;
      const shouldKeep = shouldKeepMove || shouldKeepPlayAni;
      if (shouldKeep) break;

      // Drop unstartable message and try the next one.
      s.queue.shift();
    }
  }

  if (!job) {
    // No active job and no message to start. Still advance any mover state if present.
    if (moverBusy) {
      const r = mover!.update(npcId, npcGroup, deltaSeconds);
      return { moved: r.moved, mode: r.mode };
    }
    return { moved: false, mode: "idle" };
  }

  if (job.type === "move") {
    if (!mover) {
      finishActiveJob(npcInstanceIndex, npcGroup);
      return { moved: false, mode: "idle" };
    }
    const r = mover.update(npcId, npcGroup, deltaSeconds);
    const st = mover.getMoveState?.(npcId);
    if (!st || st.done) {
      finishActiveJob(npcInstanceIndex, npcGroup);
    }
    return { moved: r.moved, mode: r.mode };
  }

  if (job.type === "wait") {
    job.remainingMs -= deltaSeconds * 1000;
    if (job.remainingMs <= 0) finishActiveJob(npcInstanceIndex, npcGroup);
    return { moved: false, mode: "idle" };
  }

  if (job.type === "turn") {
    const TURN_SPEED = 10;
    const t = 1 - Math.exp(-TURN_SPEED * deltaSeconds);
    npcGroup.quaternion.slerp(job.targetQuat, t);
    job.timeoutMs -= deltaSeconds * 1000;
    const dot = Math.abs(npcGroup.quaternion.dot(job.targetQuat));
    if (dot > 0.9995 || job.timeoutMs <= 0) {
      npcGroup.quaternion.copy(job.targetQuat);
      finishActiveJob(npcInstanceIndex, npcGroup);
    }
    return { moved: false, mode: "idle" };
  }

  if (job.type === "playAni") {
    job.remainingMs -= deltaSeconds * 1000;
    if (job.remainingMs <= 0) finishActiveJob(npcInstanceIndex, npcGroup);
    return { moved: false, mode: "idle" };
  }

  finishActiveJob(npcInstanceIndex, npcGroup);
  return { moved: false, mode: "idle" };
}
