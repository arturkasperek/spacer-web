import type * as THREE from "three";

export type JumpType =
  | "jump_forward"
  | "jump_up_low"
  | "jump_up_mid"
  | "jump_up_high"
  | "climb_up"
  | "blocked";

export type JumpDecision = {
  type: JumpType;
  reason: string;
  canJump: boolean;
  ledgeHeight: number | null;
  obstacleDistance: number | null;
  ceilingClearance: number | null;
  fullWall: boolean;
};

export type LedgeCandidate = {
  value: number;
  ledgePoint: THREE.Vector3;
  ledgeNormal: THREE.Vector3;
  ledgeCont: THREE.Vector3;
  ledgeHeight: number;
  maxMoveForward: number;
  obstacleDistance: number | null;
};

export type JumpScanReport = {
  y: number;
  hit: boolean;
  hitColliderHandle: number | null;
  hitPoint: THREE.Vector3 | null;
  hitNormal: THREE.Vector3 | null;
  start: THREE.Vector3;
  end: THREE.Vector3;
};

export type JumpDecisionConfig = {
  jumpDecisionObstacleMinDist: number;
  jumpDecisionObstacleMaxDist: number;
  capsuleHeight: number;
  jumpDecisionCeilingClearanceMin: number;
  stepHeight: number;
  jumpDecisionLowMaxHeight: number;
  jumpDecisionMidMaxHeight: number;
  jumpDecisionHighMaxHeight: number;
};

export function decideJumpTypeFromScan(
  range: {
    floorY: number;
    rangeTopY: number;
    ceilingY: number;
  },
  reports: JumpScanReport[],
  bestLedge: LedgeCandidate | null,
  kccConfig: JumpDecisionConfig,
): JumpDecision {
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
    (highestHit != null
      ? Math.hypot(highestHit.end.x - highestHit.start.x, highestHit.end.z - highestHit.start.z)
      : null);
  const obstacleMin = kccConfig.jumpDecisionObstacleMinDist;
  const obstacleMax = kccConfig.jumpDecisionObstacleMaxDist;
  const obstacleInRange =
    obstacleDistance != null && obstacleDistance >= obstacleMin && obstacleDistance <= obstacleMax;
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
      reason:
        obstacleDistance != null && obstacleDistance < obstacleMin
          ? "obstacle_too_close"
          : "obstacle_too_far",
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
}
