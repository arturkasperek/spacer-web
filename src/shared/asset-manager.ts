import type { ZenKit, ProcessedMeshData } from "@kolarz3/zenkit";
import * as THREE from "three";
import type { AnimationSequence } from "../character/animation";
import { buildThreeJSGeometryAndMaterials, createDataTextureFromRgba } from "./mesh-utils";

type SerializedMaterialData = {
  texture: string;
  name?: string;
  disableCollision?: boolean;
  alphaFunc?: number;
  colorA?: number;
};

type SerializedProcessedMeshData = {
  vertices: Float32Array;
  indices: Uint32Array;
  materialIds: Int32Array;
  materials: SerializedMaterialData[];
};

export type LoadedModelRenderData = {
  rootTranslation: { x: number; y: number; z: number };
  hierarchyNodes: Array<{
    name: string;
    parentIndex: number;
    transform: number[];
  }>;
  attachments: Array<{
    name: string;
    processed: ProcessedMeshData;
  }>;
  softSkins: ProcessedMeshData[];
};

export type LoadedCharacterModelData = {
  rootTranslation: { x: number; y: number; z: number };
  hierarchyNodes: Array<{
    name: string;
    parentIndex: number;
    transform: number[];
  }>;
  attachments: Array<{
    name: string;
    processed: ProcessedMeshData;
  }>;
  softSkins: Array<{
    materials: Array<{ texture: string }>;
    groups: Array<{ start: number; count: number; matIndex: number }>;
    uvs: Float32Array;
    skinIndex: Uint16Array;
    skinWeight: Float32Array;
    infPos: Float32Array;
    infNorm: Float32Array;
    vertexCount: number;
  }>;
};

export type LoadedAnimationData = {
  numFrames: number;
  fpsRate: number;
  nodeIndex: number[];
  samples: Array<{
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
  }>;
};

type MorphCacheEntry = {
  processed: ProcessedMeshData;
  animations: string[];
};

type DecodeTexWorkerResponse =
  | {
      id: number;
      ok: true;
      width: number;
      height: number;
      rgba: ArrayBuffer;
      hasAlpha: boolean;
      resolvedUrl: string;
    }
  | {
      id: number;
      ok: false;
      error?: string;
    };

type AssetWorkerRequest =
  | {
      id: number;
      type: "loadMesh";
      path: string;
    }
  | {
      id: number;
      type: "loadMorph";
      path: string;
    }
  | {
      id: number;
      type: "loadModel";
      path: string;
    }
  | {
      id: number;
      type: "loadCharacterModel";
      modelPath: string;
      meshPath: string;
    }
  | {
      id: number;
      type: "loadAnimation";
      path: string;
    };

type AssetWorkerResponse =
  | {
      id: number;
      ok: true;
      type: "loadMesh";
      mesh: {
        vertices: ArrayBuffer;
        indices: ArrayBuffer;
        materialIds: ArrayBuffer;
        materials: SerializedMaterialData[];
      };
    }
  | {
      id: number;
      ok: true;
      type: "loadMorph";
      mesh: {
        vertices: ArrayBuffer;
        indices: ArrayBuffer;
        materialIds: ArrayBuffer;
        materials: SerializedMaterialData[];
      };
      animations: string[];
    }
  | {
      id: number;
      ok: true;
      type: "loadModel";
      model: {
        rootTranslation: { x: number; y: number; z: number };
        hierarchyNodes: Array<{
          name: string;
          parentIndex: number;
          transform: number[];
        }>;
        attachments: Array<{
          name: string;
          processed: {
            vertices: ArrayBuffer;
            indices: ArrayBuffer;
            materialIds: ArrayBuffer;
            materials: SerializedMaterialData[];
          };
        }>;
        softSkins: Array<{
          vertices: ArrayBuffer;
          indices: ArrayBuffer;
          materialIds: ArrayBuffer;
          materials: SerializedMaterialData[];
        }>;
      };
    }
  | {
      id: number;
      ok: true;
      type: "loadCharacterModel";
      character: {
        rootTranslation: { x: number; y: number; z: number };
        hierarchyNodes: Array<{
          name: string;
          parentIndex: number;
          transform: number[];
        }>;
        attachments: Array<{
          name: string;
          processed: {
            vertices: ArrayBuffer;
            indices: ArrayBuffer;
            materialIds: ArrayBuffer;
            materials: SerializedMaterialData[];
          };
        }>;
        softSkins: Array<{
          materials: Array<{ texture: string }>;
          groups: Array<{ start: number; count: number; matIndex: number }>;
          uvs: ArrayBuffer;
          skinIndex: ArrayBuffer;
          skinWeight: ArrayBuffer;
          infPos: ArrayBuffer;
          infNorm: ArrayBuffer;
          vertexCount: number;
        }>;
      };
    }
  | {
      id: number;
      ok: true;
      type: "loadAnimation";
      animation: LoadedAnimationData;
    }
  | {
      id: number;
      ok: false;
      type: "loadMesh" | "loadMorph" | "loadModel" | "loadCharacterModel" | "loadAnimation";
      error: string;
      missing?: boolean;
    };

let texDecodeWorker: Worker | null = null;
let texDecodeReqId = 0;
const texDecodePending = new Map<
  number,
  {
    resolve: (value: DecodeTexWorkerResponse) => void;
    reject: (reason?: unknown) => void;
  }
>();
let texDecodeWorkerDisabled = false;
let assetDecodeWorker: Worker | null = null;
let assetDecodeReqId = 0;
let assetDecodeWorkerDisabled = false;
const assetDecodePending = new Map<
  number,
  {
    resolve: (value: AssetWorkerResponse) => void;
    reject: (reason?: unknown) => void;
  }
>();

function canUseTexDecodeWorker(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined";
}

function getImportMetaUrlSafe(): string | null {
  const override = (globalThis as any).__ASSET_MANAGER_TEX_WORKER_URL__;
  if (typeof override === "string" && override.length > 0) return override;
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL("/src/shared/zenkit-tex.worker.ts", window.location.origin).toString();
  }
  return null;
}

function getAssetWorkerUrl(): string | null {
  const override = (globalThis as any).__ASSET_MANAGER_ZK_WORKER_URL__;
  if (typeof override === "string" && override.length > 0) return override;
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL("/src/shared/zenkit-asset.worker.ts", window.location.origin).toString();
  }
  return null;
}

function getTexDecodeWorker(): Worker | null {
  if (texDecodeWorkerDisabled) return null;
  if (!canUseTexDecodeWorker()) {
    return null;
  }
  if (texDecodeWorker) return texDecodeWorker;

  try {
    const moduleUrl = getImportMetaUrlSafe();
    if (!moduleUrl) {
      texDecodeWorkerDisabled = true;
      return null;
    }
    const worker = new Worker(new URL("./zenkit-tex.worker.ts", moduleUrl), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<DecodeTexWorkerResponse>) => {
      const msg = event.data;
      const pending = texDecodePending.get(msg.id);
      if (!pending) return;
      texDecodePending.delete(msg.id);
      pending.resolve(msg);
    };
    worker.onerror = (err) => {
      for (const pending of texDecodePending.values()) pending.reject(err);
      texDecodePending.clear();
      try {
        worker.terminate();
      } catch {
        // no-op
      }
      texDecodeWorker = null;
      texDecodeWorkerDisabled = true;
    };
    texDecodeWorker = worker;
    return texDecodeWorker;
  } catch {
    texDecodeWorkerDisabled = true;
    return null;
  }
}

async function decodeTextureViaWorker(url: string): Promise<DecodeTexWorkerResponse | null> {
  const worker = getTexDecodeWorker();
  if (!worker) return null;
  const id = ++texDecodeReqId;
  const req = new Promise<DecodeTexWorkerResponse>((resolve, reject) => {
    texDecodePending.set(id, { resolve, reject });
  });
  worker.postMessage({ id, type: "decodeTex", url });
  try {
    return await req;
  } catch {
    return null;
  }
}

function getAssetDecodeWorker(): Worker | null {
  if (assetDecodeWorkerDisabled) return null;
  if (!canUseTexDecodeWorker()) return null;
  if (assetDecodeWorker) return assetDecodeWorker;
  try {
    const workerUrl = getAssetWorkerUrl();
    if (!workerUrl) {
      assetDecodeWorkerDisabled = true;
      return null;
    }
    const worker = new Worker(new URL("./zenkit-asset.worker.ts", workerUrl), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<AssetWorkerResponse>) => {
      const msg = event.data;
      const pending = assetDecodePending.get(msg.id);
      if (!pending) return;
      assetDecodePending.delete(msg.id);
      pending.resolve(msg);
    };
    worker.onerror = (err) => {
      for (const pending of assetDecodePending.values()) pending.reject(err);
      assetDecodePending.clear();
      try {
        worker.terminate();
      } catch {
        // no-op
      }
      assetDecodeWorker = null;
      assetDecodeWorkerDisabled = true;
    };
    assetDecodeWorker = worker;
    return assetDecodeWorker;
  } catch {
    assetDecodeWorkerDisabled = true;
    return null;
  }
}

async function decodeAssetViaWorker(
  request:
    | { type: "loadMesh"; path: string }
    | { type: "loadMorph"; path: string }
    | { type: "loadModel"; path: string }
    | { type: "loadCharacterModel"; modelPath: string; meshPath: string }
    | { type: "loadAnimation"; path: string },
): Promise<AssetWorkerResponse | null> {
  const worker = getAssetDecodeWorker();
  if (!worker) return null;
  const id = ++assetDecodeReqId;
  const req = new Promise<AssetWorkerResponse>((resolve, reject) => {
    assetDecodePending.set(id, { resolve, reject });
  });
  const payload: AssetWorkerRequest = { id, ...(request as any) } as AssetWorkerRequest;
  worker.postMessage(payload);
  try {
    return await req;
  } catch {
    return null;
  }
}

function makeArrayLike<T>(array: ArrayLike<T>): { size: () => number; get: (i: number) => T } {
  return {
    size: () => array.length,
    get: (i: number) => array[i] as T,
  };
}

function processedFromSerialized(serialized: SerializedProcessedMeshData): ProcessedMeshData {
  const materials = serialized.materials.map((m) => ({ ...m }));
  const out: any = {
    vertices: makeArrayLike(serialized.vertices),
    indices: makeArrayLike(serialized.indices),
    materialIds: makeArrayLike(serialized.materialIds),
    materials: makeArrayLike(materials),
  };
  return out as ProcessedMeshData;
}

function restoreSerializedProcessedMeshData(payload: {
  vertices: ArrayBuffer;
  indices: ArrayBuffer;
  materialIds: ArrayBuffer;
  materials: SerializedMaterialData[];
}): SerializedProcessedMeshData {
  return {
    vertices: new Float32Array(payload.vertices),
    indices: new Uint32Array(payload.indices),
    materialIds: new Int32Array(payload.materialIds),
    materials: payload.materials,
  };
}

export class AssetManager {
  private static readonly GEOMETRY_LRU_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB
  private processedKeySeq = 0;
  private readonly processedKeyByRef = new WeakMap<object, string>();
  private geometryCacheBytes = 0;
  private readonly geometryBuildInFlight = new Map<
    string,
    Promise<{ geometry: THREE.BufferGeometry; materials: THREE.MeshBasicMaterial[] }>
  >();
  private readonly geometryBuiltCache = new Map<
    string,
    {
      key: string;
      geometry: THREE.BufferGeometry;
      materials: THREE.MeshBasicMaterial[];
      approxBytes: number;
      refs: number;
      evicted: boolean;
    }
  >();
  readonly binaryCache = new Map<string, Uint8Array>();
  readonly binaryInFlight = new Map<string, Promise<Uint8Array>>();
  readonly animationCache = new Map<string, AnimationSequence>();
  readonly meshCache = new Map<string, ProcessedMeshData>();
  readonly meshInFlight = new Map<string, Promise<ProcessedMeshData | null>>();
  readonly textureCache = new Map<string, THREE.DataTexture>();
  readonly textureInFlight = new Map<string, Promise<THREE.DataTexture | null>>();
  readonly materialCache = new Map<string, THREE.Material>();
  readonly modelCache = new Map<string, LoadedModelRenderData>();
  readonly modelInFlight = new Map<string, Promise<LoadedModelRenderData | null>>();
  readonly characterModelCache = new Map<string, LoadedCharacterModelData>();
  readonly characterModelInFlight = new Map<string, Promise<LoadedCharacterModelData | null>>();
  readonly animationDataInFlight = new Map<string, Promise<LoadedAnimationData | null>>();
  readonly morphMeshCache = new Map<string, MorphCacheEntry>();
  readonly morphMeshInFlight = new Map<string, Promise<MorphCacheEntry | null>>();
  readonly missingPathCache = new Set<string>();

  getStats() {
    return {
      meshCache: this.meshCache.size,
      meshInFlight: this.meshInFlight.size,
      textureCache: this.textureCache.size,
      textureInFlight: this.textureInFlight.size,
      geometryBuiltCache: this.geometryBuiltCache.size,
      geometryBuildInFlight: this.geometryBuildInFlight.size,
      geometryCacheBytes: this.geometryCacheBytes,
      materialCache: this.materialCache.size,
      binaryCache: this.binaryCache.size,
      binaryInFlight: this.binaryInFlight.size,
      animationCache: this.animationCache.size,
      modelCache: this.modelCache.size,
      modelInFlight: this.modelInFlight.size,
      characterModelCache: this.characterModelCache.size,
      characterModelInFlight: this.characterModelInFlight.size,
      animationDataInFlight: this.animationDataInFlight.size,
      morphCache: this.morphMeshCache.size,
      morphInFlight: this.morphMeshInFlight.size,
      missingPathCache: this.missingPathCache.size,
    };
  }

  async fetchBinary(url: string): Promise<Uint8Array> {
    const cacheKey = url;
    const cached = this.binaryCache.get(cacheKey);
    if (cached) return cached;

    const inFlight = this.binaryInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
      }

      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      this.binaryCache.set(cacheKey, bytes);
      return bytes;
    })();

    this.binaryInFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.binaryInFlight.delete(cacheKey);
    }
  }

  async loadTexture(url: string | null, zenKit: ZenKit): Promise<THREE.DataTexture | null> {
    if (!url) return null;
    void zenKit;
    const cached = this.textureCache.get(url);
    if (cached) return cached;
    const inFlight = this.textureInFlight.get(url);
    if (inFlight) return inFlight;

    const request = (async (): Promise<THREE.DataTexture | null> => {
      const workerDecoded = await decodeTextureViaWorker(url);
      if (!workerDecoded?.ok) return null;
      const tex = createDataTextureFromRgba(
        new Uint8Array(workerDecoded.rgba),
        workerDecoded.width,
        workerDecoded.height,
        workerDecoded.hasAlpha,
      );
      this.textureCache.set(url, tex);
      if (workerDecoded.resolvedUrl && workerDecoded.resolvedUrl !== url) {
        this.textureCache.set(workerDecoded.resolvedUrl, tex);
      }
      return tex;
    })();

    this.textureInFlight.set(url, request);
    try {
      return await request;
    } finally {
      this.textureInFlight.delete(url);
    }
  }

  async loadMesh(meshPath: string, zenKit: ZenKit): Promise<ProcessedMeshData | null> {
    if (!meshPath) return null;
    if (this.missingPathCache.has(meshPath)) return null;
    const cached = this.meshCache.get(meshPath);
    if (cached) return cached;
    const inFlight = this.meshInFlight.get(meshPath);
    if (inFlight) return inFlight;

    const request = (async (): Promise<ProcessedMeshData | null> => {
      try {
        void zenKit;
        const decoded = await decodeAssetViaWorker({ type: "loadMesh", path: meshPath });
        if (!decoded || !decoded.ok || decoded.type !== "loadMesh") {
          this.missingPathCache.add(meshPath);
          return null;
        }
        const serialized = restoreSerializedProcessedMeshData(decoded.mesh);
        if (!serialized.indices.length || !serialized.vertices.length) {
          this.missingPathCache.add(meshPath);
          return null;
        }
        const processed = processedFromSerialized(serialized);

        this.meshCache.set(meshPath, processed);
        return processed;
      } catch {
        this.missingPathCache.add(meshPath);
        return null;
      }
    })();

    this.meshInFlight.set(meshPath, request);
    try {
      return await request;
    } finally {
      this.meshInFlight.delete(meshPath);
    }
  }

  async buildGeometryAndMaterials(processed: ProcessedMeshData, zenKit: ZenKit) {
    const key = this.getProcessedKey(processed as any);
    const cached = this.geometryBuiltCache.get(key);
    if (cached) {
      this.touchGeometryEntry(key, cached);
      this.retainGeometryEntry(cached);
      return { geometry: cached.geometry, materials: cached.materials };
    }

    const inFlight = this.geometryBuildInFlight.get(key);
    if (inFlight) {
      const built = await inFlight;
      const entry = this.geometryBuiltCache.get(key);
      if (entry) {
        this.retainGeometryEntry(entry);
      }
      return built;
    }

    const request = (async () => {
      const built = await buildThreeJSGeometryAndMaterials(
        processed,
        zenKit,
        this.textureCache,
        this.materialCache,
        (url, zk) => this.loadTexture(url, zk),
      );
      const approxBytes = this.estimateGeometryBytes(built.geometry, built.materials);
      const entry = {
        key,
        geometry: built.geometry,
        materials: built.materials,
        approxBytes,
        refs: 0,
        evicted: false,
      };
      this.geometryBuiltCache.set(key, entry);
      this.geometryCacheBytes += approxBytes;
      this.touchGeometryEntry(key, entry);
      this.retainGeometryEntry(entry);
      this.evictGeometryLruIfNeeded();
      return built;
    })();

    this.geometryBuildInFlight.set(key, request);
    try {
      return await request;
    } finally {
      this.geometryBuildInFlight.delete(key);
    }
  }

  private getProcessedKey(processed: object): string {
    const known = this.processedKeyByRef.get(processed);
    if (known) return known;
    const key = `processed-${++this.processedKeySeq}`;
    this.processedKeyByRef.set(processed, key);
    return key;
  }

  private touchGeometryEntry(
    key: string,
    entry: {
      key: string;
      geometry: THREE.BufferGeometry;
      materials: THREE.MeshBasicMaterial[];
      approxBytes: number;
      refs: number;
      evicted: boolean;
    },
  ): void {
    if (this.geometryBuiltCache.get(key) !== entry) return;
    this.geometryBuiltCache.delete(key);
    this.geometryBuiltCache.set(key, entry);
  }

  private retainGeometryEntry(entry: {
    key: string;
    geometry: THREE.BufferGeometry;
    materials: THREE.MeshBasicMaterial[];
    approxBytes: number;
    refs: number;
    evicted: boolean;
  }): void {
    entry.refs += 1;
    const geom = entry.geometry as any;
    if (!geom.userData) geom.userData = {};
    geom.userData.__assetManagerReleaseGeometry = () => {
      if (entry.refs > 0) entry.refs -= 1;
      if (!entry.evicted) return false;
      if (entry.refs > 0) return false;
      return true;
    };
  }

  private estimateGeometryBytes(
    geometry: THREE.BufferGeometry,
    materials: THREE.MeshBasicMaterial[],
  ): number {
    let bytes = 0;
    const attrs = geometry.attributes || {};
    for (const key of Object.keys(attrs)) {
      const attr: any = (attrs as any)[key];
      if (!attr?.array) continue;
      bytes += Number(attr.array.byteLength || 0);
    }
    const indexAttr: any = geometry.index;
    if (indexAttr?.array) bytes += Number(indexAttr.array.byteLength || 0);
    // Small fixed cost for geometry/groups/material refs bookkeeping.
    bytes += 4096;
    bytes += materials.length * 1024;
    return bytes;
  }

  private evictGeometryLruIfNeeded(): void {
    const max = AssetManager.GEOMETRY_LRU_MAX_BYTES;
    if (this.geometryCacheBytes <= max) return;
    for (const [key, entry] of this.geometryBuiltCache) {
      if (this.geometryCacheBytes <= max) break;
      this.geometryBuiltCache.delete(key);
      this.geometryCacheBytes -= entry.approxBytes;
      entry.evicted = true;
      if (entry.refs <= 0) {
        entry.geometry.dispose();
      }
    }
  }

  async loadModel(modelPath: string, zenKit: ZenKit): Promise<LoadedModelRenderData | null> {
    if (!modelPath) return null;
    const cacheKey = modelPath.toUpperCase();
    const cached = this.modelCache.get(cacheKey);
    if (cached) return cached;
    if (this.missingPathCache.has(cacheKey)) return null;
    const inFlight = this.modelInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const request = (async (): Promise<LoadedModelRenderData | null> => {
      try {
        void zenKit;
        const decoded = await decodeAssetViaWorker({ type: "loadModel", path: modelPath });
        if (!decoded || !decoded.ok || decoded.type !== "loadModel") {
          this.missingPathCache.add(cacheKey);
          return null;
        }
        const model: LoadedModelRenderData = {
          rootTranslation: decoded.model.rootTranslation,
          hierarchyNodes: decoded.model.hierarchyNodes,
          attachments: decoded.model.attachments.map((a) => ({
            name: a.name,
            processed: processedFromSerialized(restoreSerializedProcessedMeshData(a.processed)),
          })),
          softSkins: decoded.model.softSkins.map((s) =>
            processedFromSerialized(restoreSerializedProcessedMeshData(s)),
          ),
        };
        this.modelCache.set(cacheKey, model);
        return model;
      } catch {
        this.missingPathCache.add(cacheKey);
        return null;
      }
    })();

    this.modelInFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.modelInFlight.delete(cacheKey);
    }
  }

  async loadMorphMesh(morphPath: string, zenKit: ZenKit): Promise<MorphCacheEntry | null> {
    if (!morphPath) return null;
    const cacheKey = morphPath.toUpperCase();
    const cached = this.morphMeshCache.get(cacheKey);
    if (cached) return cached;
    if (this.missingPathCache.has(cacheKey)) return null;
    const inFlight = this.morphMeshInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const request = (async (): Promise<MorphCacheEntry | null> => {
      try {
        void zenKit;
        const decoded = await decodeAssetViaWorker({ type: "loadMorph", path: morphPath });
        if (!decoded || !decoded.ok || decoded.type !== "loadMorph") {
          this.missingPathCache.add(cacheKey);
          return null;
        }
        const processed = processedFromSerialized(restoreSerializedProcessedMeshData(decoded.mesh));
        const result = { processed, animations: decoded.animations };
        this.morphMeshCache.set(cacheKey, result);
        return result;
      } catch {
        this.missingPathCache.add(cacheKey);
        return null;
      }
    })();

    this.morphMeshInFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.morphMeshInFlight.delete(cacheKey);
    }
  }

  async loadCharacterModel(
    modelPath: string,
    meshPath: string,
  ): Promise<LoadedCharacterModelData | null> {
    if (!modelPath || !meshPath) return null;
    const cacheKey = `${modelPath.toUpperCase()}|${meshPath.toUpperCase()}`;
    const cached = this.characterModelCache.get(cacheKey);
    if (cached) return cached;
    if (this.missingPathCache.has(cacheKey)) return null;
    const inFlight = this.characterModelInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const request = (async (): Promise<LoadedCharacterModelData | null> => {
      try {
        const decoded = await decodeAssetViaWorker({
          type: "loadCharacterModel",
          modelPath,
          meshPath,
        });
        if (!decoded || !decoded.ok || decoded.type !== "loadCharacterModel") {
          this.missingPathCache.add(cacheKey);
          return null;
        }

        const character: LoadedCharacterModelData = {
          rootTranslation: decoded.character.rootTranslation,
          hierarchyNodes: decoded.character.hierarchyNodes,
          attachments: decoded.character.attachments.map((a) => ({
            name: a.name,
            processed: processedFromSerialized(restoreSerializedProcessedMeshData(a.processed)),
          })),
          softSkins: decoded.character.softSkins.map((s) => ({
            materials: s.materials,
            groups: s.groups,
            uvs: new Float32Array(s.uvs),
            skinIndex: new Uint16Array(s.skinIndex),
            skinWeight: new Float32Array(s.skinWeight),
            infPos: new Float32Array(s.infPos),
            infNorm: new Float32Array(s.infNorm),
            vertexCount: s.vertexCount,
          })),
        };

        this.characterModelCache.set(cacheKey, character);
        return character;
      } catch {
        this.missingPathCache.add(cacheKey);
        return null;
      }
    })();

    this.characterModelInFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.characterModelInFlight.delete(cacheKey);
    }
  }

  async loadAnimationData(path: string): Promise<LoadedAnimationData | null> {
    if (!path) return null;
    const cacheKey = path.toUpperCase();
    if (this.missingPathCache.has(cacheKey)) return null;
    const inFlight = this.animationDataInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const request = (async (): Promise<LoadedAnimationData | null> => {
      try {
        const decoded = await decodeAssetViaWorker({ type: "loadAnimation", path });
        if (!decoded || !decoded.ok || decoded.type !== "loadAnimation") {
          this.missingPathCache.add(cacheKey);
          return null;
        }
        return decoded.animation;
      } catch {
        this.missingPathCache.add(cacheKey);
        return null;
      }
    })();

    this.animationDataInFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.animationDataInFlight.delete(cacheKey);
    }
  }
}
