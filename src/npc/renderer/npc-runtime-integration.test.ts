export {};

describe("npc-runtime-integration", () => {
  let THREE: typeof import("three");
  let mod: typeof import("./npc-character-loader");

  type NpcData = import("../../shared/types").NpcData;
  type NpcVisual = import("../../shared/types").NpcVisual;

  const mockCreateHumanoidCharacterInstance = jest.fn();
  const mockDisposeObject3D = jest.fn();
  const mockGetNpcVisualStateByInstanceIndex = jest.fn();
  const mockGetNpcVisualStateHashByInstanceIndex = jest.fn();
  const mockCreateHumanLocomotionController = jest.fn(() => ({ kind: "human-loco" }));
  const mockCreateCreatureLocomotionController = jest.fn(() => ({ kind: "creature-loco" }));

  function makeVisual(bodyMesh: string, extra?: Partial<NpcVisual>): NpcVisual {
    return {
      bodyMesh,
      bodyTex: 0,
      skin: 0,
      headMesh: "",
      headTex: 0,
      teethTex: 0,
      armorInst: -1,
      ...(extra ?? {}),
    };
  }

  function makeNpcData(
    instanceIndex: number,
    symbolName: string,
    visual?: NpcVisual,
    extra?: Partial<NpcData>,
  ): NpcData {
    return {
      instanceIndex,
      symbolName,
      spawnpoint: "SPAWN",
      npcInfo: {},
      visual,
      ...(extra ?? {}),
    };
  }

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("three", () => jest.requireActual("three"));

    jest.doMock("../../character/character-instance.js", () => ({
      createHumanoidCharacterInstance: (...args: any[]) =>
        mockCreateHumanoidCharacterInstance(...args),
    }));
    jest.doMock("../../world/distance-streaming", () => ({
      disposeObject3D: (...args: any[]) => mockDisposeObject3D(...args),
    }));
    jest.doMock("../../vm-manager", () => ({
      getNpcVisualStateByInstanceIndex: (...args: any[]) =>
        mockGetNpcVisualStateByInstanceIndex(...args),
      getNpcVisualStateHashByInstanceIndex: (...args: any[]) =>
        mockGetNpcVisualStateHashByInstanceIndex(...args),
    }));
    jest.doMock("../physics/npc-locomotion", () => ({
      createHumanLocomotionController: () => mockCreateHumanLocomotionController(),
      createCreatureLocomotionController: () => mockCreateCreatureLocomotionController(),
    }));

    THREE = await import("three");
    mod = await import("./npc-character-loader");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetNpcVisualStateByInstanceIndex.mockReturnValue(null);
    mockGetNpcVisualStateHashByInstanceIndex.mockReturnValue(null);
    mockCreateHumanoidCharacterInstance.mockResolvedValue({
      object: new THREE.Group(),
      update: jest.fn(),
      dispose: jest.fn(),
    });
  });

  it("human class: builds HUMANS model and human locomotion", async () => {
    const npcGroup = new THREE.Group();
    const npcData = makeNpcData(101, "MILITIA", makeVisual("HUM_BODY_NAKED0"));

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: null },
      waypointMoverRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(mockCreateHumanoidCharacterInstance).toHaveBeenCalledTimes(1);
    expect(mockCreateHumanoidCharacterInstance.mock.calls[0][0].modelKey).toBe("HUMANS");
    expect(mockCreateHumanoidCharacterInstance.mock.calls[0][0].bodyMesh).toBe("HUM_BODY_NAKED0");
    expect(mockCreateHumanLocomotionController).toHaveBeenCalledTimes(1);
    expect(mockCreateCreatureLocomotionController).not.toHaveBeenCalled();
  });

  it("skeleton class: keeps HUMANS model with SKE body and human locomotion", async () => {
    const npcGroup = new THREE.Group();
    const npcData = makeNpcData(12481, "LESSER_SKELETON", makeVisual("SKE_BODY"));
    mockGetNpcVisualStateByInstanceIndex.mockReturnValue({
      baseScript: "HUMANS",
      overlays: ["HUMANS_SKELETON"],
      hasExplicitBaseScript: true,
      visual: makeVisual("SKE_BODY"),
    });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: { startLoadScript: jest.fn() } as any },
      waypointMoverRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(mockCreateHumanoidCharacterInstance).toHaveBeenCalledTimes(1);
    expect(mockCreateHumanoidCharacterInstance.mock.calls[0][0].modelKey).toBe("HUMANS");
    expect(mockCreateHumanoidCharacterInstance.mock.calls[0][0].bodyMesh).toBe("SKE_BODY");
    expect(mockCreateHumanLocomotionController).toHaveBeenCalledTimes(1);
    expect(mockCreateCreatureLocomotionController).not.toHaveBeenCalled();
  });

  it("creature class: uses creature model script and creature locomotion", async () => {
    const npcGroup = new THREE.Group();
    const registry = { startLoadScript: jest.fn(), hasAnimation: jest.fn(() => true) };
    const npcData = makeNpcData(102, "WOLF", makeVisual("WOLF"));
    mockGetNpcVisualStateByInstanceIndex.mockReturnValue({
      baseScript: "WOLF",
      overlays: ["WOLF_ATTACK"],
      hasExplicitBaseScript: true,
      visual: makeVisual("WOLF"),
    });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: registry as any },
      waypointMoverRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(registry.startLoadScript).toHaveBeenCalledWith("WOLF");
    expect(registry.startLoadScript).toHaveBeenCalledWith("WOLF_ATTACK");
    expect(mockCreateHumanoidCharacterInstance).toHaveBeenCalledTimes(1);
    expect(mockCreateHumanoidCharacterInstance.mock.calls[0][0].modelKey).toBe("WOLF");
    expect(mockCreateHumanoidCharacterInstance.mock.calls[0][0].bodyMesh).toBe("WOLF");
    expect(mockCreateCreatureLocomotionController).toHaveBeenCalledTimes(1);
    expect(mockCreateHumanLocomotionController).not.toHaveBeenCalled();
  });

  it("pending creature class: waits for explicit visual state", async () => {
    const npcGroup = new THREE.Group();
    const npcData = makeNpcData(103, "PENDING_WOLF", makeVisual("WOLF"));
    mockGetNpcVisualStateByInstanceIndex.mockReturnValue({
      baseScript: "HUMANS",
      overlays: [],
      hasExplicitBaseScript: false,
      visual: makeVisual("WOLF"),
    });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: { startLoadScript: jest.fn() } as any },
      waypointMoverRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(mockCreateHumanoidCharacterInstance).not.toHaveBeenCalled();
    expect(mockCreateHumanLocomotionController).not.toHaveBeenCalled();
    expect(mockCreateCreatureLocomotionController).not.toHaveBeenCalled();
  });
});
