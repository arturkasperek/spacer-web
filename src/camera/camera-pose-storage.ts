import * as THREE from "three";

const CAMERA_POSE_STORAGE_KEY = "spacer_web_camera_pose_v1";

export type StoredCameraPose = {
  worldPath: string;
  position: [number, number, number];
  lookAt: [number, number, number];
  savedAt: number;
};

export function readStoredCameraPose(): StoredCameraPose | null {
  try {
    const raw = localStorage.getItem(CAMERA_POSE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCameraPose>;
    if (!parsed || typeof parsed !== "object") return null;
    const position = parsed.position;
    const lookAt = parsed.lookAt;
    if (
      !Array.isArray(position) ||
      position.length !== 3 ||
      !Array.isArray(lookAt) ||
      lookAt.length !== 3
    ) {
      return null;
    }
    if (typeof parsed.worldPath !== "string") return null;
    return {
      worldPath: parsed.worldPath,
      position: [Number(position[0]), Number(position[1]), Number(position[2])],
      lookAt: [Number(lookAt[0]), Number(lookAt[1]), Number(lookAt[2])],
      savedAt: Number(parsed.savedAt ?? 0),
    };
  } catch {
    return null;
  }
}

export function writeStoredCameraPose(pose: StoredCameraPose): boolean {
  try {
    localStorage.setItem(CAMERA_POSE_STORAGE_KEY, JSON.stringify(pose));
    return true;
  } catch {
    return false;
  }
}

export function buildLookAtFromCamera(camera: THREE.PerspectiveCamera): [number, number, number] {
  const pos = camera.position.clone();
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const lookAt = pos.clone().addScaledVector(forward, 1000);
  return [lookAt.x, lookAt.y, lookAt.z];
}
