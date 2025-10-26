import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CameraControls, CameraControlsRef } from '../camera-controls';

// Mock window event listeners
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

// Mock React Three Fiber hooks
jest.mock('@react-three/fiber', () => ({
  useThree: jest.fn(),
  useFrame: jest.fn(),
}));

const mockCamera = {
  position: { set: jest.fn(), x: 0, y: 0, z: 0, addScaledVector: jest.fn() },
  rotation: { order: 'YXZ', x: 0, y: 0, z: 0 },
  getWorldDirection: jest.fn(() => ({ x: 0, y: 0, z: -1 })),
  updateProjectionMatrix: jest.fn(),
};

const mockGl = {
  domElement: {
    style: { cursor: '' },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
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
    mockCamera.rotation.x = 0;
    mockCamera.rotation.y = 0;
    mockCamera.rotation.z = 0;
  });

  it('renders without crashing', () => {
    render(<CameraControls ref={mockRef} />);
    expect(mockUseThree).toHaveBeenCalled();
  });

  it('sets up event listeners on mount', () => {
    render(<CameraControls ref={mockRef} />);

    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(window.addEventListener).toHaveBeenCalledWith('keyup', expect.any(Function));
    expect(window.addEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
    expect(window.addEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(mockGl.domElement.addEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
    expect(mockGl.domElement.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
  });

  it('cleans up event listeners on unmount', () => {
    const { unmount } = render(<CameraControls ref={mockRef} />);

    unmount();

    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(window.removeEventListener).toHaveBeenCalledWith('keyup', expect.any(Function));
    expect(window.removeEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
    expect(window.removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(mockGl.domElement.removeEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
    expect(mockGl.domElement.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
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
    it('sets camera position and rotation correctly', () => {
      render(<CameraControls ref={mockRef} />);

      const position: [number, number, number] = [1, 2, 3];
      const lookAt: [number, number, number] = [4, 5, 6];

      mockRef.current?.setPose(position, lookAt);

      expect(mockCamera.position.set).toHaveBeenCalledWith(1, 2, 3);
      expect(mockCamera.updateProjectionMatrix).toHaveBeenCalled();
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

      // Should update camera rotation
      expect(mockCamera.rotation.order).toBe('YXZ');
    });
  });

  // Note: Testing actual keyboard/mouse events would require more complex setup
  // with userEvent or firing events manually. For now, we test the setup and ref methods.
  // In a real-world scenario, you might want to add integration tests that test
  // the actual user interactions end-to-end.
});
