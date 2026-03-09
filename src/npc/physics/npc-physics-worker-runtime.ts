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
  colliderHandle?: number;
};

export type NpcWorkerRuntimeOptions = {
  tickMs?: number;
  intentTimeoutMs?: number;
  now?: () => number;
};

const DEFAULT_TICK_MS = 1000 / 60;
const DEFAULT_INTENT_TIMEOUT_MS = 100;
const KCC_RADIUS = 20;
const KCC_CAPSULE_HEIGHT = 180;
const KCC_STEP_HEIGHT = 30;
const KCC_OFFSET = 1;
const KCC_SNAP_DISTANCE = 20;
const WORLD_MEMBERSHIP = 0x0001;
const NPC_MEMBERSHIP = 0x0002;
const NPC_FILTER = 0x0001;
const GRAVITY = 1200;
const MAX_FALL_SPEED = 3000;

export function createNpcPhysicsWorkerRuntime(options?: NpcWorkerRuntimeOptions) {
  const tickMs = options?.tickMs ?? DEFAULT_TICK_MS;
  const intentTimeoutMs = options?.intentTimeoutMs ?? DEFAULT_INTENT_TIMEOUT_MS;
  const nowFn = options?.now ?? (() => performance.now());

  const intents = new Map<string, NpcIntent>();
  const states = new Map<string, InternalNpcState>();
  let rapier: any | null = null;
  let rapierInitPromise: Promise<any> | null = null;
  let world: any | null = null;
  let controller: any | null = null;
  let lastGeometrySignature: string | null = null;
  let simTick = 0;

  const ensureRapier = async () => {
    if (rapier) return rapier;
    if (!rapierInitPromise) {
      rapierInitPromise = import("@dimforge/rapier3d-compat").then(async (mod) => {
        const r = (mod as any).default ?? mod;
        if (typeof r.init === "function") await r.init({});
        return r;
      });
    }
    rapier = await rapierInitPromise;
    return rapier;
  };

  const setWorldGeometry = async (verticesBuffer: ArrayBuffer, indicesBuffer: ArrayBuffer) => {
    const r = await ensureRapier();
    const vertices = new Float32Array(verticesBuffer);
    const indices = new Uint32Array(indicesBuffer);
    const geometrySignature = `${vertices.length}:${indices.length}`;
    if (lastGeometrySignature === geometrySignature && world && controller) {
      return;
    }

    if (world && typeof world.free === "function") {
      try {
        world.free();
      } catch {
        // no-op
      }
    }

    world = new r.World({ x: 0, y: 0, z: 0 });
    controller = world.createCharacterController(KCC_OFFSET);
    controller.setSlideEnabled(true);
    controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((45 * Math.PI) / 180);
    controller.enableAutostep(KCC_STEP_HEIGHT, Math.max(1, KCC_RADIUS * 0.5), false);
    if (KCC_SNAP_DISTANCE > 0) controller.enableSnapToGround(KCC_SNAP_DISTANCE);
    controller.setApplyImpulsesToDynamicBodies(false);
    controller.setCharacterMass(1);

    const desc = r.ColliderDesc.trimesh(vertices, indices);
    const WORLD_FILTER = 0xffff;
    desc.setCollisionGroups((WORLD_MEMBERSHIP << 16) | WORLD_FILTER);
    world.createCollider(desc);
    if (typeof world.updateSceneQueries === "function") {
      world.updateSceneQueries();
    }

    lastGeometrySignature = geometrySignature;
    for (const st of states.values()) st.colliderHandle = undefined;
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
    };
    states.set(intent.npcId, created);
    return created;
  };

  const ensureNpcCollider = (state: InternalNpcState) => {
    if (!world || !rapier) return null;
    if (typeof state.colliderHandle === "number") {
      const existing = world.getCollider(state.colliderHandle);
      if (existing) return existing;
      state.colliderHandle = undefined;
    }
    const halfHeight = Math.max(0, KCC_CAPSULE_HEIGHT / 2 - KCC_RADIUS);
    const desc = rapier.ColliderDesc.capsule(halfHeight, KCC_RADIUS);
    desc.setCollisionGroups((NPC_MEMBERSHIP << 16) | NPC_FILTER);
    const collider = world.createCollider(desc);
    collider.setTranslation({
      x: state.px,
      y: state.py + KCC_CAPSULE_HEIGHT / 2,
      z: state.pz,
    });
    state.colliderHandle = collider.handle;
    return collider;
  };

  const stepState = (state: InternalNpcState) => {
    const dt = Math.max(1e-6, tickMs / 1000);
    if (!world || !rapier || !controller) {
      const dx = state.desiredX - state.px;
      const dz = state.desiredZ - state.pz;
      if (Math.abs(dx) <= 1e-6 && Math.abs(dz) <= 1e-6) {
        state.vx = 0;
        state.vz = 0;
        return;
      }
      state.vx = dx / dt;
      state.vz = dz / dt;
      state.px = state.desiredX;
      state.pz = state.desiredZ;
      state.py = state.desiredY;
      state.grounded = true;
      state.falling = false;
      state.sliding = false;
      state.vy = 0;
      return;
    }

    const collider = ensureNpcCollider(state);
    if (!collider) return;
    if (typeof world.updateSceneQueries === "function") {
      world.updateSceneQueries();
    }

    let desiredDy = 0;
    if (state.grounded) {
      // Keep tiny down force so snap-to-ground remains reliable.
      desiredDy -= 2;
      state.vy = 0;
    } else {
      state.vy = Math.max(-MAX_FALL_SPEED, state.vy - GRAVITY * dt);
      desiredDy += state.vy * dt;
    }

    const dx = state.desiredX - state.px;
    const dz = state.desiredZ - state.pz;
    const desired = {
      x: Math.abs(dx) < 0.25 ? 0 : dx,
      y: desiredDy,
      z: Math.abs(dz) < 0.25 ? 0 : dz,
    };
    controller.computeColliderMovement(
      collider,
      desired,
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      collider,
    );
    const move = controller.computedMovement();
    const cur = collider.translation();
    const next = {
      x: cur.x + move.x,
      y: cur.y + move.y,
      z: cur.z + move.z,
    };
    collider.setTranslation(next);
    if (typeof world.updateSceneQueries === "function") {
      world.updateSceneQueries();
    }

    const px = next.x;
    const py = next.y - KCC_CAPSULE_HEIGHT / 2;
    const pz = next.z;
    state.vx = (px - state.px) / dt;
    state.vy = (py - state.py) / dt;
    state.vz = (pz - state.pz) / dt;
    state.px = px;
    state.py = py;
    state.pz = pz;
    state.grounded = Boolean(controller.computedGrounded?.());
    state.falling = !state.grounded && state.vy < -1;
    state.sliding = false;
    if (state.grounded) state.vy = 0;
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
    if (world && typeof world.free === "function") {
      try {
        world.free();
      } catch {
        // no-op
      }
    }
    world = null;
    controller = null;
  };

  return {
    applyIntentBatch,
    tick,
    setWorldGeometry,
    makeSnapshot,
    clear,
    getSimTick: () => simTick,
    getState: (npcId: string) => states.get(npcId),
  } as const;
}
