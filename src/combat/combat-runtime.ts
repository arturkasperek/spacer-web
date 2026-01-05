import type * as THREE from "three";
import type { NpcData } from "../types";
import type { CombatantSnapshot, CombatStats, MeleeAttackProfile, WeaponState } from "./types";
import { applyDamageToState, createCombatState, startMeleeAttack, type CombatState } from "./fight-state";
import { updateCombatStateTick } from "./fight-logic";

export type CombatRuntime = {
  ensureNpc: (npc: NpcData) => CombatState;
  getState: (npcInstanceIndex: number) => CombatState | null;
  requestMeleeAttack: (npcInstanceIndex: number, profile?: Partial<MeleeAttackProfile>) => boolean;
  update: (opts: {
    nowMs: number;
    dtSeconds: number;
    loadedNpcs: Iterable<THREE.Group>;
    resolveAnim?: (npcInstanceIndex: number, animationName: string) => { animationName: string; modelName?: string };
  }) => void;
};

const toNum = (v: any): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function normalizeXZ(x: number, z: number): { x: number; z: number } {
  const len = Math.hypot(x, z);
  if (len < 1e-8) return { x: 0, z: 1 };
  return { x: x / len, z: z / len };
}

function readStatsFromNpcData(npc: NpcData): CombatStats {
  const info: any = npc.npcInfo ?? {};
  const rawHpMax = toNum(info.hpmax ?? info.hpMax);
  const rawHp = toNum(info.hp ?? info.hpCur);

  // VM integration is still minimal; when the script bridge can't read hitpoints yet it often yields 0/0.
  // Treat 0/0 as "unknown" and default to a sensible alive state so combat inputs produce visible results.
  const unknownHp = rawHpMax <= 0 && rawHp <= 0;
  const hpMax = Math.max(1, Math.floor(unknownHp ? 100 : rawHpMax || rawHp || 1));
  const hp = Math.max(0, Math.floor(unknownHp ? hpMax : rawHp || hpMax));
  const strength = Math.max(0, Math.floor(toNum(info.strength ?? info.atrStrength ?? 10)));
  const dexterity = Math.max(0, Math.floor(toNum(info.dexterity ?? info.atrDexterity ?? 10)));

  // Placeholder until we read real equipment/protection from VM.
  const weaponDamage = {
    edge: Math.max(0, Math.floor(toNum(info.weaponDamageEdge ?? info.weaponDamage ?? 20))),
  } as const;
  const protection = {
    edge: Math.max(0, Math.floor(toNum(info.protectionEdge ?? 0))),
  } as const;

  return {
    hp,
    hpMax,
    strength,
    dexterity,
    weaponDamage: { ...weaponDamage },
    protection: { ...protection },
  };
}

function readStatsWithHpQuality(npc: NpcData): { stats: CombatStats; unknownHp: boolean } {
  const info: any = npc.npcInfo ?? {};
  const rawHpMax = toNum(info.hpmax ?? info.hpMax);
  const rawHp = toNum(info.hp ?? info.hpCur);
  const unknownHp = rawHpMax <= 0 && rawHp <= 0;
  return { stats: readStatsFromNpcData(npc), unknownHp };
}

function defaultMeleeProfile(weaponState: WeaponState): MeleeAttackProfile {
  // First-cut timings (will be replaced with animation-driven windows).
  return {
    kind: "left",
    weaponState,
    durationMs: 900,
    hitStartMs: 240,
    hitEndMs: 420,
    comboWindowStartMs: 420,
    comboWindowEndMs: 650,
    range: 140,
    arcDeg: 90,
    damageType: "edge",
  };
}

function pickAttackAnimationName(ws: WeaponState, kind: string): { name: string; fallback?: string[] } {
  if (ws === "2h") return { name: "T_2HATTACKL", fallback: ["S_Run"] };
  if (ws === "1h") {
    if (kind === "right") return { name: "T_1HATTACKR", fallback: ["T_1HATTACKL", "S_Run"] };
    if (kind === "forward") return { name: "T_1HATTACKL", fallback: ["T_1HATTACKR", "S_Run"] };
    return { name: "T_1HATTACKL", fallback: ["T_1HATTACKR", "S_Run"] };
  }
  return { name: "S_Run", fallback: ["S_Run"] };
}

export function createCombatRuntime(): CombatRuntime {
  const states = new Map<number, CombatState>();

  const ensureNpc = (npc: NpcData): CombatState => {
    let st = states.get(npc.instanceIndex);
    if (!st) {
      const stats = readStatsFromNpcData(npc);
      st = createCombatState({ hp: stats.hp, hpMax: stats.hpMax, weaponState: "1h" });
      states.set(npc.instanceIndex, st);
    }
    return st;
  };

  const getState = (npcInstanceIndex: number): CombatState | null => {
    return states.get(npcInstanceIndex) ?? null;
  };

  const requestMeleeAttack = (npcInstanceIndex: number, profile?: Partial<MeleeAttackProfile>): boolean => {
    const st = states.get(npcInstanceIndex);
    if (!st || st.dead || st.active) return false;
    // Attack start is stamped in update() to keep ordering deterministic.
    (st as any)._queuedMeleeProfile = profile ?? {};
    return true;
  };

  const update = ({
    nowMs,
    loadedNpcs,
    resolveAnim,
  }: {
    nowMs: number;
    dtSeconds: number;
    loadedNpcs: Iterable<any>;
    resolveAnim?: (npcInstanceIndex: number, animationName: string) => { animationName: string; modelName?: string };
  }) => {
    const snapshots: CombatantSnapshot[] = [];
    const groupsById = new Map<number, any>();
    const dataById = new Map<number, NpcData>();

    for (const g of loadedNpcs) {
      if (!g || g.userData?.isDisposed) continue;
      const npc = g.userData.npcData as NpcData | undefined;
      if (!npc) continue;
      const st = ensureNpc(npc);
      const { stats, unknownHp } = readStatsWithHpQuality(npc);

      // Once combat runtime owns HP, keep it stable and write back to npcInfo.
      // But allow late-arriving VM values to replace our initial "unknown 0/0" default.
      const hadUnknownHp = Boolean((st as any)._hpUnknown);
      if (!hadUnknownHp) (st as any)._hpUnknown = unknownHp;
      const hpUnknown = Boolean((st as any)._hpUnknown);

      if (hpUnknown && !unknownHp) {
        st.hpMax = stats.hpMax;
        st.hp = Math.min(st.hpMax, Math.max(0, stats.hp));
        (st as any)._hpUnknown = false;
      } else {
        // If we know max HP from scripts, keep it in sync (without overriding current HP).
        if (!unknownHp && stats.hpMax > 0 && stats.hpMax !== st.hpMax) {
          st.hpMax = stats.hpMax;
          if (st.hp > st.hpMax) st.hp = st.hpMax;
        }
        if (st.hp > st.hpMax) st.hp = st.hpMax;
        if (st.hp < 0) st.hp = 0;
      }

      st.dead = st.hp <= 0;

      // Persist HP to npcInfo so UI/debugging and subsequent ticks have a single source of truth.
      {
        const info: any = npc.npcInfo ?? (npc.npcInfo = {});
        // Avoid poisoning `npcInfo` with our fallback "unknown 0/0 => 100/100" values.
        // Only publish once we have real script HP (or after the unknown state is cleared).
        if (!hpUnknown) {
          info.hp = st.hp;
          info.hpmax = st.hpMax;
        }
      }

      const q = g.quaternion;
      // Forward in our yaw convention is +Z rotated by quaternion.
      const fx = 2 * (q.x * q.z + q.w * q.y);
      const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      const f = normalizeXZ(fx, fz);

      snapshots.push({
        id: npc.instanceIndex,
        pos: { x: g.position.x, y: g.position.y, z: g.position.z },
        forwardXZ: f,
        stats: { ...stats, hp: st.hp, hpMax: st.hpMax },
        weaponState: st.weaponState,
      });
      groupsById.set(npc.instanceIndex, g);
      dataById.set(npc.instanceIndex, npc);
    }

    // Start queued attacks
    for (const s of snapshots) {
      const st = states.get(s.id);
      if (!st || st.dead || st.active) continue;
      const queued = (st as any)._queuedMeleeProfile as Partial<MeleeAttackProfile> | undefined;
      if (!queued) continue;
      delete (st as any)._queuedMeleeProfile;

      const base = defaultMeleeProfile(st.weaponState);
      const profile: MeleeAttackProfile = {
        ...base,
        ...queued,
        weaponState: st.weaponState,
      };
      startMeleeAttack(st, nowMs, profile);

      const g = groupsById.get(s.id);
      const inst = g?.userData?.characterInstance;
      if (g && inst) {
        const ani = pickAttackAnimationName(st.weaponState, profile.kind);
        const ref = resolveAnim ? resolveAnim(s.id, ani.name) : { animationName: ani.name };
        (g.userData as any)._emSuppressLocomotion = true;
        inst.setAnimation(ref.animationName, {
          modelName: ref.modelName,
          loop: false,
          resetTime: true,
          fallbackNames: ani.fallback,
          next: { animationName: "s_Run", loop: true, resetTime: true, fallbackNames: ["s_Run"] },
        });
        (g.userData as any)._combatAnimEndAtMs = nowMs + profile.durationMs;
      }
    }

    // Process hits
    for (const attacker of snapshots) {
      const st = states.get(attacker.id);
      if (!st || st.dead || !st.active) continue;
      const candidates = snapshots.filter((x) => x.id !== attacker.id);
      const r = updateCombatStateTick({ nowMs, attacker, attackerState: st, candidates });
      states.set(attacker.id, r.attackerState);
      for (const ev of r.events) {
        if (ev.type === "meleeHit") {
          const tgtState = states.get(ev.hit.targetId);
          if (!tgtState || tgtState.dead) continue;
          applyDamageToState(tgtState, ev.damage.finalDamage);
          const npc = dataById.get(ev.hit.targetId);
          if (npc) {
            const info: any = npc.npcInfo ?? (npc.npcInfo = {});
            info.hp = tgtState.hp;
            info.hpmax = tgtState.hpMax;
          }
          const g = groupsById.get(ev.hit.targetId);
          if (g) (g.userData as any)._combatLastHitAtMs = nowMs;
        }
      }
    }

    // Clear locomotion suppression after the attack animation ends.
    for (const [id, g] of groupsById.entries()) {
      const st = states.get(id);
      if (!st) continue;
      const endAt = (g.userData as any)._combatAnimEndAtMs as number | undefined;
      if (typeof endAt === "number" && nowMs >= endAt && !st.active) {
        delete (g.userData as any)._emSuppressLocomotion;
        delete (g.userData as any)._combatAnimEndAtMs;
      }
    }
  };

  return { ensureNpc, getState, requestMeleeAttack, update };
}
