import * as THREE from "three";

export type PlayerPose = {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
};

let playerPose: PlayerPose | null = null;

export function setPlayerPoseFromObject3D(obj: THREE.Object3D | null | undefined): void {
  if (!obj) {
    playerPose = null;
    return;
  }
  const p = obj.position;
  const q = obj.quaternion;
  playerPose = {
    position: { x: p.x, y: p.y, z: p.z },
    quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
  };
}

export function getPlayerPose(): PlayerPose | null {
  const pose = playerPose;
  if (!pose) return null;
  return {
    position: { ...pose.position },
    quaternion: { ...pose.quaternion },
  };
}

