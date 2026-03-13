import { createNpcPhysicsRapierMainThreadPort } from "./npc-physics-rapier-main-thread";
import type { NpcPhysicsRapierPort } from "./npc-physics-rapier-port";
import { createNpcPhysicsRapierWorkerPort } from "./npc-physics-rapier-worker";

export type NpcPhysicsRapierBackendMode = "main-thread" | "worker";

export type CreateNpcPhysicsRapierBackendPortOptions = {
  rapierWorld: unknown;
  rapier: unknown;
  mode?: NpcPhysicsRapierBackendMode;
  worker?: Worker | null;
};

export function createNpcPhysicsRapierBackendPort(
  options: CreateNpcPhysicsRapierBackendPortOptions,
): NpcPhysicsRapierPort {
  const mainThreadPort = createNpcPhysicsRapierMainThreadPort(options.rapierWorld, options.rapier);
  if (options.mode !== "worker") return mainThreadPort;
  if (!options.worker) return mainThreadPort;
  return createNpcPhysicsRapierWorkerPort(options.worker, mainThreadPort);
}
