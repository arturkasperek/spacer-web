type ThreeNS = typeof import("three");

describe("ground-snap", () => {
  let THREE: ThreeNS;
  let mod: typeof import("../ground-snap");

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("three", () => jest.requireActual("three"));
    THREE = await import("three");
    mod = await import("../ground-snap");
  });

  const createGroundPlane = (y: number) => {
    const geom = new THREE.PlaneGeometry(1000, 1000);
    // Match app behavior: world mesh materials are effectively double-sided for ray tests.
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const ground = new THREE.Mesh(geom, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = y;
    ground.updateMatrixWorld(true);
    return ground;
  };

  it("snaps object origin to ground hit + clearance", () => {
    const scene = new THREE.Scene();
    const worldMesh = new THREE.Group();
    worldMesh.name = mod.WORLD_MESH_NAME;
    worldMesh.add(createGroundPlane(10));
    scene.add(worldMesh);

    const obj = new THREE.Group();
    obj.position.set(0, 100, 0);
    scene.add(obj);

    const ok = mod.setObjectOriginOnFloorInScene(obj, scene, { clearance: 4, rayStartAbove: 50, maxDownDistance: 5000 });
    expect(ok).toBe(true);
    expect(obj.position.y).toBeCloseTo(14, 5);
  });

  it("can ignore downward-facing hits (ceilings) using minHitNormalY", () => {
    const scene = new THREE.Scene();
    const worldMesh = new THREE.Group();
    worldMesh.name = mod.WORLD_MESH_NAME;

    // Floor (normal up)
    worldMesh.add(createGroundPlane(10));

    // Ceiling (normal down), placed above the floor
    const ceiling = createGroundPlane(30);
    ceiling.rotation.x = Math.PI / 2; // flip to face downward
    ceiling.updateMatrixWorld(true);
    worldMesh.add(ceiling);
    scene.add(worldMesh);

    const obj = new THREE.Group();
    obj.position.set(0, 20, 0);
    scene.add(obj);

    const ground = worldMesh;

    const yNoFilter = mod.getGroundHitY(new THREE.Vector3(0, 20, 0), ground!, { clearance: 4, rayStartAbove: 50, maxDownDistance: 5000 });
    expect(yNoFilter).toBeCloseTo(34, 5); // hits ceiling first

    const yPreferred = mod.getGroundHitY(new THREE.Vector3(0, 20, 0), ground!, {
      clearance: 4,
      rayStartAbove: 50,
      maxDownDistance: 5000,
      preferClosestToY: 20,
    });
    expect(yPreferred).toBeCloseTo(14, 5); // prefers the floor (closest to current height)

    const yFiltered = mod.getGroundHitY(new THREE.Vector3(0, 20, 0), ground!, {
      clearance: 4,
      rayStartAbove: 50,
      maxDownDistance: 5000,
      minHitNormalY: 0.2,
    });
    expect(yFiltered).toBeCloseTo(14, 5); // uses floor
  });

  it("treats normals correctly for mirrored world meshes (negative determinant)", () => {
    const scene = new THREE.Scene();
    const worldMesh = new THREE.Group();
    worldMesh.name = mod.WORLD_MESH_NAME;

    const ground = createGroundPlane(10);
    // Mirror the ground like the app does for WORLD_MESH (scale.x = -1).
    ground.scale.x = -1;
    ground.updateMatrixWorld(true);
    worldMesh.add(ground);
    scene.add(worldMesh);

    const y = mod.getGroundHitY(new THREE.Vector3(0, 20, 0), worldMesh, {
      clearance: 4,
      rayStartAbove: 50,
      maxDownDistance: 5000,
      minHitNormalY: 0.2,
    });
    expect(y).toBeCloseTo(14, 5);
  });

  it("snaps object so its bbox bottom is on ground + clearance", () => {
    const scene = new THREE.Scene();
    const worldMesh = new THREE.Group();
    worldMesh.name = mod.WORLD_MESH_NAME;
    worldMesh.add(createGroundPlane(10));
    scene.add(worldMesh);

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 1), new THREE.MeshBasicMaterial());
    mesh.position.set(0, 100, 0);
    scene.add(mesh);

    const ok = mod.setObjectOnFloorInScene(mesh, scene, { clearance: 4, rayStartAbove: 50, maxDownDistance: 5000 });
    expect(ok).toBe(true);

    // BoxGeometry is centered, so bbox min.y = position.y - 5. After snapping, bbox min.y should be 10 + 4.
    expect(mesh.position.y).toBeCloseTo(19, 5);
  });

  it("handles parented objects by applying a local-space delta", () => {
    const scene = new THREE.Scene();
    const worldMesh = new THREE.Group();
    worldMesh.name = mod.WORLD_MESH_NAME;
    worldMesh.add(createGroundPlane(10));
    scene.add(worldMesh);

    const parent = new THREE.Group();
    parent.position.set(0, 200, 0);
    scene.add(parent);

    const child = new THREE.Group();
    child.position.set(0, 100, 0); // world y = 300
    parent.add(child);

    const ok = mod.setObjectOriginOnFloorInScene(child, scene, { clearance: 4, rayStartAbove: 50, maxDownDistance: 5000 });
    expect(ok).toBe(true);

    // Desired world y = 10 + 4 = 14, so local y should become 14 - 200 = -186.
    expect(child.position.y).toBeCloseTo(-186, 5);
  });
});
