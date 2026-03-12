import type {
  NpcPhysicsRapierCapsuleColliderConfig,
  NpcPhysicsRapierCharacterControllerConfig,
  NpcPhysicsRapierComputeMovementArgs,
  NpcPhysicsRapierComputeMovementResult,
  NpcPhysicsRapierPort,
  NpcPhysicsRapierRay,
  NpcPhysicsRapierRayHit,
  NpcPhysicsRapierVec3,
} from "./npc-physics-rapier-port";

const DEFAULT_ZERO: NpcPhysicsRapierVec3 = { x: 0, y: 0, z: 0 };

export class NpcPhysicsRapierMainThreadPort implements NpcPhysicsRapierPort {
  private readonly rapierWorld: any;
  private readonly rapier: any;
  private nextControllerId = 1;
  private nextFallbackColliderId = 1;
  private readonly controllers = new Map<number, any>();
  private readonly colliders = new Map<number, any>();
  private readonly colliderHandleToId = new Map<number, number>();

  constructor(rapierWorld: unknown, rapier: unknown) {
    this.rapierWorld = rapierWorld;
    this.rapier = rapier;
  }

  getQueryExcludeSensorsFlag(): number {
    return this.rapier.QueryFilterFlags.EXCLUDE_SENSORS;
  }

  createCharacterController(offset: number): number {
    const controller = this.rapierWorld.createCharacterController(offset);
    const id = this.nextControllerId++;
    this.controllers.set(id, controller);
    return id;
  }

  configureCharacterController(
    controllerId: number,
    config: NpcPhysicsRapierCharacterControllerConfig,
  ): void {
    const controller = this.getController(controllerId);
    if (config.slideEnabled != null) controller.setSlideEnabled(config.slideEnabled);
    if (config.maxSlopeClimbAngle != null)
      controller.setMaxSlopeClimbAngle(config.maxSlopeClimbAngle);
    if (config.minSlopeSlideAngle != null)
      controller.setMinSlopeSlideAngle(config.minSlopeSlideAngle);
    if (config.autostep)
      controller.enableAutostep(
        config.autostep.maxHeight,
        config.autostep.minWidth,
        config.autostep.includeDynamicBodies,
      );
    if (config.snapToGround?.enabled && config.snapToGround.distance != null)
      controller.enableSnapToGround(config.snapToGround.distance);
    if (
      config.snapToGround &&
      !config.snapToGround.enabled &&
      typeof controller.disableSnapToGround === "function"
    ) {
      controller.disableSnapToGround();
    }
    if (config.applyImpulsesToDynamicBodies != null)
      controller.setApplyImpulsesToDynamicBodies(config.applyImpulsesToDynamicBodies);
    if (config.characterMass != null) controller.setCharacterMass(config.characterMass);
  }

  removeCharacterController(controllerId: number): void {
    const controller = this.controllers.get(controllerId);
    if (!controller) return;
    try {
      this.rapierWorld.removeCharacterController(controller);
    } catch {
      // Best-effort cleanup.
    }
    this.controllers.delete(controllerId);
  }

  createCapsuleCollider(config: NpcPhysicsRapierCapsuleColliderConfig): number {
    const desc = this.rapier.ColliderDesc.capsule(config.halfHeight, config.radius);
    if (config.collisionGroups != null) desc.setCollisionGroups(config.collisionGroups);

    const collider = this.rapierWorld.createCollider(desc);
    collider.setTranslation(config.translation);

    const id =
      typeof collider?.handle === "number"
        ? collider.handle
        : 0x7fffffff - this.nextFallbackColliderId++;
    this.colliders.set(id, collider);
    if (typeof collider?.handle === "number") {
      this.colliderHandleToId.set(collider.handle, id);
      if (!this.colliders.has(collider.handle)) this.colliders.set(collider.handle, collider);
    }
    return id;
  }

  removeCollider(colliderId: number): void {
    const collider = this.colliders.get(colliderId) ?? this.rapierWorld.getCollider?.(colliderId);
    if (!collider) return;
    try {
      this.rapierWorld.removeCollider(collider, true);
    } catch {
      // Best-effort cleanup.
    }
    if (typeof collider?.handle === "number") this.colliderHandleToId.delete(collider.handle);
    this.colliders.delete(colliderId);
  }

  setColliderTranslation(colliderId: number, translation: NpcPhysicsRapierVec3): void {
    const collider = this.getCollider(colliderId);
    collider.setTranslation(translation);
  }

  getColliderTranslation(colliderId: number): NpcPhysicsRapierVec3 | null {
    const collider = this.colliders.get(colliderId) ?? this.rapierWorld.getCollider?.(colliderId);
    if (!collider) return null;
    const t = collider.translation?.();
    if (!t) return null;
    return { x: t.x, y: t.y, z: t.z };
  }

  computeColliderMovement(
    args: NpcPhysicsRapierComputeMovementArgs,
  ): NpcPhysicsRapierComputeMovementResult {
    const controller = this.getController(args.controllerId);
    const collider = this.getCollider(args.colliderId);

    controller.computeColliderMovement(collider, args.desired, args.filterFlags, args.filterGroups);

    const movementRaw = controller.computedMovement?.() ?? DEFAULT_ZERO;
    const grounded = Boolean(controller.computedGrounded?.() ?? false);

    const count = controller.numComputedCollisions?.() ?? 0;
    const collisions = new Array(count).fill(null).map((_, i) => {
      const c = controller.computedCollision?.(i);
      const n = c?.normal1 ?? c?.normal ?? null;
      return {
        normal: n ? { x: n.x, y: n.y, z: n.z } : null,
      };
    });

    return {
      movement: { x: movementRaw.x ?? 0, y: movementRaw.y ?? 0, z: movementRaw.z ?? 0 },
      grounded,
      collisions,
    };
  }

  castRayAndGetNormal(ray: NpcPhysicsRapierRay): NpcPhysicsRapierRayHit | null {
    const rapierRay = new this.rapier.Ray(ray.origin, ray.dir);
    const excluded =
      ray.excludeColliderId != null
        ? (this.colliders.get(ray.excludeColliderId) ??
          this.rapierWorld.getCollider?.(ray.excludeColliderId))
        : null;
    const hit = this.rapierWorld.castRayAndGetNormal(
      rapierRay,
      ray.maxToi,
      ray.solid,
      ray.filterFlags,
      ray.filterGroups,
      excluded,
    );
    if (!hit) return null;

    const p = rapierRay.pointAt(hit.timeOfImpact);
    const handle = hit.collider?.handle;
    const colliderId =
      typeof handle === "number" ? (this.colliderHandleToId.get(handle) ?? null) : null;
    return {
      toi: hit.timeOfImpact,
      point: { x: p.x, y: p.y, z: p.z },
      normal: hit.normal ? { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z } : null,
      colliderId,
    };
  }

  intersectionsWithRay(ray: NpcPhysicsRapierRay): NpcPhysicsRapierRayHit[] {
    const rapierRay = new this.rapier.Ray(ray.origin, ray.dir);
    const excluded =
      ray.excludeColliderId != null
        ? (this.colliders.get(ray.excludeColliderId) ??
          this.rapierWorld.getCollider?.(ray.excludeColliderId))
        : null;
    const hits: NpcPhysicsRapierRayHit[] = [];

    this.rapierWorld.intersectionsWithRay(
      rapierRay,
      ray.maxToi,
      ray.solid,
      (hit: any) => {
        const p = rapierRay.pointAt(hit.timeOfImpact);
        const handle = hit.collider?.handle;
        const colliderId =
          typeof handle === "number" ? (this.colliderHandleToId.get(handle) ?? null) : null;
        hits.push({
          toi: hit.timeOfImpact,
          point: { x: p.x, y: p.y, z: p.z },
          normal: hit.normal ? { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z } : null,
          colliderId,
        });
        return true;
      },
      ray.filterFlags,
      ray.filterGroups,
      excluded,
    );

    return hits;
  }

  private getController(controllerId: number): any {
    const controller = this.controllers.get(controllerId);
    if (!controller) throw new Error(`Rapier controller not found: ${controllerId}`);
    return controller;
  }

  private getCollider(colliderId: number): any {
    const collider = this.colliders.get(colliderId) ?? this.rapierWorld.getCollider?.(colliderId);
    if (!collider) throw new Error(`Rapier collider not found: ${colliderId}`);
    return collider;
  }
}

export function createNpcPhysicsRapierMainThreadPort(
  rapierWorld: unknown,
  rapier: unknown,
): NpcPhysicsRapierMainThreadPort {
  return new NpcPhysicsRapierMainThreadPort(rapierWorld, rapier);
}
