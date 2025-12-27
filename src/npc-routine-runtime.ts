export type NpcRoutineRuntime = {
  stateName: string;
  waypointName: string;
  startMinute: number;
  stopMinute: number;
};

const normalizeNameKey = (name: string): string => (name || "").trim().toUpperCase();

const currentRoutineByNpc = new Map<number, NpcRoutineRuntime>();

export function setNpcRoutineRuntime(npcInstanceIndex: number, runtime: NpcRoutineRuntime | null): void {
  if (!Number.isFinite(npcInstanceIndex) || npcInstanceIndex <= 0) return;
  if (!runtime) {
    currentRoutineByNpc.delete(npcInstanceIndex);
    return;
  }
  currentRoutineByNpc.set(npcInstanceIndex, {
    stateName: (runtime.stateName || "").trim(),
    waypointName: normalizeNameKey(runtime.waypointName),
    startMinute: Math.max(0, Math.min(24 * 60, Math.floor(runtime.startMinute))),
    stopMinute: Math.max(0, Math.min(24 * 60, Math.floor(runtime.stopMinute))),
  });
}

export function getNpcRoutineWaypointName(npcInstanceIndex: number): string {
  return currentRoutineByNpc.get(npcInstanceIndex)?.waypointName ?? "";
}

export function getNpcRoutineStateName(npcInstanceIndex: number): string {
  return currentRoutineByNpc.get(npcInstanceIndex)?.stateName ?? "";
}

export function getNpcRoutineKey(npcInstanceIndex: number): string {
  const r = currentRoutineByNpc.get(npcInstanceIndex);
  if (!r) return "";
  return `${r.stateName}|${r.waypointName}|${r.startMinute}|${r.stopMinute}`;
}

