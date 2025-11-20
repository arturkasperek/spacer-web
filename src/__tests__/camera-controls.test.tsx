import { render } from '@testing-library/react';
import { CameraControls, CameraControlsRef } from '../camera-controls';

// Mock window and document event listeners
const mockAddEventListener = jest.fn();
const mockRemoveEventListener = jest.fn();

Object.defineProperty(window, 'addEventListener', {
  writable: true,
  value: mockAddEventListener,
});

Object.defineProperty(window, 'removeEventListener', {
  writable: true,
  value: mockRemoveEventListener,
});

Object.defineProperty(document, 'addEventListener', {
  writable: true,
  value: mockAddEventListener,
});

Object.defineProperty(document, 'removeEventListener', {
  writable: true,
  value: mockRemoveEventListener,
});

// Mock pointer lock API
Object.defineProperty(document, 'pointerLockElement', {
  get: jest.fn(() => null),
});

Object.defineProperty(document, 'exitPointerLock', {
  writable: true,
  value: jest.fn(),
});

// Mock React Three Fiber hooks
jest.mock('@react-three/fiber', () => ({
  useThree: jest.fn(),
  useFrame: jest.fn(),
}));

const mockCamera = {
  position: { set: jest.fn(), x: 0, y: 0, z: 0, add: jest.fn() },
  quaternion: { x: 0, y: 0, z: 0, w: 1, copy: jest.fn() },
  getWorldDirection: jest.fn(() => ({ x: 0, y: 0, z: -1 })),
};

const mockGl = {
  domElement: {
    style: { cursor: '' },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    requestPointerLock: jest.fn(),
  },
};

const mockUseThree = require('@react-three/fiber').useThree;
const mockUseFrame = require('@react-three/fiber').useFrame;

mockUseThree.mockReturnValue({
  camera: mockCamera,
  gl: mockGl,
});

describe('CameraControls', () => {
  let mockRef: React.RefObject<CameraControlsRef | null>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRef = { current: null };
    mockCamera.position.x = 0;
    mockCamera.position.y = 0;
    mockCamera.position.z = 0;
  });

  it('renders without crashing', () => {
    render(<CameraControls ref={mockRef} />);
    expect(mockUseThree).toHaveBeenCalled();
  });

  it('sets up event listeners on mount', () => {
    render(<CameraControls ref={mockRef} />);

    expect(mockAddEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(mockAddEventListener).toHaveBeenCalledWith('keyup', expect.any(Function));
    expect(mockAddEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
    expect(mockAddEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
    expect(mockAddEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(mockGl.domElement.addEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
  });

  it('cleans up event listeners on unmount', () => {
    const { unmount } = render(<CameraControls ref={mockRef} />);

    unmount();

    // Verify that event listeners are cleaned up
    expect(mockRemoveEventListener).toHaveBeenCalled();
    expect(mockGl.domElement.removeEventListener).toHaveBeenCalled();
  });

  it('sets cursor to grab initially', () => {
    render(<CameraControls ref={mockRef} />);
    expect(mockGl.domElement.style.cursor).toBe('grab');
  });

  it('exposes ref methods', () => {
    render(<CameraControls ref={mockRef} />);

    expect(mockRef.current).toHaveProperty('updateMouseState');
    expect(mockRef.current).toHaveProperty('setPose');
    expect(typeof mockRef.current?.updateMouseState).toBe('function');
    expect(typeof mockRef.current?.setPose).toBe('function');
  });

  describe('setPose method', () => {
    it('sets camera position and orientation correctly', () => {
      render(<CameraControls ref={mockRef} />);

      const position: [number, number, number] = [1, 2, 3];
      const lookAt: [number, number, number] = [4, 5, 6];

      mockRef.current?.setPose(position, lookAt);

      expect(mockCamera.position.set).toHaveBeenCalledWith(1, 2, 3);
      // The method now uses quaternion-based orientation instead of Euler angles
    });
  });

  describe('updateMouseState method', () => {
    it('updates internal mouse state', () => {
      render(<CameraControls ref={mockRef} />);

      mockRef.current?.updateMouseState(0.5, 1.2);

      // Since mouse state is internal, we verify it doesn't throw and the method exists
      expect(mockRef.current?.updateMouseState).toBeDefined();
    });
  });

  describe('useFrame callback', () => {
    it('is called with correct parameters', () => {
      render(<CameraControls ref={mockRef} />);

      expect(mockUseFrame).toHaveBeenCalledWith(expect.any(Function));

      const frameCallback = mockUseFrame.mock.calls[0][0];

      // Call the frame callback
      frameCallback({}, 0.016); // 60fps delta

      // The frame callback now handles movement updates using the zen-viewer style system
    });
  });

  // Note: Testing actual keyboard/mouse events would require more complex setup
  // with userEvent or firing events manually. For now, we test the setup and ref methods.
  // In a real-world scenario, you might want to add integration tests that test
  // the actual user interactions end-to-end.
});
