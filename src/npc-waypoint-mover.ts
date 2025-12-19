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
import { acquireFreepointForNpc } from "./npc-freepoints";

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
  finalGateSeconds: number;
  finalQuat?: THREE.Quaternion;
};

export type WaypointMover = {
  startMoveToWaypoint: (
    npcId: string,
    npcGroup: THREE.Group,
    targetWaypointName: string,
    options?: Partial<WaypointMoveOptions>
  ) => boolean;
  startMoveToPosition: (
    npcId: string,
    npcGroup: THREE.Group,
    targetPos: THREE.Vector3,
    options?: Partial<WaypointMoveOptions> & { finalQuat?: THREE.Quaternion }
  ) => boolean;
  startMoveToFreepoint: (
    npcId: string,
    npcGroup: THREE.Group,
    freepointName: string,
    options?: Partial<WaypointMoveOptions> & { checkDistance?: boolean; dist?: number; holdMs?: number; arriveDistance?: number }
  ) => boolean;
  update: (npcId: string, npcGroup: THREE.Group, deltaSeconds: number) => { moved: boolean; mode: LocomotionMode };
  getMoveState: (npcId: string) => WaypointMoveState | null;
  clearForNpc: (npcId: string) => void;
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
  // Intermediate waypoint handling:
  // - If another NPC is close to the waypoint, treat it as a small "area" so NPCs don't pile into one coordinate.
  // - Otherwise, require crossing the exact waypoint coordinate (snap) for reliable pathing.
  const INTERMEDIATE_WAYPOINT_CROWD_RADIUS = 80;
  // Final destination: try to reach the center, but if it's occupied by another NPC, accept reaching the gate radius.
  const FINAL_WAYPOINT_GATE_RADIUS = 60;
  // Circuit breaker: if the NPC stays inside the final gate for long enough without reaching the exact center,
  // accept arrival to avoid infinite circling.
  const FINAL_WAYPOINT_GATE_CIRCUIT_BREAKER_SECONDS = 2.0;

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

  const parseNpcInstanceIndex = (npcId: string, npcGroup: THREE.Group): number | null => {
    const npcData = (npcGroup.userData as any)?.npcData as { instanceIndex?: number } | undefined;
    if (npcData && typeof npcData.instanceIndex === "number") return npcData.instanceIndex;
    const m = /^npc-(\d+)$/.exec(npcId);
    if (m) return Number(m[1]);
    return null;
  };

  const isOtherNpcNearWaypoint = (npcId: string, npcGroup: THREE.Group, waypoint: THREE.Vector3, radius: number): boolean => {
    const colliders = (npcGroup.userData as any)._npcCollidersScratch as Array<{ id?: number; x: number; z: number }> | undefined;
    if (!colliders || colliders.length === 0) return false;
    const selfId = parseNpcInstanceIndex(npcId, npcGroup);
    const r2 = radius * radius;
    for (const c of colliders) {
      if (selfId != null && typeof c.id === "number" && c.id === selfId) continue;
      const dx = c.x - waypoint.x;
      const dz = c.z - waypoint.z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
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
        finalGateSeconds: 0,
      });
      npcGroup.userData.isScriptControlled = true;
      return true;
    },

    startMoveToPosition: (npcId, npcGroup, targetPos, options) => {
      const graph = ensureWaynetGraph();
      if (!graph) return false;

      const startIndex = findNearestWaypointIndex(graph, { x: npcGroup.position.x, y: npcGroup.position.y, z: npcGroup.position.z });
      const goalIndex = findNearestWaypointIndex(graph, targetPos);
      const routeIdx = findRouteAStar(graph, startIndex, goalIndex);

      const route: THREE.Vector3[] =
        routeIdx.length > 0
          ? routeIdx.map(i => {
              const p = graph.waypoints[i].position;
              return new THREE.Vector3(p.x, p.y, p.z);
            })
          : [npcGroup.position.clone()];

      const last = route[route.length - 1];
      if (!last || last.distanceToSquared(targetPos) > 1e-6) route.push(targetPos.clone());

      if (route.length < 2) return false;

      moves.set(npcId, {
        route,
        nextIndex: 1,
        speed: options?.speed ?? 140,
        arriveDistance: options?.arriveDistance ?? 5,
        locomotionMode: options?.locomotionMode ?? "walk",
        done: false,
        stuckSeconds: 0,
        finalGateSeconds: 0,
        finalQuat: options?.finalQuat,
      });
      npcGroup.userData.isScriptControlled = true;
      return true;
    },

    startMoveToFreepoint: (npcId, npcGroup, freepointName, options) => {
      const graph = ensureWaynetGraph();
      if (!graph) return false;

      const npcData = (npcGroup.userData as any).npcData as { instanceIndex?: number } | undefined;
      const instanceIndex = npcData?.instanceIndex;
      if (typeof instanceIndex !== "number") return false;

      const spot = acquireFreepointForNpc(instanceIndex, freepointName, {
        checkDistance: options?.checkDistance ?? true,
        dist: options?.dist ?? 2000,
        holdMs: options?.holdMs ?? 30_000,
      });
      if (!spot) return false;

      const targetPos = new THREE.Vector3(spot.position.x, spot.position.y, spot.position.z);
      const targetQuat = new THREE.Quaternion(spot.quaternion.x, spot.quaternion.y, spot.quaternion.z, spot.quaternion.w);

      const startIndex = findNearestWaypointIndex(graph, { x: npcGroup.position.x, y: npcGroup.position.y, z: npcGroup.position.z });
      const goalIndex = findNearestWaypointIndex(graph, targetPos);
      const routeIdx = findRouteAStar(graph, startIndex, goalIndex);

      const route: THREE.Vector3[] =
        routeIdx.length > 0
          ? routeIdx.map(i => {
              const p = graph.waypoints[i].position;
              return new THREE.Vector3(p.x, p.y, p.z);
            })
          : [npcGroup.position.clone()];

      const last = route[route.length - 1];
      if (!last || last.distanceToSquared(targetPos) > 1e-6) route.push(targetPos);

      if (route.length < 2) return false;

      moves.set(npcId, {
        route,
        nextIndex: 1,
        speed: options?.speed ?? 140,
        arriveDistance: options?.arriveDistance ?? 5,
        locomotionMode: options?.locomotionMode ?? "walk",
        done: false,
        stuckSeconds: 0,
        finalGateSeconds: 0,
        finalQuat: targetQuat,
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
      if (!pendingWait && typeof steerUntilMs === "number" && steerUntilMs <= nowMs) {
        delete ud._npcTrafficSteerMoved;
        delete ud._npcTrafficSteerYaw;
        delete ud._npcTrafficSteerUntilMs;
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

      const scheduleSteerEscape = (params: {
        yaw: number;
        durationSeconds: number;
        pendingWait: boolean;
      }) => {
        const processedSeconds = Math.max(0, deltaSeconds - remaining);
        const endMs = nowMs + processedSeconds * 1000;
        ud._npcTrafficSteerYaw = params.yaw;
        ud._npcTrafficSteerUntilMs = endMs + params.durationSeconds * 1000;
        ud._npcTrafficSteerMoved = false;
        ud._npcTrafficSteerPendingWait = params.pendingWait;
        steerYaw = params.yaw;
        steerRemainingSeconds = params.durationSeconds;
      };

      const tryStartWorldStuckRecovery = (params: {
        maxStep: number;
        dt: number;
        target: THREE.Vector3;
      }): boolean => {
        if (params.dt <= 0) return false;
        if (move.done) return false;
        if (steerYaw != null || steerRemainingSeconds > 0) return false;
        if (typeof ud._npcTrafficSteerUntilMs === "number" && (ud._npcTrafficSteerUntilMs as number) > nowMs) return false;

        const npcBlocked = Boolean((npcGroup.userData as any)._npcNpcBlocked);
        if (npcBlocked) return false;

        const dx = params.target.x - npcGroup.position.x;
        const dz = params.target.z - npcGroup.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= 1e-6) return false;
        const dirX = dx / dist;
        const dirZ = dz / dist;
        const baseYaw = Math.atan2(dirX, dirZ);

        const stepDist = Math.max(params.maxStep, 10);
        const savedX = npcGroup.position.x;
        const savedZ = npcGroup.position.z;
        const savedNpcBlocked = Boolean((npcGroup.userData as any)._npcNpcBlocked);

        const probeYaw = (yaw: number): { yaw: number; movedDist: number; blocked: boolean; progress: number } => {
          npcGroup.position.x = savedX;
          npcGroup.position.z = savedZ;
          (npcGroup.userData as any)._npcNpcBlocked = savedNpcBlocked;

          const px = savedX + Math.sin(yaw) * stepDist;
          const pz = savedZ + Math.cos(yaw) * stepDist;
          const r = applyMoveXZ(px, pz, params.dt);
          const dxm = npcGroup.position.x - savedX;
          const dzm = npcGroup.position.z - savedZ;
          const movedDist = Math.hypot(dxm, dzm);
          const progress = dxm * dirX + dzm * dirZ;

          npcGroup.position.x = savedX;
          npcGroup.position.z = savedZ;
          (npcGroup.userData as any)._npcNpcBlocked = savedNpcBlocked;

          return { yaw, movedDist, blocked: r.blocked, progress };
        };

        const deg = (d: number) => (d * Math.PI) / 180;
        const offsets = [0, deg(30), -deg(30), deg(60), -deg(60), deg(90), -deg(90), deg(120), -deg(120), Math.PI];

        let best: { yaw: number; score: number } | null = null;
        for (const off of offsets) {
          const cand = probeYaw(baseYaw + off);
          if (cand.movedDist <= 1e-4) continue;
          const blockedPenalty = cand.blocked ? 1000 : 0;
          // Prefer unblocked movement and forward progress, but allow temporary sideways/backward steps to get unstuck.
          const score = blockedPenalty + Math.max(0, -cand.progress) * 0.25 - cand.progress + 0.05 * (stepDist - cand.movedDist);
          if (!best || score < best.score) best = { yaw: cand.yaw, score };
        }

        if (!best) return false;

        const r = nextRand01(npcId, npcGroup);
        const durationSeconds = 0.25 + r * 0.25; // 0.25–0.5s
        scheduleSteerEscape({ yaw: best.yaw, durationSeconds, pendingWait: false });
        move.stuckSeconds = 0;
        return true;
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
        const isFinalTarget = move.nextIndex >= move.route.length - 1;

        if (dist > 0) {
          const yaw = Math.atan2(tmpToTargetHoriz.x, tmpToTargetHoriz.z);
          tmpDesiredQuat.setFromAxisAngle(tmpUp, yaw);
          const t = 1 - Math.exp(-TURN_SPEED * dt);
          npcGroup.quaternion.slerp(tmpDesiredQuat, t);
        }

        const maxStep = move.speed * dt;

        if (!isFinalTarget) {
          const crowded = isOtherNpcNearWaypoint(npcId, npcGroup, target, INTERMEDIATE_WAYPOINT_CROWD_RADIUS);
          // Only allow "gate" behavior when another NPC is close to this waypoint (traffic).
          if (crowded && dist <= Math.max(move.arriveDistance, INTERMEDIATE_WAYPOINT_CROWD_RADIUS)) {
            move.nextIndex += 1;
            move.stuckSeconds = 0;
            move.finalGateSeconds = 0;
            continue;
          }

          // Otherwise, require crossing the waypoint coordinate (snap) instead of corner-cutting.
          if (dist <= move.arriveDistance) {
            move.nextIndex += 1;
            move.stuckSeconds = 0;
            move.finalGateSeconds = 0;
            continue;
          }

          const shouldSnapIntermediate = dist <= Math.max(move.arriveDistance, maxStep);
          if (shouldSnapIntermediate) {
            const r = applyMoveXZ(target.x, target.z, dt);
            moved = moved || r.moved;
            if (r.moved) npcGroup.userData.lastMoveDirXZ = { x: tmpToTargetHoriz.x, z: tmpToTargetHoriz.z };
            if (Math.abs(npcGroup.position.x - target.x) <= 1e-4 && Math.abs(npcGroup.position.z - target.z) <= 1e-4) {
              move.nextIndex += 1;
              move.stuckSeconds = 0;
              move.finalGateSeconds = 0;
              continue;
            }

            const npcBlocked = Boolean((npcGroup.userData as any)._npcNpcBlocked);
            // If we can't snap because of NPC-vs-NPC collision, treat the waypoint as crowded and allow passing through.
            if (npcBlocked && dist <= INTERMEDIATE_WAYPOINT_CROWD_RADIUS) {
              move.nextIndex += 1;
              move.stuckSeconds = 0;
              move.finalGateSeconds = 0;
              continue;
            }

            move.stuckSeconds += npcBlocked ? dt * 0.1 : dt;
            continue;
          }
        }

        // Final destination: try to reach the center, but if we are within the gate radius and the center is occupied
        // (NPC-vs-NPC blocked), accept stopping within the radius instead of deadlocking.
        if (isFinalTarget && dist <= move.arriveDistance) {
          move.nextIndex += 1;
          move.stuckSeconds = 0;
          move.finalGateSeconds = 0;
          if (move.nextIndex >= move.route.length) {
            move.done = true;
            if (move.finalQuat) npcGroup.quaternion.copy(move.finalQuat);
          }
          continue;
        }

        const shouldSnapFinal = isFinalTarget && dist <= Math.max(move.arriveDistance, maxStep);

        if (shouldSnapFinal) {
          const r = applyMoveXZ(target.x, target.z, dt);
          moved = moved || r.moved;
          if (r.moved) npcGroup.userData.lastMoveDirXZ = { x: tmpToTargetHoriz.x, z: tmpToTargetHoriz.z };
          if (Math.abs(npcGroup.position.x - target.x) <= 1e-4 && Math.abs(npcGroup.position.z - target.z) <= 1e-4) {
            move.nextIndex += 1;
            move.stuckSeconds = 0;
            if (move.nextIndex >= move.route.length) {
              move.done = true;
              if (move.finalQuat) npcGroup.quaternion.copy(move.finalQuat);
            }
          } else {
            const npcBlocked = Boolean((npcGroup.userData as any)._npcNpcBlocked);
            // If we're already in the destination gate radius and only NPC collision prevents reaching the exact center,
            // consider the move complete (traffic jam cleared by a "good enough" arrival).
            if (npcBlocked && dist <= FINAL_WAYPOINT_GATE_RADIUS) {
              move.nextIndex += 1;
              move.stuckSeconds = 0;
              move.finalGateSeconds = 0;
              if (move.nextIndex >= move.route.length) move.done = true;
              if (move.done && move.finalQuat) npcGroup.quaternion.copy(move.finalQuat);
              continue;
            }

            // Getting blocked by another NPC shouldn't immediately abort the route;
            // they should be able to pass each other after a short avoidance/wait.
            move.stuckSeconds += npcBlocked ? dt * 0.1 : dt;
          }
        } else if (dist > 0) {
          tmpToTargetHoriz.multiplyScalar(1 / dist);
          const nextX = npcGroup.position.x + tmpToTargetHoriz.x * maxStep;
          const nextZ = npcGroup.position.z + tmpToTargetHoriz.z * maxStep;
          const r = applyMoveXZ(nextX, nextZ, dt);
          moved = moved || r.moved;
          if (r.moved) npcGroup.userData.lastMoveDirXZ = { x: tmpToTargetHoriz.x, z: tmpToTargetHoriz.z };
          if (r.moved) move.stuckSeconds = 0;
          else {
            const npcBlocked = Boolean((npcGroup.userData as any)._npcNpcBlocked);
            if (isFinalTarget && npcBlocked && dist <= FINAL_WAYPOINT_GATE_RADIUS) {
              move.nextIndex += 1;
              move.stuckSeconds = 0;
              move.finalGateSeconds = 0;
              if (move.nextIndex >= move.route.length) move.done = true;
              if (move.done && move.finalQuat) npcGroup.quaternion.copy(move.finalQuat);
              continue;
            }
            move.stuckSeconds += npcBlocked ? dt * 0.1 : dt;
          }
        }

        // Final waypoint circuit breaker: if we remain inside the destination gate radius for long enough without reaching the center,
        // accept arrival so NPCs don't circle forever.
        if (isFinalTarget && !move.done) {
          const dxAfter = target.x - npcGroup.position.x;
          const dzAfter = target.z - npcGroup.position.z;
          const distAfter = Math.hypot(dxAfter, dzAfter);
          if (distAfter <= FINAL_WAYPOINT_GATE_RADIUS && distAfter > move.arriveDistance) {
            move.finalGateSeconds += dt;
            if (move.finalGateSeconds >= FINAL_WAYPOINT_GATE_CIRCUIT_BREAKER_SECONDS) {
              move.nextIndex += 1;
              move.stuckSeconds = 0;
              move.finalGateSeconds = 0;
              if (move.nextIndex >= move.route.length) move.done = true;
              if (move.done && move.finalQuat) npcGroup.quaternion.copy(move.finalQuat);
              break;
            }
          } else {
            move.finalGateSeconds = 0;
          }
        } else if (!isFinalTarget) {
          move.finalGateSeconds = 0;
        }

        if (move.stuckSeconds >= STUCK_SECONDS_TO_GIVE_UP) {
          // If we got stuck due to world collisions (not NPC-vs-NPC), try a short steer escape to get back on track.
          const started = tryStartWorldStuckRecovery({ maxStep, dt, target });
          if (!started) {
            move.done = true;
            if (move.finalQuat) npcGroup.quaternion.copy(move.finalQuat);
          }
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

    getMoveState: (npcId: string) => {
      return moves.get(npcId) ?? null;
    },

    clearForNpc: (npcId: string) => {
      moves.delete(npcId);
    },

    clear: () => {
      moves.clear();
    },
  };
}
