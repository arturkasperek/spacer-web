describe("combat/melee-hit", () => {
  let mod: typeof import("../combat/melee-hit");

  beforeAll(async () => {
    jest.resetModules();
    mod = await import("../combat/melee-hit");
  });

  const mk = (id: number, x: number, z: number, fx: number, fz: number) => ({
    id,
    pos: { x, y: 0, z },
    forwardXZ: { x: fx, z: fz },
    weaponState: "1h" as const,
    stats: { hp: 100, hpMax: 100, strength: 10, dexterity: 10, weaponDamage: { edge: 20 }, protection: {} },
  });

  it("selects the nearest target within range and arc", () => {
    const attacker = mk(1, 0, 0, 0, 1);
    const tNear = mk(2, 0, 50, 0, 1);
    const tFar = mk(3, 0, 100, 0, 1);

    const hit = mod.findMeleeHit(attacker, { range: 120, arcDeg: 90 }, [tNear, tFar]);
    expect(hit?.targetId).toBe(2);
  });

  it("rejects targets behind the attacker", () => {
    const attacker = mk(1, 0, 0, 0, 1);
    const behind = mk(2, 0, -50, 0, 1);
    const hit = mod.findMeleeHit(attacker, { range: 120, arcDeg: 120 }, [behind]);
    expect(hit).toBeNull();
  });

  it("rejects targets outside the arc", () => {
    const attacker = mk(1, 0, 0, 0, 1);
    const side = mk(2, 50, 0, 0, 1); // 90deg
    const hit = mod.findMeleeHit(attacker, { range: 120, arcDeg: 60 }, [side]);
    expect(hit).toBeNull();
  });
});

