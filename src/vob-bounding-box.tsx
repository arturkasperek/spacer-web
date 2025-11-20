import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VOBBoundingBoxProps {
  vobObject: THREE.Object3D | null;
  visible?: boolean;
  color?: string;
}

/**
 * Renders a 3D bounding box around a VOB object
 */
export function VOBBoundingBox({
  vobObject,
  visible = true,
  color = '#00ff00'
}: VOBBoundingBoxProps) {
  const boxRef = useRef<THREE.LineSegments>(null);

  // Create bounding box geometry (unit cube edges)
  const boxGeometry = useMemo(() => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(geometry);
    return edges;
  }, []);

  useFrame(() => {
    if (!vobObject || !boxRef.current || !visible) {
      if (boxRef.current) {
        boxRef.current.visible = false;
      }
      return;
    }

    // Compute bounding box of the VOB object
    const box = new THREE.Box3();
    box.setFromObject(vobObject);

    if (!box.isEmpty()) {
      // Get center and size
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      // Update the bounding box position and scale
      boxRef.current.position.copy(center);
      boxRef.current.scale.set(size.x, size.y, size.z);
      boxRef.current.visible = true;
    } else {
      boxRef.current.visible = false;
    }
  });

  if (!visible || !vobObject) {
    return null;
  }

  return (
    <lineSegments ref={boxRef} geometry={boxGeometry}>
      <lineBasicMaterial
        color={color}
        linewidth={3}
        transparent
        opacity={1.0}
        depthTest={true}
        depthWrite={false}
      />
    </lineSegments>
  );
}

