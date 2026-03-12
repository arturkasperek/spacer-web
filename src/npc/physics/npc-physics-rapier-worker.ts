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

export type NpcPhysicsRapierWorkerRequest =
  | {
      type: "computeColliderMovement";
      args: NpcPhysicsRapierComputeMovementArgs;
    }
  | {
      type: "castRayAndGetNormal";
      ray: NpcPhysicsRapierRay;
    }
  | {
      type: "intersectionsWithRay";
      ray: NpcPhysicsRapierRay;
    };

export type NpcPhysicsRapierWorkerResponse =
  | {
      type: "computeColliderMovement";
      result: NpcPhysicsRapierComputeMovementResult;
    }
  | {
      type: "castRayAndGetNormal";
      result: NpcPhysicsRapierRayHit | null;
    }
  | {
      type: "intersectionsWithRay";
      result: NpcPhysicsRapierRayHit[];
    }
  | {
      type: "error";
      error: string;
    };

// Transitional adapter: keeps the call sites synchronous for now.
// In the next step this class can move to an async request/response transport over Worker.
export class NpcPhysicsRapierWorkerPort implements NpcPhysicsRapierPort {
  private readonly fallback: NpcPhysicsRapierPort;
  readonly worker: Worker;

  constructor(worker: Worker, fallback: NpcPhysicsRapierPort) {
    this.worker = worker;
    this.fallback = fallback;
  }

  isWorkerBound(): boolean {
    return typeof this.worker.postMessage === "function";
  }

  createCharacterController(offset: number): number {
    return this.fallback.createCharacterController(offset);
  }

  configureCharacterController(
    controllerId: number,
    config: NpcPhysicsRapierCharacterControllerConfig,
  ): void {
    this.fallback.configureCharacterController(controllerId, config);
  }

  removeCharacterController(controllerId: number): void {
    this.fallback.removeCharacterController(controllerId);
  }

  createCapsuleCollider(config: NpcPhysicsRapierCapsuleColliderConfig): number {
    return this.fallback.createCapsuleCollider(config);
  }

  removeCollider(colliderId: number): void {
    this.fallback.removeCollider(colliderId);
  }

  setColliderTranslation(colliderId: number, translation: NpcPhysicsRapierVec3): void {
    this.fallback.setColliderTranslation(colliderId, translation);
  }

  getColliderTranslation(colliderId: number): NpcPhysicsRapierVec3 | null {
    return this.fallback.getColliderTranslation(colliderId);
  }

  computeColliderMovement(
    args: NpcPhysicsRapierComputeMovementArgs,
  ): NpcPhysicsRapierComputeMovementResult {
    return this.fallback.computeColliderMovement(args);
  }

  castRayAndGetNormal(ray: NpcPhysicsRapierRay): NpcPhysicsRapierRayHit | null {
    return this.fallback.castRayAndGetNormal(ray);
  }

  intersectionsWithRay(ray: NpcPhysicsRapierRay): NpcPhysicsRapierRayHit[] {
    return this.fallback.intersectionsWithRay(ray);
  }
}

export function createNpcPhysicsRapierWorkerPort(
  worker: Worker,
  fallback: NpcPhysicsRapierPort,
): NpcPhysicsRapierWorkerPort {
  return new NpcPhysicsRapierWorkerPort(worker, fallback);
}
