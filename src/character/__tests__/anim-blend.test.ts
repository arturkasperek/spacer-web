import type * as Three from "three";
import { __blendAnimWorld } from "../character-instance";

const THREE = jest.requireActual("three") as typeof import("three");

function decompose(m: Three.Matrix4) {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, quat, scale);
  return { pos, quat, scale };
}

function makeTemps() {
  return {
    pos0: new THREE.Vector3(),
    pos1: new THREE.Vector3(),
    quat0: new THREE.Quaternion(),
    quat1: new THREE.Quaternion(),
    scale0: new THREE.Vector3(1, 1, 1),
    scale1: new THREE.Vector3(1, 1, 1),
  };
}

function makeOut(count: number) {
  const out: Three.Matrix4[] = [];
  for (let i = 0; i < count; i++) out.push(new THREE.Matrix4());
  return out;
}

describe("__blendAnimWorld", () => {
  it("blends translations linearly", () => {
    const prev = new THREE.Matrix4().makeTranslation(1, 2, 3);
    const curr = new THREE.Matrix4().makeTranslation(5, 2, 3);

    const out = __blendAnimWorld([prev], [curr], 0.5, makeOut(1), makeTemps());
    const { pos } = decompose(out[0]);

    expect(pos.x).toBeCloseTo(3, 5);
    expect(pos.y).toBeCloseTo(2, 5);
    expect(pos.z).toBeCloseTo(3, 5);
  });

  it("blends rotations with slerp", () => {
    const prev = new THREE.Matrix4().identity();
    const curr = new THREE.Matrix4().makeRotationY(Math.PI);

    const out = __blendAnimWorld([prev], [curr], 0.5, makeOut(1), makeTemps());
    const { quat } = decompose(out[0]);

    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    expect(v.x).toBeCloseTo(1, 4);
    expect(v.z).toBeCloseTo(0, 4);
  });

  it("blends scale linearly", () => {
    const prev = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 1),
    );
    const curr = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(2, 2, 2),
    );

    const out = __blendAnimWorld([prev], [curr], 0.25, makeOut(1), makeTemps());
    const { scale } = decompose(out[0]);

    expect(scale.x).toBeCloseTo(1.25, 5);
    expect(scale.y).toBeCloseTo(1.25, 5);
    expect(scale.z).toBeCloseTo(1.25, 5);
  });

  it("uses the minimum length of input arrays", () => {
    const prev = [new THREE.Matrix4().makeTranslation(1, 0, 0)];
    const curr = [
      new THREE.Matrix4().makeTranslation(3, 0, 0),
      new THREE.Matrix4().makeTranslation(9, 0, 0),
    ];

    const out = __blendAnimWorld(prev, curr, 0.5, makeOut(1), makeTemps());
    expect(out.length).toBe(1);
    const { pos } = decompose(out[0]);
    expect(pos.x).toBeCloseTo(2, 5);
  });
});
