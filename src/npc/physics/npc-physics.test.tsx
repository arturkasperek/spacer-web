import { render } from "@testing-library/react";
import { useRapier } from "@react-three/rapier";
import * as THREE from "three";
import { NPC_RENDER_TUNING, useNpcPhysics } from "./npc-physics";

jest.mock("three", () => jest.requireActual("three"));

jest.mock("three/examples/jsm/lines/Line2.js", () => ({
  Line2: class {
    geometry: any;
    material: any;
    frustumCulled = false;
    visible = false;
    renderOrder = 0;
    constructor(geometry: any, material: any) {
      this.geometry = geometry;
      this.material = material;
    }
    computeLineDistances() {}
  },
}));

jest.mock("three/examples/jsm/lines/LineGeometry.js", () => ({
  LineGeometry: class {
    setPositions() {}
  },
}));

jest.mock("three/examples/jsm/lines/LineMaterial.js", () => ({
  LineMaterial: class {
    color = { setHex: () => {} };
    linewidth = 1;
    resolution = { set: () => {} };
    constructor(_opts: any) {}
  },
}));

describe("npc-physics / useNpcPhysics", () => {
  const useRapierMock = useRapier as unknown as jest.Mock;

  function createRapierMocks(opts?: {
    intersectionsWithRayImpl?: (cb: (hit: any) => boolean) => void;
  }) {
    const colliders = new Map<number, any>();
    let nextHandle = 1;
    const controller = {
      setSlideEnabled: jest.fn(),
      setMaxSlopeClimbAngle: jest.fn(),
      setMinSlopeSlideAngle: jest.fn(),
      enableAutostep: jest.fn(),
      enableSnapToGround: jest.fn(),
      setApplyImpulsesToDynamicBodies: jest.fn(),
      setCharacterMass: jest.fn(),
    };
    const world = {
      createCharacterController: jest.fn(() => controller),
      removeCharacterController: jest.fn(),
      getCollider: jest.fn((handle: number) => colliders.get(handle)),
      createCollider: jest.fn((_desc: any) => {
        const collider = {
          handle: nextHandle++,
          setTranslation: jest.fn(),
        };
        colliders.set(collider.handle, collider);
        return collider;
      }),
      removeCollider: jest.fn((collider: any) => {
        colliders.delete(collider.handle);
      }),
      intersectionsWithRay: jest.fn(
        (
          _ray: any,
          _maxToi: number,
          _solid: boolean,
          callback: (hit: any) => boolean,
          _filterFlags: number,
          _filterGroups: number,
          _exclude: any,
        ) => {
          opts?.intersectionsWithRayImpl?.(callback);
        },
      ),
    };
    const rapier = {
      ColliderDesc: {
        capsule: jest.fn((_halfHeight: number, _radius: number) => ({
          setCollisionGroups: jest.fn(),
        })),
      },
      QueryFilterFlags: {
        EXCLUDE_SENSORS: 1,
      },
      Ray: class {
        origin: any;
        dir: any;
        constructor(origin: any, dir: any) {
          this.origin = origin;
          this.dir = dir;
        }
        pointAt(toi: number) {
          return {
            x: this.origin.x + this.dir.x * toi,
            y: this.origin.y + this.dir.y * toi,
            z: this.origin.z + this.dir.z * toi,
          };
        }
      },
    };

    return { world, rapier };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    useRapierMock.mockReturnValue({ world: null, rapier: null });
  });

  function mountHook(overrides?: Partial<Parameters<typeof useNpcPhysics>[0]>) {
    const loadedNpcsRef = { current: new Map<string, THREE.Group>() } as any;
    const physicsFrameRef = { current: 11 } as any;
    const playerGroupRef = { current: null } as any;
    let api: ReturnType<typeof useNpcPhysics> | undefined;

    function Probe() {
      api = useNpcPhysics({
        loadedNpcsRef,
        physicsFrameRef,
        playerGroupRef,
        ...(overrides || {}),
      });
      return null;
    }

    render(<Probe />);
    return { api: api!, loadedNpcsRef };
  }

  it("exposes expected API and tuning config", () => {
    const { api } = mountHook();
    expect(typeof api.getNpcVisualRoot).toBe("function");
    expect(typeof api.applyMoveConstraint).toBe("function");
    expect(typeof api.trySnapNpcToGroundWithRapier).toBe("function");
    expect(typeof api.removeNpcKccCollider).toBe("function");
    expect(api.kccConfig.radius).toBe(NPC_RENDER_TUNING.radius);
    expect(api.kccConfig.capsuleHeight).toBe(NPC_RENDER_TUNING.capsuleHeight);
  });

  it("applyMoveConstraint fallback moves NPC and stores frame id when Rapier is unavailable", () => {
    const { api } = mountHook();
    const npc = new THREE.Group();
    npc.position.set(0, 0, 0);
    npc.userData = {};

    const r = api.applyMoveConstraint(npc, 25, -10, 0.016);
    expect(r.blocked).toBe(false);
    expect(r.moved).toBe(true);
    expect(npc.position.x).toBe(25);
    expect(npc.position.z).toBe(-10);
    expect((npc.userData as any)._kccLastFrame).toBe(11);
  });

  it("applyMoveConstraint reports no movement when desired position is unchanged", () => {
    const { api } = mountHook();
    const npc = new THREE.Group();
    npc.position.set(5, 0, 7);
    npc.userData = {};

    const r = api.applyMoveConstraint(npc, 5, 7, 0.016);
    expect(r.blocked).toBe(false);
    expect(r.moved).toBe(false);
    expect((npc.userData as any)._kccLastFrame).toBe(11);
  });

  it("applyMoveConstraint marks blocked when another loaded NPC blocks desired move", () => {
    const loadedNpcsRef = { current: new Map<string, any>() } as any;
    const { api } = mountHook({ loadedNpcsRef });

    const self = new THREE.Group();
    self.position.set(0, 0, 0);
    self.userData = { npcData: { instanceIndex: 1 } };
    const other = new THREE.Group();
    other.position.set(20, 0, 0);
    other.userData = { npcData: { instanceIndex: 2 }, isDisposed: false };
    loadedNpcsRef.current.set("self", self);
    loadedNpcsRef.current.set("other", other);

    const r = api.applyMoveConstraint(self, 20, 0, 0);
    expect(r.blocked).toBe(true);
    expect((self.userData as any)._npcNpcBlocked).toBe(true);
  });

  it("applyMoveConstraint ignores disposed NPC colliders", () => {
    const loadedNpcsRef = { current: new Map<string, any>() } as any;
    const { api } = mountHook({ loadedNpcsRef });

    const self = new THREE.Group();
    self.position.set(0, 0, 0);
    self.userData = {};
    const disposed = new THREE.Group();
    disposed.position.set(20, 0, 0);
    disposed.userData = { isDisposed: true };
    loadedNpcsRef.current.set("self", self);
    loadedNpcsRef.current.set("disposed", disposed);

    const r = api.applyMoveConstraint(self, 20, 0, 0.016);
    expect(r.blocked).toBe(false);
    expect(r.moved).toBe(true);
    expect(self.position.x).toBe(20);
    expect((self.userData as any)._npcNpcBlocked).toBe(false);
  });

  it("applyMoveConstraint ignores NPC colliders with too large Y delta", () => {
    const loadedNpcsRef = { current: new Map<string, any>() } as any;
    const { api } = mountHook({ loadedNpcsRef });

    const self = new THREE.Group();
    self.position.set(0, 0, 0);
    self.userData = {};
    const above = new THREE.Group();
    above.position.set(20, 300, 0);
    above.userData = { isDisposed: false };
    loadedNpcsRef.current.set("self", self);
    loadedNpcsRef.current.set("above", above);

    const r = api.applyMoveConstraint(self, 20, 0, 0.016);
    expect(r.blocked).toBe(false);
    expect(r.moved).toBe(true);
    expect(self.position.x).toBe(20);
    expect((self.userData as any)._npcNpcBlocked).toBe(false);
  });

  it("getNpcVisualRoot returns explicit visualRoot from userData when available", () => {
    const { api } = mountHook();
    const npc = new THREE.Group();
    const visualRoot = new THREE.Object3D();
    npc.userData = { visualRoot };

    expect(api.getNpcVisualRoot(npc)).toBe(visualRoot);
  });

  it("getNpcVisualRoot finds named child when userData.visualRoot is missing", () => {
    const { api } = mountHook();
    const npc = new THREE.Group();
    npc.userData = {};
    const namedRoot = new THREE.Group();
    namedRoot.name = "npc-visual-root";
    npc.add(namedRoot);

    expect(api.getNpcVisualRoot(npc)).toBe(namedRoot);
  });

  it("getNpcVisualRoot falls back to npc group when no visual root exists", () => {
    const { api } = mountHook();
    const npc = new THREE.Group();
    npc.userData = {};

    expect(api.getNpcVisualRoot(npc)).toBe(npc);
  });

  it("trySnapNpcToGroundWithRapier returns false when Rapier world is unavailable", () => {
    const { api } = mountHook();
    const npc = new THREE.Group();
    npc.userData = {};
    expect(api.trySnapNpcToGroundWithRapier(npc)).toBe(false);
  });

  it("trySnapNpcToGroundWithRapier returns true immediately when NPC is already snapped", () => {
    const { world, rapier } = createRapierMocks();
    useRapierMock.mockReturnValue({ world, rapier });
    const { api } = mountHook();
    const npc = new THREE.Group();
    npc.userData = { _kccSnapped: true };

    expect(api.trySnapNpcToGroundWithRapier(npc)).toBe(true);
    expect(world.createCollider).not.toHaveBeenCalled();
    expect(world.intersectionsWithRay).not.toHaveBeenCalled();
  });

  it("trySnapNpcToGroundWithRapier returns false when raycasts find no valid ground", () => {
    const { world, rapier } = createRapierMocks({
      intersectionsWithRayImpl: () => {
        // No callback invocation means no hits.
      },
    });
    useRapierMock.mockReturnValue({ world, rapier });
    const { api } = mountHook();
    const npc = new THREE.Group();
    npc.position.set(1, 2, 3);
    npc.userData = {};

    expect(api.trySnapNpcToGroundWithRapier(npc)).toBe(false);
    expect(world.intersectionsWithRay).toHaveBeenCalled();
  });

  it("removeNpcKccCollider is a safe no-op when Rapier world is unavailable", () => {
    const { api } = mountHook();
    const npc = new THREE.Group();
    npc.userData = { _kccColliderHandle: 123 };
    expect(() => api.removeNpcKccCollider(npc)).not.toThrow();
    expect((npc.userData as any)._kccColliderHandle).toBe(123);
  });

  it("removeNpcKccCollider removes existing Rapier collider and clears handle", () => {
    const { world, rapier } = createRapierMocks();
    useRapierMock.mockReturnValue({ world, rapier });
    const { api } = mountHook();

    const collider = world.createCollider({});
    const npc = new THREE.Group();
    npc.userData = { _kccColliderHandle: collider.handle };

    api.removeNpcKccCollider(npc);
    expect(world.removeCollider).toHaveBeenCalledWith(collider, true);
    expect((npc.userData as any)._kccColliderHandle).toBeUndefined();
  });
});
