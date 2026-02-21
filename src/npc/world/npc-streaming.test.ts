export {};

type Aabb = import("./npc-routine-waybox").Aabb;
type NpcData = import("../../shared/types").NpcData;

function aabbAround(x: number, y: number, z: number, half: number): Aabb {
  return {
    minX: x - half,
    minY: y - half,
    minZ: z - half,
    maxX: x + half,
    maxY: y + half,
    maxZ: z + half,
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

describe("npc-streaming", () => {
  let THREE: typeof import("three");
  let mod: typeof import("./npc-streaming");

  const mockShouldUpdateStreaming = jest.fn();
  const mockDisposeObject3D = jest.fn();
  const mockCreateNpcMesh = jest.fn();
  const mockSpreadSpawnXZ = jest.fn();
  const mockGetNpcSpawnOrder = jest.fn();
  const mockClearNpcFreepointReservations = jest.fn();
  const mockClearNpcEmRuntimeState = jest.fn();
  const mockClearNpcEmQueueState = jest.fn();

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("three", () => jest.requireActual("three"));

    jest.doMock("../../world/distance-streaming", () => ({
      disposeObject3D: (...args: any[]) => mockDisposeObject3D(...args),
      shouldUpdateStreaming: (...args: any[]) => mockShouldUpdateStreaming(...args),
    }));

    jest.doMock("../data/npc-utils", () => {
      const THREE = jest.requireActual("three");
      return {
        createNpcMesh: (npcData: any, position: any) => {
          mockCreateNpcMesh(npcData, position);
          const g = new THREE.Group();
          g.position.copy(position);
          g.userData.npcData = npcData;
          return g;
        },
      };
    });

    jest.doMock("./npc-spawn-spread", () => ({
      spreadSpawnXZ: (...args: any[]) => mockSpreadSpawnXZ(...args),
    }));
    jest.doMock("../../vm-manager", () => ({
      getNpcSpawnOrder: (...args: any[]) => mockGetNpcSpawnOrder(...args),
    }));
    jest.doMock("./npc-freepoints", () => ({
      clearNpcFreepointReservations: (...args: any[]) => mockClearNpcFreepointReservations(...args),
    }));
    jest.doMock("../combat/npc-em-runtime", () => ({
      clearNpcEmRuntimeState: (...args: any[]) => mockClearNpcEmRuntimeState(...args),
    }));
    jest.doMock("../combat/npc-em-queue", () => ({
      clearNpcEmQueueState: (...args: any[]) => mockClearNpcEmQueueState(...args),
    }));

    THREE = await import("three");
    mod = await import("./npc-streaming");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockShouldUpdateStreaming.mockReturnValue({
      shouldUpdate: true,
      cameraPos: new THREE.Vector3(0, 0, 0),
    });
    mockSpreadSpawnXZ.mockImplementation(({ baseX, baseZ }: any) => ({
      applied: false,
      x: baseX,
      z: baseZ,
      tries: 0,
    }));
    mockGetNpcSpawnOrder.mockReturnValue(null);
  });

  it("loads NPCs that intersect the load box", () => {
    const npcData = makeNpcData(1, "NPC_1", { name: "NPC_1" });
    const npcId = "npc-1";
    const entry = { npcData, position: new THREE.Vector3(0, 0, 0), waybox: aabbAround(0, 0, 0, 1) };

    const loadedNpcsRef = { current: new Map<string, any>() };
    const npcsGroupRef = { current: null as any };
    const scene = new THREE.Scene();

    const loadNpcCharacter = jest.fn();
    const trySnapNpcToGroundWithRapier = jest.fn(() => true);

    mod.updateNpcStreaming({
      enabled: true,
      world: {} as any,
      cameraPosition: new THREE.Vector3(0, 0, 0),
      camera: undefined,
      streamingState: {
        current: {
          lastCameraPosition: { current: new THREE.Vector3() },
          isFirstUpdate: { current: true },
          updateCounter: { current: 0 },
        },
      },
      npcItemsRef: { current: [{ id: npcId, waybox: entry.waybox }] },
      loadedNpcsRef,
      allNpcsRef: { current: [entry] },
      allNpcsByIdRef: { current: new Map([[npcId, entry]]) },
      npcsGroupRef,
      scene,
      kccConfig: { radius: 30 },
      applyMoveConstraint: jest.fn(() => ({ blocked: false, moved: true })),
      trySnapNpcToGroundWithRapier,
      loadNpcCharacter,
      removeNpcKccCollider: jest.fn(),
      waypointMoverRef: { current: null },
      playerGroupRef: { current: null },
      manualControlHeroEnabled: false,
      waypointDirIndex: new Map(),
      vobDirIndex: new Map(),
      NPC_LOAD_DISTANCE: 50,
      NPC_UNLOAD_DISTANCE: 100,
      NPC_ACTIVE_BBOX_HALF_Y: 100,
    });

    expect(loadedNpcsRef.current.has(npcId)).toBe(true);
    expect(npcsGroupRef.current).toBeTruthy();
    expect(mockCreateNpcMesh).toHaveBeenCalledWith(npcData, entry.position);
    expect(trySnapNpcToGroundWithRapier).toHaveBeenCalled();
    expect(loadNpcCharacter).toHaveBeenCalledWith(expect.any(THREE.Group), npcData);
  });

  it("sorts load order using getNpcSpawnOrder when available", () => {
    mockGetNpcSpawnOrder.mockImplementation((idx: number) =>
      idx === 1 ? 2 : idx === 2 ? 1 : null,
    );

    const npc1 = makeNpcData(1, "NPC_1");
    const npc2 = makeNpcData(2, "NPC_2");
    const e1 = {
      npcData: npc1,
      position: new THREE.Vector3(0, 0, 0),
      waybox: aabbAround(0, 0, 0, 1),
    };
    const e2 = {
      npcData: npc2,
      position: new THREE.Vector3(0, 0, 0),
      waybox: aabbAround(0, 0, 0, 1),
    };

    const loadNpcCharacter = jest.fn();

    mod.updateNpcStreaming({
      enabled: true,
      world: {} as any,
      cameraPosition: new THREE.Vector3(0, 0, 0),
      camera: undefined,
      streamingState: {
        current: {
          lastCameraPosition: { current: new THREE.Vector3() },
          isFirstUpdate: { current: true },
          updateCounter: { current: 0 },
        },
      },
      npcItemsRef: {
        current: [
          { id: "npc-1", waybox: e1.waybox },
          { id: "npc-2", waybox: e2.waybox },
        ],
      },
      loadedNpcsRef: { current: new Map() },
      allNpcsRef: { current: [e1, e2] },
      allNpcsByIdRef: {
        current: new Map([
          ["npc-1", e1],
          ["npc-2", e2],
        ]),
      },
      npcsGroupRef: { current: null },
      scene: new THREE.Scene(),
      kccConfig: { radius: 30 },
      applyMoveConstraint: jest.fn(() => ({ blocked: false, moved: true })),
      trySnapNpcToGroundWithRapier: jest.fn(() => true),
      loadNpcCharacter,
      removeNpcKccCollider: jest.fn(),
      waypointMoverRef: { current: null },
      playerGroupRef: { current: null },
      manualControlHeroEnabled: false,
      waypointDirIndex: new Map(),
      vobDirIndex: new Map(),
      NPC_LOAD_DISTANCE: 50,
      NPC_UNLOAD_DISTANCE: 100,
      NPC_ACTIVE_BBOX_HALF_Y: 100,
    });

    const loadedOrder = loadNpcCharacter.mock.calls.map(
      ([, npcData]) => (npcData as any).instanceIndex,
    );
    expect(loadedOrder.slice(0, 2)).toEqual([2, 1]);
  });

  it("does not unload hero even when manual control is disabled", () => {
    const heroData = makeNpcData(99, "PC_HERO", { name: "HERO" });
    const npcId = "npc-99";
    const group = new THREE.Group();
    group.userData.npcData = heroData;
    group.userData.isPlayer = true;

    const loadedNpcsRef = { current: new Map([[npcId, group]]) };
    const allNpcsByIdRef = {
      current: new Map([
        [
          npcId,
          {
            npcData: heroData,
            position: new THREE.Vector3(1000, 0, 0),
            waybox: aabbAround(1000, 0, 0, 1),
          },
        ],
      ]),
    };

    const removeNpcKccCollider = jest.fn();

    mod.updateNpcStreaming({
      enabled: true,
      world: {} as any,
      cameraPosition: new THREE.Vector3(0, 0, 0),
      camera: undefined,
      streamingState: {
        current: {
          lastCameraPosition: { current: new THREE.Vector3() },
          isFirstUpdate: { current: true },
          updateCounter: { current: 0 },
        },
      },
      npcItemsRef: { current: [] },
      loadedNpcsRef,
      allNpcsRef: { current: [] },
      allNpcsByIdRef,
      npcsGroupRef: { current: new THREE.Group() },
      scene: new THREE.Scene(),
      kccConfig: { radius: 30 },
      applyMoveConstraint: jest.fn(() => ({ blocked: false, moved: true })),
      trySnapNpcToGroundWithRapier: jest.fn(() => true),
      loadNpcCharacter: jest.fn(),
      removeNpcKccCollider,
      waypointMoverRef: { current: null },
      playerGroupRef: { current: group },
      manualControlHeroEnabled: false,
      waypointDirIndex: new Map(),
      vobDirIndex: new Map(),
      NPC_LOAD_DISTANCE: 50,
      NPC_UNLOAD_DISTANCE: 100,
      NPC_ACTIVE_BBOX_HALF_Y: 100,
    });

    expect(loadedNpcsRef.current.has(npcId)).toBe(true);
    expect(removeNpcKccCollider).not.toHaveBeenCalled();
  });

  it("forces hero into the load set even when camera is far", () => {
    const heroData = makeNpcData(99, "PC_HERO", { name: "HERO" });
    const npcId = "npc-99";
    const entry = {
      npcData: heroData,
      position: new THREE.Vector3(1000, 0, 0),
      waybox: aabbAround(1000, 0, 0, 1),
    };

    const loadedNpcsRef = { current: new Map<string, any>() };
    const playerGroupRef = { current: null as any };

    mod.updateNpcStreaming({
      enabled: true,
      world: {} as any,
      cameraPosition: new THREE.Vector3(0, 0, 0),
      camera: undefined,
      streamingState: {
        current: {
          lastCameraPosition: { current: new THREE.Vector3() },
          isFirstUpdate: { current: true },
          updateCounter: { current: 0 },
        },
      },
      npcItemsRef: { current: [] },
      loadedNpcsRef,
      allNpcsRef: { current: [entry] },
      allNpcsByIdRef: { current: new Map([[npcId, entry]]) },
      npcsGroupRef: { current: null },
      scene: new THREE.Scene(),
      kccConfig: { radius: 30 },
      applyMoveConstraint: jest.fn(() => ({ blocked: false, moved: true })),
      trySnapNpcToGroundWithRapier: jest.fn(() => true),
      loadNpcCharacter: jest.fn(),
      removeNpcKccCollider: jest.fn(),
      waypointMoverRef: { current: null },
      playerGroupRef,
      manualControlHeroEnabled: false,
      waypointDirIndex: new Map(),
      vobDirIndex: new Map(),
      NPC_LOAD_DISTANCE: 50,
      NPC_UNLOAD_DISTANCE: 100,
      NPC_ACTIVE_BBOX_HALF_Y: 100,
    });

    expect(loadedNpcsRef.current.has(npcId)).toBe(true);
    expect(playerGroupRef.current).toBeTruthy();
    expect((playerGroupRef.current as any).userData.isPlayer).toBe(true);
  });

  it("does not apply spawn spreading to the hero", () => {
    const heroData = makeNpcData(99, "PC_HERO", { name: "HERO" });
    const npcId = "npc-99";
    const heroPos = new THREE.Vector3(10, 0, 20);
    const entry = { npcData: heroData, position: heroPos, waybox: aabbAround(10, 0, 20, 1) };

    const loadedNpcsRef = { current: new Map<string, any>() };

    mod.updateNpcStreaming({
      enabled: true,
      world: {} as any,
      cameraPosition: new THREE.Vector3(0, 0, 0),
      camera: undefined,
      streamingState: {
        current: {
          lastCameraPosition: { current: new THREE.Vector3() },
          isFirstUpdate: { current: true },
          updateCounter: { current: 0 },
        },
      },
      npcItemsRef: { current: [{ id: npcId, waybox: entry.waybox }] },
      loadedNpcsRef,
      allNpcsRef: { current: [entry] },
      allNpcsByIdRef: { current: new Map([[npcId, entry]]) },
      npcsGroupRef: { current: null as any },
      scene: new THREE.Scene(),
      kccConfig: { radius: 30 },
      applyMoveConstraint: jest.fn(() => ({ blocked: false, moved: true })),
      trySnapNpcToGroundWithRapier: jest.fn(() => true),
      loadNpcCharacter: jest.fn(),
      removeNpcKccCollider: jest.fn(),
      waypointMoverRef: { current: null },
      playerGroupRef: { current: null },
      manualControlHeroEnabled: false,
      waypointDirIndex: new Map(),
      vobDirIndex: new Map(),
      NPC_LOAD_DISTANCE: 50,
      NPC_UNLOAD_DISTANCE: 100,
      NPC_ACTIVE_BBOX_HALF_Y: 100,
    });

    expect(mockSpreadSpawnXZ).not.toHaveBeenCalled();
    expect(heroPos.x).toBe(10);
    expect(heroPos.z).toBe(20);
  });

  it("retries loading character for already-loaded placeholder NPCs with cooldown", () => {
    const npcData = makeNpcData(41, "MEATBUG");
    const npcId = "npc-41";
    const npcGroup = new THREE.Group();
    npcGroup.userData.npcData = npcData;
    npcGroup.userData.modelLoading = false;
    npcGroup.userData.characterInstance = undefined;

    const entry = {
      npcData,
      position: new THREE.Vector3(0, 0, 0),
      waybox: aabbAround(0, 0, 0, 1),
    };
    const loadNpcCharacter = jest.fn();

    const baseParams = {
      enabled: true,
      world: {} as any,
      cameraPosition: new THREE.Vector3(0, 0, 0),
      camera: undefined,
      streamingState: {
        current: {
          lastCameraPosition: { current: new THREE.Vector3() },
          isFirstUpdate: { current: true },
          updateCounter: { current: 0 },
        },
      },
      npcItemsRef: { current: [] as Array<{ id: string; waybox: Aabb }> },
      loadedNpcsRef: { current: new Map([[npcId, npcGroup]]) },
      allNpcsRef: { current: [entry] },
      allNpcsByIdRef: { current: new Map([[npcId, entry]]) },
      npcsGroupRef: { current: null as any },
      scene: new THREE.Scene(),
      kccConfig: { radius: 30 },
      applyMoveConstraint: jest.fn(() => ({ blocked: false, moved: true })),
      trySnapNpcToGroundWithRapier: jest.fn(() => true),
      loadNpcCharacter,
      removeNpcKccCollider: jest.fn(),
      waypointMoverRef: { current: null },
      playerGroupRef: { current: null },
      manualControlHeroEnabled: false,
      waypointDirIndex: new Map(),
      vobDirIndex: new Map(),
      NPC_LOAD_DISTANCE: 50,
      NPC_UNLOAD_DISTANCE: 100,
      NPC_ACTIVE_BBOX_HALF_Y: 100,
    };

    mod.updateNpcStreaming(baseParams);
    expect(loadNpcCharacter).toHaveBeenCalledTimes(1);

    mod.updateNpcStreaming(baseParams);
    expect(loadNpcCharacter).toHaveBeenCalledTimes(1);

    npcGroup.userData.modelRetryAtMs = 0;
    mod.updateNpcStreaming(baseParams);
    expect(loadNpcCharacter).toHaveBeenCalledTimes(2);
  });
});
