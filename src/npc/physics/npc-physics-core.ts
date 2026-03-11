export type NpcPhysicsCoreState = {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  falling: boolean;
  sliding: boolean;
  jumpActive: boolean;
  desiredX: number;
  desiredY: number;
  desiredZ: number;
  groundedFor?: number;
  ungroundedFor?: number;
  slideExitFor?: number;
  slideToFallFor?: number;
};

export type NpcPhysicsCoreConfig = {
  gravity: number;
  maxFallSpeed: number;
  moveDeadZone: number;
  maxSlopeClimbAngle?: number;
  slideToFallAngle?: number;
  fallGraceSeconds?: number;
  landGraceSeconds?: number;
  slideExitGraceSeconds?: number;
  slideToFallGraceSeconds?: number;
  fallVyThreshold?: number;
};

export type NpcPhysicsCoreMoveInput = {
  px: number;
  py: number;
  pz: number;
  dx: number;
  dy: number;
  dz: number;
};

export type NpcPhysicsCoreMoveOutput = {
  px: number;
  py: number;
  pz: number;
  grounded: boolean;
  groundedRaw?: boolean;
  groundNy?: number | null;
};

export type NpcPhysicsCoreMovementSolver = (
  input: NpcPhysicsCoreMoveInput,
) => NpcPhysicsCoreMoveOutput | null;

export function stepNpcPhysicsCore(
  state: NpcPhysicsCoreState,
  dtSeconds: number,
  config: NpcPhysicsCoreConfig,
  movementSolver?: NpcPhysicsCoreMovementSolver,
): NpcPhysicsCoreState {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const maxSlopeClimbAngle = config.maxSlopeClimbAngle ?? (45 * Math.PI) / 180;
  const slideToFallAngle = config.slideToFallAngle ?? (67 * Math.PI) / 180;
  const fallGraceSeconds = config.fallGraceSeconds ?? 0.08;
  const landGraceSeconds = config.landGraceSeconds ?? 0.02;
  const slideExitGraceSeconds = config.slideExitGraceSeconds ?? 0.1;
  const slideToFallGraceSeconds = config.slideToFallGraceSeconds ?? 0.08;
  const fallVyThreshold = config.fallVyThreshold ?? -20;
  const dt = Math.max(1e-6, dtSeconds);
  const dxRaw = state.desiredX - state.px;
  const dzRaw = state.desiredZ - state.pz;

  if (!movementSolver) {
    if (Math.abs(dxRaw) <= 1e-6 && Math.abs(dzRaw) <= 1e-6) {
      return {
        ...state,
        vx: 0,
        vy: 0,
        vz: 0,
        grounded: true,
        falling: false,
        sliding: false,
        groundedFor: 0,
        ungroundedFor: 0,
        slideExitFor: 0,
        slideToFallFor: 0,
      };
    }
    return {
      ...state,
      px: state.desiredX,
      py: state.desiredY,
      pz: state.desiredZ,
      vx: dxRaw / dt,
      vy: 0,
      vz: dzRaw / dt,
      grounded: true,
      falling: false,
      sliding: false,
      groundedFor: 0,
      ungroundedFor: 0,
      slideExitFor: 0,
      slideToFallFor: 0,
    };
  }

  let desiredDy = 0;
  let vy = state.vy;
  if (state.grounded) {
    // Keep tiny downward bias so KCC snap-to-ground stays stable on small discontinuities.
    desiredDy -= 2;
    vy = 0;
  } else {
    vy = Math.max(-config.maxFallSpeed, vy - config.gravity * dt);
    desiredDy += vy * dt;
  }

  const dx = Math.abs(dxRaw) < config.moveDeadZone ? 0 : dxRaw;
  const dz = Math.abs(dzRaw) < config.moveDeadZone ? 0 : dzRaw;
  const solved = movementSolver({
    px: state.px,
    py: state.py,
    pz: state.pz,
    dx,
    dy: desiredDy,
    dz,
  });
  if (!solved) return state;

  const nextVx = (solved.px - state.px) / dt;
  const nextVy = (solved.py - state.py) / dt;
  const nextVz = (solved.pz - state.pz) / dt;
  const rawGrounded = Boolean(solved.groundedRaw ?? solved.grounded);
  const groundNy =
    typeof solved.groundNy === "number" && Number.isFinite(solved.groundNy)
      ? clamp(solved.groundNy, -1, 1)
      : null;
  const slopeAngle = groundNy == null ? null : Math.acos(groundNy);
  const wasSliding = Boolean(state.sliding);

  let groundedFor = state.groundedFor ?? (state.grounded ? 0 : 0);
  let ungroundedFor = state.ungroundedFor ?? (state.grounded ? 0 : 0);
  let stableGrounded = Boolean(state.grounded);

  let slideToFallFor = state.slideToFallFor ?? 0;
  const tooSteepToStandNow = slopeAngle != null && slopeAngle > slideToFallAngle + 1e-3;
  if (tooSteepToStandNow && wasSliding) slideToFallFor += dt;
  else slideToFallFor = 0;
  const slideToFallGraceActive =
    tooSteepToStandNow && wasSliding && slideToFallFor < slideToFallGraceSeconds;
  const tooSteepToStandEffective = tooSteepToStandNow && !slideToFallGraceActive;

  const canStandNow = rawGrounded && !tooSteepToStandEffective && !state.jumpActive;
  if (canStandNow) {
    groundedFor += dt;
    ungroundedFor = 0;
    if (!stableGrounded && groundedFor >= landGraceSeconds) stableGrounded = true;
  } else {
    groundedFor = 0;
    ungroundedFor += dt;
    if (stableGrounded && ungroundedFor >= fallGraceSeconds && nextVy <= fallVyThreshold) {
      stableGrounded = false;
    }
  }
  if (tooSteepToStandEffective) stableGrounded = false;

  const wantsSlideBySlope =
    stableGrounded &&
    slopeAngle != null &&
    slopeAngle > maxSlopeClimbAngle + 1e-3 &&
    (slopeAngle <= slideToFallAngle + 1e-3 || slideToFallGraceActive);
  let slideExitFor = state.slideExitFor ?? 0;
  if (wasSliding && !wantsSlideBySlope) slideExitFor += dt;
  else slideExitFor = 0;
  const slideExitGraceActive =
    wasSliding && !wantsSlideBySlope && slideExitFor < slideExitGraceSeconds;

  let isSliding = false;
  if (stableGrounded) {
    if (slopeAngle == null) {
      isSliding = wasSliding && slideExitGraceActive;
    } else {
      isSliding = wantsSlideBySlope;
      if (!isSliding && slideExitGraceActive && slopeAngle <= slideToFallAngle + 1e-3) {
        isSliding = true;
      }
    }
  }

  const nextStableVy = stableGrounded && !isSliding && !state.jumpActive ? 0 : nextVy;

  return {
    ...state,
    px: solved.px,
    py: solved.py,
    pz: solved.pz,
    vx: nextVx,
    vy: nextStableVy,
    vz: nextVz,
    grounded: stableGrounded,
    falling: !stableGrounded && nextStableVy < -1,
    sliding: isSliding,
    groundedFor,
    ungroundedFor,
    slideExitFor,
    slideToFallFor,
  };
}
