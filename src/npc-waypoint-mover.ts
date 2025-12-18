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
  stuckSeconds: number;
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
  const TRAFFIC_WAIT_MIN_MS = 1000;
  const TRAFFIC_WAIT_MAX_MS = 15000;

  const hashStringToSeed = (s: string): number => {
    // FNV-1a 32-bit
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };

  const nextRand01 = (npcId: string, npcGroup: THREE.Group): number => {
    const ud: any = npcGroup.userData as any;
    let s = ud._npcTrafficRngState as number | undefined;
    if (typeof s !== "number") {
      const npcData = ud.npcData as { instanceIndex?: number } | undefined;
      const base = typeof npcData?.instanceIndex === "number" ? (npcData.instanceIndex >>> 0) : hashStringToSeed(npcId);
      s = (base ^ 0x9e3779b9) >>> 0;
      if (s === 0) s = 0x6d2b79f5;
    }
    // xorshift32
    s ^= (s << 13) >>> 0;
    s ^= (s >>> 17) >>> 0;
    s ^= (s << 5) >>> 0;
    ud._npcTrafficRngState = s >>> 0;
    return ((s >>> 0) / 4294967296) % 1;
  };

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
      if (goalIndex < 0) return false;
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
        stuckSeconds: 0,
      });
      npcGroup.userData.isScriptControlled = true;
      return true;
    },

    update: (npcId, npcGroup, deltaSeconds) => {
      const move = moves.get(npcId);
      if (!move || move.done) return { moved: false, mode: "idle" };

      const nowMs = Date.now();
      const ud: any = npcGroup.userData as any;

      // Post-deadlock "yield": wait briefly to allow other NPCs to clear the jam.
      const waitUntilMs = ud._npcTrafficWaitUntilMs as number | undefined;
      if (typeof waitUntilMs === "number" && waitUntilMs > nowMs) {
        return { moved: false, mode: "idle" };
      }
      if (typeof waitUntilMs === "number" && waitUntilMs <= nowMs) {
        delete ud._npcTrafficWaitUntilMs;
      }

      // If we finished a steer escape in a previous tick, schedule the wait now.
      const steerUntilMs = ud._npcTrafficSteerUntilMs as number | undefined;
      const pendingWait = Boolean(ud._npcTrafficSteerPendingWait);
      if (pendingWait && typeof steerUntilMs === "number" && steerUntilMs <= nowMs) {
        const movedDuringSteer = Boolean(ud._npcTrafficSteerMoved);
        delete ud._npcTrafficSteerPendingWait;
        delete ud._npcTrafficSteerMoved;
        delete ud._npcTrafficSteerYaw;
        delete ud._npcTrafficSteerUntilMs;

        if (movedDuringSteer) {
          const r = nextRand01(npcId, npcGroup);
          const waitMs = Math.floor(TRAFFIC_WAIT_MIN_MS + r * (TRAFFIC_WAIT_MAX_MS - TRAFFIC_WAIT_MIN_MS));
          ud._npcTrafficWaitUntilMs = nowMs + waitMs;
          return { moved: false, mode: "idle" };
        }
      }

      const MAX_DT = 0.05;
      const MAX_STEPS = 8;
      const STUCK_SECONDS_TO_GIVE_UP = 0.35;
      let remaining = Math.max(0, deltaSeconds);
      let moved = false;

      const applyMoveXZ = (x: number, z: number, dt: number): { blocked: boolean; moved: boolean } => {
        const beforeX = npcGroup.position.x;
        const beforeZ = npcGroup.position.z;
        let blocked = false;
        const constraint = (npcGroup.userData as any).moveConstraint as
          | ((group: THREE.Group, desiredX: number, desiredZ: number, dt: number) => { blocked: boolean; moved: boolean } | boolean | void)
          | undefined;
        if (typeof constraint === "function") {
          const res = constraint(npcGroup, x, z, dt);
          if (typeof res === "boolean") blocked = res;
          else if (res && typeof res === "object") blocked = Boolean((res as any).blocked);
        } else {
          npcGroup.position.x = x;
          npcGroup.position.z = z;
        }
        const didMove = Math.abs(npcGroup.position.x - beforeX) > 1e-6 || Math.abs(npcGroup.position.z - beforeZ) > 1e-6;
        return { blocked, moved: didMove };
      };

      const steerYawActive = ud._npcTrafficSteerYaw as number | undefined;
      const steerUntilActiveMs = ud._npcTrafficSteerUntilMs as number | undefined;
      const steerActiveAtStart =
        typeof steerYawActive === "number" &&
        typeof steerUntilActiveMs === "number" &&
        steerUntilActiveMs > nowMs &&
        Number.isFinite(steerYawActive);
      let steerYaw: number | null = steerActiveAtStart ? steerYawActive : null;
      let steerRemainingSeconds = steerActiveAtStart ? Math.max(0, (steerUntilActiveMs! - nowMs) / 1000) : 0;

      for (let step = 0; step < MAX_STEPS && remaining > 0 && !move.done; step++) {
        // During deadlock escape steering we intentionally limit simulation to the remaining steer window,
        // otherwise a large delta (tab inactive) could produce a big unintended displacement.
        const steerActive = steerYaw != null && steerRemainingSeconds > 0;
        const dt = Math.min(remaining, MAX_DT, steerActive ? steerRemainingSeconds : MAX_DT);
        remaining -= dt;
        if (dt <= 0) break;

        if (steerActive) {
          tmpToTargetHoriz.set(Math.sin(steerYaw!), 0, Math.cos(steerYaw!));
          const yaw = steerYaw!;
          tmpDesiredQuat.setFromAxisAngle(tmpUp, yaw);
          const t = 1 - Math.exp(-TURN_SPEED * dt);
          npcGroup.quaternion.slerp(tmpDesiredQuat, t);

          const maxStep = move.speed * dt;
          const nextX = npcGroup.position.x + tmpToTargetHoriz.x * maxStep;
          const nextZ = npcGroup.position.z + tmpToTargetHoriz.z * maxStep;
          const r = applyMoveXZ(nextX, nextZ, dt);
          moved = moved || r.moved;
          if (r.moved) {
            ud._npcTrafficSteerMoved = true;
            npcGroup.userData.lastMoveDirXZ = { x: tmpToTargetHoriz.x, z: tmpToTargetHoriz.z };
            move.stuckSeconds = 0;
          } else {
            const npcBlocked = Boolean((npcGroup.userData as any)._npcNpcBlocked);
            move.stuckSeconds += npcBlocked ? dt * 0.1 : dt;
          }

          steerRemainingSeconds = Math.max(0, steerRemainingSeconds - dt);
          // Stop processing more time in this tick once the steer window is consumed.
          if (steerRemainingSeconds <= 1e-9) break;
          continue;
        }

        const target = move.route[move.nextIndex];
        if (!target) {
          move.done = true;
          break;
        }

        tmpToTarget.subVectors(target, npcGroup.position);
        // Movement is driven in the horizontal plane; Y is handled separately (ground snapping).
        tmpToTargetHoriz.copy(tmpToTarget);
        tmpToTargetHoriz.y = 0;
        const dist = tmpToTargetHoriz.length();

        if (dist > 0) {
          const yaw = Math.atan2(tmpToTargetHoriz.x, tmpToTargetHoriz.z);
          tmpDesiredQuat.setFromAxisAngle(tmpUp, yaw);
          const t = 1 - Math.exp(-TURN_SPEED * dt);
          npcGroup.quaternion.slerp(tmpDesiredQuat, t);
        }

        const maxStep = move.speed * dt;
        const shouldSnap = dist <= Math.max(move.arriveDistance, maxStep);

        if (shouldSnap) {
          const r = applyMoveXZ(target.x, target.z, dt);
          moved = moved || r.moved;
          if (r.moved) npcGroup.userData.lastMoveDirXZ = { x: tmpToTargetHoriz.x, z: tmpToTargetHoriz.z };
          if (Math.abs(npcGroup.position.x - target.x) <= 1e-4 && Math.abs(npcGroup.position.z - target.z) <= 1e-4) {
            move.nextIndex += 1;
            move.stuckSeconds = 0;
            if (move.nextIndex >= move.route.length) {
              move.done = true;
            }
          } else {
            // Getting blocked by another NPC shouldn't immediately abort the route;
            // they should be able to pass each other after a short avoidance/wait.
            const npcBlocked = Boolean((npcGroup.userData as any)._npcNpcBlocked);
            move.stuckSeconds += npcBlocked ? dt * 0.1 : dt;
          }
        } else {
          // `shouldSnap === false` implies `dist > 0`.
          tmpToTargetHoriz.multiplyScalar(1 / dist);
          const nextX = npcGroup.position.x + tmpToTargetHoriz.x * maxStep;
          const nextZ = npcGroup.position.z + tmpToTargetHoriz.z * maxStep;
          const r = applyMoveXZ(nextX, nextZ, dt);
          moved = moved || r.moved;
          if (r.moved) npcGroup.userData.lastMoveDirXZ = { x: tmpToTargetHoriz.x, z: tmpToTargetHoriz.z };
          if (r.moved) move.stuckSeconds = 0;
          else {
            const npcBlocked = Boolean((npcGroup.userData as any)._npcNpcBlocked);
            move.stuckSeconds += npcBlocked ? dt * 0.1 : dt;
          }
        }

        if (move.stuckSeconds >= STUCK_SECONDS_TO_GIVE_UP) {
          move.done = true;
        }
      }

      // If we consumed the whole steer window in one update tick (e.g. large delta), schedule the wait immediately.
      if (steerYaw != null && steerRemainingSeconds <= 1e-9 && Boolean(ud._npcTrafficSteerPendingWait)) {
        const movedDuringSteer = Boolean(ud._npcTrafficSteerMoved);
        delete ud._npcTrafficSteerPendingWait;
        delete ud._npcTrafficSteerMoved;
        delete ud._npcTrafficSteerYaw;
        delete ud._npcTrafficSteerUntilMs;
        steerYaw = null;

        if (movedDuringSteer) {
          const r = nextRand01(npcId, npcGroup);
          const waitMs = Math.floor(TRAFFIC_WAIT_MIN_MS + r * (TRAFFIC_WAIT_MAX_MS - TRAFFIC_WAIT_MIN_MS));
          const processedSeconds = Math.max(0, deltaSeconds - remaining);
          const endMs = nowMs + processedSeconds * 1000;
          ud._npcTrafficWaitUntilMs = endMs + waitMs;
          return { moved, mode: "idle" };
        }
      }

      return { moved, mode: move.done ? "idle" : move.locomotionMode };
    },

    clear: () => {
      moves.clear();
    },
  };
}
