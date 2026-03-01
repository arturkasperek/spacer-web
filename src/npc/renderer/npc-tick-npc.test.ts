import { createTickNpc, type CreateTickNpcDeps } from "./npc-tick-npc";
import { updateNpcEventManager } from "../combat/npc-em-runtime";

jest.mock("../combat/npc-em-runtime", () => ({
  updateNpcEventManager: jest.fn(),
}));

jest.mock("../physics/npc-physics", () => ({
  NPC_RENDER_TUNING: { jumpUpHighJumpUpPhaseSeconds: 0.3 },
}));

type MockCharacterInstance = {
  object: {
    userData: Record<string, unknown>;
  };
  update: jest.Mock;
  setAnimation: jest.Mock;
  dispose: jest.Mock;
};

function makeNpcData(instanceIndex = 1) {
  return {
    instanceIndex,
    symbolName: `NPC_${instanceIndex}`,
    spawnpoint: "SPAWN",
    npcInfo: {},
  };
}

function makeCharacterInstance(): MockCharacterInstance {
  return {
    object: { userData: {} },
    update: jest.fn(),
    setAnimation: jest.fn(),
    dispose: jest.fn(),
  };
}

function makeNpcGroup() {
  return {
    userData: {},
    position: { x: 0, y: 0, z: 0 },
    quaternion: {},
    children: [],
    visible: true,
  } as any;
}

function makeDeps(npcGroup: any): CreateTickNpcDeps {
  return {
    loadedNpcsRef: { current: new Map([["npc-1", npcGroup]]) },
    getNpcVisualRoot: (group) => group,
    playerGroupRef: { current: null },
    hideHero: false,
    showJumpDebugRange: false,
    ensureJumpDebugLabel: () => ({
      root: { visible: false, lookAt: () => {} } as any,
      setText: () => {},
    }),
    attachCombatBindings: jest.fn(),
    manualControlHeroEnabled: false,
    trySnapNpcToGroundWithRapier: jest.fn(() => true),
    playerInput: { consumeMouseYawDelta: () => 0 },
    manualAttackSeqRef: { current: 0 },
    manualAttackSeqAppliedRef: { current: 0 },
    manualJumpSeqRef: { current: 0 },
    manualJumpSeqAppliedRef: { current: 0 },
    combatRuntimeRef: {
      current: {
        ensureNpc: jest.fn(),
        requestMeleeAttack: jest.fn(() => true),
        getState: jest.fn(() => ({})),
        update: jest.fn(),
      },
    },
    resolveNpcAnimationRef: (_idx, name) => ({
      animationName: name,
      modelName: "HUMANS",
      blendInMs: 50,
      blendOutMs: 50,
    }),
    manualKeysRef: { current: { up: false, down: false, left: false, right: false } },
    manualRunToggleRef: { current: false },
    manualControlSpeeds: { walk: 1, run: 2, back: 1 },
    tmpManualForward: {} as any,
    tmpEmRootMotionWorld: {} as any,
    tmpManualDesiredQuat: {} as any,
    tmpManualUp: {} as any,
    applyMoveConstraint: jest.fn(() => ({ moved: false })),
    waypointMoverRef: { current: null },
    estimateAnimationDurationMs: jest.fn(() => 300),
    getNearestWaypointDirectionQuat: jest.fn(() => null),
    getAnimationMetaForNpc: jest.fn(() => null),
    kccConfig: {
      fallEntryDelaySeconds: 0,
      fallDownHeight: 100,
      slideEntryDelaySeconds: 0,
    },
    motionDebugLastRef: { current: undefined },
  };
}

describe("npc-tick-npc / animation stage", () => {
  const updateNpcEventManagerMock = updateNpcEventManager as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    updateNpcEventManagerMock.mockReturnValue({ moved: false, mode: "idle" });
  });

  it("starts jump_up_low animation when jump becomes active", () => {
    const npcGroup = makeNpcGroup();
    const instance = makeCharacterInstance();
    npcGroup.userData.npcData = makeNpcData(1);
    npcGroup.userData.characterInstance = instance;
    npcGroup.userData.locomotion = { update: jest.fn() };
    npcGroup.userData._kccJumpActive = true;
    npcGroup.userData._kccJumpType = "jump_up_low";

    const tick = createTickNpc(makeDeps(npcGroup));
    tick(0.016, 1, { x: 0, y: 0, z: 0 } as any);

    expect(instance.setAnimation).toHaveBeenCalledTimes(1);
    const [name, opts] = instance.setAnimation.mock.calls[0];
    expect(name).toBe("T_STAND_2_JUMPUPLOW");
    expect(opts.next.animationName).toBe("S_JUMPUPLOW");
    expect(npcGroup.userData._kccJumpAnimActive).toBe(true);
  });

  it("advances jump_up_low to stand transition when low stand timer elapses", () => {
    const npcGroup = makeNpcGroup();
    const instance = makeCharacterInstance();
    instance.object.userData.__currentAnimationName = "S_JUMPUPLOW";
    npcGroup.userData.npcData = makeNpcData(1);
    npcGroup.userData.characterInstance = instance;
    npcGroup.userData.locomotion = { update: jest.fn() };
    npcGroup.userData._kccJumpActive = true;
    npcGroup.userData._kccJumpAnimActive = true;
    npcGroup.userData._kccJumpType = "jump_up_low";
    npcGroup.userData._kccJumpLowStandAtMs = Date.now() - 1;
    npcGroup.userData._kccJumpLowStandPlayed = false;

    const tick = createTickNpc(makeDeps(npcGroup));
    tick(0.016, 1, { x: 0, y: 0, z: 0 } as any);

    expect(instance.setAnimation).toHaveBeenCalledTimes(1);
    expect(instance.setAnimation.mock.calls[0][0]).toBe("T_JUMPUPLOW_2_STAND");
    expect(npcGroup.userData._kccJumpLowStandPlayed).toBe(true);
  });

  it("exits jump animation to running locomotion when jump ends during run", () => {
    const npcGroup = makeNpcGroup();
    const instance = makeCharacterInstance();
    const locomotion = { update: jest.fn() };
    npcGroup.userData.npcData = makeNpcData(1);
    npcGroup.userData.characterInstance = instance;
    npcGroup.userData.locomotion = locomotion;
    npcGroup.userData._kccJumpActive = false;
    npcGroup.userData._kccJumpAnimActive = true;
    npcGroup.userData._kccJumpType = "jump_forward";
    npcGroup.userData._kccJumpStartWasRun = true;
    updateNpcEventManagerMock.mockReturnValue({ moved: false, mode: "run" });

    const tick = createTickNpc(makeDeps(npcGroup));
    tick(0.016, 1, { x: 0, y: 0, z: 0 } as any);

    expect(instance.setAnimation).toHaveBeenCalledTimes(1);
    const [name, opts] = instance.setAnimation.mock.calls[0];
    expect(name).toBe("s_RunL");
    expect(opts.blendInMs).toBe(200);
    expect(opts.blendOutMs).toBe(200);
    expect(locomotion.update).toHaveBeenCalledTimes(1);
  });

  it("uses fallDown locomotion mode when falling with short drop", () => {
    const npcGroup = makeNpcGroup();
    const instance = makeCharacterInstance();
    const locomotion = { update: jest.fn() };
    npcGroup.userData.npcData = makeNpcData(1);
    npcGroup.userData.characterInstance = instance;
    npcGroup.userData.locomotion = locomotion;
    npcGroup.userData.isFalling = true;
    npcGroup.userData._wasFalling = true;
    npcGroup.userData._fallDownStartY = 100;
    npcGroup.userData._fallDownMinY = 90;
    npcGroup.position.y = 90;

    const tick = createTickNpc(makeDeps(npcGroup));
    tick(0.016, 1, { x: 0, y: 0, z: 0 } as any);

    expect(locomotion.update).toHaveBeenCalledTimes(1);
    expect(locomotion.update.mock.calls[0][1]).toBe("fallDown");
  });

  it("starts jump_forward with run start animation when locomotion mode is run", () => {
    const npcGroup = makeNpcGroup();
    const instance = makeCharacterInstance();
    npcGroup.userData.npcData = makeNpcData(1);
    npcGroup.userData.characterInstance = instance;
    npcGroup.userData.locomotion = { update: jest.fn() };
    npcGroup.userData._kccJumpActive = true;
    npcGroup.userData._kccJumpType = "jump_forward";
    updateNpcEventManagerMock.mockReturnValue({ moved: false, mode: "run" });

    const tick = createTickNpc(makeDeps(npcGroup));
    tick(0.016, 1, { x: 0, y: 0, z: 0 } as any);

    expect(instance.setAnimation).toHaveBeenCalledTimes(1);
    const [name, opts] = instance.setAnimation.mock.calls[0];
    expect(name).toBe("T_RUNL_2_JUMP");
    expect(opts.next.animationName).toBe("S_JUMP");
    expect(opts.next.loop).toBe(true);
    expect(npcGroup.userData._kccJumpStartWasRun).toBe(true);
  });

  it("advances jump_up_mid to stand transition when mid stand timer elapses", () => {
    const npcGroup = makeNpcGroup();
    const instance = makeCharacterInstance();
    instance.object.userData.__currentAnimationName = "S_JUMPUPMID";
    npcGroup.userData.npcData = makeNpcData(1);
    npcGroup.userData.characterInstance = instance;
    npcGroup.userData.locomotion = { update: jest.fn() };
    npcGroup.userData._kccJumpActive = true;
    npcGroup.userData._kccJumpAnimActive = true;
    npcGroup.userData._kccJumpType = "jump_up_mid";
    npcGroup.userData._kccJumpMidStandAtMs = Date.now() - 1;
    npcGroup.userData._kccJumpMidStandPlayed = false;

    const tick = createTickNpc(makeDeps(npcGroup));
    tick(0.016, 1, { x: 0, y: 0, z: 0 } as any);

    expect(instance.setAnimation).toHaveBeenCalledTimes(1);
    expect(instance.setAnimation.mock.calls[0][0]).toBe("T_JUMPUPMID_2_STAND");
    expect(npcGroup.userData._kccJumpMidStandPlayed).toBe(true);
  });

  it("advances jump_up_high from S_JUMPUP to S_HANG when hang timer elapses", () => {
    const npcGroup = makeNpcGroup();
    const instance = makeCharacterInstance();
    instance.object.userData.__currentAnimationName = "S_JUMPUP";
    npcGroup.userData.npcData = makeNpcData(1);
    npcGroup.userData.characterInstance = instance;
    npcGroup.userData.locomotion = { update: jest.fn() };
    npcGroup.userData._kccJumpActive = true;
    npcGroup.userData._kccJumpAnimActive = true;
    npcGroup.userData._kccJumpType = "jump_up_high";
    npcGroup.userData._kccJumpHighHangAtMs = Date.now() - 1;
    npcGroup.userData._kccJumpHighHangPlayed = false;

    const tick = createTickNpc(makeDeps(npcGroup));
    tick(0.016, 1, { x: 0, y: 0, z: 0 } as any);

    expect(instance.setAnimation).toHaveBeenCalledTimes(1);
    expect(instance.setAnimation.mock.calls[0][0]).toBe("S_HANG");
    expect(npcGroup.userData._kccJumpHighHangPlayed).toBe(true);
  });

  it("advances jump_up_high from S_HANG to stand transition when stand timer elapses", () => {
    const npcGroup = makeNpcGroup();
    const instance = makeCharacterInstance();
    instance.object.userData.__currentAnimationName = "S_HANG";
    npcGroup.userData.npcData = makeNpcData(1);
    npcGroup.userData.characterInstance = instance;
    npcGroup.userData.locomotion = { update: jest.fn() };
    npcGroup.userData._kccJumpActive = true;
    npcGroup.userData._kccJumpAnimActive = true;
    npcGroup.userData._kccJumpType = "jump_up_high";
    npcGroup.userData._kccJumpHighHangPlayed = true;
    npcGroup.userData._kccJumpHighStandAtMs = Date.now() - 1;
    npcGroup.userData._kccJumpHighStandPlayed = false;

    const tick = createTickNpc(makeDeps(npcGroup));
    tick(0.016, 1, { x: 0, y: 0, z: 0 } as any);

    expect(instance.setAnimation).toHaveBeenCalledTimes(1);
    expect(instance.setAnimation.mock.calls[0][0]).toBe("T_HANG_2_STAND");
    expect(npcGroup.userData._kccJumpHighStandPlayed).toBe(true);
  });

  it("applies script idle animation when locomotion is idle and no jump is active", () => {
    const npcGroup = makeNpcGroup();
    const instance = makeCharacterInstance();
    const locomotion = { update: jest.fn() };
    npcGroup.userData.npcData = makeNpcData(1);
    npcGroup.userData.characterInstance = instance;
    npcGroup.userData.locomotion = locomotion;
    npcGroup.userData._emIdleAnimation = "S_SIT";
    npcGroup.userData._kccJumpActive = false;
    updateNpcEventManagerMock.mockReturnValue({ moved: false, mode: "idle" });

    const tick = createTickNpc(makeDeps(npcGroup));
    tick(0.016, 1, { x: 0, y: 0, z: 0 } as any);

    expect(instance.setAnimation).toHaveBeenCalledTimes(1);
    expect(instance.setAnimation.mock.calls[0][0]).toBe("S_SIT");
    expect(locomotion.update).not.toHaveBeenCalled();
  });
});
