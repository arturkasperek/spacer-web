import { Canvas, useThree } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { XR, createXRStore } from "@react-three/xr";
import * as THREE from "three";
import { Box } from "./box.js";
import { BoxShaders } from "./box-shaders.js";
import { NavigationOverlay } from "./navigation.js";
import { AxesHelper } from "./axes.js";
import { BoundingBox } from "./bounding-box.js";
import { WaterComponent } from "./water.js";
import { SkyComponent } from "./sky.js";
import { createRef, RefObject, useEffect, useMemo, useRef } from "react";
import { CameraControls, CameraControlsRef } from "./camera-controls.js";

const store = createXRStore({});

// Create a ref to hold the main camera
const cameraRef: RefObject<any> = createRef();



function Scene({ cameraControlsRef }: { cameraControlsRef: React.RefObject<CameraControlsRef | null> }) {
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

  const sunVec = useMemo(() => {
    const elevation = 90;
    const azimuth = 180;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    const sun = new THREE.Vector3();
    sun.setFromSphericalCoords(1, phi, theta);
    return sun;
  }, []);

  return (
    <>
      <CameraControls ref={cameraControlsRef} />

      {/* Sky */}
      <SkyComponent sunPosition={sunVec} />

      <AxesHelper />
      <BoundingBox visible={true} color="#ff6b6b">
        <Box position={[-1.2, 0, 0]} />
      </BoundingBox>
      <BoxShaders position={[1.2, 0, 0]} />

      {/* Water surface */}
      <WaterComponent
        position={[-1, -1, 0]}
        size={10000}
        distortionScale={3.7}
        sunDirection={sunVec}
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
        camera={{ position: [0, 0, 20], fov: 90 }}
      >
        <Scene cameraControlsRef={cameraControlsRef} />
      </Canvas>
      <NavigationOverlay onCameraChange={handleCameraChange} />
    </>
  );
}
