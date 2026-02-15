import type { NpcData } from "../../shared/types";

export const normalizeNameKey = (name: string): string => (name || "").trim().toUpperCase();

export const HERO_SYMBOL_NAME = "PC_HERO";

export const isHeroNpcData = (npcData: NpcData | undefined): boolean => {
  if (!npcData) return false;
  const symbolName = normalizeNameKey(npcData.symbolName || "");
  return symbolName === HERO_SYMBOL_NAME;
};
