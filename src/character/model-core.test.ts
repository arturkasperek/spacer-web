export {};

describe("model-core", () => {
  let THREE: typeof import("three");
  let mod: typeof import("./model-core");

  const mockFetchBinaryCached = jest.fn();
  const mockBuildSkeletonFromHierarchy = jest.fn();
  const mockBuildSoftSkinMeshCPU = jest.fn();
  const mockBuildThreeJSGeometryAndMaterials = jest.fn();

  function makeCollection<T>(values: T[]) {
    return {
      size: () => values.length,
      get: (index: number) => values[index],
    };
  }

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("three", () => jest.requireActual("three"));
    jest.doMock("./binary-cache", () => ({
      fetchBinaryCached: (...args: any[]) => mockFetchBinaryCached(...args),
    }));
    jest.doMock("./skeleton", () => ({
      buildSkeletonFromHierarchy: (...args: any[]) => mockBuildSkeletonFromHierarchy(...args),
    }));
    jest.doMock("./soft-skin", () => ({
      buildSoftSkinMeshCPU: (...args: any[]) => mockBuildSoftSkinMeshCPU(...args),
    }));
    jest.doMock("../shared/mesh-utils", () => ({
      buildThreeJSGeometryAndMaterials: (...args: any[]) =>
        mockBuildThreeJSGeometryAndMaterials(...args),
    }));

    THREE = await import("three");
    mod = await import("./model-core");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchBinaryCached.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockBuildSoftSkinMeshCPU.mockResolvedValue({
      mesh: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()),
      skinningData: { mock: true },
    });
    mockBuildThreeJSGeometryAndMaterials.mockResolvedValue({
      geometry: new THREE.BufferGeometry(),
      materials: [new THREE.MeshBasicMaterial()],
    });
    mockBuildSkeletonFromHierarchy.mockImplementation(() => {
      const bone = new THREE.Bone();
      bone.name = "ATTACH_BONE";
      return {
        nodes: [{ name: "ATTACH_BONE" }],
        bones: [bone],
        rootNodes: [0],
        bindWorld: [new THREE.Matrix4()],
      };
    });
  });

  it("normalizes model asset key", () => {
    expect(mod.normalizeModelAssetKey("  humans.mds  ")).toBe("HUMANS");
    expect(mod.normalizeModelAssetKey("MBG_BODY..")).toBe("MBG_BODY");
    expect(mod.normalizeModelAssetKey("")).toBe("");
  });

  it("returns null when model has no soft-skin and no valid attachments", async () => {
    const hierarchy = { nodes: makeCollection([{ name: "ATTACH_BONE" }]) };
    const zModel = {
      setHierarchy: jest.fn(),
      setMesh: jest.fn(),
      getHierarchy: () => hierarchy,
      getSoftSkinMeshes: () => makeCollection([]),
      getAttachmentNames: () => makeCollection<string>([]),
      getAttachment: jest.fn(),
      convertAttachmentToProcessedMesh: jest.fn(),
    };
    const zenKit = {
      createModelHierarchyLoader: () => ({
        loadFromArray: () => ({ success: true }),
        getHierarchy: () => hierarchy,
      }),
      createModelMeshLoader: () => ({
        loadFromArray: () => ({ success: true }),
        getMesh: () => ({}),
      }),
      createModel: () => zModel,
    } as any;

    const parent = new THREE.Group();
    const result = await mod.buildNpcModelCore({
      zenKit,
      caches: {
        binary: new Map(),
        textures: new Map(),
        materials: new Map(),
        animations: {},
      } as any,
      parent,
      modelKey: "MEATBUG",
      meshKey: "MBG_BODY",
      bodyTex: 0,
      skin: 0,
    });

    expect(result).toBeNull();
  });

  it("builds model for attachment-only meshes", async () => {
    const hierarchy = { nodes: makeCollection([{ name: "ATTACH_BONE" }]) };
    const processed = {
      indices: { size: () => 3 },
      vertices: { size: () => 3 },
    };
    const zModel = {
      setHierarchy: jest.fn(),
      setMesh: jest.fn(),
      getHierarchy: () => hierarchy,
      getSoftSkinMeshes: () => makeCollection([]),
      getAttachmentNames: () => makeCollection(["ATTACH_BONE"]),
      getAttachment: () => ({}),
      convertAttachmentToProcessedMesh: () => processed,
    };
    const zenKit = {
      createModelHierarchyLoader: () => ({
        loadFromArray: () => ({ success: true }),
        getHierarchy: () => hierarchy,
      }),
      createModelMeshLoader: () => ({
        loadFromArray: () => ({ success: true }),
        getMesh: () => ({}),
      }),
      createModel: () => zModel,
    } as any;

    const parent = new THREE.Group();
    const result = await mod.buildNpcModelCore({
      zenKit,
      caches: {
        binary: new Map(),
        textures: new Map(),
        materials: new Map(),
        animations: {},
      } as any,
      parent,
      modelKey: "MEATBUG",
      meshKey: "MBG_BODY",
      bodyTex: 0,
      skin: 0,
    });

    expect(result).not.toBeNull();
    expect(result?.skinningDataList).toHaveLength(0);
    expect(mockBuildSoftSkinMeshCPU).not.toHaveBeenCalled();
    expect(result?.skeleton.bones[0].children.length).toBe(1);
  });
});
