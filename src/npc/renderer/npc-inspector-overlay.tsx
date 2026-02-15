import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { NpcData } from "../../types";
import { findActiveRoutineEntry } from "../data/npc-utils";
import { getWorldTime } from "../../world-time";
import { __getNpcEmQueueState } from "../combat/npc-em-queue";
import { __getNpcEmActiveJob } from "../combat/npc-em-runtime";
import { getNpcStateTime } from "../../vm-manager";
import {
  findFreepointForNpc,
  isFreepointAvailableForNpc,
  isNpcOnFreepoint,
} from "../world/npc-freepoints";

type SelectedNpc = {
  npc: NpcData;
  npcRoot: THREE.Object3D;
};

type NpcInspectorInfo = {
  instanceIndex: number;
  symbolName: string;
  name?: string;
  spawnpoint: string;
  routine: { state: string; waypoint: string; start: string; stop: string } | null;
  worldTime: { day: number; hour: number; minute: number };
  worldPos: { x: number; y: number; z: number };
  worldQuat: { x: number; y: number; z: number; w: number };
  userData: { isScriptControlled: boolean; isSliding: boolean; isFalling: boolean };
  vm: {
    activeStateName: string | null;
    stateTimeSeconds: number;
    nextLoopInMs: number | null;
    lastLoopAgoMs: number | null;
    loopGate: { target: string | null; satisfied: boolean } | null;
  };
  freepoints: {
    primaryTag: string | null;
    primary: {
      tag: string;
      isOn: boolean;
      isAvailable: boolean;
      isNextAvailable: boolean;
      nearest?: { nameUpper: string; vobId: number; dist: number } | null;
    } | null;
    checks: Record<string, { isOn: boolean; isAvailable: boolean; isNextAvailable: boolean }>;
  };
  em: {
    activeJob: ReturnType<typeof __getNpcEmActiveJob>;
    clearRequested: boolean;
    queue: any[];
  };
};

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (e) {
    return JSON.stringify({ error: String(e) }, null, 2);
  }
}

function inferPrimaryFreepointTag(stateName: string | null | undefined): string | null {
  const s = (stateName || "").toUpperCase();
  if (!s) return null;
  if (s.includes("PICK")) return "PICK";
  if (s.includes("ARMSCROSSED") || s.includes("STAND") || s.includes("SMALLTALK")) return "STAND";
  if (s.includes("SLEEP") || s.includes("BED")) return "SLEEP";
  if (s.includes("SIT")) return "SIT";
  return null;
}

export function NpcInspectorOverlay({
  selected,
  onClose,
  topOffsetPx = 0,
}: {
  selected: SelectedNpc | null;
  onClose: () => void;
  topOffsetPx?: number;
}) {
  const [snapshot, setSnapshot] = useState<NpcInspectorInfo | null>(null);

  useEffect(() => {
    if (!selected) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const { npc, npcRoot } = selected;
      const t = getWorldTime();
      const routine = findActiveRoutineEntry(npc.dailyRoutine, t.hour, t.minute);
      const pos = npcRoot.getWorldPosition(new THREE.Vector3());
      const quat = npcRoot.getWorldQuaternion(new THREE.Quaternion());
      const ud: any = npcRoot.userData as any;

      const q = __getNpcEmQueueState(npc.instanceIndex);
      const activeJob = __getNpcEmActiveJob(npc.instanceIndex);

      const activeStateName =
        (ud?._aiActiveStateName as string | undefined) ??
        (routine?.state as string | undefined) ??
        null;
      const stateTimeSeconds = getNpcStateTime(npc.instanceIndex);
      const nowMs = Date.now();
      const nextAt = (ud?._aiLoopNextAtMs as number | undefined) ?? null;
      const lastAt = (ud?._aiLoopLastAtMs as number | undefined) ?? null;
      const gateTarget = (ud?._aiLoopGateTargetKey as string | undefined) ?? null;
      const gateSatisfied = Boolean(ud?._aiLoopGateSatisfied);

      const primaryTag = inferPrimaryFreepointTag(routine?.state ?? null);
      const defaultTags = ["PICK", "STAND", "ROAM"];
      const checks: Record<
        string,
        { isOn: boolean; isAvailable: boolean; isNextAvailable: boolean }
      > = {};
      for (const tag of defaultTags) {
        checks[tag] = {
          isOn: Boolean(isNpcOnFreepoint(npc.instanceIndex, tag, 100)),
          isAvailable: Boolean(isFreepointAvailableForNpc(npc.instanceIndex, tag, true)),
          isNextAvailable: Boolean(isFreepointAvailableForNpc(npc.instanceIndex, tag, false)),
        };
      }

      let primary: NpcInspectorInfo["freepoints"]["primary"] = null;
      if (primaryTag) {
        const nearest = findFreepointForNpc(npc.instanceIndex, primaryTag, {
          checkDistance: true,
          dist: 3000,
          avoidCurrentSpot: false,
        });
        const nearestDist = nearest
          ? Math.hypot(
              nearest.position.x - pos.x,
              nearest.position.y - pos.y,
              nearest.position.z - pos.z,
            )
          : null;
        primary = {
          tag: primaryTag,
          isOn: Boolean(isNpcOnFreepoint(npc.instanceIndex, primaryTag, 100)),
          isAvailable: Boolean(isFreepointAvailableForNpc(npc.instanceIndex, primaryTag, true)),
          isNextAvailable: Boolean(
            isFreepointAvailableForNpc(npc.instanceIndex, primaryTag, false),
          ),
          nearest:
            nearest && nearestDist !== null
              ? { nameUpper: nearest.nameUpper, vobId: nearest.vobId, dist: nearestDist }
              : null,
        };
      }

      const info: NpcInspectorInfo = {
        instanceIndex: npc.instanceIndex,
        symbolName: npc.symbolName,
        name: npc.name,
        spawnpoint: npc.spawnpoint,
        routine: routine
          ? {
              state: routine.state,
              waypoint: routine.waypoint,
              start: `${routine.start_h}:${routine.start_m ?? 0}`,
              stop: `${routine.stop_h}:${routine.stop_m ?? 0}`,
            }
          : null,
        worldTime: { day: t.day, hour: t.hour, minute: t.minute },
        worldPos: { x: pos.x, y: pos.y, z: pos.z },
        worldQuat: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
        userData: {
          isScriptControlled: Boolean(ud?.isScriptControlled),
          isSliding: Boolean(ud?.isSliding),
          isFalling: Boolean(ud?.isFalling),
        },
        vm: {
          activeStateName,
          stateTimeSeconds,
          nextLoopInMs: typeof nextAt === "number" ? Math.max(0, nextAt - nowMs) : null,
          lastLoopAgoMs: typeof lastAt === "number" ? Math.max(0, nowMs - lastAt) : null,
          loopGate: gateTarget ? { target: gateTarget, satisfied: gateSatisfied } : null,
        },
        freepoints: {
          primaryTag,
          primary,
          checks,
        },
        em: {
          activeJob,
          clearRequested: Boolean(q?.clearRequested),
          queue: (q?.queue ?? []).slice(0, 32),
        },
      };

      setSnapshot(info);
    };

    tick();
    const interval = window.setInterval(tick, 200);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selected]);

  const body = useMemo(() => (snapshot ? safeJson(snapshot) : ""), [snapshot]);

  if (!selected) return null;

  return (
    <div
      onWheelCapture={(e) => e.stopPropagation()}
      onPointerDownCapture={(e) => e.stopPropagation()}
      onPointerMoveCapture={(e) => e.stopPropagation()}
      onPointerUpCapture={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        right: 10,
        top: topOffsetPx + 10,
        zIndex: 1600,
        width: 420,
        maxHeight: "80vh",
        overflowY: "auto",
        overflowX: "hidden",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        background: "rgba(0,0,0,0.8)",
        color: "white",
        border: "1px solid rgba(255,255,255,0.25)",
        borderRadius: 8,
        fontFamily: "monospace",
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 10px 6px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.15)",
          position: "sticky",
          top: 0,
          background: "rgba(0,0,0,0.9)",
        }}
      >
        <div style={{ fontWeight: 700 }}>
          NPC Inspector: {selected.npc.name ?? selected.npc.symbolName} (
          {selected.npc.instanceIndex})
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={async () => {
              if (!snapshot) return;
              await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
            }}
          >
            Copy JSON
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <pre style={{ margin: 0, padding: 10, whiteSpace: "pre-wrap" }}>{body}</pre>
    </div>
  );
}
