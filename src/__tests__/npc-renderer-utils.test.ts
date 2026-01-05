describe("npc-renderer-utils", () => {
  let mod: typeof import("../npc-renderer-utils");

  beforeAll(async () => {
    jest.resetModules();
    mod = await import("../npc-renderer-utils");
  });

  it("normalizeNameKey trims and uppercases", () => {
    expect(mod.normalizeNameKey("  foo Bar ")).toBe("FOO BAR");
    expect(mod.normalizeNameKey("")).toBe("");
    expect(mod.normalizeNameKey("   ")).toBe("");
  });

  it("isCavalornNpcData matches by symbolName or display name", () => {
    expect(mod.isCavalornNpcData(undefined)).toBe(false);
    expect(mod.isCavalornNpcData({ symbolName: "BAU_4300_ADDON_CAVALORN" } as any)).toBe(true);
    expect(mod.isCavalornNpcData({ symbolName: " bau_4300_addon_cavalorn " } as any)).toBe(true);
    expect(mod.isCavalornNpcData({ name: "CAVALORN" } as any)).toBe(true);
    expect(mod.isCavalornNpcData({ name: " cavalorn " } as any)).toBe(true);
    expect(mod.isCavalornNpcData({ symbolName: "NOT_CAVALORN", name: "NOT_CAVALORN" } as any)).toBe(false);
  });
});

