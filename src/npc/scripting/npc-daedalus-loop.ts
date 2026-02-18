import type { RefObject } from "react";
import * as THREE from "three";
import type { WaypointMover } from "../navigation/npc-waypoint-mover";
import type { NpcData } from "../../shared/types";
import { __getNpcEmActiveJob } from "../combat/npc-em-runtime";
import { __getNpcEmQueueState, requestNpcEmClear } from "../combat/npc-em-queue";
import { setNpcRoutineRuntime } from "./npc-routine-runtime";
import {
  advanceNpcStateTime,
  getNpcSpawnOrder,
  getRuntimeVm,
  setNpcStateTime,
} from "../../vm-manager";
import { getWorldTime } from "../../world/world-time";
import { getNpcRuntimeId } from "../renderer/npc-renderer-utils";

export function tickNpcDaedalusStateLoop({
  loadedNpcsRef,
  waypointMoverRef,
}: {
  loadedNpcsRef: RefObject<Map<string, THREE.Group>>;
  waypointMoverRef: RefObject<WaypointMover | null>;
}) {
  // Run a minimal Daedalus "state loop" tick for loaded NPCs.
  // This is what triggers scripts like `zs_bandit_loop()` that call `AI_GotoFP(...)`.
  {
    const vm = getRuntimeVm();
    if (vm) {
      const t = getWorldTime();
      const nowMs = Date.now();
      const groups = Array.from(loadedNpcsRef.current.values());
      groups.sort((a, b) => {
        const ia = (a?.userData?.npcData as NpcData | undefined)?.instanceIndex ?? 0;
        const ib = (b?.userData?.npcData as NpcData | undefined)?.instanceIndex ?? 0;
        const ao = getNpcSpawnOrder(ia);
        const bo = getNpcSpawnOrder(ib);
        if (ao != null && bo != null && ao !== bo) return ao - bo;
        if (ao != null && bo == null) return -1;
        if (ao == null && bo != null) return 1;
        return ia - ib;
      });
      for (const g of groups) {
        if (!g || g.userData.isDisposed) continue;
        const npcData = g.userData.npcData as NpcData | undefined;
        if (!npcData?.dailyRoutine || !npcData.symbolName) continue;

        // Unlike older spacer-web builds, we do not gate state-loop execution based on distance to the routine waypoint.
        // The original engine relies on zCEventManager job semantics (and FindSpot filtering) rather than such gating.

        const nextAt = (g.userData as any)._aiLoopNextAtMs as number | undefined;
        if (typeof nextAt === "number" && nextAt > nowMs) continue;
        (g.userData as any)._aiLoopNextAtMs = nowMs + 500; // 2Hz

        const currentTime = t.hour * 60 + t.minute;
        let desiredEntry: {
          state: string;
          waypoint: string;
          startM: number;
          stopM: number;
        } | null = null;
        for (const r of npcData.dailyRoutine) {
          const startM = r.start_h * 60 + (r.start_m ?? 0);
          const stopM = r.stop_h * 60 + (r.stop_m ?? 0);
          const wraps = stopM < startM;
          const isActive = wraps
            ? currentTime >= startM || currentTime < stopM
            : currentTime >= startM && currentTime < stopM;
          if (isActive && r.state) {
            desiredEntry = { state: r.state, waypoint: r.waypoint, startM, stopM };
            break;
          }
        }
        if (!desiredEntry) {
          setNpcRoutineRuntime(npcData.instanceIndex, null);
          delete (g.userData as any)._aiActiveStateName;
          delete (g.userData as any)._aiActiveRoutineKey;
          delete (g.userData as any)._aiActiveRoutineWaypoint;
          delete (g.userData as any)._aiActiveRoutineStartM;
          delete (g.userData as any)._aiActiveRoutineStopM;
          continue;
        }

        const desiredKey = `${desiredEntry.state}|${(desiredEntry.waypoint || "").trim().toUpperCase()}|${desiredEntry.startM}|${desiredEntry.stopM}`;
        const currentKey = (g.userData as any)._aiActiveRoutineKey as string | undefined;
        const currentState = (g.userData as any)._aiActiveStateName as string | undefined;

        const npcId = ((g.userData as any).npcId as string | undefined) ?? getNpcRuntimeId(npcData);
        const mover = waypointMoverRef.current;
        const moveState = mover?.getMoveState?.(npcId);
        const emJob = __getNpcEmActiveJob(npcData.instanceIndex);
        const q = __getNpcEmQueueState(npcData.instanceIndex);
        const emEmpty =
          !emJob &&
          !(moveState && moveState.done === false) &&
          !q?.clearRequested &&
          (q?.queue?.length ?? 0) === 0;

        const pending = (g.userData as any)._aiPendingRoutine as
          | {
              key: string;
              state: string;
              waypoint: string;
              startM: number;
              stopM: number;
              sinceMs: number;
            }
          | undefined;

        const activateRoutineEntry = (
          nextState: string,
          nextKey: string,
          nextWaypoint: string,
          startM: number,
          stopM: number,
          opts?: { forceClear?: boolean },
        ) => {
          // Update the routine runtime before calling the entry function so builtins like
          // `Npc_GetDistToWP(self, self.wp)` / `AI_GotoWP(self, self.wp)` resolve to the NEW routine waypoint.
          setNpcRoutineRuntime(npcData.instanceIndex, {
            stateName: nextState,
            waypointName: nextWaypoint,
            startMinute: startM,
            stopMinute: stopM,
          });

          vm.setGlobalSelf(npcData.symbolName);

          if (opts?.forceClear) {
            requestNpcEmClear(npcData.instanceIndex);
          }

          if (currentState) {
            const endFnCandidates = [`${currentState}_end`, `${currentState}_END`];
            const endFn = endFnCandidates.find((fn) => vm.hasSymbol(fn));
            if (endFn) {
              try {
                vm.callFunction(endFn, []);
              } catch {
                // Ignore state-end failures; scripts expect this to be best-effort.
              }
            }
          }

          const entryFnCandidates = [nextState, nextState.toUpperCase()];
          const entryFn = entryFnCandidates.find((fn) => vm.hasSymbol(fn));
          if (entryFn) {
            try {
              vm.callFunction(entryFn, []);
            } catch {
              // Ignore entry failures; the loop tick may still be useful.
            }
          }

          (g.userData as any)._aiActiveStateName = nextState;
          (g.userData as any)._aiActiveRoutineKey = nextKey;
          (g.userData as any)._aiActiveRoutineWaypoint = (nextWaypoint || "").trim().toUpperCase();
          (g.userData as any)._aiActiveRoutineStartM = startM;
          (g.userData as any)._aiActiveRoutineStopM = stopM;
          setNpcStateTime(npcData.instanceIndex, 0);
          (g.userData as any)._aiLoopLastAtMs = nowMs;
        };

        // Advance script state time regardless of EM state (ZenGin-style: stateTime advances even while EM is busy).
        {
          const lastAt = (g.userData as any)._aiLoopLastAtMs as number | undefined;
          const dtSec = typeof lastAt === "number" ? Math.max(0, (nowMs - lastAt) / 1000) : 0;
          (g.userData as any)._aiLoopLastAtMs = nowMs;
          advanceNpcStateTime(npcData.instanceIndex, dtSec);
        }

        // ZenGin-like "EM empty" gating:
        // - don't start/switch routine states while EM is busy,
        // - don't run `_loop` while EM is busy (prevents repeated enqueue spam),
        // - defer routine changes until EM becomes empty, with a last-resort timeout.
        const FORCE_AFTER_MS = 60_000;

        if (!currentKey || !currentState) {
          if (emEmpty) {
            activateRoutineEntry(
              desiredEntry.state,
              desiredKey,
              desiredEntry.waypoint,
              desiredEntry.startM,
              desiredEntry.stopM,
            );
            delete (g.userData as any)._aiPendingRoutine;
          } else {
            (g.userData as any)._aiPendingRoutine = {
              key: desiredKey,
              state: desiredEntry.state,
              waypoint: (desiredEntry.waypoint || "").trim().toUpperCase(),
              startM: desiredEntry.startM,
              stopM: desiredEntry.stopM,
              sinceMs: nowMs,
            };
            continue;
          }
        } else {
          if (currentKey !== desiredKey) {
            if (!pending || pending.key !== desiredKey) {
              (g.userData as any)._aiPendingRoutine = {
                key: desiredKey,
                state: desiredEntry.state,
                waypoint: (desiredEntry.waypoint || "").trim().toUpperCase(),
                startM: desiredEntry.startM,
                stopM: desiredEntry.stopM,
                sinceMs: nowMs,
              };
            }
          } else if (pending) {
            delete (g.userData as any)._aiPendingRoutine;
          }

          const p = (g.userData as any)._aiPendingRoutine as
            | {
                key: string;
                state: string;
                waypoint: string;
                startM: number;
                stopM: number;
                sinceMs: number;
              }
            | undefined;
          if (p && p.key !== currentKey) {
            const waitedMs = Math.max(0, nowMs - (p.sinceMs ?? nowMs));
            if (emEmpty || waitedMs >= FORCE_AFTER_MS) {
              activateRoutineEntry(p.state, p.key, p.waypoint, p.startM, p.stopM, {
                forceClear: !emEmpty,
              });
              delete (g.userData as any)._aiPendingRoutine;
            } else {
              // While waiting for EM to become empty, do not run the old state's loop.
              continue;
            }
          }

          if (!emEmpty) {
            // If EM is busy, do not run loop ticks for this NPC.
            continue;
          }
        }

        const runningState =
          ((g.userData as any)._aiActiveStateName as string | undefined) || desiredEntry.state;
        const runningWaypoint =
          ((g.userData as any)._aiActiveRoutineWaypoint as string | undefined) ||
          (desiredEntry.waypoint || "").trim().toUpperCase();
        const runningStartM = (g.userData as any)._aiActiveRoutineStartM as number | undefined;
        const runningStopM = (g.userData as any)._aiActiveRoutineStopM as number | undefined;
        if (runningState && runningWaypoint) {
          setNpcRoutineRuntime(npcData.instanceIndex, {
            stateName: runningState,
            waypointName: runningWaypoint,
            startMinute: typeof runningStartM === "number" ? runningStartM : desiredEntry.startM,
            stopMinute: typeof runningStopM === "number" ? runningStopM : desiredEntry.stopM,
          });
        }

        const loopFnCandidates = [`${runningState}_loop`, `${runningState}_LOOP`];
        const loopFn = loopFnCandidates.find((fn) => vm.hasSymbol(fn));
        if (!loopFn) continue;

        vm.setGlobalSelf(npcData.symbolName);
        try {
          vm.callFunction(loopFn, []);
        } catch (error) {
          console.warn(
            `[VM loop error] npc=${npcData.symbolName} idx=${npcData.instanceIndex} runtimeId=${npcData.spawnRuntimeId ?? "?"} state=${runningState} loopFn=${loopFn}`,
            error,
          );
        }
      }
    }
  }
}
