import { useRef, useMemo } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

interface WaterProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  size?: number;
  waterNormals?: string;
  sunDirection?: THREE.Vector3;
  sunColor?: THREE.Color | number;
  waterColor?: THREE.Color | number;
  distortionScale?: number;
  alpha?: number;
  resolution?: number;
}

export function WaterComponent({
  position = [0, 0, 0],
  rotation = [-Math.PI / 2, 0, 0],
  scale: _scale = [1, 1, 1],
  size = 10000,
  waterNormals = '/assets/water/water.jpg',
  sunDirection = new THREE.Vector3(0.70707, 0.70707, 0.0),
  sunColor = 0xffffff,
  waterColor = 0x001e0f,
  distortionScale = 3.7,
  alpha = 1.0,
  resolution: _resolution = 0.5,
}: WaterProps) {
  const waterRef = useRef<Water>(null);

  // Load the water normals texture
  const waterNormalsTexture = useLoader(THREE.TextureLoader, waterNormals);

  // Create water geometry
  const waterGeometry = useMemo(() => {
    return new THREE.PlaneGeometry(size, size);
  }, [size]);

  // Configure texture wrapping
  useMemo(() => {
    if (waterNormalsTexture) {
      waterNormalsTexture.wrapS = waterNormalsTexture.wrapT = THREE.RepeatWrapping;
    }
  }, [waterNormalsTexture]);

  // Create water using Three.js Water class
  const water = useMemo(() => {
    if (!waterNormalsTexture) return null;

    const water = new Water(waterGeometry, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: waterNormalsTexture,
      sunDirection: sunDirection.clone().normalize(),
      sunColor: typeof sunColor === 'number' ? sunColor : sunColor.getHex(),
      waterColor: typeof waterColor === 'number' ? waterColor : waterColor.getHex(),
      distortionScale: distortionScale,
      fog: false,
      alpha: alpha,
    });

    water.rotation.x = rotation[0];
    water.rotation.y = rotation[1];
    water.rotation.z = rotation[2];
    water.position.set(position[0], position[1], position[2]);

    return water;
  }, [waterGeometry, waterNormalsTexture, sunDirection, sunColor, waterColor, distortionScale, alpha, position, rotation]);

  // Update water time uniform
  useFrame(() => {
    if (waterRef.current) {
      waterRef.current.material.uniforms.time.value += 1.0 / 60.0;
    }
  });

  if (!water) return null;

  return <primitive ref={waterRef} object={water} />;
}
