import { tickJumpAnimationFsm } from "./npc-jump-fsm";
import {
  getNpcRuntimeValue,
  setNpcRuntimeValue,
  type NpcRendererUserData,
} from "./npc-runtime-state";

function makeUserData(): NpcRendererUserData {
  return {} as NpcRendererUserData;
}

describe("npc-jump-fsm", () => {
  it("starts jump when jump is active and animation is not active", () => {
    const ud = makeUserData();
    setNpcRuntimeValue(ud, "kccJumpActive", true);
    setNpcRuntimeValue(ud, "kccJumpAnimActive", false);

    const onStartJumpAnimation = jest.fn();
    const onTickActiveJumpAnimation = jest.fn();
    const onExitJumpAnimation = jest.fn();

    tickJumpAnimationFsm({
      userData: ud,
      jumpActive: true,
      onStartJumpAnimation,
      onTickActiveJumpAnimation,
      onExitJumpAnimation,
    });

    expect(onStartJumpAnimation).toHaveBeenCalledTimes(1);
    expect(onTickActiveJumpAnimation).not.toHaveBeenCalled();
    expect(onExitJumpAnimation).not.toHaveBeenCalled();
    expect(getNpcRuntimeValue(ud, "jumpAnimState")).toBe("start");
  });

  it("ticks active animation and transitions start -> loop", () => {
    const ud = makeUserData();
    setNpcRuntimeValue(ud, "kccJumpType", "jump_forward");
    setNpcRuntimeValue(ud, "jumpAnimState", "start");
    setNpcRuntimeValue(ud, "kccJumpAnimActive", true);

    const onTickActiveJumpAnimation = jest.fn();

    tickJumpAnimationFsm({
      userData: ud,
      jumpActive: true,
      onStartJumpAnimation: jest.fn(),
      onTickActiveJumpAnimation,
      onExitJumpAnimation: jest.fn(),
    });

    expect(onTickActiveJumpAnimation).toHaveBeenCalledTimes(1);
    expect(getNpcRuntimeValue(ud, "jumpAnimState")).toBe("loop");
  });

  it("transitions high jump loop -> hang when hang has been played", () => {
    const ud = makeUserData();
    setNpcRuntimeValue(ud, "kccJumpType", "jump_up_high");
    setNpcRuntimeValue(ud, "jumpAnimState", "loop");
    setNpcRuntimeValue(ud, "kccJumpAnimActive", true);
    setNpcRuntimeValue(ud, "kccJumpHighHangPlayed", true);

    tickJumpAnimationFsm({
      userData: ud,
      jumpActive: true,
      onStartJumpAnimation: jest.fn(),
      onTickActiveJumpAnimation: jest.fn(),
      onExitJumpAnimation: jest.fn(),
    });

    expect(getNpcRuntimeValue(ud, "jumpAnimState")).toBe("hang");
  });

  it("transitions to exit when high jump stand has been played", () => {
    const ud = makeUserData();
    setNpcRuntimeValue(ud, "kccJumpType", "jump_up_high");
    setNpcRuntimeValue(ud, "jumpAnimState", "hang");
    setNpcRuntimeValue(ud, "kccJumpAnimActive", true);
    setNpcRuntimeValue(ud, "kccJumpHighStandPlayed", true);

    tickJumpAnimationFsm({
      userData: ud,
      jumpActive: true,
      onStartJumpAnimation: jest.fn(),
      onTickActiveJumpAnimation: jest.fn(),
      onExitJumpAnimation: jest.fn(),
    });

    expect(getNpcRuntimeValue(ud, "jumpAnimState")).toBe("exit");
  });

  it("calls exit and sets state exit when jump deactivates during active jump animation", () => {
    const ud = makeUserData();
    setNpcRuntimeValue(ud, "jumpAnimState", "loop");
    setNpcRuntimeValue(ud, "kccJumpAnimActive", true);

    const onExitJumpAnimation = jest.fn();

    tickJumpAnimationFsm({
      userData: ud,
      jumpActive: false,
      onStartJumpAnimation: jest.fn(),
      onTickActiveJumpAnimation: jest.fn(),
      onExitJumpAnimation,
    });

    expect(onExitJumpAnimation).toHaveBeenCalledTimes(1);
    expect(getNpcRuntimeValue(ud, "jumpAnimState")).toBe("exit");
  });

  it("resets non-idle state to idle when jump is inactive and no active jump animation exists", () => {
    const ud = makeUserData();
    setNpcRuntimeValue(ud, "jumpAnimState", "exit");
    setNpcRuntimeValue(ud, "kccJumpAnimActive", false);

    tickJumpAnimationFsm({
      userData: ud,
      jumpActive: false,
      onStartJumpAnimation: jest.fn(),
      onTickActiveJumpAnimation: jest.fn(),
      onExitJumpAnimation: jest.fn(),
    });

    expect(getNpcRuntimeValue(ud, "jumpAnimState")).toBe("idle");
  });

  it("uses played flags for low/mid jumps to transition into exit", () => {
    const low = makeUserData();
    setNpcRuntimeValue(low, "kccJumpType", "jump_up_low");
    setNpcRuntimeValue(low, "kccJumpAnimActive", true);
    setNpcRuntimeValue(low, "kccJumpLowStandPlayed", true);

    tickJumpAnimationFsm({
      userData: low,
      jumpActive: true,
      onStartJumpAnimation: jest.fn(),
      onTickActiveJumpAnimation: jest.fn(),
      onExitJumpAnimation: jest.fn(),
    });
    expect(getNpcRuntimeValue(low, "jumpAnimState")).toBe("exit");

    const mid = makeUserData();
    setNpcRuntimeValue(mid, "kccJumpType", "jump_up_mid");
    setNpcRuntimeValue(mid, "kccJumpAnimActive", true);
    setNpcRuntimeValue(mid, "kccJumpMidStandPlayed", true);

    tickJumpAnimationFsm({
      userData: mid,
      jumpActive: true,
      onStartJumpAnimation: jest.fn(),
      onTickActiveJumpAnimation: jest.fn(),
      onExitJumpAnimation: jest.fn(),
    });
    expect(getNpcRuntimeValue(mid, "jumpAnimState")).toBe("exit");
  });
});
