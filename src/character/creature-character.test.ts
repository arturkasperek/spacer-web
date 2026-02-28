import * as THREE from "three";
import {
  buildInitialCreatureAnimationCandidates,
  createCreatureCharacterInstance,
} from "./creature-character";

jest.mock("three", () => jest.requireActual("three"));

jest.mock("./binary-cache", () => ({
  fetchBinaryCached: jest.fn(async () => new Uint8Array([1, 2, 3])),
}));

jest.mock("./animation", () => ({
  loadAnimationSequence: jest.fn(async () => null),
  evaluatePose: jest.fn(() => true),
}));

jest.mock("./skeleton", () => ({
  buildSkeletonFromHierarchy: jest.fn(() => ({
    rootNodes: [0],
    bones: [new THREE.Group()],
    bindWorld: [],
    animWorld: [],
  })),
}));

jest.mock("./cpu-skinning", () => ({
  applyCpuSkinning: jest.fn(),
}));

jest.mock("./soft-skin", () => ({
  buildSoftSkinMeshCPU: jest.fn(),
}));

jest.mock("../shared/mesh-utils", () => ({
  buildThreeJSGeometryAndMaterials: jest.fn(async () => ({
    geometry: new THREE.BufferGeometry(),
    materials: [],
  })),
}));

jest.mock("../world/distance-streaming", () => ({
  disposeObject3D: jest.fn(),
}));

describe("creature-character", () => {
  it("builds creature initial animation candidates without human-only probes", () => {
    const candidates = buildInitialCreatureAnimationCandidates("s_Run");
    const upper = candidates.map((s) => s.toUpperCase());

    expect(upper).toContain("S_RUN");
    expect(upper).toContain("S_RUNL");
    expect(upper).toContain("S_WALK");
    expect(upper).toContain("S_WALKL");
    expect(upper).toContain("S_STAND");
    expect(upper).toContain("T_STAND");
    expect(upper).not.toContain("S_IDLE");
    expect(upper).not.toContain("T_DANCE_01");
  });

  it("deduplicates and trims candidate names", () => {
    const candidates = buildInitialCreatureAnimationCandidates("  s_Run  ");
    const runCount = candidates.filter((s) => s.toLowerCase() === "s_run").length;

    expect(runCount).toBe(1);
    expect(candidates[0]).toBe("s_Run");
  });

  it("creates creature instance from attachment meshes when soft-skin meshes are absent", async () => {
    const hierarchy = {
      nodes: {
        size: () => 1,
        get: () => ({ name: "MBG_BODY", parentIndex: -1 }),
      },
    };
    const processed = {
      indices: { size: () => 3, get: () => 0 },
      vertices: { size: () => 24, get: () => 0 },
      materials: { size: () => 1, get: () => ({ texture: "" }) },
      materialIds: { size: () => 1, get: () => 0 },
    };
    const zenKit: any = {
      createModelHierarchyLoader: () => ({
        loadFromArray: () => ({ success: true }),
        getHierarchy: () => hierarchy,
      }),
      createModelMeshLoader: () => ({
        loadFromArray: () => ({ success: true }),
        getMesh: () => ({}),
      }),
      createModel: () => ({
        setHierarchy: () => {},
        setMesh: () => {},
        getHierarchy: () => hierarchy,
        getSoftSkinMeshes: () => ({ size: () => 0 }),
        getAttachmentNames: () => ({ size: () => 1, get: () => "MBG_BODY" }),
        getAttachment: () => ({}),
        convertAttachmentToProcessedMesh: () => processed,
      }),
    };
    const parent = new THREE.Group();
    const instance = await createCreatureCharacterInstance({
      zenKit,
      caches: {
        binary: new Map(),
        textures: new Map(),
        materials: new Map(),
        animations: new Map(),
      } as any,
      parent,
      modelKey: "MEATBUG",
      meshKey: "MBG_BODY",
    });

    expect(instance).toBeTruthy();
  });

  it("keeps attachment meshes when soft-skin meshes are present", async () => {
    const { buildSoftSkinMeshCPU } = jest.requireMock("./soft-skin") as {
      buildSoftSkinMeshCPU: jest.Mock;
    };
    buildSoftSkinMeshCPU.mockResolvedValue({
      mesh: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()),
      skinningData: {
        geometry: new THREE.BufferGeometry(),
        skinIndex: new Uint16Array(0),
        skinWeight: new Float32Array(0),
        infPos: new Float32Array(0),
        infNorm: new Float32Array(0),
        basePositions: new Float32Array(0),
        baseNormals: new Float32Array(0),
      },
    });

    const hierarchy = {
      nodes: {
        size: () => 1,
        get: () => ({ name: "BUG_PART", parentIndex: -1 }),
      },
    };
    const processed = {
      indices: { size: () => 3, get: () => 0 },
      vertices: { size: () => 24, get: () => 0 },
      materials: { size: () => 1, get: () => ({ texture: "" }) },
      materialIds: { size: () => 1, get: () => 0 },
    };

    const zenKit: any = {
      createModelHierarchyLoader: () => ({
        loadFromArray: () => ({ success: true }),
        getHierarchy: () => hierarchy,
      }),
      createModelMeshLoader: () => ({
        loadFromArray: () => ({ success: true }),
        getMesh: () => ({}),
      }),
      createModel: () => ({
        setHierarchy: () => {},
        setMesh: () => {},
        getHierarchy: () => hierarchy,
        getSoftSkinMeshes: () => ({
          size: () => 1,
          get: () => ({ mesh: { normals: {}, subMeshes: {} }, getPackedWeights4: () => ({}) }),
        }),
        getAttachmentNames: () => ({ size: () => 1, get: () => "BUG_PART" }),
        getAttachment: () => ({}),
        convertAttachmentToProcessedMesh: () => processed,
      }),
    };

    const parent = new THREE.Group();
    const instance = await createCreatureCharacterInstance({
      zenKit,
      caches: {
        binary: new Map(),
        textures: new Map(),
        materials: new Map(),
        animations: new Map(),
      } as any,
      parent,
      modelKey: "GIANT_BUG",
      meshKey: "GIANT_BUG_BODY",
    });

    expect(instance).toBeTruthy();
    expect(
      (instance!.object.getObjectByName("npc-character-model") as THREE.Group).children.length,
    ).toBe(2);
  });
});
