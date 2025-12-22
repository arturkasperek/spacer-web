describe("NPC vs VOB BVH collision", () => {
  let THREE: any;
  let MeshBVH: any;
  let createNpcWorldCollisionContext: typeof import("../npc-world-collision").createNpcWorldCollisionContext;
  let applyNpcVobBVHCollisionXZ: typeof import("../npc-world-collision").applyNpcVobBVHCollisionXZ;

  beforeAll(async () => {
    jest.resetModules();
    jest.unmock("three");
    jest.unmock("three-mesh-bvh");
    THREE = await import("three");
    ({ MeshBVH } = await import("three-mesh-bvh"));
    ({ createNpcWorldCollisionContext, applyNpcVobBVHCollisionXZ } = await import("../npc-world-collision"));
  });

  it("pushes the NPC out of a collidable mesh (planar)", () => {
    const ctx = createNpcWorldCollisionContext();
    const npc = new THREE.Group();
    npc.position.set(0, 0, 0);

    // A thin wall centered at x=0.5, spanning z.
    const wallGeo = new THREE.BoxGeometry(1, 200, 200);
    (wallGeo as any).boundsTree = new MeshBVH(wallGeo, { maxLeafTris: 3 });
    const wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial());
    wall.position.set(0.5, 100, 0);
    wall.updateWorldMatrix(true, false);

    const config = {
      radius: 35,
      scanHeight: 110,
      scanHeights: [50, 110, 170],
      stepHeight: 60,
      maxStepDown: 800,
      maxGroundAngleRad: Math.PI / 6,
      maxSlideAngleRad: Math.PI / 4,
      minWallNormalY: 0.4,
      enableWallSlide: true,
    };

    // Try to move into the wall.
    const r = applyNpcVobBVHCollisionXZ(ctx, npc, 2, 0, [wall], config);
    // With a large capsule radius (35), we should get pushed far enough to clear the wall.
    expect(r.collided).toBe(true);
    expect(r.x).toBeGreaterThan(30);
  });
});
