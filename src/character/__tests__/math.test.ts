describe("character math (skeleton, animation, cpu skinning)", () => {
  it("buildSkeletonFromHierarchy creates bones, parents, and applies root translation", () => {
    jest.resetModules();
    jest.unmock("three");

    const { buildSkeletonFromHierarchy } = require("../skeleton");

    const identity = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];

    const hierarchy = {
      rootTranslation: { x: 1, y: 2, z: 3 },
      nodes: {
        size: () => 2,
        get: (i: number) => ({
          parentIndex: i === 0 ? -1 : 0,
          name: i === 0 ? "BIP01 PELVIS" : "BIP01 HEAD",
          getTransform: () => ({
            get: (idx: number) => identity[idx],
          }),
        }),
      },
    };

    const skel = buildSkeletonFromHierarchy(hierarchy);
    expect(skel.rootNodes).toEqual([0]);
    expect(skel.bones).toHaveLength(2);
    expect(skel.bones[0].children).toHaveLength(1);
    expect(skel.bones[0].children[0]).toBe(skel.bones[1]);

    // Root translation is applied to the root bone.
    expect(skel.bones[0].position.x).toBeCloseTo(1);
    expect(skel.bones[0].position.y).toBeCloseTo(2);
    expect(skel.bones[0].position.z).toBeCloseTo(3);
  });

  it("evaluatePose interpolates translation and updates skeleton.animWorld", () => {
    jest.resetModules();
    jest.unmock("three");

    const THREE = require("three");
    const { evaluatePose } = require("../animation");

    const skeleton = {
      nodes: [{ parent: -1 }],
      bindLocal: [new THREE.Matrix4().identity()],
      animWorld: [new THREE.Matrix4().identity()],
    };

    const seq = {
      name: "test",
      nodeIndex: [0],
      numFrames: 2,
      fpsRate: 1,
      totalTimeMs: 2000,
      samples: [
        { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        { position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      ],
    };

    const ok = evaluatePose(skeleton, seq, 500, true);
    expect(ok).toBe(true);
    expect(skeleton.animWorld).toHaveLength(1);
    expect(skeleton.animWorld[0].elements[12]).toBeCloseTo(5);

    // Negative time should still yield a valid pose when looping.
    const ok2 = evaluatePose(skeleton, seq, -500, true);
    expect(ok2).toBe(true);
    expect(skeleton.animWorld[0].elements[12]).toBeCloseTo(5);
  });

  it("evaluatePose can extract root motion and zero out root translation", () => {
    jest.resetModules();
    jest.unmock("three");

    const THREE = require("three");
    const { evaluatePose } = require("../animation");

    const skeleton = {
      nodes: [{ parent: -1 }],
      bindLocal: [new THREE.Matrix4().identity()],
      animWorld: [new THREE.Matrix4().identity()],
      rootNodes: [0],
    };

    const seq = {
      name: "test",
      nodeIndex: [0],
      numFrames: 2,
      fpsRate: 1,
      totalTimeMs: 2000,
      samples: [
        { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        { position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      ],
    };

    const outRoot = new THREE.Vector3();
    const ok = evaluatePose(skeleton, seq, 500, true, { extractRootMotion: true, outRootMotionPos: outRoot });
    expect(ok).toBe(true);
    expect(outRoot.x).toBeCloseTo(5);
    expect(outRoot.y).toBeCloseTo(0);
    expect(outRoot.z).toBeCloseTo(0);
    expect(skeleton.animWorld[0].elements[12]).toBeCloseTo(0);
  });

  it("evaluatePose preserves bind root translation when extracting root motion", () => {
    jest.resetModules();
    jest.unmock("three");

    const THREE = require("three");
    const { evaluatePose } = require("../animation");

    const skeleton = {
      nodes: [{ parent: -1 }],
      bindLocal: [new THREE.Matrix4().makeTranslation(0, 80, 0)],
      animWorld: [new THREE.Matrix4().identity()],
      rootNodes: [0],
    };

    const seq = {
      name: "test",
      nodeIndex: [0],
      numFrames: 2,
      fpsRate: 1,
      totalTimeMs: 2000,
      samples: [
        { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        { position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      ],
    };

    const outRoot = new THREE.Vector3();
    const ok = evaluatePose(skeleton, seq, 500, true, { extractRootMotion: true, outRootMotionPos: outRoot });
    expect(ok).toBe(true);
    expect(outRoot.x).toBeCloseTo(5);
    expect(skeleton.animWorld[0].elements[13]).toBeCloseTo(80);
  });

  it("applyCpuSkinning writes base data when no weights and transforms when weights exist", () => {
    jest.resetModules();
    jest.unmock("three");

    const THREE = require("three");
    const { applyCpuSkinning } = require("../cpu-skinning");

    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3);
    const normAttr = new THREE.BufferAttribute(new Float32Array([0, 0, 1]), 3);
    geometry.setAttribute("position", posAttr);
    geometry.setAttribute("normal", normAttr);

    const basePositions = new Float32Array([1, 2, 3]);
    const baseNormals = new Float32Array([0, 0, 1]);

    // No weights -> base values
    applyCpuSkinning([new THREE.Matrix4().identity()], {
      geometry,
      skinIndex: new Uint16Array(4),
      skinWeight: new Float32Array(4),
      infPos: new Float32Array(12),
      infNorm: new Float32Array(12),
      basePositions,
      baseNormals,
    });
    expect((geometry.getAttribute("position") as any).getX(0)).toBeCloseTo(1);
    expect((geometry.getAttribute("position") as any).getY(0)).toBeCloseTo(2);
    expect((geometry.getAttribute("position") as any).getZ(0)).toBeCloseTo(3);

    // With weights -> transformed
    const animWorld = [new THREE.Matrix4().makeTranslation(10, 0, 0)];
    applyCpuSkinning(animWorld, {
      geometry,
      skinIndex: new Uint16Array([0, 0, 0, 0]),
      skinWeight: new Float32Array([1, 0, 0, 0]),
      infPos: new Float32Array([1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      infNorm: new Float32Array([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      basePositions,
      baseNormals,
    });
    expect((geometry.getAttribute("position") as any).getX(0)).toBeCloseTo(11);
    expect((geometry.getAttribute("position") as any).getY(0)).toBeCloseTo(2);
    expect((geometry.getAttribute("position") as any).getZ(0)).toBeCloseTo(3);
  });
});
