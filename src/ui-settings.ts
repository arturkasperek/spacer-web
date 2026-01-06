import { useSyncExternalStore } from "react";

export type UiSettingsState = {
  showVobTree: boolean;
  showStatusBar: boolean;
};

const defaultState: UiSettingsState = {
  showVobTree: true,
  showStatusBar: true,
};

let snapshot: UiSettingsState = defaultState;
const listeners = new Set<() => void>();

function setSnapshot(next: UiSettingsState) {
  const n: UiSettingsState = {
    showVobTree: Boolean(next.showVobTree),
    showStatusBar: Boolean(next.showStatusBar),
  };
  if (snapshot.showVobTree === n.showVobTree && snapshot.showStatusBar === n.showStatusBar) return;
  snapshot = n;
  for (const l of listeners) l();
}

export function getUiSettings(): UiSettingsState {
  return snapshot;
}

export function setUiSettings(partial: Partial<UiSettingsState>): void {
  setSnapshot({
    showVobTree: partial.showVobTree ?? snapshot.showVobTree,
    showStatusBar: partial.showStatusBar ?? snapshot.showStatusBar,
  });
}

export function toggleUiSetting(key: keyof UiSettingsState): void {
  setSnapshot({ ...snapshot, [key]: !snapshot[key] });
}

export function subscribeUiSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiSettings(): UiSettingsState {
  return useSyncExternalStore(subscribeUiSettings, getUiSettings, getUiSettings);
}

export function __resetUiSettingsForTests(): void {
  setSnapshot(defaultState);
}

