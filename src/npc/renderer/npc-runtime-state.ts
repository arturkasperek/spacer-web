import type * as THREE from "three";
import type { NpcData } from "../../shared/types";
import type { CharacterInstance } from "../../character/character-instance";
import type { LocomotionController } from "../physics/npc-locomotion";

type RawUserData = Record<string, unknown>;

export type NpcJumpType = "jump_forward" | "jump_up_low" | "jump_up_mid" | "jump_up_high";
export type NpcJumpAnimState = "idle" | "start" | "loop" | "hang" | "exit";

export type NpcJumpDecision = {
  type?: string;
  canJump?: boolean;
  reason?: string;
  ledgeHeight?: number | null;
  obstacleDistance?: number | null;
  ceilingClearance?: number | null;
  fullWall?: boolean;
};

export type NpcLedgeBest = {
  value?: number;
  ledgeHeight?: number;
};

export type NpcRuntimeState = {
  jumpDebugLabelRoot?: THREE.Object3D;
  jumpDebugLabelSetText?: (text: string) => void;
  jumpDecision?: NpcJumpDecision;
  ledgeBest?: NpcLedgeBest | null;
  jumpAnimState?: NpcJumpAnimState;
  manualSuppressLocomotion?: boolean;
  manualTurnAnim?: string;
  manualWasTurningInPlace?: boolean;
  manualLastTurnAtMs?: number;
  manualLastTurnSign?: number;
  manualLeanRoll?: number;
  emSuppressLocomotion?: boolean;
  emIdleAnimation?: string;
  kccJumpActive?: boolean;
  kccJumpType?: NpcJumpType | string;
  kccJumpAnimActive?: boolean;
  kccJumpRequest?: { atMs: number; jumpType: string };
  kccJumpBlockedReason?: string;
  kccIgnoreInputUntilMs?: number;
  kccLastFrame?: number;
  kccJumpStartWasRun?: boolean;
  kccJumpMinAirMs?: number;
  kccJumpBlockUntilMs?: number;
  kccJumpLowStandAtMs?: number;
  kccJumpLowStandPlayed?: boolean;
  kccJumpMidStandAtMs?: number;
  kccJumpMidStandPlayed?: boolean;
  kccJumpHighHangAtMs?: number;
  kccJumpHighHangPlayed?: boolean;
  kccJumpHighStandAtMs?: number;
  kccJumpHighStandPlayed?: boolean;
  kccStableGrounded?: boolean;
  kccGrounded?: boolean;
  kccFallFor?: number;
  kccSkipFallDownPhase?: boolean;
  kccForceFallMode?: boolean;
  kccSlideFor?: number;
  wasFalling?: boolean;
  fallDownStartY?: number;
  fallDownMinY?: number;
  fallDownDistY?: number;
  fallAnimT?: number;
  kccDbg?: unknown;
  fallDbg?: unknown;
  slideDbg?: unknown;
};

type RuntimeField = keyof NpcRuntimeState;

const RUNTIME_KEY_MAP: Record<RuntimeField, string> = {
  jumpDebugLabelRoot: "_jumpDebugLabelRoot",
  jumpDebugLabelSetText: "_jumpDebugLabelSetText",
  jumpDecision: "_kccJumpDecision",
  ledgeBest: "_kccLedgeBest",
  jumpAnimState: "_kccJumpAnimState",
  manualSuppressLocomotion: "_manualSuppressLocomotion",
  manualTurnAnim: "_manualTurnAnim",
  manualWasTurningInPlace: "_manualWasTurningInPlace",
  manualLastTurnAtMs: "_manualLastTurnAtMs",
  manualLastTurnSign: "_manualLastTurnSign",
  manualLeanRoll: "_manualLeanRoll",
  emSuppressLocomotion: "_emSuppressLocomotion",
  emIdleAnimation: "_emIdleAnimation",
  kccJumpActive: "_kccJumpActive",
  kccJumpType: "_kccJumpType",
  kccJumpAnimActive: "_kccJumpAnimActive",
  kccJumpRequest: "_kccJumpRequest",
  kccJumpBlockedReason: "_kccJumpBlockedReason",
  kccIgnoreInputUntilMs: "_kccIgnoreInputUntilMs",
  kccLastFrame: "_kccLastFrame",
  kccJumpStartWasRun: "_kccJumpStartWasRun",
  kccJumpMinAirMs: "_kccJumpMinAirMs",
  kccJumpBlockUntilMs: "_kccJumpBlockUntilMs",
  kccJumpLowStandAtMs: "_kccJumpLowStandAtMs",
  kccJumpLowStandPlayed: "_kccJumpLowStandPlayed",
  kccJumpMidStandAtMs: "_kccJumpMidStandAtMs",
  kccJumpMidStandPlayed: "_kccJumpMidStandPlayed",
  kccJumpHighHangAtMs: "_kccJumpHighHangAtMs",
  kccJumpHighHangPlayed: "_kccJumpHighHangPlayed",
  kccJumpHighStandAtMs: "_kccJumpHighStandAtMs",
  kccJumpHighStandPlayed: "_kccJumpHighStandPlayed",
  kccStableGrounded: "_kccStableGrounded",
  kccGrounded: "_kccGrounded",
  kccFallFor: "_kccFallFor",
  kccSkipFallDownPhase: "_kccSkipFallDownPhase",
  kccForceFallMode: "_kccForceFallMode",
  kccSlideFor: "_kccSlideFor",
  wasFalling: "_wasFalling",
  fallDownStartY: "_fallDownStartY",
  fallDownMinY: "_fallDownMinY",
  fallDownDistY: "_fallDownDistY",
  fallAnimT: "_fallAnimT",
  kccDbg: "_kccDbg",
  fallDbg: "_fallDbg",
  slideDbg: "_slideDbg",
};

export type NpcRendererUserData = RawUserData & {
  npcData?: NpcData;
  characterInstance?: CharacterInstance;
  modelLoading?: boolean;
  modelRetryVisualVersion?: number;
  visualRoot?: THREE.Object3D;
  healthBar?: {
    root?: THREE.Object3D;
    fill?: THREE.Object3D;
    width?: number;
    setText?: (text: string) => void;
  };
  locomotion?: LocomotionController;
  isDisposed?: boolean;
  isFalling?: boolean;
  isSliding?: boolean;
  isPlayer?: boolean;
  lastMoveDirXZ?: { x: number; z: number };
};

export function ensureNpcUserData(target: THREE.Object3D): NpcRendererUserData {
  if (!target.userData) target.userData = {};
  return target.userData as NpcRendererUserData;
}

export function getNpcRuntimeValue<K extends RuntimeField>(
  userData: RawUserData,
  key: K,
): NpcRuntimeState[K] {
  return userData[RUNTIME_KEY_MAP[key]] as NpcRuntimeState[K];
}

export function setNpcRuntimeValue<K extends RuntimeField>(
  userData: RawUserData,
  key: K,
  value: NpcRuntimeState[K],
) {
  userData[RUNTIME_KEY_MAP[key]] = value as unknown;
}

export function clearNpcRuntimeValue(userData: RawUserData, key: RuntimeField) {
  delete userData[RUNTIME_KEY_MAP[key]];
}
