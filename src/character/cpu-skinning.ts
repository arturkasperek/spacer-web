import * as THREE from "three";

// CPU skinning inputs in an optimized typed-array form (4 influences per vertex).
export type CpuSkinningData = {
  geometry: THREE.BufferGeometry;
  // 4 influences per vertex
  skinIndex: Uint16Array; // vCount * 4
  skinWeight: Float32Array; // vCount * 4
  // bone-space (pre-inverseBind-applied) per influence
  infPos: Float32Array; // vCount * 4 * 3  (12 floats per vertex)
  infNorm?: Float32Array; // vCount * 4 * 3
  // fallback for vertices with no weights
  basePositions: Float32Array; // vCount * 3
  baseNormals: Float32Array; // vCount * 3
};

// Cache for bone palette conversion (reused per frame)
let bonePaletteCache: Float32Array | null = null;
let bonePaletteCacheSize = 0;

/**
 * Converts Matrix4[] to flat Float32Array palette (boneCount * 16 floats)
 * Reuses cached array if size matches to avoid allocations
 */
function getBonePalette(animWorld: THREE.Matrix4[]): Float32Array {
  const boneCount = animWorld.length;
  const requiredSize = boneCount * 16;

  if (!bonePaletteCache || bonePaletteCacheSize !== requiredSize) {
    bonePaletteCache = new Float32Array(requiredSize);
    bonePaletteCacheSize = requiredSize;
  }

  const palette = bonePaletteCache;
  for (let i = 0; i < boneCount; i++) {
    const m = animWorld[i].elements;
    const baseIdx = i * 16;
    for (let j = 0; j < 16; j++) {
      palette[baseIdx + j] = m[j];
    }
  }

  return palette;
}

/**
 * Optimized CPU skinning using typed arrays and flat bone palette
 * Assumes max 4 influences per vertex
 */
function applyCpuSkinningInternal(bonePalette: Float32Array, data: CpuSkinningData) {
  const { geometry, skinIndex, skinWeight, infPos, infNorm, basePositions, baseNormals } = data;
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const nrmAttr = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const outPos = posAttr.array as Float32Array;
  const outNrm = nrmAttr.array as Float32Array;
  const vCount = posAttr.count;
  const boneCount = bonePalette.length / 16;

  let idx3 = 0; // vertex * 3
  let idx4 = 0; // vertex * 4
  let idx12 = 0; // vertex * 12 (4 influences * 3)

  for (let i = 0; i < vCount; i++, idx3 += 3, idx4 += 4, idx12 += 12) {
    const w0 = skinWeight[idx4];
    const w1 = skinWeight[idx4 + 1];
    const w2 = skinWeight[idx4 + 2];
    const w3 = skinWeight[idx4 + 3];

    // No influences -> copy base (matches your current behavior)
    if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0) {
      outPos[idx3] = basePositions[idx3];
      outPos[idx3 + 1] = basePositions[idx3 + 1];
      outPos[idx3 + 2] = basePositions[idx3 + 2];
      outNrm[idx3] = baseNormals[idx3];
      outNrm[idx3 + 1] = baseNormals[idx3 + 1];
      outNrm[idx3 + 2] = baseNormals[idx3 + 2];
      continue;
    }

    let rx = 0,
      ry = 0,
      rz = 0;
    let rnx = 0,
      rny = 0,
      rnz = 0;

    // --- influence 0 ---
    if (w0 !== 0) {
      const boneIdx = skinIndex[idx4];
      if (boneIdx < boneCount) {
        const bi = boneIdx << 4; // * 16
        const px = infPos[idx12],
          py = infPos[idx12 + 1],
          pz = infPos[idx12 + 2];
        const m0 = bonePalette[bi],
          m1 = bonePalette[bi + 1],
          m2 = bonePalette[bi + 2];
        const m4 = bonePalette[bi + 4],
          m5 = bonePalette[bi + 5],
          m6 = bonePalette[bi + 6];
        const m8 = bonePalette[bi + 8],
          m9 = bonePalette[bi + 9],
          m10 = bonePalette[bi + 10];
        const m12 = bonePalette[bi + 12],
          m13 = bonePalette[bi + 13],
          m14 = bonePalette[bi + 14];

        rx += (m0 * px + m4 * py + m8 * pz + m12) * w0;
        ry += (m1 * px + m5 * py + m9 * pz + m13) * w0;
        rz += (m2 * px + m6 * py + m10 * pz + m14) * w0;

        if (infNorm) {
          const nx = infNorm[idx12],
            ny = infNorm[idx12 + 1],
            nz = infNorm[idx12 + 2];
          rnx += (m0 * nx + m4 * ny + m8 * nz) * w0;
          rny += (m1 * nx + m5 * ny + m9 * nz) * w0;
          rnz += (m2 * nx + m6 * ny + m10 * nz) * w0;
        }
      }
    }

    // --- influence 1 ---
    if (w1 !== 0) {
      const boneIdx = skinIndex[idx4 + 1];
      if (boneIdx < boneCount) {
        const bi = boneIdx << 4;
        const pOff = idx12 + 3;
        const px = infPos[pOff],
          py = infPos[pOff + 1],
          pz = infPos[pOff + 2];
        const m0 = bonePalette[bi],
          m1 = bonePalette[bi + 1],
          m2 = bonePalette[bi + 2];
        const m4 = bonePalette[bi + 4],
          m5 = bonePalette[bi + 5],
          m6 = bonePalette[bi + 6];
        const m8 = bonePalette[bi + 8],
          m9 = bonePalette[bi + 9],
          m10 = bonePalette[bi + 10];
        const m12 = bonePalette[bi + 12],
          m13 = bonePalette[bi + 13],
          m14 = bonePalette[bi + 14];

        rx += (m0 * px + m4 * py + m8 * pz + m12) * w1;
        ry += (m1 * px + m5 * py + m9 * pz + m13) * w1;
        rz += (m2 * px + m6 * py + m10 * pz + m14) * w1;

        if (infNorm) {
          const nx = infNorm[pOff],
            ny = infNorm[pOff + 1],
            nz = infNorm[pOff + 2];
          rnx += (m0 * nx + m4 * ny + m8 * nz) * w1;
          rny += (m1 * nx + m5 * ny + m9 * nz) * w1;
          rnz += (m2 * nx + m6 * ny + m10 * nz) * w1;
        }
      }
    }

    // --- influence 2 ---
    if (w2 !== 0) {
      const boneIdx = skinIndex[idx4 + 2];
      if (boneIdx < boneCount) {
        const bi = boneIdx << 4;
        const pOff = idx12 + 6;
        const px = infPos[pOff],
          py = infPos[pOff + 1],
          pz = infPos[pOff + 2];
        const m0 = bonePalette[bi],
          m1 = bonePalette[bi + 1],
          m2 = bonePalette[bi + 2];
        const m4 = bonePalette[bi + 4],
          m5 = bonePalette[bi + 5],
          m6 = bonePalette[bi + 6];
        const m8 = bonePalette[bi + 8],
          m9 = bonePalette[bi + 9],
          m10 = bonePalette[bi + 10];
        const m12 = bonePalette[bi + 12],
          m13 = bonePalette[bi + 13],
          m14 = bonePalette[bi + 14];

        rx += (m0 * px + m4 * py + m8 * pz + m12) * w2;
        ry += (m1 * px + m5 * py + m9 * pz + m13) * w2;
        rz += (m2 * px + m6 * py + m10 * pz + m14) * w2;

        if (infNorm) {
          const nx = infNorm[pOff],
            ny = infNorm[pOff + 1],
            nz = infNorm[pOff + 2];
          rnx += (m0 * nx + m4 * ny + m8 * nz) * w2;
          rny += (m1 * nx + m5 * ny + m9 * nz) * w2;
          rnz += (m2 * nx + m6 * ny + m10 * nz) * w2;
        }
      }
    }

    // --- influence 3 ---
    if (w3 !== 0) {
      const boneIdx = skinIndex[idx4 + 3];
      if (boneIdx < boneCount) {
        const bi = boneIdx << 4;
        const pOff = idx12 + 9;
        const px = infPos[pOff],
          py = infPos[pOff + 1],
          pz = infPos[pOff + 2];
        const m0 = bonePalette[bi],
          m1 = bonePalette[bi + 1],
          m2 = bonePalette[bi + 2];
        const m4 = bonePalette[bi + 4],
          m5 = bonePalette[bi + 5],
          m6 = bonePalette[bi + 6];
        const m8 = bonePalette[bi + 8],
          m9 = bonePalette[bi + 9],
          m10 = bonePalette[bi + 10];
        const m12 = bonePalette[bi + 12],
          m13 = bonePalette[bi + 13],
          m14 = bonePalette[bi + 14];

        rx += (m0 * px + m4 * py + m8 * pz + m12) * w3;
        ry += (m1 * px + m5 * py + m9 * pz + m13) * w3;
        rz += (m2 * px + m6 * py + m10 * pz + m14) * w3;

        if (infNorm) {
          const nx = infNorm[pOff],
            ny = infNorm[pOff + 1],
            nz = infNorm[pOff + 2];
          rnx += (m0 * nx + m4 * ny + m8 * nz) * w3;
          rny += (m1 * nx + m5 * ny + m9 * nz) * w3;
          rnz += (m2 * nx + m6 * ny + m10 * nz) * w3;
        }
      }
    }

    outPos[idx3] = rx;
    outPos[idx3 + 1] = ry;
    outPos[idx3 + 2] = rz;

    if (infNorm && rnx * rnx + rny * rny + rnz * rnz > 0) {
      outNrm[idx3] = rnx;
      outNrm[idx3 + 1] = rny;
      outNrm[idx3 + 2] = rnz;
    } else {
      outNrm[idx3] = baseNormals[idx3];
      outNrm[idx3 + 1] = baseNormals[idx3 + 1];
      outNrm[idx3 + 2] = baseNormals[idx3 + 2];
    }
  }

  posAttr.needsUpdate = true;
  nrmAttr.needsUpdate = true;
}

export function applyCpuSkinning(animWorld: THREE.Matrix4[], skinningData: CpuSkinningData) {
  // Convert Matrix4[] to flat Float32Array palette
  const bonePalette = getBonePalette(animWorld);
  applyCpuSkinningInternal(bonePalette, skinningData);
}
