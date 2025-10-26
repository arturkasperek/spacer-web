import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { NavigationOverlay } from "./navigation.js";
import { AxesHelper } from "./axes.js";
import { SkyComponent } from "./sky.js";
import { createRef, RefObject, useCallback, useEffect, useRef, useState } from "react";
import { CameraControls, CameraControlsRef } from "./camera-controls.js";
import { WorldRenderer } from "./world-renderer.js";

// Create a ref to hold the main camera
const cameraRef: RefObject<any> = createRef();



function Scene({ cameraControlsRef, worldPath, onLoadingStatus }: Readonly<{
  cameraControlsRef: React.RefObject<CameraControlsRef | null>;
  worldPath: string;
  onLoadingStatus: (status: string) => void;
}>) {
  const { camera } = useThree();

  // Store the camera reference
  cameraRef.current = camera;

  // Set initial camera orientation to match zen-viewer.html
  useEffect(() => {
    camera.lookAt(-1, 0, 0); // Look along positive X axis
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
          logarithmicDepthBuffer: true,  // Better depth precision for large scenes
          outputColorSpace: THREE.SRGBColorSpace,  // Critical for proper color display
          sortObjects: true  // Ensure proper depth sorting
        }}
        camera={{
          position: [0, 0, 0],
          fov: 75,
          near: 1.0,
          far: 100000
        }}
        style={{ background: '#222222' }}
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
