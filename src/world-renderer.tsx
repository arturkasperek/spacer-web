import { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import type { World, ZenKit } from '@kolarz3/zenkit';
import { loadVm, type NpcSpawnCallback } from './vm-manager';
import { buildThreeJSGeometry, buildMaterialGroups, loadCompiledTexAsDataTexture } from './mesh-utils';
import { tgaNameToCompiledUrl } from './vob-utils';

// World Renderer Component - loads ZenKit and renders world mesh
function WorldRenderer({ worldPath, onLoadingStatus, onWorldLoaded, onNpcSpawn }: Readonly<{
  worldPath: string;
  onLoadingStatus: (status: string) => void;
  onWorldLoaded?: (world: World, zenKit: ZenKit) => void;
  onNpcSpawn?: NpcSpawnCallback;
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

        // Load VM script and call startup function
        onLoadingStatus('Loading VM script...');
        try {
          await loadVm(zenKit, '/SCRIPTS/_COMPILED/GOTHIC.DAT', 'startup_newworld', onNpcSpawn);
          console.log('VM loaded successfully');
          onLoadingStatus('VM loaded');
        } catch (vmError) {
          console.warn('Failed to load VM script:', vmError);
          onLoadingStatus(`VM loading failed: ${(vmError as Error).message}`);
          // Continue with world loading even if VM fails
        }

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

        // Build Three.js geometry using shared utility
        const geometry = buildThreeJSGeometry(processed);

        // Build materials array from deduplicated materials
        const materialArray: THREE.MeshBasicMaterial[] = [];
        const noCollDetByMaterialId: boolean[] = [];

        for (let mi = 0; mi < matCount; mi++) {
          const mat = processed.materials.get(mi) as any;
          const material = new THREE.MeshBasicMaterial({
            color: 0xFFFFFF, // WHITE - don't tint the texture!
            side: THREE.DoubleSide,
            transparent: false, // Disable transparency for alpha-tested materials
            alphaTest: 0.5       // Use proper alpha test threshold like OpenGothic
          });
          materialArray.push(material);

          const texName = (mat?.texture as string | undefined) ?? "";
          // ZenGin: zCMaterial::noCollDet
          // ZenKit WASM binding: MaterialData.disableCollision
          const disableCollision = Boolean(mat?.disableCollision);
          noCollDetByMaterialId[mi] = disableCollision;

          // Load texture asynchronously using shared utility
          if (texName && texName.length) {
            const textureUrl = tgaNameToCompiledUrl(texName);
            loadCompiledTexAsDataTexture(textureUrl, zenKit).then(tex => {
              if (tex && materialArray[mi]) {
                materialArray[mi].map = tex;
                materialArray[mi].needsUpdate = true;
              }
            }).catch(() => {
              console.warn(`Failed to load texture: ${texName}`);
            });
          }
        }

        // Set up geometry groups for multi-material mesh using shared utility
        buildMaterialGroups(geometry, processed);

        console.log(`Created ${geometry.groups.length} material groups for ${matCount} materials`);

        // Create mesh with materials array
        const threeMesh = new THREE.Mesh(geometry, materialArray);
        threeMesh.name = 'WORLD_MESH';
        threeMesh.scale.x = -1; // Fix mirrored world

        // Store per-triangle material IDs to allow collision filtering (ZenGin `noCollDet` materials).
        // This is used by NPC collision to ignore leaf/foliage polygons like the original engine.
        const triCount = processed.materialIds.size();
        const materialIds = new Int32Array(triCount);
        for (let i = 0; i < triCount; i++) materialIds[i] = processed.materialIds.get(i);
        (threeMesh.geometry as any).userData.materialIds = materialIds;
        (threeMesh as any).userData.noCollDetByMaterialId = noCollDetByMaterialId;

        // Temporary visual debug: render non-collidable materials as a red wireframe overlay
        // so it's easy to verify `noCollDet` parsing. We'll remove this later.
        {
          const overlayMats: THREE.MeshBasicMaterial[] = [];
          for (let mi = 0; mi < matCount; mi++) {
            if (noCollDetByMaterialId[mi]) {
              overlayMats.push(
                new THREE.MeshBasicMaterial({
                  color: 0xff0000,
                  wireframe: true,
                  transparent: true,
                  opacity: 1,
                  depthWrite: false,
                })
              );
            } else {
              overlayMats.push(
                new THREE.MeshBasicMaterial({
                  transparent: true,
                  opacity: 0,
                  depthWrite: false,
                  depthTest: true,
                })
              );
            }
          }

          const overlay = new THREE.Mesh(geometry, overlayMats);
          overlay.name = "WORLD_MESH_NO_COLLDET_DEBUG";
          overlay.renderOrder = 1;
          // Ensure this debug overlay never affects raycasts / collision queries.
          (overlay as any).raycast = () => {};
          threeMesh.add(overlay);
        }

        // Speed up frequent raycasts (NPC ground sampling, picking, etc.) by building a BVH once for the world mesh.
        // If the dependency isn't available for some reason, we fall back to Three.js' default raycast.
        try {
          const bvhMod = await import("three-mesh-bvh");
          const MeshBVH = (bvhMod as any).MeshBVH as any;
          const acceleratedRaycast = (bvhMod as any).acceleratedRaycast as any;
          if (MeshBVH && acceleratedRaycast) {
            (geometry as any).boundsTree = new MeshBVH(geometry, { maxLeafTris: 3 });
            (threeMesh as any).raycast = acceleratedRaycast;
            console.log("[World] BVH built for WORLD_MESH raycasts");
          }
        } catch {
          // Optional optimization only.
        }

        setWorldMesh(threeMesh);
        onLoadingStatus('World loaded successfully!');

      } catch (error) {
        console.error('Failed to load world:', error);
        onLoadingStatus(`Error: ${(error as Error).message}`);
        hasLoadedRef.current = false;
      }
    };

    loadWorld();
  }, [worldPath, onLoadingStatus, onWorldLoaded, onNpcSpawn]);

  return worldMesh ? <primitive object={worldMesh as THREE.Object3D} ref={meshRef} /> : null;
}

export { WorldRenderer };
