/// <reference lib="webworker" />

import ZenKitModuleFactory from "@kolarz3/zenkit";

type SerializedMaterialData = {
  texture: string;
  name?: string;
  disableCollision?: boolean;
  alphaFunc?: number;
  colorA?: number;
};

type SerializedProcessedMeshData = {
  vertices: ArrayBuffer;
  indices: ArrayBuffer;
  materialIds: ArrayBuffer;
  materials: SerializedMaterialData[];
};

type SerializedHierarchyNode = {
  name: string;
  parentIndex: number;
  transform: number[];
};

type SerializedModelRenderData = {
  rootTranslation: { x: number; y: number; z: number };
  hierarchyNodes: SerializedHierarchyNode[];
  attachments: Array<{ name: string; processed: SerializedProcessedMeshData }>;
  softSkins: SerializedProcessedMeshData[];
};

type SerializedSoftSkinCpuBundle = {
  materials: Array<{ texture: string }>;
  groups: Array<{ start: number; count: number; matIndex: number }>;
  uvs: ArrayBuffer;
  skinIndex: ArrayBuffer;
  skinWeight: ArrayBuffer;
  infPos: ArrayBuffer;
  infNorm: ArrayBuffer;
  vertexCount: number;
};

type SerializedCharacterModelBundle = {
  rootTranslation: { x: number; y: number; z: number };
  hierarchyNodes: SerializedHierarchyNode[];
  attachments: Array<{ name: string; processed: SerializedProcessedMeshData }>;
  softSkins: SerializedSoftSkinCpuBundle[];
};

type SerializedAnimationSample = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
};

type WorkerRequest =
  | { id: number; type: "loadMesh"; path: string }
  | { id: number; type: "loadMorph"; path: string }
  | { id: number; type: "loadModel"; path: string }
  | { id: number; type: "loadCharacterModel"; modelPath: string; meshPath: string }
  | { id: number; type: "loadAnimation"; path: string };

type WorkerResponse =
  | { id: number; ok: true; type: "loadMesh"; mesh: SerializedProcessedMeshData }
  | {
      id: number;
      ok: true;
      type: "loadMorph";
      mesh: SerializedProcessedMeshData;
      animations: string[];
    }
  | {
      id: number;
      ok: true;
      type: "loadModel";
      model: SerializedModelRenderData;
    }
  | {
      id: number;
      ok: true;
      type: "loadCharacterModel";
      character: SerializedCharacterModelBundle;
    }
  | {
      id: number;
      ok: true;
      type: "loadAnimation";
      animation: {
        numFrames: number;
        fpsRate: number;
        nodeIndex: number[];
        samples: SerializedAnimationSample[];
      };
    }
  | { id: number; ok: false; type: WorkerRequest["type"]; error: string; missing?: boolean };

let zenKitPromise: Promise<any> | null = null;

async function getZenKit(): Promise<any> {
  if (!zenKitPromise) {
    zenKitPromise = (ZenKitModuleFactory as unknown as () => Promise<any>)();
  }
  return zenKitPromise;
}

function toNumberArray(listLike: { size: () => number; get: (i: number) => number }): number[] {
  const out: number[] = [];
  const n = listLike.size();
  for (let i = 0; i < n; i++) out.push(Number(listLike.get(i)) || 0);
  return out;
}

function serializeMaterial(mat: any): SerializedMaterialData {
  return {
    texture: String(mat?.texture || ""),
    name: mat?.name ? String(mat.name) : undefined,
    disableCollision: Boolean(mat?.disableCollision),
    alphaFunc: Number(mat?.alphaFunc ?? 0),
    colorA: Number(mat?.colorA ?? 255),
  };
}

function serializeProcessedMeshData(processed: any): SerializedProcessedMeshData {
  const vertices = new Float32Array(toNumberArray(processed.vertices));
  const indices = new Uint32Array(toNumberArray(processed.indices));
  const materialIds = new Int32Array(toNumberArray(processed.materialIds));

  const materials: SerializedMaterialData[] = [];
  const matCount = processed.materials.size();
  for (let i = 0; i < matCount; i++) {
    materials.push(serializeMaterial(processed.materials.get(i)));
  }

  return {
    vertices: vertices.buffer.slice(0),
    indices: indices.buffer.slice(0),
    materialIds: materialIds.buffer.slice(0),
    materials,
  };
}

function isMissingResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") || "";
  return !response.ok || contentType.includes("text/html");
}

async function loadMesh(path: string): Promise<WorkerResponse> {
  try {
    const zenKit = await getZenKit();
    const response = await fetch(path);
    if (!response.ok) {
      return {
        id: -1,
        ok: false,
        type: "loadMesh",
        error: `HTTP ${response.status}`,
        missing: true,
      };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const vobMesh = zenKit.createMesh();
    const isMRM = path.toUpperCase().endsWith(".MRM");
    const loadResult = isMRM ? vobMesh.loadMRMFromArray(bytes) : vobMesh.loadFromArray(bytes);
    if (!loadResult || !loadResult.success) {
      return { id: -1, ok: false, type: "loadMesh", error: "mesh-load-failed", missing: true };
    }

    const meshData = vobMesh.getMeshData();
    const processed = meshData.getProcessedMeshData();
    if (processed.indices.size() === 0 || processed.vertices.size() === 0) {
      return { id: -1, ok: false, type: "loadMesh", error: "mesh-empty", missing: true };
    }

    return {
      id: -1,
      ok: true,
      type: "loadMesh",
      mesh: serializeProcessedMeshData(processed),
    };
  } catch (error) {
    return { id: -1, ok: false, type: "loadMesh", error: String(error) };
  }
}

async function loadMorph(path: string): Promise<WorkerResponse> {
  try {
    const zenKit = await getZenKit();
    const response = await fetch(path);
    if (!response.ok) {
      return {
        id: -1,
        ok: false,
        type: "loadMorph",
        error: `HTTP ${response.status}`,
        missing: true,
      };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const morphMesh = zenKit.createMorphMesh();
    const loadResult = morphMesh.loadFromArray(bytes);
    if (!loadResult || !loadResult.success || !morphMesh.isLoaded) {
      return { id: -1, ok: false, type: "loadMorph", error: "morph-load-failed", missing: true };
    }

    const processed = morphMesh.convertToProcessedMesh();
    const mesh = serializeProcessedMeshData(processed);
    const animationNames = morphMesh.getAnimationNames();
    const animationCount = animationNames.size();
    const animations: string[] = [];
    for (let i = 0; i < animationCount; i++) animations.push(String(animationNames.get(i) || ""));

    return { id: -1, ok: true, type: "loadMorph", mesh, animations };
  } catch (error) {
    return { id: -1, ok: false, type: "loadMorph", error: String(error) };
  }
}

async function loadModel(path: string): Promise<WorkerResponse> {
  try {
    const zenKit = await getZenKit();

    let model: any = null;
    const mdlResponse = await fetch(path);
    if (!isMissingResponse(mdlResponse)) {
      const mdlBytes = new Uint8Array(await mdlResponse.arrayBuffer());
      const loaded = zenKit.createModel();
      const loadResult = loaded.loadFromArray(mdlBytes);
      if (!loadResult || !loadResult.success) {
        return { id: -1, ok: false, type: "loadModel", error: "mdl-load-failed", missing: true };
      }
      model = loaded;
    } else {
      const basePath = path.replace(/\.MDL$/i, "");
      const mdhPath = `${basePath}.MDH`;
      const mdmPath = `${basePath}.MDM`;
      const [mdhResp, mdmResp] = await Promise.all([fetch(mdhPath), fetch(mdmPath)]);
      if (!mdhResp.ok || !mdmResp.ok) {
        return { id: -1, ok: false, type: "loadModel", error: "mdh-mdm-missing", missing: true };
      }

      const hierarchyLoader = zenKit.createModelHierarchyLoader();
      const mdhLoad = hierarchyLoader.loadFromArray(new Uint8Array(await mdhResp.arrayBuffer()));
      if (!mdhLoad || !mdhLoad.success) {
        return { id: -1, ok: false, type: "loadModel", error: "mdh-load-failed", missing: true };
      }

      const meshLoader = zenKit.createModelMeshLoader();
      const mdmLoad = meshLoader.loadFromArray(new Uint8Array(await mdmResp.arrayBuffer()));
      if (!mdmLoad || !mdmLoad.success) {
        return { id: -1, ok: false, type: "loadModel", error: "mdm-load-failed", missing: true };
      }

      const loaded = zenKit.createModel();
      loaded.setHierarchy(hierarchyLoader.getHierarchy());
      loaded.setMesh(meshLoader.getMesh());
      model = loaded;
    }

    if (!model) {
      return { id: -1, ok: false, type: "loadModel", error: "model-null", missing: true };
    }

    const hierarchy = model.getHierarchy();
    const rootTranslation = hierarchy?.rootTranslation
      ? {
          x: Number(hierarchy.rootTranslation.x) || 0,
          y: Number(hierarchy.rootTranslation.y) || 0,
          z: Number(hierarchy.rootTranslation.z) || 0,
        }
      : { x: 0, y: 0, z: 0 };

    const hierarchyNodes: SerializedHierarchyNode[] = [];
    const nodeCount = hierarchy.nodes.size ? hierarchy.nodes.size() : 0;
    for (let i = 0; i < nodeCount; i++) {
      const node = hierarchy.nodes.get(i);
      const transform = node.getTransform().toArray();
      hierarchyNodes.push({
        name: String(node?.name || ""),
        parentIndex: Number(node?.parentIndex ?? -1),
        transform: Array.from(transform as number[]),
      });
    }

    const attachments: Array<{ name: string; processed: SerializedProcessedMeshData }> = [];
    const attachmentNames = model.getAttachmentNames();
    const attachmentCount = attachmentNames.size();
    for (let i = 0; i < attachmentCount; i++) {
      const name = String(attachmentNames.get(i) || "");
      const attachment = model.getAttachment(name);
      if (!attachment) continue;
      const processed = model.convertAttachmentToProcessedMesh(attachment);
      if (!processed || processed.indices.size() === 0 || processed.vertices.size() === 0) continue;
      attachments.push({ name, processed: serializeProcessedMeshData(processed) });
    }

    const softSkins: SerializedProcessedMeshData[] = [];
    const softSkinMeshes = model.getSoftSkinMeshes?.();
    const softSkinCount = softSkinMeshes ? softSkinMeshes.size() : 0;
    for (let i = 0; i < softSkinCount; i++) {
      const softSkin = softSkinMeshes.get(i);
      if (!softSkin) continue;
      const processed = model.convertSoftSkinMeshToProcessedMesh?.(softSkin);
      if (!processed || processed.indices.size() === 0 || processed.vertices.size() === 0) continue;
      softSkins.push(serializeProcessedMeshData(processed));
    }

    return {
      id: -1,
      ok: true,
      type: "loadModel",
      model: { rootTranslation, hierarchyNodes, attachments, softSkins },
    };
  } catch (error) {
    return { id: -1, ok: false, type: "loadModel", error: String(error) };
  }
}

function serializeSoftSkinForCpu(softSkinMesh: any): SerializedSoftSkinCpuBundle {
  const mrMesh = softSkinMesh.mesh;
  const normalsRaw = mrMesh.normals;
  const subMeshes = mrMesh.subMeshes;
  const packedWeights = softSkinMesh.getPackedWeights4();
  const packedBoneIndices: Uint16Array = packedWeights.boneIndices;
  const packedBoneWeights: Float32Array = packedWeights.boneWeights;
  const packedBonePositions: Float32Array = packedWeights.bonePositions;

  const materials: Array<{ texture: string }> = [];
  const groups: Array<{ start: number; count: number; matIndex: number }> = [];

  let totalVertices = 0;
  for (let subMeshIdx = 0; subMeshIdx < subMeshes.size(); subMeshIdx++) {
    const subMesh = subMeshes.get(subMeshIdx);
    totalVertices += (subMesh?.triangles?.size?.() ?? 0) * 3;
  }

  const uvArray = new Float32Array(totalVertices * 2);
  const skinIndex = new Uint16Array(totalVertices * 4);
  const skinWeight = new Float32Array(totalVertices * 4);
  const infPos = new Float32Array(totalVertices * 12);
  const infNorm = new Float32Array(totalVertices * 12);

  let currentMatIndex = 0;
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

        const normalOS = normalsRaw.get(vertIdx);
        const srcOff4 = vertIdx * 4;
        const srcOff12 = vertIdx * 12;
        const dstOff2 = vertexCursor * 2;
        const dstOff4 = vertexCursor * 4;
        const dstOff12 = vertexCursor * 12;

        uvArray[dstOff2] = wedge.texture.x;
        uvArray[dstOff2 + 1] = wedge.texture.y;

        for (let j = 0; j < 4; j++) {
          const w = packedBoneWeights[srcOff4 + j] ?? 0;
          const boneIndex = packedBoneIndices[srcOff4 + j] ?? 0;
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
        }

        vertexCursor++;
      }
    }

    groups.push({
      start: groupStart,
      count: vertexCursor - groupStart,
      matIndex: currentMatIndex,
    });
    currentMatIndex++;
  }

  return {
    materials,
    groups,
    uvs: uvArray.buffer.slice(0),
    skinIndex: skinIndex.buffer.slice(0),
    skinWeight: skinWeight.buffer.slice(0),
    infPos: infPos.buffer.slice(0),
    infNorm: infNorm.buffer.slice(0),
    vertexCount: totalVertices,
  };
}

async function loadCharacterModel(modelPath: string, meshPath: string): Promise<WorkerResponse> {
  try {
    const zenKit = await getZenKit();
    const [mdhResp, mdmResp] = await Promise.all([fetch(modelPath), fetch(meshPath)]);
    if (!mdhResp.ok || !mdmResp.ok) {
      return {
        id: -1,
        ok: false,
        type: "loadCharacterModel",
        error: "mdh-mdm-missing",
        missing: true,
      };
    }

    const hierarchyLoader = zenKit.createModelHierarchyLoader();
    const mdhLoad = hierarchyLoader.loadFromArray(new Uint8Array(await mdhResp.arrayBuffer()));
    if (!mdhLoad || !mdhLoad.success) {
      return {
        id: -1,
        ok: false,
        type: "loadCharacterModel",
        error: "mdh-load-failed",
        missing: true,
      };
    }

    const meshLoader = zenKit.createModelMeshLoader();
    const mdmLoad = meshLoader.loadFromArray(new Uint8Array(await mdmResp.arrayBuffer()));
    if (!mdmLoad || !mdmLoad.success) {
      return {
        id: -1,
        ok: false,
        type: "loadCharacterModel",
        error: "mdm-load-failed",
        missing: true,
      };
    }

    const model = zenKit.createModel();
    model.setHierarchy(hierarchyLoader.getHierarchy());
    model.setMesh(meshLoader.getMesh());

    const hierarchy = model.getHierarchy();
    const rootTranslation = hierarchy?.rootTranslation
      ? {
          x: Number(hierarchy.rootTranslation.x) || 0,
          y: Number(hierarchy.rootTranslation.y) || 0,
          z: Number(hierarchy.rootTranslation.z) || 0,
        }
      : { x: 0, y: 0, z: 0 };
    const hierarchyNodes: SerializedHierarchyNode[] = [];
    const nodeCount = hierarchy.nodes.size ? hierarchy.nodes.size() : 0;
    for (let i = 0; i < nodeCount; i++) {
      const node = hierarchy.nodes.get(i);
      hierarchyNodes.push({
        name: String(node?.name || ""),
        parentIndex: Number(node?.parentIndex ?? -1),
        transform: Array.from(node.getTransform().toArray() as number[]),
      });
    }

    const attachments: Array<{ name: string; processed: SerializedProcessedMeshData }> = [];
    const attachmentNames = model.getAttachmentNames?.();
    const attachmentCount = attachmentNames && attachmentNames.size ? attachmentNames.size() : 0;
    for (let i = 0; i < attachmentCount; i++) {
      const name = String(attachmentNames.get(i) || "");
      const attachment = model.getAttachment?.(name);
      if (!attachment) continue;
      const processed = model.convertAttachmentToProcessedMesh?.(attachment);
      if (!processed || processed.indices.size() === 0 || processed.vertices.size() === 0) continue;
      attachments.push({ name, processed: serializeProcessedMeshData(processed) });
    }

    const softSkins: SerializedSoftSkinCpuBundle[] = [];
    const softSkinMeshes = model.getSoftSkinMeshes?.();
    const softSkinCount = softSkinMeshes ? softSkinMeshes.size() : 0;
    for (let i = 0; i < softSkinCount; i++) {
      const softSkin = softSkinMeshes.get(i);
      if (!softSkin || typeof softSkin.getPackedWeights4 !== "function") continue;
      softSkins.push(serializeSoftSkinForCpu(softSkin));
    }

    return {
      id: -1,
      ok: true,
      type: "loadCharacterModel",
      character: { rootTranslation, hierarchyNodes, attachments, softSkins },
    };
  } catch (error) {
    return { id: -1, ok: false, type: "loadCharacterModel", error: String(error) };
  }
}

async function loadAnimation(path: string): Promise<WorkerResponse> {
  try {
    const zenKit = await getZenKit();
    const response = await fetch(path);
    if (!response.ok) {
      return {
        id: -1,
        ok: false,
        type: "loadAnimation",
        error: `HTTP ${response.status}`,
        missing: true,
      };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const man = zenKit.createModelAnimation();
    const loadResult = man.loadFromArray(bytes);
    if (!loadResult.success) {
      return { id: -1, ok: false, type: "loadAnimation", error: "man-load-failed", missing: true };
    }
    const numFrames = man.getFrameCount ? man.getFrameCount() : 0;
    const fpsRate = man.getFps ? man.getFps() : 25.0;
    const nodeIdxCount = man.getNodeCount ? man.getNodeCount() : 0;
    if (numFrames <= 0 || fpsRate <= 0 || nodeIdxCount <= 0) {
      return { id: -1, ok: false, type: "loadAnimation", error: "man-empty", missing: true };
    }

    const nodeIndex: number[] = [];
    for (let i = 0; i < nodeIdxCount; i++) nodeIndex.push(man.getNodeIndex(i));

    const samples: SerializedAnimationSample[] = [];
    for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
      for (let nodeIdx = 0; nodeIdx < nodeIdxCount; nodeIdx++) {
        const sample = man.getSample(frameIdx, nodeIdx);
        if (sample && sample.position && sample.rotation) {
          samples.push({
            position: { x: sample.position.x, y: sample.position.y, z: sample.position.z },
            rotation: {
              x: sample.rotation.x,
              y: sample.rotation.y,
              z: sample.rotation.z,
              w: sample.rotation.w,
            },
          });
        } else {
          samples.push({
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
          });
        }
      }
    }

    return {
      id: -1,
      ok: true,
      type: "loadAnimation",
      animation: { numFrames, fpsRate, nodeIndex, samples },
    };
  } catch (error) {
    return { id: -1, ok: false, type: "loadAnimation", error: String(error) };
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (!req) return;
  let response: WorkerResponse;
  switch (req.type) {
    case "loadMesh":
      response = await loadMesh(req.path);
      break;
    case "loadMorph":
      response = await loadMorph(req.path);
      break;
    case "loadModel":
      response = await loadModel(req.path);
      break;
    case "loadCharacterModel":
      response = await loadCharacterModel(req.modelPath, req.meshPath);
      break;
    case "loadAnimation":
      response = await loadAnimation(req.path);
      break;
  }

  const withId = { ...response, id: req.id } as WorkerResponse;
  if (!withId.ok) {
    self.postMessage(withId);
    return;
  }

  if (withId.type === "loadMesh") {
    self.postMessage(withId, [withId.mesh.vertices, withId.mesh.indices, withId.mesh.materialIds]);
    return;
  }

  if (withId.type === "loadMorph") {
    self.postMessage(withId, [withId.mesh.vertices, withId.mesh.indices, withId.mesh.materialIds]);
    return;
  }

  if (withId.type === "loadCharacterModel") {
    const transfer: Transferable[] = [];
    for (const a of withId.character.attachments) {
      transfer.push(a.processed.vertices, a.processed.indices, a.processed.materialIds);
    }
    for (const s of withId.character.softSkins) {
      transfer.push(s.uvs, s.skinIndex, s.skinWeight, s.infPos, s.infNorm);
    }
    self.postMessage(withId, transfer);
    return;
  }

  if (withId.type === "loadAnimation") {
    self.postMessage(withId);
    return;
  }

  const transfer: Transferable[] = [];
  for (const a of withId.model.attachments) {
    transfer.push(a.processed.vertices, a.processed.indices, a.processed.materialIds);
  }
  for (const s of withId.model.softSkins) {
    transfer.push(s.vertices, s.indices, s.materialIds);
  }
  self.postMessage(withId, transfer);
};

export {};
