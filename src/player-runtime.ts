import * as THREE from "three";

export type PlayerPose = {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  rootBoneWorldY: number | null; // Absolute Y position of root bone in world space
};

let playerPose: PlayerPose | null = null;

let cachedRootBoneWorldY: number | null = null; // Store measured world Y position once

function findRootBoneWorldY(obj: THREE.Object3D): number | null {
  // Use cached position if already successfully measured
  if (cachedRootBoneWorldY !== null) {
    return cachedRootBoneWorldY;
  }
  
  // Search for root bone
  let skinnedMesh: THREE.SkinnedMesh | undefined;
  let rootBone: THREE.Bone | undefined;
  
  obj.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh && !skinnedMesh) {
      skinnedMesh = child;
    }
    
    // Look for root bone named "BIP01" (Gothic convention)
    if (child instanceof THREE.Bone && child.name === 'BIP01' && !rootBone) {
      rootBone = child;
    }
  });
  
  // Try SkinnedMesh first
  if (skinnedMesh?.skeleton && skinnedMesh.skeleton.bones.length > 0) {
    const bone = skinnedMesh.skeleton.bones[0];
    
    const worldPos = new THREE.Vector3();
    bone.getWorldPosition(worldPos);
    
    // Cache the absolute world Y position only when found
    cachedRootBoneWorldY = worldPos.y;
    return worldPos.y;
  }
  
  // Fallback to direct bone search
  if (rootBone) {
    const worldPos = new THREE.Vector3();
    rootBone.getWorldPosition(worldPos);
    
    // Cache the absolute world Y position only when found
    cachedRootBoneWorldY = worldPos.y;
    return worldPos.y;
  }

  // Don't cache null - keep trying until we find the bone
  return null;
}

export function setPlayerPoseFromObject3D(obj: THREE.Object3D | null | undefined): void {
  if (!obj) {
    playerPose = null;
    return;
  }
  const p = obj.position;
  const q = obj.quaternion;
  const rootBoneWorldY = findRootBoneWorldY(obj);
  
  playerPose = {
    position: { x: p.x, y: p.y, z: p.z },
    quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
    rootBoneWorldY,
  };
}

export function getPlayerPose(): PlayerPose | null {
  const pose = playerPose;
  if (!pose) return null;
  return {
    position: { ...pose.position },
    quaternion: { ...pose.quaternion },
    rootBoneWorldY: pose.rootBoneWorldY,
  };
}

