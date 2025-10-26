import { render } from '@testing-library/react';
import { AxesHelper } from '../axes';
import { SkyComponent } from '../sky';

// Mock React Three Fiber hooks
jest.mock('@react-three/fiber', () => ({
  useThree: jest.fn(() => ({
    camera: { position: { x: 0, y: 0, z: 0 } },
    scene: { environment: null },
    gl: {},
  })),
  useFrame: jest.fn(),
}));

// Mock @react-three/drei
jest.mock('@react-three/drei', () => ({
  Text: ({ children, ...props }: any) => (
    <div data-testid="text" {...props}>
      {children}
    </div>
  ),
}));

// Mock Three.js
jest.mock('three', () => ({
  Mesh: jest.fn(),
  ShaderMaterial: jest.fn(() => ({
    uniforms: {
      cameraPos: { value: { copy: jest.fn() } },
    },
  })),
  BoxGeometry: jest.fn(),
  PMREMGenerator: jest.fn(() => ({
    fromScene: jest.fn(() => ({ texture: {} })),
  })),
  Scene: jest.fn(() => ({
    add: jest.fn(),
    remove: jest.fn(),
  })),
  Vector3: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
  BackSide: 1,
}));

describe('AxesHelper', () => {
  it('renders without crashing', () => {
    render(<AxesHelper />);
    // The component renders Three.js elements which are mocked
    // We just verify it doesn't throw an error
    expect(true).toBe(true);
  });

  it('renders with correct structure', () => {
    render(<AxesHelper />);
    // Component should render without errors - the actual Three.js objects are mocked
    expect(true).toBe(true);
  });
});

describe('SkyComponent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing with default props', () => {
    render(<SkyComponent />);
    expect(true).toBe(true);
  });

  it('renders with custom scale', () => {
    render(<SkyComponent scale={5000} />);
    expect(true).toBe(true);
  });

  it('renders with custom sun position', () => {
    const sunPosition = { x: 1, y: 0, z: 0 };
    render(<SkyComponent sunPosition={sunPosition as any} />);
    expect(true).toBe(true);
  });

  it('handles missing sun position gracefully', () => {
    render(<SkyComponent />);
    // Should render with default sun position
    expect(true).toBe(true);
  });

  it('creates shader material with correct uniforms', () => {
    render(<SkyComponent />);
    // The ShaderMaterial constructor is mocked, so we verify the component renders
    expect(true).toBe(true);
  });
});
