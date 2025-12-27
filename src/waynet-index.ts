export type WaynetPoint = { x: number; y: number; z: number };

const normalizeNameKey = (name: string): string => (name || "").trim().toUpperCase();

let waypointPositions = new Map<string, WaynetPoint>();

export function setWaynetWaypointPositions(positions: Map<string, WaynetPoint>): void {
  waypointPositions = positions;
}

export function getWaynetWaypointPosition(name: string): WaynetPoint | null {
  const key = normalizeNameKey(name);
  if (!key) return null;
  return waypointPositions.get(key) ?? null;
}

