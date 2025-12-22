import * as THREE from "three";

type BvhLib = {
  MeshBVH: any;
  acceleratedRaycast: any;
};

let bvhLibPromise: Promise<BvhLib> | null = null;

async function getBvhLib(): Promise<BvhLib> {
  if (!bvhLibPromise) {
    bvhLibPromise = import("three-mesh-bvh").then((mod: any) => ({
      MeshBVH: mod.MeshBVH,
      acceleratedRaycast: mod.acceleratedRaycast,
    }));
  }
  return bvhLibPromise;
}

function ensureIndexedGeometry(geometry: THREE.BufferGeometry) {
  if (geometry.index) return;
  const position = geometry.getAttribute("position");
  if (!position) return;

  const count = position.count;
  const ArrayType = count > 65535 ? Uint32Array : Uint16Array;
  const indices = new ArrayType(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
}

export async function ensureMeshHasBVH(
  mesh: THREE.Mesh,
  options?: { maxLeafTris?: number }
): Promise<boolean> {
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!geometry) return false;

  try {
    const { MeshBVH, acceleratedRaycast } = await getBvhLib();
    if (!MeshBVH || !acceleratedRaycast) return false;

    ensureIndexedGeometry(geometry);

    if (!(geometry as any).boundsTree) {
      (geometry as any).boundsTree = new MeshBVH(geometry, { maxLeafTris: options?.maxLeafTris ?? 3 });
    }

    (mesh as any).raycast = acceleratedRaycast;
    return true;
  } catch {
    return false;
  }
}

