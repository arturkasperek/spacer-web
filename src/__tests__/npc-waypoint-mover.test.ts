export {};

type MockWaypoint = { name: string; position: { x: number; y: number; z: number } };
type MockEdge = { waypoint_a_index: number; waypoint_b_index: number };

function createMockWaypointsVector(waypoints: MockWaypoint[]) {
  return {
    size: () => waypoints.length,
    get: (i: number) => waypoints[i],
  };
}

function createMockWorld(waypoints: MockWaypoint[], edges: MockEdge[]) {
  return {
    getAllWaypoints: () => createMockWaypointsVector(waypoints),
    getWaypointEdgeCount: () => edges.length,
    getWaypointEdge: (i: number) => ({ success: true, data: edges[i] }),
  } as any;
}

describe("npc waypoint mover", () => {
  let THREE: any;
  let createWaypointMover: typeof import("../npc-waypoint-mover").createWaypointMover;

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("three", () => jest.requireActual("three"));
    THREE = await import("three");
    ({ createWaypointMover } = await import("../npc-waypoint-mover"));
  });

  it("moves NPC along a simple 2-node route and returns locomotion mode", () => {
    const world = createMockWorld(
      [
        { name: "A", position: { x: 0, y: 0, z: 0 } },
        // Note: the mover flips X (Gothic -> Three), so this ends up at x=-10 in Three space.
        { name: "B", position: { x: 10, y: 0, z: 0 } },
      ],
      [{ waypoint_a_index: 0, waypoint_b_index: 1 }]
    );

    const mover = createWaypointMover(world);
    const group = new THREE.Group();
    group.position.set(0, 0, 0);

    const started = mover.startMoveToWaypoint("npc-1", group, "B", { speed: 140, arriveDistance: 0.01, locomotionMode: "walk" });
    expect(started).toBe(true);
    expect(group.userData.isScriptControlled).toBe(true);

    const tick1 = mover.update("npc-1", group, 0.01);
    expect(tick1.moved).toBe(true);
    expect(tick1.mode).toBe("walk");
    expect(group.position.x).toBeLessThan(0);
    expect(group.position.x).toBeGreaterThan(-10);

    const tick2 = mover.update("npc-1", group, 1.0);
    expect(tick2.moved).toBe(true);
    expect(tick2.mode).toBe("idle");
    expect(group.position.x).toBeCloseTo(-10, 5);
  });

  it("returns false when target waypoint is missing", () => {
    const world = createMockWorld([{ name: "A", position: { x: 0, y: 0, z: 0 } }], []);
    const mover = createWaypointMover(world);
    const group = new THREE.Group();
    group.position.set(0, 0, 0);

    const started = mover.startMoveToWaypoint("npc-1", group, "DOES_NOT_EXIST");
    expect(started).toBe(false);
  });

  it("returns false when no path exists between start and goal", () => {
    const world = createMockWorld(
      [
        { name: "A", position: { x: 0, y: 0, z: 0 } },
        { name: "B", position: { x: 10, y: 0, z: 0 } },
        { name: "C", position: { x: 20, y: 0, z: 0 } },
      ],
      [{ waypoint_a_index: 0, waypoint_b_index: 1 }]
    );

    const mover = createWaypointMover(world);
    const group = new THREE.Group();
    group.position.set(0, 0, 0);

    const started = mover.startMoveToWaypoint("npc-1", group, "C");
    expect(started).toBe(false);
  });

  it("does not get stuck when already at the next waypoint position (dist=0)", () => {
    const world = createMockWorld(
      [
        { name: "A", position: { x: 0, y: 0, z: 0 } },
        { name: "B", position: { x: 10, y: 0, z: 0 } },
      ],
      [{ waypoint_a_index: 0, waypoint_b_index: 1 }]
    );

    const mover = createWaypointMover(world);
    const group = new THREE.Group();
    group.position.set(0, 0, 0);

    expect(mover.startMoveToWaypoint("npc-1", group, "B", { speed: 140, arriveDistance: 0.01, locomotionMode: "walk" })).toBe(true);

    // Force the NPC exactly onto the target XZ (the mover only advances the route when it decides to "snap").
    group.position.set(-10, 0, 0);

    const tick = mover.update("npc-1", group, 0.016);
    expect(tick.mode).toBe("idle");
    expect(group.position.x).toBeCloseTo(-10, 6);
  });

  it("treats intermediate waypoints as a gate (does not require snapping), but still snaps to final destination", () => {
    const world = createMockWorld(
      [
        { name: "A", position: { x: 0, y: 0, z: 0 } },
        // Three X becomes -200
        { name: "B", position: { x: 200, y: 0, z: 0 } },
        // Three X becomes -400
        { name: "C", position: { x: 400, y: 0, z: 0 } },
      ],
      [
        { waypoint_a_index: 0, waypoint_b_index: 1 },
        { waypoint_a_index: 1, waypoint_b_index: 2 },
      ]
    );

    const mover = createWaypointMover(world);
    const group = new THREE.Group();
    group.position.set(0, 0, 0);

    // If the mover tries to "snap" to B exactly, simulate that it is blocked (like another NPC occupying the node).
    (group.userData as any).moveConstraint = (_g: any, x: number, z: number) => {
      const bx = -200;
      const bz = 0;
      if (Math.abs(x - bx) < 1e-6 && Math.abs(z - bz) < 1e-6) return { blocked: true, moved: false };
      _g.position.x = x;
      _g.position.z = z;
      return { blocked: false, moved: true };
    };

    expect(mover.startMoveToWaypoint("npc-1", group, "C", { speed: 140, arriveDistance: 0.01, locomotionMode: "walk" })).toBe(true);

    // Run updates until we are past B (x < -200) which should be possible even though snapping to B is blocked.
    let safety = 0;
    while (group.position.x > -220 && safety < 500) {
      mover.update("npc-1", group, 0.05);
      safety++;
    }
    expect(safety).toBeLessThan(500);
    expect(group.position.x).toBeLessThan(-200);

    // Eventually the mover should still reach the final destination (C) by snapping exactly.
    safety = 0;
    let last = mover.update("npc-1", group, 0.05);
    while (last.mode !== "idle" && safety < 2000) {
      last = mover.update("npc-1", group, 0.05);
      safety++;
    }
    expect(safety).toBeLessThan(2000);
    expect(last.mode).toBe("idle");
    expect(group.position.x).toBeCloseTo(-400, 1);
  });

  it("treats final waypoint as a gate only when NPC-blocked near the center", () => {
    const world = createMockWorld(
      [
        { name: "A", position: { x: 0, y: 0, z: 0 } },
        // Three X becomes -200
        { name: "B", position: { x: 200, y: 0, z: 0 } },
      ],
      [{ waypoint_a_index: 0, waypoint_b_index: 1 }]
    );

    const mover = createWaypointMover(world);
    const group = new THREE.Group();
    // Start at A and move towards B.
    group.position.set(0, 0, 0);

    // Simulate another NPC occupying the destination center: block moves that get too close to the center.
    (group.userData as any).moveConstraint = (_g: any, x: number, z: number) => {
      const bx = -200;
      const bz = 0;
      const nextDist = Math.hypot(x - bx, z - bz);
      if (nextDist <= 30) {
        (_g.userData as any)._npcNpcBlocked = true;
        return { blocked: true, moved: false };
      }
      (_g.userData as any)._npcNpcBlocked = false;
      _g.position.x = x;
      _g.position.z = z;
      return { blocked: false, moved: true };
    };

    expect(mover.startMoveToWaypoint("npc-1", group, "B", { speed: 140, arriveDistance: 0.01, locomotionMode: "walk" })).toBe(true);

    // The NPC should try to approach the center, get NPC-blocked near it, and accept the gate as complete.
    let safety = 0;
    let last = mover.update("npc-1", group, 0.05);
    while (last.mode !== "idle" && safety < 2000) {
      last = mover.update("npc-1", group, 0.05);
      safety++;
    }
    expect(safety).toBeLessThan(2000);
    expect(last.mode).toBe("idle");
    expect(group.position.x).not.toBeCloseTo(-200, 6);
    expect(Math.abs(group.position.x - -200)).toBeLessThanOrEqual(60);
  });

  it("uses a circuit breaker at the final waypoint when inside the gate but not reaching the center", () => {
    const world = createMockWorld(
      [
        { name: "A", position: { x: 0, y: 0, z: 0 } },
        // Three X becomes -200
        { name: "B", position: { x: 200, y: 0, z: 0 } },
      ],
      [{ waypoint_a_index: 0, waypoint_b_index: 1 }]
    );

    const mover = createWaypointMover(world);
    const group = new THREE.Group();
    group.position.set(0, 0, 0);

    // Constrain the NPC to "orbit" around the target at a fixed radius inside the final gate,
    // never letting it reach the exact center (simulate avoidance-induced circling).
    let angle = 0;
    (group.userData as any).moveConstraint = (_g: any, _x: number, _z: number) => {
      const cx = -200;
      const cz = 0;
      angle += 0.25;
      _g.position.x = cx + Math.cos(angle) * 40;
      _g.position.z = cz + Math.sin(angle) * 40;
      (_g.userData as any)._npcNpcBlocked = false;
      return { blocked: false, moved: true };
    };

    expect(mover.startMoveToWaypoint("npc-1", group, "B", { speed: 140, arriveDistance: 0.01, locomotionMode: "walk" })).toBe(true);

    let last = mover.update("npc-1", group, 0.05);
    let safety = 0;
    while (last.mode !== "idle" && safety < 200) {
      last = mover.update("npc-1", group, 0.05);
      safety++;
    }

    // Circuit breaker is 2.0s; at 0.05 per tick that is 40 ticks.
    expect(safety).toBeLessThan(200);
    expect(last.mode).toBe("idle");
    expect(Math.abs(group.position.x - -200)).toBeLessThanOrEqual(60);
  });

  it("clear() stops an in-progress move", () => {
    const world = createMockWorld(
      [
        { name: "A", position: { x: 0, y: 0, z: 0 } },
        { name: "B", position: { x: 10, y: 0, z: 0 } },
      ],
      [{ waypoint_a_index: 0, waypoint_b_index: 1 }]
    );

    const mover = createWaypointMover(world);
    const group = new THREE.Group();
    group.position.set(0, 0, 0);

    expect(mover.startMoveToWaypoint("npc-1", group, "B", { speed: 10, arriveDistance: 0.01, locomotionMode: "walk" })).toBe(true);
    expect(mover.update("npc-1", group, 0.016).moved).toBe(true);

    mover.clear();
    expect(mover.update("npc-1", group, 0.016)).toEqual({ moved: false, mode: "idle" });
  });

  it("supports deadlock steer + post-steer wait (no teleport)", () => {
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);

    const world = createMockWorld(
      [
        { name: "A", position: { x: 0, y: 0, z: 0 } },
        { name: "B", position: { x: 10, y: 0, z: 0 } },
      ],
      [{ waypoint_a_index: 0, waypoint_b_index: 1 }]
    );

    const mover = createWaypointMover(world);
    const group = new THREE.Group();
    group.position.set(0, 0, 0);
    expect(mover.startMoveToWaypoint("npc-1", group, "B", { speed: 140, arriveDistance: 0.01, locomotionMode: "walk" })).toBe(true);

    // Force a steer direction that differs from the route direction (route is towards x=-10).
    (group.userData as any)._npcTrafficSteerYaw = Math.PI / 2; // +X
    (group.userData as any)._npcTrafficSteerUntilMs = 1500;
    (group.userData as any)._npcTrafficSteerPendingWait = true;
    (group.userData as any)._npcTrafficSteerMoved = false;

    const steerTick = mover.update("npc-1", group, 0.1);
    expect(steerTick.mode).toBe("walk");
    expect(steerTick.moved).toBe(true);
    expect(group.position.x).toBeGreaterThan(0);

    // Steer window ended -> should enter a short random wait.
    nowSpy.mockReturnValue(1501);
    const waitTick = mover.update("npc-1", group, 0.016);
    expect(waitTick).toEqual({ moved: false, mode: "idle" });
    const waitUntil = (group.userData as any)._npcTrafficWaitUntilMs as number;
    expect(typeof waitUntil).toBe("number");
    expect(waitUntil).toBeGreaterThanOrEqual(1501 + 1000);
    expect(waitUntil).toBeLessThanOrEqual(1501 + 15000);

    nowSpy.mockReturnValue(waitUntil - 1);
    expect(mover.update("npc-1", group, 0.016)).toEqual({ moved: false, mode: "idle" });

    // After the wait, route movement resumes.
    const beforeResumeX = group.position.x;
    nowSpy.mockReturnValue(waitUntil + 1);
    const resumeTick = mover.update("npc-1", group, 0.016);
    expect(resumeTick.mode).toBe("walk");
    expect(group.position.x).toBeLessThan(beforeResumeX);

    nowSpy.mockRestore();
  });

  it("stops the move when repeatedly blocked (simulating hard collision)", () => {
    const world = createMockWorld(
      [
        { name: "A", position: { x: 0, y: 0, z: 0 } },
        { name: "B", position: { x: 10, y: 0, z: 0 } },
      ],
      [{ waypoint_a_index: 0, waypoint_b_index: 1 }]
    );

    const mover = createWaypointMover(world);
    const group = new THREE.Group();
    group.position.set(0, 0, 0);
    (group.userData as any).moveConstraint = () => ({ blocked: true, moved: false });

    expect(mover.startMoveToWaypoint("npc-1", group, "B", { speed: 140, arriveDistance: 0.01, locomotionMode: "walk" })).toBe(true);
    const tick = mover.update("npc-1", group, 1.0);
    expect(tick.mode).toBe("idle");
    expect(group.position.x).toBeCloseTo(0, 6);
  });
});
