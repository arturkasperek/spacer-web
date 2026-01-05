export {};

type Aabb = import("../npc-routine-waybox").Aabb;
type NpcData = import("../types").NpcData;

function aabbAround(x: number, y: number, z: number, half: number): Aabb {
  return { minX: x - half, minY: y - half, minZ: z - half, maxX: x + half, maxY: y + half, maxZ: z + half };
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
  let mod: typeof import("../npc-streaming");

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

    jest.doMock("../distance-streaming", () => ({
      disposeObject3D: (...args: any[]) => mockDisposeObject3D(...args),
      shouldUpdateStreaming: (...args: any[]) => mockShouldUpdateStreaming(...args),
    }));

    jest.doMock("../npc-utils", () => {
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

    jest.doMock("../npc-spawn-spread", () => ({
      spreadSpawnXZ: (...args: any[]) => mockSpreadSpawnXZ(...args),
    }));
    jest.doMock("../vm-manager", () => ({
      getNpcSpawnOrder: (...args: any[]) => mockGetNpcSpawnOrder(...args),
    }));
    jest.doMock("../npc-freepoints", () => ({
      clearNpcFreepointReservations: (...args: any[]) => mockClearNpcFreepointReservations(...args),
    }));
    jest.doMock("../npc-em-runtime", () => ({
      clearNpcEmRuntimeState: (...args: any[]) => mockClearNpcEmRuntimeState(...args),
    }));
    jest.doMock("../npc-em-queue", () => ({
      clearNpcEmQueueState: (...args: any[]) => mockClearNpcEmQueueState(...args),
    }));

    THREE = await import("three");
    mod = await import("../npc-streaming");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockShouldUpdateStreaming.mockReturnValue({ shouldUpdate: true, cameraPos: new THREE.Vector3(0, 0, 0) });
    mockSpreadSpawnXZ.mockImplementation(({ baseX, baseZ }: any) => ({ applied: false, x: baseX, z: baseZ, tries: 0 }));
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
      streamingState: { current: { lastCameraPosition: { current: new THREE.Vector3() }, isFirstUpdate: { current: true }, updateCounter: { current: 0 } } },
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
      cavalornGroupRef: { current: null },
      manualControlCavalornEnabled: false,
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
    mockGetNpcSpawnOrder.mockImplementation((idx: number) => (idx === 1 ? 2 : idx === 2 ? 1 : null));

    const npc1 = makeNpcData(1, "NPC_1");
    const npc2 = makeNpcData(2, "NPC_2");
    const e1 = { npcData: npc1, position: new THREE.Vector3(0, 0, 0), waybox: aabbAround(0, 0, 0, 1) };
    const e2 = { npcData: npc2, position: new THREE.Vector3(0, 0, 0), waybox: aabbAround(0, 0, 0, 1) };

    const loadNpcCharacter = jest.fn();

    mod.updateNpcStreaming({
      enabled: true,
      world: {} as any,
      cameraPosition: new THREE.Vector3(0, 0, 0),
      camera: undefined,
      streamingState: { current: { lastCameraPosition: { current: new THREE.Vector3() }, isFirstUpdate: { current: true }, updateCounter: { current: 0 } } },
      npcItemsRef: { current: [{ id: "npc-1", waybox: e1.waybox }, { id: "npc-2", waybox: e2.waybox }] },
      loadedNpcsRef: { current: new Map() },
      allNpcsRef: { current: [e1, e2] },
      allNpcsByIdRef: { current: new Map([["npc-1", e1], ["npc-2", e2]]) },
      npcsGroupRef: { current: null },
      scene: new THREE.Scene(),
      kccConfig: { radius: 30 },
      applyMoveConstraint: jest.fn(() => ({ blocked: false, moved: true })),
      trySnapNpcToGroundWithRapier: jest.fn(() => true),
      loadNpcCharacter,
      removeNpcKccCollider: jest.fn(),
      waypointMoverRef: { current: null },
      cavalornGroupRef: { current: null },
      manualControlCavalornEnabled: false,
      NPC_LOAD_DISTANCE: 50,
      NPC_UNLOAD_DISTANCE: 100,
      NPC_ACTIVE_BBOX_HALF_Y: 100,
    });

    const loadedOrder = loadNpcCharacter.mock.calls.map(([, npcData]) => (npcData as any).instanceIndex);
    expect(loadedOrder).toEqual([2, 1]);
  });

  it("does not unload Cavalorn when manual control is enabled", () => {
    const cavalornData = makeNpcData(99, "BAU_4300_ADDON_CAVALORN", { name: "CAVALORN" });
    const npcId = "npc-99";
    const group = new THREE.Group();
    group.userData.npcData = cavalornData;
    group.userData.isCavalorn = true;

    const loadedNpcsRef = { current: new Map([[npcId, group]]) };
    const allNpcsByIdRef = { current: new Map([[npcId, { npcData: cavalornData, position: new THREE.Vector3(1000, 0, 0), waybox: aabbAround(1000, 0, 0, 1) }]]) };

    const removeNpcKccCollider = jest.fn();

    mod.updateNpcStreaming({
      enabled: true,
      world: {} as any,
      cameraPosition: new THREE.Vector3(0, 0, 0),
      camera: undefined,
      streamingState: { current: { lastCameraPosition: { current: new THREE.Vector3() }, isFirstUpdate: { current: true }, updateCounter: { current: 0 } } },
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
      cavalornGroupRef: { current: group },
      manualControlCavalornEnabled: true,
      NPC_LOAD_DISTANCE: 50,
      NPC_UNLOAD_DISTANCE: 100,
      NPC_ACTIVE_BBOX_HALF_Y: 100,
    });

    expect(loadedNpcsRef.current.has(npcId)).toBe(true);
    expect(removeNpcKccCollider).not.toHaveBeenCalled();
  });

  it("forces Cavalorn into the load set when manual control is enabled and he is not loaded", () => {
    const cavalornData = makeNpcData(99, "BAU_4300_ADDON_CAVALORN", { name: "CAVALORN" });
    const npcId = "npc-99";
    const entry = { npcData: cavalornData, position: new THREE.Vector3(1000, 0, 0), waybox: aabbAround(1000, 0, 0, 1) };

    const loadedNpcsRef = { current: new Map<string, any>() };
    const cavalornGroupRef = { current: null as any };

    mod.updateNpcStreaming({
      enabled: true,
      world: {} as any,
      cameraPosition: new THREE.Vector3(0, 0, 0),
      camera: undefined,
      streamingState: { current: { lastCameraPosition: { current: new THREE.Vector3() }, isFirstUpdate: { current: true }, updateCounter: { current: 0 } } },
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
      cavalornGroupRef,
      manualControlCavalornEnabled: true,
      NPC_LOAD_DISTANCE: 50,
      NPC_UNLOAD_DISTANCE: 100,
      NPC_ACTIVE_BBOX_HALF_Y: 100,
    });

    expect(loadedNpcsRef.current.has(npcId)).toBe(true);
    expect(cavalornGroupRef.current).toBeTruthy();
    expect((cavalornGroupRef.current as any).userData.isCavalorn).toBe(true);
  });
});
