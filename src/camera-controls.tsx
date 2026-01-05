import { useThree, useFrame } from "@react-three/fiber";
import { useEffect, useState, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { getPlayerPose } from "./player-runtime";

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
  
  // Track mouse down for quick click detection
  const mouseDownTimeRef = useRef<number>(0);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const isQuickClickRef = useRef(false);
  const pointerLockTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const followCameraPosRef = useRef(new THREE.Vector3());
  const didSnapToHeroRef = useRef(false);
  const tmpPlayerPosRef = useRef(new THREE.Vector3());
  const tmpPlayerQuatRef = useRef(new THREE.Quaternion());
  const tmpForwardRef = useRef(new THREE.Vector3());
  const tmpDesiredPosRef = useRef(new THREE.Vector3());
  const tmpLookAtRef = useRef(new THREE.Vector3());

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
      // Arrow keys are reserved for other interactions (e.g. NPC debug/manual control).
      if (event.code.startsWith("Arrow")) return;
      const qs = new URLSearchParams(window.location.search);
      const freeCamera = qs.has("freeCamera");
      // In manual NPC control mode, Space is used for melee attack.
      if (event.code === "Space" && !freeCamera) {
        return;
      }
      // In manual NPC control mode, Shift is used as a run/walk toggle.
      if (
        (event.code === "ShiftLeft" || event.code === "ShiftRight") &&
        !freeCamera
      ) {
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
      // Arrow keys are reserved for other interactions (e.g. NPC debug/manual control).
      if (event.code.startsWith("Arrow")) return;
      const qs = new URLSearchParams(window.location.search);
      const freeCamera = qs.has("freeCamera");
      // In manual NPC control mode, Space is used for melee attack.
      if (event.code === "Space" && !freeCamera) {
        return;
      }
      // In manual NPC control mode, Shift is used as a run/walk toggle.
      if (
        (event.code === "ShiftLeft" || event.code === "ShiftRight") &&
        !freeCamera
      ) {
        return;
      }
      setKeys((prev) => ({ ...prev, [event.code]: false }));
    };

    // Mouse controls (matching zen-viewer with pointer lock)
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 0) { // Left mouse button
        isMouseDown = true;
        mouseDownTimeRef.current = Date.now();
        mouseDownPosRef.current = { x: event.clientX, y: event.clientY };
        isQuickClickRef.current = false;
        
        // Clear any existing timeout
        if (pointerLockTimeoutRef.current) {
          clearTimeout(pointerLockTimeoutRef.current);
        }
        
        // Delay pointer lock to allow quick clicks
        pointerLockTimeoutRef.current = setTimeout(() => {
          if (isMouseDown && !isQuickClickRef.current) {
            gl.domElement.requestPointerLock();
          }
          pointerLockTimeoutRef.current = null;
        }, 200);
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
        const clickDuration = Date.now() - mouseDownTimeRef.current;
        const mouseDownPos = mouseDownPosRef.current;
        
        // Clear pointer lock timeout if it exists
        if (pointerLockTimeoutRef.current) {
          clearTimeout(pointerLockTimeoutRef.current);
          pointerLockTimeoutRef.current = null;
        }
        
        // Check if it was a quick click (< 120ms and < 5px movement)
        if (mouseDownPos && clickDuration < 120) {
          const moveDistance = Math.sqrt(
            Math.pow(event.clientX - mouseDownPos.x, 2) + 
            Math.pow(event.clientY - mouseDownPos.y, 2)
          );
          
          if (moveDistance < 5) {
            isQuickClickRef.current = true;
            // Don't request pointer lock for quick clicks
            if (document.pointerLockElement === gl.domElement) {
              document.exitPointerLock();
            }
            // Dispatch a click event for VOB selection
            gl.domElement.dispatchEvent(new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              clientX: event.clientX,
              clientY: event.clientY,
              button: event.button
            }));
            isMouseDown = false;
            return;
          }
        }
        
        isMouseDown = false;
        if (document.pointerLockElement === gl.domElement) {
          document.exitPointerLock();
        }
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

    // WASD movement
    if (keys['KeyW']) {
      velocity.add(forward);
    }
    if (keys['KeyS']) {
      velocity.sub(forward);
    }
    if (keys['KeyA']) {
      velocity.sub(right);
    }
    if (keys['KeyD']) {
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
    const qs = (() => {
      try {
        return typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      } catch {
        return null;
      }
    })();

    const freeCamera = Boolean(qs?.has("freeCamera"));
    const followHero = !freeCamera && !Boolean(qs?.has("noFollowHero"));
    if (!followHero) didSnapToHeroRef.current = false;

    if (followHero) {
      const pose = getPlayerPose();
      if (pose) {
        const followDistance = 220;
        const followHeight = 140;
        const lookAtHeight = 110;

        const playerPos = tmpPlayerPosRef.current.set(pose.position.x, pose.position.y, pose.position.z);
        const playerQuat = tmpPlayerQuatRef.current.set(
          pose.quaternion.x,
          pose.quaternion.y,
          pose.quaternion.z,
          pose.quaternion.w
        );

        const forward = tmpForwardRef.current.set(0, 0, 1).applyQuaternion(playerQuat);
        forward.y = 0;
        if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
        else forward.normalize();

        const desiredPos = tmpDesiredPosRef.current.copy(playerPos).addScaledVector(forward, -followDistance);
        desiredPos.y = playerPos.y + followHeight;

        const lookAt = tmpLookAtRef.current.copy(playerPos);
        lookAt.y = playerPos.y + lookAtHeight;

        const camPos = camera.position;

        if (!didSnapToHeroRef.current) {
          didSnapToHeroRef.current = true;
          followCameraPosRef.current.copy(desiredPos);
        } else {
          const t = 1 - Math.exp(-10 * Math.max(0, delta));
          followCameraPosRef.current.lerp(desiredPos, t);
        }
        camPos.copy(followCameraPosRef.current);
        camera.lookAt(lookAt);
        return;
      }
    }

    updateMovement(delta);
  });

  return null;
});
