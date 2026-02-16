import {
  tickCombatStage,
  tickScriptsStage,
  tickStreamingStage,
  tickTeleportDebugStage,
  tickWorldSyncStage,
} from "./npc-frame-stages";

const mockUpdateNpcWorldPosition = jest.fn();
const mockTickNpcDaedalusStateLoop = jest.fn();
const mockSetPlayerPoseFromObject3D = jest.fn();

jest.mock("../world/npc-freepoints", () => ({
  updateNpcWorldPosition: (...args: unknown[]) => mockUpdateNpcWorldPosition(...args),
}));

jest.mock("../scripting/npc-daedalus-loop", () => ({
  tickNpcDaedalusStateLoop: (...args: unknown[]) => mockTickNpcDaedalusStateLoop(...args),
}));

jest.mock("../../player/player-runtime", () => ({
  setPlayerPoseFromObject3D: (...args: unknown[]) => mockSetPlayerPoseFromObject3D(...args),
}));

describe("npc-frame-stages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("tickStreamingStage increments frame, updates streaming and overlay", () => {
    const updateNpcStreaming = jest.fn();
    const overlayUpdate = jest.fn();
    const physicsFrame = tickStreamingStage({
      physicsFrameRef: { current: 7 } as any,
      allNpcsRef: {
        current: [{ npcData: { instanceIndex: 1 }, position: { x: 0, y: 0, z: 0 } }],
      } as any,
      updateNpcStreaming,
      freepointOwnerOverlayRef: { current: { update: overlayUpdate } } as any,
      enabled: true,
    });

    expect(physicsFrame).toBe(8);
    expect(updateNpcStreaming).toHaveBeenCalledTimes(1);
    expect(overlayUpdate).toHaveBeenCalledWith(true);
  });

  it("tickStreamingStage skips streaming update when no NPCs", () => {
    const updateNpcStreaming = jest.fn();
    const overlayUpdate = jest.fn();
    tickStreamingStage({
      physicsFrameRef: { current: 0 } as any,
      allNpcsRef: { current: [] } as any,
      updateNpcStreaming,
      freepointOwnerOverlayRef: { current: { update: overlayUpdate } } as any,
      enabled: false,
    });

    expect(updateNpcStreaming).not.toHaveBeenCalled();
    expect(overlayUpdate).toHaveBeenCalledWith(false);
  });

  it("tickWorldSyncStage updates only valid and non-disposed NPCs", () => {
    const valid = {
      position: { x: 1, y: 2, z: 3 },
      userData: { npcData: { instanceIndex: 11 }, isDisposed: false },
    };
    const disposed = {
      position: { x: 4, y: 5, z: 6 },
      userData: { npcData: { instanceIndex: 12 }, isDisposed: true },
    };
    const missingNpcData = {
      position: { x: 7, y: 8, z: 9 },
      userData: { isDisposed: false },
    };

    tickWorldSyncStage({
      loadedNpcsRef: {
        current: new Map([
          ["a", valid as any],
          ["b", disposed as any],
          ["c", missingNpcData as any],
        ]),
      } as any,
      waypointMoverRef: { current: null } as any,
      playerGroupRef: { current: null } as any,
    });

    expect(mockUpdateNpcWorldPosition).toHaveBeenCalledTimes(1);
    expect(mockUpdateNpcWorldPosition).toHaveBeenCalledWith(11, { x: 1, y: 2, z: 3 });
  });

  it("tickScriptsStage runs Daedalus loop and syncs player pose", () => {
    const loadedNpcsRef = { current: new Map() } as any;
    const waypointMoverRef = { current: { id: "mover" } } as any;
    const player = { userData: { isPlayer: true } };
    const playerGroupRef = { current: player } as any;

    tickScriptsStage({ loadedNpcsRef, waypointMoverRef, playerGroupRef });

    expect(mockTickNpcDaedalusStateLoop).toHaveBeenCalledWith({
      loadedNpcsRef,
      waypointMoverRef,
    });
    expect(mockSetPlayerPoseFromObject3D).toHaveBeenCalledWith(player);
  });

  it("tickTeleportDebugStage teleports and resets KCC state when sequence changed", () => {
    const player = {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { copy: jest.fn() },
      userData: {},
    };
    const camera = {
      position: { x: 10, y: 20, z: 30 },
      getWorldDirection: (v: { x: number; y: number; z: number }) => {
        v.x = 0;
        v.y = 0;
        v.z = -1;
      },
    };
    const tmpTeleportForward = {
      x: 0,
      y: 0,
      z: 0,
      lengthSq: () => 1,
      set: jest.fn(),
      normalize: jest.fn(),
    };
    const tmpTeleportDesiredQuat = { setFromAxisAngle: jest.fn() };
    const persistNpcPosition = jest.fn();
    const teleportHeroSeqAppliedRef = { current: 1 } as any;
    const teleportHeroSeqRef = { current: 2 } as any;

    tickTeleportDebugStage({
      teleportHeroSeqAppliedRef,
      teleportHeroSeqRef,
      playerGroupRef: { current: player as any } as any,
      camera: camera as any,
      tmpTeleportForward: tmpTeleportForward as any,
      tmpTeleportDesiredQuat: tmpTeleportDesiredQuat as any,
      tmpManualUp: { x: 0, y: 1, z: 0 } as any,
      persistNpcPosition,
    });

    expect(player.position.x).toBe(10);
    expect(player.position.y).toBe(70);
    expect(player.position.z).toBe(-190);
    const userData = player.userData as any;
    expect(userData._kccGrounded).toBe(false);
    expect(userData._kccStableGrounded).toBe(false);
    expect(userData._kccSnapped).toBe(false);
    expect(userData._kccVy).toBe(0);
    expect(userData.isFalling).toBe(true);
    expect(userData.isSliding).toBe(false);
    expect(persistNpcPosition).toHaveBeenCalledWith(player);
    expect(teleportHeroSeqAppliedRef.current).toBe(2);
  });

  it("tickTeleportDebugStage does nothing when sequence has not changed", () => {
    const persistNpcPosition = jest.fn();
    tickTeleportDebugStage({
      teleportHeroSeqAppliedRef: { current: 3 } as any,
      teleportHeroSeqRef: { current: 3 } as any,
      playerGroupRef: { current: null } as any,
      camera: {} as any,
      tmpTeleportForward: {} as any,
      tmpTeleportDesiredQuat: {} as any,
      tmpManualUp: {} as any,
      persistNpcPosition,
    });

    expect(persistNpcPosition).not.toHaveBeenCalled();
  });

  it("tickCombatStage delegates to runCombatTick", () => {
    const g1 = { id: "a" };
    const g2 = { id: "b" };
    const loadedNpcsRef = {
      current: new Map([
        ["a", g1 as any],
        ["b", g2 as any],
      ]),
    } as any;
    const runCombatTick = jest.fn();
    const resolveNpcAnimationRef = jest.fn();

    tickCombatStage({
      delta: 0.016,
      loadedNpcsRef,
      runCombatTick,
      resolveNpcAnimationRef,
    });

    expect(runCombatTick).toHaveBeenCalledTimes(1);
    const [deltaArg, iterableArg, resolverArg] = runCombatTick.mock.calls[0];
    expect(deltaArg).toBe(0.016);
    expect(Array.from(iterableArg as Iterable<unknown>)).toEqual([g1, g2]);
    expect(resolverArg).toBe(resolveNpcAnimationRef);
  });
});
