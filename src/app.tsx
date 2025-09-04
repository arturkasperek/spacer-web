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
import { createRef, RefObject, useMemo, useRef } from "react";
import { Leva, useControls } from "leva";
import { CameraControls, CameraControlsRef } from "./camera-controls.js";

const store = createXRStore({});

// Create a ref to hold the main camera
const cameraRef: RefObject<any> = createRef();



function Scene({ cameraControlsRef }: { cameraControlsRef: React.RefObject<CameraControlsRef | null> }) {
  const { camera } = useThree();

  // Store the camera reference
  cameraRef.current = camera;

  const controls = useControls('Sky/Water', {
    elevation: { value: 10, min: -5, max: 90, step: 0.1 },
    azimuth: { value: 180, min: -180, max: 180, step: 0.1 },
    turbidity: { value: 10, min: 0, max: 20, step: 0.1 },
    rayleigh: { value: 0.82, min: 0, max: 4, step: 0.01 },
    mieCoefficient: { value: 0.001, min: 0.0, max: 0.02, step: 0.0005 },
    mieDirectionalG: { value: 0.8, min: 0.0, max: 0.999, step: 0.001 },
    mieGlowScale: { value: 0.7, min: 0.1, max: 1.5, step: 0.01 },
    sunDiskDelta: { value: 0.00001, min: 0.0, max: 0.0002, step: 0.000001 },
    exposure: { value: 0.5, min: 0.1, max: 1.5, step: 0.01 },
    debugMode: { value: 0, min: 0, max: 5, step: 1 },
  });

  const sunVec = useMemo(() => {
    const phi = THREE.MathUtils.degToRad(90 - controls.elevation);
    const theta = THREE.MathUtils.degToRad(controls.azimuth);
    const sun = new THREE.Vector3();
    sun.setFromSphericalCoords(1, phi, theta);
    return sun;
  }, [controls.elevation, controls.azimuth]);

  return (
    <>
      <CameraControls ref={cameraControlsRef} />

      {/* Sky */}
      <SkyComponent
        sunPosition={sunVec}
        turbidity={controls.turbidity}
        rayleigh={controls.rayleigh}
        mieCoefficient={controls.mieCoefficient}
        mieDirectionalG={controls.mieDirectionalG}
        mieGlowScale={controls.mieGlowScale}
        sunDiskDelta={controls.sunDiskDelta}
        debugMode={controls.debugMode as 0 | 1 | 2 | 3 | 4 | 5}
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
        camera={{ position: [30, 30, 100], fov: 55 }}
      >
        <Scene cameraControlsRef={cameraControlsRef} />
      </Canvas>
      <Leva collapsed={false} />
      <NavigationOverlay onCameraChange={handleCameraChange} />
    </>
  );
}
