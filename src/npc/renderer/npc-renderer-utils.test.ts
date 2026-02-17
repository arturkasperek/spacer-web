describe("npc-renderer-utils", () => {
  let mod: typeof import("./npc-renderer-utils");

  beforeAll(async () => {
    jest.resetModules();
    mod = await import("./npc-renderer-utils");
  });

  it("normalizeNameKey trims and uppercases", () => {
    expect(mod.normalizeNameKey("  foo Bar ")).toBe("FOO BAR");
    expect(mod.normalizeNameKey("")).toBe("");
    expect(mod.normalizeNameKey("   ")).toBe("");
  });

  it("isHeroNpcData matches by symbolName", () => {
    expect(mod.isHeroNpcData(undefined)).toBe(false);
    expect(mod.isHeroNpcData({ symbolName: "PC_HERO" } as any)).toBe(true);
    expect(mod.isHeroNpcData({ symbolName: " pc_hero " } as any)).toBe(true);
    expect(mod.isHeroNpcData({ symbolName: "NOT_HERO", name: "PC_HERO" } as any)).toBe(false);
  });

  it("getNpcRuntimeId prefers spawnRuntimeId and falls back to instanceIndex", () => {
    expect(mod.getNpcRuntimeId(undefined)).toBe("npc-unknown");
    expect(
      mod.getNpcRuntimeId({
        instanceIndex: 12469,
        spawnRuntimeId: 77,
        symbolName: "SHEEP",
      } as any),
    ).toBe("npc-77");
    expect(
      mod.getNpcRuntimeId({
        instanceIndex: 12469,
        symbolName: "SHEEP",
      } as any),
    ).toBe("npc-12469");
  });
});
