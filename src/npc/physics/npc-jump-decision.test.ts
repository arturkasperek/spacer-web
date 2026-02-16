import {
  decideJumpTypeFromScan,
  type JumpDecisionConfig,
  type JumpScanReport,
} from "./npc-jump-decision";

const cfg: JumpDecisionConfig = {
  jumpDecisionObstacleMinDist: 6,
  jumpDecisionObstacleMaxDist: 180,
  capsuleHeight: 180,
  jumpDecisionCeilingClearanceMin: 12,
  stepHeight: 30,
  jumpDecisionLowMaxHeight: 105,
  jumpDecisionMidMaxHeight: 205,
  jumpDecisionHighMaxHeight: 305,
};

const range = {
  floorY: 100,
  rangeTopY: 500,
  ceilingY: 600,
};

function report(y: number, hit: boolean, dist = 40): JumpScanReport {
  return {
    y,
    hit,
    hitColliderHandle: hit ? 1 : null,
    hitPoint: null,
    hitNormal: null,
    start: { x: 0, y, z: 0 } as any,
    end: { x: dist, y, z: 0 } as any,
  };
}

describe("npc-jump-decision", () => {
  it("returns jump_forward when there is no scan data", () => {
    const d = decideJumpTypeFromScan(range, [], null, cfg);
    expect(d.type).toBe("jump_forward");
    expect(d.reason).toBe("no_scan_data");
    expect(d.canJump).toBe(true);
  });

  it("returns blocked/full_wall when all scans hit", () => {
    const d = decideJumpTypeFromScan(range, [report(300, true), report(200, true)], null, cfg);
    expect(d.type).toBe("blocked");
    expect(d.reason).toBe("full_wall");
    expect(d.canJump).toBe(false);
    expect(d.fullWall).toBe(true);
  });

  it("returns blocked/low_ceiling_clearance when clearance is too low", () => {
    const d = decideJumpTypeFromScan(
      {
        ...range,
        ceilingY: range.floorY + cfg.capsuleHeight + cfg.jumpDecisionCeilingClearanceMin - 1,
      },
      [report(300, true), report(200, false)],
      null,
      cfg,
    );
    expect(d.type).toBe("blocked");
    expect(d.reason).toBe("low_ceiling_clearance");
    expect(d.canJump).toBe(false);
  });

  it("returns jump_forward/clear_forward_path when there are no hits", () => {
    const d = decideJumpTypeFromScan(range, [report(300, false), report(200, false)], null, cfg);
    expect(d.type).toBe("jump_forward");
    expect(d.reason).toBe("clear_forward_path");
  });

  it("returns jump_forward/no_best_ledge when hits exist but no candidate", () => {
    const d = decideJumpTypeFromScan(
      range,
      [report(300, true, 55), report(200, false, 55)],
      null,
      cfg,
    );
    expect(d.type).toBe("jump_forward");
    expect(d.reason).toBe("no_best_ledge");
    expect(d.obstacleDistance).toBe(55);
  });

  it("returns obstacle distance reasons when distance is out of range", () => {
    const tooClose = decideJumpTypeFromScan(
      range,
      [report(300, true), report(200, false)],
      {
        value: 1,
        ledgePoint: { x: 0, y: 0, z: 0 } as any,
        ledgeNormal: { x: 0, y: 1, z: 0 } as any,
        ledgeCont: { x: 1, y: 0, z: 0 } as any,
        ledgeHeight: 80,
        maxMoveForward: 10,
        obstacleDistance: 4,
      },
      cfg,
    );
    expect(tooClose.reason).toBe("obstacle_too_close");

    const tooFar = decideJumpTypeFromScan(
      range,
      [report(300, true), report(200, false)],
      {
        value: 1,
        ledgePoint: { x: 0, y: 0, z: 0 } as any,
        ledgeNormal: { x: 0, y: 1, z: 0 } as any,
        ledgeCont: { x: 1, y: 0, z: 0 } as any,
        ledgeHeight: 80,
        maxMoveForward: 10,
        obstacleDistance: 500,
      },
      cfg,
    );
    expect(tooFar.reason).toBe("obstacle_too_far");
  });

  it("returns ledge_below_step_height for very low ledges", () => {
    const d = decideJumpTypeFromScan(
      range,
      [report(300, true), report(200, false)],
      {
        value: 1,
        ledgePoint: { x: 0, y: 0, z: 0 } as any,
        ledgeNormal: { x: 0, y: 1, z: 0 } as any,
        ledgeCont: { x: 1, y: 0, z: 0 } as any,
        ledgeHeight: 20,
        maxMoveForward: 10,
        obstacleDistance: 40,
      },
      cfg,
    );
    expect(d.type).toBe("jump_forward");
    expect(d.reason).toBe("ledge_below_step_height");
  });

  it("classifies low/mid/high/climb ledges correctly", () => {
    const mk = (ledgeHeight: number) =>
      decideJumpTypeFromScan(
        range,
        [report(300, true), report(200, false)],
        {
          value: 1,
          ledgePoint: { x: 0, y: 0, z: 0 } as any,
          ledgeNormal: { x: 0, y: 1, z: 0 } as any,
          ledgeCont: { x: 1, y: 0, z: 0 } as any,
          ledgeHeight,
          maxMoveForward: 10,
          obstacleDistance: 40,
        },
        cfg,
      );

    expect(mk(80).type).toBe("jump_up_low");
    expect(mk(180).type).toBe("jump_up_mid");
    expect(mk(260).type).toBe("jump_up_high");
    expect(mk(400).type).toBe("climb_up");
  });
});
