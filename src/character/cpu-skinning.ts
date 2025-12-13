import * as THREE from "three";

export type CpuWeightEntry = {
  boneIndex: number;
  weight: number;
  position?: { x: number; y: number; z: number };
  normal?: { x: number; y: number; z: number };
};

export type CpuSkinningData = {
  geometry: THREE.BufferGeometry;
  vertexWeights: CpuWeightEntry[][];
  basePositions: Float32Array;
  baseNormals: Float32Array;
};

export function applyCpuSkinning(animWorld: THREE.Matrix4[], skinningData: CpuSkinningData) {
  const { geometry, vertexWeights, basePositions, baseNormals } = skinningData;
  const posAttribute = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normalAttribute = geometry.getAttribute("normal") as THREE.BufferAttribute;

  for (let i = 0; i < vertexWeights.length; i++) {
    const weights = vertexWeights[i];
    if (!weights || weights.length === 0) {
      posAttribute.setXYZ(i, basePositions[i * 3 + 0], basePositions[i * 3 + 1], basePositions[i * 3 + 2]);
      normalAttribute.setXYZ(i, baseNormals[i * 3 + 0], baseNormals[i * 3 + 1], baseNormals[i * 3 + 2]);
      continue;
    }

    if (weights[0].position) {
      const resultPos = new THREE.Vector3(0, 0, 0);
      const resultNormal = new THREE.Vector3(0, 0, 0);

      for (const { boneIndex, weight, position, normal } of weights) {
        if (!position || boneIndex >= animWorld.length) continue;

        const vertPosOS = new THREE.Vector3(position.x, position.y, position.z);
        const transformedPos = vertPosOS.applyMatrix4(animWorld[boneIndex]);
        resultPos.addScaledVector(transformedPos, weight);

        if (normal) {
          const vertNormalOS = new THREE.Vector3(normal.x, normal.y, normal.z);
          const mat3 = new THREE.Matrix3().setFromMatrix4(animWorld[boneIndex]);
          const transformedNormal = vertNormalOS.applyMatrix3(mat3);
          resultNormal.addScaledVector(transformedNormal, weight);
        }
      }

      posAttribute.setXYZ(i, resultPos.x, resultPos.y, resultPos.z);
      if (resultNormal.lengthSq() > 0) {
        normalAttribute.setXYZ(i, resultNormal.x, resultNormal.y, resultNormal.z);
      }
    }
  }

  posAttribute.needsUpdate = true;
  normalAttribute.needsUpdate = true;
}

