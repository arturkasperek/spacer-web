describe("npc-npc-collision", () => {
  let mod: typeof import("./npc-npc-collision");

  beforeAll(async () => {
    jest.resetModules();
    mod = await import("./npc-npc-collision");
  });

  it("returns desired position when no collisions", () => {
    const r = mod.constrainCircleMoveXZ({
      startX: 0,
      startZ: 0,
      desiredX: 10,
      desiredZ: 0,
      radius: 1,
      colliders: [],
      separationSlop: 0,
    });
    expect(r).toEqual({ x: 10, z: 0, blocked: false });
  });

  it("clamps to the contact boundary when colliding", () => {
    const r = mod.constrainCircleMoveXZ({
      startX: 0,
      startZ: 0,
      desiredX: 9,
      desiredZ: 0,
      radius: 1,
      colliders: [{ x: 10, z: 0, radius: 1 }],
      separationSlop: 0,
    });
    expect(r.blocked).toBe(true);
    expect(r.x).toBeCloseTo(8, 8);
    expect(r.z).toBeCloseTo(0, 8);
  });

  it("resolves full overlap using the opposite of movement direction", () => {
    const r = mod.constrainCircleMoveXZ({
      startX: 0,
      startZ: 0,
      desiredX: 10,
      desiredZ: 0,
      radius: 1,
      colliders: [{ x: 10, z: 0, radius: 1 }],
      separationSlop: 0,
    });
    expect(r.blocked).toBe(true);
    expect(r.x).toBeCloseTo(8, 8);
    expect(r.z).toBeCloseTo(0, 8);
  });

  it("can ignore colliders far in Y", () => {
    const r = mod.constrainCircleMoveXZ({
      startX: 0,
      startZ: 0,
      desiredX: 9,
      desiredZ: 0,
      radius: 1,
      colliders: [{ x: 10, z: 0, radius: 1, y: 1000 }],
      separationSlop: 0,
      y: 0,
      maxYDelta: 10,
    });
    expect(r).toEqual({ x: 9, z: 0, blocked: false });
  });
});
