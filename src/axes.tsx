import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';

function BillboardText({ children, ...props }: any) {
  const textRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  useFrame(() => {
    if (textRef.current) {
      textRef.current.lookAt(camera.position);
    }
  });

  return (
    <Text ref={textRef} {...props}>
      {children}
    </Text>
  );
}

export function AxesHelper() {
  return (
    <group position={[0, 0, 0]}>
      {/* X-axis (Red) */}
      <group>
        <line>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([0, 0, 0, 2, 0, 0]), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#ff0000" />
        </line>
        {/* X-axis arrow head */}
        <mesh position={[2.2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.1, 0.3, 8]} />
          <meshBasicMaterial color="#ff0000" />
        </mesh>
        {/* X-axis label */}
        <BillboardText
          position={[2.5, 0.1, 0]}
          fontSize={0.3}
          color="#ff0000"
          anchorX="center"
          anchorY="middle"
        >
          X
        </BillboardText>
      </group>

      {/* Y-axis (Green) */}
      <group>
        <line>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([0, 0, 0, 0, 2, 0]), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#00ff00" />
        </line>
        {/* Y-axis arrow head */}
        <mesh position={[0, 2.2, 0]}>
          <coneGeometry args={[0.1, 0.3, 8]} />
          <meshBasicMaterial color="#00ff00" />
        </mesh>
        {/* Y-axis label */}
        <BillboardText
          position={[0.1, 2.5, 0]}
          fontSize={0.3}
          color="#00ff00"
          anchorX="center"
          anchorY="middle"
        >
          Y
        </BillboardText>
      </group>

      {/* Z-axis (Blue) */}
      <group>
        <line>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([0, 0, 0, 0, 0, 2]), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#0000ff" />
        </line>
        {/* Z-axis arrow head */}
        <mesh position={[0, 0, 2.2]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.1, 0.3, 8]} />
          <meshBasicMaterial color="#0000ff" />
        </mesh>
        {/* Z-axis label */}
        <BillboardText
          position={[0, 0.1, 2.5]}
          fontSize={0.3}
          color="#0000ff"
          anchorX="center"
          anchorY="middle"
        >
          Z
        </BillboardText>
      </group>
    </group>
  );
}
