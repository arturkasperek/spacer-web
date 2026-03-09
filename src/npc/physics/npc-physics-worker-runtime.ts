import type {
  NpcIntent,
  NpcSnapshotMessage,
  NpcSnapshotState,
} from "./npc-physics-worker-protocol";

type InternalNpcState = NpcSnapshotState & {
  inputSeq: number;
  desiredX: number;
  desiredY: number;
  desiredZ: number;
  lastIntentAtMs: number;
};

export type NpcWorkerRuntimeOptions = {
  tickMs?: number;
  intentTimeoutMs?: number;
  now?: () => number;
};

const DEFAULT_TICK_MS = 1000 / 60;
const DEFAULT_INTENT_TIMEOUT_MS = 100;

export function createNpcPhysicsWorkerRuntime(options?: NpcWorkerRuntimeOptions) {
  const tickMs = options?.tickMs ?? DEFAULT_TICK_MS;
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
      existing.desiredY = intent.desiredY;
      existing.desiredZ = intent.desiredZ;
      existing.jumpActive = intent.jumpRequested;
      existing.lastIntentAtMs = nowMs;
      existing.py = intent.desiredY;
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
    };
    states.set(intent.npcId, created);
    return created;
  };

  const stepState = (state: InternalNpcState) => {
    const dx = state.desiredX - state.px;
    const dz = state.desiredZ - state.pz;
    const dt = Math.max(1e-6, tickMs / 1000);
    if (Math.abs(dx) <= 1e-6 && Math.abs(dz) <= 1e-6) {
      state.vx = 0;
      state.vz = 0;
      return;
    }

    // In phase-2 bridge mode, intents already encode per-frame desired translation.
    // Do not apply another speed limiter here, otherwise movement becomes artificially slow.
    state.vx = dx / dt;
    state.vz = dz / dt;
    state.px = state.desiredX;
    state.pz = state.desiredZ;
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
        st.desiredY = st.py;
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
