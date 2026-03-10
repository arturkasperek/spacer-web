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
};

export type NpcPhysicsCoreConfig = {
  gravity: number;
  maxFallSpeed: number;
  moveDeadZone: number;
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
  const grounded = Boolean(solved.grounded);

  return {
    ...state,
    px: solved.px,
    py: solved.py,
    pz: solved.pz,
    vx: nextVx,
    vy: grounded ? 0 : nextVy,
    vz: nextVz,
    grounded,
    falling: !grounded && nextVy < -1,
    sliding: false,
  };
}
