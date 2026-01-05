export {};

describe("npc-character-loader", () => {
  let THREE: typeof import("three");
  let mod: typeof import("../npc-character-loader");

  type NpcData = import("../types").NpcData;
  type NpcVisual = import("../types").NpcVisual;

  const mockCreateHumanoidCharacterInstance = jest.fn();
  const mockCreateCreatureCharacterInstance = jest.fn();
  const mockDisposeObject3D = jest.fn();
  const mockGetNpcModelScriptsState = jest.fn();
  const mockSetNpcBaseModelScript = jest.fn();
  const mockCreateHumanLocomotionController = jest.fn(() => ({ kind: "locomotion" }));

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

  function makeNpcData(instanceIndex: number, symbolName: string, extra?: Partial<NpcData>): NpcData {
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

    jest.doMock("../distance-streaming", () => ({
      disposeObject3D: (...args: any[]) => mockDisposeObject3D(...args),
    }));

    jest.doMock("../character/character-instance.js", () => ({
      createHumanoidCharacterInstance: (...args: any[]) => mockCreateHumanoidCharacterInstance(...args),
    }));
    jest.doMock("../character/creature-character.js", () => ({
      createCreatureCharacterInstance: (...args: any[]) => mockCreateCreatureCharacterInstance(...args),
    }));

    jest.doMock("../npc-model-scripts", () => ({
      getNpcModelScriptsState: (...args: any[]) => mockGetNpcModelScriptsState(...args),
      setNpcBaseModelScript: (...args: any[]) => mockSetNpcBaseModelScript(...args),
    }));

    jest.doMock("../npc-locomotion", () => ({
      createHumanLocomotionController: () => mockCreateHumanLocomotionController(),
    }));

    THREE = await import("three");
    mod = await import("../npc-character-loader");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateHumanoidCharacterInstance.mockImplementation(() => ({
      object: new THREE.Group(),
      update: jest.fn(),
      dispose: jest.fn(),
    }));
    mockCreateCreatureCharacterInstance.mockImplementation(() => ({
      object: new THREE.Group(),
      update: jest.fn(),
      dispose: jest.fn(),
    }));
    mockGetNpcModelScriptsState.mockReturnValue(null);
  });

  it("returns early when ZenKit is not available", async () => {
    const npcGroup = new THREE.Group();
    const npcData = makeNpcData(1, "NPC_1", { visual: makeVisual("HUM_BODY_NAKED0") });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: null,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: null },
      waypointMoverRef: { current: null },
      cavalornGroupRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(mockCreateHumanoidCharacterInstance).not.toHaveBeenCalled();
  });

  it("reuses existing character instance when visualKey matches", async () => {
    const npcGroup = new THREE.Group();
    const existing = { object: new THREE.Group(), update: jest.fn(), dispose: jest.fn() };
    npcGroup.userData.characterInstance = existing;
    npcGroup.userData.visualKey = "HUM_A|1|2|HEAD|3|4|5";

    const npcData = makeNpcData(1, "NPC_1", {
      visual: makeVisual("HUM_A", { bodyTex: 1, skin: 2, headMesh: "HEAD", headTex: 3, teethTex: 4, armorInst: 5 }),
    });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: null },
      waypointMoverRef: { current: null },
      cavalornGroupRef: { current: null },
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
      cavalornGroupRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(existing.dispose).toHaveBeenCalledTimes(1);
    expect(npcGroup.userData.characterInstance).toBeTruthy();
  });

  it("loads creature models using base script when available, and falls back to mesh key on failure", async () => {
    const npcGroup = new THREE.Group();
    const npcData = makeNpcData(7, "WOLF", { visual: makeVisual("WOLF") });

    mockGetNpcModelScriptsState.mockReturnValue({ baseScript: "DRAGON" });
    const creatureInstance = { object: new THREE.Group(), update: jest.fn(), dispose: jest.fn() };
    mockCreateCreatureCharacterInstance.mockReturnValueOnce(null);
    mockCreateCreatureCharacterInstance.mockReturnValueOnce(creatureInstance);

    const modelScriptRegistry = { startLoadScript: jest.fn() };

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: modelScriptRegistry as any },
      waypointMoverRef: { current: null },
      cavalornGroupRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(modelScriptRegistry.startLoadScript).toHaveBeenCalledWith("DRAGON");
    expect(mockCreateCreatureCharacterInstance).toHaveBeenCalledTimes(2);
    expect(mockCreateCreatureCharacterInstance.mock.calls[0][0].modelKey).toBe("DRAGON");
    expect(mockCreateCreatureCharacterInstance.mock.calls[1][0].modelKey).toBe("WOLF");
  });

  it("normalizes HUMANS base script into an explicit per-NPC base model script", async () => {
    const npcGroup = new THREE.Group();
    const npcData = makeNpcData(8, "WOLF", { visual: makeVisual("WOLF") });
    mockGetNpcModelScriptsState.mockReturnValue({ baseScript: "HUMANS" });

    await mod.loadNpcCharacter(npcGroup, npcData as any, {
      zenKit: {} as any,
      characterCachesRef: { current: {} as any },
      modelScriptRegistryRef: { current: { startLoadScript: jest.fn() } as any },
      waypointMoverRef: { current: null },
      cavalornGroupRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(mockSetNpcBaseModelScript).toHaveBeenCalledWith(8, "WOLF");
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
      cavalornGroupRef: { current: null },
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
      cavalornGroupRef: { current: null },
      getNpcVisualRoot: (g) => g,
    });

    expect(instance.dispose).toHaveBeenCalled();
    expect(mockDisposeObject3D).toHaveBeenCalledWith(npcGroup);
    expect(npcGroup.userData.modelLoading).toBe(false);
  });
});
