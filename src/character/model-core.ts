import * as THREE from "three";
import type { ZenKit } from "@kolarz3/zenkit";
import { buildSkeletonFromHierarchy } from "./skeleton";
import { buildSoftSkinSkinnedMeshFromBundle } from "./soft-skin";
import type { CharacterCaches } from "./character-instance";

export function normalizeModelAssetKey(input: string | undefined): string {
  return (input || "")
    .trim()
    .replace(/\.(ASC|MDM|MDH|MDL|MDS|MSB|MMS|MMB)$/i, "")
    .replace(/\.+$/, "")
    .toUpperCase();
}

export type BuiltModelCore = {
  root: THREE.Group;
  group: THREE.Group;
  skeleton: ReturnType<typeof buildSkeletonFromHierarchy>;
};

export async function buildNpcModelCore(params: {
  zenKit: ZenKit;
  caches: CharacterCaches;
  parent: THREE.Object3D;
  modelKey: string;
  meshKey: string;
  bodyTex: number;
  skin: number;
}): Promise<BuiltModelCore | null> {
  const { zenKit, caches, parent, modelKey, meshKey, bodyTex, skin } = params;

  const model = normalizeModelAssetKey(modelKey);
  const mesh = normalizeModelAssetKey(meshKey);
  if (!model || !mesh) return null;

  const root = new THREE.Group();
  root.name = "npc-character";
  parent.add(root);

  const group = new THREE.Group();
  group.name = "npc-character-model";
  root.add(group);

  const mdhPath = `/ANIMS/_COMPILED/${model}.MDH`;
  const mdmPath = `/ANIMS/_COMPILED/${mesh}.MDM`;
  const characterModel = await caches.assetManager.loadCharacterModel(mdhPath, mdmPath);
  if (!characterModel) return null;
  const hierarchy: any = {
    rootTranslation: characterModel.rootTranslation,
    nodes: {
      size: () => characterModel.hierarchyNodes.length,
      get: (i: number) => {
        const node = characterModel.hierarchyNodes[i];
        return {
          name: node.name,
          parentIndex: node.parentIndex,
          getTransform: () => ({
            get: (idx: number) => Number(node.transform[idx] ?? 0),
            toArray: () => node.transform,
          }),
        };
      },
    },
  };
  const skeleton = buildSkeletonFromHierarchy(hierarchy);

  for (const rootIdx of skeleton.rootNodes) {
    group.add(skeleton.bones[rootIdx]);
  }
  for (const rootIdx of skeleton.rootNodes) {
    skeleton.bones[rootIdx].updateMatrixWorld(true);
  }

  const softSkinCount = characterModel.softSkins.length;
  const boneInverses = skeleton.bindWorld.map((m) => m.clone().invert());
  const threeSkeleton = new THREE.Skeleton(skeleton.bones, boneInverses);
  const attachmentCount = characterModel.attachments.length;
  let renderableMeshCount = 0;

  for (let i = 0; i < softSkinCount; i++) {
    const softSkinBundle = characterModel.softSkins[i];
    const threeMesh = await buildSoftSkinSkinnedMeshFromBundle({
      zenKit,
      bundle: softSkinBundle,
      bindWorld: skeleton.bindWorld,
      threeSkeleton,
      assetManager: caches.assetManager,
      textureOverride: (name: string) => {
        const upper = (name || "").toUpperCase();
        if (!upper.includes("BODY")) return name;
        return upper.replace(/_V\d+/g, `_V${bodyTex}`).replace(/_C\d+/g, `_C${skin}`);
      },
    });

    group.add(threeMesh);
    renderableMeshCount++;
  }

  for (let i = 0; i < attachmentCount; i++) {
    const attachmentData = characterModel.attachments[i];
    const attachmentName = attachmentData.name;
    const processed = attachmentData.processed;
    if (!processed || processed.indices.size() === 0 || processed.vertices.size() === 0) {
      continue;
    }

    const { geometry, materials } = await caches.assetManager.buildGeometryAndMaterials(
      processed,
      zenKit,
    );
    const attachmentMesh = new THREE.Mesh(geometry, materials);

    let hierarchyNodeIndex = -1;
    const nodeCount = characterModel.hierarchyNodes.length;
    for (let j = 0; j < nodeCount; j++) {
      const node = characterModel.hierarchyNodes[j];
      if (node && node.name === attachmentName) {
        hierarchyNodeIndex = j;
        break;
      }
    }

    if (hierarchyNodeIndex >= 0 && skeleton.bones[hierarchyNodeIndex]) {
      skeleton.bones[hierarchyNodeIndex].add(attachmentMesh);
    } else {
      group.add(attachmentMesh);
    }
    renderableMeshCount++;
  }

  // Some models are attachment-only (no soft-skin), so this check must use
  // both sources instead of soft-skin count alone.
  if (renderableMeshCount === 0) {
    return null;
  }

  return {
    root,
    group,
    skeleton,
  };
}
