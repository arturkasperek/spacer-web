import {
  getNpcRuntimeValue,
  setNpcRuntimeValue,
  type NpcJumpAnimState,
  type NpcRendererUserData,
} from "./npc-runtime-state";

function resolveJumpType(ud: NpcRendererUserData) {
  const jumpType = String(getNpcRuntimeValue(ud, "kccJumpType") ?? "jump_forward");
  if (jumpType === "jump_up_low") return "jump_up_low";
  if (jumpType === "jump_up_mid") return "jump_up_mid";
  if (jumpType === "jump_up_high") return "jump_up_high";
  return "jump_forward";
}

function resolveStateFromFlags(
  ud: NpcRendererUserData,
  fallback: NpcJumpAnimState,
): NpcJumpAnimState {
  const jumpType = resolveJumpType(ud);
  if (jumpType === "jump_up_low" && getNpcRuntimeValue(ud, "kccJumpLowStandPlayed")) return "exit";
  if (jumpType === "jump_up_mid" && getNpcRuntimeValue(ud, "kccJumpMidStandPlayed")) return "exit";
  if (jumpType === "jump_up_high") {
    if (getNpcRuntimeValue(ud, "kccJumpHighStandPlayed")) return "exit";
    if (getNpcRuntimeValue(ud, "kccJumpHighHangPlayed")) return "hang";
    return "loop";
  }
  return fallback;
}

export function tickJumpAnimationFsm(params: {
  userData: NpcRendererUserData;
  jumpActive: boolean;
  onStartJumpAnimation: () => void;
  onTickActiveJumpAnimation: () => void;
  onExitJumpAnimation: () => void;
}) {
  const {
    userData: ud,
    jumpActive,
    onStartJumpAnimation,
    onTickActiveJumpAnimation,
    onExitJumpAnimation,
  } = params;

  const current = (getNpcRuntimeValue(ud, "jumpAnimState") ?? "idle") as NpcJumpAnimState;
  const jumpAnimActive = Boolean(getNpcRuntimeValue(ud, "kccJumpAnimActive"));

  if (!jumpActive) {
    if (jumpAnimActive) {
      onExitJumpAnimation();
      setNpcRuntimeValue(ud, "jumpAnimState", "exit");
    } else if (current !== "idle") {
      setNpcRuntimeValue(ud, "jumpAnimState", "idle");
    }
    return;
  }

  if (!jumpAnimActive) {
    onStartJumpAnimation();
    setNpcRuntimeValue(ud, "jumpAnimState", "start");
    return;
  }

  onTickActiveJumpAnimation();
  const base =
    current === "idle" || current === "exit" ? "start" : current === "start" ? "loop" : current;
  const next = resolveStateFromFlags(ud, base);
  setNpcRuntimeValue(ud, "jumpAnimState", next);
}
