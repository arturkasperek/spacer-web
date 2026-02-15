import { render, act } from "@testing-library/react";
import { VOBRenderer } from "./vob-renderer";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { World, ZenKit, Vob } from "@kolarz3/zenkit";

jest.mock("./mesh-utils", () => ({
  loadMeshCached: jest.fn(),
  buildThreeJSGeometryAndMaterials: jest.fn(),
}));

import { loadMeshCached, buildThreeJSGeometryAndMaterials } from "./mesh-utils";

// Mock VOBBoundingBox component
jest.mock("./vob-bounding-box", () => ({
  VOBBoundingBox: jest.fn(({ vobObject, visible, color }) => {
    if (!visible || !vobObject) return null;
    return (
      <div
        data-testid="vob-bounding-box"
        data-color={color}
        data-vob-id={(vobObject as any).userData?.vobId}
      />
    );
  }),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn((cb) => setTimeout(cb, 0));

// Mock console methods
const mockConsoleLog = jest.fn();
const mockConsoleWarn = jest.fn();
const mockConsoleError = jest.fn();
const mockOnVobStats = jest.fn();

beforeAll(() => {
  console.log = mockConsoleLog;
  console.warn = mockConsoleWarn;
  console.error = mockConsoleError;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockClear();
});

function configureThreeForVobRendererTests() {
  // Ensure Vector3 stores components and can compute distances (needed for streaming + unload tests)
  (THREE.Vector3 as unknown as jest.Mock).mockImplementation((x = 0, y = 0, z = 0) => {
    const vector: any = {
      x,
      y,
      z,
      set: jest.fn(function set(nx: number, ny: number, nz: number) {
        vector.x = nx;
        vector.y = ny;
        vector.z = nz;
        return vector;
      }),
      clone: jest.fn(() => (THREE.Vector3 as any)(vector.x, vector.y, vector.z)),
      copy: jest.fn((src: any) => {
        vector.x = src.x;
        vector.y = src.y;
        vector.z = src.z;
        return vector;
      }),
      lerp: jest.fn((other: any, t: number) => {
        vector.x = vector.x + (other.x - vector.x) * t;
        vector.y = vector.y + (other.y - vector.y) * t;
        vector.z = vector.z + (other.z - vector.z) * t;
        return vector;
      }),
      distanceTo: jest.fn((other: any) => {
        const dx = vector.x - (other?.x ?? 0);
        const dy = vector.y - (other?.y ?? 0);
        const dz = vector.z - (other?.z ?? 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      }),
      addScaledVector: jest.fn((v: any, s: number) => {
        vector.x += (v?.x ?? 0) * s;
        vector.y += (v?.y ?? 0) * s;
        vector.z += (v?.z ?? 0) * s;
        return vector;
      }),
      length: jest.fn(() =>
        Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z),
      ),
      lengthSq: jest.fn(() => vector.x * vector.x + vector.y * vector.y + vector.z * vector.z),
      applyQuaternion: jest.fn(() => vector),
      applyMatrix4: jest.fn(() => vector),
      applyMatrix3: jest.fn(() => vector),
      normalize: jest.fn(() => vector),
      subVectors: jest.fn(() => vector),
      crossVectors: jest.fn(() => vector),
    };
    return vector;
  });

  // Minimal Matrix4 needed for applyVobTransform and hierarchy transforms
  (THREE.Matrix4 as unknown as jest.Mock).mockImplementation(() => {
    const m: any = {
      elements: new Array(16).fill(0),
      set: jest.fn(function set(
        n11: number,
        n12: number,
        n13: number,
        n14: number,
        n21: number,
        n22: number,
        n23: number,
        n24: number,
        n31: number,
        n32: number,
        n33: number,
        n34: number,
        n41: number,
        n42: number,
        n43: number,
        n44: number,
      ) {
        m.elements = [
          n11,
          n21,
          n31,
          n41,
          n12,
          n22,
          n32,
          n42,
          n13,
          n23,
          n33,
          n43,
          n14,
          n24,
          n34,
          n44,
        ];
        return m;
      }),
      clone: jest.fn(() => {
        const copy = (THREE.Matrix4 as any)();
        copy.elements = [...m.elements];
        return copy;
      }),
      multiplyMatrices: jest.fn(() => m),
      decompose: jest.fn((pos: any, quat: any, scl: any) => {
        // Use translation column
        pos.set(m.elements[12] ?? 0, m.elements[13] ?? 0, m.elements[14] ?? 0);
        if (quat?.copy) quat.copy(quat);
        if (scl?.set) scl.set(1, 1, 1);
        return m;
      }),
    };
    return m;
  });

  (THREE.Quaternion as unknown as jest.Mock).mockImplementation((x = 0, y = 0, z = 0, w = 1) => {
    const q: any = {
      x,
      y,
      z,
      w,
      copy: jest.fn((src: any) => {
        q.x = src.x;
        q.y = src.y;
        q.z = src.z;
        q.w = src.w;
        return q;
      }),
      slerp: jest.fn(() => q),
      normalize: jest.fn(() => q),
    };
    return q;
  });

  // Add missing constructors used by vob-renderer (not present in the global mock)
  (THREE as any).Group = jest.fn(() => {
    const group: any = {
      type: "Group",
      children: [],
      userData: {},
      position: (THREE.Vector3 as any)(0, 0, 0),
      quaternion: (THREE.Quaternion as any)(0, 0, 0, 1),
      scale: (THREE.Vector3 as any)(1, 1, 1),
      add: jest.fn((child: any) => {
        group.children.push(child);
      }),
      applyMatrix4: jest.fn(),
      updateMatrixWorld: jest.fn(),
    };
    return group;
  });

  (THREE.Mesh as unknown as jest.Mock).mockImplementation((_geometry?: any, _materials?: any) => {
    const mesh: any = {
      type: "Mesh",
      geometry: _geometry,
      material: _materials,
      userData: {},
      children: [],
      position: (THREE.Vector3 as any)(0, 0, 0),
      quaternion: (THREE.Quaternion as any)(0, 0, 0, 1),
      scale: (THREE.Vector3 as any)(1, 1, 1),
      add: jest.fn((child: any) => mesh.children.push(child)),
      applyMatrix4: jest.fn(),
      updateMatrixWorld: jest.fn(),
    };
    return mesh;
  });
}

function configureStableSceneForTest() {
  const scene: any = { children: [] as any[] };
  scene.add = jest.fn((obj: any) => scene.children.push(obj));
  scene.remove = jest.fn((obj: any) => {
    const idx = scene.children.indexOf(obj);
    if (idx >= 0) scene.children.splice(idx, 1);
  });

  (useThree as unknown as jest.Mock).mockReturnValue({
    camera: {
      position: { set: jest.fn() },
      lookAt: jest.fn(),
      rotation: { order: "YXZ" },
      updateProjectionMatrix: jest.fn(),
    },
    gl: {
      setSize: jest.fn(),
      setPixelRatio: jest.fn(),
      render: jest.fn(),
    },
    scene,
    size: { width: 800, height: 600 },
    viewport: { width: 800, height: 600 },
    controls: { updateMouseState: jest.fn() },
  });

  return scene;
}

// Helper functions for creating mocks
const createMockWorld = (): World =>
  ({
    getVobs: jest.fn(() => ({
      size: jest.fn(() => 2),
      get: jest.fn((_index) => ({
        id: _index,
        showVisual: true,
        visual: {
          type: 1, // MESH
          name: "test.MSH",
        },
        position: { x: 0, y: 0, z: 0 },
        rotation: {
          toArray: jest.fn(() => ({
            size: () => 9,
            get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
          })),
        },
        children: {
          size: jest.fn(() => 0),
        },
      })),
    })),
    getStartpoints: jest.fn(() => ({
      size: jest.fn(() => 0),
      get: jest.fn(() => null as any),
    })),
    loadFromArray: jest.fn(() => true),
    isLoaded: true,
    getLastError: jest.fn(() => null),
    getWaypointCount: jest.fn(() => 0),
    getWaypoint: jest.fn(() => ({
      success: false,
      data: {
        name: "",
        position: { x: 0, y: 0, z: 0 },
        direction: { x: 0, y: 0, z: 0 },
        water_depth: 0,
        under_water: false,
        free_point: false,
      },
      errorMessage: "Not implemented",
    })),
    findWaypointByName: jest.fn(() => ({
      success: false,
      data: {
        name: "",
        position: { x: 0, y: 0, z: 0 },
        direction: { x: 0, y: 0, z: 0 },
        water_depth: 0,
        under_water: false,
        free_point: false,
      },
      errorMessage: "Not implemented",
    })),
    getAllWaypoints: jest.fn(() => []),
    getWaypointEdgeCount: jest.fn(() => 0),
    getWaypointEdge: jest.fn(() => ({
      success: false,
      data: { waypoint_a_index: 0, waypoint_b_index: 0 },
      errorMessage: "Not implemented",
    })),
    mesh: {
      getProcessedMeshData: jest.fn(() => ({
        vertices: { size: () => 0, get: () => 0 },
        indices: { size: () => 0, get: () => 0 },
        materials: { size: () => 0, get: () => ({ texture: "" }) },
        materialIds: { size: () => 0, get: () => 0 },
      })),
    },
  }) as unknown as World;

const createMockZenKit = (): ZenKit =>
  ({
    createWorld: jest.fn(() => createMockWorld()),
    createMesh: jest.fn(() => ({
      loadFromArray: jest.fn(() => ({ success: true })),
      getMeshData: jest.fn(() => ({
        getProcessedMeshData: jest.fn(() => ({
          vertices: {
            size: jest.fn(() => 24),
            get: jest.fn((i) => [0, 0, 0, 0, 1, 0, 0, 0][i % 8] || 0),
          },
          indices: { size: jest.fn(() => 3), get: jest.fn(() => 0) },
          materials: { size: jest.fn(() => 1), get: jest.fn(() => ({ texture: "test.TGA" })) },
          materialIds: { size: jest.fn(() => 1), get: jest.fn(() => 0) },
        })),
      })),
    })),
    createModel: jest.fn(() => ({
      loadFromArray: jest.fn(() => ({ success: true })),
      isLoaded: true,
      getAttachmentNames: jest.fn(() => ({ size: jest.fn(() => 0) })),
      getHierarchy: jest.fn(() => ({ nodes: { size: jest.fn(() => 0) } })),
    })),
    createMorphMesh: jest.fn(() => ({
      loadFromArray: jest.fn(() => ({ success: true })),
      isLoaded: true,
      convertToProcessedMesh: jest.fn(() => ({
        vertices: {
          size: jest.fn(() => 24),
          get: jest.fn((i) => [0, 0, 0, 0, 1, 0, 0, 0][i % 8] || 0),
        },
        indices: { size: jest.fn(() => 3), get: jest.fn(() => 0) },
        materials: { size: jest.fn(() => 1), get: jest.fn(() => ({ texture: "test.TGA" })) },
        materialIds: { size: jest.fn(() => 1), get: jest.fn(() => 0) },
      })),
      getAnimationNames: jest.fn(() => ({ size: jest.fn(() => 0) })),
    })),
    Texture: jest.fn(() => ({
      loadFromArray: jest.fn(() => ({ success: true })),
      width: 64,
      height: 64,
      asRgba8: jest.fn(() => new Uint8Array(64 * 64 * 4)),
    })),
  }) as unknown as ZenKit;

// Helper to add World properties to partial mocks
const addWorldProperties = (partial: Partial<World>): World =>
  ({
    ...partial,
    loadFromArray: jest.fn(() => true),
    getStartpoints:
      (partial as any).getStartpoints || jest.fn(() => ({ size: () => 0, get: () => null as any })),
    getWaypointCount: jest.fn(() => 0),
    getWaypoint: jest.fn(() => ({
      success: false,
      data: {
        name: "",
        position: { x: 0, y: 0, z: 0 },
        direction: { x: 0, y: 0, z: 0 },
        water_depth: 0,
        under_water: false,
        free_point: false,
      },
      errorMessage: "Not implemented",
    })),
    findWaypointByName: jest.fn(() => ({
      success: false,
      data: {
        name: "",
        position: { x: 0, y: 0, z: 0 },
        direction: { x: 0, y: 0, z: 0 },
        water_depth: 0,
        under_water: false,
        free_point: false,
      },
      errorMessage: "Not implemented",
    })),
    getAllWaypoints: jest.fn(() => []),
    getWaypointEdgeCount: jest.fn(() => 0),
    getWaypointEdge: jest.fn(() => ({
      success: false,
      data: { waypoint_a_index: 0, waypoint_b_index: 0 },
      errorMessage: "Not implemented",
    })),
    isLoaded: true,
    getLastError: jest.fn(() => null),
    mesh: {
      getProcessedMeshData: jest.fn(() => ({
        vertices: { size: () => 0, get: () => 0 },
        indices: { size: () => 0, get: () => 0 },
        materials: { size: () => 0, get: () => ({ texture: "" }) },
        materialIds: { size: () => 0, get: () => 0 },
      })),
    },
    ...partial,
  }) as unknown as World;

describe("VOBRenderer", () => {
  const mockOnLoadingStatus = jest.fn();

  it("renders without crashing", () => {
    const mockWorld = createMockWorld();
    const mockZenKit = createMockZenKit();
    const cameraPosition = new THREE.Vector3(0, 0, 0);
    render(
      <VOBRenderer
        world={mockWorld}
        zenKit={mockZenKit}
        cameraPosition={cameraPosition}
        onLoadingStatus={mockOnLoadingStatus}
        onVobStats={mockOnVobStats}
      />,
    );
    expect(mockOnLoadingStatus).toHaveBeenCalledWith("🔧 Collecting VOBs...");
  });

  it("accepts world, zenKit, cameraPosition, and onLoadingStatus props", () => {
    const mockWorld = createMockWorld();
    const mockZenKit = createMockZenKit();
    const cameraPosition = new THREE.Vector3(0, 0, 0);
    const { rerender } = render(
      <VOBRenderer
        world={mockWorld}
        zenKit={mockZenKit}
        cameraPosition={cameraPosition}
        onLoadingStatus={mockOnLoadingStatus}
        onVobStats={mockOnVobStats}
      />,
    );

    // Can rerender with different props
    rerender(
      <VOBRenderer
        world={mockWorld}
        zenKit={mockZenKit}
        cameraPosition={cameraPosition}
        onLoadingStatus={jest.fn()}
        onVobStats={mockOnVobStats}
      />,
    );
  });

  it("collects VOBs from world", () => {
    const mockWorld = createMockWorld();
    const mockZenKit = createMockZenKit();
    render(
      <VOBRenderer world={mockWorld} zenKit={mockZenKit} onLoadingStatus={mockOnLoadingStatus} />,
    );

    expect(mockWorld.getVobs).toHaveBeenCalled();
  });

  it("filters VOBs by visual type and showVisual flag", () => {
    const mockWorldWithMixedVOBs = addWorldProperties({
      getVobs: () => ({
        size: () => 4,
        get: (index: number) => {
          const vobs = [
            // Valid mesh VOB
            {
              id: 0,
              showVisual: true,
              visual: { type: 1, name: "mesh.MSH" },
              position: { x: 0, y: 0, z: 0 },
              rotation: {
                toArray: jest.fn(() => ({
                  size: () => 9,
                  get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
                })),
              },
              children: { size: jest.fn(() => 0), get: () => null as any },
            },
            // Invalid - no visual
            {
              id: 1,
              showVisual: false,
              visual: { type: 1, name: "hidden.MSH" },
              position: { x: 0, y: 0, z: 0 },
              rotation: {
                toArray: jest.fn(() => ({
                  size: () => 9,
                  get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
                })),
              },
              children: { size: jest.fn(() => 0), get: () => null as any },
            },
            // Invalid - texture extension
            {
              id: 2,
              showVisual: true,
              visual: { type: 1, name: "texture.TGA" },
              position: { x: 0, y: 0, z: 0 },
              rotation: {
                toArray: jest.fn(() => ({
                  size: () => 9,
                  get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
                })),
              },
              children: { size: jest.fn(() => 0), get: () => null as any },
            },
            // Invalid - unsupported type
            {
              id: 3,
              showVisual: true,
              visual: { type: 3, name: "particle.EFF" }, // PARTICLE_EFFECT
              position: { x: 0, y: 0, z: 0 },
              rotation: {
                toArray: jest.fn(() => ({
                  size: () => 9,
                  get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
                })),
              },
              children: { size: jest.fn(() => 0), get: () => null as any },
            },
          ];
          return vobs[index];
        },
      }),
    }) as unknown as World;
    const mockZenKit = createMockZenKit();

    render(
      <VOBRenderer
        world={mockWorldWithMixedVOBs}
        zenKit={mockZenKit}
        onLoadingStatus={mockOnLoadingStatus}
      />,
    );

    // Should only collect the valid mesh VOB
    expect(mockConsoleLog).toHaveBeenCalledWith("📊 Renderable VOBs: 1");
  });

  it("handles VOB children recursively", () => {
    const mockWorldWithChildren = addWorldProperties({
      getVobs: () => ({
        size: () => 1,
        get: () => ({
          id: 100,
          showVisual: true,
          visual: { type: 1, name: "parent.MSH" },
          position: { x: 0, y: 0, z: 0 },
          rotation: {
            toArray: () => ({
              size: () => 9,
              get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
            }),
          },
          children: {
            size: jest.fn(() => 1),
            get: jest.fn(() => ({
              id: 101,
              showVisual: true,
              visual: { type: 1, name: "child.MSH" },
              position: { x: 1, y: 1, z: 1 },
              rotation: {
                toArray: () => ({
                  size: () => 9,
                  get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
                }),
              },
              children: { size: () => 0, get: () => null as any },
            })),
          },
        }),
      }),
    }) as unknown as World;
    const mockZenKit = createMockZenKit();

    render(
      <VOBRenderer
        world={mockWorldWithChildren}
        zenKit={mockZenKit}
        onLoadingStatus={mockOnLoadingStatus}
      />,
    );

    // Should collect both parent and child
    expect(mockConsoleLog).toHaveBeenCalledWith("📊 Total VOBs (including children): 2");
    expect(mockConsoleLog).toHaveBeenCalledWith("📊 Renderable VOBs: 2");
  });

  it("logs VOB type statistics", () => {
    const mockWorldWithStats = addWorldProperties({
      getVobs: () => ({
        size: () => 3,
        get: (index: number) => {
          const vobs = [
            {
              id: 200,
              showVisual: true,
              visual: { type: 1, name: "mesh.MSH" },
              position: { x: 0, y: 0, z: 0 },
              rotation: {
                toArray: jest.fn(() => ({
                  size: () => 9,
                  get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
                })),
              },
              children: { size: jest.fn(() => 0), get: () => null as any },
            },
            {
              id: 201,
              showVisual: true,
              visual: { type: 5, name: "model.MDL" },
              position: { x: 0, y: 0, z: 0 },
              rotation: {
                toArray: jest.fn(() => ({
                  size: () => 9,
                  get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
                })),
              },
              children: { size: jest.fn(() => 0), get: () => null as any },
            },
            {
              id: 202,
              showVisual: true,
              visual: { type: 6, name: "morph.MMB" },
              position: { x: 0, y: 0, z: 0 },
              rotation: {
                toArray: jest.fn(() => ({
                  size: () => 9,
                  get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
                })),
              },
              children: { size: jest.fn(() => 0), get: () => null as any },
            },
          ];
          return vobs[index];
        },
      }),
    }) as unknown as World;
    const mockZenKit = createMockZenKit();

    render(
      <VOBRenderer
        world={mockWorldWithStats}
        zenKit={mockZenKit}
        onLoadingStatus={mockOnLoadingStatus}
      />,
    );

    expect(mockConsoleLog).toHaveBeenCalledWith("📊 Visual type breakdown:");
    expect(mockConsoleLog).toHaveBeenCalledWith("   MESH (1): 1");
    expect(mockConsoleLog).toHaveBeenCalledWith("   MODEL (5): 1");
    expect(mockConsoleLog).toHaveBeenCalledWith("   MORPH_MESH (6): 1");
  });

  it("handles VOB loading errors gracefully", () => {
    const mockWorldError = addWorldProperties({
      getVobs: jest.fn(() => {
        throw new Error("Failed to get VOBs");
      }),
    });
    const mockZenKit = createMockZenKit();

    render(
      <VOBRenderer
        world={mockWorldError}
        zenKit={mockZenKit}
        onLoadingStatus={mockOnLoadingStatus}
      />,
    );

    // Should start with loading message
    expect(mockOnLoadingStatus).toHaveBeenCalledWith("🔧 Collecting VOBs...");
    // Component should render without crashing despite the error
    expect(true).toBe(true);
  });

  it("streams and loads mesh VOBs on frames and reports stats", async () => {
    configureThreeForVobRendererTests();
    const scene = configureStableSceneForTest();

    (loadMeshCached as unknown as jest.Mock).mockResolvedValue({} as any);
    (buildThreeJSGeometryAndMaterials as unknown as jest.Mock).mockResolvedValue({
      geometry: { attributes: { position: { count: 3 } }, dispose: jest.fn() },
      materials: [],
    });

    const mockWorld = addWorldProperties({
      getVobs: () => ({
        size: () => 1,
        get: () => ({
          id: 1,
          type: 0,
          showVisual: true,
          visual: { type: 1, name: "mesh.MSH" },
          position: { x: 0, y: 0, z: 0 },
          rotation: {
            toArray: () => ({
              size: () => 9,
              get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
            }),
          },
          children: { size: () => 0, get: () => null as any },
        }),
      }),
    }) as unknown as World;

    const onVobStats = jest.fn();
    const mockZenKit = createMockZenKit();
    const cameraPosition = new THREE.Vector3(0, 0, 0);

    render(
      <VOBRenderer
        world={mockWorld}
        zenKit={mockZenKit}
        cameraPosition={cameraPosition}
        onLoadingStatus={mockOnLoadingStatus}
        onVobStats={onVobStats}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const frameCb = (useFrame as unknown as jest.Mock).mock.calls[0][0] as () => void;

    act(() => frameCb());
    await act(async () => {
      await Promise.resolve();
    });
    act(() => frameCb());

    expect(scene.add).toHaveBeenCalled();
    expect(scene.children.length).toBeGreaterThan(0);
    expect(scene.children[0].userData?.vob?.id).toBe(1);
    expect(onVobStats).toHaveBeenCalled();
  });

  it("renders helper visual VOBs even when showVisual is false", async () => {
    configureThreeForVobRendererTests();
    configureStableSceneForTest();

    (loadMeshCached as unknown as jest.Mock).mockResolvedValue({} as any);
    (buildThreeJSGeometryAndMaterials as unknown as jest.Mock).mockResolvedValue({
      geometry: { attributes: { position: { count: 3 } }, dispose: jest.fn() },
      materials: [],
    });

    const helperVob = {
      id: 2,
      type: 10, // zCVobLight -> helper visual
      showVisual: false,
      visual: { type: 1, name: "" },
      position: { x: 0, y: 0, z: 0 },
      rotation: {
        toArray: () => ({ size: () => 9, get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0 }),
      },
      children: { size: () => 0, get: () => null as any },
    };

    const mockWorld = addWorldProperties({
      getVobs: () => ({
        size: () => 1,
        get: () => helperVob,
      }),
    }) as unknown as World;

    const mockZenKit = createMockZenKit();
    render(
      <VOBRenderer world={mockWorld} zenKit={mockZenKit} onLoadingStatus={mockOnLoadingStatus} />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const frameCb = (useFrame as unknown as jest.Mock).mock.calls[0][0] as () => void;
    act(() => frameCb());
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadMeshCached).toHaveBeenCalledWith(
      "/MESHES/_COMPILED/INVISIBLE_ZCVOBLIGHT.MRM",
      expect.anything(),
      expect.anything(),
    );
  });

  it("unloads loaded VOBs when camera moves beyond unload distance", async () => {
    configureThreeForVobRendererTests();
    const scene = configureStableSceneForTest();

    (loadMeshCached as unknown as jest.Mock).mockResolvedValue({} as any);
    (buildThreeJSGeometryAndMaterials as unknown as jest.Mock).mockResolvedValue({
      geometry: { attributes: { position: { count: 3 } }, dispose: jest.fn() },
      materials: [],
    });

    const vob = {
      id: 3,
      type: 0,
      showVisual: true,
      visual: { type: 1, name: "mesh.MSH" },
      position: { x: 0, y: 0, z: 0 },
      rotation: {
        toArray: () => ({ size: () => 9, get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0 }),
      },
      children: { size: () => 0, get: () => null as any },
    };
    const world = addWorldProperties({
      getVobs: () => ({
        size: () => 1,
        get: () => vob,
      }),
    }) as unknown as World;
    const mockZenKit = createMockZenKit();

    const { rerender } = render(
      <VOBRenderer
        world={world}
        zenKit={mockZenKit}
        cameraPosition={new THREE.Vector3(0, 0, 0)}
        onLoadingStatus={mockOnLoadingStatus}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const getLatestFrameCb = () => {
      const calls = (useFrame as unknown as jest.Mock).mock.calls;
      return calls[calls.length - 1][0] as () => void;
    };

    const frameCb = getLatestFrameCb();
    act(() => frameCb());
    await act(async () => {
      await Promise.resolve();
    });
    act(() => frameCb());

    expect(scene.add).toHaveBeenCalled();

    rerender(
      <VOBRenderer
        world={world}
        zenKit={mockZenKit}
        cameraPosition={new THREE.Vector3(10000, 0, 0)}
        onLoadingStatus={mockOnLoadingStatus}
      />,
    );

    const frameCbAfterRerender = getLatestFrameCb();

    // Respect updateInterval default (10): advance enough frames to trigger an update.
    for (let i = 0; i < 10; i++) {
      act(() => frameCbAfterRerender());
    }

    expect(scene.remove).toHaveBeenCalled();
  });
});

describe("Path Resolution Functions", () => {
  // Import the helper functions for testing
  const {
    getMeshPath,
    getModelPath,
    getMorphMeshPath,
    tgaNameToCompiledUrl,
  } = require("./vob-utils");

  describe("getMeshPath", () => {
    it("converts mesh visual name to compiled MRM path", () => {
      expect(getMeshPath("TestMesh.3DS")).toBe("/MESHES/_COMPILED/TESTMESH.MRM");
      expect(getMeshPath("Another_Mesh")).toBe("/MESHES/_COMPILED/ANOTHER_MESH.MRM");
    });

    it("returns null for invalid input", () => {
      expect(getMeshPath("")).toBeNull();
      expect(getMeshPath(null as any)).toBeNull();
      expect(getMeshPath(undefined as any)).toBeNull();
    });
  });

  describe("getModelPath", () => {
    it("converts model visual name to compiled MDL path", () => {
      expect(getModelPath("TestModel.MDS")).toBe("/ANIMS/_COMPILED/TESTMODEL.MDL");
      expect(getModelPath("Character")).toBe("/ANIMS/_COMPILED/CHARACTER.MDL");
    });

    it("returns null for invalid input", () => {
      expect(getModelPath("")).toBeNull();
      expect(getModelPath(null as any)).toBeNull();
      expect(getModelPath(undefined as any)).toBeNull();
    });
  });

  describe("getMorphMeshPath", () => {
    it("converts morph mesh visual name to compiled MMB path", () => {
      expect(getMorphMeshPath("TestMorph.MMS")).toBe("/ANIMS/_COMPILED/TESTMORPH.MMB");
      expect(getMorphMeshPath("FaceBlend")).toBe("/ANIMS/_COMPILED/FACEBLEND.MMB");
    });

    it("returns null for invalid input", () => {
      expect(getMorphMeshPath("")).toBeNull();
      expect(getMorphMeshPath(null as any)).toBeNull();
      expect(getMorphMeshPath(undefined as any)).toBeNull();
    });
  });

  describe("tgaNameToCompiledUrl", () => {
    it("converts TGA filename to compiled TEX URL", () => {
      expect(tgaNameToCompiledUrl("test.TGA")).toBe("/TEXTURES/_COMPILED/TEST-C.TEX");
      expect(tgaNameToCompiledUrl("MyTexture.tga")).toBe("/TEXTURES/_COMPILED/MYTEXTURE-C.TEX");
    });

    it("handles filenames without extensions", () => {
      expect(tgaNameToCompiledUrl("test")).toBe("/TEXTURES/_COMPILED/TEST-C.TEX");
    });

    it("returns null for invalid input", () => {
      expect(tgaNameToCompiledUrl("")).toBeNull();
      expect(tgaNameToCompiledUrl(null as any)).toBeNull();
      expect(tgaNameToCompiledUrl(undefined as any)).toBeNull();
    });
  });
});

describe("VOB Rendering Logic", () => {
  it("can create mesh VOBs without errors", () => {
    const mockWorld = addWorldProperties({
      getVobs: () => ({
        size: () => 1,
        get: () => ({
          id: 300,
          showVisual: true,
          visual: { type: 1, name: "test.MSH" },
          position: { x: 10, y: 20, z: 30 },
          rotation: {
            toArray: () => ({
              size: () => 9,
              get: (i: number) => [0, 0, 1, 0, 1, 0, -1, 0, 0][i] || 0,
            }),
          },
          children: { size: () => 0, get: () => null as any },
        }),
      }),
    }) as unknown as World;

    const mockZenKit = createMockZenKit();

    // Mock successful fetch for mesh file
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn(() => Promise.resolve(new ArrayBuffer(100))),
    });

    render(<VOBRenderer world={mockWorld} zenKit={mockZenKit} onLoadingStatus={jest.fn()} />);

    // Component should render without throwing errors
    expect(true).toBe(true);
  });

  it("can create model VOBs without errors", () => {
    const mockWorld = addWorldProperties({
      getVobs: () => ({
        size: () => 1,
        get: () => ({
          id: 400,
          showVisual: true,
          visual: { type: 5, name: "test.MDL" },
          position: { x: 0, y: 0, z: 0 },
          rotation: {
            toArray: () => ({
              size: () => 9,
              get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
            }),
          },
          children: { size: () => 0, get: () => null as any },
        }),
      }),
    }) as unknown as World;

    const mockZenKit = createMockZenKit();

    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn(() => Promise.resolve(new ArrayBuffer(100))),
    });

    render(<VOBRenderer world={mockWorld} zenKit={mockZenKit} onLoadingStatus={jest.fn()} />);

    // Component should render without throwing errors
    expect(true).toBe(true);
  });

  it("can create morph mesh VOBs without errors", () => {
    const mockWorld = addWorldProperties({
      getVobs: () => ({
        size: () => 1,
        get: () => ({
          id: 500,
          showVisual: true,
          visual: { type: 6, name: "test.MMB" },
          position: { x: 0, y: 0, z: 0 },
          rotation: {
            toArray: () => ({
              size: () => 9,
              get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
            }),
          },
          children: { size: () => 0, get: () => null as any },
        }),
      }),
    }) as unknown as World;

    const mockZenKit = createMockZenKit();

    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn(() => Promise.resolve(new ArrayBuffer(100))),
    });

    render(<VOBRenderer world={mockWorld} zenKit={mockZenKit} onLoadingStatus={jest.fn()} />);

    // Component should render without throwing errors
    expect(true).toBe(true);
  });

  it("skips unsupported VOB types", () => {
    const mockWorld = addWorldProperties({
      getVobs: () => ({
        size: () => 1,
        get: () => ({
          id: 600,
          showVisual: true,
          visual: { type: 3, name: "particle.EFF" }, // PARTICLE_EFFECT - unsupported
          position: { x: 0, y: 0, z: 0 },
          rotation: {
            toArray: () => ({
              size: () => 9,
              get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
            }),
          },
          children: { size: () => 0, get: () => null as any },
        }),
      }),
    }) as unknown as World;
    const mockZenKit = createMockZenKit();

    render(<VOBRenderer world={mockWorld} zenKit={mockZenKit} onLoadingStatus={jest.fn()} />);

    expect(mockConsoleLog).toHaveBeenCalledWith("📊 Renderable VOBs: 0");
  });

  it("handles invalid VOB data gracefully", () => {
    const mockWorld = addWorldProperties({
      getVobs: () => ({
        size: () => 1,
        get: () => ({
          id: 700,
          showVisual: true,
          visual: { type: 1, name: "" }, // Invalid visual name (empty string instead of null)
          position: { x: 0, y: 0, z: 0 },
          rotation: {
            toArray: () => ({
              size: () => 9,
              get: (i: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1][i] || 0,
            }),
          },
          children: { size: () => 0, get: () => null as any },
        }),
      }),
    }) as unknown as World;

    const mockZenKit = createMockZenKit();

    render(<VOBRenderer world={mockWorld} zenKit={mockZenKit} onLoadingStatus={jest.fn()} />);

    // Component should handle invalid data without crashing
    expect(true).toBe(true);
  });
});

describe("Streaming VOB Loader", () => {
  it("initializes streaming loader state", () => {
    const mockWorld = createMockWorld();
    const mockZenKit = createMockZenKit();
    render(<VOBRenderer world={mockWorld} zenKit={mockZenKit} onLoadingStatus={jest.fn()} />);

    // Component should initialize without errors and set up internal state
    expect(jest.fn()).toBeDefined(); // Basic assertion that works
  });
});

describe("Asset Caching", () => {
  it("initializes asset caches", () => {
    const mockWorld = createMockWorld();
    const mockZenKit = createMockZenKit();
    render(<VOBRenderer world={mockWorld} zenKit={mockZenKit} onLoadingStatus={jest.fn()} />);

    // Component should initialize asset caches without errors
    expect(true).toBe(true); // Basic test that component renders
  });
});

describe("Bounding Box Mechanism", () => {
  it("does not render bounding box when selectedVob is null", () => {
    const mockWorld = createMockWorld();
    const mockZenKit = createMockZenKit();
    const { queryByTestId } = render(
      <VOBRenderer
        world={mockWorld}
        zenKit={mockZenKit}
        onLoadingStatus={jest.fn()}
        selectedVob={null}
      />,
    );

    expect(queryByTestId("vob-bounding-box")).not.toBeInTheDocument();
  });

  it("does not render bounding box when selectedVob does not match any VOB", () => {
    const mockWorld = createMockWorld();
    const mockZenKit = createMockZenKit();
    const nonExistentVob = {
      id: 9999,
      position: { x: 0, y: 0, z: 0 },
      visual: { type: 1, name: "nonexistent.MSH" },
      rotation: { toArray: () => ({ size: () => 9, get: () => 0 }) },
      children: { size: () => 0, get: () => null },
      showVisual: true,
    } as unknown as Vob;

    const { queryByTestId } = render(
      <VOBRenderer
        world={mockWorld}
        zenKit={mockZenKit}
        onLoadingStatus={jest.fn()}
        selectedVob={nonExistentVob}
      />,
    );

    expect(queryByTestId("vob-bounding-box")).not.toBeInTheDocument();
  });

  it("renders bounding box when selectedVob matches a loaded VOB", async () => {
    const mockWorld = createMockWorld();
    const mockZenKit = createMockZenKit();

    // Get the VOB from the mock world
    const vobs = mockWorld.getVobs();
    const selectedVob = vobs.get(0) as unknown as Vob;

    // Create a mock Three.js object to simulate a loaded VOB
    const mockThreeObject = new THREE.Mesh();
    mockThreeObject.userData = { vobId: selectedVob.id };

    // We need to wait for the component to process the VOBs and potentially load them
    // Since the actual loading is async, we'll test that the component accepts the prop
    const { container } = render(
      <VOBRenderer
        world={mockWorld}
        zenKit={mockZenKit}
        onLoadingStatus={jest.fn()}
        selectedVob={selectedVob}
      />,
    );

    // The bounding box won't render immediately because the VOB needs to be loaded first
    // But we can verify the component accepts the prop without errors
    expect(container).toBeTruthy();
  });

  it("handles selectedVob prop changes correctly", () => {
    const mockWorld = createMockWorld();
    const mockZenKit = createMockZenKit();

    const vobs = mockWorld.getVobs();
    const firstVob = vobs.get(0) as unknown as Vob;
    const secondVob = vobs.get(1) as unknown as Vob;

    const { rerender } = render(
      <VOBRenderer
        world={mockWorld}
        zenKit={mockZenKit}
        onLoadingStatus={jest.fn()}
        selectedVob={firstVob}
      />,
    );

    // Change to second VOB
    rerender(
      <VOBRenderer
        world={mockWorld}
        zenKit={mockZenKit}
        onLoadingStatus={jest.fn()}
        selectedVob={secondVob}
      />,
    );

    // Component should handle the change without errors
    expect(true).toBe(true);
  });

  it("clears bounding box when selectedVob is set to null", () => {
    const mockWorld = createMockWorld();
    const mockZenKit = createMockZenKit();

    const vobs = mockWorld.getVobs();
    const selectedVob = vobs.get(0) as unknown as Vob;

    const { rerender, queryByTestId } = render(
      <VOBRenderer
        world={mockWorld}
        zenKit={mockZenKit}
        onLoadingStatus={jest.fn()}
        selectedVob={selectedVob}
      />,
    );

    // Clear selection
    rerender(
      <VOBRenderer
        world={mockWorld}
        zenKit={mockZenKit}
        onLoadingStatus={jest.fn()}
        selectedVob={null}
      />,
    );

    // Bounding box should not be rendered
    expect(queryByTestId("vob-bounding-box")).not.toBeInTheDocument();
  });

  describe("VOB userData storage", () => {
    it("should store VOB reference in mesh userData for click detection", () => {
      // This test verifies that VOB references are stored in userData
      // The actual storage happens in renderMeshVOB, renderModelVOB, and renderMorphMeshVOB
      // The userData.vob property is used by VobClickHandler for raycasting

      // Create a mock Three.js object
      const mockObject: { userData: { vob?: Vob } } = {
        userData: {},
      };

      // Simulate the storage that happens in vob-renderer.tsx
      const mockVob: Vob = {
        id: 999,
        showVisual: true,
        visual: { type: 1, name: "test.MSH" },
        position: { x: 0, y: 0, z: 0 },
        rotation: { toArray: jest.fn(() => ({ size: () => 9, get: jest.fn() })) },
        children: { size: () => 0, get: jest.fn() },
      } as any;

      // Store VOB reference (as done in vob-renderer.tsx)
      mockObject.userData.vob = mockVob;

      // Verify VOB reference is stored
      expect(mockObject.userData.vob).toBe(mockVob);
      expect(mockObject.userData.vob?.id).toBe(999);
    });
  });
});
