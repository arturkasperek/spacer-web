import { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import type { World, ZenKit } from '@kolarz3/zenkit';
import { useRapier } from "@react-three/rapier";
import { loadVm, type NpcSpawnCallback } from './vm-manager';
import { loadCameraModes } from "./camera-daedalus";
import { buildThreeJSGeometry, buildMaterialGroups, loadCompiledTexAsDataTexture } from './mesh-utils';
import { tgaNameToCompiledUrl } from './vob-utils';

// World Renderer Component - loads ZenKit and renders world mesh
function WorldRenderer({ worldPath, onLoadingStatus, onWorldLoaded, onNpcSpawn }: Readonly<{
  worldPath: string;
  onLoadingStatus: (status: string) => void;
  onWorldLoaded?: (world: World, zenKit: ZenKit) => void;
  onNpcSpawn?: NpcSpawnCallback;
}>) {
  const { world: rapierWorld, rapier } = useRapier();
  const meshRef = useRef<THREE.Mesh>(null);
  const [worldMesh, setWorldMesh] = useState<THREE.Mesh | null>(null);
  const [worldColliderData, setWorldColliderData] = useState<{ vertices: Float32Array; indices: Uint32Array } | null>(
    null
  );
  const hasLoadedRef = useRef(false);
  const rapierColliderRef = useRef<any>(null);

  useEffect(() => {
    if (!rapierWorld || !rapier) return;
    if (!worldColliderData) return;
    if (rapierColliderRef.current) return;

    const desc = rapier.ColliderDesc.trimesh(worldColliderData.vertices, worldColliderData.indices);

    // Collision groups:
    // - WORLD: membership=1, filter=all (so NPCs can query/collide with it)
    const WORLD_MEMBERSHIP = 0x0001;
    const WORLD_FILTER = 0xffff;
    desc.setCollisionGroups((WORLD_MEMBERSHIP << 16) | WORLD_FILTER);

    rapierColliderRef.current = rapierWorld.createCollider(desc);

    return () => {
      try {
        if (rapierColliderRef.current) {
          rapierWorld.removeCollider(rapierColliderRef.current, true);
          rapierColliderRef.current = null;
        }
      } catch {
        // Best-effort cleanup.
      }
    };
  }, [rapierWorld, rapier, worldColliderData]);

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

        // Build a static Rapier trimesh collider for world collisions (NPC KCC, etc.).
        // We skip triangles marked as `noCollDet` to match ZenGin behavior.
        try {
          const triCount = processed.materialIds.size();
          let keepTriCount = 0;
          for (let t = 0; t < triCount; t++) {
            const matId = processed.materialIds.get(t);
            const disable = Boolean(noCollDetByMaterialId[matId] ?? false);
            if (!disable) keepTriCount++;
          }

          const vertCount = Math.floor(processed.vertices.size() / 8);
          const outVertices = new Float32Array(vertCount * 3);
          const outIndices = new Uint32Array(keepTriCount * 3);

          // Vertex positions are shared via `processed.indices`, so keep a single vertex array
          // and only filter triangle indices. This avoids tripling memory usage.
          for (let v = 0; v < vertCount; v++) {
            const base = v * 8;
            outVertices[v * 3 + 0] = -processed.vertices.get(base + 0); // Bake world mirror (scale.x = -1)
            outVertices[v * 3 + 1] = processed.vertices.get(base + 1);
            outVertices[v * 3 + 2] = processed.vertices.get(base + 2);
          }

          let outI = 0;
          for (let t = 0; t < triCount; t++) {
            const matId = processed.materialIds.get(t);
            const disable = Boolean(noCollDetByMaterialId[matId] ?? false);
            if (disable) continue;

            outIndices[outI++] = processed.indices.get(t * 3 + 0);
            outIndices[outI++] = processed.indices.get(t * 3 + 1);
            outIndices[outI++] = processed.indices.get(t * 3 + 2);
          }

          setWorldColliderData({ vertices: outVertices, indices: outIndices });
        } catch (e) {
          console.warn("[World] Failed to build Rapier trimesh collider:", e);
        }

        setWorldMesh(threeMesh);
        onLoadingStatus('World loaded successfully!');

        // Load VM script and call startup function, but only after the world (and thus waypoints/VOBs) is loaded.
        // This also ensures `onWorldLoaded` can set any global world references used by VM externals.
        onLoadingStatus('Loading VM script...');
        try {
          const cameraModesPromise = loadCameraModes(zenKit).catch((e) => {
            console.warn("Failed to load CAMERA.DAT presets:", e);
            return {};
          });

          const resolveHeroSpawnpoint = (): string => {
            try {
              // Prefer zCVobStartpoint (player start) if ZenKit exposes it.
              // Fallback to NW_XARDAS_START (used by scripts) and finally START.
              const startpoints = (world as any)?.getStartpoints?.();
              if (startpoints && typeof startpoints.size === "function" && typeof startpoints.get === "function") {
                const n = Number(startpoints.size());
                if (Number.isFinite(n) && n > 0) {
                  const sp0 = startpoints.get(0);
                  const name = (sp0?.vobName || sp0?.name || sp0?.objectName || "").trim();
                  if (name) return name;
                }
              }

              const preferWaypoint = "NW_XARDAS_START";
              const r = (world as any)?.findWaypointByName?.(preferWaypoint);
              if (r?.success) return preferWaypoint;
            } catch {
              // ignore
            }
            return "START";
          };
          await loadVm(zenKit, '/SCRIPTS/_COMPILED/GOTHIC.DAT', 'startup_newworld', onNpcSpawn, resolveHeroSpawnpoint());
          await cameraModesPromise;
          console.log('VM loaded successfully');
          onLoadingStatus('VM loaded');
        } catch (vmError) {
          console.warn('Failed to load VM script:', vmError);
          onLoadingStatus(`VM loading failed: ${(vmError as Error).message}`);
          // Continue with world rendering even if VM fails
        }

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
