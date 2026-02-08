import { useSyncExternalStore } from "react";

export type ViewSettingsState = {
  showVobSpots: boolean;
  showWaypoints: boolean;
  showLights: boolean;
  showFpsMeter: boolean;
  showKccCapsule: boolean;
  showGroundProbeRay: boolean;
  showTestMoveRay: boolean;
  hideHero: boolean;
  timeScale: number;
};

const defaultState: ViewSettingsState = {
  showVobSpots: true,
  showWaypoints: true,
  showLights: true,
  showFpsMeter: false,
  showKccCapsule: false,
  showGroundProbeRay: false,
  showTestMoveRay: false,
  hideHero: false,
  timeScale: 1,
};

let snapshot: ViewSettingsState = defaultState;
const listeners = new Set<() => void>();

function setSnapshot(next: ViewSettingsState) {
  if (
    snapshot.showVobSpots === next.showVobSpots &&
    snapshot.showWaypoints === next.showWaypoints &&
    snapshot.showLights === next.showLights &&
    snapshot.showFpsMeter === next.showFpsMeter &&
    snapshot.showKccCapsule === next.showKccCapsule &&
    snapshot.showGroundProbeRay === next.showGroundProbeRay &&
    snapshot.showTestMoveRay === next.showTestMoveRay &&
    snapshot.hideHero === next.hideHero &&
    snapshot.timeScale === next.timeScale
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
    showGroundProbeRay: partial.showGroundProbeRay ?? snapshot.showGroundProbeRay,
    showTestMoveRay: partial.showTestMoveRay ?? snapshot.showTestMoveRay,
    hideHero: partial.hideHero ?? snapshot.hideHero,
    timeScale: partial.timeScale ?? snapshot.timeScale,
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
