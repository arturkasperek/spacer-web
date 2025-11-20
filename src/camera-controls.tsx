import { useThree, useFrame } from "@react-three/fiber";
import { useEffect, useState, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";

export interface CameraControlsRef {
  updateMouseState: (pitch: number, yaw: number) => void;
  setPose: (position: [number, number, number], lookAt: [number, number, number]) => void;
  getPosition: () => THREE.Vector3;
}

export const CameraControls = forwardRef<CameraControlsRef>((_props, ref) => {
  const { camera, gl } = useThree();
  const [keys, setKeys] = useState({
    KeyW: false,
    KeyS: false,
    KeyA: false,
    KeyD: false,
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    KeyQ: false,
    Space: false,
    KeyZ: false,
    ShiftLeft: false,
  });

  // Camera control variables (matching zen-viewer.html)
  const moveSpeedRef = useRef(25);  // Reduce default speed to reduce grain
  const mouseSensitivity = 0.002;
  let pitch = 0, yaw = 0;
  const velocity = new THREE.Vector3();
  let isMouseDown = false;

  // Expose updateMouseState function to parent component
  useImperativeHandle(ref, () => ({
    updateMouseState: (newPitch: number, newYaw: number) => {
      pitch = newPitch;
      yaw = newYaw;
      updateCameraOrientation();
    },
    setPose: (position: [number, number, number], lookAt: [number, number, number]) => {
      // Set camera position
      camera.position.set(position[0], position[1], position[2]);

      // Compute yaw/pitch from position and lookAt (matching zen-viewer logic)
      const from = new THREE.Vector3(position[0], position[1], position[2]);
      const to = new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2]);
      const dir = new THREE.Vector3().subVectors(to, from).normalize();

      yaw = Math.atan2(-dir.x, -dir.z);
      pitch = Math.asin(dir.y);

      updateCameraOrientation();
    },
    getPosition: () => {
      return camera.position.clone();
    }
  }), [camera]);

  // Camera orientation update function (matching zen-viewer)
  const updateCameraOrientation = () => {
    const quaternion = new THREE.Quaternion();
    quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    camera.quaternion.copy(quaternion);
  };

  useEffect(() => {
    // Initialize camera orientation from current position (matching zen-viewer)
    const initialDirection = new THREE.Vector3(0, 0, -1);
    initialDirection.applyQuaternion(camera.quaternion);
    yaw = Math.atan2(initialDirection.x, initialDirection.z);
    pitch = Math.asin(initialDirection.y);

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore keyboard events when user is typing in an input field
      const activeElement = document.activeElement;
      if (activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable)
      )) {
        return;
      }
      setKeys((prev) => ({ ...prev, [event.code]: true }));
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      // Ignore keyboard events when user is typing in an input field
      const activeElement = document.activeElement;
      if (activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable)
      )) {
        return;
      }
      setKeys((prev) => ({ ...prev, [event.code]: false }));
    };

    // Mouse controls (matching zen-viewer with pointer lock)
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 0) { // Left mouse button
        isMouseDown = true;
        gl.domElement.requestPointerLock();
      }
    };

    document.addEventListener('mousemove', (event: MouseEvent) => {
      if (!isMouseDown || document.pointerLockElement !== gl.domElement) return;

      const deltaX = event.movementX || 0;
      const deltaY = event.movementY || 0;

      yaw -= deltaX * mouseSensitivity;
      pitch -= deltaY * mouseSensitivity;
      pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));

      updateCameraOrientation();
    });

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 0) {
        isMouseDown = false;
        document.exitPointerLock();
      }
    };

    // Mouse wheel for movement speed (matching zen-viewer)
    const handleWheel = (event: WheelEvent) => {
      moveSpeedRef.current += event.deltaY * 0.1;
      moveSpeedRef.current = Math.max(1, Math.min(500, moveSpeedRef.current));
      event.preventDefault();
    };

    window.addEventListener('wheel', handleWheel, { passive: false });

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    gl.domElement.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    gl.domElement.style.cursor = 'grab';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWheel);
      gl.domElement.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [gl, camera]);

  // Movement update function (matching zen-viewer)
  const updateMovement = (_delta?: number) => {
    velocity.set(0, 0, 0);

    // Movement directions relative to camera (matching zen-viewer)
    const forward = new THREE.Vector3(0, 0, -1);
    const right = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);

    forward.applyQuaternion(camera.quaternion);
    right.applyQuaternion(camera.quaternion);

    // WASD or Arrow keys (matching zen-viewer controls)
    if (keys['KeyW'] || keys['ArrowUp']) {
      velocity.add(forward);
    }
    if (keys['KeyS'] || keys['ArrowDown']) {
      velocity.sub(forward);
    }
    if (keys['KeyA'] || keys['ArrowLeft']) {
      velocity.sub(right);
    }
    if (keys['KeyD'] || keys['ArrowRight']) {
      velocity.add(right);
    }
    if (keys['KeyQ'] || keys['Space']) {
      velocity.add(up);
    }
    if (keys['KeyZ'] || keys['ShiftLeft']) {
      velocity.sub(up);
    }

    // Normalize and apply speed (matching zen-viewer)
    if (velocity.length() > 0) {
      velocity.normalize().multiplyScalar(moveSpeedRef.current);
      camera.position.add(velocity);
    }
  };

  useFrame((_state, delta) => {
    updateMovement(delta);
  });

  return null;
});
