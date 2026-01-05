export {};

function makeVector<T>(items: T[]) {
  return {
    size: () => items.length,
    get: (i: number) => items[i],
  };
}

function quatEquivalent(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number },
  eps: number
) {
  const d1 = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z), Math.abs(a.w - b.w));
  const d2 = Math.max(Math.abs(a.x + b.x), Math.abs(a.y + b.y), Math.abs(a.z + b.z), Math.abs(a.w + b.w));
  return Math.min(d1, d2) <= eps;
}

describe("npc-world-indices", () => {
  let THREE: typeof import("three");
  let mod: typeof import("../npc-world-indices");

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("three", () => jest.requireActual("three"));
    THREE = await import("three");
    mod = await import("../npc-world-indices");
  });

  it("returns empty indices when world is null", () => {
    const r = mod.buildNpcWorldIndices(null);
    expect(r.waypointPosIndex.size).toBe(0);
    expect(r.waypointDirIndex.size).toBe(0);
    expect(r.vobPosIndex.size).toBe(0);
  });

  it("indexes waypoints, waypoint directions, and vob names", () => {
    const wpA = { name: " WP_A ", position: { x: 10, y: 20, z: 30 }, direction: { x: 0, y: 0, z: 0 } };
    const wpDir = { name: "WP_DIR", position: { x: 1, y: 2, z: 3 }, direction: { x: 1, y: 0, z: 0 } };
    const world = {
      getAllWaypoints: () => makeVector([wpA, wpDir]),
      getVobs: () =>
        makeVector([
          {
            name: "ROOT",
            vobName: "VOB_ROOT",
            objectName: "OBJ_ROOT",
            position: { x: 5, y: 0, z: 0 },
            children: makeVector([
              {
                name: "CHILD",
                vobName: "VOB_CHILD",
                objectName: "OBJ_CHILD",
                position: { x: 6, y: 1, z: 2 },
                children: makeVector([]),
              },
            ]),
          },
        ]),
    } as any;

    const r = mod.buildNpcWorldIndices(world);

    const posA = r.waypointPosIndex.get("WP_A")!;
    expect(posA.x).toBe(-10);
    expect(posA.y).toBe(20);
    expect(posA.z).toBe(30);

    expect(r.vobPosIndex.get("ROOT")?.x).toBe(-5);
    expect(r.vobPosIndex.get("VOB_ROOT")?.x).toBe(-5);
    expect(r.vobPosIndex.get("OBJ_ROOT")?.x).toBe(-5);
    expect(r.vobPosIndex.get("CHILD")?.x).toBe(-6);
    expect(r.vobPosIndex.get("VOB_CHILD")?.x).toBe(-6);
    expect(r.vobPosIndex.get("OBJ_CHILD")?.x).toBe(-6);

    const q = r.waypointDirIndex.get("WP_DIR")!;
    expect(q).toBeInstanceOf(THREE.Quaternion);

    const direction = new THREE.Vector3(-wpDir.direction.x, wpDir.direction.y, wpDir.direction.z);
    const up = new THREE.Vector3(0, 1, 0);
    const matrix = new THREE.Matrix4();
    matrix.lookAt(new THREE.Vector3(0, 0, 0), direction, up);
    const expected = new THREE.Quaternion().setFromRotationMatrix(matrix);
    const yRot = new THREE.Quaternion().setFromAxisAngle(up, Math.PI);
    expected.multiply(yRot);

    expect(quatEquivalent(q, expected, 1e-6)).toBe(true);
  });
});

