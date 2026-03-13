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

export type NpcPhysicsRapierFrameSnapshotOptions = {
  simulatedFrameDelay?: number;
};

type SnapshotOpKind = "compute" | "castRay" | "intersections";

type SnapshotOp =
  | { kind: "compute"; value: NpcPhysicsRapierComputeMovementResult }
  | { kind: "castRay"; value: NpcPhysicsRapierRayHit | null }
  | { kind: "intersections"; value: NpcPhysicsRapierRayHit[] };

type SnapshotFrameOps = Map<string, SnapshotOp>;

function cloneSnapshotValue<T>(value: T): T {
  if (value == null) return value;
  const maybeStructuredClone = (globalThis as any).structuredClone as
    | ((input: unknown) => unknown)
    | undefined;
  if (typeof maybeStructuredClone === "function") {
    return maybeStructuredClone(value) as T;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export class NpcPhysicsRapierFrameSnapshotPort implements NpcPhysicsRapierPort {
  private readonly inner: NpcPhysicsRapierPort;
  private readonly simulatedFrameDelay: number;
  private readonly frameOps = new Map<number, SnapshotFrameOps>();
  private activeFrameId: number | null = null;

  constructor(inner: NpcPhysicsRapierPort, options?: NpcPhysicsRapierFrameSnapshotOptions) {
    this.inner = inner;
    const rawDelay = Number(options?.simulatedFrameDelay ?? 0);
    this.simulatedFrameDelay = Number.isFinite(rawDelay) && rawDelay > 0 ? Math.floor(rawDelay) : 0;
  }

  beginFrame(frameId: number): void {
    if (!Number.isFinite(frameId)) return;
    if (this.activeFrameId === frameId) return;
    this.activeFrameId = frameId;
    if (!this.frameOps.has(frameId)) this.frameOps.set(frameId, new Map());
    if (this.simulatedFrameDelay <= 0) return;
    const minKeepFrame = frameId - this.simulatedFrameDelay - 2;
    for (const k of this.frameOps.keys()) {
      if (k < minKeepFrame) this.frameOps.delete(k);
    }
  }

  getQueryExcludeSensorsFlag(): number {
    return this.inner.getQueryExcludeSensorsFlag();
  }

  createCharacterController(offset: number): number {
    return this.inner.createCharacterController(offset);
  }

  configureCharacterController(
    controllerId: number,
    config: NpcPhysicsRapierCharacterControllerConfig,
  ): void {
    this.inner.configureCharacterController(controllerId, config);
  }

  removeCharacterController(controllerId: number): void {
    this.inner.removeCharacterController(controllerId);
  }

  createCapsuleCollider(config: NpcPhysicsRapierCapsuleColliderConfig): number {
    return this.inner.createCapsuleCollider(config);
  }

  removeCollider(colliderId: number): void {
    this.inner.removeCollider(colliderId);
  }

  setColliderTranslation(colliderId: number, translation: NpcPhysicsRapierVec3): void {
    this.inner.setColliderTranslation(colliderId, translation);
  }

  getColliderTranslation(colliderId: number): NpcPhysicsRapierVec3 | null {
    return this.inner.getColliderTranslation(colliderId);
  }

  computeColliderMovement(
    args: NpcPhysicsRapierComputeMovementArgs,
  ): NpcPhysicsRapierComputeMovementResult {
    return this.recordAndReadDelayed("compute", args, this.inner.computeColliderMovement(args));
  }

  castRayAndGetNormal(ray: NpcPhysicsRapierRay): NpcPhysicsRapierRayHit | null {
    return this.recordAndReadDelayed("castRay", ray, this.inner.castRayAndGetNormal(ray));
  }

  intersectionsWithRay(ray: NpcPhysicsRapierRay): NpcPhysicsRapierRayHit[] {
    return this.recordAndReadDelayed("intersections", ray, this.inner.intersectionsWithRay(ray));
  }

  private recordAndReadDelayed<T extends SnapshotOp["value"]>(
    kind: SnapshotOpKind,
    input: unknown,
    value: T,
  ): T {
    if (this.simulatedFrameDelay <= 0 || this.activeFrameId == null) return value;

    const frameId = this.activeFrameId;
    const opKey = this.makeOpKey(kind, input);
    const currentOps = this.frameOps.get(frameId) ?? new Map<string, SnapshotOp>();

    currentOps.set(opKey, {
      kind,
      value: cloneSnapshotValue(value),
    } as SnapshotOp);
    this.frameOps.set(frameId, currentOps);

    const delayedOps = this.frameOps.get(frameId - this.simulatedFrameDelay);
    if (!delayedOps) return value;
    const delayed = delayedOps.get(opKey);
    if (!delayed || delayed.kind !== kind) return value;
    return cloneSnapshotValue(delayed.value as T);
  }

  private makeOpKey(kind: SnapshotOpKind, input: unknown): string {
    return `${kind}:${stableSerialize(input)}`;
  }
}

function stableSerialize(value: unknown): string {
  if (value == null) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean" || t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableSerialize(v)).join(",")}]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function createNpcPhysicsRapierFrameSnapshotPort(
  inner: NpcPhysicsRapierPort,
  options?: NpcPhysicsRapierFrameSnapshotOptions,
): NpcPhysicsRapierFrameSnapshotPort {
  return new NpcPhysicsRapierFrameSnapshotPort(inner, options);
}
