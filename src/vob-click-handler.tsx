import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vob } from '@kolarz3/zenkit';

interface VobClickHandlerProps {
  onVobClick?: (vob: Vob) => void;
}

export function VobClickHandler({ onVobClick }: VobClickHandlerProps) {
  const { camera, scene, gl } = useThree();

  useEffect(() => {
    if (!onVobClick) return;

    const raycaster = new THREE.Raycaster();

    const handleClick = (event: MouseEvent) => {
      // Only handle left clicks
      if (event.button !== 0) return;

      // Calculate mouse position in normalized device coordinates (-1 to +1)
      const rect = gl.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      // Update raycaster with camera and mouse position
      raycaster.setFromCamera(mouse, camera);

      // Find all intersected objects
      const intersects = raycaster.intersectObjects(scene.children, true);

      // Find the first intersected object that has a VOB reference
      for (const intersect of intersects) {
        let obj: THREE.Object3D | null = intersect.object;
        
        // Traverse up the object hierarchy to find VOB reference
        while (obj) {
          if (obj.userData.vob) {
            const vob = obj.userData.vob as Vob;
            onVobClick(vob);
            return;
          }
          obj = obj.parent;
        }
      }
    };

    gl.domElement.addEventListener('click', handleClick);
    
    return () => {
      gl.domElement.removeEventListener('click', handleClick);
    };
  }, [camera, scene, gl, onVobClick]);

  return null;
}

