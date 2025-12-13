import * as THREE from "three";
import type { ZenKit } from "@kolarz3/zenkit";
import { buildThreeJSGeometryAndMaterials } from "../mesh-utils.js";
import type { BinaryCache } from "./binary-cache.js";
import { fetchBinaryCached } from "./binary-cache.js";

export const DEFAULT_MALE_HEADS = [
  "HUM_HEAD_BALD",
  "HUM_HEAD_FATBALD",
  "HUM_HEAD_FIGHTER",
  "HUM_HEAD_PONY",
  "HUM_HEAD_PSIONIC",
  "HUM_HEAD_THIEF",
];

export function findHeadBoneIndex(nodeNames: string[]): number {
  for (let i = 0; i < nodeNames.length; i++) {
    const name = nodeNames[i] || "";
    const upper = name.toUpperCase();
    if (upper === "BIP01 HEAD" || upper.includes("HEAD")) {
      return i;
    }
  }
  return -1;
}

export async function loadHeadMesh(params: {
  zenKit: ZenKit;
  binaryCache: BinaryCache;
  textureCache: Map<string, THREE.DataTexture>;
  materialCache: Map<string, THREE.Material>;
  headNames?: string[];
}): Promise<THREE.Mesh | null> {
  const { zenKit, binaryCache, textureCache, materialCache } = params;
  const headNames = params.headNames && params.headNames.length ? params.headNames : DEFAULT_MALE_HEADS;

  for (const headName of headNames) {
    const path = `/ANIMS/_COMPILED/${headName}.MMB`;
    let bytes: Uint8Array;
    try {
      bytes = await fetchBinaryCached(path, binaryCache);
    } catch {
      continue;
    }

    const morphMesh = zenKit.createMorphMesh();
    const loadResult = morphMesh.loadFromArray(bytes);
    if (!loadResult || !loadResult.success) continue;

    const processed = morphMesh.convertToProcessedMesh();
    if (!processed || processed.indices.size() === 0 || processed.vertices.size() === 0) continue;

    const { geometry, materials } = await buildThreeJSGeometryAndMaterials(
      processed as any,
      zenKit,
      textureCache,
      materialCache
    );

    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = headName;
    mesh.frustumCulled = false;
    return mesh;
  }

  return null;
}

