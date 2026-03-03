export {};

describe("vob-npc-defer-gate", () => {
  let THREE: typeof import("three");
  let mod: typeof import("./vob-npc-defer-gate");

  function createVob(params: {
    id: number;
    visualType?: number;
    showVisual?: boolean;
    position?: { x: number; y: number; z: number };
    bbox?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  }) {
    return {
      id: params.id,
      showVisual: params.showVisual ?? true,
      visual: { type: params.visualType ?? 2 },
      position: params.position ?? { x: 150, y: 50, z: 50 },
      bbox: params.bbox ?? {
        min: { x: 100, y: 0, z: 0 },
        max: { x: 200, y: 100, z: 100 },
      },
    } as any;
  }

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("three", () => jest.requireActual("three"));
    THREE = await import("three");
    mod = await import("./vob-npc-defer-gate");
  });

  beforeEach(() => {
    mod.clearNpcVobDeferGate();
  });

  it("defers when npc bottom point is inside unloaded world-space bbox", () => {
    const vob = createVob({ id: 21114 });
    mod.updateNpcVobDeferGate([{ id: "22_18840", vob }], new Set<string>());

    const decision = mod.inspectNpcModelDefer(new THREE.Vector3(-150, 50, 50), { bottomOffset: 0 });
    expect(decision.defer).toBe(true);
    expect(decision.hit?.inside).toBe(true);
    expect(decision.hit?.vobId).toBe("22_18840");
    expect(decision.hit?.nativeVobId).toBe("21114");
  });

  it("does not defer when matching vob is already loaded", () => {
    const vob = createVob({ id: 21114 });
    mod.updateNpcVobDeferGate([{ id: "22_18840", vob }], new Set<string>(["22_18840"]));

    expect(mod.shouldDeferNpcModelLoad(new THREE.Vector3(-150, 50, 50), { bottomOffset: 0 })).toBe(
      false,
    );
  });

  it("defers by proximity (<= 2m / 200 units) even when outside bbox", () => {
    const vob = createVob({ id: 21114 });
    mod.updateNpcVobDeferGate([{ id: "22_18840", vob }], new Set<string>());

    const decision = mod.inspectNpcModelDefer(new THREE.Vector3(-250, 50, 50), { bottomOffset: 0 });
    expect(decision.defer).toBe(true);
    expect(decision.hit?.inside).toBe(false);
    expect(decision.hit?.distance).toBeCloseTo(50, 5);
  });

  it("ignores non-relevant visual types and hidden visuals", () => {
    mod.updateNpcVobDeferGate(
      [
        { id: "a", vob: createVob({ id: 1, visualType: 3 }) },
        { id: "b", vob: createVob({ id: 2, showVisual: false }) },
      ],
      new Set<string>(),
    );

    expect(mod.shouldDeferNpcModelLoad(new THREE.Vector3(-150, 50, 50), { bottomOffset: 0 })).toBe(
      false,
    );
  });

  it("matches target probe by native vob id", () => {
    const vob = createVob({ id: 21114 });
    mod.updateNpcVobDeferGate([{ id: "22_18840", vob }], new Set<string>(["22_18840"]));

    const decision = mod.inspectNpcModelDefer(new THREE.Vector3(-150, 50, 50), {
      bottomOffset: 0,
      targetVobId: "21114",
    });
    expect(decision.defer).toBe(false);
    expect(decision.target).toBeDefined();
    expect(decision.target?.nativeVobId).toBe("21114");
    expect(decision.target?.loaded).toBe(true);
  });

  it("supports local-space bbox fallback path when bbox is far from vob position", () => {
    const vob = createVob({
      id: 500,
      position: { x: 1000, y: 0, z: 0 },
      bbox: {
        min: { x: -1, y: -1, z: -1 },
        max: { x: 1, y: 1, z: 1 },
      },
    });
    mod.updateNpcVobDeferGate([{ id: "x_1", vob }], new Set<string>());

    const decision = mod.inspectNpcModelDefer(new THREE.Vector3(-1000, 0, 0), { bottomOffset: 0 });
    expect(decision.defer).toBe(true);
    expect(decision.hit?.inside).toBe(true);
  });

  it("clear resets state", () => {
    const vob = createVob({ id: 1 });
    mod.updateNpcVobDeferGate([{ id: "1_1", vob }], new Set<string>());
    mod.clearNpcVobDeferGate();

    expect(mod.shouldDeferNpcModelLoad(new THREE.Vector3(-150, 50, 50), { bottomOffset: 0 })).toBe(
      false,
    );
  });
});
