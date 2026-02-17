export {};

type Aabb = import("../world/npc-routine-waybox").Aabb;

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

describe("npc-renderer-data", () => {
  let THREE: typeof import("three");
  let mod: typeof import("./npc-renderer-data");

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("three", () => jest.requireActual("three"));
    THREE = await import("three");
    mod = await import("./npc-renderer-data");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns empty when disabled or world is missing", () => {
    const npcs = new Map<number, any>([[1, { instanceIndex: 1 }]]);
    const resA = mod.computeNpcsWithPositions({
      world: null,
      enabled: true,
      npcs,
      hour: 10,
      minute: 0,
      npcRoutineWayboxIndex: new Map(),
      waypointPosIndex: new Map(),
      vobPosIndex: new Map(),
      loadedNpcsRef: { current: new Map() },
    });
    expect(resA).toEqual([]);

    const resB = mod.computeNpcsWithPositions({
      world: {} as any,
      enabled: false,
      npcs,
      hour: 10,
      minute: 0,
      npcRoutineWayboxIndex: new Map(),
      waypointPosIndex: new Map(),
      vobPosIndex: new Map(),
      loadedNpcsRef: { current: new Map() },
    });
    expect(resB).toEqual([]);
  });

  it("skips NPCs with routines that have no routine waybox", () => {
    const npcData = {
      instanceIndex: 1,
      symbolName: "NPC_1",
      spawnpoint: "WP_A",
      dailyRoutine: [{ start_h: 0, stop_h: 24, waypoint: "WP_A" }],
    };
    const npcs = new Map<number, any>([[1, npcData]]);
    const res = mod.computeNpcsWithPositions({
      world: {} as any,
      enabled: true,
      npcs,
      hour: 10,
      minute: 0,
      npcRoutineWayboxIndex: new Map<number, Aabb | null>(),
      waypointPosIndex: new Map([["WP_A", new THREE.Vector3(1, 2, 3)]]),
      vobPosIndex: new Map(),
      loadedNpcsRef: { current: new Map() },
    });
    expect(res).toEqual([]);
  });

  it("uses already-loaded NPC group position when available", () => {
    const npcData = { instanceIndex: 1, symbolName: "NPC_1", spawnpoint: "WP_A" };
    const npcs = new Map<number, any>([[1, npcData]]);
    const group = new THREE.Group();
    group.position.set(10, 20, 30);
    (group as any).userData = { isDisposed: false };

    const res = mod.computeNpcsWithPositions({
      world: {} as any,
      enabled: true,
      npcs,
      hour: 10,
      minute: 0,
      npcRoutineWayboxIndex: new Map(),
      waypointPosIndex: new Map([["WP_A", new THREE.Vector3(1, 2, 3)]]),
      vobPosIndex: new Map(),
      loadedNpcsRef: { current: new Map([["npc-1", group]]) },
    });

    expect(res).toHaveLength(1);
    expect(res[0].position.x).toBe(10);
    expect(res[0].position.y).toBe(20);
    expect(res[0].position.z).toBe(30);
  });

  it("uses active routine waypoint when present, otherwise falls back to spawnpoint (waypoint->vob)", () => {
    const npcA = {
      instanceIndex: 1,
      symbolName: "NPC_1",
      spawnpoint: "SPAWN_A",
      dailyRoutine: [{ start_h: 9, stop_h: 11, waypoint: "ROUTINE_WP" }],
    };
    const npcB = {
      instanceIndex: 2,
      symbolName: "NPC_2",
      spawnpoint: "SPAWN_B",
      dailyRoutine: [],
    };
    const npcs = new Map<number, any>([
      [1, npcA],
      [2, npcB],
    ]);

    const routineWaybox: Aabb = aabbAround(0, 0, 0, 10);
    const res = mod.computeNpcsWithPositions({
      world: {} as any,
      enabled: true,
      npcs,
      hour: 10,
      minute: 0,
      npcRoutineWayboxIndex: new Map<number, Aabb | null>([[1, routineWaybox]]),
      waypointPosIndex: new Map([["ROUTINE_WP", new THREE.Vector3(5, 0, 0)]]),
      vobPosIndex: new Map([["SPAWN_B", new THREE.Vector3(7, 0, 0)]]),
      loadedNpcsRef: { current: new Map() },
    });

    expect(res).toHaveLength(2);
    const a = res.find((x) => x.npcData.instanceIndex === 1)!;
    expect(a.position.x).toBe(5);
    expect(a.waybox).toBe(routineWaybox);

    const b = res.find((x) => x.npcData.instanceIndex === 2)!;
    expect(b.position.x).toBe(7);
    expect(b.waybox.minX).toBeCloseTo(6);
    expect(b.waybox.maxX).toBeCloseTo(8);
  });

  it("warns and skips NPC when it cannot resolve routine waypoint or spawnpoint", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const npcData = { instanceIndex: 1, symbolName: "NPC_1", spawnpoint: "MISSING" };

    const res = mod.computeNpcsWithPositions({
      world: {} as any,
      enabled: true,
      npcs: new Map<number, any>([[1, npcData]]),
      hour: 10,
      minute: 0,
      npcRoutineWayboxIndex: new Map(),
      waypointPosIndex: new Map(),
      vobPosIndex: new Map(),
      loadedNpcsRef: { current: new Map() },
    });
    expect(res).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("handles multiple spawns of the same instanceIndex using spawnRuntimeId", () => {
    const npcA = {
      spawnRuntimeId: 1001,
      instanceIndex: 12469,
      symbolName: "SHEEP",
      spawnpoint: "SPAWN_A",
    };
    const npcB = {
      spawnRuntimeId: 1002,
      instanceIndex: 12469,
      symbolName: "SHEEP",
      spawnpoint: "SPAWN_B",
    };
    const loadedB = new THREE.Group();
    loadedB.position.set(40, 50, 60);
    (loadedB as any).userData = { isDisposed: false };

    const res = mod.computeNpcsWithPositions({
      world: {} as any,
      enabled: true,
      npcs: new Map<number, any>([
        [1001, npcA],
        [1002, npcB],
      ]),
      hour: 10,
      minute: 0,
      npcRoutineWayboxIndex: new Map<number, Aabb | null>(),
      waypointPosIndex: new Map([["SPAWN_A", new THREE.Vector3(1, 2, 3)]]),
      vobPosIndex: new Map([["SPAWN_B", new THREE.Vector3(7, 8, 9)]]),
      loadedNpcsRef: { current: new Map([["npc-1002", loadedB]]) },
    });

    expect(res).toHaveLength(2);
    const a = res.find((x) => x.npcData.spawnRuntimeId === 1001)!;
    const b = res.find((x) => x.npcData.spawnRuntimeId === 1002)!;
    expect(a.position.x).toBe(1);
    expect(a.position.y).toBe(2);
    expect(a.position.z).toBe(3);
    expect(b.position.x).toBe(40);
    expect(b.position.y).toBe(50);
    expect(b.position.z).toBe(60);
  });

  it("uses routine waybox indexed by runtime key", () => {
    const npcData = {
      spawnRuntimeId: 5001,
      instanceIndex: 12469,
      symbolName: "SHEEP",
      spawnpoint: "SPAWN_A",
      dailyRoutine: [{ start_h: 9, stop_h: 11, waypoint: "ROUTINE_WP" }],
    };
    const runtimeWaybox: Aabb = aabbAround(10, 0, 0, 2);
    const res = mod.computeNpcsWithPositions({
      world: {} as any,
      enabled: true,
      npcs: new Map<number, any>([[5001, npcData]]),
      hour: 10,
      minute: 0,
      npcRoutineWayboxIndex: new Map<number, Aabb | null>([[5001, runtimeWaybox]]),
      waypointPosIndex: new Map([["ROUTINE_WP", new THREE.Vector3(5, 0, 0)]]),
      vobPosIndex: new Map(),
      loadedNpcsRef: { current: new Map() },
    });

    expect(res).toHaveLength(1);
    expect(res[0].waybox).toBe(runtimeWaybox);
    expect(res[0].position.x).toBe(5);
  });
});
