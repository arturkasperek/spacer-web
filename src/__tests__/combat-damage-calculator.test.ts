describe("combat/damage-calculator", () => {
  let mod: typeof import("../combat/damage-calculator");

  beforeAll(async () => {
    jest.resetModules();
    mod = await import("../combat/damage-calculator");
  });

  it("computes melee damage with strength scaling and protection", () => {
    const r = mod.computeMeleeDamage({
      attackerId: 1,
      targetId: 2,
      attacker: {
        hp: 100,
        hpMax: 100,
        strength: 30,
        dexterity: 0,
        weaponDamage: { edge: 40 },
        protection: {},
      },
      target: {
        hp: 100,
        hpMax: 100,
        strength: 0,
        dexterity: 0,
        weaponDamage: {},
        protection: { edge: 50 },
      },
      attack: { damageType: "edge" },
    });

    expect(r.baseDamage).toBe(70);
    expect(r.finalDamage).toBe(20);
    expect(r.damageType).toBe("edge");
  });

  it("clamps negative/invalid inputs to 0", () => {
    const r = mod.computeMeleeDamage({
      attackerId: 1,
      targetId: 2,
      attacker: {
        hp: 100,
        hpMax: 100,
        strength: -999 as any,
        dexterity: 0,
        weaponDamage: { edge: NaN as any },
        protection: {},
      },
      target: {
        hp: 100,
        hpMax: 100,
        strength: 0,
        dexterity: 0,
        weaponDamage: {},
        protection: { edge: 999 },
      },
      attack: { damageType: "edge" },
    });
    expect(r.baseDamage).toBe(0);
    expect(r.finalDamage).toBe(0);
  });
});

