describe("combat/fight-state", () => {
  let mod: typeof import("../combat/fight-state");

  beforeAll(async () => {
    jest.resetModules();
    mod = await import("../combat/fight-state");
  });

  it("starts and ends a melee attack action", () => {
    const st = mod.createCombatState({ hp: 100, hpMax: 100, weaponState: "1h" });
    mod.startMeleeAttack(st, 1000, {
      kind: "left",
      weaponState: "1h",
      durationMs: 500,
      hitStartMs: 100,
      hitEndMs: 200,
      range: 100,
      arcDeg: 90,
      damageType: "edge",
    });

    expect(st.active?.type).toBe("meleeAttack");
    expect(st.active?.endsAtMs).toBe(1500);

    mod.endActiveAction(st, 1600);
    expect(st.active).toBeNull();
  });

  it("applies damage and marks dead", () => {
    const st = mod.createCombatState({ hp: 5, hpMax: 10, weaponState: "1h" });
    mod.applyDamageToState(st, 10);
    expect(st.hp).toBe(0);
    expect(st.dead).toBe(true);
  });
});

