describe("world-time-lighting", () => {
  let mod: typeof import("./world-time-lighting");

  beforeAll(async () => {
    jest.resetModules();
    mod = await import("./world-time-lighting");
  });

  it("returns full light at noon and floor at night", () => {
    expect(mod.getWorldLightFactor(12, 0)).toBeCloseTo(1, 6);
    expect(mod.getWorldLightFactor(0, 0)).toBeCloseTo(0.28, 6);
  });

  it("treats sunrise and sunset as the floor", () => {
    expect(mod.getWorldLightFactor(6, 0)).toBeCloseTo(0.28, 6);
    expect(mod.getWorldLightFactor(18, 0)).toBeCloseTo(0.28, 6);
  });

  it("is bounded and increases after sunrise", () => {
    const preSunrise = mod.getWorldLightFactor(5, 59);
    const postSunrise = mod.getWorldLightFactor(6, 1);
    const morning = mod.getWorldLightFactor(9, 0);

    expect(preSunrise).toBeGreaterThanOrEqual(0.05);
    expect(preSunrise).toBeLessThanOrEqual(1);

    expect(postSunrise).toBeGreaterThan(preSunrise);
    expect(morning).toBeGreaterThan(postSunrise);
    expect(morning).toBeLessThan(1);
  });

  it("normalizes negative and overflow inputs", () => {
    expect(mod.getWorldLightFactor(24, 0)).toBeCloseTo(mod.getWorldLightFactor(0, 0), 8);
    expect(mod.getWorldLightFactor(-1, -1)).toBeCloseTo(mod.getWorldLightFactor(23, 59), 8);
  });
});
