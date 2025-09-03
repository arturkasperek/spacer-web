import { Canvas, useThree } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { XR, createXRStore } from "@react-three/xr";
import * as THREE from "three";
import { Box } from "./box.js";
import { NavigationOverlay } from "./navigation.js";
import { AxesHelper } from "./axes.js";
import { BoundingBox } from "./bounding-box.js";
import { WaterComponent } from "./water.js";
import { SkyComponent } from "./sky.js";
import { createRef, RefObject, useRef } from "react";
import { CameraControls, CameraControlsRef } from "./camera-controls.js";

const store = createXRStore({});

// Create a ref to hold the main camera
const cameraRef: RefObject<any> = createRef();



function Scene({ cameraControlsRef }: { cameraControlsRef: React.RefObject<CameraControlsRef | null> }) {
  const { camera } = useThree();

  // Store the camera reference
  cameraRef.current = camera;

  return (
    <>
      <CameraControls ref={cameraControlsRef} />
      <ambientLight intensity={0.1} />
      <directionalLight
        position={[1, 1, 1]}
        intensity={1}
        color="#ffffff"
      />

      {/* Sky */}
      <SkyComponent
        sunPosition={(() => {
          // Convert elevation and azimuth to sun position (like original example)
          const elevation = 10;
          const azimuth = 180;
          const phi = THREE.MathUtils.degToRad(90 - elevation);
          const theta = THREE.MathUtils.degToRad(azimuth);
          const sun = new THREE.Vector3();
          sun.setFromSphericalCoords(1, phi, theta);
          return sun;
        })()}
        turbidity={10}
        rayleigh={2}
        mieCoefficient={0.005}
        mieDirectionalG={0.8}
      />

      <AxesHelper />
      <BoundingBox visible={true} color="#ff6b6b">
        <Box position={[-1.2, 0, 0]} />
      </BoundingBox>
      <Box position={[1.2, 0, 0]} />

      {/* Water surface */}
      <WaterComponent
        position={[-1, -1, 0]}
        size={10000}
        distortionScale={3.7}
        sunDirection={(() => {
          // Same sun position as sky for consistency
          const elevation = 10;
          const azimuth = 180;
          const phi = THREE.MathUtils.degToRad(90 - elevation);
          const theta = THREE.MathUtils.degToRad(azimuth);
          const sun = new THREE.Vector3();
          sun.setFromSphericalCoords(1, phi, theta);
          return sun;
        })()}
        waterColor={0x001e0f}
        sunColor={0xffffff}
      />
    </>
  );
}

export function App() {
  const cameraControlsRef = useRef<CameraControlsRef>(null);

  const handleCameraChange = (position: [number, number, number], lookAt: [number, number, number]) => {
    if (cameraRef.current) {
      // Set camera position
      cameraRef.current.position.set(...position);

      // Calculate the direction vector from position to lookAt
      const direction = new THREE.Vector3();
      direction.subVectors(new THREE.Vector3(...lookAt), new THREE.Vector3(...position));
      direction.normalize();

      // Calculate spherical coordinates for pitch and yaw
      const pitch = Math.asin(direction.y);
      
      // Handle pure Y-axis cases (top/bottom views) where X and Z are ~0
      let yaw = 0;
      if (Math.abs(direction.x) > 0.0001 || Math.abs(direction.z) > 0.0001) {
        yaw = Math.atan2(-direction.x, -direction.z);
      }

      // Apply rotation using the same order as camera controls
      cameraRef.current.rotation.order = 'YXZ';
      cameraRef.current.rotation.x = pitch;
      cameraRef.current.rotation.y = yaw;
      cameraRef.current.rotation.z = 0;
      cameraRef.current.updateProjectionMatrix();

      // Update camera controls mouse state to match the new orientation
      if (cameraControlsRef.current) {
        cameraControlsRef.current.updateMouseState(pitch, yaw);
      }
    }
  };

  return (
    <>
      <Canvas
        gl={{ 
          alpha: false,
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.5
        }}
        camera={{ position: [30, 30, 100], fov: 55 }}
      >
        <Scene cameraControlsRef={cameraControlsRef} />
      </Canvas>
      <NavigationOverlay onCameraChange={handleCameraChange} />
    </>
  );
}
