import type { NpcPhysicsCoreMoveInput, NpcPhysicsCoreMoveOutput } from "./npc-physics-core";

export type NpcPhysicsWorkerAdapterConfig = {
  radius: number;
  capsuleHeight: number;
  stepHeight: number;
  offset: number;
  snapDistance: number;
  worldMembership: number;
  npcMembership: number;
  npcFilter: number;
};

const DEFAULT_CONFIG: NpcPhysicsWorkerAdapterConfig = {
  radius: 20,
  capsuleHeight: 180,
  stepHeight: 30,
  offset: 1,
  snapDistance: 20,
  worldMembership: 0x0001,
  npcMembership: 0x0002,
  npcFilter: 0x0001,
};

export class NpcPhysicsWorkerAdapter {
  private readonly config: NpcPhysicsWorkerAdapterConfig;
  private rapier: any | null = null;
  private rapierInitPromise: Promise<any> | null = null;
  private world: any | null = null;
  private controller: any | null = null;
  private lastGeometrySignature: string | null = null;
  private readonly colliderHandleByNpcId = new Map<string, number>();

  constructor(config?: Partial<NpcPhysicsWorkerAdapterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  }

  async setWorldGeometry(verticesBuffer: ArrayBuffer, indicesBuffer: ArrayBuffer) {
    const rapier = await this.ensureRapier();
    const vertices = new Float32Array(verticesBuffer);
    const indices = new Uint32Array(indicesBuffer);
    const geometrySignature = `${vertices.length}:${indices.length}`;
    if (this.lastGeometrySignature === geometrySignature && this.world && this.controller) {
      return;
    }

    this.freeWorld();

    this.world = new rapier.World({ x: 0, y: 0, z: 0 });
    this.controller = this.world.createCharacterController(this.config.offset);
    this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((45 * Math.PI) / 180);
    this.controller.enableAutostep(
      this.config.stepHeight,
      Math.max(1, this.config.radius * 0.5),
      false,
    );
    if (this.config.snapDistance > 0) this.controller.enableSnapToGround(this.config.snapDistance);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.setCharacterMass(1);

    const worldFilter = 0xffff;
    const desc = rapier.ColliderDesc.trimesh(vertices, indices);
    desc.setCollisionGroups((this.config.worldMembership << 16) | worldFilter);
    this.world.createCollider(desc);
    if (typeof this.world.updateSceneQueries === "function") {
      this.world.updateSceneQueries();
    }

    this.lastGeometrySignature = geometrySignature;
    this.colliderHandleByNpcId.clear();
  }

  stepNpc(npcId: string, input: NpcPhysicsCoreMoveInput): NpcPhysicsCoreMoveOutput | null {
    const collider = this.ensureNpcCollider(npcId, input.px, input.py, input.pz);
    if (!collider || !this.world || !this.controller || !this.rapier) return null;

    if (typeof this.world.updateSceneQueries === "function") {
      this.world.updateSceneQueries();
    }

    this.controller.computeColliderMovement(
      collider,
      { x: input.dx, y: input.dy, z: input.dz },
      this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      collider,
    );
    const move = this.controller.computedMovement();
    const cur = collider.translation();
    const next = {
      x: cur.x + move.x,
      y: cur.y + move.y,
      z: cur.z + move.z,
    };
    collider.setTranslation(next);

    if (typeof this.world.updateSceneQueries === "function") {
      this.world.updateSceneQueries();
    }

    const groundNy = this.computeBestGroundNy();
    const rawGrounded = Boolean(this.controller.computedGrounded?.());

    return {
      px: next.x,
      py: next.y - this.config.capsuleHeight / 2,
      pz: next.z,
      grounded: rawGrounded,
      groundedRaw: rawGrounded,
      groundNy,
    };
  }

  isReady() {
    return Boolean(this.rapier && this.world && this.controller);
  }

  removeNpc(npcId: string) {
    if (!this.world) return;
    const handle = this.colliderHandleByNpcId.get(npcId);
    if (typeof handle !== "number") return;
    this.colliderHandleByNpcId.delete(npcId);
    try {
      const collider = this.world.getCollider(handle);
      if (collider) this.world.removeCollider(collider, true);
    } catch {
      // no-op
    }
  }

  clear() {
    this.freeWorld();
    this.lastGeometrySignature = null;
  }

  private async ensureRapier() {
    if (this.rapier) return this.rapier;
    if (!this.rapierInitPromise) {
      this.rapierInitPromise = import("@dimforge/rapier3d-compat").then(async (mod) => {
        const rapier = (mod as any).default ?? mod;
        if (typeof rapier.init === "function") await rapier.init({});
        return rapier;
      });
    }
    this.rapier = await this.rapierInitPromise;
    return this.rapier;
  }

  private ensureNpcCollider(npcId: string, px: number, py: number, pz: number) {
    if (!this.world || !this.rapier) return null;
    const existingHandle = this.colliderHandleByNpcId.get(npcId);
    if (typeof existingHandle === "number") {
      const existingCollider = this.world.getCollider(existingHandle);
      if (existingCollider) return existingCollider;
      this.colliderHandleByNpcId.delete(npcId);
    }

    const halfHeight = Math.max(0, this.config.capsuleHeight / 2 - this.config.radius);
    const desc = this.rapier.ColliderDesc.capsule(halfHeight, this.config.radius);
    desc.setCollisionGroups((this.config.npcMembership << 16) | this.config.npcFilter);
    const collider = this.world.createCollider(desc);
    collider.setTranslation({
      x: px,
      y: py + this.config.capsuleHeight / 2,
      z: pz,
    });
    this.colliderHandleByNpcId.set(npcId, collider.handle);
    return collider;
  }

  private freeWorld() {
    this.colliderHandleByNpcId.clear();
    if (this.world && typeof this.world.free === "function") {
      try {
        this.world.free();
      } catch {
        // no-op
      }
    }
    this.world = null;
    this.controller = null;
  }

  private computeBestGroundNy(): number | null {
    if (!this.controller) return null;
    const minGroundNy = 0.06;
    const collisions = this.controller.numComputedCollisions?.() ?? 0;
    let bestNy: number | null = null;
    for (let i = 0; i < collisions; i += 1) {
      const c = this.controller.computedCollision?.(i);
      const ny = c?.normal1?.y;
      if (typeof ny !== "number" || !Number.isFinite(ny)) continue;
      if (!(ny > minGroundNy)) continue;
      if (bestNy == null || ny > bestNy) bestNy = ny;
    }
    return bestNy;
  }
}
