import { useMemo } from "react";
import { requestNpcCollisionDump } from "./npc-collision-debug";

export function NpcCollisionDebugPanel() {
  const enabled = useMemo(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      return qs.has("controlCavalorn") || qs.has("debugNpcCollision");
    } catch {
      return false;
    }
  }, []);

  if (!enabled) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 2000,
        background: "rgba(0,0,0,0.7)",
        color: "white",
        padding: "10px",
        borderRadius: 6,
        fontFamily: "monospace",
        fontSize: 12,
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}
    >
      <button
        onClick={() => requestNpcCollisionDump()}
        style={{
          cursor: "pointer",
          padding: "6px 10px",
          borderRadius: 4,
          border: "1px solid rgba(255,255,255,0.35)",
          background: "rgba(255,255,255,0.08)",
          color: "white",
          fontFamily: "inherit",
          fontSize: 12,
        }}
      >
        Dump Cavalorn collision
      </button>
      <span style={{ opacity: 0.85 }}>Logs as JSON: `[NPCCollisionDebugJSON]...`</span>
    </div>
  );
}

