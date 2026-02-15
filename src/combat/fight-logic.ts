import type { CombatantSnapshot, DamageDescriptor, MeleeHit, MeleeAttackProfile } from "./types";
import { computeMeleeDamage } from "./damage-calculator";
import type { CombatState } from "./fight-state";
import { endActiveAction } from "./fight-state";
import { findMeleeHit } from "./melee-hit";

export type CombatEvent =
  | {
      type: "meleeAttackStarted";
      attackerId: number;
      attackId: number;
      profile: MeleeAttackProfile;
    }
  | { type: "meleeHit"; hit: MeleeHit; damage: DamageDescriptor }
  | { type: "meleeAttackEnded"; attackerId: number; attackId: number };

export function updateCombatStateTick({
  nowMs,
  attacker,
  attackerState,
  candidates,
}: {
  nowMs: number;
  attacker: CombatantSnapshot;
  attackerState: CombatState;
  candidates: CombatantSnapshot[];
}): { events: CombatEvent[]; attackerState: CombatState } {
  const events: CombatEvent[] = [];
  const a = attackerState.active;
  if (!a || a.type !== "meleeAttack") return { events, attackerState };

  const t0 = a.startedAtMs;
  const t1 = Math.max(t0, Math.floor(nowMs));
  const elapsed = t1 - t0;

  // Hit window: attempt exactly one hit.
  if (!a.hasDealtHit && elapsed >= a.profile.hitStartMs && elapsed <= a.profile.hitEndMs) {
    const hit = findMeleeHit(attacker, a.profile, candidates);
    if (hit) {
      const damage = computeMeleeDamage({
        attackerId: attacker.id,
        targetId: hit.targetId,
        attacker: attacker.stats,
        target: candidates.find((c) => c.id === hit.targetId)?.stats ?? attacker.stats,
        attack: a.profile,
      });
      a.hasDealtHit = true;
      events.push({ type: "meleeHit", hit, damage });
    }
  }

  // End by duration.
  if (t1 >= a.endsAtMs) {
    const attackId = a.id;
    endActiveAction(attackerState, t1);
    events.push({ type: "meleeAttackEnded", attackerId: attacker.id, attackId });
  }

  a.lastSampleAtMs = t1;
  return { events, attackerState };
}
