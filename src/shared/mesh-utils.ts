// Mesh and geometry utility functions for loading and processing Gothic meshes
import * as THREE from "three";
import type { ZenKit, ProcessedMeshData } from "@kolarz3/zenkit";
import { tgaNameToCompiledUrl } from "../vob/vob-utils";

/**
 * Loads a compiled TEX file as a Three.js DataTexture
 */
export async function loadCompiledTexAsDataTexture(
  url: string | null,
  zenKit: ZenKit,
): Promise<THREE.DataTexture | null> {
  if (!url) return null;

  try {
    let res = await fetch(url);
    if (!res.ok) {
      // Fallback: many textures reference _C1/_C2 variants that don't exist in the shipped set
      if (url.includes("_C") && !url.includes("_C0-C.TEX")) {
        const fallbackUrl = url.replace(/_C\d+(-C\.TEX)$/i, "_C0$1");
        res = await fetch(fallbackUrl);
        if (!res.ok) return null;
      } else {
        return null;
      }
    }

    const buf = await res.arrayBuffer();
    const arr = new Uint8Array(buf);

    const zkTex = new zenKit.Texture();
    const ok = zkTex.loadFromArray(arr);
    if (!ok || !ok.success) return null;

    const w = zkTex.width;
    const h = zkTex.height;
    const rgba = zkTex.asRgba8(0);
    if (!rgba) return null;

    const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.flipY = false; // OpenGothic doesn't flip Y
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4; // Enable some anisotropy for better quality
    // IMPORTANT: world UVs frequently exceed [0,1]; enable tiling
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;

    return tex;
  } catch (error) {
    return null;
  }
}

/**
 * Loads a mesh file (.MRM or .MSH) and returns processed mesh data
 * Uses a cache to avoid reloading the same mesh
 */
export async function loadMeshCached(
  meshPath: string,
  zenKit: ZenKit,
  cache: Map<string, ProcessedMeshData>,
): Promise<ProcessedMeshData | null> {
  // Check cache first
  const cached = cache.get(meshPath);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(meshPath);
    if (!response.ok) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Load mesh with ZenKit
    const vobMesh = zenKit.createMesh();
    const isMRM = meshPath.toUpperCase().endsWith(".MRM");
    const loadResult = isMRM
      ? vobMesh.loadMRMFromArray(uint8Array)
      : vobMesh.loadFromArray(uint8Array);

    if (!loadResult || !loadResult.success) {
      return null;
    }

    // Get processed mesh data
    const meshData = vobMesh.getMeshData();
    const processed = meshData.getProcessedMeshData();

    // Check if mesh has data
    if (processed.indices.size() === 0 || processed.vertices.size() === 0) {
      return null;
    }

    // Cache and return
    cache.set(meshPath, processed);
    return processed;
  } catch (error: unknown) {
    console.warn(`Failed to load mesh ${meshPath}:`, error);
    return null;
  }
}

/**
 * Builds Three.js BufferGeometry from processed mesh data
 * Extracts positions, normals, and UVs from the processed mesh
 */
export function buildThreeJSGeometry(processed: ProcessedMeshData): THREE.BufferGeometry {
  const idxCount = processed.indices.size();

  // Build Three.js geometry
  const positions = new Float32Array(idxCount * 3);
  const normals = new Float32Array(idxCount * 3);
  const uvs = new Float32Array(idxCount * 2);

  for (let i = 0; i < idxCount; i++) {
    const vertIdx = processed.indices.get(i);
    const vertBase = vertIdx * 8;

    positions[i * 3 + 0] = processed.vertices.get(vertBase + 0);
    positions[i * 3 + 1] = processed.vertices.get(vertBase + 1);
    positions[i * 3 + 2] = processed.vertices.get(vertBase + 2);

    normals[i * 3 + 0] = processed.vertices.get(vertBase + 3);
    normals[i * 3 + 1] = processed.vertices.get(vertBase + 4);
    normals[i * 3 + 2] = processed.vertices.get(vertBase + 5);

    uvs[i * 2 + 0] = processed.vertices.get(vertBase + 6);
    uvs[i * 2 + 1] = processed.vertices.get(vertBase + 7);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

  return geometry;
}

/**
 * Builds material groups for a geometry based on processed mesh material IDs
 * Groups consecutive triangles with the same material ID
 */
export function buildMaterialGroups(
  geometry: THREE.BufferGeometry,
  processed: ProcessedMeshData,
): void {
  const triCount = processed.materialIds.size();
  geometry.clearGroups();

  let currentMatId = processed.materialIds.get(0);
  let groupStart = 0;

  for (let t = 1; t <= triCount; t++) {
    const matId = t < triCount ? processed.materialIds.get(t) : -1;

    if (t === triCount || matId !== currentMatId) {
      const vertexStart = groupStart * 3;
      const vertexCount = (t - groupStart) * 3;
      geometry.addGroup(vertexStart, vertexCount, currentMatId);

      groupStart = t;
      currentMatId = matId;
    }
  }
}

/**
 * Color name to hex mapping for helper visuals (matching original Spacer editor)
 */
const colorNameToHex: { [key: string]: number } = {
  RED: 0xff0000,
  GREEN: 0x00ff00,
  BLUE: 0x0000ff,
  YELLOW: 0xffff00,
  ORANGE: 0xffa500,
  PURPLE: 0x800080,
  CYAN: 0x00ffff,
  MAGENTA: 0xff00ff,
  WHITE: 0xffffff,
  BLACK: 0x000000,
  GRAY: 0x808080,
  GREY: 0x808080,
  // Camera-related materials (zCCamTrj_KeyFrame - type 17)
  KAMERA: 0x00ffff, // CYAN - cameras are typically cyan
  FILM: 0xff00ff, // MAGENTA - film/cinematic
  DIRECTION: 0xffff00, // YELLOW - direction indicators
  // Light materials (zCVobLight - type 10)
  LIGHTMESH: 0xffff00, // YELLOW - lights are yellow
  // Numbered materials (zCVobSound - type 36, zCCamTrj_KeyFrame - type 17)
  ZCVOBMAT1: 0xff6b6b, // CORAL/RED - lighter red
  ZCVOBMAT2: 0x4ecdc4, // TURQUOISE - cyan-green
  ZCVOBMAT3: 0x45b7d1, // SKY BLUE - light blue
  ZCVOBMAT4: 0xffa07a, // LIGHT SALMON - orange-pink
  ZCVOBMAT5: 0x98d8c8, // MINT GREEN - light green
  ZCVOBMAT6: 0xc0c0c0, // SILVER - lighter gray
  ZCVOBMAT7: 0xa0a0a0, // GRAY - medium gray
  ZCVOBMAT8: 0x808080, // DARKGRAY - darker gray
};

/**
 * Creates a Three.js material from material data, with caching support
 * Handles both texture-based materials and helper visual color materials
 */
export async function createMeshMaterial(
  materialData: { texture: string; name?: string; disableCollision?: boolean },
  zenKit: ZenKit,
  textureCache: Map<string, THREE.DataTexture>,
  materialCache: Map<string, THREE.Material>,
): Promise<THREE.MeshBasicMaterial> {
  const textureName = materialData.texture || "";
  const materialName = materialData.name || "";
  const disableCollision = Boolean((materialData as any).disableCollision);
  const noCollDet = disableCollision;

  // For helper visuals: check if material name is a color name (no texture)
  // Helper visuals have no texture but have a material name (like "ORANGE", "RED", etc.)
  if (!textureName && materialName) {
    const materialNameUpper = materialName.toUpperCase();
    const colorHex = colorNameToHex[materialNameUpper];
    const cacheKey = `HELPER_COLOR_${materialNameUpper}`;
    const finalColor = colorHex !== undefined ? colorHex : 0xffffff;

    // Check cache first
    const cached = materialCache.get(cacheKey);
    if (cached && cached instanceof THREE.MeshBasicMaterial) {
      return cached;
    }

    // Create solid color material for helper visual
    const material = new THREE.MeshBasicMaterial({
      color: finalColor,
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0.5,
    });
    material.userData.noCollDet = noCollDet;

    // Cache and return
    materialCache.set(cacheKey, material);
    return material;
  }

  // Regular texture-based material
  // Check cache first
  const cached = materialCache.get(textureName);
  if (cached && cached instanceof THREE.MeshBasicMaterial) {
    return cached;
  }

  // Create material
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: false, // Disable transparency for alpha-tested materials
    alphaTest: 0.5, // Use proper alpha test threshold like OpenGothic
  });
  material.userData.noCollDet = noCollDet;

  // Load texture if available
  if (textureName && textureName.length) {
    const url = tgaNameToCompiledUrl(textureName);
    if (url) {
      // Check texture cache first
      let tex = textureCache.get(url);
      if (!tex) {
        const loadedTex = await loadCompiledTexAsDataTexture(url, zenKit);
        if (loadedTex) {
          textureCache.set(url, loadedTex);
          tex = loadedTex;
        }
      }
      if (tex) {
        material.map = tex;
        material.needsUpdate = true;
      }
    }
  }

  // Cache and return
  materialCache.set(textureName, material);
  return material;
}

/**
 * Builds complete Three.js geometry and materials from processed mesh data
 * This is a convenience function that combines geometry building, material groups, and material creation
 */
export async function buildThreeJSGeometryAndMaterials(
  processed: ProcessedMeshData,
  zenKit: ZenKit,
  textureCache: Map<string, THREE.DataTexture>,
  materialCache: Map<string, THREE.Material>,
): Promise<{ geometry: THREE.BufferGeometry; materials: THREE.MeshBasicMaterial[] }> {
  const matCount = processed.materials.size();

  // Build geometry
  const geometry = buildThreeJSGeometry(processed);

  // Build material groups
  buildMaterialGroups(geometry, processed);

  // Build materials using cache
  const materialArray: THREE.MeshBasicMaterial[] = [];
  for (let mi = 0; mi < matCount; mi++) {
    const mat = processed.materials.get(mi);
    const material = await createMeshMaterial(mat, zenKit, textureCache, materialCache);
    materialArray.push(material);
  }

  return { geometry, materials: materialArray };
}

/**
 * Create a text sprite for NPC name label
 */
export function createTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get 2D context");
  }

  // Set canvas size
  canvas.width = 256;
  canvas.height = 64;

  // Draw text with outline
  const fontSize = 32;
  context.font = `bold ${fontSize}px Arial`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  // Draw outline (black)
  context.strokeStyle = "#000000";
  context.lineWidth = 4;
  context.strokeText(text, canvas.width / 2, canvas.height / 2);

  // Draw text (white)
  context.fillStyle = "#ffffff";
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  // Create texture from canvas
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  // Create sprite material
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.1,
  });

  // Create sprite
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(100, 25, 1); // Scale to appropriate size
  sprite.position.y = 35; // Position above box

  return sprite;
}
