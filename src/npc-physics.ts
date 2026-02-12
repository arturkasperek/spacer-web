import { useMemo, useEffect, useRef, type MutableRefObject } from "react";
import { useRapier } from "@react-three/rapier";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { constrainCircleMoveXZ, type NpcCircleCollider } from "./npc-npc-collision";
import type { NpcData } from "./types";

type MoveConstraintResult = { blocked: boolean; moved: boolean };
type JumpType = "jump_forward" | "jump_up_low" | "jump_up_mid" | "jump_up_high" | "climb_up" | "blocked";
type JumpDecision = {
  type: JumpType;
  reason: string;
  canJump: boolean;
  ledgeHeight: number | null;
  obstacleDistance: number | null;
  ceilingClearance: number | null;
  fullWall: boolean;
};
type LedgeCandidate = {
  value: number;
  ledgePoint: THREE.Vector3;
  ledgeNormal: THREE.Vector3;
  ledgeCont: THREE.Vector3;
  ledgeHeight: number;
  maxMoveForward: number;
  obstacleDistance: number | null;
};
type JumpScanReport = {
  y: number;
  hit: boolean;
  hitColliderHandle: number | null;
  hitPoint: THREE.Vector3 | null;
  hitNormal: THREE.Vector3 | null;
  start: THREE.Vector3;
  end: THREE.Vector3;
};

// Centralized NPC movement/physics tuning (hardcoded; no query params).
// Keep this as the single place to tweak feel/thresholds.
export const NPC_RENDER_TUNING = {
  // KCC shape
  radius: 20,
  capsuleHeight: 180,
  stepHeight: 30,

  // Slopes
  maxSlopeDeg: 48, // walkable slope (slide starts above this)
  slideToFallDeg: 67, // slide->fall threshold

  // Physics
  gravity: 1030,
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

  // Jumping
  jumpSpeed: 420,
  jumpForwardSpeed: 400,
  jumpGraceSeconds: 0.7,
  jumpGraceMinDistDown: 30,
  jumpForwardMinScale: 0.7,
  jumpForwardEasePower: 0.7,
  jumpUpForwardBoost: 1.5,
  jumpUpUseLedgeDir: true,
  // Jump-up assist: lerp/arc to ledge instead of teleport.
  jumpUpTeleportOnStart: true,
  jumpUpTeleportSkipKccMs: 280,
  jumpUpAssistDelaySeconds: 0.35,
  jumpUpAssistDurationSeconds: 0.5,
  jumpUpAssistArcHeight: 40,
  jumpUpHeight: 120,
  ledgeScanForwardDistance: 55,
  ledgeScanDepth: 100,
  ledgeScanStepBack: 20,
  ledgeScanStepForward: 3,
  ledgeScanVertMinThresh: 10,
  ledgeScanVertMaxThresh: 40,
  jumpScanStartYOffsetFactor: 0.05,
  ledgeScanDownRange: 120,
  ledgeScanUpRange: 320,
  ledgeScanWallHeadingAngleDeg: 45,
  ledgeScanWallHorizAngleDeg: 45,
  ledgeScanGroundAngleDeg: 45,
  ledgeScanMoveForward: 30,
  ledgeScanSpaceCheckHeightFactor: 0.9,
  jumpDecisionObstacleMinDist: 6,
  jumpDecisionObstacleMaxDist: 180,
  jumpDecisionCeilingClearanceMin: 12,
  jumpDecisionLowMaxHeight: 105,
  jumpDecisionMidMaxHeight: 205,
  jumpDecisionHighMaxHeight: 305,

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
  manualControlSpeeds: { walk: 180, run: 350, back: 120 },
} as const;

export type UseNpcPhysicsArgs = {
  loadedNpcsRef: MutableRefObject<Map<string, THREE.Group>>;
  physicsFrameRef: MutableRefObject<number>;
  playerGroupRef: MutableRefObject<THREE.Group | null>;
  showKccCapsule?: boolean;
  showGroundProbeRay?: boolean;
  showJumpDebugRange?: boolean;
};

export function useNpcPhysics({
  loadedNpcsRef,
  physicsFrameRef,
  playerGroupRef,
  showKccCapsule = false,
  showGroundProbeRay = false,
  showJumpDebugRange = false,
}: UseNpcPhysicsArgs) {
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
  const getJumpSpeed = () => NPC_RENDER_TUNING.jumpSpeed;
  const getJumpForwardSpeed = () => NPC_RENDER_TUNING.jumpForwardSpeed;
  const getJumpGraceSeconds = () => NPC_RENDER_TUNING.jumpGraceSeconds;
  const getJumpGraceMinDistDown = () => NPC_RENDER_TUNING.jumpGraceMinDistDown;
  const getJumpForwardMinScale = () => NPC_RENDER_TUNING.jumpForwardMinScale;
  const getJumpForwardEasePower = () => NPC_RENDER_TUNING.jumpForwardEasePower;
  const getJumpUpForwardBoost = () => NPC_RENDER_TUNING.jumpUpForwardBoost;
  const getJumpUpUseLedgeDir = () => NPC_RENDER_TUNING.jumpUpUseLedgeDir;
  const getJumpUpTeleportOnStart = () => NPC_RENDER_TUNING.jumpUpTeleportOnStart;
  const getJumpUpTeleportSkipKccMs = () => NPC_RENDER_TUNING.jumpUpTeleportSkipKccMs;
  const getJumpUpAssistDelaySeconds = () => NPC_RENDER_TUNING.jumpUpAssistDelaySeconds;
  const getJumpUpAssistDurationSeconds = () => NPC_RENDER_TUNING.jumpUpAssistDurationSeconds;
  const getJumpUpAssistArcHeight = () => NPC_RENDER_TUNING.jumpUpAssistArcHeight;

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
      // Jumping
      jumpSpeed: getJumpSpeed(),
      jumpForwardSpeed: getJumpForwardSpeed(),
      jumpGraceSeconds: getJumpGraceSeconds(),
      jumpGraceMinDistDown: getJumpGraceMinDistDown(),
      jumpForwardMinScale: getJumpForwardMinScale(),
      jumpForwardEasePower: getJumpForwardEasePower(),
      jumpUpForwardBoost: getJumpUpForwardBoost(),
      jumpUpUseLedgeDir: getJumpUpUseLedgeDir(),
      jumpUpTeleportOnStart: getJumpUpTeleportOnStart(),
      jumpUpTeleportSkipKccMs: getJumpUpTeleportSkipKccMs(),
      jumpUpAssistDelaySeconds: getJumpUpAssistDelaySeconds(),
      jumpUpAssistDurationSeconds: getJumpUpAssistDurationSeconds(),
      jumpUpAssistArcHeight: getJumpUpAssistArcHeight(),
      jumpUpHeight: NPC_RENDER_TUNING.jumpUpHeight,
      ledgeScanForwardDistance: NPC_RENDER_TUNING.ledgeScanForwardDistance,
      ledgeScanDepth: NPC_RENDER_TUNING.ledgeScanDepth,
      ledgeScanStepBack: NPC_RENDER_TUNING.ledgeScanStepBack,
      ledgeScanStepForward: NPC_RENDER_TUNING.ledgeScanStepForward,
      ledgeScanVertMinThresh: NPC_RENDER_TUNING.ledgeScanVertMinThresh,
      ledgeScanVertMaxThresh: NPC_RENDER_TUNING.ledgeScanVertMaxThresh,
      jumpScanStartYOffsetFactor: NPC_RENDER_TUNING.jumpScanStartYOffsetFactor,
      ledgeScanDownRange: NPC_RENDER_TUNING.ledgeScanDownRange,
      ledgeScanUpRange: NPC_RENDER_TUNING.ledgeScanUpRange,
      ledgeScanWallHeadingAngleDeg: NPC_RENDER_TUNING.ledgeScanWallHeadingAngleDeg,
      ledgeScanWallHorizAngleDeg: NPC_RENDER_TUNING.ledgeScanWallHorizAngleDeg,
      ledgeScanGroundAngleDeg: NPC_RENDER_TUNING.ledgeScanGroundAngleDeg,
      ledgeScanMoveForward: NPC_RENDER_TUNING.ledgeScanMoveForward,
      ledgeScanSpaceCheckHeightFactor: NPC_RENDER_TUNING.ledgeScanSpaceCheckHeightFactor,
      jumpDecisionObstacleMinDist: NPC_RENDER_TUNING.jumpDecisionObstacleMinDist,
      jumpDecisionObstacleMaxDist: NPC_RENDER_TUNING.jumpDecisionObstacleMaxDist,
      jumpDecisionCeilingClearanceMin: NPC_RENDER_TUNING.jumpDecisionCeilingClearanceMin,
      jumpDecisionLowMaxHeight: NPC_RENDER_TUNING.jumpDecisionLowMaxHeight,
      jumpDecisionMidMaxHeight: NPC_RENDER_TUNING.jumpDecisionMidMaxHeight,
      jumpDecisionHighMaxHeight: NPC_RENDER_TUNING.jumpDecisionHighMaxHeight,

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
    // no-op
  };

  const updateNpcDebugRayLine = (
    npcGroup: THREE.Group,
    key: string,
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

  const updateNpcDebugPoint = (
    npcGroup: THREE.Object3D,
    key: string,
    color: number,
    radius: number,
    position: THREE.Vector3,
    visible: boolean
  ) => {
    if (npcGroup.userData == null) npcGroup.userData = {};
    let mesh = npcGroup.userData[key] as THREE.Mesh | undefined;
    const cached = npcGroup.userData[`${key}_r`] as number | undefined;
    if (!mesh || cached !== radius) {
      if (mesh) {
        try {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        } catch {
          // ignore
        }
        npcGroup.remove(mesh);
      }
      const geom = new THREE.SphereGeometry(radius, 10, 8);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
      mesh = new THREE.Mesh(geom, mat);
      mesh.renderOrder = 9999;
      mesh.frustumCulled = false;
      npcGroup.add(mesh);
      npcGroup.userData[key] = mesh;
      npcGroup.userData[`${key}_r`] = radius;
    }
    mesh.visible = visible;
    if (!visible) return;
    const local = position.clone();
    npcGroup.worldToLocal(local);
    mesh.position.copy(local);
  };

  const updateNpcDebugCapsuleWire = (
    npcGroup: THREE.Group,
    radius: number,
    height: number,
    color: number,
    visible: boolean
  ) => {
    if (npcGroup.userData == null) npcGroup.userData = {};
    let wire = npcGroup.userData._kccCapsuleWire as THREE.LineSegments | undefined;
    const cached = npcGroup.userData._kccCapsuleWireDims as { r: number; h: number } | undefined;
    if (!wire || !cached || cached.r !== radius || cached.h !== height) {
      if (wire) {
        try {
          wire.geometry.dispose();
          (wire.material as THREE.Material).dispose();
        } catch {
          // ignore
        }
        npcGroup.remove(wire);
      }
      const length = Math.max(0.001, height - radius * 2);
      const geom = new THREE.CapsuleGeometry(radius, length, 6, 12);
      const wireGeom = new THREE.WireframeGeometry(geom);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 });
      wire = new THREE.LineSegments(wireGeom, mat);
      wire.frustumCulled = false;
      wire.renderOrder = 9998;
      npcGroup.add(wire);
      npcGroup.userData._kccCapsuleWire = wire;
      npcGroup.userData._kccCapsuleWireDims = { r: radius, h: height };
    }
    wire.visible = visible;
    if (!visible) return;
    wire.position.set(0, height / 2, 0);
  };

  type JumpDebugRay = {
    start: THREE.Vector3;
    end: THREE.Vector3;
    hit: boolean;
  };

  const updateNpcDebugJumpScanRays = (npcGroup: THREE.Group, rays: JumpDebugRay[], visible: boolean) => {
    if (npcGroup.userData == null) npcGroup.userData = {};
    let group = npcGroup.userData._kccJumpScanRayGroup as THREE.Group | undefined;
    let pool = npcGroup.userData._kccJumpScanRayPool as Line2[] | undefined;
    if (!group) {
      group = new THREE.Group();
      group.name = "kcc-jump-scan-rays";
      group.visible = false;
      npcGroup.add(group);
      npcGroup.userData._kccJumpScanRayGroup = group;
    }
    if (!pool) {
      pool = [];
      npcGroup.userData._kccJumpScanRayPool = pool;
    }
    group.visible = visible;
    if (!visible) return;

    const ensureLine = (idx: number) => {
      let line = pool![idx];
      if (line) return line;
      const geometry = new LineGeometry();
      const material = new LineMaterial({ color: 0x2ddf2d, linewidth: 2, depthTest: false });
      if (typeof window !== "undefined") material.resolution.set(window.innerWidth, window.innerHeight);
      line = new Line2(geometry, material);
      line.frustumCulled = false;
      line.visible = false;
      line.renderOrder = 9998;
      group!.add(line);
      pool![idx] = line;
      return line;
    };

    for (let i = 0; i < rays.length; i++) {
      const line = ensureLine(i);
      const mat = line.material as LineMaterial;
      if (typeof window !== "undefined") mat.resolution.set(window.innerWidth, window.innerHeight);
      mat.color.setHex(rays[i].hit ? 0xff2f2f : 0x2ddf2d);
      mat.linewidth = 2;

      const s = rays[i].start.clone();
      const e = rays[i].end.clone();
      npcGroup.worldToLocal(s);
      npcGroup.worldToLocal(e);
      (line.geometry as LineGeometry).setPositions([s.x, s.y, s.z, e.x, e.y, e.z]);
      line.computeLineDistances();
      line.visible = true;
    }
    for (let i = rays.length; i < pool.length; i++) {
      pool[i].visible = false;
    }
  };

  const decideJumpTypeFromScan = (
    range: {
      floorY: number;
      rangeTopY: number;
      ceilingY: number;
    },
    reports: JumpScanReport[],
    bestLedge: LedgeCandidate | null
  ): JumpDecision => {
    if (!reports.length) {
      return {
        type: "jump_forward",
        reason: "no_scan_data",
        canJump: true,
        ledgeHeight: null,
        obstacleDistance: null,
        ceilingClearance: null,
        fullWall: false,
      };
    }

    const sorted = reports.slice().sort((a, b) => b.y - a.y);
    const hitReports = sorted.filter((r) => r.hit);
    const hitCount = hitReports.length;
    const fullWall = hitCount > 0 && hitCount === sorted.length;
    const highestHit = hitCount > 0 ? hitReports[0] : null;
    const obstacleDistance =
      bestLedge?.obstacleDistance ??
      (highestHit != null ? Math.hypot(highestHit.end.x - highestHit.start.x, highestHit.end.z - highestHit.start.z) : null);
    const obstacleMin = kccConfig.jumpDecisionObstacleMinDist;
    const obstacleMax = kccConfig.jumpDecisionObstacleMaxDist;
    const obstacleInRange = obstacleDistance != null && obstacleDistance >= obstacleMin && obstacleDistance <= obstacleMax;
    const ceilingClearance = range.ceilingY - (range.floorY + kccConfig.capsuleHeight);
    const hasCeilingSpace = ceilingClearance >= kccConfig.jumpDecisionCeilingClearanceMin;

    let ledgeHeight: number | null = bestLedge ? bestLedge.ledgeHeight : null;
    if (ledgeHeight == null) {
      let ledgeY: number | null = null;
      for (let i = 0; i < sorted.length - 1; i++) {
        const upper = sorted[i];
        const lower = sorted[i + 1];
        if (!upper.hit && lower.hit) {
          ledgeY = (upper.y + lower.y) * 0.5;
          break;
        }
      }
      if (ledgeY == null && highestHit) ledgeY = highestHit.y;
      ledgeHeight = ledgeY != null ? ledgeY - range.floorY : null;
    }

    if (fullWall) {
      return {
        type: "blocked",
        reason: "full_wall",
        canJump: false,
        ledgeHeight,
        obstacleDistance,
        ceilingClearance,
        fullWall: true,
      };
    }
    if (!hasCeilingSpace) {
      return {
        type: "blocked",
        reason: "low_ceiling_clearance",
        canJump: false,
        ledgeHeight,
        obstacleDistance,
        ceilingClearance,
        fullWall: false,
      };
    }
    if (hitCount === 0) {
      return {
        type: "jump_forward",
        reason: "clear_forward_path",
        canJump: true,
        ledgeHeight: null,
        obstacleDistance: null,
        ceilingClearance,
        fullWall: false,
      };
    }
    if (!bestLedge) {
      return {
        type: "jump_forward",
        reason: "no_best_ledge",
        canJump: true,
        ledgeHeight: null,
        obstacleDistance,
        ceilingClearance,
        fullWall: false,
      };
    }
    if (!obstacleInRange) {
      return {
        type: "jump_forward",
        reason: obstacleDistance != null && obstacleDistance < obstacleMin ? "obstacle_too_close" : "obstacle_too_far",
        canJump: true,
        ledgeHeight,
        obstacleDistance,
        ceilingClearance,
        fullWall: false,
      };
    }
    if (ledgeHeight == null || ledgeHeight <= kccConfig.stepHeight) {
      return {
        type: "jump_forward",
        reason: "ledge_below_step_height",
        canJump: true,
        ledgeHeight,
        obstacleDistance,
        ceilingClearance,
        fullWall: false,
      };
    }
    if (ledgeHeight <= kccConfig.jumpDecisionLowMaxHeight) {
      return {
        type: "jump_up_low",
        reason: "ledge_height_low",
        canJump: true,
        ledgeHeight,
        obstacleDistance,
        ceilingClearance,
        fullWall: false,
      };
    }
    if (ledgeHeight <= kccConfig.jumpDecisionMidMaxHeight) {
      return {
        type: "jump_up_mid",
        reason: "ledge_height_mid",
        canJump: true,
        ledgeHeight,
        obstacleDistance,
        ceilingClearance,
        fullWall: false,
      };
    }
    if (ledgeHeight <= kccConfig.jumpDecisionHighMaxHeight) {
      return {
        type: "jump_up_high",
        reason: "ledge_height_high",
        canJump: true,
        ledgeHeight,
        obstacleDistance,
        ceilingClearance,
        fullWall: false,
      };
    }
    return {
      type: "climb_up",
      reason: "ledge_above_jump_up_high",
      canJump: true,
      ledgeHeight,
      obstacleDistance,
      ceilingClearance,
      fullWall: false,
    };
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
  			    const fromY = npcGroup.position.y;
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
        const skipFallDownPhase = Boolean((ud as any)._kccSkipFallDownPhase);
  	      let inFallDownPhase = fallDownHeight > 1e-6 && fallDownDistY < fallDownHeight - 1e-6;
        if (skipFallDownPhase) {
          inFallDownPhase = false;
          if (fallDownHeight > 0) (ud as any)._kccFallDownDistY = fallDownHeight + 1;
        }
  	      if (inFallDownPhase && desiredDistXZ > 1e-6) {
  	        desiredX = fromX;
  	        desiredZ = fromZ;
  	        dx = 0;
  	        dz = 0;
  	        desiredDistXZ = 0;
  	      }
  	    }
  let vy = (ud._kccVy as number | undefined) ?? 0;
  let didJumpThisFrame = false;
  let jumpUpInitial = 0;
  const nowMs = Date.now();
  const prevJumpActive = Boolean((ud as any)._kccJumpActivePrev);
  let jumpActive = Boolean((ud as any)._kccJumpActive);
  const jumpForceUntilMs = (ud as any)._kccJumpForceActiveUntilMs as number | undefined;
  const jumpForceActive = jumpActive && typeof jumpForceUntilMs === "number" && nowMs < jumpForceUntilMs;
  const groundedNow = Boolean(ud._kccStableGrounded ?? ud._kccGrounded);
  const probeDistDown = (ud as any)._kccGroundProbeDistDown as number | null | undefined;
  const minAirMsConfig = 0;
  const minAirMsOverride = (ud as any)._kccJumpMinAirMs as number | undefined;
  const minAirMs =
    typeof minAirMsOverride === "number" && Number.isFinite(minAirMsOverride) && minAirMsOverride > 0
      ? minAirMsOverride
      : minAirMsConfig;
  const jumpStartMs = (ud as any)._kccJumpAtMs as number | undefined;
  const airForMs =
    typeof jumpStartMs === "number" && Number.isFinite(jumpStartMs) ? Math.max(0, nowMs - jumpStartMs) : 0;
  const canEndByGround = airForMs >= minAirMs;
  const graceMs = Math.max(0, (kccConfig.jumpGraceSeconds ?? 0) * 1000);
  const graceMinDown = kccConfig.jumpGraceMinDistDown ?? 30;
  const probeDownVal =
    typeof probeDistDown === "number" && Number.isFinite(probeDistDown) ? probeDistDown : null;
  const canEndByProbe = airForMs >= minAirMs;
  const shouldEndByProbe = canEndByProbe && probeDownVal != null && probeDownVal < 20;
  const graceActive = Boolean((ud as any)._kccJumpGraceActive);
  const graceUntilMs = (ud as any)._kccJumpGraceUntilMs as number | undefined;

  if (jumpForceActive) {
    (ud as any)._kccJumpGraceActive = false;
  } else if (jumpActive && graceActive) {
    if (shouldEndByProbe || (canEndByGround && groundedNow)) {
      (ud as any)._kccJumpGraceActive = false;
      (ud as any)._kccJumpActive = false;
      if (shouldEndByProbe) {
        (ud as any)._kccJumpEndByProbeAtMs = nowMs;
        (ud as any)._kccJumpEndByProbePending = true;
      }
      jumpActive = false;
    } else if (typeof graceUntilMs === "number" && nowMs >= graceUntilMs) {
      (ud as any)._kccJumpGraceActive = false;
      (ud as any)._kccJumpActive = false;
      if (!groundedNow) {
        (ud as any)._kccSkipFallDownPhase = true;
      }
      jumpActive = false;
    }
  } else if (jumpActive) {
    const canStartGrace =
      graceMs > 0 &&
      canEndByProbe &&
      (probeDownVal == null || probeDownVal >= graceMinDown);
    if (canStartGrace) {
      (ud as any)._kccJumpGraceActive = true;
      (ud as any)._kccJumpGraceStartMs = nowMs;
      (ud as any)._kccJumpGraceUntilMs = nowMs + graceMs;
    } else if ((canEndByGround && groundedNow) || shouldEndByProbe) {
      (ud as any)._kccJumpActive = false;
      if (shouldEndByProbe) {
        (ud as any)._kccJumpEndByProbeAtMs = nowMs;
        (ud as any)._kccJumpEndByProbePending = true;
      }
      jumpActive = false;
    }
  }
  if (!jumpActive) {
    (ud as any)._kccJumpGraceActive = false;
    (ud as any)._kccJumpGraceUntilMs = undefined;
    (ud as any)._kccJumpGraceStartMs = undefined;
    if (groundedNow) {
      (ud as any)._kccJumpBlockUntilMs = undefined;
    }
  }
  // no-op
  if (prevJumpActive && !jumpActive) {
    (ud as any)._kccGroundRecoverSuppressUntilMs = nowMs + 200;
    (ud as any)._kccJumpDecisionFrozen = null;
    (ud as any)._kccJumpLedgeFrozen = null;
    (ud as any)._kccJumpTeleportSkipKccUntilMs = undefined;
    (ud as any)._kccJumpForceActiveUntilMs = undefined;
  }
  (ud as any)._kccJumpActivePrev = jumpActive;
  const jumpBlockUntilMs = (ud as any)._kccJumpBlockUntilMs as number | undefined;
  const jumpBlocked = typeof jumpBlockUntilMs === "number" && nowMs < jumpBlockUntilMs;
  const jumpReq = (ud as any)._kccJumpRequest as { atMs: number; jumpType?: JumpType } | undefined;
  if (jumpReq && wasStableGrounded && !jumpActive && !jumpBlocked) {
    (ud as any)._kccJumpRequest = undefined;
    (ud as any)._kccJumpAtMs = jumpReq.atMs;
    (ud as any)._kccJumpType = jumpReq.jumpType ?? "jump_forward";
    const jumpTypeNow = (ud as any)._kccJumpType as JumpType | undefined;
    const isJumpUp =
      jumpTypeNow === "jump_up_low" ||
      jumpTypeNow === "jump_up_mid" ||
      jumpTypeNow === "jump_up_high" ||
      jumpTypeNow === "climb_up";
    const skipJumpSpeed = isJumpUp && kccConfig.jumpUpTeleportOnStart;
    if (!skipJumpSpeed) {
      jumpUpInitial = kccConfig.jumpSpeed;
      vy = Math.max(vy, jumpUpInitial);
    }
    (ud as any)._kccJumpActive = true;
    (ud as any)._kccJumpMinAirMs = undefined;
    const forward =
      (ud._kccForwardDir as THREE.Vector3 | undefined) ?? (ud._kccForwardDir = new THREE.Vector3());
    npcGroup.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
    else forward.normalize();
    (ud as any)._kccJumpDir = { x: forward.x, z: forward.z };
    (ud as any)._kccJumpUpRemainder = 0;
    (ud as any)._kccJumpDecisionFrozen = (ud as any)._kccJumpDecision ?? null;
    (ud as any)._kccJumpLedgeFrozen = (ud as any)._kccLedgeBest ?? null;
    if (isJumpUp && kccConfig.jumpUpTeleportOnStart) {
      const frozen = (ud as any)._kccJumpLedgeFrozen as
        | { point?: { x: number; y: number; z: number } | null }
        | null
        | undefined;
      const lp = frozen?.point;
      if (lp) {
        const delayS = Math.max(0, kccConfig.jumpUpAssistDelaySeconds ?? 0);
        const delayMs = delayS * 1000;
        const durS = Math.max(0.1, kccConfig.jumpUpAssistDurationSeconds ?? 0.28);
        const durMs = durS * 1000;
        const arc = Math.max(0, kccConfig.jumpUpAssistArcHeight ?? 0);
        const assistStart = nowMs + delayMs;
        const assistEnd = assistStart + durMs;
        (ud as any)._kccJumpAssist = {
          start: { x: npcGroup.position.x, y: npcGroup.position.y, z: npcGroup.position.z },
          end: { x: lp.x, y: lp.y, z: lp.z },
          startMs: assistStart,
          endMs: assistEnd,
          arc,
        };
        (ud as any)._kccJumpForceActiveUntilMs = assistEnd;
        if (typeof kccConfig.jumpUpTeleportSkipKccMs === "number" && kccConfig.jumpUpTeleportSkipKccMs > 0) {
          (ud as any)._kccJumpTeleportSkipKccUntilMs = Math.max(nowMs + kccConfig.jumpUpTeleportSkipKccMs, assistEnd);
        } else {
          (ud as any)._kccJumpTeleportSkipKccUntilMs = assistEnd;
        }
      }
    }
    didJumpThisFrame = true;
  }
  const jumpForwardScale = 1;
  const jumpTypeNow = (ud as any)._kccJumpType as JumpType | undefined;
  const isJumpUpNow =
    jumpTypeNow === "jump_up_low" ||
    jumpTypeNow === "jump_up_mid" ||
    jumpTypeNow === "jump_up_high" ||
    jumpTypeNow === "climb_up";
  const jumpSkipKccUntilMs = (ud as any)._kccJumpTeleportSkipKccUntilMs as number | undefined;
  const jumpSkipKccActive =
    jumpActive &&
    isJumpUpNow &&
    typeof jumpSkipKccUntilMs === "number" &&
    nowMs < jumpSkipKccUntilMs;
  if (jumpSkipKccActive) {
    // During jump-up assist, ignore KCC XZ response to prevent side-wall pushback.
    desiredX = fromX;
    desiredZ = fromZ;
    dx = 0;
    dz = 0;
    desiredDistXZ = 0;
  }
  // During jump: allow only sideways input (no forward/back steering).
  if (jumpActive) {
    const forward =
      (ud._kccJumpForwardDir as THREE.Vector3 | undefined) ?? (ud._kccJumpForwardDir = new THREE.Vector3());
    npcGroup.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
    else forward.normalize();

    const jumpDir = (ud as any)._kccJumpDir as { x: number; z: number } | undefined;
    const jumpType = (ud as any)._kccJumpType as JumpType | undefined;
    const isJumpUp =
      jumpType === "jump_up_low" || jumpType === "jump_up_mid" || jumpType === "jump_up_high" || jumpType === "climb_up";
    const frozenLedge = (ud as any)._kccJumpLedgeFrozen as
      | { point?: { x: number; y: number; z: number } | null }
      | null
      | undefined;
    const useLedgeDir = Boolean(kccConfig.jumpUpUseLedgeDir && isJumpUp && frozenLedge?.point);
    if (useLedgeDir && frozenLedge?.point) {
      const dxL = frozenLedge.point.x - npcGroup.position.x;
      const dzL = frozenLedge.point.z - npcGroup.position.z;
      const len = Math.hypot(dxL, dzL);
      if (len > 1e-6) {
        const lx = dxL / len;
        const lz = dzL / len;
        if (jumpDir) {
          jumpDir.x = lx;
          jumpDir.z = lz;
        } else {
          (ud as any)._kccJumpDir = { x: lx, z: lz };
        }
      } else if (jumpDir) {
        jumpDir.x = forward.x;
        jumpDir.z = forward.z;
      } else {
        (ud as any)._kccJumpDir = { x: forward.x, z: forward.z };
      }
    } else {
      // Always follow current facing direction while jumping.
      if (jumpDir) {
        jumpDir.x = forward.x;
        jumpDir.z = forward.z;
      } else {
        (ud as any)._kccJumpDir = { x: forward.x, z: forward.z };
      }
    }

    if (desiredDistXZ > 1e-6) {
      const rightX = forward.z;
      const rightZ = -forward.x;
      const inputRight = dx * rightX + dz * rightZ;
      dx = rightX * inputRight;
      dz = rightZ * inputRight;
      desiredX = fromX + dx;
      desiredZ = fromZ + dz;
      desiredDistXZ = Math.hypot(dx, dz);
    }
  }

  // no-op

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

      const nowMs = Date.now();
      const burstUntil = (ud as any)._kccStuckBurstUntilMs as number | undefined;
      const burstRemaining = (ud as any)._kccStuckBurstRemaining as number | undefined;
      const burstNextAt = (ud as any)._kccStuckBurstNextAtMs as number | undefined;

      if (stuckFor >= 2 && (burstUntil == null || nowMs > burstUntil)) {
        const durationMs = 3000;
        const count = 40;
        (ud as any)._kccStuckBurstUntilMs = nowMs + durationMs;
        (ud as any)._kccStuckBurstRemaining = count;
        (ud as any)._kccStuckBurstNextAtMs = nowMs;
        (ud as any)._kccStuckBurstIntervalMs = durationMs / count;
        (ud as any)._kccStuckBurstStartY = pos.y;
      }

      const intervalMs = (ud as any)._kccStuckBurstIntervalMs as number | undefined;
      if (burstUntil != null && burstRemaining && intervalMs && burstNextAt != null && nowMs <= burstUntil) {
        if (nowMs >= burstNextAt) {
          (ud as any)._kccStuckBurstNextAtMs = burstNextAt + intervalMs;
          (ud as any)._kccStuckBurstRemaining = burstRemaining - 1;

          const angle = Math.random() * Math.PI * 2;
          const pushSpeed = 650;
          const pushUp = 500;
          // First, push up to unstick from edges/steps.
          const burstStartY = (ud as any)._kccStuckBurstStartY as number | undefined;
          const maxRise = 250;
          const capY =
            typeof burstStartY === "number" && Number.isFinite(burstStartY) ? burstStartY + maxRise : pos.y + maxRise;
          const maxVy = dtClamped > 0 ? (capY - pos.y) / dtClamped : 0;
          if (maxVy > 0) {
            vy = Math.max(vy, Math.min(pushUp, maxVy));
          }
          // Then add a sideways nudge.
          dx += Math.cos(angle) * pushSpeed * dtClamped;
          dz += Math.sin(angle) * pushSpeed * dtClamped;
          desiredX = fromX + dx;
          desiredZ = fromZ + dz;
          desiredDistXZ = Math.hypot(dx, dz);
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
                  burstRemaining: burstRemaining - 1,
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
    if (wasStableGrounded && !didJumpThisFrame && !jumpActive) {
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
    if (wasStableGrounded && !wasSliding && !didJumpThisFrame && !jumpActive && desiredDistXZ > 1e-6) {
      const n =
        (ud._kccGroundNormal as { x: number; y: number; z: number } | undefined) ??
        ((ud as any)._kccFloorProbeNormal as { x: number; y: number; z: number } | undefined);
      const ny = n?.y ?? 0;
      if (n && Number.isFinite(n.x) && Number.isFinite(ny) && Number.isFinite(n.z) && ny > 0.2) {
        const slopeDy = -(n.x * dx + n.z * dz) / ny;
        if (Number.isFinite(slopeDy)) dy = slopeDy;
      }
    }

    // Apply jump forward impulse while the jump window is active.
  if (jumpActive) {
    // Parabolic jump: no per-frame vertical boost.
    const jumpDir = (ud as any)._kccJumpDir as { x: number; z: number } | undefined;
    if (jumpDir && Number.isFinite(jumpDir.x) && Number.isFinite(jumpDir.z)) {
      const graceActive = Boolean((ud as any)._kccJumpGraceActive);
      const jumpType = (ud as any)._kccJumpType as JumpType | undefined;
      const isJumpUp =
        jumpType === "jump_up_low" || jumpType === "jump_up_mid" || jumpType === "jump_up_high" || jumpType === "climb_up";
      if (jumpSkipKccActive) {
        // During teleport-skip, do not apply forward impulse.
        // Keep dx/dz as-is.
      } else {
      const fwd = kccConfig.jumpForwardSpeed * jumpForwardScale * (isJumpUp ? kccConfig.jumpUpForwardBoost : 1);
      if (!graceActive) {
        (ud as any)._kccJumpLastFwd = { x: jumpDir.x * fwd, z: jumpDir.z * fwd };
        dx += jumpDir.x * fwd * dtClamped;
        dz += jumpDir.z * fwd * dtClamped;
      } else {
        const last = (ud as any)._kccJumpLastFwd as { x: number; z: number } | undefined;
        const baseX = last?.x ?? jumpDir.x * fwd;
        const baseZ = last?.z ?? jumpDir.z * fwd;
        (ud as any)._kccJumpLastFwd = { x: baseX, z: baseZ };
        dx += baseX * dtClamped;
        dz += baseZ * dtClamped;
      }
      desiredX = fromX + dx;
      desiredZ = fromZ + dz;
      desiredDistXZ = Math.hypot(dx, dz);
      }
    }
  }

    // Jump-up assist: smoothly pull to ledge instead of teleporting.
    const assist = (ud as any)._kccJumpAssist as
      | { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number }; startMs: number; endMs: number; arc: number }
      | undefined;
    if (assist && nowMs < assist.startMs) {
      // Pre-assist delay: hold position while the "prepare" animation plays.
      desiredX = fromX;
      desiredZ = fromZ;
      dx = 0;
      dz = 0;
      desiredDistXZ = 0;
      dy = 0;
      vy = 0;
      (ud as any)._kccVy = 0;
      (ud as any)._kccJumpAssistActive = true;
    } else if (assist && nowMs >= assist.startMs) {
      const dur = Math.max(1, assist.endMs - assist.startMs);
      const tRaw = (nowMs - assist.startMs) / dur;
      const t = Math.max(0, Math.min(1, tRaw));
      const smooth = t * t * (3 - 2 * t);
      const baseX = assist.start.x + (assist.end.x - assist.start.x) * smooth;
      const baseY = assist.start.y + (assist.end.y - assist.start.y) * smooth;
      const baseZ = assist.start.z + (assist.end.z - assist.start.z) * smooth;
      const arc = assist.arc > 0 ? assist.arc * 4 * t * (1 - t) : 0;
      const targetX = baseX;
      const targetY = baseY + arc;
      const targetZ = baseZ;

      desiredX = targetX;
      desiredZ = targetZ;
      dx = desiredX - fromX;
      dz = desiredZ - fromZ;
      desiredDistXZ = Math.hypot(dx, dz);
      dy = targetY - fromY;
      vy = 0;
      (ud as any)._kccVy = 0;
      (ud as any)._kccJumpAssistActive = true;

      if (t >= 1 - 1e-4) {
        // Final snap and short stabilization to avoid end-of-assist jitter.
        npcGroup.position.x = assist.end.x;
        npcGroup.position.y = assist.end.y;
        npcGroup.position.z = assist.end.z;
        if (collider) {
          collider.setTranslation({
            x: assist.end.x,
            y: assist.end.y + kccConfig.capsuleHeight / 2,
            z: assist.end.z,
          });
        }
        vy = 0;
        (ud as any)._kccVy = 0;
        (ud as any)._kccGrounded = true;
        (ud as any)._kccStableGrounded = true;
        (ud as any)._kccUngroundedFor = 0;
        (ud as any)._kccGroundedFor = 0;
        (ud as any)._kccFallEntryFor = 0;
        (ud as any)._kccGroundRecoverSuppressUntilMs = nowMs + 150;
        (ud as any)._kccJumpTeleportSkipKccUntilMs = Math.max(
          (ud as any)._kccJumpTeleportSkipKccUntilMs ?? 0,
          nowMs + 80
        );
        (ud as any)._kccJumpAssist = undefined;
        (ud as any)._kccJumpAssistActive = false;
      }
    } else {
      (ud as any)._kccJumpAssistActive = false;
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

      let move = { x: dx, y: dy, z: dz };
      let bestGroundNormal: { x: number; y: number; z: number } | null = null;
      let bestGroundNy: number | null = null;
      if (!jumpSkipKccActive) {
        controller.computeColliderMovement(collider, { x: dx, y: dy, z: dz }, rapier.QueryFilterFlags.EXCLUDE_SENSORS, filterGroups);
        move = controller.computedMovement();
        try {
          bestGroundNormal = computeBestGroundNormal();
          bestGroundNy = bestGroundNormal?.y ?? null;
        } catch {
          bestGroundNormal = null;
          bestGroundNy = null;
        }
      }

      // Slope/step speed compensation: KCC tends to reduce the XZ component by ~normal.y when it has to climb.
      // This can make climbing ramps/step-like slopes feel slower than flat ground.
      if (
        !jumpSkipKccActive &&
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
                const skipFallDownPhase = Boolean((ud as any)._kccSkipFallDownPhase);
  				      let inFallDownPhase = fallDownHeight > 1e-6 && fallDownDistY < fallDownHeight - 1e-6;
                if (skipFallDownPhase) {
                  inFallDownPhase = false;
                  if (fallDownHeight > 0) (ud as any)._kccFallDownDistY = fallDownHeight + 1;
                }
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

      const rawGroundedNow = jumpSkipKccActive ? false : Boolean(controller.computedGrounded?.() ?? false);
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
          if (isHero && showGroundProbeRay) {
            const startV = new THREE.Vector3(ox, oy, oz);
            const endY = hitPoint ? hitPoint.y : oy - maxToi;
            const endV = new THREE.Vector3(ox, endY, oz);
            updateNpcDebugRayLine(npcGroup, "_kccGroundProbeLine", 0x2dff2d, 3, startV, endV, true);
          } else if (isHero) {
            updateNpcDebugRayLine(npcGroup, "_kccGroundProbeLine", 0x2dff2d, 3, new THREE.Vector3(), new THREE.Vector3(), false);
          } else {
            updateNpcDebugRayLine(npcGroup, "_kccGroundProbeLine", 0x2dff2d, 3, new THREE.Vector3(), new THREE.Vector3(), false);
          }

          // ZenGin-like ledge scan Y-range at the probe origin:
          // - scan down to find local floor
          // - scan up to find ceiling
          // - clamp usable jump-up interval by both limits
          const downRay = new rapier.Ray({ x: ox, y: npcGroup.position.y, z: oz }, { x: 0, y: -1, z: 0 });
          const upRay = new rapier.Ray({ x: ox, y: npcGroup.position.y, z: oz }, { x: 0, y: 1, z: 0 });
          const downHit = rapierWorld.castRayAndGetNormal(downRay, kccConfig.ledgeScanDownRange, true, filterFlags, filterGroups, collider);
          const upHit = rapierWorld.castRayAndGetNormal(upRay, kccConfig.ledgeScanUpRange, true, filterFlags, filterGroups, collider);

          const floorY = downHit ? downRay.pointAt(downHit.timeOfImpact).y : npcGroup.position.y;
          const ceilingY = upHit ? upRay.pointAt(upHit.timeOfImpact).y : npcGroup.position.y + kccConfig.ledgeScanUpRange;
          const modelHeight = kccConfig.capsuleHeight;
          const jumpTopTargetY = floorY + kccConfig.jumpUpHeight * 0.95 + modelHeight;
          const maxTopY = Math.min(jumpTopTargetY, ceilingY);
          const rangeTopY = Math.max(floorY, maxTopY);

          // ZenGin-like recursive horizontal scan: upper/lower + middle subdivision.
          // We keep this as a geometry probe (for jump-type decision), independent from movement.
          const scanStepBack = kccConfig.ledgeScanStepBack;
          const scanDepth = kccConfig.ledgeScanDepth;
          const scanLen = scanDepth + scanStepBack;
          const scanBaseX = ox - forward.x * scanStepBack;
          const scanBaseZ = oz - forward.z * scanStepBack;
          const minThresh2 = kccConfig.ledgeScanVertMinThresh * kccConfig.ledgeScanVertMinThresh;
          const maxThresh2 = kccConfig.ledgeScanVertMaxThresh * kccConfig.ledgeScanVertMaxThresh;
          const reports = new Map<string, JumpScanReport>();
          const reject = (_reason: string) => null;
          const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

          const castRayHit = (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => {
            if (maxDist <= 1e-6) return null;
            const d = dir.clone();
            const len = d.length();
            if (len <= 1e-6) return null;
            d.multiplyScalar(1 / len);
            const ray = new rapier.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: d.x, y: d.y, z: d.z });
            const cast = rapierWorld.castRayAndGetNormal(ray, maxDist, true, filterFlags, filterGroups, collider);
            if (!cast) return null;
            const p = ray.pointAt(cast.timeOfImpact);
            const point = new THREE.Vector3(p.x, p.y, p.z);
            const n = cast.normal ? new THREE.Vector3(cast.normal.x, cast.normal.y, cast.normal.z) : null;
            if (n && n.lengthSq() >= 1e-6) n.normalize();
            const handle = (cast as any)?.collider?.handle;
            return {
              point,
              normal: n,
              handle: typeof handle === "number" ? handle : null,
              toi: cast.timeOfImpact,
            };
          };

          const mkKey = (y: number) => y.toFixed(4);
          const makeReport = (y: number): JumpScanReport => {
            const k = mkKey(y);
            const cached = reports.get(k);
            if (cached) return cached;
            const start = new THREE.Vector3(scanBaseX, y, scanBaseZ);
            const ray = new rapier.Ray({ x: start.x, y: start.y, z: start.z }, { x: forward.x, y: 0, z: forward.z });
            const cast = rapierWorld.castRayAndGetNormal(ray, scanLen, true, filterFlags, filterGroups, collider);
            let hit = false;
            let hitColliderHandle: number | null = null;
            let hitPoint: THREE.Vector3 | null = null;
            let hitNormal: THREE.Vector3 | null = null;
            let end = new THREE.Vector3(start.x + forward.x * scanLen, start.y, start.z + forward.z * scanLen);
            if (cast) {
              const p = ray.pointAt(cast.timeOfImpact);
              const d2 = (p.x - start.x) * (p.x - start.x) + (p.y - start.y) * (p.y - start.y) + (p.z - start.z) * (p.z - start.z);
              if (d2 >= scanStepBack * scanStepBack) {
                hit = true;
                end = new THREE.Vector3(p.x, p.y, p.z);
                const handle = (cast as any)?.collider?.handle;
                hitColliderHandle = typeof handle === "number" ? handle : null;
                hitPoint = end.clone();
                if (cast.normal) {
                  const n = new THREE.Vector3(cast.normal.x, cast.normal.y, cast.normal.z);
                  if (n.lengthSq() >= 1e-6) {
                    n.normalize();
                    hitNormal = n;
                  }
                }
              }
            }
            const rep = { y, hit, hitColliderHandle, hitPoint, hitNormal, start, end };
            reports.set(k, rep);
            return rep;
          };

          const evaluateLedgeCandidate = (upper: JumpScanReport, lower: JumpScanReport): LedgeCandidate | null => {
            if (!lower.hit || !lower.hitPoint || !lower.hitNormal) return reject("lower_no_hit");

            if (upper.hit && upper.hitPoint && lower.hitNormal.dot(upper.hitPoint.clone().sub(lower.hitPoint)) > 0) {
              return reject("concave_edge");
            }

            const lowerNy = lower.hitNormal.y;
            if (Math.abs(lowerNy) > 0.99) return reject("lower_flat");

            const groundAngleRad = THREE.MathUtils.degToRad(kccConfig.ledgeScanGroundAngleDeg);
            if (Math.abs(Math.acos(clamp(lowerNy, -1, 1))) < groundAngleRad) return reject("lower_ground_angle");

            const lowerHitNormalProj = new THREE.Vector3(-lower.hitNormal.x, 0, -lower.hitNormal.z);
            if (lowerHitNormalProj.lengthSq() < 1e-6) return reject("lower_proj_zero");
            lowerHitNormalProj.normalize();

            const wallHeadingAngleRad = THREE.MathUtils.degToRad(kccConfig.ledgeScanWallHeadingAngleDeg);
            const wallHorizAngleRad = THREE.MathUtils.degToRad(kccConfig.ledgeScanWallHorizAngleDeg);
            const headingAngle = Math.acos(clamp(lowerHitNormalProj.dot(forward), -1, 1));
            if (headingAngle >= wallHeadingAngleRad) return reject("wall_heading_angle");
            if (Math.abs(Math.asin(clamp(lowerNy, -1, 1))) >= wallHorizAngleRad) return reject("wall_horiz_angle");

            const forwardNormal = forward.clone();
            const div = forwardNormal.dot(lower.hitNormal);
            if (div > -0.01) return reject("lower_div_too_small");

            const lowerToUpper = upper.start.clone().sub(lower.start);
            lowerToUpper.sub(forwardNormal.clone().multiplyScalar(lowerToUpper.dot(lower.hitNormal) / div));
            const lowerToUpperLen = lowerToUpper.length();
            if (lowerToUpperLen <= 1e-3) return reject("lower_to_upper_short");

            const stepForward = kccConfig.ledgeScanStepForward;
            let rayStart = lower.hitPoint.clone().sub(forwardNormal.clone().multiplyScalar(scanStepBack));
            if (castRayHit(rayStart, lowerToUpper, lowerToUpperLen)) return reject("step_up_blocked");

            rayStart = rayStart
              .clone()
              .add(lowerToUpper)
              .add(forwardNormal.clone().multiplyScalar(scanStepBack + stepForward));

            let upperHitPoint: THREE.Vector3;
            let upperHitNormal: THREE.Vector3;
            if (!upper.hit || !upper.hitPoint || !upper.hitNormal || rayStart.clone().sub(upper.hitPoint).dot(upper.hitNormal) > 0) {
              const downHit = castRayHit(rayStart, lowerToUpper.clone().multiplyScalar(-1), lowerToUpperLen);
              if (!downHit || !downHit.normal) return reject("upper_down_no_hit");
              upperHitPoint = downHit.point;
              upperHitNormal = downHit.normal;
            } else {
              upperHitPoint = upper.hitPoint;
              upperHitNormal = upper.hitNormal;
            }

            if (upperHitNormal.y < Math.cos(groundAngleRad)) return reject("upper_not_ground");

            const div2 = lowerToUpper.dot(upperHitNormal);
            if (div2 < 0.01) return reject("upper_div_too_small");

            const ledgePoint = lower.hitPoint
              .clone()
              .add(lowerToUpper.clone().multiplyScalar(upperHitPoint.clone().sub(lower.hitPoint).dot(upperHitNormal) / div2));

            let value = 1;
            const vobPos = new THREE.Vector3(ox, npcGroup.position.y, oz);
            const toLedge = ledgePoint.clone().sub(vobPos);
            const toLedgeLen = toLedge.length();
            if (toLedgeLen > 1e-3) {
              const reachHit = castRayHit(vobPos, toLedge, toLedgeLen * 0.7);
              if (reachHit) value *= 0.001;
            }

            const cont = forwardNormal.clone().sub(upperHitNormal.clone().multiplyScalar(forwardNormal.dot(upperHitNormal)));
            if (cont.lengthSq() < 1e-6) return reject("cont_zero");
            cont.normalize();

            const moveForward = kccConfig.ledgeScanMoveForward;
            let maxMoveForward = moveForward;
            const contHit = castRayHit(ledgePoint.clone().add(new THREE.Vector3(0, 1, 0)), cont, moveForward + 10);
            if (contHit) {
              maxMoveForward = ledgePoint.distanceTo(contHit.point) - 10;
            }
            maxMoveForward -= 0;
            if (maxMoveForward < 10) value *= 0.001;

            const spaceCheck = ledgePoint
              .clone()
              .add(cont.clone().multiplyScalar(maxMoveForward * 0.5))
              .add(new THREE.Vector3(0, 1, 0));
            const spaceCheckHeight = kccConfig.capsuleHeight * kccConfig.ledgeScanSpaceCheckHeightFactor;
            const spaceHit = castRayHit(spaceCheck, new THREE.Vector3(0, 1, 0), spaceCheckHeight);
            if (spaceHit) return reject("space_blocked");

            const maxLen = kccConfig.jumpUpHeight * 1.5;
            let distValue = 1 - (toLedge.lengthSq() / (maxLen * maxLen));
            if (distValue < 0) distValue = 0;
            const orValue = lowerHitNormalProj.dot(forwardNormal);
            const edgeValue = 0.5 * (1 - lower.hitNormal.dot(upperHitNormal));
            const spaceValue = maxMoveForward / moveForward;
            value *= distValue * orValue * edgeValue * spaceValue;

            const ledgeHeight = ledgePoint.y - floorY;
            const obstacleDistance = lower.hitPoint ? Math.hypot(lower.hitPoint.x - lower.start.x, lower.hitPoint.z - lower.start.z) : null;

            return {
              value,
              ledgePoint,
              ledgeNormal: upperHitNormal.clone(),
              ledgeCont: cont.clone(),
              ledgeHeight,
              maxMoveForward,
              obstacleDistance,
            };
          };

          const recurseScan = (upper: JumpScanReport, lower: JumpScanReport) => {
            const dy = upper.y - lower.y;
            const dist2 = dy * dy;
            const sameCollider =
              lower.hitColliderHandle != null &&
              upper.hitColliderHandle != null &&
              lower.hitColliderHandle === upper.hitColliderHandle;
            if (sameCollider && (lower.hit || dist2 < maxThresh2)) return;
            if (dist2 > minThresh2) {
              const mid = makeReport(lower.y + dy * 0.5);
              recurseScan(upper, mid);
              recurseScan(mid, lower);
            }
          };

          const jumpScanStartYOffset = kccConfig.capsuleHeight * Math.max(0, kccConfig.jumpScanStartYOffsetFactor ?? 0);
          const scanStartY = Math.min(rangeTopY, floorY + jumpScanStartYOffset);
          const upper = makeReport(rangeTopY);
          const lower = makeReport(scanStartY);
          recurseScan(upper, lower);
          const sortedReports = Array.from(reports.values()).sort((a, b) => b.y - a.y);
          let bestLedge: LedgeCandidate | null = null;
          for (let i = 0; i < sortedReports.length - 1; i++) {
            const upperRep = sortedReports[i];
            const lowerRep = sortedReports[i + 1];
            const candidate = evaluateLedgeCandidate(upperRep, lowerRep);
            if (!candidate) continue;
            if (!bestLedge || candidate.value > bestLedge.value) bestLedge = candidate;
          }

          const jumpDecision = decideJumpTypeFromScan(
            {
              floorY,
              rangeTopY,
              ceilingY,
            },
            sortedReports,
            bestLedge
          );

          (ud as any)._kccLedgeScanRange = {
            yMin: floorY,
            scanStartY,
            yMax: rangeTopY,
            ceilingY,
            jumpTopTargetY,
            downHit: Boolean(downHit),
            upHit: Boolean(upHit),
            rayCount: sortedReports.length,
            hitCount: sortedReports.filter((r) => r.hit).length,
            bestLedgeValue: bestLedge?.value ?? null,
            bestLedgeHeight: bestLedge?.ledgeHeight ?? null,
          };
          if (!jumpActive) {
            (ud as any)._kccLedgeBest = bestLedge
              ? {
                  point: { x: bestLedge.ledgePoint.x, y: bestLedge.ledgePoint.y, z: bestLedge.ledgePoint.z },
                  normal: { x: bestLedge.ledgeNormal.x, y: bestLedge.ledgeNormal.y, z: bestLedge.ledgeNormal.z },
                  cont: { x: bestLedge.ledgeCont.x, y: bestLedge.ledgeCont.y, z: bestLedge.ledgeCont.z },
                  value: bestLedge.value,
                  ledgeHeight: bestLedge.ledgeHeight,
                  maxMoveForward: bestLedge.maxMoveForward,
                  obstacleDistance: bestLedge.obstacleDistance,
                }
              : null;
            (ud as any)._kccJumpDecision = jumpDecision;
          }

          // no-op

          const debugLedge =
            (jumpActive ? ((ud as any)._kccJumpLedgeFrozen as any) : (ud as any)._kccLedgeBest) ??
            (bestLedge
              ? {
                  point: { x: bestLedge.ledgePoint.x, y: bestLedge.ledgePoint.y, z: bestLedge.ledgePoint.z },
                  normal: { x: bestLedge.ledgeNormal.x, y: bestLedge.ledgeNormal.y, z: bestLedge.ledgeNormal.z },
                  cont: { x: bestLedge.ledgeCont.x, y: bestLedge.ledgeCont.y, z: bestLedge.ledgeCont.z },
                  maxMoveForward: bestLedge.maxMoveForward,
                }
              : null);

          if (isHero && showJumpDebugRange) {
            const startV = new THREE.Vector3(ox, scanStartY, oz);
            const endV = new THREE.Vector3(ox, rangeTopY, oz);
            updateNpcDebugRayLine(npcGroup, "_kccLedgeScanRangeLine", 0x22ccff, 5, startV, endV, true);
            updateNpcDebugJumpScanRays(
              npcGroup,
              sortedReports.map((r) => ({ start: r.start, end: r.end, hit: r.hit })),
              true
            );
            if (debugLedge && debugLedge.point) {
              const p = new THREE.Vector3(debugLedge.point.x, debugLedge.point.y, debugLedge.point.z);
              const n = debugLedge.normal
                ? new THREE.Vector3(debugLedge.normal.x, debugLedge.normal.y, debugLedge.normal.z)
                : new THREE.Vector3(0, 1, 0);
              const c = debugLedge.cont
                ? new THREE.Vector3(debugLedge.cont.x, debugLedge.cont.y, debugLedge.cont.z)
                : new THREE.Vector3(0, 0, 1);
              const normalEnd = p.clone().add(n.multiplyScalar(35));
              const contEnd = p.clone().add(c.multiplyScalar(Math.max(0, debugLedge.maxMoveForward ?? 0)));
              updateNpcDebugPoint(npcGroup, "_kccLedgeBestPoint", 0xfff200, 4, p, true);
              updateNpcDebugRayLine(npcGroup, "_kccLedgeBestNormalLine", 0xff8a00, 3, p, normalEnd, true);
              updateNpcDebugRayLine(npcGroup, "_kccLedgeBestForwardLine", 0x00c8ff, 3, p, contEnd, true);
            } else {
              updateNpcDebugPoint(npcGroup, "_kccLedgeBestPoint", 0xfff200, 4, new THREE.Vector3(), false);
              updateNpcDebugRayLine(npcGroup, "_kccLedgeBestNormalLine", 0xff8a00, 3, new THREE.Vector3(), new THREE.Vector3(), false);
              updateNpcDebugRayLine(npcGroup, "_kccLedgeBestForwardLine", 0x00c8ff, 3, new THREE.Vector3(), new THREE.Vector3(), false);
            }
          } else {
            updateNpcDebugRayLine(
              npcGroup,
              "_kccLedgeScanRangeLine",
              0x22ccff,
              5,
              new THREE.Vector3(),
              new THREE.Vector3(),
              false
            );
            updateNpcDebugJumpScanRays(npcGroup, [], false);
            updateNpcDebugPoint(npcGroup, "_kccLedgeBestPoint", 0xfff200, 4, new THREE.Vector3(), false);
            updateNpcDebugRayLine(npcGroup, "_kccLedgeBestNormalLine", 0xff8a00, 3, new THREE.Vector3(), new THREE.Vector3(), false);
            updateNpcDebugRayLine(npcGroup, "_kccLedgeBestForwardLine", 0x00c8ff, 3, new THREE.Vector3(), new THREE.Vector3(), false);
          }
        } catch {
          // ignore
        }
      }

      // Debug: render KCC capsule wireframe for hero.
      if (showKccCapsule && playerGroupRef.current === npcGroup) {
        const capsuleHeight = (ud._kccCapsuleHeight as number | undefined) ?? kccConfig.capsuleHeight;
        updateNpcDebugCapsuleWire(npcGroup, kccConfig.radius, capsuleHeight, 0xffd400, true);
      } else {
        updateNpcDebugCapsuleWire(npcGroup, kccConfig.radius, kccConfig.capsuleHeight, 0xffd400, false);
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
      if (jumpSkipKccActive) {
        vy = 0;
      } else if (rawGroundedNow && !tooSteepToStandEffective && !fallHitSlideSurfaceNow && !jumpActive) {
        vy = 0;
      } else {
        vy -= kccConfig.gravity * dtClamped;
        // no extra downward accel during grace
        if (vy < -kccConfig.maxFallSpeed) vy = -kccConfig.maxFallSpeed;
      }

      // Stable grounded/falling state with hysteresis to prevent 1-frame flicker in animations.
      const FALL_GRACE_S = 0.08;
      const LAND_GRACE_S = 0.02;
      const FALL_VY_THRESHOLD = -20;

      let groundedFor = (ud._kccGroundedFor as number | undefined) ?? 0;
  	      let ungroundedFor = (ud._kccUngroundedFor as number | undefined) ?? 0;
  	      let stableGrounded = Boolean(ud._kccStableGrounded ?? rawGroundedNow);

  	      const canStandNow = rawGroundedNow && !tooSteepToStandEffective && !jumpActive;
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
        vy > -5 &&
        !jumpActive
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
      const jumpEndByProbePending = Boolean((ud as any)._kccJumpEndByProbePending);
      if (jumpEndByProbePending && stableGrounded) {
        (ud as any)._kccJumpEndByProbePending = false;
      }
      const jumpGraceActiveRecover = Boolean((ud as any)._kccJumpGraceActive);
      const recoverSuppressUntilMs = (ud as any)._kccGroundRecoverSuppressUntilMs as number | undefined;
      const recoverSuppressed = typeof recoverSuppressUntilMs === "number" && nowMs < recoverSuppressUntilMs;
      if (
        !rawGroundedNow &&
        !tooSteepToStandNow &&
        !fallHitSlideSurfaceNow &&
        !jumpActive &&
        !jumpGraceActiveRecover &&
        !wasFalling &&
        !jumpEndByProbePending &&
        !recoverSuppressed &&
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

      const jumpGraceActive = Boolean((ud as any)._kccJumpGraceActive);
      ud.isFalling = !stableGrounded;
      // During jump/grace, don't enter fall state on landing.
      if (jumpActive || jumpGraceActive) {
        ud.isFalling = false;
      }
      const jumpEndByProbeAtMs = (ud as any)._kccJumpEndByProbeAtMs as number | undefined;
      const suppressFallAfterJump =
        typeof jumpEndByProbeAtMs === "number" && nowMs - jumpEndByProbeAtMs < 250;
      if (!jumpActive && !jumpGraceActive && !suppressFallAfterJump) {
        if (!wasFalling && ud.isFalling) {
          (ud as any)._kccFallStartY = npcGroup.position.y;
        }
        if (wasFalling && !ud.isFalling) {
          const fallStartY = (ud as any)._kccFallStartY as number | undefined;
          const nowY = npcGroup.position.y;
          if (typeof fallStartY === "number" && Number.isFinite(fallStartY)) {
            const drop = fallStartY - nowY;
            console.log("[NPCFallDrop] " + drop);
          const probeDistDown = (ud as any)._kccGroundProbeDistDown as number | null | undefined;
          console.log(
            "[NPCFallDropJSON]" +
              JSON.stringify({
                t: Date.now(),
                drop,
                probeDistDown: typeof probeDistDown === "number" && Number.isFinite(probeDistDown) ? probeDistDown : null,
              })
          );
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
      } else {
        (ud as any)._kccFallStartY = undefined;
      }
      // no-op
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
