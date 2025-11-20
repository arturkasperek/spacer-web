import { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import type { World, ZenKit } from '@kolarz3/zenkit';

// World Renderer Component - loads ZenKit and renders world mesh
function WorldRenderer({ worldPath, onLoadingStatus, onWorldLoaded }: Readonly<{
  worldPath: string;
  onLoadingStatus: (status: string) => void;
  onWorldLoaded?: (world: World, zenKit: ZenKit) => void;
}>) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [worldMesh, setWorldMesh] = useState<THREE.Mesh | null>(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    // Only load once
    if (hasLoadedRef.current) return;

    hasLoadedRef.current = true;

    const loadWorld = async () => {
      try {
        onLoadingStatus('Loading ZenKit...');

        // Import ZenKit WebAssembly module
        const zenkitModule = await import('@kolarz3/zenkit');
        const ZenKitModule = zenkitModule.default as unknown as () => Promise<ZenKit>;
        const zenKit = await ZenKitModule();

        onLoadingStatus(`Loading ${worldPath}...`);

        // Fetch the ZEN file
        const response = await fetch(worldPath);
        if (!response.ok) {
          throw new Error(`Failed to fetch ZEN file: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        onLoadingStatus('Processing world data...');

        // Create world and load
        const world = zenKit.createWorld();
        const success = world.loadFromArray(uint8Array);

        if (!success || !world.isLoaded) {
          throw new Error(world.getLastError() || 'Unknown loading error');
        }

        // Notify parent component that world is loaded
        if (onWorldLoaded) {
          onWorldLoaded(world, zenKit);
        }

        onLoadingStatus('Processing mesh data...');

        // Get the world mesh - world.mesh directly exposes getProcessedMeshData()
        const processed = world.mesh.getProcessedMeshData();

        const vertCount = processed.vertices.size();
        const idxCount = processed.indices.size();
        const matCount = processed.materials.size();

        console.log(`World loaded: ${vertCount/8} vertices, ${idxCount/3} triangles, ${matCount} materials`);

        // Build Three.js geometry
        const positions = new Float32Array(idxCount * 3);
        const normals = new Float32Array(idxCount * 3);
        const uvs = new Float32Array(idxCount * 2);

        for (let i = 0; i < idxCount; i++) {
          const vertIdx = processed.indices.get(i);
          const vertBase = vertIdx * 8;

          positions[i*3 + 0] = processed.vertices.get(vertBase + 0);
          positions[i*3 + 1] = processed.vertices.get(vertBase + 1);
          positions[i*3 + 2] = processed.vertices.get(vertBase + 2);

          normals[i*3 + 0] = processed.vertices.get(vertBase + 3);
          normals[i*3 + 1] = processed.vertices.get(vertBase + 4);
          normals[i*3 + 2] = processed.vertices.get(vertBase + 5);

          uvs[i*2 + 0] = processed.vertices.get(vertBase + 6);
          uvs[i*2 + 1] = processed.vertices.get(vertBase + 7);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

        // Build materials array from deduplicated materials
        const materialArray: THREE.MeshBasicMaterial[] = [];

        for (let mi = 0; mi < matCount; mi++) {
          const mat = processed.materials.get(mi);
          const material = new THREE.MeshBasicMaterial({
            color: 0xFFFFFF, // WHITE - don't tint the texture!
            side: THREE.DoubleSide,
            transparent: false, // Disable transparency for alpha-tested materials
            alphaTest: 0.5       // Use proper alpha test threshold like OpenGothic
          });
          materialArray.push(material);

          // Load texture asynchronously
          if (mat?.texture && mat.texture.length) {
            const textureUrl = tgaNameToCompiledUrl(mat.texture);
            loadCompiledTexAsDataTexture(textureUrl, zenKit).then(tex => {
              if (tex && materialArray[mi]) {
                materialArray[mi].map = tex;
                materialArray[mi].needsUpdate = true;
                console.log(`Loaded texture: ${mat.texture}`);
              }
            }).catch(() => {
              console.warn(`Failed to load texture: ${mat.texture}`);
            });
          }
        }

        // Set up geometry groups for multi-material mesh
        // materialIds is per-triangle, so we need to find consecutive runs
        const triCount = processed.materialIds.size();
        geometry.clearGroups();

        let currentMatId = processed.materialIds.get(0);
        let groupStart = 0;

        for (let t = 1; t <= triCount; t++) {
          const matId = (t < triCount) ? processed.materialIds.get(t) : -1; // Force flush at end

          if (t === triCount || matId !== currentMatId) {
            // End of group
            const vertexStart = groupStart * 3; // 3 vertices per triangle
            const vertexCount = (t - groupStart) * 3;
            geometry.addGroup(vertexStart, vertexCount, currentMatId);

            groupStart = t;
            currentMatId = matId;
          }
        }

        console.log(`Created ${geometry.groups.length} material groups for ${matCount} materials`);

        // Create mesh with materials array
        const threeMesh = new THREE.Mesh(geometry, materialArray);
        threeMesh.scale.x = -1; // Fix mirrored world

        setWorldMesh(threeMesh);
        onLoadingStatus('World loaded successfully!');

      } catch (error) {
        console.error('Failed to load world:', error);
        onLoadingStatus(`Error: ${(error as Error).message}`);
        hasLoadedRef.current = false;
      }
    };

    loadWorld();
  }, [worldPath, onLoadingStatus, onWorldLoaded]);

  return worldMesh ? <primitive object={worldMesh as THREE.Object3D} ref={meshRef} /> : null;
}

// Helper function to convert TGA texture name to compiled TEX URL
function tgaNameToCompiledUrl(name: string): string | null {
  if (!name || typeof name !== 'string') return null;
  const base = name.replace(/\.[^.]*$/, '').toUpperCase();
  return `/TEXTURES/_COMPILED/${base}-C.TEX`;
}

// Helper function to load compiled TEX file as DataTexture
async function loadCompiledTexAsDataTexture(url: string | null, zenKit: ZenKit): Promise<THREE.DataTexture | null> {
  if (!url) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const buf = await res.arrayBuffer();
    const arr = new Uint8Array(buf);

    const zkTex = new zenKit.Texture();
    const ok = zkTex.loadFromArray(arr);
    if (!ok || !ok.success) {
      return null;
    }

    const w = zkTex.width;
    const h = zkTex.height;
    const rgba = zkTex.asRgba8(0);
    if (!rgba) return null;

    const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.flipY = false;  // OpenGothic doesn't flip Y
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;  // Reasonable anisotropic filtering
    // IMPORTANT: world UVs frequently exceed [0,1]; enable tiling
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapNearestFilter;  // Use nearest mipmap for more blur
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;

    return tex;
  } catch (error: unknown) {
    console.warn('Failed to load texture:', error);
    return null;
  }
}

export { WorldRenderer, tgaNameToCompiledUrl };
