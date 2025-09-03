import { Canvas, useThree } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { XR, createXRStore } from "@react-three/xr";
import * as THREE from "three";
import { Box } from "./box.js";
import { NavigationOverlay } from "./navigation.js";
import { AxesHelper } from "./axes.js";
import { BoundingBox } from "./bounding-box.js";
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
      <ambientLight intensity={Math.PI / 2} />
      <spotLight
        position={[10, 10, 10]}
        angle={0.15}
        penumbra={1}
        decay={0}
        intensity={Math.PI}
      />
      <pointLight
        position={[-10, -10, -10]}
        decay={0}
        intensity={Math.PI}
      />

      <AxesHelper />
      <BoundingBox visible={true} color="#ff6b6b">
        <Box position={[-1.2, 0, 0]} />
      </BoundingBox>
      <Box position={[1.2, 0, 0]} />
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
        gl={{ alpha: false }}
        camera={{ position: [0, 0, 5], fov: 75 }}
        scene={{ background: new THREE.Color('#404040') }}
      >
        <Scene cameraControlsRef={cameraControlsRef} />
      </Canvas>
      <NavigationOverlay onCameraChange={handleCameraChange} />
    </>
  );
}
