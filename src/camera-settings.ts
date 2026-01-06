import { useSyncExternalStore } from "react";

export type CameraSettingsState = {
  freeCamera: boolean;
};

const defaultState: CameraSettingsState = {
  freeCamera: false,
};

let snapshot: CameraSettingsState = defaultState;
const listeners = new Set<() => void>();
let popstateInstalled = false;

function readFromUrl(): CameraSettingsState {
  try {
    if (typeof window === "undefined") return snapshot;
    const qs = new URLSearchParams(window.location.search);
    return { freeCamera: qs.has("freeCamera") };
  } catch {
    return snapshot;
  }
}

function writeToUrl(next: CameraSettingsState): void {
  try {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next.freeCamera) url.searchParams.set("freeCamera", "1");
    else url.searchParams.delete("freeCamera");
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // ignore
  }
}

function setSnapshot(next: CameraSettingsState, opts?: { syncUrl?: boolean }) {
  const n = { freeCamera: Boolean(next.freeCamera) };
  if (snapshot.freeCamera === n.freeCamera) return;
  snapshot = n;
  if (opts?.syncUrl) writeToUrl(snapshot);
  for (const l of listeners) l();
}

function ensureUrlSync(): void {
  if (popstateInstalled) return;
  popstateInstalled = true;
  try {
    if (typeof window === "undefined") return;
    window.addEventListener("popstate", () => setSnapshot(readFromUrl(), { syncUrl: false }));
  } catch {
    // ignore
  }
}

export function getCameraSettings(): CameraSettingsState {
  ensureUrlSync();
  if (typeof window !== "undefined") {
    // Best-effort: keep in sync with URL on first access.
    const fromUrl = readFromUrl();
    if (fromUrl.freeCamera !== snapshot.freeCamera) snapshot = fromUrl;
  }
  return snapshot;
}

export function setCameraSettings(partial: Partial<CameraSettingsState>): void {
  setSnapshot({ ...snapshot, ...partial }, { syncUrl: true });
}

export function toggleCameraSetting(key: keyof CameraSettingsState): void {
  setSnapshot({ ...snapshot, [key]: !snapshot[key] }, { syncUrl: true });
}

export function subscribeCameraSettings(listener: () => void): () => void {
  ensureUrlSync();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCameraSettings(): CameraSettingsState {
  return useSyncExternalStore(subscribeCameraSettings, getCameraSettings, getCameraSettings);
}

export function __resetCameraSettingsForTests(): void {
  snapshot = defaultState;
  for (const l of listeners) l();
}

