export type XZPoint = { x: number; z: number; y?: number };

export type SpreadSpawnResult = {
  x: number;
  z: number;
  applied: boolean;
  tries: number;
};

const goldenAngle = Math.PI * (3 - Math.sqrt(5));

const distSqXZ = (ax: number, az: number, bx: number, bz: number) => {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
};

export function spreadSpawnXZ(params: {
  baseX: number;
  baseZ: number;
  baseY?: number;
  existing: readonly XZPoint[];
  minSeparation: number;
  maxTries?: number;
  maxYDelta?: number;
}): SpreadSpawnResult {
  const maxTries = Math.max(1, Math.floor(params.maxTries ?? 24));
  const minSep = Math.max(0, params.minSeparation);
  const minSepSq = minSep * minSep;
  const maxYDelta = params.maxYDelta ?? Infinity;

  const isFree = (x: number, z: number) => {
    for (const p of params.existing) {
      if (params.baseY != null && p.y != null && Number.isFinite(maxYDelta)) {
        if (Math.abs(params.baseY - p.y) > maxYDelta) continue;
      }
      if (distSqXZ(x, z, p.x, p.z) < minSepSq) return false;
    }
    return true;
  };

  if (isFree(params.baseX, params.baseZ)) {
    return { x: params.baseX, z: params.baseZ, applied: false, tries: 0 };
  }

  // Try deterministic spiral offsets around the base position.
  // This is a lightweight approximation; dynamic collision will handle the rest during motion.
  for (let i = 1; i <= maxTries; i++) {
    const a = i * goldenAngle;
    // Increase radius gradually; start just outside the minimum separation.
    const r = minSep * (1 + i * 0.35);
    const x = params.baseX + Math.cos(a) * r;
    const z = params.baseZ + Math.sin(a) * r;
    if (isFree(x, z)) return { x, z, applied: true, tries: i };
  }

  // Give up: keep the original position (dynamic collision may still separate later).
  return { x: params.baseX, z: params.baseZ, applied: false, tries: maxTries };
}

