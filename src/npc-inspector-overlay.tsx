import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { NpcData } from "./types.js";
import { findActiveRoutineEntry } from "./npc-utils.js";
import { getWorldTime } from "./world-time.js";
import { __getNpcEmQueueState } from "./npc-em-queue.js";
import { __getNpcEmActiveJob } from "./npc-em-runtime.js";

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

export function NpcInspectorOverlay({
  selected,
  onClose,
}: {
  selected: SelectedNpc | null;
  onClose: () => void;
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
      style={{
        position: "absolute",
        right: 10,
        top: 10,
        zIndex: 1600,
        width: 420,
        maxHeight: "80vh",
        overflow: "auto",
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
          NPC Inspector: {selected.npc.name ?? selected.npc.symbolName} ({selected.npc.instanceIndex})
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

