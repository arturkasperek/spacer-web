import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { tickWorldTime } from "./world-time.js";

export function WorldTimeTicker() {
  const hold = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).has("holdTime");
    } catch {
      return false;
    }
  }, []);

  useFrame((_state, deltaSeconds) => {
    if (hold) return;
    tickWorldTime(deltaSeconds);
  });

  return null;
}

