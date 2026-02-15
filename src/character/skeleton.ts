import * as THREE from "three";

export type SkeletonNode = {
  parent: number;
  name: string;
  transform: any;
};

export type Skeleton = {
  nodes: SkeletonNode[];
  rootNodes: number[];
  bones: THREE.Bone[];
  rootTr: { x: number; y: number; z: number };
  bindLocal: THREE.Matrix4[];
  bindWorld: THREE.Matrix4[];
  animWorld: THREE.Matrix4[];
};

function matrix4x4DataToMatrix4(mat4Data: any) {
  const m = new THREE.Matrix4();
  const te = m.elements;
  for (let i = 0; i < 16; i++) {
    te[i] = mat4Data.get(i);
  }
  return m;
}

export function buildSkeletonFromHierarchy(hierarchy: any): Skeleton {
  const nodeCount = hierarchy.nodes.size();
  const rt = hierarchy.rootTranslation;
  const rootTr = { x: rt.x, y: rt.y, z: rt.z };

  const nodes: SkeletonNode[] = [];
  const rootNodes: number[] = [];
  const bones: THREE.Bone[] = [];
  const bindLocal: THREE.Matrix4[] = [];
  const bindWorld: THREE.Matrix4[] = [];

  for (let i = 0; i < nodeCount; i++) {
    const node = hierarchy.nodes.get(i);
    const parentIdx = node.parentIndex;

    const bone = new THREE.Bone();
    bone.name = node.name;
    bones.push(bone);

    nodes.push({
      parent: parentIdx === -1 ? -1 : parentIdx,
      transform: node.getTransform(),
      name: node.name,
    });
  }

  for (let i = 0; i < nodes.length; i++) {
    const parentIdx = nodes[i].parent;
    if (parentIdx === -1) {
      rootNodes.push(i);
    } else {
      bones[parentIdx].add(bones[i]);
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const bone = bones[i];
    const mat = matrix4x4DataToMatrix4(node.transform);

    if (node.parent === -1) {
      mat.elements[12] += rootTr.x;
      mat.elements[13] += rootTr.y;
      mat.elements[14] += rootTr.z;
    }

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mat.decompose(pos, quat, scale);
    bone.position.copy(pos);
    bone.quaternion.copy(quat);
    bone.scale.copy(scale);

    bindLocal[i] = mat.clone();
  }

  for (let i = 0; i < nodes.length; i++) {
    const parentIdx = nodes[i].parent;
    if (parentIdx >= 0) {
      bindWorld[i] = new THREE.Matrix4().multiplyMatrices(bindWorld[parentIdx], bindLocal[i]);
    } else {
      bindWorld[i] = bindLocal[i].clone();
    }
  }

  const animWorld = bindWorld.map((m) => m.clone());

  return { nodes, rootNodes, bones, rootTr, bindLocal, bindWorld, animWorld };
}
