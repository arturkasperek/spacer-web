import { render } from "@testing-library/react";
import * as THREE from "three";
import { NpcRenderer } from "./npc-renderer";

const mockUseThree = jest.fn();
const mockUseFrame = jest.fn();
const mockUsePlayerInput = jest.fn(() => ({ consumeMouseYawDelta: () => 0 }));
const mockCreateStreamingState = jest.fn(() => ({ isFirstUpdate: { current: false } }));
const mockDisposeObject3D = jest.fn();
const mockGetMapKey = jest.fn(() => "npcs-key");
const mockPreloadAnimationSequences = jest.fn();
const mockFetchBinaryCached = jest.fn();
const mockCreateWaypointMover = jest.fn(() => ({ clearForNpc: jest.fn() }));
const mockClearNpcFreepointReservations = jest.fn();
const mockSetFreepointsWorld = jest.fn();
const mockUpdateNpcWorldPosition = jest.fn();
const mockRemoveNpcWorldPosition = jest.fn();
const mockClearNpcEmRuntimeState = jest.fn();
const mockClearNpcEmQueueState = jest.fn();
const mockSetWaynetWaypointPositions = jest.fn();
const mockComputeNpcsWithPositions = jest.fn();
const mockSetPlayerPoseFromObject3D = jest.fn();
const mockCreateTickNpc = jest.fn();
const mockUseNpcManualControl = jest.fn();
const mockUseNpcAnimationState = jest.fn();
const mockUseNpcCombatTick = jest.fn();
const mockUseNpcStreaming = jest.fn();
const mockTickStreamingStage = jest.fn(() => 11);
const mockTickWorldSyncStage = jest.fn();
const mockTickScriptsStage = jest.fn();
const mockTickTeleportDebugStage = jest.fn();
const mockTickCombatStage = jest.fn();
const mockCreateJumpDebugTextSprite = jest.fn(() => ({
  sprite: new THREE.Object3D(),
  setText: jest.fn(),
}));
const mockCreateFreepointOwnerOverlay = jest.fn(() => ({
  dispose: jest.fn(),
  onWorldChanged: jest.fn(),
}));
const mockBuildNpcWorldIndices = jest.fn(() => ({
  waypointPosIndex: new Map<string, THREE.Vector3>(),
  waypointDirIndex: new Map<string, THREE.Quaternion>(),
  vobPosIndex: new Map<string, THREE.Vector3>(),
  vobDirIndex: new Map<string, THREE.Quaternion>(),
}));

jest.mock("three", () => jest.requireActual("three"));

jest.mock("@react-three/fiber", () => ({
  useThree: () => mockUseThree(),
  useFrame: (cb: unknown) => mockUseFrame(cb),
}));

jest.mock("../../player/player-input-context", () => ({
  usePlayerInput: () => mockUsePlayerInput(),
}));

jest.mock("../../world/distance-streaming", () => ({
  createStreamingState: () => mockCreateStreamingState(),
  disposeObject3D: (obj: unknown) => mockDisposeObject3D(obj),
}));

jest.mock("../data/npc-utils", () => ({
  getMapKey: (npcs: unknown) => (mockGetMapKey as any)(npcs),
}));

jest.mock("../../character/animation", () => ({
  preloadAnimationSequences: (...args: unknown[]) => mockPreloadAnimationSequences(...args),
}));

jest.mock("../../character/binary-cache", () => ({
  fetchBinaryCached: (...args: unknown[]) => mockFetchBinaryCached(...args),
}));

jest.mock("../navigation/npc-waypoint-mover", () => ({
  createWaypointMover: (world: unknown) => (mockCreateWaypointMover as any)(world),
}));

jest.mock("../world/npc-freepoints", () => ({
  clearNpcFreepointReservations: (instanceIndex: number) =>
    mockClearNpcFreepointReservations(instanceIndex),
  setFreepointsWorld: (world: unknown) => mockSetFreepointsWorld(world),
  updateNpcWorldPosition: (instanceIndex: number, pos: unknown) =>
    mockUpdateNpcWorldPosition(instanceIndex, pos),
  removeNpcWorldPosition: (instanceIndex: number) => mockRemoveNpcWorldPosition(instanceIndex),
}));

jest.mock("../combat/npc-em-runtime", () => ({
  clearNpcEmRuntimeState: (instanceIndex: number) => mockClearNpcEmRuntimeState(instanceIndex),
}));

jest.mock("../combat/npc-em-queue", () => ({
  clearNpcEmQueueState: (instanceIndex: number) => mockClearNpcEmQueueState(instanceIndex),
}));

jest.mock("../../shared/model-script-registry", () => ({
  ModelScriptRegistry: class {
    startLoadScript = jest.fn();
  },
}));

jest.mock("../physics/npc-physics", () => ({
  NPC_RENDER_TUNING: { manualControlSpeeds: { walk: 1, run: 2, back: 1 } },
  useNpcPhysics: jest.fn(() => ({
    kccConfig: {},
    getNpcVisualRoot: (group: THREE.Group) => group,
    applyMoveConstraint: jest.fn(() => ({ moved: false })),
    trySnapNpcToGroundWithRapier: jest.fn(() => true),
    removeNpcKccCollider: jest.fn(),
  })),
}));

jest.mock("../../world/world-time", () => ({
  useWorldTime: jest.fn(() => ({ hour: 10, minute: 0 })),
}));

jest.mock("../../world/freepoint-owner-overlay", () => ({
  createFreepointOwnerOverlay: (scene: unknown) => (mockCreateFreepointOwnerOverlay as any)(scene),
}));

jest.mock("../world/npc-routine-waybox", () => ({
  buildRoutineWaybox: jest.fn(() => null),
}));

jest.mock("../../waynet/waynet-index", () => ({
  setWaynetWaypointPositions: (positions: unknown) => mockSetWaynetWaypointPositions(positions),
}));

jest.mock("../world/npc-world-indices", () => ({
  buildNpcWorldIndices: (world: unknown) => (mockBuildNpcWorldIndices as any)(world),
}));

jest.mock("./npc-renderer-data", () => ({
  computeNpcsWithPositions: (args: unknown) => mockComputeNpcsWithPositions(args),
}));

jest.mock("./npc-character-loader", () => ({
  loadNpcCharacter: jest.fn(),
}));

jest.mock("../../player/player-runtime", () => ({
  setPlayerPoseFromObject3D: (obj: unknown) => mockSetPlayerPoseFromObject3D(obj),
}));

jest.mock("./npc-tick-npc", () => ({
  createTickNpc: (deps: unknown) => mockCreateTickNpc(deps),
}));

jest.mock("./hooks/use-npc-manual-control", () => ({
  useNpcManualControl: () => mockUseNpcManualControl(),
}));

jest.mock("./hooks/use-npc-animation-state", () => ({
  useNpcAnimationState: (args: unknown) => mockUseNpcAnimationState(args),
}));

jest.mock("./hooks/use-npc-combat-tick", () => ({
  useNpcCombatTick: () => mockUseNpcCombatTick(),
}));

jest.mock("./hooks/use-npc-streaming", () => ({
  useNpcStreaming: (args: unknown) => mockUseNpcStreaming(args),
}));

jest.mock("./npc-frame-stages", () => ({
  tickStreamingStage: (args: unknown) => (mockTickStreamingStage as any)(args),
  tickWorldSyncStage: (args: unknown) => mockTickWorldSyncStage(args),
  tickScriptsStage: (args: unknown) => mockTickScriptsStage(args),
  tickTeleportDebugStage: (args: unknown) => mockTickTeleportDebugStage(args),
  tickCombatStage: (args: unknown) => mockTickCombatStage(args),
}));

jest.mock("./npc-jump-debug-label", () => ({
  createJumpDebugTextSprite: (text: string) => (mockCreateJumpDebugTextSprite as any)(text),
}));

function makeNpcData(instanceIndex: number) {
  return {
    instanceIndex,
    symbolName: `NPC_${instanceIndex}`,
    spawnpoint: `SPAWN_${instanceIndex}`,
    npcInfo: {},
  };
}

describe("npc-renderer", () => {
  let frameCallback: ((state: unknown, delta: number) => void) | undefined;
  const camera = { position: new THREE.Vector3(1, 2, 3) } as unknown as THREE.Camera;
  const scene = { add: jest.fn(), remove: jest.fn() } as unknown as THREE.Scene;
  const world = {} as any;
  const zenKit = {} as any;
  const tickNpc = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    frameCallback = undefined;
    (mockGetMapKey as any).mockImplementation((map: Map<number, unknown>) => `size-${map.size}`);

    mockUseThree.mockReturnValue({ scene, camera });
    mockUseFrame.mockImplementation((cb: (state: unknown, delta: number) => void) => {
      frameCallback = cb;
    });

    mockUseNpcManualControl.mockReturnValue({
      manualControlHeroEnabled: false,
      manualKeysRef: { current: { up: false, down: false, left: false, right: false } },
      manualRunToggleRef: { current: false },
      teleportHeroSeqRef: { current: 0 },
      teleportHeroSeqAppliedRef: { current: 0 },
      manualAttackSeqRef: { current: 0 },
      manualAttackSeqAppliedRef: { current: 0 },
      manualJumpSeqRef: { current: 0 },
      manualJumpSeqAppliedRef: { current: 0 },
    });

    mockUseNpcAnimationState.mockReturnValue({
      estimateAnimationDurationMs: jest.fn(() => 200),
      getNearestWaypointDirectionQuat: jest.fn(() => null),
      getAnimationMetaForNpc: jest.fn(() => null),
      resolveNpcAnimationRef: jest.fn(() => null),
    });

    mockUseNpcCombatTick.mockReturnValue({
      combatRuntimeRef: { current: { update: jest.fn() } },
      attachCombatBindings: jest.fn(),
      runCombatTick: jest.fn(),
    });

    mockUseNpcStreaming.mockReturnValue(jest.fn());
    mockComputeNpcsWithPositions.mockReturnValue([]);
    mockCreateTickNpc.mockReturnValue(tickNpc);
  });

  it("runs only streaming stage when renderer is disabled", () => {
    render(<NpcRenderer world={world} zenKit={zenKit} npcs={new Map()} enabled={false} />);
    frameCallback?.({}, 0.016);

    expect(mockTickStreamingStage).toHaveBeenCalledTimes(1);
    expect(mockTickWorldSyncStage).not.toHaveBeenCalled();
    expect(mockTickScriptsStage).not.toHaveBeenCalled();
    expect(mockTickTeleportDebugStage).not.toHaveBeenCalled();
    expect(tickNpc).not.toHaveBeenCalled();
    expect(mockTickCombatStage).not.toHaveBeenCalled();
  });

  it("runs full frame pipeline in order when enabled and at least one NPC is loaded", () => {
    const npcData = makeNpcData(1);
    const loadedNpc = new THREE.Group();
    loadedNpc.userData = { npcData };
    mockComputeNpcsWithPositions.mockReturnValue([
      {
        npcData,
        position: new THREE.Vector3(0, 0, 0),
        waybox: { minX: -1, minY: -1, minZ: -1, maxX: 1, maxY: 1, maxZ: 1 },
      },
    ]);

    mockUseNpcStreaming.mockImplementation((args: any) => {
      args.loadedNpcsRef.current.set("npc-1", loadedNpc);
      return jest.fn();
    });

    render(<NpcRenderer world={world} zenKit={zenKit} npcs={new Map([[1, npcData]])} />);
    frameCallback?.({}, 0.02);

    expect(mockTickStreamingStage).toHaveBeenCalledTimes(1);
    expect(mockTickWorldSyncStage).toHaveBeenCalledTimes(1);
    expect(mockTickScriptsStage).toHaveBeenCalledTimes(1);
    expect(mockTickTeleportDebugStage).toHaveBeenCalledTimes(1);
    expect(tickNpc).toHaveBeenCalledWith(0.02, 11, camera.position);
    expect(mockTickCombatStage).toHaveBeenCalledTimes(1);

    const streamOrder = mockTickStreamingStage.mock.invocationCallOrder[0];
    const worldOrder = mockTickWorldSyncStage.mock.invocationCallOrder[0];
    const scriptsOrder = mockTickScriptsStage.mock.invocationCallOrder[0];
    const teleportOrder = mockTickTeleportDebugStage.mock.invocationCallOrder[0];
    const npcOrder = tickNpc.mock.invocationCallOrder[0];
    const combatOrder = mockTickCombatStage.mock.invocationCallOrder[0];
    expect(streamOrder).toBeLessThan(worldOrder);
    expect(worldOrder).toBeLessThan(scriptsOrder);
    expect(scriptsOrder).toBeLessThan(teleportOrder);
    expect(teleportOrder).toBeLessThan(npcOrder);
    expect(npcOrder).toBeLessThan(combatOrder);
  });

  it("unloads stale loaded NPCs when they disappear from computed positions", () => {
    const npcData = makeNpcData(1);
    const staleNpcGroup = new THREE.Group();
    const characterInstance = { dispose: jest.fn() };
    staleNpcGroup.userData = { npcData, characterInstance, modelLoading: false };

    mockComputeNpcsWithPositions
      .mockReturnValueOnce([
        {
          npcData,
          position: new THREE.Vector3(0, 0, 0),
          waybox: { minX: -1, minY: -1, minZ: -1, maxX: 1, maxY: 1, maxZ: 1 },
        },
      ])
      .mockReturnValueOnce([]);

    mockUseNpcStreaming.mockImplementation((args: any) => {
      args.loadedNpcsRef.current.set("npc-1", staleNpcGroup);
      return jest.fn();
    });

    const { rerender } = render(
      <NpcRenderer world={world} zenKit={zenKit} npcs={new Map([[1, npcData]])} />,
    );
    rerender(<NpcRenderer world={world} zenKit={zenKit} npcs={new Map()} />);

    expect(mockClearNpcFreepointReservations).toHaveBeenCalledWith(1);
    expect(mockRemoveNpcWorldPosition).toHaveBeenCalledWith(1);
    expect(mockClearNpcEmRuntimeState).toHaveBeenCalledWith(1);
    expect(mockClearNpcEmQueueState).toHaveBeenCalledWith(1);
    expect(characterInstance.dispose).toHaveBeenCalledTimes(1);
    expect(mockDisposeObject3D).toHaveBeenCalledWith(staleNpcGroup);
  });

  it("cleans up loaded NPC instances on unmount", () => {
    const npcData = makeNpcData(2);
    const npcGroup = new THREE.Group();
    const characterInstance = { dispose: jest.fn() };
    npcGroup.userData = { npcData, characterInstance, modelLoading: false };
    const npcsRoot = new THREE.Group();
    mockComputeNpcsWithPositions.mockReturnValue([
      {
        npcData,
        position: new THREE.Vector3(0, 0, 0),
        waybox: { minX: -1, minY: -1, minZ: -1, maxX: 1, maxY: 1, maxZ: 1 },
      },
    ]);

    const removeNpcKccCollider = jest.fn();
    const useNpcPhysics = jest.requireMock("../physics/npc-physics").useNpcPhysics as jest.Mock;
    useNpcPhysics.mockReturnValue({
      kccConfig: {},
      getNpcVisualRoot: (group: THREE.Group) => group,
      applyMoveConstraint: jest.fn(() => ({ moved: false })),
      trySnapNpcToGroundWithRapier: jest.fn(() => true),
      removeNpcKccCollider,
    });

    mockUseNpcStreaming.mockImplementation((args: any) => {
      args.npcsGroupRef.current = npcsRoot;
      args.loadedNpcsRef.current.set("npc-2", npcGroup);
      return jest.fn();
    });

    const { unmount } = render(<NpcRenderer world={world} zenKit={zenKit} npcs={new Map()} />);
    unmount();

    expect(mockSetPlayerPoseFromObject3D).toHaveBeenCalledWith(null);
    expect(scene.remove).toHaveBeenCalledWith(npcsRoot);
    expect(removeNpcKccCollider).toHaveBeenCalledWith(npcGroup);
    expect(characterInstance.dispose).toHaveBeenCalledTimes(1);
    expect(mockDisposeObject3D).toHaveBeenCalledWith(npcGroup);
  });

  it("updates waynet index with plain coordinate map built from waypoint vectors", () => {
    mockBuildNpcWorldIndices.mockReturnValue({
      waypointPosIndex: new Map([
        ["WP_A", new THREE.Vector3(1, 2, 3)],
        ["WP_B", new THREE.Vector3(4, 5, 6)],
      ]),
      waypointDirIndex: new Map<string, THREE.Quaternion>(),
      vobPosIndex: new Map<string, THREE.Vector3>(),
      vobDirIndex: new Map<string, THREE.Quaternion>(),
    });

    render(<NpcRenderer world={world} zenKit={zenKit} npcs={new Map()} />);

    expect(mockSetWaynetWaypointPositions).toHaveBeenCalledTimes(1);
    const arg = mockSetWaynetWaypointPositions.mock.calls[0][0] as Map<
      string,
      { x: number; y: number; z: number }
    >;
    expect(arg.get("WP_A")).toEqual({ x: 1, y: 2, z: 3 });
    expect(arg.get("WP_B")).toEqual({ x: 4, y: 5, z: 6 });
  });
});
