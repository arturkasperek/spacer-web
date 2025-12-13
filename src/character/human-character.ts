import * as THREE from "three";
import type { ZenKit } from "@kolarz3/zenkit";
import type { BinaryCache } from "./binary-cache.js";
import type { AnimationCache } from "./animation.js";
import { fetchBinaryCached } from "./binary-cache.js";
import { loadAnimationSequence, evaluatePose } from "./animation.js";
import { buildSkeletonFromHierarchy } from "./skeleton.js";
import { applyCpuSkinning, type CpuSkinningData } from "./cpu-skinning.js";
import { buildSoftSkinMeshCPU } from "./soft-skin.js";
import { findHeadBoneIndex, loadHeadMesh } from "./head.js";
import { disposeObject3D } from "../distance-streaming.js";

export type CharacterCaches = {
  binary: BinaryCache;
  textures: Map<string, THREE.DataTexture>;
  materials: Map<string, THREE.Material>;
  animations: AnimationCache;
};

export type CharacterInstance = {
  object: THREE.Group;
  update: (deltaSeconds: number) => void;
  dispose: () => void;
};

export async function createHumanCharacterInstance(params: {
  zenKit: ZenKit;
  caches: CharacterCaches;
  parent: THREE.Object3D;
  animationName?: string;
  loop?: boolean;
  mirrorX?: boolean;
  align?: "center" | "ground";
  bodyMesh?: string;
  bodyTex?: number;
  skin?: number;
  headMesh?: string;
  headTex?: number;
  teethTex?: number;
  armorInst?: number;
}): Promise<CharacterInstance | null> {
  const {
    zenKit,
    caches,
    parent,
    animationName = "S_RUN",
    loop = true,
    mirrorX = true,
    align = "ground",
    bodyMesh,
    bodyTex = 0,
    skin = 0,
    headMesh,
    headTex = 0,
    teethTex = 0,
    armorInst: _armorInst = -1,
  } = params;
  void _armorInst;

  const group = new THREE.Group();
  group.name = "npc-character";
  parent.add(group);

  try {
    const mdhPath = `/ANIMS/_COMPILED/HUMANS.MDH`;
    const normalizedBodyMesh = (bodyMesh || "HUM_BODY_NAKED0").replace(/\.(ASC|MDM|MDH|MDL)$/i, "").toUpperCase();
    if (!normalizedBodyMesh.startsWith("HUM_")) {
      return null;
    }
    const mdmPath = `/ANIMS/_COMPILED/${normalizedBodyMesh}.MDM`;

    const mdhBytes = await fetchBinaryCached(mdhPath, caches.binary);
    const mdmBytes = await fetchBinaryCached(mdmPath, caches.binary);

    const hierarchyLoader = zenKit.createModelHierarchyLoader();
    const mdhLoadResult = hierarchyLoader.loadFromArray(mdhBytes);
    if (!mdhLoadResult || !mdhLoadResult.success) return null;

    const meshLoader = zenKit.createModelMeshLoader();
    const mdmLoadResult = meshLoader.loadFromArray(mdmBytes);
    if (!mdmLoadResult || !mdmLoadResult.success) return null;

    const model = zenKit.createModel();
    model.setHierarchy(hierarchyLoader.getHierarchy());
    model.setMesh(meshLoader.getMesh());

    const hierarchy = model.getHierarchy();
    const skeleton = buildSkeletonFromHierarchy(hierarchy);

    // Add bones to scene graph so attachments (like head) can be parented to them.
    for (const rootIdx of skeleton.rootNodes) {
      group.add(skeleton.bones[rootIdx]);
    }

    const softSkinMeshes = model.getSoftSkinMeshes();
    const softSkinCount = softSkinMeshes ? softSkinMeshes.size() : 0;
    if (softSkinCount === 0) return null;

    const skinningDataList: CpuSkinningData[] = [];

    for (let i = 0; i < softSkinCount; i++) {
      const softSkinMesh = softSkinMeshes.get(i);
      if (!softSkinMesh) continue;

      const { mesh, skinningData } = await buildSoftSkinMeshCPU({
        zenKit,
        softSkinMesh,
        bindWorld: skeleton.bindWorld,
        textureCache: caches.textures,
        textureOverride: (name: string) => {
          const upper = (name || "").toUpperCase();
          if (!upper.includes("BODY")) return name;
          return upper
            .replace(/_V\d+/g, `_V${bodyTex}`)
            .replace(/_C\d+/g, `_C${skin}`);
        },
      });

      mesh.userData.cpuSkinningData = skinningData;
      skinningDataList.push(skinningData);
      group.add(mesh);
    }

    // Try to load and attach head mesh (MMB) to the head bone
    const nodeNames = skeleton.nodes.map(n => n.name);
    const headNodeIndex = findHeadBoneIndex(nodeNames);
    const requestedHeadName = headMesh ? headMesh.trim() : '';
    if (headNodeIndex >= 0 && headNodeIndex < skeleton.bones.length) {
      const headMesh = await loadHeadMesh({
        zenKit,
        binaryCache: caches.binary,
        textureCache: caches.textures,
        materialCache: caches.materials,
        headNames: requestedHeadName ? [requestedHeadName] : undefined,
        headTex,
        skin,
        teethTex,
      });
      if (headMesh) {
        skeleton.bones[headNodeIndex].add(headMesh);
      }
    } else {
      const headMeshObj = await loadHeadMesh({
        zenKit,
        binaryCache: caches.binary,
        textureCache: caches.textures,
        materialCache: caches.materials,
        headNames: requestedHeadName ? [requestedHeadName] : undefined,
        headTex,
        skin,
        teethTex,
      });
      if (headMeshObj) {
        group.add(headMeshObj);
      }
    }

    if (mirrorX) {
      group.scale.x = -Math.abs(group.scale.x || 1);
    }

    // IMPORTANT: Box3.setFromObject() operates in world space. Since `group` is already parented
    // (e.g. under an NPC positioned in the world), we must convert the computed world offset back
    // to this group's local space before applying it, otherwise the character jumps away.
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const offsetWorld =
      align === "ground"
        ? new THREE.Vector3(center.x, box.min.y, center.z)
        : center.clone();
    const offsetLocal = group.worldToLocal(offsetWorld.clone());
    group.position.sub(offsetLocal);

    const sequence = await loadAnimationSequence(zenKit, caches.binary, caches.animations, "HUMANS", animationName);
    let currentTimeMs = 0;

    const update = (deltaSeconds: number) => {
      if (!sequence) return;
      currentTimeMs += deltaSeconds * 1000;

      const ok = evaluatePose(skeleton, sequence, currentTimeMs, loop);
      if (!ok) return;

      for (let i = 0; i < skinningDataList.length; i++) {
        applyCpuSkinning(skeleton.animWorld, skinningDataList[i]);
      }
    };

    const dispose = () => {
      parent.remove(group);
      disposeObject3D(group);
    };

    return { object: group, update, dispose };
  } catch (error) {
    console.warn("Failed to create human character instance:", error);
    parent.remove(group);
    disposeObject3D(group);
    return null;
  }
}
