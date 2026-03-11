import type {
  NpcIntent,
  NpcSnapshotMessage,
  NpcSnapshotState,
} from "./npc-physics-worker-protocol";
import {
  stepNpcPhysicsCore,
  type NpcPhysicsCoreConfig,
  type NpcPhysicsCoreState,
} from "./npc-physics-core";
import { NpcPhysicsWorkerAdapter } from "./npc-physics-worker-adapter";

type InternalNpcState = NpcPhysicsCoreState &
  Pick<NpcSnapshotState, "npcId" | "qx" | "qy" | "qz" | "qw"> & {
    inputSeq: number;
    lastIntentAtMs: number;
  };

export type NpcWorkerRuntimeOptions = {
  tickMs?: number;
  intentTimeoutMs?: number;
  now?: () => number;
};

const DEFAULT_TICK_MS = 1000 / 60;
const DEFAULT_INTENT_TIMEOUT_MS = 100;
const CORE_CONFIG: NpcPhysicsCoreConfig = {
  gravity: 1200,
  maxFallSpeed: 3000,
  moveDeadZone: 0.25,
  maxSlopeClimbAngle: (48 * Math.PI) / 180,
  slideToFallAngle: (67 * Math.PI) / 180,
  fallGraceSeconds: 0.08,
  landGraceSeconds: 0.02,
  slideExitGraceSeconds: 0.1,
  slideToFallGraceSeconds: 0.08,
  fallVyThreshold: -20,
};

export function createNpcPhysicsWorkerRuntime(options?: NpcWorkerRuntimeOptions) {
  const tickMs = options?.tickMs ?? DEFAULT_TICK_MS;
  const intentTimeoutMs = options?.intentTimeoutMs ?? DEFAULT_INTENT_TIMEOUT_MS;
  const nowFn = options?.now ?? (() => performance.now());
  const physicsAdapter = new NpcPhysicsWorkerAdapter();

  const intents = new Map<string, NpcIntent>();
  const states = new Map<string, InternalNpcState>();
  let simTick = 0;

  const setWorldGeometry = async (verticesBuffer: ArrayBuffer, indicesBuffer: ArrayBuffer) => {
    await physicsAdapter.setWorldGeometry(verticesBuffer, indicesBuffer);
  };

  const ensureState = (intent: NpcIntent, nowMs: number): InternalNpcState => {
    const existing = states.get(intent.npcId);
    if (existing) {
      existing.inputSeq = intent.inputSeq;
      existing.desiredX = intent.desiredX;
      existing.desiredZ = intent.desiredZ;
      existing.jumpActive = intent.jumpRequested;
      existing.lastIntentAtMs = nowMs;
      return existing;
    }

    const created: InternalNpcState = {
      npcId: intent.npcId,
      px: intent.desiredX,
      py: intent.desiredY,
      pz: intent.desiredZ,
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
      jumpActive: intent.jumpRequested,
      inputSeq: intent.inputSeq,
      desiredX: intent.desiredX,
      desiredY: intent.desiredY,
      desiredZ: intent.desiredZ,
      lastIntentAtMs: nowMs,
      groundedFor: 0,
      ungroundedFor: 0,
      slideExitFor: 0,
      slideToFallFor: 0,
    };
    states.set(intent.npcId, created);
    return created;
  };

  const stepState = (state: InternalNpcState) => {
    const dt = Math.max(1e-6, tickMs / 1000);
    const movementSolver = physicsAdapter.isReady()
      ? (input: Parameters<typeof physicsAdapter.stepNpc>[1]) =>
          physicsAdapter.stepNpc(state.npcId, input)
      : undefined;
    const next = stepNpcPhysicsCore(state, dt, CORE_CONFIG, movementSolver);
    Object.assign(state, next);
  };

  const applyIntentBatch = (batchIntents: NpcIntent[], nowMs: number) => {
    for (const intent of batchIntents) {
      intents.set(intent.npcId, intent);
      ensureState(intent, nowMs);
    }
  };

  const tick = (nowMs = nowFn()) => {
    for (const intent of intents.values()) {
      const st = ensureState(intent, nowMs);
      const stale = nowMs - st.lastIntentAtMs > intentTimeoutMs;
      if (stale) {
        st.desiredX = st.px;
        st.desiredZ = st.pz;
        st.vx = 0;
        st.vz = 0;
      }
      stepState(st);
    }
    simTick += 1;
  };

  const makeSnapshot = (nowMs = nowFn()): NpcSnapshotMessage => ({
    type: "npc_snapshot",
    simTick,
    simTimeMs: nowMs,
    generatedAtMs: nowMs,
    states: Array.from(states.values()).map((s) => ({
      npcId: s.npcId,
      px: s.px,
      py: s.py,
      pz: s.pz,
      qx: s.qx,
      qy: s.qy,
      qz: s.qz,
      qw: s.qw,
      vx: s.vx,
      vy: s.vy,
      vz: s.vz,
      grounded: s.grounded,
      falling: s.falling,
      sliding: s.sliding,
      jumpActive: s.jumpActive,
    })),
  });

  const clear = () => {
    intents.clear();
    states.clear();
    physicsAdapter.clear();
  };

  const removeNpcs = (npcIds: string[]) => {
    for (const npcId of npcIds) {
      intents.delete(npcId);
      states.delete(npcId);
      physicsAdapter.removeNpc(npcId);
    }
  };

  return {
    applyIntentBatch,
    removeNpcs,
    tick,
    setWorldGeometry,
    makeSnapshot,
    clear,
    getSimTick: () => simTick,
    getState: (npcId: string) => states.get(npcId),
  } as const;
}
