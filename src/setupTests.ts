import '@testing-library/jest-dom';

// Suppress console warnings during tests (Three.js component casing warnings)
const originalWarn = console.warn;
const originalError = console.error;
console.warn = (...args) => {
  // Filter out Three.js component casing warnings
  if (args[0] && typeof args[0] === 'string' && (
    args[0].includes('is using incorrect casing') ||
    args[0].includes('unrecognized in this browser')
  )) {
    return;
  }
  originalWarn(...args);
};
console.error = (...args) => {
  // Filter out Three.js component casing errors and React warnings
  if (args[0] && typeof args[0] === 'string' && (
    args[0].includes('is using incorrect casing') ||
    args[0].includes('unrecognized in this browser') ||
    args[0].includes('does not recognize the') ||
    args[0].includes('Received `true` for a non-boolean attribute')
  )) {
    return;
  }
  originalError(...args);
};

// Mock React Three Fiber hooks
jest.mock('@react-three/fiber', () => ({
  useFrame: jest.fn(),
  useThree: jest.fn(() => ({
    camera: {
      position: { set: jest.fn() },
      lookAt: jest.fn(),
      rotation: { order: 'YXZ' },
      updateProjectionMatrix: jest.fn(),
    },
    gl: {
      setSize: jest.fn(),
      setPixelRatio: jest.fn(),
      render: jest.fn(),
    },
    scene: {
      add: jest.fn(),
      remove: jest.fn(),
    },
    size: { width: 800, height: 600 },
    viewport: { width: 800, height: 600 },
    controls: { updateMouseState: jest.fn() },
  })),
  useLoader: jest.fn(),
  extend: jest.fn(),
  Canvas: ({ children }: { children: any }) => ({ type: 'Canvas', props: { children } }),
}));

// Mock @react-three/drei
jest.mock('@react-three/drei', () => ({
  OrbitControls: ({ children }: { children: any }) => ({ type: 'OrbitControls', props: { children } }),
  Html: ({ children }: { children: any }) => ({ type: 'Html', props: { children } }),
  Text: ({ children }: { children: any }) => ({ type: 'Text', props: { children } }),
}));

// Mock @react-three/rapier (it pulls in three-stdlib loaders which don't work with our minimal Three.js mock)
jest.mock('@react-three/rapier', () => ({
  Physics: ({ children }: { children: any }) => ({ type: 'Physics', props: { children } }),
  useRapier: jest.fn(() => ({ world: null, rapier: null })),
}));

// Mock ZenKit
jest.mock('@kolarz3/zenkit', () => ({
  ZenKit: {
    createWorld: jest.fn(() => ({
      loadFromArray: jest.fn(),
      getMeshNames: jest.fn(() => ['root']),
      getMesh: jest.fn(() => ({
        getProcessedMeshData: jest.fn(() => ({
          vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
          indices: new Uint32Array([0, 1, 2]),
          materialIds: {
            size: jest.fn(() => 1),
            get: jest.fn(() => 0),
          },
          materials: {
            size: jest.fn(() => 1),
            get: jest.fn(() => ({
              texture: 'test_texture.TGA',
            })),
          },
        })),
      })),
    })),
    loadCompiledTexAsDataTexture: jest.fn(() => Promise.resolve({
      image: { width: 64, height: 64 },
      needsUpdate: true,
    })),
  },
}));

// Mock Three.js
jest.mock('three', () => {
  const mockGeometry = {
    setAttribute: jest.fn(),
    setIndex: jest.fn(),
    clearGroups: jest.fn(),
    addGroup: jest.fn(),
    dispose: jest.fn(),
  };

  const mockMaterial = {
    color: { setHex: jest.fn() },
    transparent: false,
    side: 2,
    alphaTest: 0.5,
    map: null,
    needsUpdate: true,
    dispose: jest.fn(),
  };

  const mockMesh = {
    position: { set: jest.fn() },
    rotation: { set: jest.fn() },
    scale: { x: 1, y: 1, z: 1, set: jest.fn() },
    add: jest.fn(),
    remove: jest.fn(),
    dispose: jest.fn(),
  };

  return {
    BufferGeometry: jest.fn(() => mockGeometry),
    MeshBasicMaterial: jest.fn(() => mockMaterial),
    Mesh: jest.fn(() => mockMesh),
    DoubleSide: 2,
    Vector3: jest.fn(() => {
    const vector: any = {
      x: 0,
      y: 0,
      z: 0,
      set: jest.fn().mockReturnThis(),
      length: jest.fn(() => 0),
      addScaledVector: jest.fn().mockReturnThis(),
      applyQuaternion: jest.fn().mockReturnThis(),
      distanceTo: jest.fn(() => 0),
      copy: jest.fn().mockReturnThis(),
    };
    vector.subVectors = jest.fn().mockReturnValue(vector);
    vector.crossVectors = jest.fn().mockReturnValue(vector);
    vector.normalize = jest.fn().mockReturnValue(vector);
    return vector;
  }),
    Euler: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
    Quaternion: jest.fn(() => ({
      x: 0,
      y: 0,
      z: 1,
      w: 0,
      setFromEuler: jest.fn().mockReturnThis(),
      copy: jest.fn().mockReturnThis(),
    })),
    Matrix4: jest.fn(() => ({})),
    Color: jest.fn(() => ({ r: 1, g: 1, b: 1 })),
    TextureLoader: jest.fn(() => ({
      load: jest.fn(),
    })),
    DataTexture: jest.fn(() => ({
      image: { width: 64, height: 64 },
      format: 1023,
      type: 1009,
      needsUpdate: true,
    })),
    RGBAFormat: 1023,
    UnsignedByteType: 1009,
    ClampToEdgeWrapping: 1001,
    LinearFilter: 1006,
    ACESFilmicToneMapping: 4,
    sRGBEncoding: 3001,
  };
});

// Mock file loader
jest.mock('../__mocks__/fileMock.js', () => 'test-file-stub', { virtual: true });
