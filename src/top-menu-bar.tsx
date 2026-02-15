import { useEffect, useRef, useState } from "react";
import { toggleViewSetting, useViewSettings } from "./view-settings.js";
import { toggleCameraSetting, useCameraSettings } from "./camera-settings";
import { toggleUiSetting, useUiSettings } from "./ui-settings";

export const TOP_MENU_HEIGHT = 26;

declare global {
  interface Window {
    __npcMotionDebug?: boolean;
  }
}

// Fullscreen hook with pointer lock
function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      const isFS = !!document.fullscreenElement;
      setIsFullscreen(isFS);

      // When entering fullscreen, also lock the pointer
      if (isFS) {
        document.body.requestPointerLock();
      }
    };

    const onPointerLockChange = () => {
      setIsPointerLocked(!!document.pointerLockElement);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("pointerlockchange", onPointerLockChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      // Exit pointer lock first, then fullscreen
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
      document.exitFullscreen();
    }
  };

  return { isFullscreen, isPointerLocked, toggleFullscreen };
}

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
  const camera = useCameraSettings();
  const ui = useUiSettings();
  const { isFullscreen, isPointerLocked, toggleFullscreen } = useFullscreen();
  const [openMenu, setOpenMenu] = useState<"view" | "camera" | null>(null);
  const [motionHeld, setMotionHeld] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.__npcMotionDebug = motionHeld;
  }, [motionHeld]);

  useEffect(() => {
    if (!isFullscreen) return;
    if (openMenu) setOpenMenu(null);
    if (motionHeld) setMotionHeld(false);
  }, [isFullscreen, openMenu, motionHeld]);

  useEffect(() => {
    return () => {
      // Best-effort: ensure it doesn't get stuck enabled if the component unmounts mid-hold.
      if (typeof window !== "undefined") window.__npcMotionDebug = false;
    };
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [openMenu]);

  if (isFullscreen) {
    return null;
  }

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
          onClick={() => setOpenMenu((m) => (m === "view" ? null : "view"))}
          style={{
            height: TOP_MENU_HEIGHT - 4,
            padding: "0 10px",
            borderRadius: 2,
            border: openMenu === "view" ? "1px solid rgba(0,0,0,0.35)" : "1px solid transparent",
            background: openMenu === "view" ? "rgba(255,255,255,0.85)" : "transparent",
            cursor: "pointer",
          }}
        >
          View
        </button>

        {openMenu === "view" && (
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
            <MenuItem
              label="Vobspots"
              checked={view.showVobSpots}
              onClick={() => toggleViewSetting("showVobSpots")}
            />
            <MenuItem
              label="Waypoints"
              checked={view.showWaypoints}
              onClick={() => toggleViewSetting("showWaypoints")}
            />
            <MenuItem
              label="Lights"
              checked={view.showLights}
              onClick={() => toggleViewSetting("showLights")}
            />
            <MenuItem
              label="FPS Meter"
              checked={view.showFpsMeter}
              onClick={() => toggleViewSetting("showFpsMeter")}
            />
            <MenuItem
              label="KCC Capsule"
              checked={view.showKccCapsule}
              onClick={() => toggleViewSetting("showKccCapsule")}
            />
            <MenuItem
              label="Ground Probe Ray"
              checked={view.showGroundProbeRay}
              onClick={() => toggleViewSetting("showGroundProbeRay")}
            />
            <MenuItem
              label="Jump Debug Range"
              checked={view.showJumpDebugRange}
              onClick={() => toggleViewSetting("showJumpDebugRange")}
            />
            <MenuItem
              label="Hide Hero"
              checked={view.hideHero}
              onClick={() => toggleViewSetting("hideHero")}
            />
            <div style={{ height: 1, background: "rgba(0,0,0,0.12)", margin: "4px 0" }} />
            <MenuItem
              label="VOB Tree"
              checked={ui.showVobTree}
              onClick={() => toggleUiSetting("showVobTree")}
            />
            <MenuItem
              label="Time Bar"
              checked={ui.showStatusBar}
              onClick={() => toggleUiSetting("showStatusBar")}
            />
          </div>
        )}
      </div>

      <div style={{ position: "relative" }}>
        <button
          type="button"
          data-testid="top-menu-camera"
          onClick={() => setOpenMenu((m) => (m === "camera" ? null : "camera"))}
          style={{
            height: TOP_MENU_HEIGHT - 4,
            padding: "0 10px",
            borderRadius: 2,
            border: openMenu === "camera" ? "1px solid rgba(0,0,0,0.35)" : "1px solid transparent",
            background: openMenu === "camera" ? "rgba(255,255,255,0.85)" : "transparent",
            cursor: "pointer",
          }}
        >
          Camera
        </button>

        {openMenu === "camera" && (
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
            <MenuItem
              label="Free camera"
              checked={camera.freeCamera}
              onClick={() => toggleCameraSetting("freeCamera")}
            />
          </div>
        )}
      </div>

      <button
        type="button"
        data-testid="top-menu-motion-hold"
        aria-pressed={motionHeld}
        onPointerDown={(e) => {
          e.preventDefault();
          setMotionHeld(true);
          try {
            console.log(
              "[NPCMotionDebugJSON]" +
                JSON.stringify({ t: Date.now(), event: "motionDebugHold", enabled: true }),
            );
          } catch {
            // ignore
          }
          try {
            (e.currentTarget as any).setPointerCapture?.(e.pointerId);
          } catch {
            // ignore
          }
        }}
        onPointerUp={(e) => {
          e.preventDefault();
          setMotionHeld(false);
          try {
            console.log(
              "[NPCMotionDebugJSON]" +
                JSON.stringify({ t: Date.now(), event: "motionDebugHold", enabled: false }),
            );
          } catch {
            // ignore
          }
          try {
            (e.currentTarget as any).releasePointerCapture?.(e.pointerId);
          } catch {
            // ignore
          }
        }}
        onPointerCancel={() => setMotionHeld(false)}
        onPointerLeave={() => setMotionHeld(false)}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          height: TOP_MENU_HEIGHT - 4,
          padding: "0 10px",
          borderRadius: 2,
          border: "1px solid rgba(0,0,0,0.25)",
          background: motionHeld ? "rgba(255,220,220,0.95)" : "rgba(255,255,255,0.65)",
          cursor: "pointer",
          userSelect: "none",
        }}
        title="Przytrzymaj żeby logować [NPCMotionDebugJSON] w konsoli (użyj podczas schodzenia ze schodów)"
      >
        Hold motion JSON
      </button>

      <button
        type="button"
        data-testid="top-menu-fullscreen"
        onClick={toggleFullscreen}
        style={{
          height: TOP_MENU_HEIGHT - 4,
          padding: "0 10px",
          borderRadius: 2,
          border: "1px solid rgba(0,0,0,0.25)",
          background: isFullscreen ? "rgba(220,255,220,0.95)" : "rgba(255,255,255,0.65)",
          cursor: "pointer",
          userSelect: "none",
        }}
        title={
          isFullscreen
            ? `Exit fullscreen (ESC)${isPointerLocked ? " - Mouse locked" : ""}`
            : "Enter fullscreen with mouse lock (F11)"
        }
      >
        {isFullscreen ? "🔒 Exit Fullscreen" : "🎮 Fullscreen"}
      </button>
    </div>
  );
}
