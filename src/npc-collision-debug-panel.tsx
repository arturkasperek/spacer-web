import { useMemo } from "react";

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

  return null;
}
