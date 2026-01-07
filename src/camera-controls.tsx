import { useThree, useFrame } from "@react-three/fiber";
import { useEffect, useState, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { getPlayerPose } from "./player-runtime";
import { getCameraSettings, useCameraSettings } from "./camera-settings";
import { getCameraMode } from "./camera-daedalus";

declare global {
  interface Window {
    __heroMouseYawDeltaDeg?: number;
    __cameraZoomDebug?: boolean;
  }
}

export interface CameraControlsRef {
  updateMouseState: (pitch: number, yaw: number) => void;
  setPose: (position: [number, number, number], lookAt: [number, number, number]) => void;
  getPosition: () => THREE.Vector3;
}

export const CameraControls = forwardRef<CameraControlsRef>((_props, ref) => {
  const { camera, gl } = useThree();
  const cameraSettings = useCameraSettings();
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
  const didSnapToHeroRef = useRef(false);

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
      const freeCamera = getCameraSettings().freeCamera;
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
      const freeCamera = getCameraSettings().freeCamera;
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

    const handleMouseMove = (event: MouseEvent) => {
      if (!isMouseDown || document.pointerLockElement !== gl.domElement) return;

      const freeCamera = getCameraSettings().freeCamera;
      const deltaX = event.movementX || 0;
      const deltaY = event.movementY || 0;

      if (freeCamera) {
        yaw -= deltaX * mouseSensitivity;
        pitch -= deltaY * mouseSensitivity;
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
        updateCameraOrientation();
        return;
      }
    };
    document.addEventListener('mousemove', handleMouseMove);

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

    const handlePointerLockChange = () => {
      // Pointer lock change handler
    };

    // Mouse wheel for movement speed (matching zen-viewer)
    const handleWheel = (event: WheelEvent) => {
      const freeCamera = getCameraSettings().freeCamera;
      if (freeCamera) {
        moveSpeedRef.current += event.deltaY * 0.1;
        moveSpeedRef.current = Math.max(1, Math.min(500, moveSpeedRef.current));
      }
      event.preventDefault();
    };

    window.addEventListener('wheel', handleWheel, { passive: false });

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    gl.domElement.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    gl.domElement.style.cursor = 'grab';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWheel);
      gl.domElement.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
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
    const freeCamera = cameraSettings.freeCamera;
    const followHero = !freeCamera;
    if (!followHero) didSnapToHeroRef.current = false;

    if (followHero) {
      const pose = getPlayerPose();
      if (pose) {
        const camDef = getCameraMode("CAMMODNORMAL");
        
        // Initialize once
        if (!didSnapToHeroRef.current) {
          didSnapToHeroRef.current = true;
        }

        // Simple fixed camera behind player
        const bestRangeM = Number.isFinite(camDef?.bestRange) ? camDef!.bestRange : 3;
        const bestElevDeg = Number.isFinite(camDef?.bestElevation) ? camDef!.bestElevation : 30;
        const lookAtHeight = 110; // cm - height on player model where camera looks at

        const playerPos = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
        const playerQuat = new THREE.Quaternion(
          pose.quaternion.x,
          pose.quaternion.y,
          pose.quaternion.z,
          pose.quaternion.w
        );

        // Get player forward direction
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(playerQuat);
        forward.y = 0;
        if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
        else forward.normalize();

        // Calculate hero yaw
        const heroYawDeg = (Math.atan2(forward.x, forward.z) * 180) / Math.PI;
        
        // Camera target (look at point on player) - all positions in cm
        const target = new THREE.Vector3(
          playerPos.x,
          playerPos.y + lookAtHeight,  // No division - positions are in cm
          playerPos.z
        );

        // Calculate camera position: behind and above player
        // Convert bestRange from meters to cm
        const bestRangeCm = bestRangeM * 100;
        const cameraYawDeg = heroYawDeg + 180;
        const cameraYawRad = (cameraYawDeg * Math.PI) / 180;
        const elevationRad = (bestElevDeg * Math.PI) / 180;
        
        // Calculate horizontal distance (on XZ plane) based on elevation - in cm
        const horizontalDist = bestRangeCm * Math.cos(elevationRad);
        const verticalDist = bestRangeCm * Math.sin(elevationRad);
        
        // Camera position
        const cameraPos = new THREE.Vector3(
          target.x + horizontalDist * Math.sin(cameraYawRad),
          target.y + verticalDist,
          target.z + horizontalDist * Math.cos(cameraYawRad)
        );
        
        camera.position.copy(cameraPos);
        camera.lookAt(target);
        return;
      }
    }

    updateMovement(delta);
  });

  return null;
});
