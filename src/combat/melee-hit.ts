import type { CombatantSnapshot, MeleeAttackProfile, MeleeHit } from "./types";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function angleDegBetweenXZ(ax: number, az: number, bx: number, bz: number): number {
  const ad = Math.hypot(ax, az);
  const bd = Math.hypot(bx, bz);
  if (ad < 1e-8 || bd < 1e-8) return 180;
  const dot = (ax * bx + az * bz) / (ad * bd);
  const a = Math.acos(clamp(dot, -1, 1));
  return (a * 180) / Math.PI;
}

export function findMeleeHit(
  attacker: CombatantSnapshot,
  attack: Pick<MeleeAttackProfile, "range" | "arcDeg">,
  candidates: CombatantSnapshot[]
): MeleeHit | null {
  const range = Math.max(0, attack.range);
  const maxArc = Math.max(0, attack.arcDeg);
  if (range <= 1e-6 || maxArc <= 1e-6) return null;

  const ax = attacker.pos.x;
  const az = attacker.pos.z;
  const fx = attacker.forwardXZ.x;
  const fz = attacker.forwardXZ.z;

  let best: MeleeHit | null = null;
  let bestD2 = Infinity;

  for (const c of candidates) {
    if (!c || c.id === attacker.id) continue;
    if (c.stats.hp <= 0) continue;

    const dx = c.pos.x - ax;
    const dz = c.pos.z - az;
    const d = Math.hypot(dx, dz);
    if (d > range) continue;
    const ang = angleDegBetweenXZ(fx, fz, dx, dz);
    if (ang > maxArc * 0.5) continue;

    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { attackerId: attacker.id, targetId: c.id, distance: d, angleDeg: ang };
    }
  }

  return best;
}

