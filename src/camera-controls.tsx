import { useThree, useFrame } from "@react-three/fiber";
import { useEffect, useState, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";

export interface CameraControlsRef {
  updateMouseState: (pitch: number, yaw: number) => void;
}

export const CameraControls = forwardRef<CameraControlsRef>((props, ref) => {
  const { camera, gl } = useThree();
  const [keys, setKeys] = useState({
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    KeyW: false,
    KeyS: false,
    KeyA: false,
    KeyD: false,
    Space: false,
    ShiftLeft: false,
  });

  // Velocity state for smooth movement
  const velocity = useRef({ x: 0, y: 0, z: 0 });
  const acceleration = 15; // How quickly to reach max speed
  const maxSpeed = 10; // Maximum movement speed
  const friction = 0.85; // How quickly to slow down when not pressing keys

  // Mouse state for free camera rotation
  const mouseState = useRef({
    isMouseDown: false,
    lastMouseX: 0,
    lastMouseY: 0,
    pitch: 0,
    yaw: 0,
  });

  // Expose updateMouseState function to parent component
  useImperativeHandle(ref, () => ({
    updateMouseState: (pitch: number, yaw: number) => {
      mouseState.current.pitch = pitch;
      mouseState.current.yaw = yaw;
    }
  }), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      setKeys((prev) => ({ ...prev, [event.code]: true }));
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      setKeys((prev) => ({ ...prev, [event.code]: false }));
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 0) { // Left mouse button
        mouseState.current.isMouseDown = true;
        mouseState.current.lastMouseX = event.clientX;
        mouseState.current.lastMouseY = event.clientY;
        gl.domElement.style.cursor = 'grabbing';
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 0) {
        mouseState.current.isMouseDown = false;
        gl.domElement.style.cursor = 'grab';
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!mouseState.current.isMouseDown) return;

      const deltaX = event.clientX - mouseState.current.lastMouseX;
      const deltaY = event.clientY - mouseState.current.lastMouseY;

      const sensitivity = 0.002; // Reduced from 0.005 to 0.002 for slower movement
      mouseState.current.yaw += deltaX * sensitivity;  // Changed from -= to +=
      mouseState.current.pitch += deltaY * sensitivity; // Changed from -= to +=

      // Clamp pitch to prevent camera flipping
      mouseState.current.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, mouseState.current.pitch));

      mouseState.current.lastMouseX = event.clientX;
      mouseState.current.lastMouseY = event.clientY;
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const zoomSpeed = 0.1;
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);

      camera.position.addScaledVector(direction, -event.deltaY * zoomSpeed);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    gl.domElement.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    gl.domElement.addEventListener('wheel', handleWheel);
    gl.domElement.style.cursor = 'grab';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      gl.domElement.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      gl.domElement.removeEventListener('wheel', handleWheel);
    };
  }, [gl, camera]);

  useFrame((state, delta) => {
    // Apply free camera rotation
    camera.rotation.order = 'YXZ';
    camera.rotation.y = mouseState.current.yaw;
    camera.rotation.x = mouseState.current.pitch;

    // Calculate movement direction relative to camera orientation
    const direction = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    camera.getWorldDirection(direction);
    right.crossVectors(direction, up).normalize();

    // Calculate desired direction based on input
    let inputX = 0;
    let inputY = 0;
    let inputZ = 0;

    if (keys.ArrowUp || keys.KeyW) inputZ += 1;
    if (keys.ArrowDown || keys.KeyS) inputZ -= 1;
    if (keys.ArrowLeft || keys.KeyA) inputX -= 1;
    if (keys.ArrowRight || keys.KeyD) inputX += 1;
    if (keys.Space) inputY += 1;
    if (keys.ShiftLeft) inputY -= 1;

    // Create movement vector relative to camera
    const moveVector = new THREE.Vector3();
    moveVector.addScaledVector(direction, inputZ);
    moveVector.addScaledVector(right, inputX);
    moveVector.addScaledVector(up, inputY);

    // Normalize for consistent speed in all directions
    if (moveVector.length() > 0) {
      moveVector.normalize();
    }

    // Apply acceleration towards desired direction
    const accel = acceleration * delta;
    velocity.current.x += (moveVector.x * maxSpeed - velocity.current.x) * accel;
    velocity.current.y += (moveVector.y * maxSpeed - velocity.current.y) * accel;
    velocity.current.z += (moveVector.z * maxSpeed - velocity.current.z) * accel;

    // Apply friction when no input
    if (moveVector.x === 0) velocity.current.x *= Math.pow(friction, delta * 60);
    if (moveVector.y === 0) velocity.current.y *= Math.pow(friction, delta * 60);
    if (moveVector.z === 0) velocity.current.z *= Math.pow(friction, delta * 60);

    // Apply velocity to camera position
    camera.position.x += velocity.current.x * delta;
    camera.position.y += velocity.current.y * delta;
    camera.position.z += velocity.current.z * delta;
  });

  return null;
});
