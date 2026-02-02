import { useMemo, useEffect, useRef, type MutableRefObject } from "react";
import { useRapier } from "@react-three/rapier";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { constrainCircleMoveXZ, type NpcCircleCollider } from "./npc-npc-collision";
import type { NpcData } from "./types";

type MoveConstraintResult = { blocked: boolean; moved: boolean };

// Centralized NPC movement/physics tuning (hardcoded; no query params).
// Keep this as the single place to tweak feel/thresholds.
export const NPC_RENDER_TUNING = {
  // KCC shape
  radius: 35,
  capsuleHeight: 170,
  stepHeight: 15,

  // Slopes
  maxSlopeDeg: 48, // walkable slope (slide starts above this)
  slideToFallDeg: 67, // slide->fall threshold

  // Physics
  gravity: 981,
  maxFallSpeed: 8000,

  // Grounding / snapping
  groundSnapDownEps: 0.5,
  groundStickSpeed: 140,
  groundStickMaxDistance: 6,
  groundRecoverDistance: 30,
  groundRecoverRayStartAbove: 60,
  groundRecoverMaxDrop: 6,
  groundClearance: 4,

  // Movement feel
  slopeSpeedCompEnabled: true,
  slopeSpeedCompMaxFactor: 1.5,

  // Sliding
  slideBlockUphillEnabled: true,
  slideAccel: 2200,
  slideMaxSpeed: 900,
  slideInitialSpeed: 150,
  slideEntryDelaySeconds: 0.1,

  // Falling->wall push
  fallSlidePushSpeed: 10000,
  fallSlidePushMaxPerFrame: 35,
  fallWallPushDurationSeconds: 0.4,
  fallEntryDelaySeconds: 0.05,

  // Fall animation phase split (ZenGin-like distance-based)
  fallDownHeight: 500,

  // State hysteresis
  slideToFallGraceSeconds: 0.1,
  slideExitGraceSeconds: 0.04,

  // Optional: block stepping onto very steep surfaces
  slideEntryBlockEnabled: true,
  slideEntryBlockDeg: 75,

  // Visual smoothing (Y-only offset on a child group)
  visualSmoothEnabled: true,
  visualSmoothHalfLifeUp: 0.05,
  visualSmoothHalfLifeDown: 0.15,
  visualSmoothMaxDown: 6,
  visualSmoothMaxUp: 10,

  // Rapier KCC controller settings
  controllerOffset: 1,
  controllerSnapDistance: 20,

  // Manual control (player hero)
  manualControlSpeeds: { walk: 180, run: 350 },
} as const;

export type UseNpcPhysicsArgs = {
  loadedNpcsRef: MutableRefObject<Map<string, THREE.Group>>;
  physicsFrameRef: MutableRefObject<number>;
  playerGroupRef: MutableRefObject<THREE.Group | null>;
};

export function useNpcPhysics({ loadedNpcsRef, physicsFrameRef, playerGroupRef }: UseNpcPhysicsArgs) {
  const { world: rapierWorld, rapier } = useRapier();

  const kccConfig = useMemo(() => {
  		    const getMaxSlopeDeg = () => NPC_RENDER_TUNING.maxSlopeDeg;

  	    const getGroundStickSpeed = () => NPC_RENDER_TUNING.groundStickSpeed;

  	    const getGroundStickMaxDistance = () => NPC_RENDER_TUNING.groundStickMaxDistance;

  	    const getGroundSnapDownEps = () => NPC_RENDER_TUNING.groundSnapDownEps;

  	    const getGroundRecoverDistance = () => NPC_RENDER_TUNING.groundRecoverDistance;

  		    const getGroundRecoverRayStartAbove = () => NPC_RENDER_TUNING.groundRecoverRayStartAbove;

  		    const getGroundRecoverMaxDrop = () => NPC_RENDER_TUNING.groundRecoverMaxDrop;

  		    const getSlopeSpeedCompEnabled = () => NPC_RENDER_TUNING.slopeSpeedCompEnabled;

  	    const getSlopeSpeedCompMaxFactor = () => NPC_RENDER_TUNING.slopeSpeedCompMaxFactor;

  	    const getSlideBlockUphillEnabled = () => NPC_RENDER_TUNING.slideBlockUphillEnabled;

  	    const getSlideAccel = () => NPC_RENDER_TUNING.slideAccel;

  	    const getSlideMaxSpeed = () => NPC_RENDER_TUNING.slideMaxSpeed;

    const getSlideInitialSpeed = () => NPC_RENDER_TUNING.slideInitialSpeed;
    const getSlideEntryDelaySeconds = () => NPC_RENDER_TUNING.slideEntryDelaySeconds;

  	    const getSlideToFallDeg = () => NPC_RENDER_TUNING.slideToFallDeg;

  		    const getFallSlidePushSpeed = () => NPC_RENDER_TUNING.fallSlidePushSpeed;

  			    const getFallSlidePushMaxPerFrame = () => NPC_RENDER_TUNING.fallSlidePushMaxPerFrame;

    const getFallWallPushDurationSeconds = () => NPC_RENDER_TUNING.fallWallPushDurationSeconds;

    const getFallDownHeight = () => NPC_RENDER_TUNING.fallDownHeight;
    const getFallEntryDelaySeconds = () => NPC_RENDER_TUNING.fallEntryDelaySeconds;

  		    const getSlideToFallGraceSeconds = () => NPC_RENDER_TUNING.slideToFallGraceSeconds;

  			    const getSlideExitGraceSeconds = () => NPC_RENDER_TUNING.slideExitGraceSeconds;

    const getSlideEntryBlockEnabled = () => NPC_RENDER_TUNING.slideEntryBlockEnabled;

    const getSlideEntryBlockDeg = () => NPC_RENDER_TUNING.slideEntryBlockDeg;


  			    const getVisualSmoothEnabled = () => NPC_RENDER_TUNING.visualSmoothEnabled;

  		    const getVisualSmoothHalfLifeUp = () => NPC_RENDER_TUNING.visualSmoothHalfLifeUp;

  		    const getVisualSmoothHalfLifeDown = () => NPC_RENDER_TUNING.visualSmoothHalfLifeDown;

  		    const getVisualSmoothMaxDown = () => NPC_RENDER_TUNING.visualSmoothMaxDown;

  		    const getVisualSmoothMaxUp = () => NPC_RENDER_TUNING.visualSmoothMaxUp;

  	    const walkDeg = getMaxSlopeDeg();
  	    return {
  	      radius: NPC_RENDER_TUNING.radius,
  	      capsuleHeight: NPC_RENDER_TUNING.capsuleHeight,
  	      stepHeight: NPC_RENDER_TUNING.stepHeight,
      // Slopes:
      // - climb if slope <= maxSlopeClimbAngle
      // - slide if slope > minSlopeSlideAngle
  	      maxSlopeClimbAngle: THREE.MathUtils.degToRad(walkDeg),
  	      minSlopeSlideAngle: THREE.MathUtils.degToRad(walkDeg),
  	      // Gravity tuning (ZenGin-like defaults).
  	      gravity: NPC_RENDER_TUNING.gravity,
  	      maxFallSpeed: NPC_RENDER_TUNING.maxFallSpeed,
      // How fast we "stick" down while grounded (helps when going downhill on ramps/stairs).
      // Units: distance units per second (Gothic scale is ~cm).
      groundStickSpeed: getGroundStickSpeed(),
      // Clamp the stick-to-ground translation per frame to avoid snapping down big ledges.
      groundStickMaxDistance: getGroundStickMaxDistance(),
      // A tiny always-on downward component while grounded to let Rapier's snap-to-ground work
      // even when moving with `desired.y = 0` (required by the KCC docs).
      groundSnapDownEps: getGroundSnapDownEps(),
  	      // Recovery snap when we briefly lose `computedGrounded()` on edges while going downhill.
  	      groundRecoverDistance: getGroundRecoverDistance(),
  	      groundRecoverRayStartAbove: getGroundRecoverRayStartAbove(),
  		      groundRecoverMaxDrop: getGroundRecoverMaxDrop(),
  		      // Small clearance to avoid visual ground intersection.
  		      groundClearance: NPC_RENDER_TUNING.groundClearance,

      // Counter-act KCC's horizontal slowdown when climbing slopes/steps.
      slopeSpeedCompEnabled: getSlopeSpeedCompEnabled(),
      slopeSpeedCompMaxFactor: getSlopeSpeedCompMaxFactor(),
      // When sliding on too-steep slopes, prevent input from pushing uphill (can cause slide→fall jitter).
      slideBlockUphillEnabled: getSlideBlockUphillEnabled(),
      // Sliding tuning.
      slideAccel: getSlideAccel(),
      slideMaxSpeed: getSlideMaxSpeed(),
      slideInitialSpeed: getSlideInitialSpeed(),
      slideEntryDelaySeconds: getSlideEntryDelaySeconds(),
      slideToFallAngle: THREE.MathUtils.degToRad(getSlideToFallDeg()),
      fallSlidePushSpeed: getFallSlidePushSpeed(),
      fallSlidePushMaxPerFrame: getFallSlidePushMaxPerFrame(),
      fallWallPushDurationSeconds: getFallWallPushDurationSeconds(),
      fallEntryDelaySeconds: getFallEntryDelaySeconds(),
      // Falling animation blending (ZenGin-like: fallDown before fall).
      fallDownHeight: getFallDownHeight(),

  			      // State hysteresis.
  		      slideToFallGraceSeconds: getSlideToFallGraceSeconds(),
  		      slideExitGraceSeconds: getSlideExitGraceSeconds(),
      slideEntryBlockEnabled: getSlideEntryBlockEnabled(),
      slideEntryBlockAngle: THREE.MathUtils.degToRad(getSlideEntryBlockDeg()),

  		      // Visual-only smoothing (applied to a child group so physics stays exact).
  		      visualSmoothEnabled: getVisualSmoothEnabled(),
  		      visualSmoothHalfLifeUp: getVisualSmoothHalfLifeUp(),
  	      visualSmoothHalfLifeDown: getVisualSmoothHalfLifeDown(),
      visualSmoothMaxDown: getVisualSmoothMaxDown(),
      visualSmoothMaxUp: getVisualSmoothMaxUp(),
    };
  }, []);

  const kccRef = useRef<any>(null);

  const getNpcVisualRoot = (npcGroup: THREE.Group): THREE.Object3D => {
    const ud: any = npcGroup.userData ?? {};
    const root = ud.visualRoot as THREE.Object3D | undefined;
    if (root && (root as any).isObject3D) return root;
    const found = npcGroup.getObjectByName?.("npc-visual-root") as THREE.Object3D | null;
    return found ?? npcGroup;
  };

  const updateNpcVisualSmoothing = (npcGroup: THREE.Group, dt: number) => {
    const visualRoot = getNpcVisualRoot(npcGroup);
    if (visualRoot === npcGroup) return;
    const ud: any = npcGroup.userData ?? (npcGroup.userData = {});

    if (!kccConfig.visualSmoothEnabled) {
      visualRoot.position.y = 0;
      ud._visSmoothY = undefined;
      return;
    }

    const targetY = npcGroup.position.y;
    let smoothY = ud._visSmoothY as number | undefined;
    if (typeof smoothY !== "number" || !Number.isFinite(smoothY)) smoothY = targetY;

    const halfLife = targetY > smoothY ? kccConfig.visualSmoothHalfLifeUp : kccConfig.visualSmoothHalfLifeDown;
    if (halfLife > 0 && dt > 0) {
      const alpha = 1 - Math.pow(2, -dt / halfLife);
      smoothY = smoothY + (targetY - smoothY) * alpha;
    } else {
      smoothY = targetY;
    }

    // Clamp so we never render above physics (avoids "floating"), and only allow limited lag below.
    const maxDown = kccConfig.visualSmoothMaxDown;
    const maxUp = kccConfig.visualSmoothMaxUp;
    let offset = smoothY - targetY;
    if (offset > maxUp) offset = maxUp;
    if (offset < -maxDown) offset = -maxDown;
    smoothY = targetY + offset;

    ud._visSmoothY = smoothY;
    visualRoot.position.y = smoothY - targetY;
  };

  const updateNpcDebugRayLine = (
    npcGroup: THREE.Group,
    key: "_kccGroundProbeLine",
    color: number,
    width: number,
    startWorld: THREE.Vector3,
    endWorld: THREE.Vector3,
    visible: boolean
  ) => {
    if (npcGroup.userData == null) npcGroup.userData = {};
    let line = npcGroup.userData[key] as Line2 | undefined;
    if (!line) {
      const geometry = new LineGeometry();
      const material = new LineMaterial({ color, linewidth: width, depthTest: false });
      if (typeof window !== "undefined") material.resolution.set(window.innerWidth, window.innerHeight);
      line = new Line2(geometry, material);
      line.frustumCulled = false;
      line.visible = false;
      line.renderOrder = 9999;
      npcGroup.add(line);
      npcGroup.userData[key] = line;
    }
    line.visible = visible;
    if (!visible) return;
    if (typeof window !== "undefined") {
      const mat = line.material as LineMaterial;
      mat.resolution.set(window.innerWidth, window.innerHeight);
    }
    const start = ((npcGroup.userData._kccProbeStart as THREE.Vector3 | undefined) ?? (npcGroup.userData._kccProbeStart = new THREE.Vector3())).copy(
      startWorld
    );
    const end = ((npcGroup.userData._kccProbeEnd as THREE.Vector3 | undefined) ?? (npcGroup.userData._kccProbeEnd = new THREE.Vector3())).copy(endWorld);
    npcGroup.worldToLocal(start);
    npcGroup.worldToLocal(end);
    (line.geometry as LineGeometry).setPositions([start.x, start.y, start.z, end.x, end.y, end.z]);
    line.computeLineDistances();
  };


  	  useEffect(() => {
  	    if (!rapierWorld) return;
  	    if (!rapier) return;

  	    const controller = rapierWorld.createCharacterController(NPC_RENDER_TUNING.controllerOffset);
  	    controller.setSlideEnabled(true);
  	    controller.setMaxSlopeClimbAngle(kccConfig.maxSlopeClimbAngle);
  	    controller.setMinSlopeSlideAngle(kccConfig.minSlopeSlideAngle);

    const minWidth = Math.max(1, kccConfig.radius * 0.5);
    controller.enableAutostep(kccConfig.stepHeight, minWidth, false);

  	    const snap = NPC_RENDER_TUNING.controllerSnapDistance;
  	    if (snap > 0) controller.enableSnapToGround(snap);
  	    else if (typeof (controller as any).disableSnapToGround === "function") (controller as any).disableSnapToGround();

    controller.setApplyImpulsesToDynamicBodies(false);
    controller.setCharacterMass(1);

    kccRef.current = controller;
    return () => {
      try {
        rapierWorld.removeCharacterController(controller);
      } catch {
        // Best-effort cleanup.
      }
      if (kccRef.current === controller) kccRef.current = null;
    };
  }, [rapierWorld, rapier, kccConfig.maxSlopeClimbAngle, kccConfig.minSlopeSlideAngle, kccConfig.radius, kccConfig.stepHeight]);

  const ensureNpcKccCollider = (npcGroup: THREE.Object3D) => {
    if (!rapierWorld || !rapier) return null;
    const ud: any = npcGroup.userData ?? {};
    const handle: number | undefined = ud._kccColliderHandle;
    const height = kccConfig.capsuleHeight;
    ud._kccCapsuleHeight = height;

    if (typeof handle === "number") {
      const existing = rapierWorld.getCollider(handle);
      if (existing) {
        const centerY = npcGroup.position.y + height / 2;
        existing.setTranslation({ x: npcGroup.position.x, y: centerY, z: npcGroup.position.z });
        return existing;
      }
      delete ud._kccColliderHandle;
    }

    const halfHeight = Math.max(0, height / 2 - kccConfig.radius);
    const desc = rapier.ColliderDesc.capsule(halfHeight, kccConfig.radius);

    // Collision groups:
    // - WORLD: membership=1
    // - NPC: membership=2, filter=world only (ignore other NPCs; npc-npc is handled separately).
    const NPC_MEMBERSHIP = 0x0002;
    const NPC_FILTER = 0x0001;
    desc.setCollisionGroups((NPC_MEMBERSHIP << 16) | NPC_FILTER);

    const collider = rapierWorld.createCollider(desc);
    ud._kccColliderHandle = collider.handle;
    npcGroup.userData = ud;

    const centerY = npcGroup.position.y + height / 2;
    collider.setTranslation({ x: npcGroup.position.x, y: centerY, z: npcGroup.position.z });
    return collider;
  };

  const removeNpcKccCollider = (npcGroup: THREE.Object3D) => {
    if (!rapierWorld) return;
    const ud: any = npcGroup.userData ?? {};
    const handle: number | undefined = ud._kccColliderHandle;
    if (typeof handle !== "number") return;
    try {
      const collider = rapierWorld.getCollider(handle);
      if (collider) rapierWorld.removeCollider(collider, true);
    } catch {
      // Best-effort cleanup.
    }
    delete ud._kccColliderHandle;
  };

  const applyMoveConstraint = (npcGroup: THREE.Group, desiredX: number, desiredZ: number, dt: number): MoveConstraintResult => {
    // Dynamic NPC-vs-NPC collision (XZ only): prevent passing through other loaded NPCs.
    // This runs before the world collision solver so we don't "push into walls" while clamping to other NPCs.
    {
      const startX = npcGroup.position.x;
      const startZ = npcGroup.position.z;
      const origDesiredX = desiredX;
      const origDesiredZ = desiredZ;
      const origDx = origDesiredX - startX;
      const origDz = origDesiredZ - startZ;
      const origDist = Math.hypot(origDx, origDz);
      // Use a slightly smaller radius for NPC-vs-NPC than for NPC-vs-world so characters can get closer.
      const selfRadius = kccConfig.radius * 0.6;
      const selfY = npcGroup.position.y;
      const colliders: NpcCircleCollider[] = (npcGroup.userData._npcCollidersScratch as NpcCircleCollider[] | undefined) ?? [];
      colliders.length = 0;
      npcGroup.userData._npcCollidersScratch = colliders;

      let pool: NpcCircleCollider[] = (npcGroup.userData._npcColliderPool as NpcCircleCollider[] | undefined) ?? [];
      npcGroup.userData._npcColliderPool = pool;
      let poolIdx = 0;

      for (const other of loadedNpcsRef.current.values()) {
        if (other === npcGroup) continue;
        if (!other || other.userData.isDisposed) continue;
        if (Math.abs(other.position.y - selfY) > 200) continue;

        const otherData = other.userData.npcData as NpcData | undefined;
        let c = pool[poolIdx];
        if (!c) {
          c = { id: undefined, x: 0, z: 0, radius: selfRadius, y: 0 };
          pool[poolIdx] = c;
        }
        poolIdx++;

        c.id = otherData?.instanceIndex;
        c.x = other.position.x;
        c.z = other.position.z;
        c.radius = selfRadius;
        c.y = other.position.y;
        colliders.push(c);
      }

      if (colliders.length > 0) {
        const runConstraint = (x: number, z: number) =>
          constrainCircleMoveXZ({
            startX,
            startZ,
            desiredX: x,
            desiredZ: z,
            radius: selfRadius,
            colliders,
            maxIterations: 3,
            separationSlop: 0.05,
            y: selfY,
            maxYDelta: 200,
          });

        const constrained = runConstraint(desiredX, desiredZ);
        desiredX = constrained.x;
        desiredZ = constrained.z;
        npcGroup.userData._npcNpcBlocked = constrained.blocked;

        // If two NPCs walk directly into each other, a pure "no-penetration" clamp can deadlock them.
        // ZenGin resolves this with dynamic character collision/physics and local steering. We emulate that
        // by attempting a small deterministic sidestep when we are blocked and made little/no progress.
        const afterDx = desiredX - startX;
        const afterDz = desiredZ - startZ;
        const afterDist = Math.hypot(afterDx, afterDz);
        const dirX = origDist > 1e-8 ? origDx / origDist : 0;
        const dirZ = origDist > 1e-8 ? origDz / origDist : 0;
        const progress = afterDx * dirX + afterDz * dirZ; // signed forward progress
        const lowProgress = progress < origDist * 0.15 && afterDist < origDist * 0.25;

        // Track sustained low-progress blocking to detect NPC-vs-NPC deadlocks (used for candidate-direction escape).
        {
          let streak = (npcGroup.userData._npcDeadlockStreak as number | undefined) ?? 0;
          const isCandidate = constrained.blocked && dt > 0 && origDist > 1e-6 && lowProgress;
          npcGroup.userData._npcDeadlockStreak = isCandidate ? streak + dt : 0;
        }

        if (constrained.blocked && dt > 0 && origDist > 1e-6 && lowProgress) {
          // Pick a stable side relative to the closest collider so the pair chooses opposite sides.
          let closestId: number | null = null;
          let closestDist = Infinity;
          for (const c of colliders) {
            if (typeof c.id !== "number") continue;
            const d = Math.hypot(startX - c.x, startZ - c.z);
            if (d < closestDist) {
              closestDist = d;
              closestId = c.id;
            }
          }

          const npcData = npcGroup.userData.npcData as NpcData | undefined;
          const idx = npcData?.instanceIndex ?? 0;
          let preferredSide = idx % 2 === 0 ? 1 : -1;
          if (closestId != null && closestId !== idx) preferredSide = idx < closestId ? 1 : -1;
          let side = (npcGroup.userData.avoidSide as number | undefined) ?? preferredSide;
          if (side !== 1 && side !== -1) side = 1;
          npcGroup.userData.avoidSide = side;

          const trySide = (s: number) => {
            const perpX = -dirZ * s;
            const perpZ = dirX * s;
            // Keep the sidestep gentle; the main forward movement is still towards the waypoint.
            const step = Math.min(selfRadius * 0.9, 180 * dt);
            const fwd = Math.min(origDist, 40 * dt);
            const a = runConstraint(startX + dirX * fwd + perpX * step, startZ + dirZ * fwd + perpZ * step);
            if (!a.blocked) return a;
            // If forward+side is blocked, try pure lateral separation (useful for head-on deadlocks).
            return runConstraint(startX + perpX * step, startZ + perpZ * step);
          };

          let a = trySide(side);
          if (!a.blocked && (Math.abs(a.x - startX) > 1e-6 || Math.abs(a.z - startZ) > 1e-6)) {
            desiredX = a.x;
            desiredZ = a.z;
            npcGroup.userData._npcNpcBlocked = false;
          } else {
            const b = trySide(-side);
            if (!b.blocked && (Math.abs(b.x - startX) > 1e-6 || Math.abs(b.z - startZ) > 1e-6)) {
              desiredX = b.x;
              desiredZ = b.z;
              npcGroup.userData._npcNpcBlocked = false;
              npcGroup.userData.avoidSide = -side;
            } else {
              const deadlockStreak = (npcGroup.userData._npcDeadlockStreak as number | undefined) ?? 0;
              // Start more aggressive resolution a bit earlier than the logging threshold.
              // In practice, small oscillations can keep resetting the streak before 0.35s while the group remains stuck.
              const deadlocked = deadlockStreak >= 0.25;

              if (deadlocked) {
                // Candidate direction search: sample several short moves around the NPC and pick the best
                // collision-free option that still makes reasonable progress towards the desired direction.
                const baseYaw = Math.atan2(dirX, dirZ);
                const samples = 24;
                // Keep the candidate displacement bounded by the caller's requested step for this frame.
                // Larger radii can look like "teleporting" and break animation pacing.
                const stepDist = origDist;
                const radii = [stepDist];

                let best: { x: number; z: number; score: number; yaw: number; radius: number; progress: number; clearance: number } | null =
                  null;

                const scoreCandidate = (x: number, z: number) => {
                  const distToDesired = Math.hypot(x - origDesiredX, z - origDesiredZ);
                  const dx = x - startX;
                  const dz = z - startZ;
                  const progress = dx * dirX + dz * dirZ;

                  let minClearance = Number.POSITIVE_INFINITY;
                  for (const c of colliders) {
                    const d = Math.hypot(x - c.x, z - c.z) - selfRadius - (c.radius ?? selfRadius);
                    if (d < minClearance) minClearance = d;
                  }
                  if (!Number.isFinite(minClearance)) minClearance = 0;

                  // Prefer staying near the requested move, but also prioritize gaining clearance and forward progress.
                  const score = minClearance * 2.5 + progress * 1.0 - distToDesired * 0.25;
                  return { score, progress, clearance: minClearance };
                };

                for (const r of radii) {
                  for (let i = 0; i < samples; i++) {
                    const yaw = baseYaw + (i / samples) * Math.PI * 2;
                    const cx = startX + Math.sin(yaw) * r;
                    const cz = startZ + Math.cos(yaw) * r;
                    const c = runConstraint(cx, cz);
                    if (c.blocked) continue;
                    const movedDist = Math.hypot(c.x - startX, c.z - startZ);
                    if (movedDist < 1e-6) continue;

                    const s = scoreCandidate(c.x, c.z);
                    // Discard candidates that would still end up in penetration after constraints (very rare, but safe).
                    if (s.clearance < -0.05) continue;
                    if (!best || s.score > best.score) {
                      best = { x: c.x, z: c.z, score: s.score, yaw, radius: r, progress: s.progress, clearance: s.clearance };
                    }
                  }
                }

                if (best) {
                  desiredX = best.x;
                  desiredZ = best.z;
                  npcGroup.userData._npcNpcBlocked = false;

                  // Signal the mover to temporarily steer in the chosen direction (so the character turns and walks away),
                  // then wait a bit to help clear traffic jams. The mover handles the actual steering and waiting.
                  {
                    const nowMs = Date.now();
                    const steerUntil = (npcGroup.userData._npcTrafficSteerUntilMs as number | undefined) ?? 0;
                    if (!(steerUntil > nowMs)) {
                      npcGroup.userData._npcTrafficSteerYaw = best.yaw;
                      npcGroup.userData._npcTrafficSteerUntilMs = nowMs + 500;
                      npcGroup.userData._npcTrafficSteerPendingWait = true;
                      npcGroup.userData._npcTrafficSteerMoved = false;
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        npcGroup.userData._npcNpcBlocked = false;
      }
    }

    const controller = kccRef.current;
    if (!controller || !rapier || !rapierWorld) {
      const beforeX = npcGroup.position.x;
      const beforeZ = npcGroup.position.z;
      npcGroup.position.x = desiredX;
      npcGroup.position.z = desiredZ;
      const moved = Math.abs(npcGroup.position.x - beforeX) > 1e-6 || Math.abs(npcGroup.position.z - beforeZ) > 1e-6;
      updateNpcVisualSmoothing(npcGroup, Math.min(Math.max(dt, 0), 0.05));
      npcGroup.userData._kccLastFrame = physicsFrameRef.current;
      return { blocked: Boolean(npcGroup.userData._npcNpcBlocked), moved };
    }

    const collider = ensureNpcKccCollider(npcGroup);
    if (!collider) {
      const beforeX = npcGroup.position.x;
      const beforeZ = npcGroup.position.z;
      npcGroup.position.x = desiredX;
      npcGroup.position.z = desiredZ;
      const moved = Math.abs(npcGroup.position.x - beforeX) > 1e-6 || Math.abs(npcGroup.position.z - beforeZ) > 1e-6;
      updateNpcVisualSmoothing(npcGroup, Math.min(Math.max(dt, 0), 0.05));
      npcGroup.userData._kccLastFrame = physicsFrameRef.current;
      return { blocked: Boolean(npcGroup.userData._npcNpcBlocked), moved };
    }

  		    const dtClamped = Math.min(Math.max(dt, 0), 0.05);
  		    // Hysteresis: reduce flicker around slide thresholds.
  		    const SLIDE_TO_FALL_GRACE_S = kccConfig.slideToFallGraceSeconds;
  		    const SLIDE_EXIT_GRACE_S = kccConfig.slideExitGraceSeconds;
  			    const FALL_WALL_PUSH_DURATION_S = kccConfig.fallWallPushDurationSeconds;
  			    const fromX = npcGroup.position.x;
  			    const fromZ = npcGroup.position.z;
  			    let dx = desiredX - fromX;
  			    let dz = desiredZ - fromZ;
  			    let desiredDistXZ = Math.hypot(dx, dz);

    const ud: any = npcGroup.userData ?? (npcGroup.userData = {});
    const wasStableGrounded = Boolean(ud._kccStableGrounded ?? ud._kccGrounded);
    const wasSliding = Boolean(ud.isSliding);
    const wasFalling = Boolean(ud.isFalling);

    // While sliding, ignore movement input entirely (no air/ground steering).
    if (wasSliding && desiredDistXZ > 1e-6) {
      desiredX = fromX;
      desiredZ = fromZ;
      dx = 0;
      dz = 0;
      desiredDistXZ = 0;
    }

  	    // While in the initial fallDown phase, ignore steering/movement input (ZenGin-like: no air-control during "crouch").
  	    // We still allow physics reactions like wall pushback and gravity.
  	    if (wasFalling) {
  	      const fallDownHeight = kccConfig.fallDownHeight ?? 0;
  	      const fallDownDistY = (ud._fallDownDistY as number | undefined) ?? 0;
  	      const inFallDownPhase = fallDownHeight > 1e-6 && fallDownDistY < fallDownHeight - 1e-6;
  	      if (inFallDownPhase && desiredDistXZ > 1e-6) {
  	        desiredX = fromX;
  	        desiredZ = fromZ;
  	        dx = 0;
  	        dz = 0;
  	        desiredDistXZ = 0;
  	      }
  	    }
  let vy = (ud._kccVy as number | undefined) ?? 0;

  let slideSpeedApplied: number | null = null;
  let slideTooSteep = false;
  let fallSlidePush: { x: number; z: number } | null = null;
  let fallWallPushDbg: any = null;

    // Stuck resolver for sliding/falling: if we haven't moved ~10 units in 3s, push up and sideways.
    const isSlidingNow = Boolean(ud.isSliding);
    const isFallingNow = Boolean(ud.isFalling);
    if ((wasSliding || wasFalling || isSlidingNow || isFallingNow) && dtClamped > 0) {
      const pos = npcGroup.position;
      const ref =
        (ud._kccStuckRef as THREE.Vector3 | undefined) ?? (ud._kccStuckRef = new THREE.Vector3(pos.x, pos.y, pos.z));
      let stuckFor = (ud._kccStuckFor as number | undefined) ?? 0;
      const dist = Math.hypot(pos.x - ref.x, pos.y - ref.y, pos.z - ref.z);
      if (dist > 10) {
        ref.set(pos.x, pos.y, pos.z);
        stuckFor = 0;
      } else {
        stuckFor += dtClamped;
      }

      if (stuckFor >= 3) {
        const nowMs = Date.now();
        const lastAt = (ud._kccStuckPushAtMs as number | undefined) ?? 0;
        if (nowMs - lastAt > 500) {
          (ud as any)._kccStuckPushAtMs = nowMs;
          const angle = Math.random() * Math.PI * 2;
          const pushSpeed = 500;
          const pushUp = 700;
          dx += Math.cos(angle) * pushSpeed * dtClamped;
          dz += Math.sin(angle) * pushSpeed * dtClamped;
          desiredX = fromX + dx;
          desiredZ = fromZ + dz;
          desiredDistXZ = Math.hypot(dx, dz);
          vy = Math.max(vy, pushUp);
          ref.set(pos.x, pos.y, pos.z);
          stuckFor = 0;
          if (playerGroupRef.current === npcGroup) {
            console.log(
              "[NPCStuckResolverJSON]" +
                JSON.stringify({
                  t: nowMs,
                  mode: isSlidingNow ? "slide" : isFallingNow ? "fall" : "unknown",
                  dist,
                  pushSpeed,
                  pushUp,
                })
            );
          }
        }
      }
      ud._kccStuckFor = stuckFor;
    }

    // If we were sliding last frame, prevent any input from pushing along the slope direction.
    // This keeps slide speed stable and avoids slide→fall jitter from trying to "fight" the slope.
    if (kccConfig.slideBlockUphillEnabled && wasSliding && desiredDistXZ > 1e-6) {
      const n = ud._kccGroundNormal as { x: number; y: number; z: number } | undefined;
      const ny = n?.y ?? 0;
      if (n && Number.isFinite(n.x) && Number.isFinite(ny) && Number.isFinite(n.z) && ny > 0.2) {
        // Downhill direction is the gravity vector projected onto the ground plane.
        // We only care about XZ to decide what is "uphill" vs "downhill".
        let sx = ny * n.x;
        let sz = ny * n.z;
        const sLen = Math.hypot(sx, sz);
        if (sLen > 1e-6) {
          sx /= sLen;
          sz /= sLen;
          const along = dx * sx + dz * sz; // >0 means towards downhill; <0 means uphill
          if (Math.abs(along) > 1e-6) {
            dx -= along * sx;
            dz -= along * sz;
            desiredX = fromX + dx;
            desiredZ = fromZ + dz;
            desiredDistXZ = Math.hypot(dx, dz);
            ud._slideBlockedAlong = along;
          } else {
            ud._slideBlockedAlong = 0;
          }
        }
      }
    } else {
      ud._slideBlockedAlong = 0;
    }

  	    // Small downward component helps snap-to-ground and keeps the character "glued" to slopes/steps.
  	    let dy = vy * dtClamped;
  	    let stickDown = 0;
  	    if (wasStableGrounded) {
  	      const snapDown = kccConfig.groundSnapDownEps;
  	      if (snapDown > 0 && dy > -snapDown) dy = -snapDown;

  	      // Extra "stick" helps keep contact when going downhill on ramps/stairs.
  	      // Avoid applying it when moving uphill, because that can slow climbing or prevent autostep from triggering.
  	      if (!wasSliding) {
  	        const stickMax = Math.min(kccConfig.groundStickSpeed * dtClamped, kccConfig.groundStickMaxDistance);
  	        if (desiredDistXZ < 1e-3) {
  	          stickDown = stickMax;
  	        } else {
  	          const n =
  	            (ud._kccGroundNormal as { x: number; y: number; z: number } | undefined) ??
  	            ((ud as any)._kccFloorProbeNormal as { x: number; y: number; z: number } | undefined);
  	          const ny = n?.y ?? 0;
  	          if (n && Number.isFinite(n.x) && Number.isFinite(ny) && Number.isFinite(n.z) && ny > 0.2 && ny < 0.999) {
  	            const clampedNy = Math.max(-1, Math.min(1, ny));
  	            const slopeAngle = Math.acos(clampedNy);
  	            if (slopeAngle > THREE.MathUtils.degToRad(8)) {
  	              // Downhill direction is the gravity vector projected onto the ground plane.
  	              let sx = clampedNy * n.x;
  	              let sz = clampedNy * n.z;
  	              const sLen = Math.hypot(sx, sz);
  	              if (sLen > 1e-6) {
  	                sx /= sLen;
  	                sz /= sLen;
  	                const along = dx * sx + dz * sz; // >0 means moving downhill; <0 means uphill
  	                if (along > 1e-6) stickDown = stickMax;
  	              }
  	            }
  	          }
  	        }
  	        if (stickDown > 0 && dy > -stickDown) dy = -stickDown;
  	      }
  	    }

    // If grounded and moving, project the desired move onto the ground plane.
    // This preserves the intended XZ heading and avoids lateral drift on slopes.
    if (wasStableGrounded && !wasSliding && desiredDistXZ > 1e-6) {
      const n =
        (ud._kccGroundNormal as { x: number; y: number; z: number } | undefined) ??
        ((ud as any)._kccFloorProbeNormal as { x: number; y: number; z: number } | undefined);
      const ny = n?.y ?? 0;
      if (n && Number.isFinite(n.x) && Number.isFinite(ny) && Number.isFinite(n.z) && ny > 0.2) {
        const slopeDy = -(n.x * dx + n.z * dz) / ny;
        if (Number.isFinite(slopeDy)) dy = slopeDy;
      }
    }

    // While sliding, add an explicit downhill movement that scales with slope steepness.
    // Rapier's built-in "sliding" is mostly a trajectory adjustment; without us feeding some
    // slope-based motion, the character may drift down very steep slopes too slowly.
    if (wasSliding) {
  	      const n = ud._kccGroundNormal as { x: number; y: number; z: number } | undefined;
  	      const ny = n?.y ?? 0;
  	      if (n && Number.isFinite(n.x) && Number.isFinite(ny) && Number.isFinite(n.z) && ny > 0.02 && ny < 0.999) {
  	        const clampedNy = Math.max(-1, Math.min(1, ny));
  	        const slopeAngle = Math.acos(clampedNy);
  	        slideTooSteep = slopeAngle > kccConfig.slideToFallAngle + 1e-3;
  	        // If we have only briefly entered the "too steep" zone, keep treating it as sliding for a moment.
  	        const prevSlideToFallFor = (ud._kccSlideToFallFor as number | undefined) ?? 0;
  	        const slideToFallGraceActive = slideTooSteep && prevSlideToFallFor < SLIDE_TO_FALL_GRACE_S;
  	        if (slideToFallGraceActive) slideTooSteep = false;

  	        const sin = Math.sqrt(Math.max(0, 1 - clampedNy * clampedNy));
  	        const accel = kccConfig.slideAccel * sin;

  	        let slideSpeed = (ud._kccSlideSpeed as number | undefined) ?? kccConfig.slideInitialSpeed;
        if (!Number.isFinite(slideSpeed) || slideSpeed < 0) slideSpeed = kccConfig.slideInitialSpeed;

        if (!slideTooSteep) {
          slideSpeed = Math.max(slideSpeed, kccConfig.slideInitialSpeed);
          slideSpeed += accel * dtClamped;
          if (slideSpeed > kccConfig.slideMaxSpeed) slideSpeed = kccConfig.slideMaxSpeed;
          ud._kccSlideSpeed = slideSpeed;

          // Downhill direction is gravity projected onto the ground plane.
          const gx = clampedNy * n.x;
          const gy = -1 + clampedNy * clampedNy;
          const gz = clampedNy * n.z;
          const gLen = Math.hypot(gx, gy, gz);
          if (gLen > 1e-6) {
            const ux = gx / gLen;
            const uy = gy / gLen;
            const uz = gz / gLen;
            dx += ux * slideSpeed * dtClamped;
            dy += uy * slideSpeed * dtClamped;
            dz += uz * slideSpeed * dtClamped;
            desiredX = fromX + dx;
            desiredZ = fromZ + dz;
            desiredDistXZ = Math.hypot(dx, dz);
            slideSpeedApplied = slideSpeed;
          }
    } else {
      ud._kccSlideSpeed = 0;
    }
      } else {
        ud._kccSlideSpeed = 0;
      }
  	    } else {
  	      ud._kccSlideSpeed = 0;
  	    }

  		    // Smooth fall->wall pushback: distribute a single push "impulse" over a fixed duration,
  		    // so it doesn't look like a teleport even with high `npcFallSlidePushSpeed`.
  		    const fallWallPushT = (ud._kccFallWallPushT as number | undefined) ?? 0;
  		    const fallWallPushTotalDist = (ud._kccFallWallPushTotalDist as number | undefined) ?? 0;
  		    const fallWallPushDir = ud._kccFallWallPushDir as { x: number; z: number } | undefined;
  			    if (
  			      FALL_WALL_PUSH_DURATION_S > 0 &&
  			      fallWallPushTotalDist > 1e-6 &&
  			      fallWallPushDir &&
  			      Number.isFinite(fallWallPushDir.x) &&
  			      Number.isFinite(fallWallPushDir.z)
  			    ) {
  		      const t0 = Math.max(0, Math.min(FALL_WALL_PUSH_DURATION_S, fallWallPushT));
  		      const t1 = Math.min(FALL_WALL_PUSH_DURATION_S, t0 + dtClamped);
  		      const u0 = t0 / FALL_WALL_PUSH_DURATION_S;
  		      const u1 = t1 / FALL_WALL_PUSH_DURATION_S;
  		      const s0 = u0 * u0 * (3 - 2 * u0); // smoothstep
  		      const s1 = u1 * u1 * (3 - 2 * u1); // smoothstep
  			      const pushDistRaw = (s1 - s0) * fallWallPushTotalDist;
  			      let pushDist = pushDistRaw;
  			      if (kccConfig.fallSlidePushMaxPerFrame > 0) pushDist = Math.min(pushDist, kccConfig.fallSlidePushMaxPerFrame);

  			      if (pushDist > 1e-6) {
  			        const pushX = fallWallPushDir.x * pushDist;
  			        const pushZ = fallWallPushDir.z * pushDist;
  		        dx += pushX;
  		        dz += pushZ;
  		        desiredX = fromX + dx;
  		        desiredZ = fromZ + dz;
  			        desiredDistXZ = Math.hypot(dx, dz);
  			        fallSlidePush = { x: pushX, z: pushZ };
  			        fallWallPushDbg = {
  			          phase: "tick",
  			          duration: FALL_WALL_PUSH_DURATION_S,
  			          t0,
  			          t1,
  			          u0,
  			          u1,
  			          s0,
  			          s1,
  			          pushDistRaw,
  			          pushDist,
  			          pushMaxPerFrame: kccConfig.fallSlidePushMaxPerFrame,
  			          push: { x: pushX, z: pushZ },
  			          totalDist: fallWallPushTotalDist,
  			        };
  			      }

  		      ud._kccFallWallPushT = t1;
  		      if (!(t1 < FALL_WALL_PUSH_DURATION_S - 1e-6)) {
  		        ud._kccFallWallPushT = 0;
  		        ud._kccFallWallPushTotalDist = 0;
  		        ud._kccFallWallPushDir = undefined;
  		      }
  		    }

  	    try {
  	      const WORLD_MEMBERSHIP = 0x0001;
  	      const filterGroups = (WORLD_MEMBERSHIP << 16) | WORLD_MEMBERSHIP;

      const computeBestGroundNormal = () => {
        let best: { x: number; y: number; z: number } | null = null;
        // Ignore near-vertical contacts (walls) when classifying "ground".
        // KCC can momentarily lose the floor contact when sliding along a wall edge; in that case we'd otherwise
        // treat a wall normal (ny≈0) as ground and incorrectly flip into falling/sliding states.
        const MIN_GROUND_NY = 0.06;
        const n = controller.numComputedCollisions?.() ?? 0;
        for (let i = 0; i < n; i++) {
          const c = controller.computedCollision?.(i);
          const normal = c?.normal1;
          const nx = normal?.x;
          const ny = normal?.y;
          const nz = normal?.z;
          if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) continue;
          if (!(ny > MIN_GROUND_NY)) continue;
          if (!best || ny > best.y) best = { x: nx, y: ny, z: nz };
        }
        return best;
      };

      const computeBestSteepNormalXZ = (minNyExclusive: number) => {
        let best: { x: number; z: number; len: number } | null = null;
        const n = controller.numComputedCollisions?.() ?? 0;
        for (let i = 0; i < n; i++) {
          const c = controller.computedCollision?.(i);
          const normal = c?.normal1;
          const nx = normal?.x;
          const ny = normal?.y;
          const nz = normal?.z;
          if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) continue;
          if (!(ny < minNyExclusive) || ny < -0.2) continue;
          const len = Math.hypot(nx, nz);
          if (len < 1e-3) continue;
          if (!best || len > best.len) best = { x: nx, z: nz, len };
        }
        return best ? { x: best.x / best.len, z: best.z / best.len } : null;
      };

      let boostApplied = false;
      let boostFactor = 1;

      controller.computeColliderMovement(collider, { x: dx, y: dy, z: dz }, rapier.QueryFilterFlags.EXCLUDE_SENSORS, filterGroups);
      let move = controller.computedMovement();
      let bestGroundNormal: { x: number; y: number; z: number } | null = null;
      let bestGroundNy: number | null = null;
      try {
        bestGroundNormal = computeBestGroundNormal();
        bestGroundNy = bestGroundNormal?.y ?? null;
      } catch {
        bestGroundNormal = null;
        bestGroundNy = null;
      }

      // Slope/step speed compensation: KCC tends to reduce the XZ component by ~normal.y when it has to climb.
      // This can make climbing ramps/step-like slopes feel slower than flat ground.
      if (
        kccConfig.slopeSpeedCompEnabled &&
        desiredDistXZ > 1e-6 &&
        move.y > 1e-3 &&
        bestGroundNy != null &&
        bestGroundNy > 0.2 &&
        bestGroundNy < 0.999
      ) {
        const moveXZ = Math.hypot(move.x, move.z);
        const ratio = moveXZ / desiredDistXZ;
        if (ratio < 0.98 && Math.abs(ratio - bestGroundNy) < 0.2) {
          boostFactor = Math.min(1 / bestGroundNy, kccConfig.slopeSpeedCompMaxFactor);
          if (boostFactor > 1.001) {
            controller.computeColliderMovement(
              collider,
              { x: dx * boostFactor, y: dy, z: dz * boostFactor },
              rapier.QueryFilterFlags.EXCLUDE_SENSORS,
              filterGroups
            );
            move = controller.computedMovement();
            try {
              bestGroundNormal = computeBestGroundNormal();
              bestGroundNy = bestGroundNormal?.y ?? null;
            } catch {
              // ignore
            }
            boostApplied = true;
          }
        }
      }

  				      // ZenGin-like behavior: if we are already falling and we touch a too-steep surface, do NOT switch back to sliding.
  				      // Instead, start a short pushback transition (fixed duration) and keep falling.
  				      const minWalkNy = Math.cos(kccConfig.maxSlopeClimbAngle + 1e-3);
  				      const fallWallPushT = (ud._kccFallWallPushT as number | undefined) ?? 0;
  				      const fallWallPushTotalDist = (ud._kccFallWallPushTotalDist as number | undefined) ?? 0;
  				      const isFallWallPushActive =
  				        FALL_WALL_PUSH_DURATION_S > 0 && fallWallPushTotalDist > 1e-6 && fallWallPushT < FALL_WALL_PUSH_DURATION_S - 1e-6;
  				      const fallDownHeight = kccConfig.fallDownHeight ?? 0;
  				      const fallDownDistY = (ud._fallDownDistY as number | undefined) ?? 0;
  				      const inFallDownPhase = fallDownHeight > 1e-6 && fallDownDistY < fallDownHeight - 1e-6;
  				      const fallSlidePushSpeedBase = kccConfig.fallSlidePushSpeed;
  				      const fallSlidePushSpeedEffective = inFallDownPhase ? fallSlidePushSpeedBase * 0.4 : fallSlidePushSpeedBase;
  				      if (!isFallWallPushActive && wasFalling && dy < -1e-3 && fallSlidePushSpeedEffective > 0) {
  				        const pushN = computeBestSteepNormalXZ(minWalkNy - 1e-3);
  				        if (pushN) {
  				          ud._kccFallWallPushDir = { x: pushN.x, z: pushN.z };
  				          const seedDt = Math.min(dtClamped, 1 / 60);
  				          const totalDist = fallSlidePushSpeedEffective * seedDt;
  				          ud._kccFallWallPushTotalDist = totalDist;

  			          const u1 = Math.max(0, Math.min(1, dtClamped / FALL_WALL_PUSH_DURATION_S));
  			          const s1 = u1 * u1 * (3 - 2 * u1); // smoothstep(0->u1)
  			          const pushDistRaw = s1 * totalDist;
  			          let pushDist = pushDistRaw;
  			          if (kccConfig.fallSlidePushMaxPerFrame > 0) pushDist = Math.min(pushDist, kccConfig.fallSlidePushMaxPerFrame);
  			          const pushX = pushN.x * pushDist;
  			          const pushZ = pushN.z * pushDist;

  			          // Apply the first step immediately (same frame) and recompute movement.
  			          dx += pushX;
  			          dz += pushZ;
  		          desiredX = fromX + dx;
  		          desiredZ = fromZ + dz;
  		          desiredDistXZ = Math.hypot(dx, dz);

  		          controller.computeColliderMovement(
  		            collider,
  		            { x: dx, y: dy, z: dz },
  		            rapier.QueryFilterFlags.EXCLUDE_SENSORS,
  		            filterGroups
  		          );
  		          move = controller.computedMovement();
              try {
                bestGroundNormal = computeBestGroundNormal();
                bestGroundNy = bestGroundNormal?.y ?? null;
              } catch {
                // ignore
              }
              fallSlidePush = { x: pushX, z: pushZ };
  				          fallWallPushDbg = {
  				            phase: "start",
  				            duration: FALL_WALL_PUSH_DURATION_S,
  				            u1,
  				            s1,
  				            seedDt,
  				            pushDistRaw,
  				            pushDist,
  				            pushMaxPerFrame: kccConfig.fallSlidePushMaxPerFrame,
  				            push: { x: pushX, z: pushZ },
  				            totalDist,
  				          };
  				          ud._kccFallWallPushT = Math.min(FALL_WALL_PUSH_DURATION_S, dtClamped);

  				          // Always log fall->wall pushback (independent of motion-debug UI) for easier tuning.
  				          try {
  				            const nowMs = Date.now();
  			            const lastAt = (ud as any)._fallSlidePushLogAtMs as number | undefined;
  			            if (typeof lastAt !== "number" || nowMs - lastAt > 200) {
  			              (ud as any)._fallSlidePushLogAtMs = nowMs;
  			              const npcData = (npcGroup.userData as any)?.npcData as NpcData | undefined;
  			              console.log(
  			                "[NPCFallSlidePushJSON]" +
  			                  JSON.stringify({
  			                    t: nowMs,
  				                    npc: npcData?.symbolName ?? npcData?.instanceIndex ?? null,
  				                    npcPos: { x: npcGroup.position.x, y: npcGroup.position.y, z: npcGroup.position.z },
  				                    push: { x: pushX, z: pushZ },
  				                    pushSpeed: fallSlidePushSpeedBase,
  				                    pushSpeedEffective: fallSlidePushSpeedEffective,
  				                    fallDownDistY,
  				                    fallPhase: inFallDownPhase ? "fallDown" : "fall",
  				                    pushTotalDist: totalDist,
  				                    pushDistRaw,
  				                    pushDist,
  				                    pushMaxPerFrame: kccConfig.fallSlidePushMaxPerFrame,
  				                    duration: FALL_WALL_PUSH_DURATION_S,
  				                    seedDt,
  			                    u1,
  			                    s1,
  			                    dt: dtClamped,
  			                  })
  			              );
  			            }
  		          } catch {
  		            // ignore
  		          }
  		        }
  		      }

  	      const capsuleHeight = (ud._kccCapsuleHeight as number | undefined) ?? kccConfig.capsuleHeight;
  	      const cur = collider.translation();
  	      const prevTranslation = { x: cur.x, y: cur.y, z: cur.z };
  	      const next = { x: cur.x + move.x, y: cur.y + move.y, z: cur.z + move.z };
  	      collider.setTranslation(next);
  	      npcGroup.position.set(next.x, next.y - capsuleHeight / 2, next.z);

      const rawGroundedNow = Boolean(controller.computedGrounded?.() ?? false);
      ud._kccGrounded = rawGroundedNow;

  	      // `bestGroundNy` is computed from the KCC collisions to classify steep slopes.
  	      ud._kccGroundNy = bestGroundNy;
  	      ud._kccGroundNormal = bestGroundNormal;

  		      let tooSteepToStandNow = false;
  		      let slopeAngleNow: number | null = null;
  				      // If we're touching a wall while moving downhill, KCC may report a steep "ground" normal from a small
  				      // triangle near the wall base and incorrectly switch into falling/sliding. Prefer a downward floor-probe
  				      // when collisions don't provide a walkable normal.
  				      let floorProbeNy: number | null = null;
  				      let floorProbeNormal: { x: number; y: number; z: number } | null = null;
  				      let floorProbeSrc: string | null = null;
  				      if (rawGroundedNow && rapierWorld && rapier && kccConfig.groundRecoverDistance > 0) {
  				        const needsProbe = bestGroundNy == null || (Number.isFinite(bestGroundNy) && bestGroundNy < minWalkNy - 1e-6);
  				        if (needsProbe) {
  				          try {
  				            const WORLD_MEMBERSHIP = 0x0001;
  				            const filterGroups = (WORLD_MEMBERSHIP << 16) | WORLD_MEMBERSHIP;
  				            const filterFlags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
  				            const feetY = npcGroup.position.y;
  				            const startAbove = kccConfig.groundRecoverRayStartAbove;
  				            const maxToi = startAbove + kccConfig.groundRecoverDistance;
  				            const tryProbe = (x: number, z: number): { ny: number; n: { x: number; y: number; z: number } } | null => {
  				              const ray = new rapier.Ray({ x, y: feetY + startAbove, z }, { x: 0, y: -1, z: 0 });
  				              const hit = rapierWorld.castRayAndGetNormal(ray, maxToi, true, filterFlags, filterGroups, collider);
  				              if (!hit) return null;
  				              const nx = hit.normal?.x ?? 0;
  				              const ny = hit.normal?.y ?? 0;
  				              const nz = hit.normal?.z ?? 0;
  				              if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) return null;
  				              if (!(ny >= minWalkNy)) return null;
  				              const p = ray.pointAt(hit.timeOfImpact);
  				              const deltaDownToHit = feetY - p.y;
  				              if (deltaDownToHit < -1e-3 || deltaDownToHit > kccConfig.groundRecoverDistance + 1e-3) return null;
  				              return { ny, n: { x: nx, y: ny, z: nz } };
  				            };

  				            const baseX = npcGroup.position.x;
  				            const baseZ = npcGroup.position.z;

  				            const hitCenter = tryProbe(baseX, baseZ);
  				            if (hitCenter != null) {
  				              floorProbeNy = hitCenter.ny;
  				              floorProbeNormal = hitCenter.n;
  				              floorProbeSrc = "center";
  				            } else {
  				              // If we are grounded but the center-ray misses walkable ground, we might be "wedged" against a wall
  				              // while walking downhill. Probe slightly around the capsule using the steepest contact direction.
  				              const steepDir = computeBestSteepNormalXZ(minWalkNy);
  				              if (steepDir) {
  				                let align = 1;
  				                if (desiredDistXZ > 1e-3) {
  				                  const dirX = dx / desiredDistXZ;
  				                  const dirZ = dz / desiredDistXZ;
  				                  align = Math.abs(dirX * steepDir.x + dirZ * steepDir.z);
  				                }

  				                // Only do the extra probes when the movement direction aligns with a steep contact (likely a wall hit).
  				                if (align > 0.35) {
  				                  const off = Math.max(2, kccConfig.radius * 0.85);
  				                  const hitA = tryProbe(baseX + steepDir.x * off, baseZ + steepDir.z * off);
  				                  const hitB = tryProbe(baseX - steepDir.x * off, baseZ - steepDir.z * off);
  				                  if (hitA != null || hitB != null) {
  				                    if (hitA != null && (hitB == null || hitA.ny >= hitB.ny)) {
  				                      floorProbeNy = hitA.ny;
  				                      floorProbeNormal = hitA.n;
  				                      floorProbeSrc = "+steep";
  				                    } else if (hitB != null) {
  				                      floorProbeNy = hitB.ny;
  				                      floorProbeNormal = hitB.n;
  				                      floorProbeSrc = "-steep";
  				                    }
  				                  }
  				                }
  				              }
  				            }
  				          } catch {
  				            // ignore
  				          }
  				        }
  				      }

      let effectiveGroundNy = floorProbeNy ?? bestGroundNy;
      (ud as any)._kccGroundNyEffective = effectiveGroundNy;
      if (effectiveGroundNy == null) {
        const probeNy = (ud as any)._kccGroundProbeNy as number | null | undefined;
        if (typeof probeNy === "number" && Number.isFinite(probeNy)) {
          effectiveGroundNy = probeNy;
          (ud as any)._kccGroundNyEffective = probeNy;
          (ud as any)._kccGroundNyFallback = probeNy;
        }
      }
      if (effectiveGroundNy == null && rapierWorld && rapier && kccConfig.groundRecoverDistance > 0) {
        // Fallback: raycast down to recover a ground normal when KCC provides none.
        try {
          const WORLD_MEMBERSHIP = 0x0001;
          const filterGroups = (WORLD_MEMBERSHIP << 16) | WORLD_MEMBERSHIP;
          const filterFlags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
          const feetY = npcGroup.position.y;
          const startAbove = kccConfig.groundRecoverRayStartAbove;
          const maxToi = startAbove + kccConfig.groundRecoverDistance;
          const ray = new rapier.Ray(
            { x: npcGroup.position.x, y: feetY + startAbove, z: npcGroup.position.z },
            { x: 0, y: -1, z: 0 }
          );
          const hit = rapierWorld.castRayAndGetNormal(ray, maxToi, true, filterFlags, filterGroups, collider);
          if (hit) {
            const ny = hit.normal?.y ?? null;
            if (typeof ny === "number" && Number.isFinite(ny)) {
              effectiveGroundNy = ny;
              (ud as any)._kccGroundNyEffective = ny;
              (ud as any)._kccGroundNyFallback = ny;
            }
          }
        } catch {
          // ignore
        }
      }
      if (effectiveGroundNy != null) {
        const ny = Math.max(-1, Math.min(1, effectiveGroundNy));
        slopeAngleNow = Math.acos(ny);
        tooSteepToStandNow = slopeAngleNow > kccConfig.slideToFallAngle + 1e-3;
      }
      (ud as any)._kccFloorProbeNy = floorProbeNy;
      (ud as any)._kccFloorProbeSrc = floorProbeSrc;
      (ud as any)._kccFloorProbeNormal = floorProbeNormal;

      // Forward ground probe (no slide logic; just debug + height).
      if (rapierWorld && rapier) {
        try {
          const forward =
            (ud._kccForwardDir as THREE.Vector3 | undefined) ?? (ud._kccForwardDir = new THREE.Vector3());
          npcGroup.getWorldDirection(forward);
          forward.y = 0;
          if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
          else forward.normalize();

          const forwardOff = 0;
          const startAbove = kccConfig.groundRecoverRayStartAbove;
          const maxToi = (startAbove + kccConfig.groundRecoverDistance) * 2;
          const ox = npcGroup.position.x + forward.x * forwardOff;
          const oz = npcGroup.position.z + forward.z * forwardOff;
          const oy = npcGroup.position.y + startAbove;
          const ray = new rapier.Ray({ x: ox, y: oy, z: oz }, { x: 0, y: -1, z: 0 });
          const WORLD_MEMBERSHIP = 0x0001;
          const filterGroups = (WORLD_MEMBERSHIP << 16) | WORLD_MEMBERSHIP;
          const filterFlags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
          const hit = rapierWorld.castRayAndGetNormal(ray, maxToi, true, filterFlags, filterGroups, collider);
          const hitPoint = hit ? ray.pointAt(hit.timeOfImpact) : null;
          const hitNy = hit?.normal?.y ?? null;
          const hitNx = hit?.normal?.x ?? null;
          const hitNz = hit?.normal?.z ?? null;
          const distDown = hitPoint ? npcGroup.position.y - hitPoint.y : null;
          (ud as any)._kccGroundProbeDistDown = distDown;
          if (typeof hitNy === "number" && Number.isFinite(hitNy)) {
            (ud as any)._kccGroundProbeNy = hitNy;
            if (typeof hitNx === "number" && typeof hitNz === "number") {
              (ud as any)._kccGroundProbeNormal = { x: hitNx, y: hitNy, z: hitNz };
            }
          } else {
            (ud as any)._kccGroundProbeNy = null;
          }

          const isHero = playerGroupRef.current === npcGroup;
          if (isHero) {
            const startV = new THREE.Vector3(ox, oy, oz);
            const endY = hitPoint ? hitPoint.y : oy - maxToi;
            const endV = new THREE.Vector3(ox, endY, oz);
            updateNpcDebugRayLine(npcGroup, "_kccGroundProbeLine", 0x2dff2d, 3, startV, endV, true);

            const nowMs = Date.now();
            const lastAt = (ud as any)._kccGroundProbeLogAtMs as number | undefined;
            if (typeof lastAt !== "number" || nowMs - lastAt > 1000) {
              (ud as any)._kccGroundProbeLogAtMs = nowMs;
              console.log(
                "[NPCGroundProbeJSON]" +
                  JSON.stringify({
                    t: nowMs,
                    pos: { x: npcGroup.position.x, y: npcGroup.position.y, z: npcGroup.position.z },
                    forwardOff,
                    distDown,
                    hitY: hitPoint ? hitPoint.y : null,
                  })
              );
            }
          } else {
            updateNpcDebugRayLine(npcGroup, "_kccGroundProbeLine", 0x2dff2d, 3, new THREE.Vector3(), new THREE.Vector3(), false);
          }
        } catch {
          // ignore
        }
      }

  			      // Extra always-on logging for diagnosing "teleport" during fall->wall push transitions.
  			      // Emits at most once per ~200ms per NPC, and only when a push is being applied.
  			      if (fallSlidePush != null) {
  			        try {
  			          const nowMs = Date.now();
  			          const lastAt = (ud as any)._fallWallPushDbgLogAtMs as number | undefined;
  			          if (typeof lastAt !== "number" || nowMs - lastAt > 200) {
  			            (ud as any)._fallWallPushDbgLogAtMs = nowMs;
  			            const npcData = (npcGroup.userData as any)?.npcData as NpcData | undefined;
  			            const moved = { x: next.x - prevTranslation.x, y: next.y - prevTranslation.y, z: next.z - prevTranslation.z };
  			            console.log(
  			              "[NPCFallWallPushDbgJSON]" +
  			                JSON.stringify({
  			                  t: nowMs,
  			                  npc: npcData?.symbolName ?? npcData?.instanceIndex ?? null,
  			                  frame: physicsFrameRef.current,
  			                  phase: fallWallPushDbg?.phase ?? null,
  			                  duration: fallWallPushDbg?.duration ?? null,
  			                  push: fallSlidePush,
  				                  pushMeta: fallWallPushDbg,
  				                  desired: { x: dx, y: dy, z: dz },
  				                  kccMove: { x: move.x, y: move.y, z: move.z },
  				                  translationPrev: prevTranslation,
  				                  translationNext: next,
  				                  moved,
  				                  rawGroundedNow,
  				                  vy: (ud as any)._kccVy ?? null,
  				                  bestGroundNy,
  				                  slopeDeg: slopeAngleNow != null ? THREE.MathUtils.radToDeg(slopeAngleNow) : null,
  				                  maxSlopeDeg: THREE.MathUtils.radToDeg(kccConfig.maxSlopeClimbAngle),
  				                  toFallDeg: THREE.MathUtils.radToDeg(kccConfig.slideToFallAngle),
  				                })
  			            );
  			          }
  			        } catch {
  			          // ignore
  			        }
  			      }

  			      // If we touch walkable ground, stop any ongoing fall->wall push transition.
  			      if (rawGroundedNow && slopeAngleNow != null && slopeAngleNow <= kccConfig.maxSlopeClimbAngle + 1e-3) {
  			        ud._kccFallWallPushT = 0;
  			        ud._kccFallWallPushTotalDist = 0;
  			        ud._kccFallWallPushDir = undefined;
  			      }

      // Optional: block stepping onto very steep surfaces (treat as a wall).
      if (
        kccConfig.slideEntryBlockEnabled &&
        wasStableGrounded &&
        !wasSliding &&
        !wasFalling &&
  		        desiredDistXZ > 1e-6 &&
  		        rawGroundedNow &&
  		        slopeAngleNow != null &&
  		        slopeAngleNow >= kccConfig.slideEntryBlockAngle
  		      ) {
  		        // Only block if we can still find a walkable floor underneath the previous position.
  		        // This avoids blocking legitimate step-off-a-ledge situations where the only contact is a steep triangle.
  		        let hasWalkableFloorUnderPrev = false;
  		        try {
  		          if (kccConfig.groundRecoverDistance > 0) {
  		            const WORLD_MEMBERSHIP = 0x0001;
  		            const filterGroups = (WORLD_MEMBERSHIP << 16) | WORLD_MEMBERSHIP;
  		            const filterFlags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
  		            const startAbove = kccConfig.groundRecoverRayStartAbove;
  		            const maxToi = startAbove + kccConfig.groundRecoverDistance;
  		            const feetYPrev = prevTranslation.y - capsuleHeight / 2;
  		            const ray = new rapier.Ray({ x: prevTranslation.x, y: feetYPrev + startAbove, z: prevTranslation.z }, { x: 0, y: -1, z: 0 });
  		            const hit = rapierWorld.castRayAndGetNormal(ray, maxToi, true, filterFlags, filterGroups, collider);
  		            if (hit) {
  		              const ny = hit.normal?.y ?? 0;
  		              const minNy = Math.cos(kccConfig.maxSlopeClimbAngle + 1e-3);
  		              if (typeof ny === "number" && Number.isFinite(ny) && ny >= minNy) {
  		                const p = ray.pointAt(hit.timeOfImpact);
  		                const deltaDownToHit = feetYPrev - p.y;
  		                if (deltaDownToHit >= -1e-3 && deltaDownToHit <= kccConfig.groundRecoverDistance + 1e-3) {
  		                  hasWalkableFloorUnderPrev = true;
  		                }
  		              }
  		            }
  		          }
  		        } catch {
  		          // ignore
  		        }
  		        if (!hasWalkableFloorUnderPrev) {
  		          // Let the normal KCC/fall logic handle it (likely a real ledge).
  		        } else {
  		        collider.setTranslation(prevTranslation);
  		        npcGroup.position.set(prevTranslation.x, prevTranslation.y - capsuleHeight / 2, prevTranslation.z);
  		        vy = 0;
  		        ud._kccVy = 0;
  		        ud._kccGrounded = true;
  		        ud._kccStableGrounded = true;
  		        ud._kccUngroundedFor = 0;
  		        ud.isFalling = false;
  		        ud.isSliding = false;
  		        ud._kccSlideSpeed = 0;
  		        ud._kccSlideToFallFor = 0;
  		        ud._kccSlideExitFor = 0;
  		        updateNpcVisualSmoothing(npcGroup, dtClamped);
  		        ud._kccLastFrame = physicsFrameRef.current;
  		        return { blocked: true, moved: false };
  		        }
  		      }

  		      // Slide→fall grace: only flip into "falling" after the too-steep condition persists.
  		      let slideToFallFor = (ud._kccSlideToFallFor as number | undefined) ?? 0;
  		      if (tooSteepToStandNow && wasSliding) slideToFallFor += dtClamped;
  		      else slideToFallFor = 0;
  	      ud._kccSlideToFallFor = slideToFallFor;
  	      const slideToFallGraceActiveNow = tooSteepToStandNow && wasSliding && slideToFallFor < SLIDE_TO_FALL_GRACE_S;
  	      const tooSteepToStandEffective = tooSteepToStandNow && !slideToFallGraceActiveNow;

  	      const fallHitSlideSurfaceNow =
  	        wasFalling && slopeAngleNow != null && slopeAngleNow > kccConfig.maxSlopeClimbAngle + 1e-3;

  	      // Integrate gravity for the next frame (semi-implicit):
  	      // - If grounded on a walkable/slideable surface: reset vertical speed.
  	      // - If not grounded (or too steep to stand on / we are falling onto a slide surface): apply gravity.
  	      if (rawGroundedNow && !tooSteepToStandEffective && !fallHitSlideSurfaceNow) {
  	        vy = 0;
  	      } else {
  	        vy -= kccConfig.gravity * dtClamped;
  	        if (vy < -kccConfig.maxFallSpeed) vy = -kccConfig.maxFallSpeed;
  	      }

      // Stable grounded/falling state with hysteresis to prevent 1-frame flicker in animations.
      const FALL_GRACE_S = 0.08;
      const LAND_GRACE_S = 0.02;
      const FALL_VY_THRESHOLD = -20;

      let groundedFor = (ud._kccGroundedFor as number | undefined) ?? 0;
  	      let ungroundedFor = (ud._kccUngroundedFor as number | undefined) ?? 0;
  	      let stableGrounded = Boolean(ud._kccStableGrounded ?? rawGroundedNow);

  	      const canStandNow = rawGroundedNow && !tooSteepToStandEffective;
  	      if (canStandNow) {
  	        groundedFor += dtClamped;
  	        ungroundedFor = 0;
  	        if (!stableGrounded && groundedFor >= LAND_GRACE_S) stableGrounded = true;
  	      } else {
        groundedFor = 0;
        ungroundedFor += dtClamped;
        if (stableGrounded && ungroundedFor >= FALL_GRACE_S && vy <= FALL_VY_THRESHOLD) stableGrounded = false;
      }

      // Optional: allow stepping onto steep surfaces but suppress slide when stepping "up" onto them.
      // Forward-probe slide helpers removed.

  	      if (tooSteepToStandEffective) {
  	        // Very steep surfaces (near-walls) should behave like falling, not like "slow sliding".
  	        stableGrounded = false;
  	      }

      if (fallHitSlideSurfaceNow) {
        // If we were already falling, don't "stick" to a slide surface.
        stableGrounded = false;
      }

      // Hard reset: if KCC says we're grounded on a walkable slope, force stable grounded.
      if (
        rawGroundedNow &&
        slopeAngleNow != null &&
        slopeAngleNow <= kccConfig.maxSlopeClimbAngle + 1e-3 &&
        vy > -5
      ) {
        stableGrounded = true;
        groundedFor = Math.max(groundedFor, LAND_GRACE_S);
        ungroundedFor = 0;
      }

      ud._kccGroundedFor = groundedFor;
      ud._kccUngroundedFor = ungroundedFor;
      ud._kccStableGrounded = stableGrounded;

      ud._kccVy = vy;

      // If we are not grounded, attempt a lightweight ray-based recovery snap to avoid edge flicker on ramps/stairs.
      // This uses Rapier queries only (no legacy world mesh code).
  	      let recoveredToGround = false;
  	      let groundRayToi: number | null = null;
  	      let groundRayNormalY: number | null = null;
  	      let groundRayColliderHandle: number | null = null;
  	      let groundRecoverDropApplied: number | null = null;
  	      if (
  	        !rawGroundedNow &&
  	        !tooSteepToStandNow &&
  	        !fallHitSlideSurfaceNow &&
  	        (wasStableGrounded || stableGrounded) &&
        vy <= 0 &&
        kccConfig.groundRecoverDistance > 0
      ) {
        try {
          const WORLD_MEMBERSHIP = 0x0001;
          const filterGroups = (WORLD_MEMBERSHIP << 16) | WORLD_MEMBERSHIP;
          const filterFlags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
          const feetY = npcGroup.position.y;
          const startAbove = kccConfig.groundRecoverRayStartAbove;
          const maxToi = startAbove + kccConfig.groundRecoverDistance;
          const ray = new rapier.Ray(
            { x: npcGroup.position.x, y: feetY + startAbove, z: npcGroup.position.z },
            { x: 0, y: -1, z: 0 }
          );
          const hit = rapierWorld.castRayAndGetNormal(ray, maxToi, true, filterFlags, filterGroups, collider);
          if (hit) {
            groundRayToi = hit.timeOfImpact;
            groundRayNormalY = hit.normal?.y ?? null;
            groundRayColliderHandle = hit.collider?.handle ?? null;

            const minNy = Math.cos(kccConfig.maxSlopeClimbAngle + 1e-3);
            const nyOk = typeof groundRayNormalY === "number" && Number.isFinite(groundRayNormalY) && groundRayNormalY >= minNy;
            if (nyOk) {
              const p = ray.pointAt(hit.timeOfImpact);
              const deltaDownToHit = feetY - p.y;
              if (deltaDownToHit >= -1e-3 && deltaDownToHit <= kccConfig.groundRecoverDistance + 1e-3) {
                // Consider ourselves grounded again (even if we don't adjust Y), to avoid 1-frame fall flicker at edges.
  	                recoveredToGround = true;

  	                const targetFeetYRaw = Math.min(feetY, p.y + kccConfig.groundClearance);
  	                const dropWanted = feetY - targetFeetYRaw;
  	                const maxDrop = kccConfig.groundRecoverMaxDrop ?? 0;
  	                const drop = maxDrop > 0 ? Math.min(dropWanted, maxDrop) : 0;
  	                groundRecoverDropApplied = drop;
  	                if (drop > 1e-3) {
  	                  const targetFeetY = feetY - drop;
  	                  collider.setTranslation({
  	                    x: npcGroup.position.x,
  	                    y: targetFeetY + capsuleHeight / 2,
  	                    z: npcGroup.position.z,
  	                  });
  	                  npcGroup.position.y = targetFeetY;
  	                }

                vy = 0;
                ud._kccVy = 0;
                stableGrounded = true;
                groundedFor = Math.max(groundedFor, LAND_GRACE_S);
                ungroundedFor = 0;
                ud._kccGroundedFor = groundedFor;
                ud._kccUngroundedFor = ungroundedFor;
                ud._kccStableGrounded = true;
              }
            }
          }
        } catch {
          // ignore
        }
      }

      // Delay fall state/mechanics (not just animation), unless the forward probe sees a large drop.
      if (!stableGrounded) {
        const delayS = kccConfig.fallEntryDelaySeconds ?? 0;
        let entryFor = (ud._kccFallEntryFor as number | undefined) ?? 0;
        entryFor += dtClamped;
        ud._kccFallEntryFor = entryFor;
        const probeDrop = (ud as any)._kccGroundProbeDistDown as number | null | undefined;
        const skipDelay =
          probeDrop == null || (typeof probeDrop === "number" && Number.isFinite(probeDrop) && probeDrop > 50);
        if (!skipDelay && delayS > 0 && entryFor < delayS) {
          stableGrounded = true;
          groundedFor = Math.max(groundedFor, LAND_GRACE_S);
          ungroundedFor = 0;
          ud._kccStableGrounded = true;
          ud._kccUngroundedFor = 0;
        }
      } else {
        ud._kccFallEntryFor = 0;
      }

      ud.isFalling = !stableGrounded;
      if (!wasFalling && ud.isFalling) {
        (ud as any)._kccFallStartY = npcGroup.position.y;
      }
      if (wasFalling && !ud.isFalling) {
        const fallStartY = (ud as any)._kccFallStartY as number | undefined;
        const nowY = npcGroup.position.y;
        if (typeof fallStartY === "number" && Number.isFinite(fallStartY)) {
          const drop = fallStartY - nowY;
          console.log("[NPCFallDrop] " + drop);
          // Track repeated short falls: if >=4 landings within 1s, force 500ms lock.
          const nowMs = Date.now();
          const recentFalls =
            ((ud as any)._kccRecentFallsMs as number[] | undefined) ??
            ((ud as any)._kccRecentFallsMs = []);
          const cutoff = nowMs - 1000;
          let writeIdx = 0;
          for (let i = 0; i < recentFalls.length; i++) {
            const t = recentFalls[i];
            if (t >= cutoff) recentFalls[writeIdx++] = t;
          }
          recentFalls.length = writeIdx;
          recentFalls.push(nowMs);

          let lockMs = 0;
          if (recentFalls.length >= 4) {
            lockMs = 500;
          } else if (drop < 10) lockMs = 0;
          else if (drop < 20) lockMs = 100;
          else if (drop < 50) lockMs = 200;
          else if (drop < 100) lockMs = 300;
          else lockMs = 500;
          if (lockMs > 0) (ud as any)._kccIgnoreInputUntilMs = Date.now() + lockMs;
        }
        (ud as any)._kccFallStartY = undefined;
      }
      let fallFor = (ud._kccFallFor as number | undefined) ?? 0;
      if (!stableGrounded) fallFor += dtClamped;
      else fallFor = 0;
      ud._kccFallFor = fallFor;

  	      // Reduce slide<->walk jitter near the maxSlopeClimbAngle threshold:
  	      // when we were sliding and the slope briefly drops just below the threshold, keep sliding for a moment.
  	      const wantsSlideAngleNow = stableGrounded && slopeAngleNow != null && slopeAngleNow > kccConfig.maxSlopeClimbAngle + 1e-3;
  	      let slideExitFor = (ud._kccSlideExitFor as number | undefined) ?? 0;
  	      if (wasSliding && !wantsSlideAngleNow) slideExitFor += dtClamped;
  	      else slideExitFor = 0;
  	      ud._kccSlideExitFor = slideExitFor;
  	      const slideExitGraceActiveNow = wasSliding && !wantsSlideAngleNow && slideExitFor < SLIDE_EXIT_GRACE_S;

      let isSliding = false;
      if (stableGrounded) {
        // If KCC didn't give us any collision normals this frame (`groundNy=null`), keep the previous slide state
        // briefly; otherwise we can get a 1-frame slide->run->slide flicker even on a continuous slope.
        if (slopeAngleNow == null) {
          isSliding = wasSliding && slideExitGraceActiveNow;
        } else {
          const wantsSlideBySlope =
            slopeAngleNow > kccConfig.maxSlopeClimbAngle + 1e-3 &&
            (slopeAngleNow <= kccConfig.slideToFallAngle + 1e-3 || slideToFallGraceActiveNow);
          isSliding = wantsSlideBySlope;
          if (!isSliding && slideExitGraceActiveNow && slopeAngleNow <= kccConfig.slideToFallAngle + 1e-3) isSliding = true;
        }
      }
      // Delay slide state entry (not just animation). Count time spent in "slide candidate" state.
      const delayS = kccConfig.slideEntryDelaySeconds ?? 0;
      const wantsSlideBySlope =
        stableGrounded && slopeAngleNow != null && slopeAngleNow > kccConfig.maxSlopeClimbAngle + 1e-3;
      if (wantsSlideBySlope) {
        let entryFor = (ud._kccSlideEntryFor as number | undefined) ?? 0;
        const applyDelay = stableGrounded && !wasFalling && !wasSliding;
        if (applyDelay && delayS > 0) {
          entryFor += dtClamped;
          ud._kccSlideEntryFor = entryFor;
          if (entryFor < delayS) isSliding = false;
        } else {
          ud._kccSlideEntryFor = delayS;
        }
      } else {
        ud._kccSlideEntryFor = 0;
      }
      ud.isSliding = isSliding;
      if (wasSliding && !isSliding && playerGroupRef.current === npcGroup) {
        try {
          const nowMs = Date.now();
          const lastAt = (ud as any)._kccSlideExitLogAtMs as number | undefined;
          if (typeof lastAt !== "number" || nowMs - lastAt > 200) {
            (ud as any)._kccSlideExitLogAtMs = nowMs;
            console.log(
              "[NPCSlideExitJSON]" +
                JSON.stringify({
                  t: nowMs,
                  pos: { x: npcGroup.position.x, y: npcGroup.position.y, z: npcGroup.position.z },
                  stableGrounded,
                  groundedRaw: rawGroundedNow,
                  groundNy: bestGroundNy,
                  groundNyEffective: (ud as any)._kccGroundNyEffective ?? null,
                  slopeDeg: slopeAngleNow != null ? THREE.MathUtils.radToDeg(slopeAngleNow) : null,
                  slideExitFor,
                  slideExitGraceActive: slideExitGraceActiveNow,
                })
            );
          }
        } catch {
          // ignore
        }
      }
      if (wasSliding && !isSliding && stableGrounded) {
        (ud as any)._kccIgnoreInputUntilMs = Date.now() + 300;
      }
      let slideFor = (ud._kccSlideFor as number | undefined) ?? 0;
      if (isSliding) slideFor += dtClamped;
      else slideFor = 0;
      ud._kccSlideFor = slideFor;

      updateNpcVisualSmoothing(npcGroup, dtClamped);

      const isMotionDebugRuntime =
        typeof window !== "undefined" && Boolean((window as any).__npcMotionDebug) && playerGroupRef.current === npcGroup;
      const shouldStoreKccDbg = isMotionDebugRuntime && playerGroupRef.current === npcGroup;
  	      if (shouldStoreKccDbg) {
  	        const dbg =
  	          (ud._kccDbg as any) ??
  	          (ud._kccDbg = {
            dt: 0,
            desired: { x: 0, y: 0, z: 0 },
            computed: { x: 0, y: 0, z: 0 },
            stickDown: 0,
            groundedRaw: false,
            groundedStable: false,
            vy: 0,
  	            groundedFor: 0,
  	            ungroundedFor: 0,
  	            groundNy: null as number | null,
  	            groundNyEffective: null as number | null,
  	            floorProbeNy: null as number | null,
  	            floorProbeSrc: null as string | null,
  	            collisions: 0,
  	            groundRay: null as any,
  	            recoveredToGround: false,
  	            slopeBoost: null as any,
            slide: null as any,
            slideBlock: null as any,
          });
        dbg.dt = dtClamped;
        dbg.desired.x = dx;
        dbg.desired.y = dy;
        dbg.desired.z = dz;
        dbg.computed.x = move.x;
        dbg.computed.y = move.y;
        dbg.computed.z = move.z;
        dbg.stickDown = stickDown;
        dbg.groundedRaw = rawGroundedNow;
        dbg.groundedStable = stableGrounded;
        dbg.slideExitFor = slideExitFor;
        dbg.slideExitGraceActive = slideExitGraceActiveNow;
        dbg.vy = vy;
  	        dbg.groundedFor = groundedFor;
  	        dbg.ungroundedFor = ungroundedFor;
  	        dbg.groundNy = bestGroundNy;
  	        dbg.groundNyEffective = (ud as any)._kccGroundNyEffective ?? null;
  	        dbg.floorProbeNy = (ud as any)._kccFloorProbeNy ?? null;
  	        dbg.floorProbeSrc = (ud as any)._kccFloorProbeSrc ?? null;
  	        dbg.collisions = controller.numComputedCollisions?.() ?? 0;
  	        dbg.groundRay =
  	          groundRayToi != null
  	            ? { toi: groundRayToi, normalY: groundRayNormalY, colliderHandle: groundRayColliderHandle, recoverDrop: groundRecoverDropApplied }
  	            : null;
        dbg.recoveredToGround = recoveredToGround;
        dbg.slopeBoost = boostApplied ? { factor: boostFactor } : null;
        const wantsSlideBySlope =
          stableGrounded &&
          slopeAngleNow != null &&
          slopeAngleNow > kccConfig.maxSlopeClimbAngle + 1e-3 &&
          (slopeAngleNow <= kccConfig.slideToFallAngle + 1e-3 || slideToFallGraceActiveNow);
        dbg.slideCandidate = {
          wantsSlideBySlope,
          entryDelayS: kccConfig.slideEntryDelaySeconds ?? 0,
          entryFor: (ud._kccSlideEntryFor as number | undefined) ?? 0,
        };
        dbg.slide =
          wasSliding || isSliding || slideSpeedApplied != null || slideTooSteep
            ? {
                speed: slideSpeedApplied,
                tooSteep: slideTooSteep,
                toFallDeg: Math.round(THREE.MathUtils.radToDeg(kccConfig.slideToFallAngle) * 100) / 100,
                entryDelayS: kccConfig.slideEntryDelaySeconds ?? 0,
                entryFor: (ud._kccSlideEntryFor as number | undefined) ?? 0,
                wantsSlideBySlope,
              }
            : null;
        dbg.fallSlide =
          fallSlidePush != null
            ? { push: fallSlidePush, pushSpeed: kccConfig.fallSlidePushSpeed }
            : null;
        dbg.slideBlock =
          kccConfig.slideBlockUphillEnabled && wasSliding
            ? { wasSliding: true, blockedAlong: (ud._slideBlockedAlong as number | undefined) ?? null }
            : null;
      }

      const movedDistXZ = Math.hypot(npcGroup.position.x - fromX, npcGroup.position.z - fromZ);
      const blocked = desiredDistXZ > 1e-6 && movedDistXZ < desiredDistXZ - 1e-3;
      ud._kccLastFrame = physicsFrameRef.current;
      return { blocked: Boolean(ud._npcNpcBlocked) || blocked, moved: movedDistXZ > 1e-6 };
    } catch {
      // If Rapier throws for any reason, we keep behavior stable by applying the raw desired translation.
      const beforeX = npcGroup.position.x;
      const beforeZ = npcGroup.position.z;
      npcGroup.position.x = desiredX;
      npcGroup.position.z = desiredZ;
      const moved = Math.abs(npcGroup.position.x - beforeX) > 1e-6 || Math.abs(npcGroup.position.z - beforeZ) > 1e-6;
      updateNpcVisualSmoothing(npcGroup, dtClamped);
      ud._kccLastFrame = physicsFrameRef.current;
      return { blocked: Boolean(ud._npcNpcBlocked), moved };
    }
  };

  const trySnapNpcToGroundWithRapier = (npcGroup: THREE.Group): boolean => {
    if (!rapierWorld || !rapier) return false;
    const ud: any = npcGroup.userData ?? (npcGroup.userData = {});
    if (ud._kccSnapped === true) return true;

    const collider = ensureNpcKccCollider(npcGroup);
    if (!collider) return false;

    const x = npcGroup.position.x;
    const z = npcGroup.position.z;

    const castDown = (rayStartAbove: number, maxDownDistance: number) => {
      const WORLD_MEMBERSHIP = 0x0001;
      const filterGroups = (WORLD_MEMBERSHIP << 16) | WORLD_MEMBERSHIP;
      const filterFlags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
      const ray = new rapier.Ray({ x, y: npcGroup.position.y + rayStartAbove, z }, { x: 0, y: -1, z: 0 });
      const maxToi = rayStartAbove + maxDownDistance;
      const minNormalY = 0.2;

      let bestToi: number | null = null;
      rapierWorld.intersectionsWithRay(
        ray,
        maxToi,
        true,
        (hit: any) => {
          const toi = hit?.timeOfImpact ?? 0;
          const ny = hit?.normal?.y ?? 0;
          if (!Number.isFinite(toi) || toi < 0) return true;
          if (!Number.isFinite(ny) || ny < minNormalY) return true;
          if (bestToi == null || toi < bestToi) bestToi = toi;
          return true;
        },
        filterFlags,
        filterGroups,
        collider
      );

      if (bestToi == null) return null;
      const p = ray.pointAt(bestToi);
      return { y: p.y };
    };

    const hit = castDown(50, 5000) || castDown(2000, 20000);
    if (!hit) return false;

    const feetY = hit.y + kccConfig.groundClearance;
    collider.setTranslation({ x, y: feetY + kccConfig.capsuleHeight / 2, z });
    npcGroup.position.y = feetY;

    ud._kccVy = 0;
    ud._kccGrounded = true;
    ud._kccStableGrounded = true;
    ud._kccGroundedFor = 0;
  	    ud._kccUngroundedFor = 0;
  	    ud._kccSnapped = true;
  	    ud.isFalling = false;
  	    ud.isSliding = false;
  	    ud._kccFallWallPushT = 0;
  	    ud._kccFallWallPushTotalDist = 0;
  	    ud._kccFallWallPushDir = undefined;

  	    // Reset visual smoothing so we don't keep an offset across teleports/spawns.
  	    ud._visSmoothY = npcGroup.position.y;
  	    const visualRoot = getNpcVisualRoot(npcGroup);
    if (visualRoot !== npcGroup) visualRoot.position.y = 0;
    return true;
  };

  return {
    kccConfig,
    getNpcVisualRoot,
    applyMoveConstraint,
    trySnapNpcToGroundWithRapier,
    removeNpcKccCollider,
  } as const;
}
