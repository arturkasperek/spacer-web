export type NpcRapierSimulatedDelayRange = {
  min: number;
  max: number;
};

type NpcRapierDelayProfile = "baseline" | "jitter" | "stress";

const NPC_RAPIER_DELAY_PROFILE: NpcRapierDelayProfile = "jitter";

const NPC_RAPIER_DELAY_PRESETS: Record<NpcRapierDelayProfile, NpcRapierSimulatedDelayRange> = {
  baseline: { min: 1, max: 1 },
  jitter: { min: 1, max: 2 },
  stress: { min: 1, max: 3 },
};

export function getNpcRapierSimulatedDelayRange(): NpcRapierSimulatedDelayRange {
  return NPC_RAPIER_DELAY_PRESETS[NPC_RAPIER_DELAY_PROFILE];
}
