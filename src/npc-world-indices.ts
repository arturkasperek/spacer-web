import * as THREE from "three";
import type { World } from "@kolarz3/zenkit";
import { normalizeNameKey } from "./npc-renderer-utils";

export function buildNpcWorldIndices(world: World | null) {
  const wpIndex = new Map<string, THREE.Vector3>();
  const wpDirIndex = new Map<string, THREE.Quaternion>();
  const vobIndex = new Map<string, THREE.Vector3>();
  const vobDirIndex = new Map<string, THREE.Quaternion>();

  if (!world)
    return {
      waypointPosIndex: wpIndex,
      waypointDirIndex: wpDirIndex,
      vobPosIndex: vobIndex,
      vobDirIndex,
    };

  try {
    const waypointsVector = world.getAllWaypoints() as any;
    const waypointCount = waypointsVector.size();
    for (let i = 0; i < waypointCount; i++) {
      const wp = waypointsVector.get(i);
      if (!wp?.name) continue;
      const key = normalizeNameKey(wp.name);
      if (!key) continue;
      wpIndex.set(key, new THREE.Vector3(-wp.position.x, wp.position.y, wp.position.z));

      const dir = (wp as any).direction as { x: number; y: number; z: number } | undefined;
      if (dir && (dir.x !== 0 || dir.y !== 0 || dir.z !== 0)) {
        const direction = new THREE.Vector3(-dir.x, dir.y, dir.z);
        const up = new THREE.Vector3(0, 1, 0);
        const matrix = new THREE.Matrix4();
        matrix.lookAt(new THREE.Vector3(0, 0, 0), direction, up);
        const q = new THREE.Quaternion().setFromRotationMatrix(matrix);
        const yRot = new THREE.Quaternion().setFromAxisAngle(up, Math.PI);
        q.multiply(yRot);
        wpDirIndex.set(key, q);
      }
    }
  } catch {
    // ignore
  }

  const stack: any[] = [];
  try {
    const roots = world.getVobs();
    const rootCount = roots.size();
    for (let i = 0; i < rootCount; i++) {
      const root = roots.get(i);
      if (root) stack.push(root);
    }
  } catch {
    // ignore
  }

  while (stack.length > 0) {
    const v = stack.pop();
    if (!v) continue;
    const keys = [
      v.name as string | undefined,
      (v as any).vobName as string | undefined,
      (v as any).objectName as string | undefined,
    ];
    for (const k of keys) {
      const kk = k ? normalizeNameKey(k) : "";
      if (!kk) continue;
      if (!vobIndex.has(kk)) {
        vobIndex.set(kk, new THREE.Vector3(-v.position.x, v.position.y, v.position.z));

        // Store VOB rotation (quaternion) if available
        const rotArray = v?.rotation?.toArray?.();
        if (rotArray && typeof rotArray.size === "function" && typeof rotArray.get === "function") {
          const m: number[] = [];
          const n = rotArray.size();
          for (let i = 0; i < n; i++) m.push(rotArray.get(i));

          if (m.length === 9) {
            // Check if it's identity matrix
            const isIdentity =
              m[0] === 1 &&
              m[1] === 0 &&
              m[2] === 0 &&
              m[3] === 0 &&
              m[4] === 1 &&
              m[5] === 0 &&
              m[6] === 0 &&
              m[7] === 0 &&
              m[8] === 1;

            if (!isIdentity) {
              const transformMat = new THREE.Matrix4();
              transformMat.set(
                -m[0],
                -m[3],
                -m[6],
                0,
                m[1],
                m[4],
                m[7],
                0,
                m[2],
                m[5],
                m[8],
                0,
                0,
                0,
                0,
                1,
              );

              // Use decompose like in app.tsx for consistent results
              const pos = new THREE.Vector3();
              const quat = new THREE.Quaternion();
              const scale = new THREE.Vector3();
              transformMat.decompose(pos, quat, scale);

              vobDirIndex.set(kk, quat);
            }
          }
        }
      }
    }

    const children = v.children;
    const n = children?.size?.() ?? 0;
    for (let i = 0; i < n; i++) {
      const child = children.get(i);
      if (child) stack.push(child);
    }
  }

  return {
    waypointPosIndex: wpIndex,
    waypointDirIndex: wpDirIndex,
    vobPosIndex: vobIndex,
    vobDirIndex,
  };
}
