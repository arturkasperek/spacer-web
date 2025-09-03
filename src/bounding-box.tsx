/**
 * Bounding Box Component for React Three Fiber
 *
 * Automatically computes and displays a bounding box around 3D objects.
 * Perfect for debugging, selection visualization, or highlighting objects.
 *
 * Usage:
 * <BoundingBox visible={true} color="#ff0000">
 *   <Your3DObject />
 * </BoundingBox>
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface BoundingBoxProps {
  children: React.ReactNode;
  visible?: boolean;
  color?: string;
  lineWidth?: number;
}

export function BoundingBox({
  children,
  visible = true,
  color = '#ffffff',
  lineWidth = 1
}: BoundingBoxProps) {
  const groupRef = useRef<THREE.Group>(null);
  const boxRef = useRef<THREE.LineSegments>(null);

  // Create bounding box geometry
  const boxGeometry = useMemo(() => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(geometry);
    return edges;
  }, []);

  useFrame(() => {
    if (groupRef.current && boxRef.current && visible) {
      // Compute bounding box of children, excluding the bounding box itself
      const box = new THREE.Box3();
      
      groupRef.current.children.forEach((child) => {
        if (child !== boxRef.current) {
          box.expandByObject(child);
        }
      });

      if (!box.isEmpty()) {
        // Update the bounding box position and scale
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        boxRef.current.position.copy(center);
        boxRef.current.scale.set(size.x, size.y, size.z);
      }
    }
  });

  return (
    <group ref={groupRef}>
      {children}
      {visible && (
        <lineSegments ref={boxRef} geometry={boxGeometry}>
          <lineBasicMaterial
            color={color}
            linewidth={lineWidth}
            transparent
            opacity={0.8}
          />
        </lineSegments>
      )}
    </group>
  );
}
