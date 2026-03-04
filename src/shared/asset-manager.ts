import type { ZenKit, Model, MorphMesh, ProcessedMeshData } from "@kolarz3/zenkit";
import * as THREE from "three";
import type { AnimationSequence } from "../character/animation";
import { buildThreeJSGeometryAndMaterials, decodeCompiledTexAsDataTexture } from "./mesh-utils";

type MorphCacheEntry = {
  morphMesh: MorphMesh;
  processed: ProcessedMeshData;
  animations: string[];
};

export class AssetManager {
  readonly binaryCache = new Map<string, Uint8Array>();
  readonly animationCache = new Map<string, AnimationSequence>();
  readonly meshCache = new Map<string, ProcessedMeshData>();
  readonly textureCache = new Map<string, THREE.DataTexture>();
  readonly materialCache = new Map<string, THREE.Material>();
  readonly modelCache = new Map<string, Model>();
  readonly morphMeshCache = new Map<string, MorphCacheEntry>();
  readonly missingPathCache = new Set<string>();

  getStats() {
    return {
      meshCache: this.meshCache.size,
      textureCache: this.textureCache.size,
      materialCache: this.materialCache.size,
      binaryCache: this.binaryCache.size,
      animationCache: this.animationCache.size,
      modelCache: this.modelCache.size,
      morphCache: this.morphMeshCache.size,
      missingPathCache: this.missingPathCache.size,
    };
  }

  async fetchBinary(url: string): Promise<Uint8Array> {
    const cacheKey = url;
    const cached = this.binaryCache.get(cacheKey);
    if (cached) return cached;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    this.binaryCache.set(cacheKey, bytes);
    return bytes;
  }

  async loadTexture(url: string | null, zenKit: ZenKit): Promise<THREE.DataTexture | null> {
    if (!url) return null;
    const cached = this.textureCache.get(url);
    if (cached) return cached;

    const candidateUrls: string[] = [url];
    // Fallback 1: many textures reference _C1/_C2 variants that don't exist in shipped assets.
    if (/_C\d+-C\.TEX$/i.test(url) && !/_C0-C\.TEX$/i.test(url)) {
      candidateUrls.push(url.replace(/_C\d+(-C\.TEX)$/i, "_C0$1"));
    }
    // Fallback 2 (OpenGothic-compatible): use DEFAULT texture when specific one is missing.
    if (!url.toUpperCase().endsWith("/DEFAULT-C.TEX")) {
      candidateUrls.push("/TEXTURES/_COMPILED/DEFAULT-C.TEX");
    }

    for (const candidateUrl of candidateUrls) {
      try {
        const response = await fetch(candidateUrl);
        if (!response.ok) continue;
        const buf = await response.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const tex = decodeCompiledTexAsDataTexture(bytes, zenKit);
        if (tex) {
          this.textureCache.set(url, tex);
          if (candidateUrl !== url) this.textureCache.set(candidateUrl, tex);
          return tex;
        }
      } catch {
        // Try next fallback candidate.
      }
    }

    return null;
  }

  async loadMesh(meshPath: string, zenKit: ZenKit): Promise<ProcessedMeshData | null> {
    if (!meshPath) return null;
    if (this.missingPathCache.has(meshPath)) return null;
    const cached = this.meshCache.get(meshPath);
    if (cached) return cached;

    try {
      const response = await fetch(meshPath);
      if (!response.ok) {
        this.missingPathCache.add(meshPath);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      const vobMesh = zenKit.createMesh();
      const isMRM = meshPath.toUpperCase().endsWith(".MRM");
      const loadResult = isMRM
        ? vobMesh.loadMRMFromArray(uint8Array)
        : vobMesh.loadFromArray(uint8Array);

      if (!loadResult || !loadResult.success) {
        this.missingPathCache.add(meshPath);
        return null;
      }

      const meshData = vobMesh.getMeshData();
      const processed = meshData.getProcessedMeshData();
      if (processed.indices.size() === 0 || processed.vertices.size() === 0) {
        this.missingPathCache.add(meshPath);
        return null;
      }

      this.meshCache.set(meshPath, processed);
      return processed;
    } catch {
      this.missingPathCache.add(meshPath);
      return null;
    }
  }

  async buildGeometryAndMaterials(processed: ProcessedMeshData, zenKit: ZenKit) {
    return buildThreeJSGeometryAndMaterials(
      processed,
      zenKit,
      this.textureCache,
      this.materialCache,
      (url, zk) => this.loadTexture(url, zk),
    );
  }

  async loadModel(modelPath: string, zenKit: ZenKit): Promise<Model | null> {
    if (!modelPath) return null;
    const cacheKey = modelPath.toUpperCase();
    const cached = this.modelCache.get(cacheKey);
    if (cached) return cached;
    if (this.missingPathCache.has(cacheKey)) return null;

    try {
      const response = await fetch(modelPath);

      const contentType = response.headers.get("content-type") || "";
      const is404 = !response.ok || contentType.includes("text/html");

      if (is404) {
        const basePath = modelPath.replace(/\.MDL$/i, "");
        const mdhPath = `${basePath}.MDH`;
        const mdmPath = `${basePath}.MDM`;
        const mdhKey = mdhPath.toUpperCase();
        const mdmKey = mdmPath.toUpperCase();
        if (this.missingPathCache.has(mdhKey) || this.missingPathCache.has(mdmKey)) {
          this.missingPathCache.add(cacheKey);
          return null;
        }

        try {
          const mdhResponse = await fetch(mdhPath);
          if (!mdhResponse.ok) {
            this.missingPathCache.add(mdhKey);
            this.missingPathCache.add(cacheKey);
            return null;
          }

          const mdhArrayBuffer = await mdhResponse.arrayBuffer();
          const mdhUint8Array = new Uint8Array(mdhArrayBuffer);

          const hierarchyLoader = zenKit.createModelHierarchyLoader();
          const mdhLoadResult = hierarchyLoader.loadFromArray(mdhUint8Array);

          if (!mdhLoadResult || !mdhLoadResult.success) {
            this.missingPathCache.add(mdhKey);
            this.missingPathCache.add(cacheKey);
            return null;
          }

          const mdmResponse = await fetch(mdmPath);
          if (!mdmResponse.ok) {
            this.missingPathCache.add(mdmKey);
            this.missingPathCache.add(cacheKey);
            return null;
          }

          const mdmArrayBuffer = await mdmResponse.arrayBuffer();
          const mdmUint8Array = new Uint8Array(mdmArrayBuffer);

          const meshLoader = zenKit.createModelMeshLoader();
          const mdmLoadResult = meshLoader.loadFromArray(mdmUint8Array);

          if (!mdmLoadResult || !mdmLoadResult.success) {
            this.missingPathCache.add(mdmKey);
            this.missingPathCache.add(cacheKey);
            return null;
          }

          const model = zenKit.createModel();
          model.setHierarchy(hierarchyLoader.getHierarchy());
          model.setMesh(meshLoader.getMesh());
          this.modelCache.set(cacheKey, model);
          return model;
        } catch {
          this.missingPathCache.add(cacheKey);
          return null;
        }
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      const model = zenKit.createModel();
      const loadResult = model.loadFromArray(uint8Array);

      if (!loadResult || !loadResult.success) {
        this.missingPathCache.add(cacheKey);
        return null;
      }

      const attachmentNames = model.getAttachmentNames();
      const hasAttachments = attachmentNames && attachmentNames.size && attachmentNames.size() > 0;
      if (!model.isLoaded && !hasAttachments) {
        this.missingPathCache.add(cacheKey);
        return null;
      }

      this.modelCache.set(cacheKey, model);
      return model;
    } catch {
      this.missingPathCache.add(cacheKey);
      return null;
    }
  }

  async loadMorphMesh(morphPath: string, zenKit: ZenKit): Promise<MorphCacheEntry | null> {
    if (!morphPath) return null;
    const cacheKey = morphPath.toUpperCase();
    const cached = this.morphMeshCache.get(cacheKey);
    if (cached) return cached;
    if (this.missingPathCache.has(cacheKey)) return null;

    try {
      const response = await fetch(morphPath);
      if (!response.ok) {
        this.missingPathCache.add(cacheKey);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      const morphMesh = zenKit.createMorphMesh();
      const loadResult = morphMesh.loadFromArray(uint8Array);

      if (!loadResult || !loadResult.success || !morphMesh.isLoaded) {
        this.missingPathCache.add(cacheKey);
        return null;
      }

      const processed = morphMesh.convertToProcessedMesh();
      const animationNames = morphMesh.getAnimationNames();
      const animationCount = animationNames.size();
      const animations: string[] = [];
      for (let i = 0; i < animationCount; i++) {
        animations.push(animationNames.get(i));
      }

      const result = { morphMesh, processed, animations };
      this.morphMeshCache.set(cacheKey, result);
      return result;
    } catch {
      this.missingPathCache.add(cacheKey);
      return null;
    }
  }
}
