import { Canvas, useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { NavigationOverlay } from "./navigation.js";
import { AxesHelper } from "./axes.js";
import { SkyComponent } from "./sky.js";
import { createRef, RefObject, useCallback, useEffect, useRef, useState } from "react";
import { CameraControls, CameraControlsRef } from "./camera-controls.js";
import { WorldRenderer } from "./world-renderer.js";
import { VOBRenderer } from "./vob-renderer.js";
import { VOBTree } from "./vob-tree.js";

// Create a ref to hold the main camera
const cameraRef: RefObject<any> = createRef();

// Component to track camera position changes
function CameraPositionTracker({ cameraControlsRef, onPositionChange }: {
  cameraControlsRef: React.RefObject<CameraControlsRef | null>;
  onPositionChange: (position: THREE.Vector3) => void;
}) {
  const lastPositionRef = useRef(new THREE.Vector3());

  useFrame(() => {
    if (cameraControlsRef.current) {
      const position = cameraControlsRef.current.getPosition();
      // Only update if position actually changed (to avoid unnecessary re-renders)
      if (!position.equals(lastPositionRef.current)) {
        lastPositionRef.current.copy(position);
        onPositionChange(position);
      }
    }
  });
  return null;
}



function Scene({ cameraControlsRef, worldPath, onLoadingStatus, world, zenKit, onWorldLoaded, cameraPosition, onCameraPositionChange, onVobStats }: Readonly<{
  cameraControlsRef: React.RefObject<CameraControlsRef | null>;
  worldPath: string;
  onLoadingStatus: (status: string) => void;
  world: any;
  zenKit: any;
  onWorldLoaded: (world: any, zenKit: any) => void;
  cameraPosition: THREE.Vector3;
  onCameraPositionChange: (position: THREE.Vector3) => void;
  onVobStats: (stats: { loaded: number; total: number; queue: number; loading: number; meshCache: number; morphCache: number; textureCache: number; }) => void;
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

      <SkyComponent />

      {/* World Renderer */}
      <WorldRenderer worldPath={worldPath} onLoadingStatus={onLoadingStatus} onWorldLoaded={onWorldLoaded} />

      {/* Camera position tracker */}
      <CameraPositionTracker
        cameraControlsRef={cameraControlsRef}
        onPositionChange={onCameraPositionChange}
      />

      {/* VOB Renderer */}
      {world && zenKit && (
        <VOBRenderer
          world={world}
          zenKit={zenKit}
          cameraPosition={cameraPosition}
          onLoadingStatus={onLoadingStatus}
          onVobStats={onVobStats}
        />
      )}
    </>
  );
}

export function App() {
  const cameraControlsRef = useRef<CameraControlsRef>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const [world, setWorld] = useState<any>(null);
  const [zenKit, setZenKit] = useState<any>(null);
  const [cameraPosition, setCameraPosition] = useState(new THREE.Vector3(0, 0, 0));
  const [vobStats, setVobStats] = useState<{
    loaded: number;
    total: number;
    queue: number;
    loading: number;
    meshCache: number;
    morphCache: number;
    textureCache: number;
  } | null>(null);

  const handleCameraChange = useCallback((position: [number, number, number], lookAt: [number, number, number]) => {
    if (cameraControlsRef.current) {
      cameraControlsRef.current.setPose(position, lookAt);
    }
  }, []);

  const handleLoadingStatus = useCallback((status: string) => {
    setLoadingStatus(status);
  }, []);

  const handleWorldLoaded = useCallback((loadedWorld: any, loadedZenKit: any) => {
    setWorld(loadedWorld);
    setZenKit(loadedZenKit);
  }, []);

  const handleCameraPositionChange = useCallback((position: THREE.Vector3) => {
    setCameraPosition(position);
  }, []);

  const handleVobStats = useCallback((stats: {
    loaded: number;
    total: number;
    queue: number;
    loading: number;
    meshCache: number;
    morphCache: number;
    textureCache: number;
  }) => {
    setVobStats(stats);
  }, []);

  // Default world path - can be made configurable later
  const worldPath = "/WORLDS/NEWWORLD/NEWWORLD.ZEN";

  return (
    <>
      {/* VOB Tree - left side panel */}
      <VOBTree world={world} />

      {/* Loading status display - outside Canvas */}
      {loadingStatus && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '330px', // Adjusted to be after the VOB tree
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
          {vobStats && (
            <div style={{ marginTop: '8px', fontSize: '11px', borderTop: '1px solid rgba(255,255,255,0.3)', paddingTop: '8px' }}>
              📦 VOBs: {vobStats.loaded}/{vobStats.total} loaded | Queue: {vobStats.queue} | Loading: {vobStats.loading} | Cache: {vobStats.meshCache} meshes, {vobStats.morphCache} morphs, {vobStats.textureCache} textures
            </div>
          )}
        </div>
      )}

      <Canvas
        gl={{
          alpha: false,
          antialias: true,
          logarithmicDepthBuffer: true,  // Better depth precision for large scenes
          outputColorSpace: THREE.SRGBColorSpace,  // Critical for proper color display
          sortObjects: true,  // Ensure proper depth sorting
          pixelRatio: 1,  // Force 1:1 pixel ratio to match zen-viewer
          powerPreference: 'default',  // Match zen-viewer default
          toneMapping: THREE.NoToneMapping  // Disable tone mapping for more faded appearance
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
          world={world}
          zenKit={zenKit}
          onWorldLoaded={handleWorldLoaded}
          cameraPosition={cameraPosition}
          onCameraPositionChange={handleCameraPositionChange}
          onVobStats={handleVobStats}
        />
      </Canvas>
      <NavigationOverlay onCameraChange={handleCameraChange} />
    </>
  );
}
