import { useSyncExternalStore } from "react";

export type ViewSettingsState = {
  showVobSpots: boolean;
  showWaypoints: boolean;
  showLights: boolean;
  showFpsMeter: boolean;
  showKccCapsule: boolean;
};

const defaultState: ViewSettingsState = {
  showVobSpots: true,
  showWaypoints: true,
  showLights: true,
  showFpsMeter: false,
  showKccCapsule: false,
};

let snapshot: ViewSettingsState = defaultState;
const listeners = new Set<() => void>();

function setSnapshot(next: ViewSettingsState) {
  if (
    snapshot.showVobSpots === next.showVobSpots &&
    snapshot.showWaypoints === next.showWaypoints &&
    snapshot.showLights === next.showLights &&
    snapshot.showFpsMeter === next.showFpsMeter &&
    snapshot.showKccCapsule === next.showKccCapsule
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
    showFpsMeter: partial.showFpsMeter ?? snapshot.showFpsMeter,
    showKccCapsule: partial.showKccCapsule ?? snapshot.showKccCapsule,
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
