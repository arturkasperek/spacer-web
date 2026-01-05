import type { MeleeAttackProfile, WeaponState } from "./types";

export type MeleeAttackState = {
  type: "meleeAttack";
  id: number;
  startedAtMs: number;
  endsAtMs: number;
  profile: MeleeAttackProfile;
  hasDealtHit: boolean;
  lastSampleAtMs: number;
};

export type CombatState = {
  weaponState: WeaponState;
  hp: number;
  hpMax: number;
  dead: boolean;
  active: MeleeAttackState | null;
  lastAttackEndedAtMs: number;
};

export function createCombatState(opts?: Partial<Pick<CombatState, "weaponState" | "hp" | "hpMax">>): CombatState {
  const hpMax = typeof opts?.hpMax === "number" && Number.isFinite(opts.hpMax) ? Math.max(1, Math.floor(opts.hpMax)) : 1;
  const hp = typeof opts?.hp === "number" && Number.isFinite(opts.hp) ? Math.max(0, Math.floor(opts.hp)) : hpMax;
  const weaponState = opts?.weaponState ?? "noWeapon";
  return {
    weaponState,
    hp,
    hpMax,
    dead: hp <= 0,
    active: null,
    lastAttackEndedAtMs: 0,
  };
}

let nextAttackId = 1;

export function startMeleeAttack(state: CombatState, nowMs: number, profile: MeleeAttackProfile): CombatState {
  if (state.dead) return state;
  if (state.active) return state;

  const dur = Math.max(1, Math.floor(profile.durationMs));
  const startedAtMs = Math.max(0, Math.floor(nowMs));

  state.active = {
    type: "meleeAttack",
    id: nextAttackId++,
    startedAtMs,
    endsAtMs: startedAtMs + dur,
    profile,
    hasDealtHit: false,
    lastSampleAtMs: startedAtMs,
  };
  return state;
}

export function endActiveAction(state: CombatState, nowMs: number): CombatState {
  if (!state.active) return state;
  state.active = null;
  state.lastAttackEndedAtMs = Math.max(0, Math.floor(nowMs));
  return state;
}

export function applyDamageToState(state: CombatState, damage: number): CombatState {
  if (state.dead) return state;
  const d = typeof damage === "number" && Number.isFinite(damage) ? Math.max(0, Math.floor(damage)) : 0;
  state.hp = Math.max(0, state.hp - d);
  state.dead = state.hp <= 0;
  return state;
}

