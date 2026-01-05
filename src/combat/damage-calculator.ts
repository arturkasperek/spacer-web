import type { CombatStats, DamageDescriptor, DamageIndex, MeleeAttackProfile } from "./types";

const n = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function computeMeleeDamage({
  attackerId,
  targetId,
  attacker,
  target,
  attack,
}: {
  attackerId: number;
  targetId: number;
  attacker: CombatStats;
  target: CombatStats;
  attack: Pick<MeleeAttackProfile, "damageType">;
}): DamageDescriptor {
  const damageType: DamageIndex = attack.damageType;
  const weapon = n(attacker.weaponDamage[damageType]);
  const strength = n(attacker.strength);
  const protection = n(target.protection[damageType]);

  // First-cut approximation:
  // - A lot of Gothic's "feel" comes from the correct damage type, protection, and STR scaling.
  // - Exact G2 math (crits, talents, edge cases) can be filled in later without changing the API.
  const baseDamage = Math.max(0, weapon + strength);
  const finalDamage = Math.max(0, baseDamage - protection);

  return {
    attackerId,
    targetId,
    baseDamage,
    damageType,
    finalDamage,
  };
}

