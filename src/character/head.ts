import * as THREE from "three";
import type { ZenKit } from "@kolarz3/zenkit";
import { buildThreeJSGeometry, buildMaterialGroups, createMeshMaterial } from "../mesh-utils.js";
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
  headTex?: number;
  skin?: number;
  teethTex?: number;
}): Promise<THREE.Mesh | null> {
  const { zenKit, binaryCache, textureCache, materialCache } = params;
  const headNames =
    params.headNames && params.headNames.length ? params.headNames : DEFAULT_MALE_HEADS;
  const headTex = params.headTex ?? 0;
  const skin = params.skin ?? 0;
  const teethTex = params.teethTex ?? 0;

  for (const headName of headNames) {
    const normalized = headName
      .trim()
      .replace(/\.(MMS|MMB)$/i, "")
      .replace(/\.+$/, "")
      .toUpperCase();
    if (!normalized) continue;
    const path = `/ANIMS/_COMPILED/${normalized}.MMB`;
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

    const geometry = buildThreeJSGeometry(processed as any);
    buildMaterialGroups(geometry, processed as any);

    const matCount = processed.materials.size();
    const materials: THREE.MeshBasicMaterial[] = [];

    const applyVarAndColor = (name: string, v: number, c?: number) => {
      const base = (name || "").replace(/\.[^.]*$/, "").toUpperCase();
      const withV = base.replace(/_V\d+/g, `_V${v}`);
      const withC = c === undefined ? withV : withV.replace(/_C\d+/g, `_C${c}`);
      return withC;
    };

    for (let mi = 0; mi < matCount; mi++) {
      const mat = processed.materials.get(mi);
      const originalTex = mat?.texture || "";
      const upper = originalTex.toUpperCase();

      let overridden = originalTex;
      if (upper.includes("HEAD")) {
        overridden = applyVarAndColor(originalTex, headTex, skin);
      } else if (upper.includes("TEETH")) {
        overridden = applyVarAndColor(originalTex, teethTex);
      }

      const material = await createMeshMaterial(
        { texture: overridden },
        zenKit,
        textureCache,
        materialCache,
      );
      materials.push(material);
    }

    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = normalized;
    mesh.frustumCulled = false;
    return mesh;
  }

  return null;
}
