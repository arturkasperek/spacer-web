export type WaynetWaypoint = {
  name: string;
  position: { x: number; y: number; z: number };
};

export type WaynetEdge = {
  waypoint_a_index: number;
  waypoint_b_index: number;
};

export type WaynetGraph = {
  waypoints: WaynetWaypoint[];
  adjacency: number[][];
  nameToIndex: Map<string, number>;
};

export function buildWaynetGraph(waypoints: WaynetWaypoint[], edges: WaynetEdge[]): WaynetGraph {
  const adjacency: number[][] = Array.from({ length: waypoints.length }, () => []);
  for (const e of edges) {
    const a = e.waypoint_a_index;
    const b = e.waypoint_b_index;
    if (a < 0 || b < 0 || a >= waypoints.length || b >= waypoints.length) continue;
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  const nameToIndex = new Map<string, number>();
  for (let i = 0; i < waypoints.length; i++) {
    const key = (waypoints[i]?.name || "").trim().toUpperCase();
    if (!key) continue;
    if (!nameToIndex.has(key)) nameToIndex.set(key, i);
  }

  return { waypoints, adjacency, nameToIndex };
}

export function findNearestWaypointIndex(
  graph: Pick<WaynetGraph, "waypoints">,
  pos: { x: number; y: number; z: number },
): number {
  let bestIdx = -1;
  let bestDist2 = Number.POSITIVE_INFINITY;

  for (let i = 0; i < graph.waypoints.length; i++) {
    const p = graph.waypoints[i].position;
    const dx = p.x - pos.x;
    const dy = p.y - pos.y;
    const dz = p.z - pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestIdx = i;
    }
  }

  return bestIdx;
}

export function findWaypointIndexByName(
  graph: Pick<WaynetGraph, "nameToIndex">,
  name: string,
): number {
  const key = (name || "").trim().toUpperCase();
  if (!key) return -1;
  return graph.nameToIndex.get(key) ?? -1;
}

function dist(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function findRouteAStar(
  graph: WaynetGraph,
  startIndex: number,
  goalIndex: number,
): number[] {
  if (startIndex < 0 || goalIndex < 0) return [];
  if (startIndex >= graph.waypoints.length || goalIndex >= graph.waypoints.length) return [];
  if (startIndex === goalIndex) return [startIndex];

  const open = new Set<number>();
  open.add(startIndex);

  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>();
  const fScore = new Map<number, number>();
  gScore.set(startIndex, 0);

  const goalPos = graph.waypoints[goalIndex].position;
  fScore.set(startIndex, dist(graph.waypoints[startIndex].position, goalPos));

  const getLowestF = (): number => {
    let bestNode = -1;
    let bestF = Number.POSITIVE_INFINITY;
    for (const node of open) {
      const f = fScore.get(node) ?? Number.POSITIVE_INFINITY;
      if (f < bestF) {
        bestF = f;
        bestNode = node;
      }
    }
    return bestNode;
  };

  while (open.size > 0) {
    const current = getLowestF();
    if (current === -1) break;
    if (current === goalIndex) {
      const path: number[] = [current];
      let cur = current;
      while (cameFrom.has(cur)) {
        cur = cameFrom.get(cur)!;
        path.push(cur);
      }
      path.reverse();
      return path;
    }

    open.delete(current);
    const curPos = graph.waypoints[current].position;

    for (const neighbor of graph.adjacency[current] || []) {
      const tentativeG =
        (gScore.get(current) ?? Number.POSITIVE_INFINITY) +
        dist(curPos, graph.waypoints[neighbor].position);
      if (tentativeG < (gScore.get(neighbor) ?? Number.POSITIVE_INFINITY)) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentativeG);
        fScore.set(neighbor, tentativeG + dist(graph.waypoints[neighbor].position, goalPos));
        open.add(neighbor);
      }
    }
  }

  return [];
}
