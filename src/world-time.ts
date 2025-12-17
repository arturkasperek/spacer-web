import { useSyncExternalStore } from "react";

// Mirrors Gothic2's oCWorldTimer timing (see `G2EngineOriginal/release/Gothic/_ulf/oWorld.h`).
// The original accumulates `ztimer.GetFrameTimeF()` (milliseconds) into `worldTime`.
export const WLD_TICKSPERHOUR = 250.0 * 1000.0;
export const WLD_TICKSPERMIN = WLD_TICKSPERHOUR / 60.0;
export const WLD_TICKSPERSEC = WLD_TICKSPERMIN / 60.0;
export const WLD_TICKSPERDAY = WLD_TICKSPERHOUR * 24.0;

export type WorldTimeState = {
  day: number;
  hour: number;
  minute: number;
  worldTimeMs: number;
};

// Default to 10:00 like our existing NPC routine assumptions.
const DEFAULT_START_DAY = 0;
const DEFAULT_START_HOUR = 10;
const DEFAULT_START_MIN = 0;

let worldTimeMs = (DEFAULT_START_HOUR % 24) * WLD_TICKSPERHOUR + (DEFAULT_START_MIN % 60) * WLD_TICKSPERMIN;
let day = DEFAULT_START_DAY;
let accMs = 0;

// Only notify React subscribers when the displayed time changes.
let lastPublishedKey = `${day}:${Math.floor((worldTimeMs * 60) / WLD_TICKSPERHOUR)}`;

const listeners = new Set<() => void>();

const pad2 = (n: number) => String(n).padStart(2, "0");

const computeSnapshot = (): WorldTimeState => {
  const baseHour = Math.floor(worldTimeMs / WLD_TICKSPERHOUR) % 24;
  const rem = worldTimeMs - baseHour * WLD_TICKSPERHOUR;
  // Use integer math to avoid floating-point drift and match expected clock display.
  const minute = Math.floor((rem * 60) / WLD_TICKSPERHOUR) % 60;
  return {
    day,
    hour: baseHour,
    minute,
    worldTimeMs,
  };
};

let snapshot: WorldTimeState = computeSnapshot();

export function getWorldTime(): WorldTimeState {
  // IMPORTANT: `useSyncExternalStore` requires that `getSnapshot` returns a stable reference
  // when there were no changes. We update `snapshot` only when time changes.
  return snapshot;
}

export function getWorldTimeString(): string {
  const t = snapshot;
  return `${t.day} ${pad2(t.hour)}:${pad2(t.minute)}`;
}

// Gothic2's `GetSkyTime()` mapping used by the sky controller.
export function getSkyTime01(): number {
  // 0..1, 0=12h, 0.5=24h, 1=12h
  let y = worldTimeMs / (WLD_TICKSPERHOUR * 24) + 0.5;
  while (y > 1.0) y -= 1.0;
  while (y < 0.0) y += 1.0;
  return y;
}

export function setWorldTime(newDay: number, hour: number, minute: number): void {
  day = Math.max(0, Math.floor(newDay));
  const h = ((hour % 24) + 24) % 24;
  const m = ((minute % 60) + 60) % 60;
  // Represent world time in integer milliseconds (like `ztimer.GetFrameTimeF()` usage).
  worldTimeMs = h * WLD_TICKSPERHOUR + Math.round((m * WLD_TICKSPERHOUR) / 60);
  accMs = 0;
  snapshot = computeSnapshot();
  lastPublishedKey = `${day}:${snapshot.hour * 60 + snapshot.minute}`;
  for (const l of listeners) l();
}

export function tickWorldTime(deltaSeconds: number): void {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
  accMs += deltaSeconds * 1000.0;
  const addMs = Math.floor(accMs);
  if (addMs <= 0) return;
  accMs -= addMs;

  worldTimeMs += addMs;
  if (worldTimeMs > WLD_TICKSPERDAY) {
    const daysPassed = Math.floor(worldTimeMs / WLD_TICKSPERDAY);
    day += daysPassed;
    worldTimeMs -= daysPassed * WLD_TICKSPERDAY;
  }

  const next = computeSnapshot();
  const key = `${day}:${next.hour * 60 + next.minute}`;
  if (key !== lastPublishedKey) {
    lastPublishedKey = key;
    snapshot = next;
    for (const l of listeners) l();
  }
}

export function subscribeWorldTime(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorldTime(): WorldTimeState {
  return useSyncExternalStore(subscribeWorldTime, getWorldTime, getWorldTime);
}

export function __resetWorldTimeForTests(): void {
  day = DEFAULT_START_DAY;
  worldTimeMs = (DEFAULT_START_HOUR % 24) * WLD_TICKSPERHOUR + Math.round(((DEFAULT_START_MIN % 60) * WLD_TICKSPERHOUR) / 60);
  accMs = 0;
  snapshot = computeSnapshot();
  lastPublishedKey = `${day}:${snapshot.hour * 60 + snapshot.minute}`;
  for (const l of listeners) l();
}
