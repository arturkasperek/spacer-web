import { useThree, useFrame } from "@react-three/fiber";
import { useEffect, useState, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { getPlayerPose } from "./player-runtime";
import { getCameraSettings, useCameraSettings } from "./camera-settings";
import { getCameraMode } from "./camera-daedalus";
import { usePlayerInput } from "./player-input-context";
import { useCameraDebug } from "./camera-debug-context";

declare global {
  interface Window {
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
  const playerInput = usePlayerInput();
  const cameraDebug = useCameraDebug();
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
  // Follow camera mouse offsets
  const userYawOffsetDegRef = useRef(0);
  const userPitchOffsetDegRef = useRef(0);
  const userRange01Ref = useRef<number | null>(null);
  const lastRange01Ref = useRef(0.5);
  const bestRangeOverrideRef = useRef<number | null>(null);
  const smoothedTargetRef = useRef(new THREE.Vector3());
  const hasSmoothedTargetRef = useRef(false);
  const tmpTargetRef = useRef(new THREE.Vector3());
  const tmpTargetDeltaRef = useRef(new THREE.Vector3());
  const smoothedYawDegRef = useRef(0);
  const smoothedElevDegRef = useRef(0);
  const hasSmoothedSpinRef = useRef(false);

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
      // Allow mouse movement when:
      // 1. Mouse is down AND pointer is locked to canvas (normal mode)
      // 2. Pointer is locked to body (fullscreen mode with global pointer lock)
      const canvasPointerLock = isMouseDown && document.pointerLockElement === gl.domElement;
      const globalPointerLock = document.pointerLockElement === document.body;
      
      if (!canvasPointerLock && !globalPointerLock) return;

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

      // Follow camera: mouse rotates the player (like arrow keys)
      const scale = 0.2; // deg per pixel
      
      // Horizontal mouse movement rotates the player
      const dYaw = deltaX * scale;
      playerInput.addMouseYawDelta(dYaw);
      
      // Vertical mouse movement adjusts camera pitch offset
      userPitchOffsetDegRef.current -= deltaY * scale;
      userPitchOffsetDegRef.current = Math.max(-60, Math.min(60, userPitchOffsetDegRef.current));
    };
    document.addEventListener('mousemove', handleMouseMove);

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 0) {
        playerInput.consumeMouseYawDelta(); // Clear on mouse up
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
            // Only exit canvas pointer lock, not global (fullscreen) pointer lock
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
        // Only exit canvas pointer lock, not global (fullscreen) pointer lock
        if (document.pointerLockElement === gl.domElement) {
          document.exitPointerLock();
        }
      }
    };

    const handlePointerLockChange = () => {
      // If user leaves pointer lock via ESC, stop player rotation
      // But only if it's canvas pointer lock, not global (fullscreen) pointer lock
      if (!document.pointerLockElement || document.pointerLockElement === document.body) {
        playerInput.consumeMouseYawDelta();
      }
    };

    // Mouse wheel for movement speed (matching zen-viewer)
    const handleWheel = (event: WheelEvent) => {
      const freeCamera = getCameraSettings().freeCamera;
      if (freeCamera) {
        moveSpeedRef.current += event.deltaY * 0.1;
        moveSpeedRef.current = Math.max(1, Math.min(500, moveSpeedRef.current));
      } else {
        const step = 0.02;
        const delta = Math.sign(event.deltaY);
        if (delta !== 0) {
          const base = userRange01Ref.current ?? lastRange01Ref.current;
          userRange01Ref.current = Math.max(0, Math.min(1, base + delta * step));
        }
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
      playerInput.consumeMouseYawDelta(); // Cleanup
    };
  }, [gl, camera]);

  useEffect(() => {
    bestRangeOverrideRef.current = cameraDebug.state.bestRangeOverride;
  }, [cameraDebug.state.bestRangeOverride]);

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
    if (!followHero) {
      didSnapToHeroRef.current = false;
      hasSmoothedTargetRef.current = false;
      hasSmoothedSpinRef.current = false;
    }

    if (followHero) {
      const pose = getPlayerPose();
      if (pose) {
        const camDef = getCameraMode("CAMMODNORMAL");
        
        // Simple fixed camera behind player
        // Apply debug overrides if set
        const camDefBestRange = Number.isFinite(camDef?.bestRange) ? camDef!.bestRange : 3;
        const camDefMinRange = Number.isFinite(camDef?.minRange) ? camDef!.minRange : 2;
        const camDefMaxRange = Number.isFinite(camDef?.maxRange) ? camDef!.maxRange : 10;
        const camDefBestElev = Number.isFinite(camDef?.bestElevation) ? camDef!.bestElevation : 30;
        const camDefMinElev = Number.isFinite(camDef?.minElevation) ? camDef!.minElevation : 0;
        const camDefMaxElev = Number.isFinite(camDef?.maxElevation) ? camDef!.maxElevation : 90;
        const camDefBestAzimuth = Number.isFinite(camDef?.bestAzimuth) ? camDef!.bestAzimuth : 0;
        const camDefMinAzimuth = Number.isFinite(camDef?.minAzimuth) ? camDef!.minAzimuth : -90;
        const camDefMaxAzimuth = Number.isFinite(camDef?.maxAzimuth) ? camDef!.maxAzimuth : 90;
        const camDefRotOffsetX = Number.isFinite(camDef?.rotOffsetX) ? camDef!.rotOffsetX : 0;
        const camDefRotOffsetY = Number.isFinite(camDef?.rotOffsetY) ? camDef!.rotOffsetY : 0;
        const camDefVeloTrans = Number.isFinite(camDef?.veloTrans) ? camDef!.veloTrans : 0;
        const camDefVeloRot = Number.isFinite(camDef?.veloRot) ? camDef!.veloRot : 0;
        const veloTrans = cameraDebug.state.veloTransOverride ?? camDefVeloTrans;
        const veloRot = cameraDebug.state.veloRotOverride ?? camDefVeloRot;
        
        const bestRangeOverride = bestRangeOverrideRef.current;
        const bestRangeM = bestRangeOverride ?? camDefBestRange;
        const bestElevDeg = cameraDebug.state.bestElevationOverride ?? camDefBestElev;
        const bestAzimuthDeg = cameraDebug.state.bestAzimuthOverride ?? camDefBestAzimuth;
        const rotOffsetXDeg = cameraDebug.state.rotOffsetXOverride ?? camDefRotOffsetX;
        const rotOffsetYDeg = cameraDebug.state.rotOffsetYOverride ?? camDefRotOffsetY;
        const minRangeM = Math.max(0.01, camDefMinRange);
        const maxRangeM = Math.max(minRangeM, camDefMaxRange);
        const rangeSpan = Math.max(0.0001, maxRangeM - minRangeM);
        const minElevDeg = Math.min(camDefMinElev, camDefMaxElev);
        const maxElevDeg = Math.max(camDefMinElev, camDefMaxElev);
        const minAzimuthDeg = Math.min(camDefMinAzimuth, camDefMaxAzimuth);
        const maxAzimuthDeg = Math.max(camDefMinAzimuth, camDefMaxAzimuth);
        
        const playerPos = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
        
        // Use root bone world Y if available, fallback to playerPos.y + 110cm
        const lookAtY = pose.rootBoneWorldY ?? (playerPos.y + 110); // cm - absolute Y in world
        
        // Initialize once
        if (!didSnapToHeroRef.current) {
          didSnapToHeroRef.current = true;
          userYawOffsetDegRef.current = 0;
          userPitchOffsetDegRef.current = 0;
          const bestRangeClamped = Math.max(minRangeM, Math.min(maxRangeM, bestRangeM));
          userRange01Ref.current = (bestRangeClamped - minRangeM) / rangeSpan;
          hasSmoothedSpinRef.current = false;
        }
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
        const desiredTarget = tmpTargetRef.current.set(
          playerPos.x,
          lookAtY,  // Use absolute world Y position of root bone
          playerPos.z
        );
        if (!hasSmoothedTargetRef.current) {
          hasSmoothedTargetRef.current = true;
          smoothedTargetRef.current.copy(desiredTarget);
        } else {
          const speed = Math.max(0, veloTrans) * 100; // cm/s
          if (speed > 0 && delta > 0) {
            const dp = tmpTargetDeltaRef.current.subVectors(desiredTarget, smoothedTargetRef.current);
            const len = dp.length();
            if (len > 0.0001) {
              const step = Math.min(speed * delta, len);
              smoothedTargetRef.current.addScaledVector(dp, step / len);
            }
          } else {
            smoothedTargetRef.current.copy(desiredTarget);
          }
        }
        const target = smoothedTargetRef.current;

        // Calculate camera position: behind and above player
        // Camera stays behind player (no yaw offset - player rotation handles it)
        const desiredAzimuthDeg = bestAzimuthDeg + userYawOffsetDegRef.current;
        const clampedAzimuthDeg = Math.max(
          minAzimuthDeg,
          Math.min(maxAzimuthDeg, desiredAzimuthDeg)
        );
        userYawOffsetDegRef.current = clampedAzimuthDeg - bestAzimuthDeg;
        const minPitchOffsetDeg = minElevDeg - bestElevDeg;
        const maxPitchOffsetDeg = maxElevDeg - bestElevDeg;
        const clampedPitchOffsetDeg = Math.max(
          minPitchOffsetDeg,
          Math.min(maxPitchOffsetDeg, userPitchOffsetDegRef.current)
        );
        userPitchOffsetDegRef.current = clampedPitchOffsetDeg;
        const desiredElevDeg = Math.max(
          minElevDeg,
          Math.min(maxElevDeg, bestElevDeg + clampedPitchOffsetDeg)
        );
        const desiredYawDeg = heroYawDeg + clampedAzimuthDeg;
        let smoothedYawDeg = desiredYawDeg;
        let smoothedElevDeg = desiredElevDeg;
        if (veloRot > 0 && delta > 0) {
          if (!hasSmoothedSpinRef.current) {
            hasSmoothedSpinRef.current = true;
            smoothedYawDegRef.current = desiredYawDeg;
            smoothedElevDegRef.current = desiredElevDeg;
          } else {
            const angleMod = (deg: number) => {
              let v = deg % 360;
              if (v < -180) v += 360;
              if (v > 180) v -= 360;
              return v;
            };
            const yawDelta = angleMod(desiredYawDeg - smoothedYawDegRef.current);
            const yawStep = Math.min(1, veloRot * delta);
            smoothedYawDegRef.current = smoothedYawDegRef.current + yawDelta * yawStep;

            const elevDelta = desiredElevDeg - smoothedElevDegRef.current;
            const elevStep = Math.min(1, veloRot * delta);
            smoothedElevDegRef.current = smoothedElevDegRef.current + elevDelta * elevStep;
          }
          smoothedYawDeg = smoothedYawDegRef.current;
          smoothedElevDeg = smoothedElevDegRef.current;
        } else {
          hasSmoothedSpinRef.current = false;
          smoothedYawDegRef.current = desiredYawDeg;
          smoothedElevDegRef.current = desiredElevDeg;
        }
        const cameraYawDeg = smoothedYawDeg + 180;
        const cameraElevDeg = smoothedElevDeg;
        const cameraYawRad = (cameraYawDeg * Math.PI) / 180;
        const elevationRad = (cameraElevDeg * Math.PI) / 180;
        
        let rangeM: number;
        if (bestRangeOverride !== null) {
          const clamped = Math.max(minRangeM, Math.min(maxRangeM, bestRangeOverride));
          const range01 = (clamped - minRangeM) / rangeSpan;
          userRange01Ref.current = range01;
          lastRange01Ref.current = range01;
          rangeM = clamped;
        } else {
          const range01 = userRange01Ref.current ?? lastRange01Ref.current;
          lastRange01Ref.current = range01;
          rangeM = minRangeM + range01 * (maxRangeM - minRangeM);
        }
        const rangeCm = rangeM * 100;
        
        // Calculate horizontal distance (on XZ plane) based on elevation - in cm
        const horizontalDist = rangeCm * Math.cos(elevationRad);
        const verticalDist = rangeCm * Math.sin(elevationRad);
        
        // Camera position
        const cameraPos = new THREE.Vector3(
          target.x + horizontalDist * Math.sin(cameraYawRad),
          target.y + verticalDist,
          target.z + horizontalDist * Math.cos(cameraYawRad)
        );
        
        camera.position.copy(cameraPos);
        // OpenGothic applies rot_offset to the view matrix (spin - rotOffset),
        // so the camera does not look directly at the target.
        // View yaw should be aligned with hero yaw (camera yaw - 180),
        // otherwise the camera can face away from the player.
        const viewYawDeg = smoothedYawDeg - rotOffsetYDeg;
        const viewYawRad = (viewYawDeg * Math.PI) / 180;
        const viewPitchRad = ((cameraElevDeg - rotOffsetXDeg) * Math.PI) / 180;
        const lookDir = new THREE.Vector3(
          Math.sin(viewYawRad) * Math.cos(viewPitchRad),
          -Math.sin(viewPitchRad),
          Math.cos(viewYawRad) * Math.cos(viewPitchRad)
        );
        const lookAtPos = cameraPos.clone().addScaledVector(lookDir, 100);
        camera.lookAt(lookAtPos);

        return;
      }
    }

    updateMovement(delta);
  });

  return null;
});
