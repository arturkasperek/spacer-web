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
  const { camera, gl, scene } = useThree();
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

  // OpenGothic-like follow camera state (degrees + centimeters/meters, matching Camera.dat conventions).
  const userRange01Ref = useRef<number>(0.25); // 0..1
  const targetVeloRef = useRef(0);
  const srcRangeMRef = useRef<number | null>(null); // meters
  const dstRangeMRef = useRef<number | null>(null); // meters

  const srcSpinDegRef = useRef(new THREE.Vector3()); // x=elev, y=yaw, z unused
  const dstSpinDegRef = useRef(new THREE.Vector3());

  const srcTargetRef = useRef(new THREE.Vector3());
  const dstTargetRef = useRef(new THREE.Vector3());

  const cameraPosRef = useRef(new THREE.Vector3());
  const originRef = useRef(new THREE.Vector3());
  const rotOffsetDegRef = useRef(new THREE.Vector3());
  const offsetAngDegRef = useRef(new THREE.Vector3());

  const lastManualCamInputAtRef = useRef(0);
  const userYawOffsetDegRef = useRef(0);
  const userPitchOffsetDegRef = useRef(0);
  const lastEffectiveRangeMRef = useRef<number | null>(null);
  const lastCollisionMaxRangeMRef = useRef<number | null>(null);
  const zoomDebugRef = useRef({
    lastLogAtMs: 0,
    lastWheelAtMs: 0,
    activeUntilMs: 0,
    sessionId: 0,
    frameLogsThisSession: 0,
    lastClamp: false,
    lastEffectiveRangeM: null as number | null,
    lastDesiredRangeM: null as number | null,
  });
  const tmpPlayerPosRef = useRef(new THREE.Vector3());
  const tmpPlayerQuatRef = useRef(new THREE.Quaternion());
  const tmpForwardRef = useRef(new THREE.Vector3());
  const tmpDesiredPosRef = useRef(new THREE.Vector3());
  const tmpDesiredOriginCapRef = useRef(new THREE.Vector3());
  const tmpLookAtRef = useRef(new THREE.Vector3());
  const tmpTargetNoOffsetRef = useRef(new THREE.Vector3());
  const tmpDirRef = useRef(new THREE.Vector3());
  const tmpRayDirRef = useRef(new THREE.Vector3());
  const tmpRayDir2Ref = useRef(new THREE.Vector3());
  const tmpRayDir3Ref = useRef(new THREE.Vector3());
  const tmpRayDir4Ref = useRef(new THREE.Vector3());
  const tmpRayRightRef = useRef(new THREE.Vector3());
  const tmpRayUpRef = useRef(new THREE.Vector3());
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const tmpRayOriginRef = useRef(new THREE.Vector3());

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

  const angleModDeg = (d: number): number => {
    let a = d % 360;
    if (a > 180) a -= 360;
    if (a < -180) a += 360;
    return a;
  };

  const followAngDeg = (current: number, dest: number, speed: number, dtSec: number): number => {
    const da = angleModDeg(dest - current);
    const shift = da * Math.min(1, Math.max(0, speed) * dtSec);
    if (Math.abs(da) < 0.01 || dtSec < 0) return dest;

    const min = -45;
    const max = 45;
    if (da > max + 1) return current + (da - max);
    if (da < min - 1) return current + (da - min);
    return current + shift;
  };

  const followPosOpenGothic = (
    current: THREE.Vector3,
    dest: THREE.Vector3,
    defVeloTrans: number,
    dtSec: number
  ): void => {
    const dp = tmpDirRef.current.copy(dest).sub(current);
    const len = dp.length();

    if (dtSec <= 0) {
      current.copy(dest);
      return;
    }
    if (len <= 0.0001) return;

    // OpenGothic: dynamic velocity based on distance.
    const mul = 2.1;
    const mul2 = 10;
    targetVeloRef.current = targetVeloRef.current + (len - targetVeloRef.current) * Math.min(1, dtSec * mul2);

    const inertiaTarget = true;
    const veloTransCmPerSec = inertiaTarget
      ? Math.min(defVeloTrans * 100, targetVeloRef.current * mul)
      : defVeloTrans * 100;

    const tr = Math.min(veloTransCmPerSec * dtSec, len);
    const k = tr / len;
    current.addScaledVector(dp, k);
  };

  const calcOffsetAngles = (origin: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 => {
    const sXZ = tmpDirRef.current.copy(origin).sub(target);
    const y0 = Math.atan2(sXZ.x, sXZ.z) * 180 / Math.PI;
    const x0 = Math.atan2(sXZ.y, Math.hypot(sXZ.x, sXZ.z)) * 180 / Math.PI;
    return new THREE.Vector3(x0, -y0, 0);
  };

  const calcOffsetAnglesDelta = (srcOrigin: THREE.Vector3, dstOrigin: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 => {
    const src = tmpDesiredPosRef.current.copy(srcOrigin).sub(target); src.y = 0;
    const dst = tmpLookAtRef.current.copy(dstOrigin).sub(target); dst.y = 0;

    let k = 0;
    const dstLen = dst.length();
    if (dstLen > 0.0001) {
      const dot = src.dot(dst);
      k = dot / dstLen;
      k = Math.max(0, Math.min((k / 100), 1));
    }

    const a0 = calcOffsetAngles(srcOrigin, target);
    const a1 = calcOffsetAngles(dstOrigin, target);
    const da = new THREE.Vector3(
      angleModDeg(a1.x - a0.x),
      angleModDeg(a1.y - a0.y),
      angleModDeg(a1.z - a0.z)
    );
    const offsetAngleMul = 0.1;
    return da.multiplyScalar(k * offsetAngleMul);
  };

  const calcCameraCollisionMultiRay = (
    target: THREE.Vector3,
    desiredOrigin: THREE.Vector3,
    distCm: number,
    cameraForFov: THREE.Camera,
    worldMesh: THREE.Mesh,
  ): THREE.Vector3 => {
    const paddingCm = 50;
    const n = 1;
    const nn = 1;

    if (!Number.isFinite(distCm) || distCm <= 0) return desiredOrigin;

    const fovDeg = (cameraForFov as any)?.fov;
    const aspect = (cameraForFov as any)?.aspect;
    const fov = Number.isFinite(fovDeg) ? Number(fovDeg) : 50;
    const a = Number.isFinite(aspect) ? Number(aspect) : 1;

    const tanY = Math.tan((fov * Math.PI / 180) / 2);
    const tanX = tanY * a;

    const dview = tmpDirRef.current.copy(desiredOrigin).sub(target);
    const dviewLen = dview.length();
    if (dviewLen <= 1e-6) return desiredOrigin;

    const viewDir = tmpRayDirRef.current.copy(dview).multiplyScalar(1 / dviewLen);

    // Camera basis aligned with the current view direction.
    const upWorld = new THREE.Vector3(0, 1, 0);
    const right = tmpDesiredPosRef.current.crossVectors(upWorld, viewDir);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    else right.normalize();
    const up = tmpLookAtRef.current.crossVectors(viewDir, right);
    if (up.lengthSq() < 1e-8) up.set(0, 1, 0);
    else up.normalize();

    const raycaster = raycasterRef.current ?? (raycasterRef.current = new THREE.Raycaster());

    const materialIds: Int32Array | undefined = (worldMesh.geometry as any)?.userData?.materialIds;
    const noCollDetByMaterialId: Record<number, boolean> | undefined = (worldMesh as any)?.userData?.noCollDetByMaterialId;

    let bestDistCm = distCm;
    const maxRayLen = distCm + paddingCm;

    for (let i = -n; i <= n; i++) {
      for (let r = -n; r <= n; r++) {
        const u = i / nn;
        const v = r / nn;

        const rayDir = tmpRayOriginRef.current
          .copy(viewDir)
          .addScaledVector(right, u * tanX)
          .addScaledVector(up, v * tanY)
          .normalize();

        raycaster.set(target, rayDir);
        raycaster.far = maxRayLen;

        const hits = raycaster.intersectObject(worldMesh, false);
        if (!hits.length) continue;

        for (const h of hits) {
          const faceIndex = (h as any).faceIndex as number | undefined;
          if (materialIds && noCollDetByMaterialId && Number.isFinite(faceIndex)) {
            const matId = materialIds[faceIndex as number];
            if (noCollDetByMaterialId[matId]) continue;
          }

          // Project the hit onto the desired view direction and keep the minimal allowed distance.
          const distAlongView = (dview.dot(rayDir) * h.distance) / distCm;
          const clamped = Math.max(0, distAlongView - paddingCm);
          if (clamped < bestDistCm) bestDistCm = clamped;
          break;
        }
      }
    }

    return originRef.current.copy(target).addScaledVector(viewDir, bestDistCm);
  };

  const calcCameraCollisionMaxRangeMultiRayCm = (
    target: THREE.Vector3,
    dirCol: THREE.Vector3,
    desiredRangeCm: number,
    camera: THREE.Camera,
    worldMesh: THREE.Mesh
  ): number => {
    const paddingCm = 50;
    const n = 1; // 3x3
    const nn = Math.max(1, n);

    if (!Number.isFinite(desiredRangeCm) || desiredRangeCm <= 0) return 0;

    const desiredOrigin = tmpDesiredOriginCapRef.current.copy(target).addScaledVector(dirCol, -desiredRangeCm);

    const dview = tmpDirRef.current.copy(desiredOrigin).sub(target);
    const dviewLen = dview.length();
    if (!Number.isFinite(dviewLen) || dviewLen < 1e-4) return 0;

    const viewDir = tmpRayDir2Ref.current.copy(dview).multiplyScalar(1 / dviewLen);
    const up0 = tmpRayOriginRef.current.set(0, 1, 0);
    const right = tmpRayRightRef.current.copy(viewDir).cross(up0);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up = tmpRayUpRef.current.copy(right).cross(viewDir).normalize();

    const fov = (camera as any).fov ?? 60;
    const aspect = (camera as any).aspect ?? 1;
    const tanY = Math.tan(((fov * Math.PI) / 180) / 2);
    const tanX = tanY * aspect;

    const raycaster = raycasterRef.current ?? (raycasterRef.current = new THREE.Raycaster());
    const materialIds: Int32Array | undefined = (worldMesh.geometry as any)?.userData?.materialIds;
    const noCollDetByMaterialId: Record<number, boolean> | undefined = (worldMesh as any)?.userData?.noCollDetByMaterialId;

    let bestDistCm = desiredRangeCm;
    const maxRayLen = desiredRangeCm + paddingCm;

    for (let i = -n; i <= n; i++) {
      for (let r = -n; r <= n; r++) {
        const u = i / nn;
        const v = r / nn;

        const rayDir = tmpRayDir4Ref.current
          .copy(viewDir)
          .addScaledVector(right, u * tanX)
          .addScaledVector(up, v * tanY)
          .normalize();

        raycaster.set(target, rayDir);
        raycaster.far = maxRayLen;

        const hits = raycaster.intersectObject(worldMesh, false);
        if (!hits.length) continue;

        for (const h of hits) {
          const faceIndex = (h as any).faceIndex as number | undefined;
          if (materialIds && noCollDetByMaterialId && Number.isFinite(faceIndex)) {
            const matId = materialIds[faceIndex as number];
            if (noCollDetByMaterialId[matId]) continue;
          }

          const distAlongView = (dview.dot(rayDir) * h.distance) / desiredRangeCm;
          const clamped = Math.max(0, distAlongView - paddingCm);
          if (clamped < bestDistCm) bestDistCm = clamped;
          break;
        }
      }
    }

    return bestDistCm;
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

      // Follow camera: OpenGothic-style mouse rotation modifies desired spin directly (degrees).
      lastManualCamInputAtRef.current = Date.now();
      const scale = 0.12; // deg per pixel
      userPitchOffsetDegRef.current = userPitchOffsetDegRef.current - deltaY * scale;
      // In original Gothic, mouse look also turns the hero, while the camera stays behind.
      // We still allow pitch offsets (look up/down), but yaw turns the player.
      if (typeof window !== "undefined") {
        const dYaw = -deltaX * scale;
        window.__heroMouseYawDeltaDeg = (window.__heroMouseYawDeltaDeg ?? 0) + dYaw;
      }
    };
    document.addEventListener('mousemove', handleMouseMove);

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 0) {
        if (typeof window !== "undefined") window.__heroMouseYawDeltaDeg = 0;
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
      // If user leaves pointer lock via ESC, stop the mouse-walk immediately.
      if (typeof window !== "undefined" && document.pointerLockElement !== gl.domElement) window.__heroMouseYawDeltaDeg = 0;
    };

    // Mouse wheel for movement speed (matching zen-viewer)
	    const handleWheel = (event: WheelEvent) => {
	      const freeCamera = getCameraSettings().freeCamera;
	      if (freeCamera) {
	        moveSpeedRef.current += event.deltaY * 0.1;
	        moveSpeedRef.current = Math.max(1, Math.min(500, moveSpeedRef.current));
	      } else {
	        // OpenGothic-style zoom.
	        let prev = userRange01Ref.current;

	        // If the camera is currently collision-capped (effective << desired), zooming in would feel "locked"
	        // because the user would need to scroll enough for `desiredRange` to cross below the cap.
	        // To match original UX, when the user starts zooming in, resync the desired range to the current
	        // effective range first, then apply the wheel step.
	        if (event.deltaY < 0) {
	          const camDef = getCameraMode("CAMMODNORMAL");
	          const minRangeM = Number.isFinite(camDef?.minRange) ? camDef!.minRange : 2;
	          const maxRangeM = Number.isFinite(camDef?.maxRange) ? camDef!.maxRange : 10;
	          const denom = Math.max(1e-6, maxRangeM - minRangeM);

	          const eff = lastEffectiveRangeMRef.current;
	          if (eff != null && Number.isFinite(eff)) {
	            const desiredM = minRangeM + denom * Math.max(0, Math.min(1, prev));
	            // Heuristic: if desired is far beyond current effective distance, we were capped.
	            if (desiredM > eff + 0.25) {
	              prev = Math.max(0, Math.min(1, (eff - minRangeM) / denom));
	              userRange01Ref.current = prev;
	            }
	          }
	        }

	        const next = event.deltaY > 0 ? (prev + 0.02) : (prev - 0.02);
	        userRange01Ref.current = Math.max(0, Math.min(1, next));
	      }

      if (typeof window !== "undefined" && window.__cameraZoomDebug) {
        const now = Date.now();
        // Activate a short "zoom debug session" to avoid constant frame spam.
        // Each wheel tick extends the session.
        const sessionWindowMs = 900;
        if (!freeCamera) {
          if (now > zoomDebugRef.current.activeUntilMs) {
            zoomDebugRef.current.sessionId += 1;
            zoomDebugRef.current.frameLogsThisSession = 0;
          }
          zoomDebugRef.current.activeUntilMs = now + sessionWindowMs;
        }
        const eff = lastEffectiveRangeMRef.current;
        const dbg = {
          t: now,
          event: "wheel",
          sessionId: zoomDebugRef.current.sessionId,
          freeCamera,
          deltaY: event.deltaY,
          userRange01: userRange01Ref.current,
          srcRangeM: srcRangeMRef.current,
          dstRangeM: dstRangeMRef.current,
          effectiveRangeM: eff,
        };
        // Throttle noisy wheel spam slightly.
        if (now - zoomDebugRef.current.lastWheelAtMs > 25) {
          zoomDebugRef.current.lastWheelAtMs = now;
          try {
            console.log("[CameraZoomDebugJSON]" + JSON.stringify(dbg));
          } catch {
            console.log("[CameraZoomDebugJSON]" + String(dbg));
          }
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
      if (typeof window !== "undefined") window.__heroMouseYawDeltaDeg = 0;
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
        const bestRangeM = Number.isFinite(camDef?.bestRange) ? camDef!.bestRange : 3;
        const minRangeM = Number.isFinite(camDef?.minRange) ? camDef!.minRange : 2;
        const maxRangeM = Number.isFinite(camDef?.maxRange) ? camDef!.maxRange : 10;
        const bestAziDeg = Number.isFinite(camDef?.bestAzimuth) ? camDef!.bestAzimuth : 0;
        const bestElevDeg = Number.isFinite(camDef?.bestElevation) ? camDef!.bestElevation : 30;
        const minElevDeg = Number.isFinite(camDef?.minElevation) ? camDef!.minElevation : 0;
        const maxElevDeg = Number.isFinite(camDef?.maxElevation) ? camDef!.maxElevation : 89;
        const rotOffsetX = Number.isFinite(camDef?.rotOffsetX) ? camDef!.rotOffsetX : 0;
        const rotOffsetY = Number.isFinite(camDef?.rotOffsetY) ? camDef!.rotOffsetY : 0;
        const rotOffsetZ = Number.isFinite(camDef?.rotOffsetZ) ? camDef!.rotOffsetZ : 0;
        const targetOffsetX = Number.isFinite(camDef?.targetOffsetX) ? camDef!.targetOffsetX : 0;
        const targetOffsetY = Number.isFinite(camDef?.targetOffsetY) ? camDef!.targetOffsetY : 0;
        const targetOffsetZ = Number.isFinite(camDef?.targetOffsetZ) ? camDef!.targetOffsetZ : 0;
        const veloTrans = Number.isFinite(camDef?.veloTrans) ? camDef!.veloTrans : 40;
        const veloRot = Number.isFinite(camDef?.veloRot) ? camDef!.veloRot : 2;
        const collisionEnabled = Boolean((camDef as any)?.collision ?? 1);
        const translateEnabled = Boolean((camDef as any)?.translate ?? 1);

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
        // Convert current hero forward vector into yaw degrees (around +Y).
        // Our follow-camera math expects yaw such that rotating (0,0,1) by yaw yields hero forward.
        const heroYawDeg = (Math.atan2(forward.x, forward.z) * 180) / Math.PI;

        // Destination target: approximate "camera bone".
        tmpTargetNoOffsetRef.current.set(playerPos.x, playerPos.y + lookAtHeight, playerPos.z);
        dstTargetRef.current.copy(tmpTargetNoOffsetRef.current);

        // Initialize camera state once.
        if (!didSnapToHeroRef.current) {
          didSnapToHeroRef.current = true;

          // Seed zoom so that default equals bestRange.
          const denom = Math.max(1e-6, maxRangeM - minRangeM);
          userRange01Ref.current = Math.max(0, Math.min(1, (bestRangeM - minRangeM) / denom));

          dstSpinDegRef.current.set(bestElevDeg, heroYawDeg, 0);
          srcSpinDegRef.current.copy(dstSpinDegRef.current);
          userYawOffsetDegRef.current = 0;
          userPitchOffsetDegRef.current = 0;

          srcTargetRef.current.copy(dstTargetRef.current);
          cameraPosRef.current.copy(dstTargetRef.current);

          offsetAngDegRef.current.set(0, 0, 0);
          rotOffsetDegRef.current.set(0, 0, 0);

          srcRangeMRef.current = bestRangeM;
          dstRangeMRef.current = bestRangeM;
        }

        // Keep camera behind hero by default, but allow temporary mouse offsets.
        const now = Date.now();
        const rotating = document.pointerLockElement === gl.domElement;
        const hasManualInputRecently = (now - lastManualCamInputAtRef.current) < 250;

        // Decay offsets when user is not actively rotating the camera.
        if (!rotating && !hasManualInputRecently) {
          userYawOffsetDegRef.current = followAngDeg(userYawOffsetDegRef.current, 0, 1.2, delta);
          userPitchOffsetDegRef.current = followAngDeg(userPitchOffsetDegRef.current, 0, 1.2, delta);
        }

        dstSpinDegRef.current.y = heroYawDeg + userYawOffsetDegRef.current;
        dstSpinDegRef.current.x = bestElevDeg + userPitchOffsetDegRef.current;

        // Clamp elevation (OpenGothic: clamps max, min clamp is intentionally lax).
        if (dstSpinDegRef.current.x > maxElevDeg) dstSpinDegRef.current.x = maxElevDeg;
        if (dstSpinDegRef.current.x < minElevDeg) dstSpinDegRef.current.x = minElevDeg;

        // Zoom interpolation (OpenGothic-style): `userRange01Ref` is the user's intent (0..1).
        // When collision prevents zooming out, we cap `dstRangeMRef` to the maximum collision-free range,
        // but we never overwrite `userRange01Ref` (so zoom resumes smoothly when the path clears).
        const desiredUserRangeM =
          minRangeM + (maxRangeM - minRangeM) * Math.max(0, Math.min(1, userRange01Ref.current));
        const desiredUserRangeCm = desiredUserRangeM * 100;
        if (srcRangeMRef.current == null) srcRangeMRef.current = dstRangeMRef.current ?? desiredUserRangeM;
        const zSpeed = 5;

        // Apply scripted offsets (Camera.dat).
        const rotBestDeg = new THREE.Vector3(0, bestAziDeg, 0);
        const rotOffsetDefDeg = new THREE.Vector3(rotOffsetX, rotOffsetY, rotOffsetZ);
        const targetOffsetLocal = new THREE.Vector3(targetOffsetX, targetOffsetY, targetOffsetZ);

        // Smooth angles (src follows dst).
        srcSpinDegRef.current.x = followAngDeg(srcSpinDegRef.current.x, dstSpinDegRef.current.x + rotBestDeg.x, veloRot, delta);
        srcSpinDegRef.current.y = followAngDeg(srcSpinDegRef.current.y, dstSpinDegRef.current.y + rotBestDeg.y, veloRot, delta);
        rotOffsetDegRef.current.x = followAngDeg(rotOffsetDegRef.current.x, rotOffsetDefDeg.x, veloRot, delta);
        rotOffsetDegRef.current.y = followAngDeg(rotOffsetDegRef.current.y, rotOffsetDefDeg.y, veloRot, delta);
        rotOffsetDegRef.current.z = followAngDeg(rotOffsetDegRef.current.z, rotOffsetDefDeg.z, veloRot, delta);

        // Rotation matrix around target, matching OpenGothic.
        const yawRad = (srcSpinDegRef.current.y * Math.PI) / 180;
        const pitchRad = (srcSpinDegRef.current.x) * Math.PI / 180;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchRad, yawRad, 0, "YXZ"));

        const targetOffset = tmpDesiredPosRef.current.copy(targetOffsetLocal).applyQuaternion(q);
        dstTargetRef.current.add(targetOffset);

        // Follow target position.
        followPosOpenGothic(srcTargetRef.current, dstTargetRef.current, veloTrans, delta);

        // followCamera: cameraPos tracks src.target when translate is enabled.
        if (translateEnabled) cameraPosRef.current.copy(srcTargetRef.current);

        // Compute the collision direction for the current camera angles.
        const spinForCollision = tmpLookAtRef.current.copy(srcSpinDegRef.current).add(offsetAngDegRef.current);
        const yawColRad = (spinForCollision.y * Math.PI) / 180;
        const pitchColRad = spinForCollision.x * Math.PI / 180;
        const qCol = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchColRad, yawColRad, 0, "YXZ"));
        const dirCol = tmpRayDir3Ref.current.set(0, 0, 1).applyQuaternion(qCol).normalize();

        // Probe collision for the *desired* zoom distance (prevents dstRange from jumping to a value
        // that is still blocked, which caused oscillations when scrolling fast).
        const worldMesh = collisionEnabled ? ((scene as any)?.getObjectByName?.("WORLD_MESH") as THREE.Mesh | undefined) : undefined;
        const maxAllowedCm =
          collisionEnabled && worldMesh
            ? calcCameraCollisionMaxRangeMultiRayCm(cameraPosRef.current, dirCol, desiredUserRangeCm, camera, worldMesh)
            : desiredUserRangeCm;
        const maxAllowedM = maxAllowedCm / 100;
        lastCollisionMaxRangeMRef.current = maxAllowedM;
        const cappedDesiredM = Math.min(desiredUserRangeM, Math.max(0, maxAllowedM));
        const srcRangeMNow = srcRangeMRef.current ?? cappedDesiredM;
        // Important UX: collision caps should prevent zooming *out* further, but should not suddenly pull the camera
        // *in* while the user is scrolling out (that feels like a "lock" + reverse zoom).
        // If the user wants to zoom out and the computed cap is below the current range, keep the current range.
        dstRangeMRef.current = desiredUserRangeM >= srcRangeMNow ? Math.max(srcRangeMNow, cappedDesiredM) : cappedDesiredM;

        const dz = (dstRangeMRef.current ?? desiredUserRangeM) - (srcRangeMRef.current ?? desiredUserRangeM);
        srcRangeMRef.current += dz * Math.min(1, 2 * zSpeed * Math.max(0, delta));

        // Direction vector to place camera.
        const rangeCm = (srcRangeMRef.current ?? bestRangeM) * 100;

        const desiredOrigin = originRef.current.copy(cameraPosRef.current).addScaledVector(dirCol, -rangeCm);

        let finalOrigin = desiredOrigin;

        // Collision: ray from target to origin (single-ray approximation, but close enough with BVH).
        if (collisionEnabled) {
          if (worldMesh) {
            finalOrigin = calcCameraCollisionMultiRay(
              cameraPosRef.current,
              desiredOrigin,
              rangeCm,
              camera,
              worldMesh
            );
          }
        }

        const effectiveRangeCm = finalOrigin.distanceTo(cameraPosRef.current);
        const effectiveRangeM = effectiveRangeCm / 100;
        lastEffectiveRangeMRef.current = effectiveRangeM;
        const clampedNow = Boolean(collisionEnabled && worldMesh && effectiveRangeCm + 0.5 < rangeCm);
        if (clampedNow) {
          srcRangeMRef.current = Math.min(srcRangeMRef.current ?? effectiveRangeM, effectiveRangeM);
          dstRangeMRef.current = Math.min(dstRangeMRef.current ?? effectiveRangeM, effectiveRangeM);
        }

        // Debug: help diagnose zoom jumps near collision thresholds.
        if (typeof window !== "undefined" && window.__cameraZoomDebug) {
          const now = Date.now();
          // Log only during a short window after the user uses the mouse wheel.
          if (now > zoomDebugRef.current.activeUntilMs) {
            // Keep internal "last" in sync so the next session starts cleanly.
            zoomDebugRef.current.lastClamp = Boolean(collisionEnabled && worldMesh && effectiveRangeCm + 0.5 < rangeCm);
            zoomDebugRef.current.lastEffectiveRangeM = effectiveRangeM;
            zoomDebugRef.current.lastDesiredRangeM = rangeCm / 100;
          } else {
          const clamped = Boolean(collisionEnabled && worldMesh && effectiveRangeCm + 0.5 < rangeCm);
          const desiredRangeM = rangeCm / 100;
          const last = zoomDebugRef.current;
          const shouldEmit =
            // keep it reasonably low-frequency while still capturing the jump
            now - last.lastLogAtMs > 120 ||
            clamped !== last.lastClamp ||
            (last.lastEffectiveRangeM != null && Math.abs(last.lastEffectiveRangeM - effectiveRangeM) > 0.05) ||
            (last.lastDesiredRangeM != null && Math.abs(last.lastDesiredRangeM - desiredRangeM) > 0.05);

          if (shouldEmit) {
            // Hard cap per session to prevent spam if something goes unstable.
            if (zoomDebugRef.current.frameLogsThisSession > 25) {
              // ignore
            } else {
            zoomDebugRef.current.lastLogAtMs = now;
            zoomDebugRef.current.lastClamp = clamped;
            zoomDebugRef.current.lastEffectiveRangeM = effectiveRangeM;
            zoomDebugRef.current.lastDesiredRangeM = desiredRangeM;
            zoomDebugRef.current.frameLogsThisSession += 1;
            const dbg = {
              t: now,
              event: "frame",
              sessionId: zoomDebugRef.current.sessionId,
              clamped,
              collisionEnabled,
              hasWorldMesh: Boolean(worldMesh),
              userRange01: userRange01Ref.current,
              minRangeM,
              maxRangeM,
              desiredRangeM,
              effectiveRangeM,
              maxCollisionRangeM: lastCollisionMaxRangeMRef.current,
              srcRangeM: srcRangeMRef.current,
              dstRangeM: dstRangeMRef.current,
              camPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
              targetPos: { x: cameraPosRef.current.x, y: cameraPosRef.current.y, z: cameraPosRef.current.z },
            };
            try {
              console.log("[CameraZoomDebugJSON]" + JSON.stringify(dbg));
            } catch {
              console.log("[CameraZoomDebugJSON]" + String(dbg));
            }
            }
          }
          }
        }

        // Offset angle feedback from collision (OpenGothic-like).
        const dirBase = tmpRayDirRef.current.set(0, 0, 1).applyQuaternion(q).normalize();
        const baseOrigin = tmpDesiredPosRef.current.copy(dstTargetRef.current).addScaledVector(dirBase, -rangeCm);
        offsetAngDegRef.current.copy(calcOffsetAnglesDelta(finalOrigin, baseOrigin, tmpTargetNoOffsetRef.current));

        camera.position.copy(finalOrigin);
        camera.lookAt(cameraPosRef.current);
        return;
      }
    }

    updateMovement(delta);
  });

  return null;
});
