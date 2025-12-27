export {};

type MockRotArray = { size: () => number; get: (i: number) => number };

function createIdentityRotArray(): MockRotArray {
  const m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return {
    size: () => m.length,
    get: (i: number) => m[i],
  };
}

function createMockChildren(children: any[]) {
  return {
    size: () => children.length,
    get: (i: number) => children[i],
  };
}

function createMockWorld(vobs: any[]) {
  const roots = {
    size: () => vobs.length,
    get: (i: number) => vobs[i],
  };
  return {
    getVobs: () => roots,
  } as any;
}

describe("npc freepoints", () => {
  let setFreepointsWorld: typeof import("../npc-freepoints").setFreepointsWorld;
  let updateNpcWorldPosition: typeof import("../npc-freepoints").updateNpcWorldPosition;
  let acquireFreepointForNpc: typeof import("../npc-freepoints").acquireFreepointForNpc;
  let findFreepointForNpc: typeof import("../npc-freepoints").findFreepointForNpc;
  let isFreepointAvailableForNpc: typeof import("../npc-freepoints").isFreepointAvailableForNpc;
  let isNpcOnFreepoint: typeof import("../npc-freepoints").isNpcOnFreepoint;
  let reserveFreepoint: typeof import("../npc-freepoints").reserveFreepoint;

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("three", () => jest.requireActual("three"));
    ({ setFreepointsWorld, updateNpcWorldPosition, acquireFreepointForNpc, findFreepointForNpc, isFreepointAvailableForNpc, isNpcOnFreepoint, reserveFreepoint } =
      await import("../npc-freepoints"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("picks the nearest matching freepoint and reserves it", () => {
    const spotA = {
      id: 11,
      type: 11,
      vobName: "FP_ROAM_A",
      name: "zCVobSpot",
      position: { x: 10, y: 0, z: 0 },
      rotation: { toArray: () => createIdentityRotArray() },
      children: createMockChildren([]),
    };
    const spotB = {
      id: 12,
      type: 11,
      vobName: "FP_ROAM_B",
      name: "zCVobSpot",
      position: { x: 1000, y: 0, z: 0 },
      rotation: { toArray: () => createIdentityRotArray() },
      children: createMockChildren([]),
    };
    const world = createMockWorld([{ id: 1, type: 0, name: "ROOT", position: { x: 0, y: 0, z: 0 }, rotation: { toArray: () => createIdentityRotArray() }, children: createMockChildren([spotA, spotB]) }]);

    setFreepointsWorld(world);
    updateNpcWorldPosition(100, { x: 0, y: 0, z: 0 });

    jest.spyOn(Date, "now").mockReturnValue(1_000_000);

    const acquired = acquireFreepointForNpc(100, "FP_ROAM", { checkDistance: true, dist: 2000, holdMs: 30_000 });
    expect(acquired?.vobId).toBe(spotA.id);

    // Another NPC cannot take the same spot while the hold timer is active.
    updateNpcWorldPosition(200, { x: 0, y: 0, z: 0 });
    const other = acquireFreepointForNpc(200, "FP_ROAM_A", { checkDistance: true, dist: 2000, holdMs: 30_000 });
    expect(other).toBeNull();
  });

  it("keeps a freepoint occupied after timer if holder is still inside the spot bbox", () => {
    const spot = {
      id: 21,
      type: 11,
      vobName: "FP_TEST",
      name: "zCVobSpot",
      position: { x: 10, y: 0, z: 0 },
      rotation: { toArray: () => createIdentityRotArray() },
      children: createMockChildren([]),
    };
    const world = createMockWorld([{ id: 1, type: 0, name: "ROOT", position: { x: 0, y: 0, z: 0 }, rotation: { toArray: () => createIdentityRotArray() }, children: createMockChildren([spot]) }]);

    setFreepointsWorld(world);
    updateNpcWorldPosition(1, { x: -10, y: 0, z: 0 });

    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);
    const acquired = acquireFreepointForNpc(1, "FP_TEST", { checkDistance: true, holdMs: 1_000 });
    expect(acquired?.vobId).toBe(spot.id);

    // Timer elapsed, but NPC still in spot bbox -> should remain unavailable.
    nowSpy.mockReturnValue(1_002_000);
    updateNpcWorldPosition(1, { x: -10, y: 0, z: 0 });
    updateNpcWorldPosition(2, { x: -10, y: 0, z: 0 });
    const other = acquireFreepointForNpc(2, "FP_TEST", { checkDistance: true });
    expect(other).toBeNull();

    // Once the holder leaves, it becomes available.
    updateNpcWorldPosition(1, { x: -10_000, y: 0, z: 0 });
    const other2 = acquireFreepointForNpc(2, "FP_TEST", { checkDistance: true });
    expect(other2?.vobId).toBe(spot.id);
  });

  it("lets the owner auto-release a reserved spot by leaving the freepoint bbox (before hold timeout)", () => {
    const spot = {
      id: 22,
      type: 11,
      vobName: "FP_TEST",
      name: "zCVobSpot",
      position: { x: 0, y: 0, z: 0 },
      rotation: { toArray: () => createIdentityRotArray() },
      children: createMockChildren([]),
    };
    const world = createMockWorld([{ id: 1, type: 0, name: "ROOT", position: { x: 0, y: 0, z: 0 }, rotation: { toArray: () => createIdentityRotArray() }, children: createMockChildren([spot]) }]);

    setFreepointsWorld(world);
    updateNpcWorldPosition(1, { x: 0, y: 0, z: 0 });
    updateNpcWorldPosition(2, { x: 0, y: 0, z: 0 });

    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);
    const acquired = acquireFreepointForNpc(1, "FP_TEST", { checkDistance: true, dist: 2000, holdMs: 30_000 });
    expect(acquired?.vobId).toBe(spot.id);

    // Owner leaves the freepoint bbox (±50 in X/Z) but stays within FindSpot(dist=100),
    // so Npc_IsOnFP() will still "see" the spot and can trigger early release.
    updateNpcWorldPosition(1, { x: 80, y: 0, z: 0 });
    const otherBeforeRelease = acquireFreepointForNpc(2, "FP_TEST", { checkDistance: true, dist: 2000, holdMs: 30_000 });
    expect(otherBeforeRelease).toBeNull();

    // Owner checks "on fp" which triggers IsAvailable(owner) semantics and clears ownership.
    expect(isNpcOnFreepoint(1, "FP_TEST", 100)).toBe(false);

    // Now another NPC can take it immediately (even though the original hold time hasn't advanced).
    const otherAfterRelease = acquireFreepointForNpc(2, "FP_TEST", { checkDistance: true, dist: 2000, holdMs: 30_000 });
    expect(otherAfterRelease?.vobId).toBe(spot.id);
  });

  it("does not drop reservations when the spot index is built lazily", () => {
    const spot = {
      id: 71,
      type: 11,
      vobName: "FP_TEST",
      name: "zCVobSpot",
      position: { x: 0, y: 0, z: 0 },
      rotation: { toArray: () => createIdentityRotArray() },
      children: createMockChildren([]),
    };
    const world = createMockWorld([{ id: 1, type: 0, name: "ROOT", position: { x: 0, y: 0, z: 0 }, rotation: { toArray: () => createIdentityRotArray() }, children: createMockChildren([spot]) }]);

    setFreepointsWorld(world);
    updateNpcWorldPosition(1, { x: 0, y: 0, z: 0 });
    updateNpcWorldPosition(2, { x: 0, y: 0, z: 0 });

    // Reserve before any FindSpot-style call builds the spot index.
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    reserveFreepoint(spot.id, 1, 30_000);

    const acquired = acquireFreepointForNpc(2, "FP_TEST", { checkDistance: true, dist: 2000, holdMs: 30_000 });
    expect(acquired).toBeNull();
  });

  it("avoids choosing the spot the NPC is currently using for checkDistance=false (FindSpot firstbest)", () => {
    const spotA = {
      id: 31,
      type: 11,
      vobName: "FP_ROAM_A",
      name: "zCVobSpot",
      position: { x: 0, y: 0, z: 0 },
      rotation: { toArray: () => createIdentityRotArray() },
      children: createMockChildren([]),
    };
    const spotB = {
      id: 32,
      type: 11,
      vobName: "FP_ROAM_B",
      name: "zCVobSpot",
      position: { x: 200, y: 0, z: 0 },
      rotation: { toArray: () => createIdentityRotArray() },
      children: createMockChildren([]),
    };
    const world = createMockWorld([{ id: 1, type: 0, name: "ROOT", position: { x: 0, y: 0, z: 0 }, rotation: { toArray: () => createIdentityRotArray() }, children: createMockChildren([spotA, spotB]) }]);

    setFreepointsWorld(world);
    updateNpcWorldPosition(10, { x: 0, y: 0, z: 0 });

    // Mark spotA as used by this NPC (mimics zCVobSpot::inUseVob == npc).
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    const acquired = acquireFreepointForNpc(10, "FP_ROAM_A", { checkDistance: true, dist: 2000, holdMs: 30_000 });
    expect(acquired?.vobId).toBe(spotA.id);

    const spot = findFreepointForNpc(10, "FP_ROAM", { checkDistance: false });
    expect(spot?.vobId).toBe(spotB.id);
  });

  it("Npc_IsOnFP requires the NPC to be the spot holder (not just nearby)", () => {
    const spot = {
      id: 61,
      type: 11,
      vobName: "FP_STAND_TEST",
      name: "zCVobSpot",
      position: { x: 0, y: 0, z: 0 },
      rotation: { toArray: () => createIdentityRotArray() },
      children: createMockChildren([]),
    };
    const world = createMockWorld([{ id: 1, type: 0, name: "ROOT", position: { x: 0, y: 0, z: 0 }, rotation: { toArray: () => createIdentityRotArray() }, children: createMockChildren([spot]) }]);

    setFreepointsWorld(world);
    updateNpcWorldPosition(1, { x: 0, y: 0, z: 0 });

    expect(isNpcOnFreepoint(1, "STAND", 100)).toBe(false);

    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    acquireFreepointForNpc(1, "STAND", { checkDistance: true, dist: 2000, holdMs: 30_000 });
    expect(isNpcOnFreepoint(1, "STAND", 100)).toBe(true);
  });

  it("Npc_IsOnFP tolerates vertical offsets between spot and NPC position", () => {
    const spot = {
      id: 72,
      type: 11,
      vobName: "FP_PICK_TEST",
      name: "zCVobSpot",
      position: { x: 0, y: 150, z: 0 },
      rotation: { toArray: () => createIdentityRotArray() },
      children: createMockChildren([]),
    };
    const world = createMockWorld([{ id: 1, type: 0, name: "ROOT", position: { x: 0, y: 0, z: 0 }, rotation: { toArray: () => createIdentityRotArray() }, children: createMockChildren([spot]) }]);

    setFreepointsWorld(world);
    updateNpcWorldPosition(1, { x: 0, y: 0, z: 0 });

    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    acquireFreepointForNpc(1, "FP_PICK_TEST", { checkDistance: true, dist: 2000, holdMs: 30_000 });

    // With missing collision or stacked geometry, the NPC can be far below the spot in Y but still "on" it logically.
    expect(isNpcOnFreepoint(1, "FP_PICK_TEST", 100)).toBe(true);
  });

  it("treats STAND as STAND-or-ROAM to avoid far stand-only spots", () => {
    const roamNear = {
      id: 41,
      type: 11,
      vobName: "FP_ROAM_NW_FARM1_PATH_SPAWN_05_03",
      name: "zCVobSpot",
      position: { x: 10, y: 0, z: 0 },
      rotation: { toArray: () => createIdentityRotArray() },
      children: createMockChildren([]),
    };
    const standFar = {
      id: 42,
      type: 11,
      vobName: "FP_STAND_DEMENTOR_17",
      name: "zCVobSpot",
      position: { x: 1500, y: 0, z: 0 },
      rotation: { toArray: () => createIdentityRotArray() },
      children: createMockChildren([]),
    };

    const world = createMockWorld([
      {
        id: 1,
        type: 0,
        name: "ROOT",
        position: { x: 0, y: 0, z: 0 },
        rotation: { toArray: () => createIdentityRotArray() },
        children: createMockChildren([roamNear, standFar]),
      },
    ]);

    setFreepointsWorld(world);
    updateNpcWorldPosition(123, { x: 0, y: 0, z: 0 });

    const picked = acquireFreepointForNpc(123, "STAND", { checkDistance: true, dist: 2000, holdMs: 30_000 });
    expect(picked?.vobId).toBe(roamNear.id);
  });

  it("uses a 700-unit search radius for script-style freepoint availability checks", () => {
    const far = {
      id: 51,
      type: 11,
      vobName: "FP_ROAM_FAR",
      name: "zCVobSpot",
      position: { x: 1500, y: 0, z: 0 },
      rotation: { toArray: () => createIdentityRotArray() },
      children: createMockChildren([]),
    };
    const world = createMockWorld([{ id: 1, type: 0, name: "ROOT", position: { x: 0, y: 0, z: 0 }, rotation: { toArray: () => createIdentityRotArray() }, children: createMockChildren([far]) }]);

    setFreepointsWorld(world);
    updateNpcWorldPosition(1, { x: 0, y: 0, z: 0 });

    // Original engine uses dist~700 for FindSpot() in Wld_IsFPAvailable/AI_GotoFP.
    expect(isFreepointAvailableForNpc(1, "FP_ROAM", true)).toBe(false);
  });
});
