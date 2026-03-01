export {};

describe("npc-model-descriptor", () => {
  let mod: typeof import("./npc-model-descriptor");

  type NpcData = import("../../shared/types").NpcData;
  type NpcVisual = import("../../shared/types").NpcVisual;

  const mockGetNpcVisualStateByInstanceIndex = jest.fn();
  const mockGetNpcVisualStateHashByInstanceIndex = jest.fn();

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
    jest.doMock("../../vm-manager", () => ({
      getNpcVisualStateByInstanceIndex: (...args: any[]) =>
        mockGetNpcVisualStateByInstanceIndex(...args),
      getNpcVisualStateHashByInstanceIndex: (...args: any[]) =>
        mockGetNpcVisualStateHashByInstanceIndex(...args),
    }));
    mod = await import("./npc-model-descriptor");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetNpcVisualStateByInstanceIndex.mockReturnValue(null);
    mockGetNpcVisualStateHashByInstanceIndex.mockReturnValue(null);
  });

  it("prefers meaningful VM visual over npcData visual", () => {
    const npcData = makeNpcData(10, "MEATBUG", { visual: makeVisual("HUM_BODY_NAKED0") });
    mockGetNpcVisualStateByInstanceIndex.mockReturnValue({
      baseScript: "MEATBUG",
      overlays: [],
      hasExplicitBaseScript: true,
      hasSetVisual: true,
      hasSetVisualBody: true,
      isReady: true,
      visual: makeVisual("MBG_BODY"),
    });

    const desc = mod.resolveNpcModelDescriptor(npcData);

    expect(desc.visual?.bodyMesh).toBe("MBG_BODY");
    expect(desc.baseScript).toBe("MEATBUG");
    expect(desc.usesCreatureLocomotion).toBe(true);
  });

  it("falls back to npcData visual when VM visual is empty", () => {
    const npcData = makeNpcData(11, "MILITIA", { visual: makeVisual("HUM_BODY_NAKED0") });
    mockGetNpcVisualStateByInstanceIndex.mockReturnValue({
      baseScript: "HUMANS",
      overlays: [],
      hasExplicitBaseScript: false,
      hasSetVisual: false,
      hasSetVisualBody: false,
      isReady: false,
      visual: makeVisual(""),
    });

    const desc = mod.resolveNpcModelDescriptor(npcData);

    expect(desc.visual?.bodyMesh).toBe("HUM_BODY_NAKED0");
    expect(desc.baseScript).toBe("HUMANS");
    expect(desc.usesCreatureLocomotion).toBe(false);
    expect(desc.hasExplicitBaseScript).toBe(false);
  });

  it("keeps descriptor not-ready when VM state is missing", () => {
    const npcData = makeNpcData(12, "LESSER_SKELETON", { visual: makeVisual("SKE_BODY") });

    const desc = mod.resolveNpcModelDescriptor(npcData);

    expect(desc.baseScript).toBe("SKE_BODY");
    expect(desc.hasExplicitBaseScript).toBe(true);
    expect(desc.usesCreatureLocomotion).toBe(true);
    expect(desc.isReady).toBe(false);
  });

  it("uses VM hash as visual key when available", () => {
    const npcData = makeNpcData(13, "NPC", { visual: makeVisual("HUM_BODY_NAKED0") });
    mockGetNpcVisualStateHashByInstanceIndex.mockReturnValue("HASHED_KEY");

    const desc = mod.resolveNpcModelDescriptor(npcData);

    expect(desc.visualKey).toBe("HASHED_KEY");
  });

  it("preloads scripts only for creature descriptors", () => {
    const startLoadScript = jest.fn();
    const registryRef = { current: { startLoadScript } } as any;

    mod.preloadNpcModelScripts(
      {
        visual: makeVisual("WOLF"),
        visualKey: "k",
        bodyMesh: "WOLF",
        baseScript: "WOLF",
        hasExplicitBaseScript: true,
        isReady: true,
        overlays: ["WOLF_OVERLAY"],
        usesCreatureLocomotion: true,
      },
      registryRef,
    );
    mod.preloadNpcModelScripts(
      {
        visual: makeVisual("HUM_BODY_NAKED0"),
        visualKey: "k2",
        bodyMesh: "HUM_BODY_NAKED0",
        baseScript: "HUMANS",
        hasExplicitBaseScript: true,
        isReady: true,
        overlays: ["HUMANS_RELAXED"],
        usesCreatureLocomotion: false,
      },
      registryRef,
    );

    expect(startLoadScript).toHaveBeenCalledWith("WOLF");
    expect(startLoadScript).toHaveBeenCalledWith("WOLF_OVERLAY");
    expect(startLoadScript).not.toHaveBeenCalledWith("HUMANS");
    expect(startLoadScript).not.toHaveBeenCalledWith("HUMANS_RELAXED");
  });

  it("validates creature instantiation requirements", () => {
    expect(
      mod.canInstantiateNpcModel({
        visual: makeVisual("WOLF"),
        visualKey: "k",
        bodyMesh: "WOLF",
        baseScript: "HUMANS",
        hasExplicitBaseScript: false,
        isReady: false,
        overlays: [],
        usesCreatureLocomotion: true,
      }),
    ).toBe(false);

    expect(
      mod.canInstantiateNpcModel({
        visual: makeVisual("HUM_BODY_NAKED0"),
        visualKey: "k2",
        bodyMesh: "HUM_BODY_NAKED0",
        baseScript: "HUMANS",
        hasExplicitBaseScript: true,
        isReady: true,
        overlays: [],
        usesCreatureLocomotion: false,
      }),
    ).toBe(true);

    expect(
      mod.canInstantiateNpcModel({
        visual: makeVisual("WOLF"),
        visualKey: "k3",
        bodyMesh: "WOLF",
        baseScript: "HUMANS",
        hasExplicitBaseScript: false,
        isReady: false,
        overlays: [],
        usesCreatureLocomotion: false,
      }),
    ).toBe(false);
  });
});
