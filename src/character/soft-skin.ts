import * as THREE from "three";
import type { ZenKit } from "@kolarz3/zenkit";
import { tgaNameToCompiledUrl } from "../vob-utils.js";
import { loadCompiledTexAsDataTexture } from "../mesh-utils.js";
import type { CpuSkinningData } from "./cpu-skinning.js";

export async function buildSoftSkinMeshCPU(params: {
  zenKit: ZenKit;
  softSkinMesh: any;
  bindWorld: THREE.Matrix4[];
  textureCache: Map<string, THREE.DataTexture>;
}) {
  const { zenKit, softSkinMesh, bindWorld, textureCache } = params;

  const mrMesh = softSkinMesh.mesh;
  const normals_raw = mrMesh.normals;
  const subMeshes = mrMesh.subMeshes;
  const weights = softSkinMesh.weights;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const vertexWeights: any[] = [];
  const materials: Array<{ texture: string }> = [];

  let currentMatIndex = 0;
  const triGroups: Array<{ start: number; count: number; matIndex: number }> = [];
  let triCount = 0;

  for (let subMeshIdx = 0; subMeshIdx < subMeshes.size(); subMeshIdx++) {
    const subMesh = subMeshes.get(subMeshIdx);
    const groupStart = triCount;

    materials.push({ texture: subMesh.mat.texture || "" });

    const triangles = subMesh.triangles;
    const wedges = subMesh.wedges;

    for (let triIdx = 0; triIdx < triangles.size(); triIdx++) {
      const triangle = triangles.get(triIdx);

      for (let i = 0; i < 3; i++) {
        const wedgeIdx = triangle.getWedge(i);
        const wedge = wedges.get(wedgeIdx);
        const vertIdx = wedge.index;

        const vertWeights = weights.get(vertIdx);
        const weightArray: any[] = [];

        const bindPos = new THREE.Vector3(0, 0, 0);
        const bindNorm = new THREE.Vector3(0, 0, 0);
        const baseNormalOS = normals_raw.get(vertIdx);

        for (let j = 0; j < vertWeights.size(); j++) {
          const w = vertWeights.get(j);
          if (w.weight > 0.0001) {
            const boneIndex = w.nodeIndex;
            const bindMatrix = bindWorld[boneIndex] || new THREE.Matrix4();

            const posOS = new THREE.Vector3(w.position.x, w.position.y, w.position.z);
            const posBind = posOS.clone().applyMatrix4(bindMatrix);
            bindPos.addScaledVector(posBind, w.weight);

            const mat3 = new THREE.Matrix3().setFromMatrix4(bindMatrix);
            const nBind = new THREE.Vector3(baseNormalOS.x, baseNormalOS.y, baseNormalOS.z).applyMatrix3(mat3);
            bindNorm.addScaledVector(nBind, w.weight);

            weightArray.push({
              boneIndex,
              weight: w.weight,
              position: { x: w.position.x, y: w.position.y, z: w.position.z },
              normal: { x: baseNormalOS.x, y: baseNormalOS.y, z: baseNormalOS.z },
            });
          }
        }

        positions.push(bindPos.x, bindPos.y, bindPos.z);
        normals.push(bindNorm.x, bindNorm.y, bindNorm.z);
        uvs.push(wedge.texture.x, wedge.texture.y);
        vertexWeights.push(weightArray);
      }

      triCount++;
    }

    triGroups.push({
      start: groupStart * 3,
      count: (triCount - groupStart) * 3,
      matIndex: currentMatIndex,
    });
    currentMatIndex++;
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(positions), 3);
  const normalAttr = new THREE.BufferAttribute(new Float32Array(normals), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  normalAttr.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute("position", posAttr);
  geometry.setAttribute("normal", normalAttr);
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));

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
      const url = tgaNameToCompiledUrl(textureName);
      if (url) {
        let tex = textureCache.get(url);
        if (!tex) {
          const loaded = await loadCompiledTexAsDataTexture(url, zenKit);
          if (loaded) {
            tex = loaded;
            textureCache.set(url, tex);
          }
        }
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

  const skinningData: CpuSkinningData = {
    geometry,
    vertexWeights,
    basePositions: new Float32Array(positions),
    baseNormals: new Float32Array(normals),
  };

  return { mesh, skinningData };
}

