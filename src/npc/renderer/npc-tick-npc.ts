import type { RefObject } from "react";
import * as THREE from "three";
import {
  createHumanLocomotionController,
  type LocomotionController,
  type LocomotionMode,
} from "../physics/npc-locomotion";
import { updateNpcEventManager } from "../combat/npc-em-runtime";
import { getNpcModelScriptsState } from "../scripting/npc-model-scripts";
import { NPC_RENDER_TUNING } from "../physics/npc-physics";
import type { WaypointMover } from "../navigation/npc-waypoint-mover";
import type { NpcData } from "../../shared/types";
import type { CharacterInstance } from "../../character/character-instance";
import type { ManualKeysState } from "./hooks/use-npc-manual-control";
import type { NpcAnimationRef } from "./hooks/use-npc-animation-state";
import {
  clearNpcRuntimeValue,
  ensureNpcUserData,
  getNpcRuntimeValue,
  setNpcRuntimeValue,
  type NpcJumpType,
  type NpcRendererUserData,
} from "./npc-runtime-state";
import { getNpcRuntimeId } from "./npc-renderer-utils";
import { tickJumpAnimationFsm } from "./npc-jump-fsm";

type MotionDebugState = {
  isFalling: boolean;
  isSliding: boolean;
  locomotionMode: LocomotionMode;
  lastWarnAtMs: number;
  lastPeriodicAtMs: number;
};

export type CreateTickNpcDeps = {
  loadedNpcsRef: RefObject<Map<string, THREE.Group>>;
  getNpcVisualRoot: (npcGroup: THREE.Group) => THREE.Object3D;
  playerGroupRef: RefObject<THREE.Group | null>;
  hideHero: boolean;
  showJumpDebugRange: boolean;
  ensureJumpDebugLabel: (npcGroup: THREE.Group) => {
    root: THREE.Group;
    setText: (text: string) => void;
  };
  attachCombatBindings: (npcGroup: THREE.Group, npcData: NpcData) => void;
  manualControlHeroEnabled: boolean;
  trySnapNpcToGroundWithRapier: (npcGroup: THREE.Group) => boolean;
  playerInput: { consumeMouseYawDelta: () => number };
  manualAttackSeqRef: RefObject<number>;
  manualAttackSeqAppliedRef: RefObject<number>;
  manualJumpSeqRef: RefObject<number>;
  manualJumpSeqAppliedRef: RefObject<number>;
  combatRuntimeRef: RefObject<{
    ensureNpc: (npcData: NpcData) => void;
    requestMeleeAttack: (npcInstanceIndex: number, opts?: any) => boolean;
    getState: (npcInstanceIndex: number) => unknown;
    update: (params: {
      nowMs: number;
      dtSeconds: number;
      loadedNpcs: Iterable<THREE.Group>;
      resolveAnim: (npcInstanceIndex: number, animationName: string) => NpcAnimationRef;
    }) => void;
  }>;
  resolveNpcAnimationRef: (npcInstanceIndex: number, animationName: string) => NpcAnimationRef;
  manualKeysRef: RefObject<ManualKeysState>;
  manualRunToggleRef: RefObject<boolean>;
  manualControlSpeeds: { walk: number; run: number; back: number };
  tmpManualForward: THREE.Vector3;
  tmpEmRootMotionWorld: THREE.Vector3;
  tmpManualDesiredQuat: THREE.Quaternion;
  tmpManualUp: THREE.Vector3;
  applyMoveConstraint: (
    npcGroup: THREE.Group,
    desiredX: number,
    desiredZ: number,
    deltaSeconds: number,
  ) => { moved: boolean };
  waypointMoverRef: RefObject<WaypointMover | null>;
  estimateAnimationDurationMs: (modelName: string, animationName: string) => number | null;
  getNearestWaypointDirectionQuat: (pos: THREE.Vector3) => THREE.Quaternion | null;
  getAnimationMetaForNpc: (npcInstanceIndex: number, animationName: string) => any;
  kccConfig: {
    fallEntryDelaySeconds?: number;
    fallDownHeight?: number;
    slideEntryDelaySeconds?: number;
  };
  motionDebugLastRef: RefObject<MotionDebugState | undefined>;
};

type TickNpcRuntime = {
  movedThisFrame: boolean;
  locomotionMode: LocomotionMode;
  runtimeMotionDebug: boolean;
  shouldLogMotion: boolean;
  isManualHero: boolean;
};

type TickNpcBaseCtx = {
  npcGroup: THREE.Group;
  npcData: NpcData;
  instance: CharacterInstance | undefined;
  cameraPos: THREE.Vector3;
  delta: number;
  physicsFrame: number;
  npcId: string;
  deps: CreateTickNpcDeps;
  runtime: TickNpcRuntime;
};

function tickNpcUiStage(ctx: TickNpcBaseCtx) {
  const {
    npcGroup,
    npcData,
    instance,
    cameraPos,
    delta,
    deps: { getNpcVisualRoot, playerGroupRef, hideHero, showJumpDebugRange, ensureJumpDebugLabel },
  } = ctx;

  const ud = ensureNpcUserData(npcGroup);
  const visualRoot = getNpcVisualRoot(npcGroup);
  if (playerGroupRef.current === npcGroup) {
    visualRoot.visible = !hideHero;
  }
  // no-op
  const sprite = visualRoot.children.find((child) => child instanceof THREE.Sprite) as
    | THREE.Sprite
    | undefined;
  if (sprite) {
    sprite.lookAt(cameraPos);
  }

  const healthBar = ud.healthBar;
  if (healthBar?.root) {
    healthBar.root.lookAt(cameraPos);
  }

  if (instance) {
    instance.update(delta);
  }

  const isHeroForDebug = playerGroupRef.current === npcGroup;
  if (showJumpDebugRange && isHeroForDebug) {
    try {
      const { root, setText } = ensureJumpDebugLabel(npcGroup);
      root.visible = true;
      root.lookAt(cameraPos);
      const jd = getNpcRuntimeValue(ud, "jumpDecision");
      const best = getNpcRuntimeValue(ud, "ledgeBest");
      const fmt = (v: number | null | undefined) =>
        typeof v === "number" && Number.isFinite(v) ? v.toFixed(1) : "-";
      const fmt2 = (v: number | null | undefined) =>
        typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "-";
      const bestText =
        best && (typeof best.value === "number" || typeof best.ledgeHeight === "number")
          ? `best:${fmt2(best.value)} bh:${fmt(best.ledgeHeight)}`
          : "best:- bh:-";
      const text = jd
        ? `${String(jd.type ?? "n/a").toUpperCase()}\n${String(jd.reason ?? "no_reason")}\nh:${fmt(jd.ledgeHeight)} d:${fmt(
            jd.obstacleDistance,
          )} c:${fmt(jd.ceilingClearance)}${jd.fullWall ? " wall" : ""}\n${bestText}`
        : `NO JUMP DATA\n-\nh:- d:- c:-\n${bestText}`;
      setText(text);
    } catch {
      // ignore debug-label failures
    }
  } else {
    const root = getNpcRuntimeValue(ud, "jumpDebugLabelRoot");
    if (root) root.visible = false;
  }

  if (
    healthBar?.root &&
    healthBar?.fill &&
    typeof healthBar.width === "number" &&
    Number.isFinite(healthBar.width)
  ) {
    const info = (npcData.npcInfo || {}) as Record<string, unknown>;
    const rawHp = Number(info.hp);
    const rawHpMax = Number(info.hpmax ?? info.hpMax);
    const hp = Number.isFinite(rawHp) ? Math.max(0, Math.floor(rawHp)) : 0;
    const hpMax = Number.isFinite(rawHpMax) ? Math.max(0, Math.floor(rawHpMax)) : 0;
    const ratio = hpMax > 0 ? Math.max(0, Math.min(1, hp / hpMax)) : 1;

    const fill = healthBar.fill as
      | (THREE.Object3D & { scale?: { x: number }; position?: { x: number } })
      | undefined;
    if (fill?.scale) fill.scale.x = ratio;
    if (fill?.position) fill.position.x = -healthBar.width / 2 + (healthBar.width * ratio) / 2;
    if (healthBar.setText) {
      healthBar.setText(hpMax > 0 ? `${hp}/${hpMax}` : `${hp}/?`);
    }
  }
}

function tickNpcMotionStage(ctx: TickNpcBaseCtx) {
  const {
    npcGroup,
    npcData,
    instance,
    delta,
    physicsFrame,
    npcId,
    deps: {
      trySnapNpcToGroundWithRapier,
      playerInput,
      manualAttackSeqRef,
      manualAttackSeqAppliedRef,
      manualJumpSeqRef,
      manualJumpSeqAppliedRef,
      combatRuntimeRef,
      resolveNpcAnimationRef,
      manualKeysRef,
      manualRunToggleRef,
      manualControlSpeeds,
      tmpManualForward,
      tmpEmRootMotionWorld,
      tmpManualDesiredQuat,
      tmpManualUp,
      applyMoveConstraint,
      waypointMoverRef,
      estimateAnimationDurationMs,
      getNearestWaypointDirectionQuat,
      getAnimationMetaForNpc,
    },
    runtime,
  } = ctx;

  let movedThisFrame = runtime.movedThisFrame;
  let locomotionMode = runtime.locomotionMode;
  const isManualHero = runtime.isManualHero;

  trySnapNpcToGroundWithRapier(npcGroup);
  const ud = ensureNpcUserData(npcGroup);
  const isFallingNow = Boolean(ud.isFalling);
  if (isManualHero && isFallingNow) {
    const instance = ud.characterInstance;
    clearNpcRuntimeValue(ud, "manualSuppressLocomotion");
    clearNpcRuntimeValue(ud, "manualTurnAnim");
    clearNpcRuntimeValue(ud, "manualWasTurningInPlace");
    if (instance?.object) {
      instance.object.rotation.z = 0;
      setNpcRuntimeValue(ud, "manualLeanRoll", 0);
    }
  } else if (isManualHero) {
    let pendingMouseYawRad = 0;
    const dDeg = playerInput.consumeMouseYawDelta();
    if (Number.isFinite(dDeg) && dDeg !== 0) {
      pendingMouseYawRad = (dDeg * Math.PI) / 180;
    }
    const nowMs = Date.now();

    if (manualAttackSeqAppliedRef.current !== manualAttackSeqRef.current) {
      manualAttackSeqAppliedRef.current = manualAttackSeqRef.current;
      combatRuntimeRef.current.ensureNpc(npcData);
      const ok = combatRuntimeRef.current.requestMeleeAttack(npcData.instanceIndex, {
        kind: "left",
      });
      if (!ok) {
        try {
          const st = combatRuntimeRef.current.getState(npcData.instanceIndex);
          console.warn("[combat] melee attack request rejected", {
            npc: npcData.instanceIndex,
            state: st,
          });
        } catch {
          // ignore
        }
      } else {
        // Start the attack animation immediately (hit resolution is still done in the global combat update).
        combatRuntimeRef.current.update({
          nowMs: Date.now(),
          dtSeconds: 0,
          loadedNpcs: [npcGroup],
          resolveAnim: resolveNpcAnimationRef,
        });
      }
    }
    if (manualJumpSeqAppliedRef.current !== manualJumpSeqRef.current) {
      manualJumpSeqAppliedRef.current = manualJumpSeqRef.current;
      const grounded = Boolean(
        getNpcRuntimeValue(ud, "kccStableGrounded") ?? getNpcRuntimeValue(ud, "kccGrounded"),
      );
      const jumpActive = Boolean(getNpcRuntimeValue(ud, "kccJumpActive"));
      const jumpDecision = getNpcRuntimeValue(ud, "jumpDecision");
      const jumpType = String(jumpDecision?.type ?? "jump_forward");
      const canJumpByDecision = jumpDecision?.canJump !== false;
      if (grounded && !jumpActive) {
        if (canJumpByDecision) {
          setNpcRuntimeValue(ud, "kccJumpRequest", { atMs: nowMs, jumpType });
          clearNpcRuntimeValue(ud, "kccJumpBlockedReason");
        } else {
          clearNpcRuntimeValue(ud, "kccJumpRequest");
          setNpcRuntimeValue(
            ud,
            "kccJumpBlockedReason",
            String(jumpDecision?.reason ?? "decision_blocked"),
          );
        }
      } else {
        clearNpcRuntimeValue(ud, "kccJumpRequest");
      }
    }

    const MAX_DT = 0.05;
    const MAX_STEPS = 8;
    let remaining = Math.max(0, delta);

    const instance = ud.characterInstance;
    const wantLean = true;
    let didTurnInPlaceThisFrame = false;
    let lastTurnSign = 0;

    const mouseYawRate = pendingMouseYawRad / Math.max(1e-6, Math.max(0, delta));

    for (let step = 0; step < MAX_STEPS && remaining > 0; step++) {
      const dt = Math.min(remaining, MAX_DT);
      remaining -= dt;

      const keys = manualKeysRef.current;
      let mouseYawThisStep = mouseYawRate * dt;
      const ignoreInputUntilMs = Number(getNpcRuntimeValue(ud, "kccIgnoreInputUntilMs"));
      const ignoreInput = Number.isFinite(ignoreInputUntilMs) && nowMs < ignoreInputUntilMs;
      // In Gothic: ArrowRight turns right (clockwise when looking from above).
      let turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
      let move = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
      if (ud.isSliding || ignoreInput) {
        turn = 0;
        move = 0;
        mouseYawThisStep = 0;
      }
      if (turn === 0 && move === 0 && Math.abs(mouseYawThisStep) < 1e-6) break;

      // Gothic-like manual controls:
      // - ArrowLeft/ArrowRight: turn in place (and lean slightly when moving)
      // - ArrowUp/ArrowDown: move forward/back along current facing
      tmpManualForward.set(0, 0, 1).applyQuaternion(npcGroup.quaternion);
      tmpManualForward.y = 0;
      if (tmpManualForward.lengthSq() < 1e-8) tmpManualForward.set(0, 0, 1);
      else tmpManualForward.normalize();

      const currentYaw = Math.atan2(tmpManualForward.x, tmpManualForward.z);
      // OpenGothic-like manual turn speed: 90 deg/s, with optional debug override.
      const baseTurnSpeedDeg = 90;
      const turnSpeedDeg = baseTurnSpeedDeg;
      const turnSpeed = (turnSpeedDeg * Math.PI) / 180; // rad/sec
      const desiredYaw = currentYaw + turn * turnSpeed * dt + mouseYawThisStep;
      tmpManualDesiredQuat.setFromAxisAngle(tmpManualUp, desiredYaw);
      // Apply rotation directly (no extra smoothing), so turning speed matches intended rate.
      npcGroup.quaternion.copy(tmpManualDesiredQuat);

      // Recompute forward after rotation update for movement integration.
      tmpManualForward.set(0, 0, 1).applyQuaternion(npcGroup.quaternion);
      tmpManualForward.y = 0;
      if (tmpManualForward.lengthSq() < 1e-8) tmpManualForward.set(0, 0, 1);
      else tmpManualForward.normalize();

      const speed =
        move < 0
          ? manualControlSpeeds.back
          : manualRunToggleRef.current
            ? manualControlSpeeds.run
            : manualControlSpeeds.walk;
      let desiredX = npcGroup.position.x;
      let desiredZ = npcGroup.position.z;
      if (move !== 0) {
        desiredX += tmpManualForward.x * speed * dt * move;
        desiredZ += tmpManualForward.z * speed * dt * move;
      }

      const r = applyMoveConstraint(npcGroup, desiredX, desiredZ, dt);
      if (r.moved)
        ud.lastMoveDirXZ = {
          x: tmpManualForward.x * move,
          z: tmpManualForward.z * move,
        };

      movedThisFrame = movedThisFrame || r.moved;

      if (move === 0 && (turn !== 0 || Math.abs(mouseYawThisStep) >= 1e-6)) {
        didTurnInPlaceThisFrame = true;
        lastTurnSign = turn !== 0 ? turn : mouseYawThisStep < 0 ? -1 : 1;
        setNpcRuntimeValue(ud, "manualLastTurnAtMs", nowMs);
        setNpcRuntimeValue(ud, "manualLastTurnSign", lastTurnSign);
      }
    }

    // Procedural lean while turning (Gothic-like "bank" into the turn).
    // Note: this is purely visual (model tilt), not physics.
    if (wantLean && instance?.object) {
      const keys = manualKeysRef.current;
      let turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
      let move = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
      const ignoreInputUntilMs = Number(getNpcRuntimeValue(ud, "kccIgnoreInputUntilMs"));
      const ignoreInput = Number.isFinite(ignoreInputUntilMs) && nowMs < ignoreInputUntilMs;
      if (ud.isSliding || ignoreInput) {
        turn = 0;
        move = 0;
      }
      const maxLeanRad = manualRunToggleRef.current ? 0.17 : 0.12; // ~10deg / ~7deg
      const targetRoll = move !== 0 ? -turn * maxLeanRad : 0;

      let roll = getNpcRuntimeValue(ud, "manualLeanRoll");
      if (typeof roll !== "number" || !Number.isFinite(roll)) roll = 0;
      const k = 1 - Math.exp(-14 * Math.max(0, delta));
      roll = roll + (targetRoll - roll) * k;
      setNpcRuntimeValue(ud, "manualLeanRoll", roll);

      // Apply only to the visual model so UI (name/HP) doesn't tilt.
      instance.object.rotation.z = roll;
    }

    const keysNow = manualKeysRef.current;
    let turnNow = (keysNow.left ? 1 : 0) - (keysNow.right ? 1 : 0);
    let moveNow = (keysNow.up ? 1 : 0) - (keysNow.down ? 1 : 0);
    const ignoreInputUntilMs = Number(getNpcRuntimeValue(ud, "kccIgnoreInputUntilMs"));
    const ignoreInput = Number.isFinite(ignoreInputUntilMs) && nowMs < ignoreInputUntilMs;
    if (ud.isSliding || ignoreInput) {
      turnNow = 0;
      moveNow = 0;
    }
    const manualLocomotionMode: LocomotionMode =
      moveNow > 0
        ? manualRunToggleRef.current
          ? "run"
          : "walk"
        : moveNow < 0
          ? "walkBack"
          : "idle";

    // Turn-in-place animation (Gothic/Zengin uses dedicated turn animations).
    // Keep this separate from `_emSuppressLocomotion` used by combat and script one-shots.
    if (instance) {
      const suppressByCombatOrScript = Boolean(getNpcRuntimeValue(ud, "emSuppressLocomotion"));
      const jumpActive = Boolean(getNpcRuntimeValue(ud, "kccJumpActive"));
      const jumpAnimActive = Boolean(getNpcRuntimeValue(ud, "kccJumpAnimActive"));
      const wasTurning = Boolean(getNpcRuntimeValue(ud, "manualWasTurningInPlace"));
      const lastTurnAtMs = Number(getNpcRuntimeValue(ud, "manualLastTurnAtMs"));
      const graceMs = 300;
      const withinGrace =
        moveNow === 0 &&
        Number.isFinite(lastTurnAtMs) &&
        nowMs - lastTurnAtMs >= 0 &&
        nowMs - lastTurnAtMs < graceMs;
      const shouldTurnAnim =
        !jumpActive && !jumpAnimActive && moveNow === 0 && (didTurnInPlaceThisFrame || withinGrace);
      setNpcRuntimeValue(ud, "manualWasTurningInPlace", shouldTurnAnim);

      if (shouldTurnAnim && !suppressByCombatOrScript) {
        setNpcRuntimeValue(ud, "manualSuppressLocomotion", true);
        const signFromHistory = Number(getNpcRuntimeValue(ud, "manualLastTurnSign"));
        const effSign = didTurnInPlaceThisFrame
          ? lastTurnSign
          : Number.isFinite(signFromHistory) && signFromHistory !== 0
            ? signFromHistory
            : lastTurnSign || 1;
        const rightTurn = effSign < 0;

        // Use actual human anim names present in `/ANIMS/_COMPILED` (no `S_TURN*` in the base set).
        const name = rightTurn ? "t_RunTurnR" : "t_RunTurnL";
        const prev = getNpcRuntimeValue(ud, "manualTurnAnim");
        setNpcRuntimeValue(ud, "manualTurnAnim", name);

        if ((prev || "").toUpperCase() !== name.toUpperCase()) {
          const ref = resolveNpcAnimationRef(npcData.instanceIndex, name);
          instance.setAnimation(name, {
            modelName: ref.modelName,
            loop: true,
            resetTime: true,
            blendInMs: ref.blendInMs,
            blendOutMs: ref.blendOutMs,
            fallbackNames: [
              rightTurn ? "t_WalkwTurnR" : "t_WalkwTurnL",
              rightTurn ? "t_SneakTurnR" : "t_SneakTurnL",
              "s_Run",
            ],
          });
        }
      } else {
        clearNpcRuntimeValue(ud, "manualSuppressLocomotion");
        clearNpcRuntimeValue(ud, "manualTurnAnim");

        // When we stop turning:
        // - if we start moving this frame (even while holding turn), force locomotion to re-apply so we
        //   don't end up sliding with an idle/turn pose due to locomotion state being stale.
        // - otherwise restore idle immediately.
        if (wasTurning && !suppressByCombatOrScript) {
          if (manualLocomotionMode !== "idle") {
            const fresh = createHumanLocomotionController();
            ud.locomotion = fresh;
            fresh.update(instance, manualLocomotionMode, (name) =>
              resolveNpcAnimationRef(npcData.instanceIndex, name),
            );
          } else if (moveNow === 0 && turnNow === 0) {
            const ref = resolveNpcAnimationRef(npcData.instanceIndex, "s_Run");
            instance.setAnimation("s_Run", {
              modelName: ref.modelName,
              loop: true,
              resetTime: true,
              blendInMs: ref.blendInMs,
              blendOutMs: ref.blendOutMs,
              fallbackNames: ["s_Run"],
            });
          }
        }
      }
    }

    locomotionMode = manualLocomotionMode;
  } else {
    const mover = waypointMoverRef.current;
    const em = updateNpcEventManager(npcData.instanceIndex, npcId, npcGroup, delta, {
      mover,
      estimateAnimationDurationMs,
      getNearestWaypointDirectionQuat,
      getAnimationMeta: getAnimationMetaForNpc,
      getFallbackAnimationModelName: (idx) => getNpcModelScriptsState(idx).baseScript,
    });
    movedThisFrame = Boolean(em.moved);
    locomotionMode = em.mode ?? "idle";
  }

  // Apply animation root motion during script-driven one-shot animations (AI_PlayAni / Npc_PlayAni).
  // This makes e.g. dance/attack "step" animations move the NPC like in the original engine.
  if (!isManualHero && instance && Boolean(getNpcRuntimeValue(ud, "emSuppressLocomotion"))) {
    const d = (instance.object as any)?.userData?.__rootMotionDelta as
      | { x: number; y: number; z: number }
      | undefined;
    if (d && (Math.abs(d.x) > 1e-6 || Math.abs(d.z) > 1e-6)) {
      tmpEmRootMotionWorld.set(d.x, 0, d.z).applyQuaternion(npcGroup.quaternion);
      const desiredX = npcGroup.position.x + tmpEmRootMotionWorld.x;
      const desiredZ = npcGroup.position.z + tmpEmRootMotionWorld.z;
      const r = applyMoveConstraint(npcGroup, desiredX, desiredZ, delta);
      if (r.moved) {
        const lenSq =
          tmpEmRootMotionWorld.x * tmpEmRootMotionWorld.x +
          tmpEmRootMotionWorld.z * tmpEmRootMotionWorld.z;
        if (lenSq > 1e-8) {
          const inv = 1 / Math.sqrt(lenSq);
          ud.lastMoveDirXZ = {
            x: tmpEmRootMotionWorld.x * inv,
            z: tmpEmRootMotionWorld.z * inv,
          };
        }
      }
      movedThisFrame = movedThisFrame || r.moved;
    }
  }

  // Ensure KCC is stepped at least once per frame for gravity/snap-to-ground,
  // even if scripts didn't request any movement this tick.
  if (getNpcRuntimeValue(ud, "kccLastFrame") !== physicsFrame) {
    applyMoveConstraint(npcGroup, npcGroup.position.x, npcGroup.position.z, delta);
  }

  runtime.movedThisFrame = movedThisFrame;
  runtime.locomotionMode = locomotionMode;
}

type JumpType = NpcJumpType;

function resolveJumpType(ud: NpcRendererUserData): JumpType {
  const jumpType = String(getNpcRuntimeValue(ud, "kccJumpType") ?? "jump_forward");
  if (jumpType === "jump_up_low") return "jump_up_low";
  if (jumpType === "jump_up_mid") return "jump_up_mid";
  if (jumpType === "jump_up_high") return "jump_up_high";
  return "jump_forward";
}

function resetJumpProgressFlags(ud: NpcRendererUserData) {
  clearNpcRuntimeValue(ud, "kccJumpLowStandAtMs");
  setNpcRuntimeValue(ud, "kccJumpLowStandPlayed", false);
  clearNpcRuntimeValue(ud, "kccJumpMidStandAtMs");
  setNpcRuntimeValue(ud, "kccJumpMidStandPlayed", false);
  clearNpcRuntimeValue(ud, "kccJumpHighHangAtMs");
  setNpcRuntimeValue(ud, "kccJumpHighHangPlayed", false);
  clearNpcRuntimeValue(ud, "kccJumpHighStandAtMs");
  setNpcRuntimeValue(ud, "kccJumpHighStandPlayed", false);
}

function resolveLocomotionModeFromPhysics(params: {
  npcGroup: THREE.Group;
  kccConfig: CreateTickNpcDeps["kccConfig"];
  locomotionMode: LocomotionMode;
}): LocomotionMode {
  const { npcGroup, kccConfig } = params;
  let { locomotionMode } = params;

  // Falling has priority over ground locomotion animations.
  const ud = ensureNpcUserData(npcGroup);
  if (Boolean(ud.isFalling)) {
    const wasFalling = Boolean(getNpcRuntimeValue(ud, "wasFalling"));
    setNpcRuntimeValue(ud, "wasFalling", true);
    let fallFor = Number(getNpcRuntimeValue(ud, "kccFallFor") ?? 0);
    const fallDelay = (kccConfig as any).fallEntryDelaySeconds ?? 0;
    // Distance-based fallDown like ZenGin: switch after a vertical drop threshold.
    const yNow = npcGroup.position.y;
    let startY = getNpcRuntimeValue(ud, "fallDownStartY");
    let minY = getNpcRuntimeValue(ud, "fallDownMinY");
    if (!wasFalling || typeof startY !== "number" || !Number.isFinite(startY)) startY = yNow;
    if (!wasFalling || typeof minY !== "number" || !Number.isFinite(minY)) minY = yNow;
    if (yNow < minY) minY = yNow;
    let distY = Math.max(0, startY - minY);
    const skipFallDown = Boolean(getNpcRuntimeValue(ud, "kccSkipFallDownPhase"));
    if (skipFallDown) {
      const h = kccConfig.fallDownHeight ?? 0;
      if (h > 0) distY = h + 1;
      fallFor = Math.max(fallFor, fallDelay);
      setNpcRuntimeValue(ud, "kccFallFor", fallFor);
      setNpcRuntimeValue(ud, "fallDownStartY", yNow);
      setNpcRuntimeValue(ud, "fallDownMinY", yNow);
      distY = 0;
      setNpcRuntimeValue(ud, "kccForceFallMode", true);
    }
    setNpcRuntimeValue(ud, "fallDownStartY", startY);
    setNpcRuntimeValue(ud, "fallDownMinY", minY);
    setNpcRuntimeValue(ud, "fallDownDistY", distY);
    setNpcRuntimeValue(ud, "fallAnimT", 0);
    if (fallDelay <= 0 || fallFor >= fallDelay - 1e-6) {
      if (Boolean(getNpcRuntimeValue(ud, "kccForceFallMode"))) {
        locomotionMode = "fall";
      } else {
        locomotionMode = distY < (kccConfig.fallDownHeight ?? 0) - 1e-6 ? "fallDown" : "fall";
      }
      if (skipFallDown) {
        setNpcRuntimeValue(ud, "kccSkipFallDownPhase", false);
      }
    }
  }
  // Sliding has priority over walk/run/idle (but not over falling).
  else if (Boolean(ud.isSliding)) {
    const slideFor = Number(getNpcRuntimeValue(ud, "kccSlideFor") ?? 0);
    const slideDelay = kccConfig.slideEntryDelaySeconds ?? 0;
    setNpcRuntimeValue(ud, "kccForceFallMode", false);
    setNpcRuntimeValue(ud, "wasFalling", false);
    setNpcRuntimeValue(ud, "fallAnimT", 0);
    clearNpcRuntimeValue(ud, "fallDownStartY");
    clearNpcRuntimeValue(ud, "fallDownMinY");
    setNpcRuntimeValue(ud, "fallDownDistY", 0);
    if (slideDelay <= 0 || slideFor >= slideDelay - 1e-6) locomotionMode = "slide";
  } else {
    const ud = ensureNpcUserData(npcGroup);
    setNpcRuntimeValue(ud, "kccForceFallMode", false);
    setNpcRuntimeValue(ud, "wasFalling", false);
    setNpcRuntimeValue(ud, "fallAnimT", 0);
    clearNpcRuntimeValue(ud, "fallDownStartY");
    clearNpcRuntimeValue(ud, "fallDownMinY");
    setNpcRuntimeValue(ud, "fallDownDistY", 0);
  }

  return locomotionMode;
}

function startJumpAnimation(params: {
  npcGroup: THREE.Group;
  npcData: NpcData;
  instance: CharacterInstance;
  locomotionMode: LocomotionMode;
  resolveNpcAnimationRef: CreateTickNpcDeps["resolveNpcAnimationRef"];
  estimateAnimationDurationMs: CreateTickNpcDeps["estimateAnimationDurationMs"];
}) {
  const {
    npcGroup,
    npcData,
    instance,
    locomotionMode,
    resolveNpcAnimationRef,
    estimateAnimationDurationMs,
  } = params;
  const ud = ensureNpcUserData(npcGroup);
  setNpcRuntimeValue(ud, "kccJumpAnimActive", true);
  const jumpType = resolveJumpType(ud);
  const isForward = jumpType === "jump_forward";
  const isJumpUpLow = jumpType === "jump_up_low";
  let startName: string;
  let loopName: string;
  if (isForward) {
    startName =
      locomotionMode === "run" || locomotionMode === "walk" || locomotionMode === "walkBack"
        ? "T_RUNL_2_JUMP"
        : "T_STAND_2_JUMP";
    loopName = "S_JUMP";
  } else {
    switch (jumpType) {
      case "jump_up_low":
        startName = "T_STAND_2_JUMPUPLOW";
        loopName = "S_JUMPUPLOW";
        break;
      case "jump_up_mid":
        startName = "T_STAND_2_JUMPUPMID";
        loopName = "S_JUMPUPMID";
        break;
      case "jump_up_high":
        startName = "T_STAND_2_JUMPUP";
        loopName = "S_JUMPUP";
        break;
      default:
        startName = "T_STAND_2_JUMPUP";
        loopName = "S_JUMPUP";
        break;
    }
  }
  setNpcRuntimeValue(ud, "kccJumpStartWasRun", isForward && startName === "T_RUNL_2_JUMP");
  const ref = resolveNpcAnimationRef(npcData.instanceIndex, startName);
  const durMs =
    estimateAnimationDurationMs(ref.modelName ?? "HUMANS", ref.animationName) ??
    estimateAnimationDurationMs("HUMANS", ref.animationName) ??
    0;
  if (durMs > 0) {
    setNpcRuntimeValue(ud, "kccJumpMinAirMs", durMs);
  }
  const nextRef = resolveNpcAnimationRef(npcData.instanceIndex, loopName);
  const lowJumpBlendMs = 200;
  const jumpUpBlendMs = isForward ? undefined : isJumpUpLow ? lowJumpBlendMs : 80;
  const loopJumpMid = isForward;
  instance.setAnimation(ref.animationName, {
    modelName: ref.modelName,
    loop: false,
    resetTime: true,
    blendInMs: ref.blendInMs,
    blendOutMs: jumpUpBlendMs ?? ref.blendOutMs,
    fallbackNames: isForward ? ["S_JUMP", "S_RUN"] : [loopName, "S_JUMP", "S_RUN"],
    next: {
      animationName: nextRef.animationName,
      modelName: nextRef.modelName,
      loop: loopJumpMid,
      resetTime: true,
      blendInMs: jumpUpBlendMs ?? nextRef.blendInMs,
      blendOutMs: jumpUpBlendMs ?? nextRef.blendOutMs,
      fallbackNames: ["S_RUN"],
    },
  });
  resetJumpProgressFlags(ud);
}

function tickJumpUpLow(params: {
  npcGroup: THREE.Group;
  npcData: NpcData;
  instance: CharacterInstance;
  resolveNpcAnimationRef: CreateTickNpcDeps["resolveNpcAnimationRef"];
  estimateAnimationDurationMs: CreateTickNpcDeps["estimateAnimationDurationMs"];
}) {
  const { npcGroup, npcData, instance, resolveNpcAnimationRef, estimateAnimationDurationMs } =
    params;
  const ud = ensureNpcUserData(npcGroup);
  const currentAnimUpper = String(
    (instance.object.userData as any)?.__currentAnimationName ?? "",
  ).toUpperCase();
  const lowStandAtMs = getNpcRuntimeValue(ud, "kccJumpLowStandAtMs");
  const lowStandPlayed = Boolean(getNpcRuntimeValue(ud, "kccJumpLowStandPlayed"));
  if (lowStandPlayed) return;
  if (
    currentAnimUpper === "S_JUMPUPLOW" &&
    (typeof lowStandAtMs !== "number" || !Number.isFinite(lowStandAtMs))
  ) {
    const lowLoopRef = resolveNpcAnimationRef(npcData.instanceIndex, "S_JUMPUPLOW");
    const lowLoopDurMs =
      estimateAnimationDurationMs(lowLoopRef.modelName ?? "HUMANS", lowLoopRef.animationName) ??
      estimateAnimationDurationMs("HUMANS", lowLoopRef.animationName) ??
      250;
    setNpcRuntimeValue(ud, "kccJumpLowStandAtMs", Date.now() + Math.max(120, lowLoopDurMs));
    return;
  }
  if (
    currentAnimUpper === "S_JUMPUPLOW" &&
    typeof lowStandAtMs === "number" &&
    Number.isFinite(lowStandAtMs) &&
    Date.now() >= lowStandAtMs
  ) {
    const lowStandRef = resolveNpcAnimationRef(npcData.instanceIndex, "T_JUMPUPLOW_2_STAND");
    const jumpUpBlendMs = 120;
    instance.setAnimation(lowStandRef.animationName, {
      modelName: lowStandRef.modelName,
      loop: false,
      resetTime: true,
      blendInMs: jumpUpBlendMs ?? lowStandRef.blendInMs,
      blendOutMs: jumpUpBlendMs ?? lowStandRef.blendOutMs,
      fallbackNames: ["S_RUN"],
    });
    setNpcRuntimeValue(ud, "kccJumpLowStandPlayed", true);
  }
}

function tickJumpUpMid(params: {
  npcGroup: THREE.Group;
  npcData: NpcData;
  instance: CharacterInstance;
  resolveNpcAnimationRef: CreateTickNpcDeps["resolveNpcAnimationRef"];
  estimateAnimationDurationMs: CreateTickNpcDeps["estimateAnimationDurationMs"];
}) {
  const { npcGroup, npcData, instance, resolveNpcAnimationRef, estimateAnimationDurationMs } =
    params;
  const ud = ensureNpcUserData(npcGroup);
  const currentAnimUpper = String(
    (instance.object.userData as any)?.__currentAnimationName ?? "",
  ).toUpperCase();
  const midStandAtMs = getNpcRuntimeValue(ud, "kccJumpMidStandAtMs");
  const midStandPlayed = Boolean(getNpcRuntimeValue(ud, "kccJumpMidStandPlayed"));
  if (midStandPlayed) return;
  if (
    currentAnimUpper === "S_JUMPUPMID" &&
    (typeof midStandAtMs !== "number" || !Number.isFinite(midStandAtMs))
  ) {
    const midLoopRef = resolveNpcAnimationRef(npcData.instanceIndex, "S_JUMPUPMID");
    const midLoopDurMs =
      estimateAnimationDurationMs(midLoopRef.modelName ?? "HUMANS", midLoopRef.animationName) ??
      estimateAnimationDurationMs("HUMANS", midLoopRef.animationName) ??
      250;
    setNpcRuntimeValue(ud, "kccJumpMidStandAtMs", Date.now() + Math.max(120, midLoopDurMs));
    return;
  }
  if (
    currentAnimUpper === "S_JUMPUPMID" &&
    typeof midStandAtMs === "number" &&
    Number.isFinite(midStandAtMs) &&
    Date.now() >= midStandAtMs
  ) {
    const midStandRef = resolveNpcAnimationRef(npcData.instanceIndex, "T_JUMPUPMID_2_STAND");
    const jumpUpBlendMs = 80;
    instance.setAnimation(midStandRef.animationName, {
      modelName: midStandRef.modelName,
      loop: false,
      resetTime: true,
      blendInMs: jumpUpBlendMs ?? midStandRef.blendInMs,
      blendOutMs: jumpUpBlendMs ?? midStandRef.blendOutMs,
      fallbackNames: ["S_RUN"],
    });
    setNpcRuntimeValue(ud, "kccJumpMidStandPlayed", true);
  }
}

function tickJumpUpHigh(params: {
  npcGroup: THREE.Group;
  npcData: NpcData;
  instance: CharacterInstance;
  resolveNpcAnimationRef: CreateTickNpcDeps["resolveNpcAnimationRef"];
  estimateAnimationDurationMs: CreateTickNpcDeps["estimateAnimationDurationMs"];
}) {
  const { npcGroup, npcData, instance, resolveNpcAnimationRef, estimateAnimationDurationMs } =
    params;
  const ud = ensureNpcUserData(npcGroup);
  const currentAnimUpper = String(
    (instance.object.userData as any)?.__currentAnimationName ?? "",
  ).toUpperCase();
  const highHangAtMs = getNpcRuntimeValue(ud, "kccJumpHighHangAtMs");
  const highHangPlayed = Boolean(getNpcRuntimeValue(ud, "kccJumpHighHangPlayed"));
  const highStandAtMs = getNpcRuntimeValue(ud, "kccJumpHighStandAtMs");
  const highStandPlayed = Boolean(getNpcRuntimeValue(ud, "kccJumpHighStandPlayed"));

  if (!highHangPlayed) {
    if (
      currentAnimUpper === "S_JUMPUP" &&
      (typeof highHangAtMs !== "number" || !Number.isFinite(highHangAtMs))
    ) {
      const jumpUpPhaseMs = Math.max(
        120,
        Number(NPC_RENDER_TUNING.jumpUpHighJumpUpPhaseSeconds ?? 0.3) * 1000,
      );
      setNpcRuntimeValue(ud, "kccJumpHighHangAtMs", Date.now() + jumpUpPhaseMs);
      return;
    }
    if (
      currentAnimUpper === "S_JUMPUP" &&
      typeof highHangAtMs === "number" &&
      Number.isFinite(highHangAtMs) &&
      Date.now() >= highHangAtMs
    ) {
      const hangRef = resolveNpcAnimationRef(npcData.instanceIndex, "S_HANG");
      const highBlendMs = 80;
      instance.setAnimation(hangRef.animationName, {
        modelName: hangRef.modelName,
        loop: false,
        resetTime: true,
        blendInMs: highBlendMs,
        blendOutMs: highBlendMs,
        fallbackNames: ["S_RUN"],
      });
      setNpcRuntimeValue(ud, "kccJumpHighHangPlayed", true);
      return;
    }
  }

  if (highHangPlayed && !highStandPlayed) {
    if (
      currentAnimUpper === "S_HANG" &&
      (typeof highStandAtMs !== "number" || !Number.isFinite(highStandAtMs))
    ) {
      const hangRef = resolveNpcAnimationRef(npcData.instanceIndex, "S_HANG");
      const hangDurMs =
        estimateAnimationDurationMs(hangRef.modelName ?? "HUMANS", hangRef.animationName) ??
        estimateAnimationDurationMs("HUMANS", hangRef.animationName) ??
        250;
      setNpcRuntimeValue(ud, "kccJumpHighStandAtMs", Date.now() + Math.max(120, hangDurMs));
      return;
    }
    if (
      currentAnimUpper === "S_HANG" &&
      typeof highStandAtMs === "number" &&
      Number.isFinite(highStandAtMs) &&
      Date.now() >= highStandAtMs
    ) {
      const standRef = resolveNpcAnimationRef(npcData.instanceIndex, "T_HANG_2_STAND");
      const highBlendMs = 80;
      instance.setAnimation(standRef.animationName, {
        modelName: standRef.modelName,
        loop: false,
        resetTime: true,
        blendInMs: highBlendMs,
        blendOutMs: highBlendMs,
        fallbackNames: ["S_RUN"],
      });
      setNpcRuntimeValue(ud, "kccJumpHighStandPlayed", true);
    }
  }
}

function tickActiveJumpAnimation(params: {
  npcGroup: THREE.Group;
  npcData: NpcData;
  instance: CharacterInstance;
  resolveNpcAnimationRef: CreateTickNpcDeps["resolveNpcAnimationRef"];
  estimateAnimationDurationMs: CreateTickNpcDeps["estimateAnimationDurationMs"];
}) {
  const { npcGroup } = params;
  const ud = ensureNpcUserData(npcGroup);
  const jumpType = resolveJumpType(ud);
  if (jumpType === "jump_up_low") {
    tickJumpUpLow(params);
  } else if (jumpType === "jump_up_mid") {
    tickJumpUpMid(params);
  } else if (jumpType === "jump_up_high") {
    tickJumpUpHigh(params);
  }
}

function exitJumpAnimation(params: {
  npcGroup: THREE.Group;
  npcData: NpcData;
  instance: CharacterInstance;
  locomotionMode: LocomotionMode;
  resolveNpcAnimationRef: CreateTickNpcDeps["resolveNpcAnimationRef"];
  estimateAnimationDurationMs: CreateTickNpcDeps["estimateAnimationDurationMs"];
}) {
  const {
    npcGroup,
    npcData,
    instance,
    locomotionMode,
    resolveNpcAnimationRef,
    estimateAnimationDurationMs,
  } = params;
  const ud = ensureNpcUserData(npcGroup);
  const midStandPlayed = Boolean(getNpcRuntimeValue(ud, "kccJumpMidStandPlayed"));
  const lowStandPlayed = Boolean(getNpcRuntimeValue(ud, "kccJumpLowStandPlayed"));
  const highStandPlayed = Boolean(getNpcRuntimeValue(ud, "kccJumpHighStandPlayed"));
  setNpcRuntimeValue(ud, "kccJumpAnimActive", false);
  resetJumpProgressFlags(ud);
  const jumpType = resolveJumpType(ud);
  const moving =
    locomotionMode === "run" || locomotionMode === "walk" || locomotionMode === "walkBack";
  const nextName =
    locomotionMode === "run"
      ? "s_RunL"
      : locomotionMode === "walk"
        ? "s_WalkL"
        : locomotionMode === "walkBack"
          ? "t_JumpB"
          : "s_Run";
  const nextRef = resolveNpcAnimationRef(npcData.instanceIndex, nextName);
  const jumpStartWasRun = Boolean(getNpcRuntimeValue(ud, "kccJumpStartWasRun"));
  setNpcRuntimeValue(ud, "kccJumpStartWasRun", false);

  if (moving) {
    clearNpcRuntimeValue(ud, "kccJumpBlockUntilMs");
    instance.setAnimation(nextRef.animationName, {
      modelName: nextRef.modelName,
      loop: true,
      resetTime: true,
      blendInMs: locomotionMode === "run" && jumpStartWasRun ? 200 : nextRef.blendInMs,
      blendOutMs: locomotionMode === "run" && jumpStartWasRun ? 200 : nextRef.blendOutMs,
      fallbackNames: ["s_Run"],
    });
    return;
  }
  if (jumpType === "jump_up_low" && lowStandPlayed) {
    clearNpcRuntimeValue(ud, "kccJumpBlockUntilMs");
    const lowExitBlendMs = 120;
    instance.setAnimation(nextRef.animationName, {
      modelName: nextRef.modelName,
      loop: true,
      resetTime: true,
      blendInMs: lowExitBlendMs,
      blendOutMs: lowExitBlendMs,
      fallbackNames: ["s_Run"],
    });
    return;
  }
  if (jumpType === "jump_up_mid" && midStandPlayed) {
    clearNpcRuntimeValue(ud, "kccJumpBlockUntilMs");
    const midExitBlendMs = 220;
    instance.setAnimation(nextRef.animationName, {
      modelName: nextRef.modelName,
      loop: true,
      resetTime: true,
      blendInMs: midExitBlendMs,
      blendOutMs: midExitBlendMs,
      fallbackNames: ["s_Run"],
    });
    return;
  }
  if (jumpType === "jump_up_high" && highStandPlayed) {
    clearNpcRuntimeValue(ud, "kccJumpBlockUntilMs");
    const highExitBlendMs = 120;
    instance.setAnimation(nextRef.animationName, {
      modelName: nextRef.modelName,
      loop: true,
      resetTime: true,
      blendInMs: highExitBlendMs,
      blendOutMs: highExitBlendMs,
      fallbackNames: ["s_Run"],
    });
    return;
  }
  const endName =
    jumpType === "jump_up_low"
      ? "T_JUMPUPLOW_2_STAND"
      : jumpType === "jump_up_high"
        ? "T_HANG_2_STAND"
        : "T_JUMP_2_STAND";
  const ref = resolveNpcAnimationRef(npcData.instanceIndex, endName);
  const durMs =
    estimateAnimationDurationMs(ref.modelName ?? "HUMANS", ref.animationName) ??
    estimateAnimationDurationMs("HUMANS", ref.animationName) ??
    400;
  setNpcRuntimeValue(ud, "kccJumpBlockUntilMs", Date.now() + Math.max(0, durMs));
  instance.setAnimation(ref.animationName, {
    modelName: ref.modelName,
    loop: false,
    resetTime: true,
    blendInMs: ref.blendInMs,
    blendOutMs: ref.blendOutMs,
    fallbackNames: ["S_RUN"],
    next: {
      animationName: nextRef.animationName,
      modelName: nextRef.modelName,
      loop: true,
      resetTime: true,
      blendInMs: nextRef.blendInMs,
      blendOutMs: nextRef.blendOutMs,
      fallbackNames: ["s_Run"],
    },
  });
}

function applyGroundAnimation(params: {
  npcData: NpcData;
  instance: CharacterInstance;
  locomotion: LocomotionController | undefined;
  locomotionMode: LocomotionMode;
  scriptIdle: string | undefined;
  resolveNpcAnimationRef: CreateTickNpcDeps["resolveNpcAnimationRef"];
}) {
  const { npcData, instance, locomotion, locomotionMode, scriptIdle, resolveNpcAnimationRef } =
    params;
  if (scriptIdle && locomotionMode === "idle") {
    const ref = resolveNpcAnimationRef(npcData.instanceIndex, scriptIdle);
    instance.setAnimation(ref.animationName, {
      modelName: ref.modelName,
      loop: true,
      resetTime: false,
      blendInMs: ref.blendInMs,
      blendOutMs: ref.blendOutMs,
    });
    return;
  }
  locomotion?.update(instance, locomotionMode, (name) =>
    resolveNpcAnimationRef(npcData.instanceIndex, name),
  );
}

function tickNpcAnimationStage(ctx: TickNpcBaseCtx) {
  const {
    npcGroup,
    npcData,
    instance,
    deps: { kccConfig, resolveNpcAnimationRef, estimateAnimationDurationMs },
    runtime,
  } = ctx;

  let locomotionMode = resolveLocomotionModeFromPhysics({
    npcGroup,
    kccConfig,
    locomotionMode: runtime.locomotionMode,
  });

  if (instance) {
    const ud = ensureNpcUserData(npcGroup);
    const locomotion = ud.locomotion as LocomotionController | undefined;
    const suppress =
      Boolean(getNpcRuntimeValue(ud, "emSuppressLocomotion")) ||
      Boolean(getNpcRuntimeValue(ud, "manualSuppressLocomotion"));
    const scriptIdle = getNpcRuntimeValue(ud, "emIdleAnimation") || undefined;
    const jumpActive = Boolean(getNpcRuntimeValue(ud, "kccJumpActive"));
    // While the event-manager plays a one-shot animation, do not override it with locomotion/idle updates.
    if (!suppress) {
      tickJumpAnimationFsm({
        userData: ud,
        jumpActive,
        onStartJumpAnimation: () =>
          startJumpAnimation({
            npcGroup,
            npcData,
            instance,
            locomotionMode,
            resolveNpcAnimationRef,
            estimateAnimationDurationMs,
          }),
        onTickActiveJumpAnimation: () =>
          tickActiveJumpAnimation({
            npcGroup,
            npcData,
            instance,
            resolveNpcAnimationRef,
            estimateAnimationDurationMs,
          }),
        onExitJumpAnimation: () =>
          exitJumpAnimation({
            npcGroup,
            npcData,
            instance,
            locomotionMode,
            resolveNpcAnimationRef,
            estimateAnimationDurationMs,
          }),
      });

      if (!jumpActive) {
        applyGroundAnimation({
          npcData,
          instance,
          locomotion,
          locomotionMode,
          scriptIdle,
          resolveNpcAnimationRef,
        });
      }
    }
  }

  runtime.locomotionMode = locomotionMode;
}

function tickNpcDebugStage(ctx: TickNpcBaseCtx) {
  const {
    npcGroup,
    instance,
    deps: { motionDebugLastRef },
    runtime,
  } = ctx;

  const shouldLogMotion = runtime.shouldLogMotion;
  const runtimeMotionDebug = runtime.runtimeMotionDebug;
  const locomotionMode = runtime.locomotionMode;
  const ud = ensureNpcUserData(npcGroup);

  if (shouldLogMotion) {
    const isFallingNow = Boolean(ud.isFalling);
    const isSlidingNow = Boolean(ud.isSliding);
    const last = motionDebugLastRef.current;
    const lastMode = last?.locomotionMode ?? "idle";
    const shouldEmit =
      !last ||
      last.isFalling !== isFallingNow ||
      last.isSliding !== isSlidingNow ||
      lastMode !== locomotionMode;

    const nowMs = Date.now();
    const lastPeriodicAtMs = last?.lastPeriodicAtMs ?? 0;
    const periodicMs = runtimeMotionDebug ? 100 : 250;
    const shouldEmitPeriodic =
      (runtimeMotionDebug || isSlidingNow || isFallingNow) && nowMs - lastPeriodicAtMs > periodicMs;

    if (shouldEmit || shouldEmitPeriodic) {
      const payload = {
        t: nowMs,
        npcPos: { x: npcGroup.position.x, y: npcGroup.position.y, z: npcGroup.position.z },
        locomotionMode,
        isFalling: isFallingNow,
        isSliding: isSlidingNow,
        kcc: getNpcRuntimeValue(ud, "kccDbg"),
        locomotionRequested: instance ? (instance as any).__debugLocomotionRequested : undefined,
        fallDbg: getNpcRuntimeValue(ud, "fallDbg"),
        slideDbg: getNpcRuntimeValue(ud, "slideDbg"),
      };
      try {
        console.log("[NPCMotionDebugJSON]" + JSON.stringify(payload));
      } catch {
        console.log("[NPCMotionDebugJSON]" + String(payload));
      }
    }

    // Throttled warning when we are falling but we can't find a floor to land on.
    const lastWarnAtMs = last?.lastWarnAtMs ?? 0;
    const floorTargetY = (
      getNpcRuntimeValue(ud, "fallDbg") as { floorTargetY?: number | null } | undefined
    )?.floorTargetY as number | null | undefined;
    const lastWarnNext =
      isFallingNow && floorTargetY == null && nowMs - lastWarnAtMs > 500 ? nowMs : lastWarnAtMs;
    if (lastWarnNext !== lastWarnAtMs) {
      try {
        console.log(
          "[NPCMotionDebugJSON]" +
            JSON.stringify({
              t: nowMs,
              warn: "fallingNoFloorHit",
              npcPos: {
                x: npcGroup.position.x,
                y: npcGroup.position.y,
                z: npcGroup.position.z,
              },
              fallDbg: getNpcRuntimeValue(ud, "fallDbg"),
            }),
        );
      } catch {
        // ignore
      }
    }

    motionDebugLastRef.current = {
      isFalling: isFallingNow,
      isSliding: isSlidingNow,
      locomotionMode,
      lastWarnAtMs: lastWarnNext,
      lastPeriodicAtMs: shouldEmitPeriodic ? nowMs : lastPeriodicAtMs,
    };
  }
}

export function createTickNpc(deps: CreateTickNpcDeps) {
  const { loadedNpcsRef, attachCombatBindings, playerGroupRef, manualControlHeroEnabled } = deps;

  return (delta: number, physicsFrame: number, cameraPos: THREE.Vector3) => {
    for (const npcGroup of loadedNpcsRef.current.values()) {
      const ud = ensureNpcUserData(npcGroup);
      const instance = ud.characterInstance as CharacterInstance | undefined;
      const npcData = ud.npcData as NpcData | undefined;
      if (!npcData) continue;

      const npcId = getNpcRuntimeId(npcData);
      attachCombatBindings(npcGroup, npcData);

      const runtimeMotionDebug =
        typeof window !== "undefined" && Boolean((window as any).__npcMotionDebug);
      const runtime: TickNpcRuntime = {
        movedThisFrame: false,
        locomotionMode: "idle",
        runtimeMotionDebug,
        shouldLogMotion: runtimeMotionDebug && playerGroupRef.current === npcGroup,
        isManualHero: manualControlHeroEnabled && playerGroupRef.current === npcGroup,
      };

      const ctx: TickNpcBaseCtx = {
        npcGroup,
        npcData,
        instance,
        cameraPos,
        delta,
        physicsFrame,
        npcId,
        deps,
        runtime,
      };

      tickNpcUiStage(ctx);
      tickNpcMotionStage(ctx);
      tickNpcAnimationStage(ctx);
      tickNpcDebugStage(ctx);
    }
  };
}
