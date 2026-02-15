import type { MutableRefObject } from "react";
import * as THREE from "three";
import { updateNpcWorldPosition } from "../world/npc-freepoints";
import { tickNpcDaedalusStateLoop } from "../scripting/npc-daedalus-loop";
import { setPlayerPoseFromObject3D } from "../../player/player-runtime";
import type { NpcData } from "../../shared/types";
import type { Aabb } from "../world/npc-routine-waybox";
import type { WaypointMover } from "../navigation/npc-waypoint-mover";

export type FrameContext = {
  loadedNpcsRef: MutableRefObject<Map<string, THREE.Group>>;
  waypointMoverRef: MutableRefObject<WaypointMover | null>;
  playerGroupRef: MutableRefObject<THREE.Group | null>;
};

export function tickStreamingStage(params: {
  physicsFrameRef: MutableRefObject<number>;
  allNpcsRef: MutableRefObject<Array<{ npcData: NpcData; position: THREE.Vector3; waybox: Aabb }>>;
  updateNpcStreaming: () => unknown;
  freepointOwnerOverlayRef: MutableRefObject<{ update: (enabled: boolean) => void } | null>;
  enabled: boolean;
}) {
  const physicsFrame = ++params.physicsFrameRef.current;
  if (params.allNpcsRef.current.length > 0) {
    params.updateNpcStreaming();
  }
  params.freepointOwnerOverlayRef.current?.update(Boolean(params.enabled));
  return physicsFrame;
}

export function tickWorldSyncStage(ctx: FrameContext) {
  // Sync current world positions for all loaded NPCs before the VM/state-loop tick.
  // This ensures builtins like `Npc_IsOnFP` / `Wld_IsFPAvailable` see up-to-date coordinates.
  for (const g of ctx.loadedNpcsRef.current.values()) {
    if (!g || g.userData.isDisposed) continue;
    const npcData = g.userData.npcData as NpcData | undefined;
    if (!npcData) continue;
    updateNpcWorldPosition(npcData.instanceIndex, {
      x: g.position.x,
      y: g.position.y,
      z: g.position.z,
    });
  }
}

export function tickScriptsStage(ctx: FrameContext) {
  // Run a minimal Daedalus "state loop" tick for loaded NPCs.
  // This is what triggers scripts like `zs_bandit_loop()` that call `AI_GotoFP(...)`.
  tickNpcDaedalusStateLoop({
    loadedNpcsRef: ctx.loadedNpcsRef,
    waypointMoverRef: ctx.waypointMoverRef,
  });

  // Keep a lightweight hero pose snapshot for camera follow (no Three.js refs).
  setPlayerPoseFromObject3D(ctx.playerGroupRef.current);
}

export function tickTeleportDebugStage(params: {
  teleportHeroSeqAppliedRef: MutableRefObject<number>;
  teleportHeroSeqRef: MutableRefObject<number>;
  playerGroupRef: MutableRefObject<THREE.Group | null>;
  camera: THREE.Camera;
  tmpTeleportForward: THREE.Vector3;
  tmpTeleportDesiredQuat: THREE.Quaternion;
  tmpManualUp: THREE.Vector3;
  persistNpcPosition: (npcGroup: THREE.Group) => void;
}) {
  // Debug helper: teleport the hero in front of the camera.
  if (params.teleportHeroSeqAppliedRef.current !== params.teleportHeroSeqRef.current) {
    const player = params.playerGroupRef.current;
    const cam = params.camera;
    if (player && cam) {
      cam.getWorldDirection(params.tmpTeleportForward);
      params.tmpTeleportForward.y = 0;
      if (params.tmpTeleportForward.lengthSq() < 1e-8) params.tmpTeleportForward.set(0, 0, -1);
      else params.tmpTeleportForward.normalize();

      const TELEPORT_DISTANCE = 220;
      const targetX = cam.position.x + params.tmpTeleportForward.x * TELEPORT_DISTANCE;
      const targetY = cam.position.y + 50;
      const targetZ = cam.position.z + params.tmpTeleportForward.z * TELEPORT_DISTANCE;
      player.position.x = targetX;
      player.position.y = targetY;
      player.position.z = targetZ;

      // Face the same direction as the camera.
      const yaw = Math.atan2(params.tmpTeleportForward.x, params.tmpTeleportForward.z);
      params.tmpTeleportDesiredQuat.setFromAxisAngle(params.tmpManualUp, yaw);
      player.quaternion.copy(params.tmpTeleportDesiredQuat);

      player.userData._kccSnapped = false;
      player.userData._kccVy = 0;
      player.userData._kccGrounded = false;
      player.userData._kccStableGrounded = false;
      player.userData._kccGroundedFor = 0;
      player.userData._kccUngroundedFor = 0;
      player.userData._kccSlideSpeed = 0;
      player.userData.isFalling = true;
      player.userData.isSliding = false;

      params.persistNpcPosition(player);
      params.teleportHeroSeqAppliedRef.current = params.teleportHeroSeqRef.current;
    }
  }
}

export function tickCombatStage(params: {
  delta: number;
  loadedNpcsRef: MutableRefObject<Map<string, THREE.Group>>;
  runCombatTick: (
    delta: number,
    loadedNpcs: Iterable<THREE.Group>,
    resolveAnim: (npcInstanceIndex: number, animationName: string) => any,
  ) => void;
  resolveNpcAnimationRef: (npcInstanceIndex: number, animationName: string) => any;
}) {
  // Combat update after movement tick: for now only melee hit resolution for loaded NPCs.
  params.runCombatTick(
    params.delta,
    params.loadedNpcsRef.current.values(),
    params.resolveNpcAnimationRef,
  );
}
