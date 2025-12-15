import { useMemo, useState } from "react";
import { getNpcDebugMark, requestNpcDebugDump, requestNpcDebugMark } from "./npc-debug-tools";

function isEnabled(): boolean {
  try {
    const search = (globalThis as any)?.location?.search as string | undefined;
    if (!search) return false;
    const p = new URLSearchParams(search);
    const v = (p.get("debugNpcTools") || "").trim();
    return v === "1" || v.toLowerCase() === "true";
  } catch {
    return false;
  }
}

export function NpcDebugPanel() {
  const enabled = useMemo(isEnabled, []);
  const [, forceRender] = useState(0);

  if (!enabled) return null;

  const mark = getNpcDebugMark();

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 2000,
        background: "rgba(0,0,0,0.75)",
        color: "white",
        padding: "10px",
        borderRadius: "6px",
        fontFamily: "monospace",
        fontSize: "12px",
        display: "flex",
        gap: "8px",
        alignItems: "center",
      }}
    >
      <button
        onClick={() => {
          requestNpcDebugMark();
          forceRender(v => v + 1);
        }}
      >
        Mark Cavalorn
      </button>
      <button
        onClick={() => {
          requestNpcDebugDump();
          forceRender(v => v + 1);
        }}
      >
        Dump Next Frame
      </button>
      <div style={{ opacity: 0.85 }}>
        {mark ? `Marked: ${mark.displayName} @ ${Math.round(mark.worldPos.y)}` : "No mark"}
      </div>
    </div>
  );
}

