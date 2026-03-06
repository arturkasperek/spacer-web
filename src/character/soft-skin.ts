import * as THREE from "three";
import type { ZenKit } from "@kolarz3/zenkit";
import { tgaNameToCompiledUrl } from "../vob/vob-utils";
import type { AssetManager } from "../shared/asset-manager";
import type { CpuSkinningData } from "./cpu-skinning";

export type SerializedSoftSkinCpuBundle = {
  materials: Array<{ texture: string }>;
  groups: Array<{ start: number; count: number; matIndex: number }>;
  uvs: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  infPos: Float32Array;
  infNorm: Float32Array;
  vertexCount: number;
};

export async function buildSoftSkinMeshCPU(params: {
  zenKit: ZenKit;
  softSkinMesh: any;
  bindWorld: THREE.Matrix4[];
  assetManager: AssetManager;
  textureOverride?: (name: string) => string;
}) {
  const { zenKit, softSkinMesh, bindWorld, assetManager, textureOverride } = params;

  const mrMesh = softSkinMesh.mesh;
  const normals_raw = mrMesh.normals;
  const subMeshes = mrMesh.subMeshes;

  if (typeof softSkinMesh?.getPackedWeights4 !== "function") {
    throw new Error("SoftSkinMesh.getPackedWeights4() is required but not available");
  }
  const packedWeights = softSkinMesh.getPackedWeights4();
  const packedBoneIndices: Uint16Array = packedWeights.boneIndices;
  const packedBoneWeights: Float32Array = packedWeights.boneWeights;
  const packedBonePositions: Float32Array = packedWeights.bonePositions;

  const safeBoneIndex = (idx: number): number => {
    if (!Number.isFinite(idx) || idx < 0) return 0;
    if (idx >= bindWorld.length) return 0;
    return idx;
  };

  const materials: Array<{ texture: string }> = [];

  let currentMatIndex = 0;
  const triGroups: Array<{ start: number; count: number; matIndex: number }> = [];
  let triCount = 0;

  // Precompute total vertex count (triangle corners) to allocate TypedArrays.
  let totalVertices = 0;
  for (let subMeshIdx = 0; subMeshIdx < subMeshes.size(); subMeshIdx++) {
    const subMesh = subMeshes.get(subMeshIdx);
    totalVertices += (subMesh?.triangles?.size?.() ?? 0) * 3;
  }

  const posArray = new Float32Array(totalVertices * 3);
  const nrmArray = new Float32Array(totalVertices * 3);
  const uvArray = new Float32Array(totalVertices * 2);

  const skinIndex = new Uint16Array(totalVertices * 4);
  const skinWeight = new Float32Array(totalVertices * 4);
  const infPos = new Float32Array(totalVertices * 4 * 3);
  const infNorm = new Float32Array(totalVertices * 4 * 3);

  let vertexCursor = 0;
  for (let subMeshIdx = 0; subMeshIdx < subMeshes.size(); subMeshIdx++) {
    const subMesh = subMeshes.get(subMeshIdx);
    const triangles = subMesh.triangles;
    const wedges = subMesh.wedges;

    materials.push({ texture: subMesh.mat.texture || "" });

    const groupStart = vertexCursor;

    for (let triIdx = 0; triIdx < triangles.size(); triIdx++) {
      const triangle = triangles.get(triIdx);

      for (let i = 0; i < 3; i++) {
        const wedgeIdx = triangle.getWedge(i);
        const wedge = wedges.get(wedgeIdx);
        const vertIdx = wedge.index;

        const baseNormalOS = normals_raw.get(vertIdx);
        const normalOS = new THREE.Vector3(baseNormalOS.x, baseNormalOS.y, baseNormalOS.z);

        const bindPos = new THREE.Vector3(0, 0, 0);
        const bindNorm = new THREE.Vector3(0, 0, 0);

        const srcOff4 = vertIdx * 4;
        const srcOff12 = vertIdx * 12;

        const dstOff3 = vertexCursor * 3;
        const dstOff2 = vertexCursor * 2;
        const dstOff4 = vertexCursor * 4;
        const dstOff12 = vertexCursor * 12;

        for (let j = 0; j < 4; j++) {
          const w = packedBoneWeights[srcOff4 + j] ?? 0;
          const boneIndex = safeBoneIndex(packedBoneIndices[srcOff4 + j] ?? 0);

          skinIndex[dstOff4 + j] = boneIndex;
          skinWeight[dstOff4 + j] = w;

          const px = packedBonePositions[srcOff12 + j * 3] ?? 0;
          const py = packedBonePositions[srcOff12 + j * 3 + 1] ?? 0;
          const pz = packedBonePositions[srcOff12 + j * 3 + 2] ?? 0;
          infPos[dstOff12 + j * 3] = px;
          infPos[dstOff12 + j * 3 + 1] = py;
          infPos[dstOff12 + j * 3 + 2] = pz;

          infNorm[dstOff12 + j * 3] = normalOS.x;
          infNorm[dstOff12 + j * 3 + 1] = normalOS.y;
          infNorm[dstOff12 + j * 3 + 2] = normalOS.z;

          if (w > 0.0001) {
            const bindMatrix = bindWorld[boneIndex] || new THREE.Matrix4();
            const posOS = new THREE.Vector3(px, py, pz);
            const posBind = posOS.applyMatrix4(bindMatrix);
            bindPos.addScaledVector(posBind, w);

            const mat3 = new THREE.Matrix3().setFromMatrix4(bindMatrix);
            const nBind = normalOS.clone().applyMatrix3(mat3);
            bindNorm.addScaledVector(nBind, w);
          }
        }

        posArray[dstOff3] = bindPos.x;
        posArray[dstOff3 + 1] = bindPos.y;
        posArray[dstOff3 + 2] = bindPos.z;

        nrmArray[dstOff3] = bindNorm.x;
        nrmArray[dstOff3 + 1] = bindNorm.y;
        nrmArray[dstOff3 + 2] = bindNorm.z;

        uvArray[dstOff2] = wedge.texture.x;
        uvArray[dstOff2 + 1] = wedge.texture.y;

        vertexCursor++;
      }

      triCount++;
    }

    triGroups.push({
      start: groupStart,
      count: vertexCursor - groupStart,
      matIndex: currentMatIndex,
    });
    currentMatIndex++;
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posArray, 3);
  const normalAttr = new THREE.BufferAttribute(nrmArray, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  normalAttr.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute("position", posAttr);
  geometry.setAttribute("normal", normalAttr);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));

  for (const group of triGroups) {
    geometry.addGroup(group.start, group.count, group.matIndex);
  }

  const materialArray: THREE.MeshBasicMaterial[] = [];
  for (let mi = 0; mi < materials.length; mi++) {
    const matData = materials[mi];
    const textureName = matData.texture || "";

    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0.5,
    });

    if (textureName && textureName.length) {
      const finalName = textureOverride ? textureOverride(textureName) : textureName;
      const url = tgaNameToCompiledUrl(finalName);
      if (url) {
        const tex = await assetManager.loadTexture(url, zenKit);
        if (tex) {
          material.map = tex;
          material.needsUpdate = true;
        }
      }
    }

    materialArray.push(material);
  }

  const mesh = new THREE.Mesh(geometry, materialArray.length > 0 ? materialArray : undefined);
  mesh.frustumCulled = false;

  const basePositions = new Float32Array(posArray);
  const baseNormals = new Float32Array(nrmArray);

  const skinningData: CpuSkinningData = {
    geometry,
    skinIndex,
    skinWeight,
    infPos,
    infNorm,
    basePositions,
    baseNormals,
  };

  mesh.userData.cpuSkinningData = skinningData;

  return { mesh, skinningData };
}

export async function buildSoftSkinMeshCPUFromBundle(params: {
  zenKit: ZenKit;
  bundle: SerializedSoftSkinCpuBundle;
  bindWorld: THREE.Matrix4[];
  assetManager: AssetManager;
  textureOverride?: (name: string) => string;
}) {
  const { zenKit, bundle, bindWorld, assetManager, textureOverride } = params;
  const vertexCount = bundle.vertexCount;
  const posArray = new Float32Array(vertexCount * 3);
  const nrmArray = new Float32Array(vertexCount * 3);
  const uvArray = new Float32Array(bundle.uvs);
  const skinIndex = new Uint16Array(bundle.skinIndex);
  const skinWeight = new Float32Array(bundle.skinWeight);
  const infPos = new Float32Array(bundle.infPos);
  const infNorm = new Float32Array(bundle.infNorm);

  const safeBoneIndex = (idx: number): number => {
    if (!Number.isFinite(idx) || idx < 0) return 0;
    if (idx >= bindWorld.length) return 0;
    return idx;
  };

  const normalMatrices: THREE.Matrix3[] = bindWorld.map((m) =>
    new THREE.Matrix3().setFromMatrix4(m),
  );
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const bindPos = new THREE.Vector3(0, 0, 0);
    const bindNorm = new THREE.Vector3(0, 0, 0);
    const dstOff3 = vertex * 3;
    const dstOff4 = vertex * 4;
    const dstOff12 = vertex * 12;

    for (let j = 0; j < 4; j++) {
      const w = skinWeight[dstOff4 + j] ?? 0;
      const boneIndex = safeBoneIndex(skinIndex[dstOff4 + j] ?? 0);
      if (w <= 0.0001) continue;
      const bindMatrix = bindWorld[boneIndex] || new THREE.Matrix4();
      const px = infPos[dstOff12 + j * 3] ?? 0;
      const py = infPos[dstOff12 + j * 3 + 1] ?? 0;
      const pz = infPos[dstOff12 + j * 3 + 2] ?? 0;
      const nx = infNorm[dstOff12 + j * 3] ?? 0;
      const ny = infNorm[dstOff12 + j * 3 + 1] ?? 0;
      const nz = infNorm[dstOff12 + j * 3 + 2] ?? 0;

      const posBind = new THREE.Vector3(px, py, pz).applyMatrix4(bindMatrix);
      bindPos.addScaledVector(posBind, w);

      const nBind = new THREE.Vector3(nx, ny, nz).applyMatrix3(
        normalMatrices[boneIndex] || new THREE.Matrix3(),
      );
      bindNorm.addScaledVector(nBind, w);
    }

    posArray[dstOff3] = bindPos.x;
    posArray[dstOff3 + 1] = bindPos.y;
    posArray[dstOff3 + 2] = bindPos.z;
    nrmArray[dstOff3] = bindNorm.x;
    nrmArray[dstOff3 + 1] = bindNorm.y;
    nrmArray[dstOff3 + 2] = bindNorm.z;
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posArray, 3);
  const normalAttr = new THREE.BufferAttribute(nrmArray, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  normalAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", posAttr);
  geometry.setAttribute("normal", normalAttr);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));
  for (const group of bundle.groups) {
    geometry.addGroup(group.start, group.count, group.matIndex);
  }

  const materialArray: THREE.MeshBasicMaterial[] = [];
  for (let mi = 0; mi < bundle.materials.length; mi++) {
    const matData = bundle.materials[mi];
    const textureName = matData.texture || "";
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0.5,
    });
    if (textureName && textureName.length) {
      const finalName = textureOverride ? textureOverride(textureName) : textureName;
      const url = tgaNameToCompiledUrl(finalName);
      if (url) {
        const tex = await assetManager.loadTexture(url, zenKit);
        if (tex) {
          material.map = tex;
          material.needsUpdate = true;
        }
      }
    }
    materialArray.push(material);
  }

  const mesh = new THREE.Mesh(geometry, materialArray.length > 0 ? materialArray : undefined);
  mesh.frustumCulled = false;
  const basePositions = new Float32Array(posArray);
  const baseNormals = new Float32Array(nrmArray);
  const skinningData: CpuSkinningData = {
    geometry,
    skinIndex,
    skinWeight,
    infPos,
    infNorm,
    basePositions,
    baseNormals,
  };
  mesh.userData.cpuSkinningData = skinningData;
  return { mesh, skinningData };
}

export async function buildSoftSkinSkinnedMeshFromBundle(params: {
  zenKit: ZenKit;
  bundle: SerializedSoftSkinCpuBundle;
  bindWorld: THREE.Matrix4[];
  threeSkeleton: THREE.Skeleton;
  assetManager: AssetManager;
  textureOverride?: (name: string) => string;
}): Promise<THREE.SkinnedMesh> {
  const { zenKit, bundle, bindWorld, threeSkeleton, assetManager, textureOverride } = params;
  const vertexCount = bundle.vertexCount;
  const posArray = new Float32Array(vertexCount * 3);
  const nrmArray = new Float32Array(vertexCount * 3);
  const uvArray = new Float32Array(bundle.uvs);
  const skinIndex = new Uint16Array(bundle.skinIndex);
  const skinWeight = new Float32Array(bundle.skinWeight);
  const infPos = new Float32Array(bundle.infPos);
  const infNorm = new Float32Array(bundle.infNorm);

  const safeBoneIndex = (idx: number): number => {
    if (!Number.isFinite(idx) || idx < 0) return 0;
    if (idx >= bindWorld.length) return 0;
    return idx;
  };

  const normalMatrices: THREE.Matrix3[] = bindWorld.map((m) =>
    new THREE.Matrix3().setFromMatrix4(m),
  );
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const bindPos = new THREE.Vector3(0, 0, 0);
    const bindNorm = new THREE.Vector3(0, 0, 0);
    const dstOff3 = vertex * 3;
    const dstOff4 = vertex * 4;
    const dstOff12 = vertex * 12;

    for (let j = 0; j < 4; j++) {
      const w = skinWeight[dstOff4 + j] ?? 0;
      const boneIndex = safeBoneIndex(skinIndex[dstOff4 + j] ?? 0);
      if (w <= 0.0001) continue;
      const bindMatrix = bindWorld[boneIndex] || new THREE.Matrix4();
      const px = infPos[dstOff12 + j * 3] ?? 0;
      const py = infPos[dstOff12 + j * 3 + 1] ?? 0;
      const pz = infPos[dstOff12 + j * 3 + 2] ?? 0;
      const nx = infNorm[dstOff12 + j * 3] ?? 0;
      const ny = infNorm[dstOff12 + j * 3 + 1] ?? 0;
      const nz = infNorm[dstOff12 + j * 3 + 2] ?? 0;

      const posBind = new THREE.Vector3(px, py, pz).applyMatrix4(bindMatrix);
      bindPos.addScaledVector(posBind, w);

      const nBind = new THREE.Vector3(nx, ny, nz).applyMatrix3(
        normalMatrices[boneIndex] || new THREE.Matrix3(),
      );
      bindNorm.addScaledVector(nBind, w);
    }

    posArray[dstOff3] = bindPos.x;
    posArray[dstOff3 + 1] = bindPos.y;
    posArray[dstOff3 + 2] = bindPos.z;
    nrmArray[dstOff3] = bindNorm.x;
    nrmArray[dstOff3 + 1] = bindNorm.y;
    nrmArray[dstOff3 + 2] = bindNorm.z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(nrmArray, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));
  geometry.setAttribute(
    "skinIndex",
    new THREE.Float32BufferAttribute(new Float32Array(skinIndex), 4),
  );
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
  for (const group of bundle.groups) {
    geometry.addGroup(group.start, group.count, group.matIndex);
  }

  const materialArray: THREE.MeshBasicMaterial[] = [];
  for (let mi = 0; mi < bundle.materials.length; mi++) {
    const matData = bundle.materials[mi];
    const textureName = matData.texture || "";
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0.5,
    });
    if (textureName && textureName.length) {
      const finalName = textureOverride ? textureOverride(textureName) : textureName;
      const url = tgaNameToCompiledUrl(finalName);
      if (url) {
        const tex = await assetManager.loadTexture(url, zenKit);
        if (tex) {
          material.map = tex;
          material.needsUpdate = true;
        }
      }
    }
    (material as any).skinning = true;
    materialArray.push(material);
  }

  const mesh = new THREE.SkinnedMesh(
    geometry,
    materialArray.length > 0 ? materialArray : new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  mesh.frustumCulled = false;
  mesh.bind(threeSkeleton, new THREE.Matrix4().identity());
  mesh.normalizeSkinWeights();
  return mesh;
}
