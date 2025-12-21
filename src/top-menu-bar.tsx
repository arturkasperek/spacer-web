import { useEffect, useRef, useState } from "react";
import { toggleViewSetting, useViewSettings } from "./view-settings.js";

export const TOP_MENU_HEIGHT = 26;

type MenuItemProps = {
  label: string;
  checked: boolean;
  onClick: () => void;
};

function MenuItem({ label, checked, onClick }: MenuItemProps) {
  return (
    <div
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 10px",
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div style={{ width: 14, textAlign: "center" }}>{checked ? "✓" : ""}</div>
      <div>{label}</div>
    </div>
  );
}

export function TopMenuBar() {
  const view = useViewSettings();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);

  return (
    <div
      ref={rootRef}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        right: 0,
        height: TOP_MENU_HEIGHT,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
        background: "rgba(235,235,235,0.95)",
        borderBottom: "1px solid rgba(0,0,0,0.25)",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        fontSize: 13,
        zIndex: 2000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div style={{ position: "relative" }}>
        <button
          type="button"
          data-testid="top-menu-view"
          onClick={() => setOpen((v) => !v)}
          style={{
            height: TOP_MENU_HEIGHT - 4,
            padding: "0 10px",
            borderRadius: 2,
            border: open ? "1px solid rgba(0,0,0,0.35)" : "1px solid transparent",
            background: open ? "rgba(255,255,255,0.85)" : "transparent",
            cursor: "pointer",
          }}
        >
          View
        </button>

        {open && (
          <div
            role="menu"
            style={{
              position: "absolute",
              top: TOP_MENU_HEIGHT - 2,
              left: 0,
              background: "rgba(245,245,245,0.98)",
              border: "1px solid rgba(0,0,0,0.25)",
              boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
              borderRadius: 2,
              padding: "4px 0",
              minWidth: 180,
              zIndex: 2100,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <MenuItem label="Vobspots" checked={view.showVobSpots} onClick={() => toggleViewSetting("showVobSpots")} />
            <MenuItem label="Waypoints" checked={view.showWaypoints} onClick={() => toggleViewSetting("showWaypoints")} />
            <MenuItem label="Lights" checked={view.showLights} onClick={() => toggleViewSetting("showLights")} />
          </div>
        )}
      </div>
    </div>
  );
}

