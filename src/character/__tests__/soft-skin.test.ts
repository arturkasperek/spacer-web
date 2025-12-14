describe("buildSoftSkinMeshCPU", () => {
  it("builds geometry, groups, and skinning data from a minimal soft-skin mesh", async () => {
    jest.resetModules();
    jest.unmock("three");

    jest.doMock("../../mesh-utils", () => ({
      loadCompiledTexAsDataTexture: jest.fn(async () => ({ isMockTexture: true })),
    }));

    const THREE = require("three");
    const { buildSoftSkinMeshCPU } = require("../soft-skin");
    const { loadCompiledTexAsDataTexture } = require("../../mesh-utils");

    const makeVec = (x: number, y: number, z: number) => ({ x, y, z });
    const makeVec2 = (x: number, y: number) => ({ x, y });
    const makeVector = <T>(arr: T[]) => ({
      size: () => arr.length,
      get: (i: number) => arr[i],
    });

    const normals = makeVector([makeVec(0, 0, 1), makeVec(0, 0, 1), makeVec(0, 0, 1)]);
    const weights = {
      get: (vertIdx: number) =>
        makeVector([
          { nodeIndex: 0, weight: 1, position: makeVec(vertIdx, 0, 0) },
        ]),
    };

    const wedges = makeVector([
      { index: 0, texture: makeVec2(0, 0) },
      { index: 1, texture: makeVec2(1, 0) },
      { index: 2, texture: makeVec2(0, 1) },
    ]);

    const triangles = makeVector([
      {
        getWedge: (i: number) => i,
      },
    ]);

    const subMeshes = makeVector([
      {
        mat: { texture: "BODY_V0_C0.TGA" },
        triangles,
        wedges,
      },
    ]);

    const softSkinMesh = {
      mesh: {
        normals,
        subMeshes,
      },
      weights,
    };

    const textureCache = new Map<string, any>();
    const bindWorld = [new THREE.Matrix4().identity()];

    const { mesh, skinningData } = await buildSoftSkinMeshCPU({
      zenKit: {} as any,
      softSkinMesh,
      bindWorld,
      textureCache,
    });

    expect(mesh).toBeTruthy();
    expect(mesh.geometry.getAttribute("position").count).toBe(3);
    expect(mesh.geometry.groups).toHaveLength(1);
    expect(skinningData.vertexWeights).toHaveLength(3);
    expect(loadCompiledTexAsDataTexture).toHaveBeenCalled();
    expect(textureCache.size).toBe(1);
  });
});

