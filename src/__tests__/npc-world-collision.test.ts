describe("npc world collision", () => {
  let THREE: any;
  let applyNpcWorldCollisionXZ: typeof import("../npc-world-collision").applyNpcWorldCollisionXZ;
  let createNpcWorldCollisionContext: typeof import("../npc-world-collision").createNpcWorldCollisionContext;
  let updateNpcSlopeSlideXZ: typeof import("../npc-world-collision").updateNpcSlopeSlideXZ;
  let MeshBVH: any;

  beforeAll(async () => {
    jest.resetModules();
    jest.unmock("three");
    jest.unmock("three-mesh-bvh");
    THREE = await import("three");
    ({ MeshBVH } = await import("three-mesh-bvh"));
    ({ applyNpcWorldCollisionXZ, createNpcWorldCollisionContext, updateNpcSlopeSlideXZ } = await import("../npc-world-collision"));
  });

  it("blocks uphill moves when the predicted step is too high", () => {
    const ctx = createNpcWorldCollisionContext();
    const npc = new THREE.Group();
    npc.position.set(0, 0, 0);
    npc.userData.groundYTarget = 0;
    // 45° ramp rising with +X, so predictedY ~= desiredX.
    npc.userData.groundPlane = { nx: -0.70710678, ny: 0.70710678, nz: 0, px: 0, py: 0, pz: 0, clearance: 0 };

    const config = {
      radius: 30,
      scanHeight: 100,
      stepHeight: 60,
      maxGroundAngleRad: THREE.MathUtils.degToRad(60),
      maxSlideAngleRad: THREE.MathUtils.degToRad(80),
      minWallNormalY: 0.4,
      enableWallSlide: true,
    };

    const worldMesh = new THREE.Object3D();
    const r = applyNpcWorldCollisionXZ(ctx, npc, 100, 0, worldMesh, 0.016, config);
    expect(r.blocked).toBe(true);
    expect(r.moved).toBe(false);
    expect(npc.position.x).toBeCloseTo(0, 6);
  });

  it("keeps clearance from a wall (BVH capsule collision)", () => {
    const ctx = createNpcWorldCollisionContext();
    const npc = new THREE.Group();
    npc.position.set(-5, 0, 0);

    const wallGeo = new THREE.PlaneGeometry(100, 100);
    (wallGeo as any).boundsTree = new MeshBVH(wallGeo, { maxLeafTris: 3 });
    const wallMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.rotation.y = -Math.PI / 2; // normal ~ +X
    wall.position.set(0, 0, 0);
    wall.updateMatrixWorld(true);

    const config = {
      radius: 2,
      scanHeight: 1,
      stepHeight: 999,
      maxGroundAngleRad: THREE.MathUtils.degToRad(89),
      maxSlideAngleRad: THREE.MathUtils.degToRad(89),
      minWallNormalY: 0.4,
      enableWallSlide: false,
    };

    const r = applyNpcWorldCollisionXZ(ctx, npc, 5, 0, wall, 0.016, config);
    expect(r.moved).toBe(true);
    expect(npc.position.x).toBeCloseTo(-2, 3);
    expect(npc.position.x).toBeLessThanOrEqual(-1.9);
  });

  it("ignores non-collidable (noCollDet) materials like foliage", () => {
    const ctx = createNpcWorldCollisionContext();
    const npc = new THREE.Group();
    npc.position.set(-5, 0, 0);

    const wallGeo = new THREE.PlaneGeometry(100, 100);
    // Mark all wall triangles as materialId=0.
    const triCount = ((wallGeo.index?.count ?? 0) / 3) || 2;
    (wallGeo as any).userData = { materialIds: new Int32Array(Array(triCount).fill(0)) };
    (wallGeo as any).boundsTree = new MeshBVH(wallGeo, { maxLeafTris: 3 });

    const wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    wall.rotation.y = -Math.PI / 2; // normal ~ +X
    (wall as any).userData = { noCollDetByMaterialId: [true] };
    wall.updateMatrixWorld(true);

    const config = {
      radius: 2,
      scanHeight: 110,
      scanHeights: [50, 110, 170],
      stepHeight: 60,
      maxStepDown: 800,
      maxGroundAngleRad: THREE.MathUtils.degToRad(60),
      maxSlideAngleRad: THREE.MathUtils.degToRad(80),
      minWallNormalY: 0.4,
      enableWallSlide: true,
    };

    const r = applyNpcWorldCollisionXZ(ctx, npc, 5, 0, wall, 0.016, config);
    expect(r.moved).toBe(true);
    expect(npc.position.x).toBeGreaterThan(4.5);
  });

  it("detects head-level overhangs using BVH capsule collision", () => {
    const ctx = createNpcWorldCollisionContext();
    const npc = new THREE.Group();
    npc.position.set(-5, 0, 0);

    // A thin "overhang" slab at head height only.
    const slabGeo = new THREE.BoxGeometry(0.2, 60, 100);
    (slabGeo as any).boundsTree = new MeshBVH(slabGeo, { maxLeafTris: 3 });
    const slabMat = new THREE.MeshBasicMaterial();
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.set(0, 170, 0);
    slab.updateMatrixWorld(true);

    const config = {
      radius: 2,
      scanHeight: 110,
      scanHeights: [110, 170],
      stepHeight: 999,
      maxGroundAngleRad: THREE.MathUtils.degToRad(89),
      maxSlideAngleRad: THREE.MathUtils.degToRad(89),
      minWallNormalY: 0.4,
      enableWallSlide: false,
    };

    const r = applyNpcWorldCollisionXZ(ctx, npc, 5, 0, slab, 0.016, config);
    expect(r.blocked).toBe(true);
    expect(npc.position.x).toBeLessThan(0);
  });

  it("can move away from a wall even if starting slightly interpenetrating (depenetration)", () => {
    const ctx = createNpcWorldCollisionContext();
    const npc = new THREE.Group();
    npc.position.set(-1.9, 0, 0); // radius=2 => starts slightly inside the wall at x=0

    const wallGeo = new THREE.PlaneGeometry(100, 100);
    (wallGeo as any).boundsTree = new MeshBVH(wallGeo, { maxLeafTris: 3 });
    const wallMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.rotation.y = -Math.PI / 2; // normal ~ +X
    wall.updateMatrixWorld(true);

    const config = {
      radius: 2,
      scanHeight: 110,
      scanHeights: [50, 110],
      stepHeight: 60,
      maxStepDown: 800,
      maxGroundAngleRad: THREE.MathUtils.degToRad(60),
      maxSlideAngleRad: THREE.MathUtils.degToRad(80),
      minWallNormalY: 0.4,
      enableWallSlide: true,
    };

    const r = applyNpcWorldCollisionXZ(ctx, npc, -2.1, 0, wall, 0.016, config);
    expect(r.moved).toBe(true);
    expect(npc.position.x).toBeLessThan(-1.9);
  });

  it("can step over a low riser when there is walkable floor behind it (stairs)", () => {
    const ctx = createNpcWorldCollisionContext();
    const npc = new THREE.Group();
    npc.position.set(-10, 0, 0);
    npc.userData.groundYTarget = 0;
    npc.userData.groundPlane = { nx: 0, ny: 1, nz: 0, px: 0, py: 0, pz: 0, clearance: 0 };

    // A single "step" box: front face acts like a riser, top acts like the stair tread.
    const stepGeo = new THREE.BoxGeometry(200, 60, 100);
    stepGeo.translate(100, 30, 0); // bottom at y=0, front face at x=0
    (stepGeo as any).boundsTree = new MeshBVH(stepGeo, { maxLeafTris: 3 });
    const step = new THREE.Mesh(stepGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    step.updateMatrixWorld(true);

    const config = {
      radius: 2,
      scanHeight: 50,
      scanHeights: [50, 110],
      stepHeight: 60,
      maxStepDown: 800,
      maxGroundAngleRad: THREE.MathUtils.degToRad(45),
      maxSlideAngleRad: THREE.MathUtils.degToRad(65),
      minWallNormalY: 0.4,
      enableWallSlide: true,
    };

    const r = applyNpcWorldCollisionXZ(ctx, npc, 10, 0, step, 0.016, config);
    expect(r.moved).toBe(true);
    expect(npc.position.x).toBeGreaterThan(0);
  });

  it("slides down when standing on too-steep ground (ZenGin-like)", () => {
    const ctx = createNpcWorldCollisionContext();
    const npc = new THREE.Group();
    npc.position.set(0, 0, 0);
    npc.userData.groundYTarget = 0;
    // 60° slope rising with +X => downhill is -X
    npc.userData.groundPlane = { nx: -0.8660254, ny: 0.5, nz: 0, px: 0, py: 0, pz: 0, clearance: 0 };

    const config = {
      radius: 30,
      scanHeight: 110,
      scanHeights: [50, 110, 170],
      stepHeight: 60,
      maxStepDown: 800,
      maxGroundAngleRad: THREE.MathUtils.degToRad(45),
      maxSlideAngleRad: THREE.MathUtils.degToRad(70),
      minWallNormalY: 0.4,
      enableWallSlide: true,
      slideGravity: 981,
      slideFriction: 1.0,
      maxSlideSpeed: 1200,
    };

    const worldMesh = new THREE.Object3D();
    const r = updateNpcSlopeSlideXZ(ctx, npc, worldMesh, 0.05, config);
    expect(r.active).toBe(true);
    expect(r.moved).toBe(true);
    expect(npc.position.x).toBeLessThan(-0.2);
  });

  it("chooses slideBack animation when facing uphill", () => {
    const ctx = createNpcWorldCollisionContext();
    const npc = new THREE.Group();
    npc.position.set(0, 0, 0);
    npc.userData.groundYTarget = 0;
    npc.userData.groundPlane = { nx: -0.8660254, ny: 0.5, nz: 0, px: 0, py: 0, pz: 0, clearance: 0 };
    // Face +X (uphill). Local +Z is forward, yaw=+90° makes forward align +X.
    npc.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

    const config = {
      radius: 30,
      scanHeight: 110,
      stepHeight: 60,
      maxGroundAngleRad: THREE.MathUtils.degToRad(45),
      maxSlideAngleRad: THREE.MathUtils.degToRad(70),
      minWallNormalY: 0.4,
      enableWallSlide: true,
    };

    const worldMesh = new THREE.Object3D();
    const r = updateNpcSlopeSlideXZ(ctx, npc, worldMesh, 0.05, config);
    expect(r.active).toBe(true);
    expect(r.mode).toBe("slideBack");
  });

});
