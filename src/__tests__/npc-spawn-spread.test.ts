describe("npc-spawn-spread", () => {
  let mod: typeof import("../npc/world/npc-spawn-spread");

  beforeAll(async () => {
    jest.resetModules();
    mod = await import("../npc/world/npc-spawn-spread");
  });

  it("does not change position when already free", () => {
    const r = mod.spreadSpawnXZ({
      baseX: 0,
      baseZ: 0,
      existing: [{ x: 100, z: 0 }],
      minSeparation: 10,
    });
    expect(r.applied).toBe(false);
    expect(r.tries).toBe(0);
    expect(r.x).toBe(0);
    expect(r.z).toBe(0);
  });

  it("spreads away from an occupied base position", () => {
    const minSep = 10;
    const r = mod.spreadSpawnXZ({
      baseX: 0,
      baseZ: 0,
      existing: [{ x: 0, z: 0 }],
      minSeparation: minSep,
      maxTries: 12,
    });
    expect(r.applied).toBe(true);
    // Must be at least minSeparation away from the occupied point.
    const d = Math.hypot(r.x, r.z);
    expect(d).toBeGreaterThanOrEqual(minSep);
  });

  it("ignores far-away Y when maxYDelta is set", () => {
    const r = mod.spreadSpawnXZ({
      baseX: 0,
      baseZ: 0,
      baseY: 0,
      existing: [{ x: 0, z: 0, y: 1000 }],
      minSeparation: 10,
      maxYDelta: 50,
    });
    expect(r.applied).toBe(false);
    expect(r.x).toBe(0);
    expect(r.z).toBe(0);
  });
});
