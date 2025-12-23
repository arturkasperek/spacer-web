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
  const posArray = posAttribute.array as Float32Array;
  const normalArray = normalAttribute.array as Float32Array;

  for (let i = 0; i < vertexWeights.length; i++) {
    const weights = vertexWeights[i];
    if (!weights || weights.length === 0) {
      const idx = i * 3;
      posArray[idx] = basePositions[idx];
      posArray[idx + 1] = basePositions[idx + 1];
      posArray[idx + 2] = basePositions[idx + 2];
      normalArray[idx] = baseNormals[idx];
      normalArray[idx + 1] = baseNormals[idx + 1];
      normalArray[idx + 2] = baseNormals[idx + 2];
      continue;
    }

    if (weights[0].position) {
      let resultPosX = 0;
      let resultPosY = 0;
      let resultPosZ = 0;
      let resultNormX = 0;
      let resultNormY = 0;
      let resultNormZ = 0;

      for (const { boneIndex, weight, position, normal } of weights) {
        if (!position || boneIndex >= animWorld.length) continue;

        const m = animWorld[boneIndex].elements;
        const px = position.x;
        const py = position.y;
        const pz = position.z;

        // Apply matrix transformation directly (faster than Vector3.applyMatrix4)
        const tx = m[0] * px + m[4] * py + m[8] * pz + m[12];
        const ty = m[1] * px + m[5] * py + m[9] * pz + m[13];
        const tz = m[2] * px + m[6] * py + m[10] * pz + m[14];

        resultPosX += tx * weight;
        resultPosY += ty * weight;
        resultPosZ += tz * weight;

        if (normal) {
          const nx = normal.x;
          const ny = normal.y;
          const nz = normal.z;

          // Extract rotation part (3x3) and apply directly (faster than Matrix3)
          const ntx = m[0] * nx + m[4] * ny + m[8] * nz;
          const nty = m[1] * nx + m[5] * ny + m[9] * nz;
          const ntz = m[2] * nx + m[6] * ny + m[10] * nz;

          resultNormX += ntx * weight;
          resultNormY += nty * weight;
          resultNormZ += ntz * weight;
        }
      }

      const idx = i * 3;
      posArray[idx] = resultPosX;
      posArray[idx + 1] = resultPosY;
      posArray[idx + 2] = resultPosZ;

      if (resultNormX * resultNormX + resultNormY * resultNormY + resultNormZ * resultNormZ > 0) {
        normalArray[idx] = resultNormX;
        normalArray[idx + 1] = resultNormY;
        normalArray[idx + 2] = resultNormZ;
      }
    }
  }

  posAttribute.needsUpdate = true;
  normalAttribute.needsUpdate = true;
}

