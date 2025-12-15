import * as THREE from "three";
import type { World } from "@kolarz3/zenkit";
import {
  buildWaynetGraph,
  findNearestWaypointIndex,
  findRouteAStar,
  findWaypointIndexByName,
  type WaynetEdge,
  type WaynetGraph,
  type WaynetWaypoint,
} from "./waynet-pathfinding";
import type { LocomotionMode } from "./npc-locomotion";

export type WaypointMoveOptions = {
  speed: number;
  arriveDistance: number;
  locomotionMode: Exclude<LocomotionMode, "idle">;
};

export type WaypointMoveState = {
  route: THREE.Vector3[];
  nextIndex: number;
  speed: number;
  arriveDistance: number;
  locomotionMode: Exclude<LocomotionMode, "idle">;
  done: boolean;
};

export type WaypointMover = {
  startMoveToWaypoint: (
    npcId: string,
    npcGroup: THREE.Group,
    targetWaypointName: string,
    options?: Partial<WaypointMoveOptions>
  ) => boolean;
  update: (npcId: string, npcGroup: THREE.Group, deltaSeconds: number) => { moved: boolean; mode: LocomotionMode };
  clear: () => void;
};

export function createWaypointMover(world: World): WaypointMover {
  let waynetGraph: WaynetGraph | null = null;
  const moves = new Map<string, WaypointMoveState>();

  const tmpToTarget = new THREE.Vector3();
  const tmpToTargetHoriz = new THREE.Vector3();
  const tmpDesiredQuat = new THREE.Quaternion();
  const tmpUp = new THREE.Vector3(0, 1, 0);
  const TURN_SPEED = 10;

  const ensureWaynetGraph = (): WaynetGraph | null => {
    if (waynetGraph) return waynetGraph;

    try {
      const waypointsVector = world.getAllWaypoints() as any;
      const waypoints: WaynetWaypoint[] = [];
      const waypointCount = waypointsVector.size();
      for (let i = 0; i < waypointCount; i++) {
        const wp = waypointsVector.get(i);
        if (!wp) continue;
        waypoints.push({
          name: wp.name,
          position: {
            x: -wp.position.x,
            y: wp.position.y,
            z: wp.position.z,
          },
        });
      }

      const edges: WaynetEdge[] = [];
      const edgeCount = world.getWaypointEdgeCount();
      for (let i = 0; i < edgeCount; i++) {
        const edgeResult = world.getWaypointEdge(i);
        if (edgeResult.success && edgeResult.data) {
          edges.push(edgeResult.data);
        }
      }

      waynetGraph = buildWaynetGraph(waypoints, edges);
      return waynetGraph;
    } catch (error) {
      console.warn("[NPC] Failed to build waynet graph:", error);
      return null;
    }
  };

  return {
    startMoveToWaypoint: (npcId, npcGroup, targetWaypointName, options) => {
      const graph = ensureWaynetGraph();
      if (!graph) return false;

      const startIndex = findNearestWaypointIndex(graph, { x: npcGroup.position.x, y: npcGroup.position.y, z: npcGroup.position.z });
      const goalIndex = findWaypointIndexByName(graph, targetWaypointName);
      const routeIdx = findRouteAStar(graph, startIndex, goalIndex);
      if (routeIdx.length < 2) return false;

      const route = routeIdx.map(i => {
        const p = graph.waypoints[i].position;
        return new THREE.Vector3(p.x, p.y, p.z);
      });

      moves.set(npcId, {
        route,
        nextIndex: 1,
        speed: options?.speed ?? 140,
        arriveDistance: options?.arriveDistance ?? 5,
        locomotionMode: options?.locomotionMode ?? "walk",
        done: false,
      });
      npcGroup.userData.isScriptControlled = true;
      return true;
    },

    update: (npcId, npcGroup, deltaSeconds) => {
      const move = moves.get(npcId);
      if (!move || move.done) return { moved: false, mode: "idle" };

      const target = move.route[move.nextIndex];
      if (!target) {
        move.done = true;
        return { moved: false, mode: "idle" };
      }

      tmpToTarget.subVectors(target, npcGroup.position);
      const dist = tmpToTarget.length();

      if (dist > 0) {
        tmpToTargetHoriz.copy(tmpToTarget);
        tmpToTargetHoriz.y = 0;
        const yaw = Math.atan2(tmpToTargetHoriz.x, tmpToTargetHoriz.z);
        tmpDesiredQuat.setFromAxisAngle(tmpUp, yaw);
        const t = 1 - Math.exp(-TURN_SPEED * deltaSeconds);
        npcGroup.quaternion.slerp(tmpDesiredQuat, t);
      }

      if (dist > 0) {
        const maxStep = move.speed * deltaSeconds;
        const shouldSnap = dist <= Math.max(move.arriveDistance, maxStep);

        if (shouldSnap) {
          npcGroup.position.copy(target);
          move.nextIndex += 1;
          if (move.nextIndex >= move.route.length) {
            move.done = true;
          }
        } else {
          tmpToTarget.multiplyScalar(1 / dist);
          npcGroup.position.addScaledVector(tmpToTarget, maxStep);
        }
      }

      return { moved: true, mode: move.done ? "idle" : move.locomotionMode };
    },

    clear: () => {
      moves.clear();
    },
  };
}
