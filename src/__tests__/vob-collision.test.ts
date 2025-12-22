import { buildVobCollisionIndex, resolveNpcVobCollisionXZ } from "../vob-collision";

type MockVector3 = { x: number; y: number; z: number };
type MockBBox = { min: MockVector3; max: MockVector3 };
type MockVob = {
  id: number;
  vobName: string;
  type: number;
  cdStatic?: boolean;
  cdDynamic?: boolean;
  vobStatic?: boolean;
  physicsEnabled?: boolean;
  bbox?: MockBBox;
  children?: { size: () => number; get: (i: number) => MockVob };
};

function vec3(x: number, y: number, z: number): MockVector3 {
  return { x, y, z };
}

function bbox(min: MockVector3, max: MockVector3): MockBBox {
  return { min, max };
}

function vob(v: Partial<MockVob> & Pick<MockVob, "id" | "vobName" | "type">): MockVob {
  return {
    cdStatic: false,
    cdDynamic: false,
    vobStatic: true,
    physicsEnabled: false,
    children: {
      size: () => 0,
      get: () => {
        throw new Error("out of range");
      },
    },
    ...v,
  };
}

function vobCollection(items: MockVob[]) {
  return {
    size: () => items.length,
    get: (i: number) => items[i],
  };
}

function worldWithVobs(items: MockVob[]) {
  return {
    getVobs: () => vobCollection(items),
  } as any;
}

describe("vob-collision", () => {
  test("buildVobCollisionIndex keeps only cdStatic/cdDynamic vobs and mirrors X", () => {
    const a = vob({
      id: 1,
      vobName: "A",
      type: 0,
      cdStatic: true,
      bbox: bbox(vec3(10, 0, 0), vec3(20, 100, 10)),
    });
    const b = vob({
      id: 2,
      vobName: "B",
      type: 0,
      cdStatic: false,
      cdDynamic: false,
      bbox: bbox(vec3(-5, 0, -5), vec3(5, 50, 5)),
    });

    const idx = buildVobCollisionIndex(worldWithVobs([a, b]));
    expect(idx.aabbs).toHaveLength(1);
    expect(idx.aabbs[0].vobId).toBe(1);
    // Mirror: minX=-maxX, maxX=-minX
    expect(idx.aabbs[0].minX).toBe(-20);
    expect(idx.aabbs[0].maxX).toBe(-10);
  });

  test("resolveNpcVobCollisionXZ pushes out of expanded AABB in XZ", () => {
    const obstacle = vob({
      id: 10,
      vobName: "OB",
      type: 0,
      cdStatic: true,
      bbox: bbox(vec3(-10, 0, -10), vec3(10, 100, 10)),
    });

    const idx = buildVobCollisionIndex(worldWithVobs([obstacle]), { cellSize: 100 });
    const r = resolveNpcVobCollisionXZ(idx, { y: 0 }, { x: 0, z: 0 }, { radius: 1, scanHeight: 110 });
    expect(r.collided).toBe(true);
    // After mirroring X, obstacle is still symmetric, so we should end up outside the box in Z or X.
    expect(Math.abs(r.x) > 10 || Math.abs(r.z) > 10).toBe(true);
  });

  test("resolveNpcVobCollisionXZ ignores non-overlapping vertical range", () => {
    const obstacle = vob({
      id: 10,
      vobName: "OB",
      type: 0,
      cdStatic: true,
      bbox: bbox(vec3(-10, 0, -10), vec3(10, 100, 10)),
    });

    const idx = buildVobCollisionIndex(worldWithVobs([obstacle]), { cellSize: 100 });
    const r = resolveNpcVobCollisionXZ(idx, { y: 500 }, { x: 0, z: 0 }, { radius: 1, scanHeight: 110 });
    expect(r.collided).toBe(false);
    expect(r.x).toBe(0);
    expect(r.z).toBe(0);
  });
});

