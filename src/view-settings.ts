import { useSyncExternalStore } from "react";

export type ViewSettingsState = {
  showVobSpots: boolean;
  showWaypoints: boolean;
  showLights: boolean;
};

const defaultState: ViewSettingsState = {
  showVobSpots: true,
  showWaypoints: true,
  showLights: true,
};

let snapshot: ViewSettingsState = defaultState;
const listeners = new Set<() => void>();

function setSnapshot(next: ViewSettingsState) {
  if (
    snapshot.showVobSpots === next.showVobSpots &&
    snapshot.showWaypoints === next.showWaypoints &&
    snapshot.showLights === next.showLights
  ) {
    return;
  }
  snapshot = next;
  for (const l of listeners) l();
}

export function getViewSettings(): ViewSettingsState {
  return snapshot;
}

export function setViewSettings(partial: Partial<ViewSettingsState>): void {
  setSnapshot({
    showVobSpots: partial.showVobSpots ?? snapshot.showVobSpots,
    showWaypoints: partial.showWaypoints ?? snapshot.showWaypoints,
    showLights: partial.showLights ?? snapshot.showLights,
  });
}

export function toggleViewSetting(key: keyof ViewSettingsState): void {
  setSnapshot({ ...snapshot, [key]: !snapshot[key] });
}

export function subscribeViewSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useViewSettings(): ViewSettingsState {
  return useSyncExternalStore(subscribeViewSettings, getViewSettings, getViewSettings);
}

export function __resetViewSettingsForTests(): void {
  setSnapshot(defaultState);
}

