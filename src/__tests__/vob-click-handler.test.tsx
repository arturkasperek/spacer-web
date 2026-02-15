import { render } from "@testing-library/react";
import { VobClickHandler } from "../vob-click-handler";
import * as THREE from "three";
import type { Vob, WayPointData } from "@kolarz3/zenkit";

// Mock React Three Fiber hooks
jest.mock("@react-three/fiber", () => ({
  useThree: jest.fn(),
}));

// Mock THREE classes
jest.mock("three", () => {
  const actualThree = jest.requireActual("three");
  return {
    ...actualThree,
    Raycaster: jest.fn().mockImplementation(() => ({
      setFromCamera: jest.fn(),
      intersectObjects: jest.fn(() => []),
    })),
    Vector2: jest.fn().mockImplementation((x = 0, y = 0) => ({ x, y })),
    Vector3: jest.fn().mockImplementation((x = 0, y = 0, z = 0) => ({ x, y, z })),
    Mesh: jest.fn().mockImplementation(() => ({
      userData: {},
    })),
    Group: jest.fn().mockImplementation(() => ({
      userData: {},
      add: jest.fn(),
    })),
  };
});

const mockUseThree = require("@react-three/fiber").useThree;

describe("VobClickHandler", () => {
  let mockOnVobClick: jest.Mock;
  let mockOnWaypointClick: jest.Mock;
  let mockOnNpcClick: jest.Mock;
  let mockCamera: any;
  let mockScene: any;
  let mockGl: any;
  let mockDomElement: HTMLCanvasElement;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockOnVobClick = jest.fn();
    mockOnWaypointClick = jest.fn();
    mockOnNpcClick = jest.fn();

    mockDomElement = document.createElement("canvas");
    mockDomElement.getBoundingClientRect = jest.fn(() => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: jest.fn(),
    }));

    mockCamera = {
      position: new THREE.Vector3(0, 0, 0),
      getWorldDirection: jest.fn(),
    };

    mockScene = {
      children: [],
    };

    mockGl = {
      domElement: mockDomElement,
    };

    mockUseThree.mockReturnValue({
      camera: mockCamera,
      scene: mockScene,
      gl: mockGl,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders without crashing", () => {
    render(<VobClickHandler onVobClick={mockOnVobClick} />);
    expect(mockUseThree).toHaveBeenCalled();
  });

  it("does not add click listener when onVobClick is not provided", () => {
    const addEventListenerSpy = jest.spyOn(mockDomElement, "addEventListener");
    render(<VobClickHandler />);
    expect(addEventListenerSpy).not.toHaveBeenCalled();
    addEventListenerSpy.mockRestore();
  });

  it("adds click listener when onVobClick is provided", () => {
    const addEventListenerSpy = jest.spyOn(mockDomElement, "addEventListener");
    render(<VobClickHandler onVobClick={mockOnVobClick} />);
    expect(addEventListenerSpy).toHaveBeenCalledWith("click", expect.any(Function));
    addEventListenerSpy.mockRestore();
  });

  it("adds click listener when onWaypointClick is provided", () => {
    const addEventListenerSpy = jest.spyOn(mockDomElement, "addEventListener");
    render(<VobClickHandler onWaypointClick={mockOnWaypointClick} />);
    expect(addEventListenerSpy).toHaveBeenCalledWith("click", expect.any(Function));
    addEventListenerSpy.mockRestore();
  });

  it("adds click listener when onNpcClick is provided", () => {
    const addEventListenerSpy = jest.spyOn(mockDomElement, "addEventListener");
    render(<VobClickHandler onNpcClick={mockOnNpcClick} />);
    expect(addEventListenerSpy).toHaveBeenCalledWith("click", expect.any(Function));
    addEventListenerSpy.mockRestore();
  });

  it("removes click listener on unmount", () => {
    const removeEventListenerSpy = jest.spyOn(mockDomElement, "removeEventListener");
    const { unmount } = render(<VobClickHandler onVobClick={mockOnVobClick} />);
    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("click", expect.any(Function));
    removeEventListenerSpy.mockRestore();
  });

  it("ignores non-left mouse button clicks", () => {
    render(<VobClickHandler onVobClick={mockOnVobClick} />);

    const addEventListenerSpy = jest.spyOn(mockDomElement, "addEventListener");
    render(<VobClickHandler onVobClick={mockOnVobClick} />);
    const clickHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "click",
    )?.[1] as (e: MouseEvent) => void;

    const rightClickEvent = new MouseEvent("click", {
      button: 2, // Right mouse button
      clientX: 400,
      clientY: 300,
    });

    clickHandler(rightClickEvent);
    expect(mockOnVobClick).not.toHaveBeenCalled();
    addEventListenerSpy.mockRestore();
  });

  it("calls onVobClick when clicking on object with VOB reference", () => {
    const mockVob: Vob = {
      id: 123,
      showVisual: true,
      visual: { type: 1, name: "test.MSH" },
      position: { x: 0, y: 0, z: 0 },
      rotation: { toArray: jest.fn(() => ({ size: () => 9, get: jest.fn() })) },
      children: { size: () => 0, get: jest.fn() },
    } as any;

    const mockMesh: any = new THREE.Mesh();
    mockMesh.userData = { vob: mockVob };

    mockScene.children = [mockMesh];

    // Mock raycaster intersection
    const mockIntersect = {
      object: mockMesh,
      distance: 10,
      point: { x: 0, y: 0, z: 0 },
      face: null,
      faceIndex: 0,
      uv: { x: 0, y: 0 },
    };

    const mockRaycaster = {
      setFromCamera: jest.fn(),
      intersectObjects: jest.fn(() => [mockIntersect]),
    };

    jest.spyOn(THREE, "Raycaster").mockImplementation(() => mockRaycaster as any);

    render(<VobClickHandler onVobClick={mockOnVobClick} />);

    const addEventListenerSpy = jest.spyOn(mockDomElement, "addEventListener");
    render(<VobClickHandler onVobClick={mockOnVobClick} />);
    const clickHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "click",
    )?.[1] as (e: MouseEvent) => void;

    const clickEvent = new MouseEvent("click", {
      button: 0,
      clientX: 400,
      clientY: 300,
    });

    clickHandler(clickEvent);

    expect(mockRaycaster.setFromCamera).toHaveBeenCalled();
    expect(mockRaycaster.intersectObjects).toHaveBeenCalledWith(mockScene.children, true);
    expect(mockOnVobClick).toHaveBeenCalledWith(mockVob);

    addEventListenerSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("traverses object hierarchy to find VOB reference", () => {
    const mockVob: Vob = {
      id: 456,
      showVisual: true,
      visual: { type: 1, name: "test2.MSH" },
      position: { x: 0, y: 0, z: 0 },
      rotation: { toArray: jest.fn(() => ({ size: () => 9, get: jest.fn() })) },
      children: { size: () => 0, get: jest.fn() },
    } as any;

    const childMesh: any = new THREE.Mesh();
    const parentGroup: any = new THREE.Group();
    parentGroup.userData = { vob: mockVob };
    parentGroup.add(childMesh);
    childMesh.parent = parentGroup;

    mockScene.children = [parentGroup];

    const mockIntersect = {
      object: childMesh,
      distance: 10,
      point: new THREE.Vector3(),
      face: null,
      faceIndex: 0,
      uv: new THREE.Vector2(),
    };

    const mockRaycaster = {
      setFromCamera: jest.fn(),
      intersectObjects: jest.fn(() => [mockIntersect]),
    };

    jest.spyOn(THREE, "Raycaster").mockImplementation(() => mockRaycaster as any);

    render(<VobClickHandler onVobClick={mockOnVobClick} />);

    const addEventListenerSpy = jest.spyOn(mockDomElement, "addEventListener");
    render(<VobClickHandler onVobClick={mockOnVobClick} />);
    const clickHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "click",
    )?.[1] as (e: MouseEvent) => void;

    const clickEvent = new MouseEvent("click", {
      button: 0,
      clientX: 400,
      clientY: 300,
    });

    clickHandler(clickEvent);

    expect(mockOnVobClick).toHaveBeenCalledWith(mockVob);

    addEventListenerSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("does not call onVobClick when no VOB reference is found", () => {
    const mockMesh = new THREE.Mesh();
    mockMesh.userData = {}; // No VOB reference

    mockScene.children = [mockMesh];

    const mockIntersect = {
      object: mockMesh,
      distance: 10,
      point: { x: 0, y: 0, z: 0 },
      face: null,
      faceIndex: 0,
      uv: { x: 0, y: 0 },
    };

    const mockRaycaster = {
      setFromCamera: jest.fn(),
      intersectObjects: jest.fn(() => [mockIntersect]),
    };

    jest.spyOn(THREE, "Raycaster").mockImplementation(() => mockRaycaster as any);

    render(<VobClickHandler onVobClick={mockOnVobClick} />);

    const addEventListenerSpy = jest.spyOn(mockDomElement, "addEventListener");
    render(<VobClickHandler onVobClick={mockOnVobClick} />);
    const clickHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "click",
    )?.[1] as (e: MouseEvent) => void;

    const clickEvent = new MouseEvent("click", {
      button: 0,
      clientX: 400,
      clientY: 300,
    });

    clickHandler(clickEvent);

    expect(mockOnVobClick).not.toHaveBeenCalled();

    addEventListenerSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("calls onWaypointClick when clicking on object with waypoint reference", () => {
    const mockWaypoint: WayPointData = {
      name: "WP_TEST",
      position: { x: 1, y: 2, z: 3 },
      direction: { x: 0, y: 0, z: 0 },
      water_depth: 0,
      under_water: false,
      free_point: false,
    } as any;

    const mockMesh: any = new THREE.Mesh();
    mockMesh.userData = { waypoint: mockWaypoint };
    mockScene.children = [mockMesh];

    const mockIntersect = {
      object: mockMesh,
      distance: 10,
      point: { x: 0, y: 0, z: 0 },
      face: null,
      faceIndex: 0,
      uv: { x: 0, y: 0 },
    };

    const mockRaycaster = {
      setFromCamera: jest.fn(),
      intersectObjects: jest.fn(() => [mockIntersect]),
    };

    jest.spyOn(THREE, "Raycaster").mockImplementation(() => mockRaycaster as any);

    const addEventListenerSpy = jest.spyOn(mockDomElement, "addEventListener");
    render(<VobClickHandler onWaypointClick={mockOnWaypointClick} />);
    const clickHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "click",
    )?.[1] as (e: MouseEvent) => void;

    const clickEvent = new MouseEvent("click", {
      button: 0,
      clientX: 400,
      clientY: 300,
    });

    clickHandler(clickEvent);

    expect(mockOnWaypointClick).toHaveBeenCalledWith(mockWaypoint);

    addEventListenerSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("calls onNpcClick when clicking on object with NPC reference", () => {
    const mockNpc: any = {
      instanceIndex: 123,
      symbolName: "TEST_NPC",
      name: "Test",
      spawnpoint: "WP_A",
      dailyRoutine: [],
    };

    const childMesh: any = new THREE.Mesh();
    const parentGroup: any = new THREE.Group();
    parentGroup.userData = { npcData: mockNpc };
    parentGroup.add(childMesh);
    childMesh.parent = parentGroup;

    mockScene.children = [parentGroup];

    const mockIntersect = {
      object: childMesh,
      distance: 10,
      point: new THREE.Vector3(),
      face: null,
      faceIndex: 0,
      uv: new THREE.Vector2(),
    };

    const mockRaycaster = {
      setFromCamera: jest.fn(),
      intersectObjects: jest.fn(() => [mockIntersect]),
    };

    jest.spyOn(THREE, "Raycaster").mockImplementation(() => mockRaycaster as any);

    const addEventListenerSpy = jest.spyOn(mockDomElement, "addEventListener");
    render(<VobClickHandler onNpcClick={mockOnNpcClick} />);
    const clickHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "click",
    )?.[1] as (e: MouseEvent) => void;

    const clickEvent = new MouseEvent("click", {
      button: 0,
      clientX: 400,
      clientY: 300,
    });

    clickHandler(clickEvent);

    expect(mockOnNpcClick).toHaveBeenCalledWith(mockNpc, parentGroup);

    addEventListenerSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("calculates mouse coordinates correctly", () => {
    const mockVob: Vob = {
      id: 789,
      showVisual: true,
      visual: { type: 1, name: "test3.MSH" },
      position: { x: 0, y: 0, z: 0 },
      rotation: { toArray: jest.fn(() => ({ size: () => 9, get: jest.fn() })) },
      children: { size: () => 0, get: jest.fn() },
    } as any;

    const mockMesh = new THREE.Mesh();
    mockMesh.userData.vob = mockVob;

    mockScene.children = [mockMesh];

    const mockIntersect = {
      object: mockMesh,
      distance: 10,
      point: { x: 0, y: 0, z: 0 },
      face: null,
      faceIndex: 0,
      uv: { x: 0, y: 0 },
    };

    const mockRaycaster = {
      setFromCamera: jest.fn(),
      intersectObjects: jest.fn(() => [mockIntersect]),
    };

    jest.spyOn(THREE, "Raycaster").mockImplementation(() => mockRaycaster as any);

    render(<VobClickHandler onVobClick={mockOnVobClick} />);

    const addEventListenerSpy = jest.spyOn(mockDomElement, "addEventListener");
    render(<VobClickHandler onVobClick={mockOnVobClick} />);
    const clickHandler = addEventListenerSpy.mock.calls.find(
      (call) => call[0] === "click",
    )?.[1] as (e: MouseEvent) => void;

    // Click at center of canvas (should be 0, 0 in NDC)
    const clickEvent = new MouseEvent("click", {
      button: 0,
      clientX: 400, // Center of 800px width
      clientY: 300, // Center of 600px height
    });

    clickHandler(clickEvent);

    // Verify raycaster was called with correct mouse coordinates
    expect(mockRaycaster.setFromCamera).toHaveBeenCalled();
    const mouseArg = mockRaycaster.setFromCamera.mock.calls[0][0];
    expect(mouseArg.x).toBeCloseTo(0); // (400 - 0) / 800 * 2 - 1 = 0
    expect(mouseArg.y).toBeCloseTo(0); // -((300 - 0) / 600 * 2 - 1) = 0

    addEventListenerSpy.mockRestore();
    jest.restoreAllMocks();
  });
});
