import { useRef, useEffect, useState } from "react";
import * as THREE from "three";

// World Renderer Component - loads ZenKit and renders world mesh
function WorldRenderer({ worldPath, onLoadingStatus }: Readonly<{
  worldPath: string;
  onLoadingStatus: (status: string) => void;
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
        console.log('🔍 Loading ZenKit...');
        onLoadingStatus('Loading ZenKit...');

        // Import ZenKit WebAssembly module
        const zenkitModule = await import('@kolarz3/zenkit');
        const ZenKitModule = zenkitModule.default;
        const zenKit = await ZenKitModule();

        console.log(`📁 Loading ${worldPath}...`);
        onLoadingStatus(`Loading ${worldPath}...`);

        // Fetch the ZEN file
        const response = await fetch(worldPath);
        if (!response.ok) {
          throw new Error(`Failed to fetch ZEN file: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        console.log('🔧 Processing world data...');
        onLoadingStatus('Processing world data...');

        // Create world and load
        const world = zenKit.createWorld();
        const success = world.loadFromArray(uint8Array);

        if (!success || !world.isLoaded) {
          throw new Error(world.getLastError() || 'Unknown loading error');
        }

        console.log('⚙️ Processing mesh data...');
        onLoadingStatus('Processing mesh data...');

        // Get the world mesh
        const zenMesh = world.mesh;
        const processed = zenMesh.getProcessedMeshData();

        const vertCount = processed.vertices.size();
        const idxCount = processed.indices.size();
        const matCount = processed.materials.size();

        console.log(`✅ World loaded: ${vertCount/8} vertices, ${idxCount/3} triangles, ${matCount} materials`);

        // Build Three.js geometry
        const positions = new Float32Array(idxCount * 3);
        const normals = new Float32Array(idxCount * 3);
        const uvs = new Float32Array(idxCount * 2);

        for (let i = 0; i < idxCount; i++) {
          const vertIdx = processed.indices.get(i);
          const vertBase = vertIdx * 8;

          // Position
          positions[i*3 + 0] = processed.vertices.get(vertBase + 0);
          positions[i*3 + 1] = processed.vertices.get(vertBase + 1);
          positions[i*3 + 2] = processed.vertices.get(vertBase + 2);

          // Normal
          normals[i*3 + 0] = processed.vertices.get(vertBase + 3);
          normals[i*3 + 1] = processed.vertices.get(vertBase + 4);
          normals[i*3 + 2] = processed.vertices.get(vertBase + 5);

          // UV
          uvs[i*2 + 0] = processed.vertices.get(vertBase + 6);
          uvs[i*2 + 1] = processed.vertices.get(vertBase + 7);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

        // Create basic material
        const material = new THREE.MeshBasicMaterial({
          color: 0x888888,
          side: THREE.DoubleSide,
          wireframe: false
        });

        // Create mesh
        const threeMesh = new THREE.Mesh(geometry, material);
        threeMesh.scale.x = -1; // Fix mirrored world

        setWorldMesh(threeMesh);
        console.log('🎉 World loaded successfully!');
        onLoadingStatus('World loaded successfully!');

      } catch (error) {
        console.error('❌ Failed to load world:', error);
        onLoadingStatus(`Error: ${(error as Error).message}`);
        // Reset loading flag on error so user can retry
        hasLoadedRef.current = false;
      }
    };

    loadWorld();
  }, [worldPath]);

  return worldMesh ? <primitive object={worldMesh} ref={meshRef} /> : null;
}

export { WorldRenderer };
