import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { NavigationOverlay } from "./navigation.js";
import { AxesHelper } from "./axes.js";
import { SkyComponent } from "./sky.js";
import { createRef, RefObject, useCallback, useEffect, useRef, useState } from "react";
import { CameraControls, CameraControlsRef } from "./camera-controls.js";

// Create a ref to hold the main camera
const cameraRef: RefObject<any> = createRef();

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



function Scene({ cameraControlsRef, worldPath, onLoadingStatus }: Readonly<{
  cameraControlsRef: React.RefObject<CameraControlsRef | null>;
  worldPath: string;
  onLoadingStatus: (status: string) => void;
}>) {
  const { camera } = useThree();

  // Store the camera reference
  cameraRef.current = camera;

  // Reset initial camera rotation to zero
  useEffect(() => {
    camera.rotation.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.updateProjectionMatrix();
    if (cameraControlsRef.current) {
      cameraControlsRef.current.updateMouseState(0, 0);
    }
  }, [camera, cameraControlsRef]);

  return (
    <>
      <CameraControls ref={cameraControlsRef} />

      <AxesHelper />

      {/* World Renderer */}
      <WorldRenderer worldPath={worldPath} onLoadingStatus={onLoadingStatus} />
    </>
  );
}

export function App() {
  const cameraControlsRef = useRef<CameraControlsRef>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>('');

  const handleCameraChange = useCallback((position: [number, number, number], lookAt: [number, number, number]) => {
    if (cameraControlsRef.current) {
      cameraControlsRef.current.setPose(position, lookAt);
    }
  }, []);

  const handleLoadingStatus = useCallback((status: string) => {
    setLoadingStatus(status);
  }, []);

  // Default world path - can be made configurable later
  const worldPath = "/WORLDS/NEWWORLD/NEWWORLD.ZEN";

  return (
    <>
      {/* Loading status display - outside Canvas */}
      {loadingStatus && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          background: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '10px',
          borderRadius: '5px',
          fontSize: '12px',
          fontFamily: 'monospace',
          maxWidth: '400px',
          zIndex: 1000
        }}>
          <div>Loading Status: {loadingStatus}</div>
        </div>
      )}

      <Canvas
        gl={{
          alpha: false,
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.5
        }}
        camera={{ position: [0, 0, 20], fov: 90 }}
      >
        <Scene
          cameraControlsRef={cameraControlsRef}
          worldPath={worldPath}
          onLoadingStatus={handleLoadingStatus}
        />
      </Canvas>
      <NavigationOverlay onCameraChange={handleCameraChange} />
    </>
  );
}
