import { Canvas, useThree } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { XR, createXRStore } from "@react-three/xr";
import * as THREE from "three";
import { Box } from "./box.js";
import { NavigationOverlay } from "./navigation.js";
import { AxesHelper } from "./axes.js";
import { BoundingBox } from "./bounding-box.js";
import { createRef, RefObject } from "react";
import { CameraControls } from "./camera-controls.js";

const store = createXRStore({});

// Create a ref to hold the main camera
export const cameraRef: RefObject<any> = createRef();



function Scene() {
  const { camera } = useThree();

  // Store the camera reference
  cameraRef.current = camera;

  return (
    <>
      <CameraControls />
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
  const handleCameraChange = (position: [number, number, number], lookAt: [number, number, number]) => {
    if (cameraRef.current) {
      cameraRef.current.position.set(...position);
      cameraRef.current.lookAt(...lookAt);
      cameraRef.current.updateProjectionMatrix();
    }
  };

  return (
    <>
      <Canvas
        gl={{ alpha: false }}
        camera={{ position: [0, 0, 5], fov: 75 }}
        scene={{ background: new THREE.Color('#404040') }}
      >
        <Scene />
      </Canvas>
      <NavigationOverlay onCameraChange={handleCameraChange} />
    </>
  );
}
