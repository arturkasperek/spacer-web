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
});
