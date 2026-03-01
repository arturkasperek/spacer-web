import * as THREE from "three";
import type { ZenKit } from "@kolarz3/zenkit";
import { fetchBinaryCached } from "./binary-cache";
import { buildSkeletonFromHierarchy } from "./skeleton";
import { buildSoftSkinMeshCPU } from "./soft-skin";
import type { CharacterCaches } from "./character-instance";
import type { CpuSkinningData } from "./cpu-skinning";
import { buildThreeJSGeometryAndMaterials } from "../shared/mesh-utils";

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
  skinningDataList: CpuSkinningData[];
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

  const mdhBytes = await fetchBinaryCached(mdhPath, caches.binary);
  const mdmBytes = await fetchBinaryCached(mdmPath, caches.binary);

  const hierarchyLoader = zenKit.createModelHierarchyLoader();
  const mdhLoadResult = hierarchyLoader.loadFromArray(mdhBytes);
  if (!mdhLoadResult || !mdhLoadResult.success) return null;

  const meshLoader = zenKit.createModelMeshLoader();
  const mdmLoadResult = meshLoader.loadFromArray(mdmBytes);
  if (!mdmLoadResult || !mdmLoadResult.success) return null;

  const zModel = zenKit.createModel();
  zModel.setHierarchy(hierarchyLoader.getHierarchy());
  zModel.setMesh(meshLoader.getMesh());

  const hierarchy = zModel.getHierarchy();
  const skeleton = buildSkeletonFromHierarchy(hierarchy);

  for (const rootIdx of skeleton.rootNodes) {
    group.add(skeleton.bones[rootIdx]);
  }

  const softSkinMeshes = zModel.getSoftSkinMeshes();
  const softSkinCount = softSkinMeshes ? softSkinMeshes.size() : 0;

  const skinningDataList: CpuSkinningData[] = [];
  const attachmentNames = zModel.getAttachmentNames?.();
  const attachmentCount = attachmentNames && attachmentNames.size ? attachmentNames.size() : 0;
  let renderableMeshCount = 0;

  for (let i = 0; i < softSkinCount; i++) {
    const softSkinMesh = softSkinMeshes.get(i);
    if (!softSkinMesh) continue;

    const { mesh: threeMesh, skinningData } = await buildSoftSkinMeshCPU({
      zenKit,
      softSkinMesh,
      bindWorld: skeleton.bindWorld,
      textureCache: caches.textures,
      textureOverride: (name: string) => {
        const upper = (name || "").toUpperCase();
        if (!upper.includes("BODY")) return name;
        return upper.replace(/_V\d+/g, `_V${bodyTex}`).replace(/_C\d+/g, `_C${skin}`);
      },
    });

    skinningDataList.push(skinningData);
    group.add(threeMesh);
    renderableMeshCount++;
  }

  for (let i = 0; i < attachmentCount; i++) {
    const attachmentName = attachmentNames.get(i);
    const attachment = zModel.getAttachment?.(attachmentName);
    if (!attachment) continue;

    const processed = zModel.convertAttachmentToProcessedMesh?.(attachment);
    if (!processed || processed.indices.size() === 0 || processed.vertices.size() === 0) {
      continue;
    }

    const { geometry, materials } = await buildThreeJSGeometryAndMaterials(
      processed,
      zenKit,
      caches.textures,
      caches.materials,
    );
    const attachmentMesh = new THREE.Mesh(geometry, materials);

    let hierarchyNodeIndex = -1;
    const nodes = hierarchy.nodes as any;
    const nodeCount = nodes?.size ? nodes.size() : (nodes?.length ?? 0);
    for (let j = 0; j < nodeCount; j++) {
      const node = nodes.get ? nodes.get(j) : nodes[j];
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
    skinningDataList,
  };
}
