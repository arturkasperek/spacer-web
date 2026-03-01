export {};

describe("npc-character-loader", () => {
  let THREE: typeof import("three");
  let mod: typeof import("./npc-character-loader");

  type NpcData = import("../../shared/types").NpcData;
  type NpcVisual = import("../../shared/types").NpcVisual;

  const mockCreateHumanoidCharacterInstance = jest.fn();
  const mockDisposeObject3D = jest.fn();
  const mockGetNpcVisualStateByInstanceIndex = jest.fn();
  const mockGetNpcVisualStateHashByInstanceIndex = jest.fn();
  const mockCreateHumanLocomotionController = jest.fn(() => ({ kind: "locomotion" }));
  const mockCreateCreatureLocomotionController = jest.fn(() => ({ kind: "creature-locomotion" }));

  function makeVisual(bodyMesh: string, extra?: Partial<NpcVisual>): NpcVisual {
    return {
      bodyMesh,
      bodyTex: 0,
      skin: 0,
      headMesh: "",
      headTex: 0,
      teethTex: 0,
      armorInst: 0,
      ...(extra ?? {}),
    };
  }

  function makeNpcData(
    instanceIndex: number,
    symbolName: string,
    extra?: Partial<NpcData>,
  ): NpcData {
    return {
      instanceIndex,
      symbolName,
      spawnpoint: "SPAWN",
      npcInfo: {},
      ...(extra ?? {}),
    };
  }

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("three", () => jest.requireActual("three"));

    jest.doMock("../../world/distance-streaming", () => ({
      disposeObject3D: (...args: any[]) => mockDisposeObject3D(...args),
    }));

    jest.doMock("../../character/character-instance.js", () => ({
      createHumanoidCharacterInstance: (...args: any[]) =>
        mockCreateHumanoidCharacterInstance(...args),
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
    mockCreateHumanoidCharacterInstance.mockImplementation(() => ({
      object: new THREE.Group(),
      update: jest.fn(),
      dispose: jest.fn(),
    }));
    mockGetNpcVisualStateByInstanceIndex.mockReturnValue(null);
    mockGetNpcVisualStateHashByInstanceIndex.mockReturnValue(null);
  });

  it("returns early when ZenKit is not available", async () => {
    const npcGroup = new THREE.Group();
    const npcData = makeNpcData(1, "NPC_1", { visual: makeVisual("HUM_BODY_NAKED0") });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: null,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: null },
      waypointMoverRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(mockCreateHumanoidCharacterInstance).not.toHaveBeenCalled();
  });

  it("reuses existing character instance when visualKey matches", async () => {
    const npcGroup = new THREE.Group();
    const existing = { object: new THREE.Group(), update: jest.fn(), dispose: jest.fn() };
    npcGroup.userData.characterInstance = existing;
    npcGroup.userData.visualKey = "HUMANS|0|ov:|HUM_A|1|2|HEAD|3|4|5";

    const npcData = makeNpcData(1, "NPC_1", {
      visual: makeVisual("HUM_A", {
        bodyTex: 1,
        skin: 2,
        headMesh: "HEAD",
        headTex: 3,
        teethTex: 4,
        armorInst: 5,
      }),
    });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: null },
      waypointMoverRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(mockCreateHumanoidCharacterInstance).not.toHaveBeenCalled();
    expect(existing.dispose).not.toHaveBeenCalled();
  });

  it("disposes and replaces existing character instance when visualKey changes", async () => {
    const npcGroup = new THREE.Group();
    const existing = { object: new THREE.Group(), update: jest.fn(), dispose: jest.fn() };
    npcGroup.userData.characterInstance = existing;
    npcGroup.userData.visualKey = "old";

    const npcData = makeNpcData(1, "NPC_1", { visual: makeVisual("HUM_BODY_NAKED0") });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: null },
      waypointMoverRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(existing.dispose).toHaveBeenCalledTimes(1);
    expect(npcGroup.userData.characterInstance).toBeTruthy();
  });

  it("loads creature models using explicit base script and does not fall back to mesh key", async () => {
    const npcGroup = new THREE.Group();
    const npcData = makeNpcData(7, "WOLF", { visual: makeVisual("WOLF") });

    mockGetNpcVisualStateByInstanceIndex.mockReturnValue({
      baseScript: "DRAGON",
      hasExplicitBaseScript: true,
      overlays: [],
      visual: makeVisual("WOLF"),
    });
    const modelScriptRegistry = { startLoadScript: jest.fn(), hasAnimation: jest.fn(() => true) };

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: modelScriptRegistry as any },
      waypointMoverRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(modelScriptRegistry.startLoadScript).toHaveBeenCalledWith("DRAGON");
    expect(mockCreateHumanoidCharacterInstance).toHaveBeenCalledTimes(1);
    expect(mockCreateHumanoidCharacterInstance.mock.calls[0][0].modelKey).toBe("DRAGON");
    expect(mockCreateHumanoidCharacterInstance.mock.calls[0][0].bodyMesh).toBe("WOLF");
    expect(typeof mockCreateHumanoidCharacterInstance.mock.calls[0][0].canLoadAnimation).toBe(
      "function",
    );
    expect(
      mockCreateHumanoidCharacterInstance.mock.calls[0][0].canLoadAnimation("DRAGON", "S_RUN"),
    ).toBe(true);
    expect(modelScriptRegistry.hasAnimation).toHaveBeenCalledWith("DRAGON", "S_RUN");
    expect(mockCreateCreatureLocomotionController).toHaveBeenCalledTimes(1);
    expect(mockCreateHumanLocomotionController).not.toHaveBeenCalled();
  });

  it("uses human locomotion controller for humanoid NPCs", async () => {
    const npcGroup = new THREE.Group();
    const npcData = makeNpcData(9, "MILITIA", { visual: makeVisual("HUM_BODY_NAKED0") });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: null },
      waypointMoverRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(mockCreateHumanLocomotionController).toHaveBeenCalledTimes(1);
    expect(mockCreateCreatureLocomotionController).not.toHaveBeenCalled();
  });

  it("waits for explicit creature base script instead of coercing to body mesh", async () => {
    const npcGroup = new THREE.Group();
    const npcData = makeNpcData(8, "WOLF", { visual: makeVisual("WOLF") });
    mockGetNpcVisualStateByInstanceIndex.mockReturnValue({
      baseScript: "HUMANS",
      hasExplicitBaseScript: false,
      overlays: [],
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
  });

  it("prefers latest VM visual data when npcData.visual is stale or missing", async () => {
    const npcGroup = new THREE.Group();
    const npcData = makeNpcData(11, "MEATBUG", { visual: undefined });
    mockGetNpcVisualStateByInstanceIndex.mockReturnValue({
      baseScript: "MEATBUG",
      hasExplicitBaseScript: true,
      overlays: [],
      visual: makeVisual("MBG_BODY", {
        bodyTex: 1,
        skin: 2,
      }),
    });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: { startLoadScript: jest.fn() } as any },
      waypointMoverRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(mockCreateHumanoidCharacterInstance).toHaveBeenCalledTimes(1);
    expect(mockCreateHumanoidCharacterInstance.mock.calls[0][0].modelKey).toBe("MEATBUG");
    expect(mockCreateHumanoidCharacterInstance.mock.calls[0][0].bodyMesh).toBe("MBG_BODY");
  });

  it("uses humanoid path for skeleton body when base script is HUMANS", async () => {
    const npcGroup = new THREE.Group();
    const npcData = makeNpcData(12481, "LESSER_SKELETON", {
      visual: makeVisual("SKE_BODY"),
    });
    mockGetNpcVisualStateByInstanceIndex.mockReturnValue({
      baseScript: "HUMANS",
      hasExplicitBaseScript: true,
      overlays: [],
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
    expect(mockCreateHumanLocomotionController).toHaveBeenCalledTimes(1);
    expect(mockCreateCreatureLocomotionController).not.toHaveBeenCalled();
  });

  it("removes placeholder object and exposes movement helpers", async () => {
    const npcGroup = new THREE.Group();
    const placeholder = new THREE.Object3D();
    placeholder.name = "npc-placeholder";
    npcGroup.add(placeholder);

    const waypointMover = {
      startMoveToWaypoint: jest.fn(() => true),
      startMoveToFreepoint: jest.fn(() => true),
    };

    const npcData = makeNpcData(3, "NPC_3", { visual: makeVisual("HUM_BODY_NAKED0") });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: null },
      waypointMoverRef: { current: waypointMover as any },
      getNpcVisualRoot: (g) => g,
    });

    expect(mockDisposeObject3D).toHaveBeenCalledWith(placeholder);
    expect(npcGroup.getObjectByName("npc-placeholder")).toBeUndefined();
    expect(typeof npcGroup.userData.startMoveToWaypoint).toBe("function");
    expect(typeof npcGroup.userData.startMoveToFreepoint).toBe("function");

    npcGroup.userData.startMoveToWaypoint("WP_TEST");
    npcGroup.userData.startMoveToFreepoint("FP_TEST");
    expect(waypointMover.startMoveToWaypoint).toHaveBeenCalled();
    expect(waypointMover.startMoveToFreepoint).toHaveBeenCalled();
  });

  it("disposes created instance when group becomes disposed during load", async () => {
    const npcGroup = new THREE.Group();
    const instance = { object: new THREE.Group(), update: jest.fn(), dispose: jest.fn() };
    instance.update.mockImplementation(() => {
      npcGroup.userData.isDisposed = true;
    });
    mockCreateHumanoidCharacterInstance.mockReturnValueOnce(instance);

    const npcData = makeNpcData(1, "NPC_1", { visual: makeVisual("HUM_BODY_NAKED0") });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: null },
      waypointMoverRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(instance.dispose).toHaveBeenCalled();
    expect(mockDisposeObject3D).toHaveBeenCalledWith(npcGroup);
    expect(npcGroup.userData.modelLoading).toBe(false);
  });
});
