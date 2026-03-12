export type NpcPhysicsRapierVec3 = { x: number; y: number; z: number };

export type NpcPhysicsRapierRay = {
  origin: NpcPhysicsRapierVec3;
  dir: NpcPhysicsRapierVec3;
  maxToi: number;
  solid: boolean;
  filterFlags?: number;
  filterGroups?: number;
  excludeColliderId?: number;
};

export type NpcPhysicsRapierRayHit = {
  toi: number;
  point: NpcPhysicsRapierVec3;
  normal: NpcPhysicsRapierVec3 | null;
  colliderId: number | null;
};

export type NpcPhysicsRapierControllerCollision = {
  normal: NpcPhysicsRapierVec3 | null;
};

export type NpcPhysicsRapierComputeMovementArgs = {
  controllerId: number;
  colliderId: number;
  desired: NpcPhysicsRapierVec3;
  filterFlags?: number;
  filterGroups?: number;
};

export type NpcPhysicsRapierComputeMovementResult = {
  movement: NpcPhysicsRapierVec3;
  grounded: boolean;
  collisions: NpcPhysicsRapierControllerCollision[];
};

export type NpcPhysicsRapierCharacterControllerConfig = {
  slideEnabled?: boolean;
  maxSlopeClimbAngle?: number;
  minSlopeSlideAngle?: number;
  autostep?: { maxHeight: number; minWidth: number; includeDynamicBodies: boolean };
  snapToGround?: { enabled: boolean; distance?: number };
  applyImpulsesToDynamicBodies?: boolean;
  characterMass?: number;
};

export type NpcPhysicsRapierCapsuleColliderConfig = {
  halfHeight: number;
  radius: number;
  collisionGroups?: number;
  translation: NpcPhysicsRapierVec3;
};

export interface NpcPhysicsRapierPort {
  getQueryExcludeSensorsFlag(): number;

  createCharacterController(offset: number): number;
  configureCharacterController(
    controllerId: number,
    config: NpcPhysicsRapierCharacterControllerConfig,
  ): void;
  removeCharacterController(controllerId: number): void;

  createCapsuleCollider(config: NpcPhysicsRapierCapsuleColliderConfig): number;
  removeCollider(colliderId: number): void;
  setColliderTranslation(colliderId: number, translation: NpcPhysicsRapierVec3): void;
  getColliderTranslation(colliderId: number): NpcPhysicsRapierVec3 | null;

  computeColliderMovement(
    args: NpcPhysicsRapierComputeMovementArgs,
  ): NpcPhysicsRapierComputeMovementResult;

  castRayAndGetNormal(ray: NpcPhysicsRapierRay): NpcPhysicsRapierRayHit | null;
  intersectionsWithRay(ray: NpcPhysicsRapierRay): NpcPhysicsRapierRayHit[];
}
