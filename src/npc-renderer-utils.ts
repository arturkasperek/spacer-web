import type { NpcData } from "./types";

export const normalizeNameKey = (name: string): string => (name || "").trim().toUpperCase();

export const isCavalornNpcData = (npcData: NpcData | undefined): boolean => {
  if (!npcData) return false;
  const symbolName = (npcData.symbolName || "").trim().toUpperCase();
  const displayName = (npcData.name || "").trim().toUpperCase();
  return symbolName === "BAU_4300_ADDON_CAVALORN" || displayName === "CAVALORN";
};

