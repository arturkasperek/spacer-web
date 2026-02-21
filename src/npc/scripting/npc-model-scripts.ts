export type NpcModelScriptsState = {
  baseScript: string;
  overlays: string[];
  hasExplicitBaseScript?: boolean;
};

const npcModelScriptsByInstance = new Map<number, NpcModelScriptsState>();

export function __resetNpcModelScriptsForTests(): void {
  npcModelScriptsByInstance.clear();
}

export function getNpcModelScriptsState(npcInstanceIndex: number): NpcModelScriptsState {
  const existing = npcModelScriptsByInstance.get(npcInstanceIndex);
  if (existing) return existing;
  const init: NpcModelScriptsState = {
    baseScript: "HUMANS",
    overlays: [],
    hasExplicitBaseScript: false,
  };
  npcModelScriptsByInstance.set(npcInstanceIndex, init);
  return init;
}

export function setNpcBaseModelScript(npcInstanceIndex: number, baseScriptKey: string): void {
  if (!Number.isFinite(npcInstanceIndex) || npcInstanceIndex <= 0) return;
  const key = (baseScriptKey || "").trim().toUpperCase();
  if (!key) return;
  npcModelScriptsByInstance.set(npcInstanceIndex, {
    baseScript: key,
    overlays: [],
    hasExplicitBaseScript: true,
  });
}

export function addNpcOverlayModelScript(npcInstanceIndex: number, overlayScriptKey: string): void {
  if (!Number.isFinite(npcInstanceIndex) || npcInstanceIndex <= 0) return;
  const key = (overlayScriptKey || "").trim().toUpperCase();
  if (!key) return;
  const st = getNpcModelScriptsState(npcInstanceIndex);
  if (!st.overlays.includes(key)) st.overlays.push(key);
}

export function removeNpcOverlayModelScript(
  npcInstanceIndex: number,
  overlayScriptKey: string,
): void {
  if (!Number.isFinite(npcInstanceIndex) || npcInstanceIndex <= 0) return;
  const key = (overlayScriptKey || "").trim().toUpperCase();
  if (!key) return;
  const st = getNpcModelScriptsState(npcInstanceIndex);
  st.overlays = st.overlays.filter((o) => o !== key);
  npcModelScriptsByInstance.set(npcInstanceIndex, st);
}
