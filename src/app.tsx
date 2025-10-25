import { Canvas, useThree } from "@react-three/fiber";
import { createXRStore } from "@react-three/xr";
import * as THREE from "three";
import { NavigationOverlay } from "./navigation.js";
import { AxesHelper } from "./axes.js";
import { SkyComponent } from "./sky.js";
import { createRef, RefObject, useEffect, useRef, useState } from "react";
import { CameraControls, CameraControlsRef } from "./camera-controls.js";

const store = createXRStore({});

// Create a ref to hold the main camera
const cameraRef: RefObject<any> = createRef();

// ZenKit Test Component
function ZenKitTest() {
  const [zenKitStatus, setZenKitStatus] = useState<string>('Loading ZenKit...');

  useEffect(() => {
    const testZenKit = async () => {
      try {
        // Import ZenKit WebAssembly module
        // Use dynamic import with proper error handling
        const zenkitModule = await import('@kolarz3/zenkit');
        const ZenKitModule = zenkitModule.default;
        const zk = await ZenKitModule();

        const version = zk.getZenKitVersion();
        setZenKitStatus(`✅ ZenKit ${version} loaded successfully!`);

        // Test basic functionality
        try {
          // Test creating a texture instance
          new zk.Texture();
          console.log('✅ Texture class instantiated successfully');

          // Test creating a world instance
          zk.createWorld();
          console.log('✅ World class instantiated successfully');

          // Test creating a mesh instance
          zk.createMesh();
          console.log('✅ Mesh class instantiated successfully');

          setZenKitStatus(prev => `${prev}\n✅ All core classes working!`);

        } catch (error) {
          console.error('❌ Error testing ZenKit classes:', error);
          setZenKitStatus(prev => `${prev}\n❌ Error testing classes: ${(error as Error).message}`);
        }

      } catch (error) {
        console.error('❌ Error loading ZenKit:', error);
        setZenKitStatus(`❌ Failed to load ZenKit: ${(error as Error).message}`);
      }
    };

    testZenKit();
  }, []);

  return (
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
      whiteSpace: 'pre-line',
      zIndex: 1000
    }}>
      <div><strong>ZenKit Status:</strong></div>
      <div>{zenKitStatus}</div>
    </div>
  );
}



function Scene({ cameraControlsRef }: Readonly<{ cameraControlsRef: React.RefObject<CameraControlsRef | null> }>) {
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

      {/* Sky */}
      <SkyComponent />

      <AxesHelper />
    </>
  );
}

export function App() {
  const cameraControlsRef = useRef<CameraControlsRef>(null);

  const handleCameraChange = (position: [number, number, number], lookAt: [number, number, number]) => {
    if (cameraControlsRef.current) {
      cameraControlsRef.current.setPose(position, lookAt);
    }
  };

  return (
    <>
      <ZenKitTest />
      <Canvas
        gl={{
          alpha: false,
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.5
        }}
        camera={{ position: [0, 0, 20], fov: 90 }}
      >
        <Scene cameraControlsRef={cameraControlsRef} />
      </Canvas>
      <NavigationOverlay onCameraChange={handleCameraChange} />
    </>
  );
}
