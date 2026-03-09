import type {
  NpcIntent,
  NpcSnapshotMessage,
  NpcSnapshotState,
} from "./npc-physics-worker-protocol";

type InternalNpcState = NpcSnapshotState & {
  inputSeq: number;
  desiredX: number;
  desiredZ: number;
  lastIntentAtMs: number;
};

export type NpcWorkerRuntimeOptions = {
  tickMs?: number;
  maxSpeed?: number;
  intentTimeoutMs?: number;
  now?: () => number;
};

const DEFAULT_TICK_MS = 1000 / 60;
const DEFAULT_MAX_SPEED = 220;
const DEFAULT_INTENT_TIMEOUT_MS = 100;

export function createNpcPhysicsWorkerRuntime(options?: NpcWorkerRuntimeOptions) {
  const tickMs = options?.tickMs ?? DEFAULT_TICK_MS;
  const maxSpeed = options?.maxSpeed ?? DEFAULT_MAX_SPEED;
  const intentTimeoutMs = options?.intentTimeoutMs ?? DEFAULT_INTENT_TIMEOUT_MS;
  const nowFn = options?.now ?? (() => performance.now());

  const intents = new Map<string, NpcIntent>();
  const states = new Map<string, InternalNpcState>();
  let simTick = 0;

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
      py: 0,
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
      desiredZ: intent.desiredZ,
      lastIntentAtMs: nowMs,
    };
    states.set(intent.npcId, created);
    return created;
  };

  const stepState = (state: InternalNpcState) => {
    const dx = state.desiredX - state.px;
    const dz = state.desiredZ - state.pz;
    const dist = Math.hypot(dx, dz);
    const maxStep = maxSpeed * (tickMs / 1000);

    if (dist <= 1e-6) {
      state.vx = 0;
      state.vz = 0;
      return;
    }

    const step = Math.min(maxStep, dist);
    const nx = dx / dist;
    const nz = dz / dist;
    state.px += nx * step;
    state.pz += nz * step;
    state.vx = nx * maxSpeed;
    state.vz = nz * maxSpeed;
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
  };

  return {
    applyIntentBatch,
    tick,
    makeSnapshot,
    clear,
    getSimTick: () => simTick,
    getState: (npcId: string) => states.get(npcId),
  } as const;
}
