import {
  stepNpcPhysicsCore,
  type NpcPhysicsCoreConfig,
  type NpcPhysicsCoreState,
} from "./npc-physics-core";

const CFG: NpcPhysicsCoreConfig = {
  gravity: 1200,
  maxFallSpeed: 3000,
  moveDeadZone: 0.25,
};

const mkState = (patch?: Partial<NpcPhysicsCoreState>): NpcPhysicsCoreState => ({
  px: 0,
  py: 0,
  pz: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  grounded: true,
  falling: false,
  sliding: false,
  jumpActive: false,
  desiredX: 0,
  desiredY: 0,
  desiredZ: 0,
  ...(patch ?? {}),
});

describe("npc-physics-core", () => {
  it("teleports to desired in fallback mode", () => {
    const next = stepNpcPhysicsCore(mkState({ desiredX: 10, desiredZ: 20 }), 1 / 60, CFG);
    expect(next.px).toBe(10);
    expect(next.pz).toBe(20);
    expect(next.grounded).toBe(true);
  });

  it("keeps idle in fallback when no movement intent", () => {
    const next = stepNpcPhysicsCore(mkState(), 1 / 60, CFG);
    expect(next.vx).toBe(0);
    expect(next.vz).toBe(0);
    expect(next.py).toBe(0);
  });

  it("uses movement solver result when available", () => {
    const next = stepNpcPhysicsCore(mkState({ desiredX: 5, desiredZ: 1 }), 1 / 60, CFG, () => ({
      px: 2,
      py: 3,
      pz: 4,
      grounded: false,
    }));
    expect(next.px).toBe(2);
    expect(next.py).toBe(3);
    expect(next.pz).toBe(4);
    expect(next.grounded).toBe(false);
  });

  it("applies dead-zone for tiny deltas before solver call", () => {
    let dxSeen = Number.NaN;
    let dzSeen = Number.NaN;
    stepNpcPhysicsCore(mkState({ desiredX: 0.1, desiredZ: 0.2 }), 1 / 60, CFG, (input) => {
      dxSeen = input.dx;
      dzSeen = input.dz;
      return { px: 0, py: 0, pz: 0, grounded: true };
    });
    expect(dxSeen).toBe(0);
    expect(dzSeen).toBe(0);
  });
});
