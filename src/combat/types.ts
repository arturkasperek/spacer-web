export type DamageIndex = "blunt" | "edge" | "point" | "fire" | "magic" | "fly";

export type DamageByIndex = Partial<Record<DamageIndex, number>>;

export type WeaponState = "noWeapon" | "1h" | "2h";

export type MeleeAttackKind = "left" | "right" | "forward";

export type MeleeAttackProfile = {
  kind: MeleeAttackKind;
  weaponState: WeaponState;
  durationMs: number;
  hitStartMs: number;
  hitEndMs: number;
  comboWindowStartMs?: number;
  comboWindowEndMs?: number;
  range: number;
  arcDeg: number;
  damageType: DamageIndex;
};

export type CombatStats = {
  hp: number;
  hpMax: number;
  strength: number;
  dexterity: number;
  weaponDamage: DamageByIndex;
  protection: DamageByIndex;
};

export type CombatantSnapshot = {
  id: number;
  pos: { x: number; y: number; z: number };
  forwardXZ: { x: number; z: number };
  stats: CombatStats;
  weaponState: WeaponState;
};

export type DamageDescriptor = {
  attackerId: number;
  targetId: number;
  baseDamage: number;
  damageType: DamageIndex;
  finalDamage: number;
};

export type MeleeHit = {
  attackerId: number;
  targetId: number;
  distance: number;
  angleDeg: number;
};

