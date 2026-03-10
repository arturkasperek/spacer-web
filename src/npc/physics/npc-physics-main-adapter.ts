import * as THREE from "three";
import type { NpcPhysicsCoreState } from "./npc-physics-core";

export type NpcPhysicsMainAdapterState = Pick<
  NpcPhysicsCoreState,
  "px" | "py" | "pz" | "vx" | "vy" | "vz" | "grounded" | "falling" | "sliding" | "jumpActive"
>;

export function readNpcPhysicsStateFromGroup(group: THREE.Group): NpcPhysicsMainAdapterState {
  const ud: any = group.userData ?? {};
  return {
    px: group.position.x,
    py: group.position.y,
    pz: group.position.z,
    vx: Number(ud._kccVx ?? 0),
    vy: Number(ud._kccVy ?? 0),
    vz: Number(ud._kccVz ?? 0),
    grounded: Boolean(ud._kccGrounded),
    falling: Boolean(ud.isFalling),
    sliding: Boolean(ud.isSliding),
    jumpActive: Boolean(ud._kccJumpActive),
  };
}

export function writeNpcPhysicsStateToGroup(group: THREE.Group, state: NpcPhysicsMainAdapterState) {
  const ud: any = group.userData ?? (group.userData = {});
  group.position.set(state.px, state.py, state.pz);
  ud._kccVx = state.vx;
  ud._kccVy = state.vy;
  ud._kccVz = state.vz;
  ud._kccGrounded = state.grounded;
  ud.isFalling = state.falling;
  ud.isSliding = state.sliding;
  ud._kccJumpActive = state.jumpActive;
}
