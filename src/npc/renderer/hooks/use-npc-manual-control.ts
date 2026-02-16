import { useEffect, useRef, type RefObject } from "react";

export type ManualKeysState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

export type UseNpcManualControlResult = {
  manualControlHeroEnabled: boolean;
  manualKeysRef: RefObject<ManualKeysState>;
  manualRunToggleRef: RefObject<boolean>;
  teleportHeroSeqRef: RefObject<number>;
  teleportHeroSeqAppliedRef: RefObject<number>;
  manualAttackSeqRef: RefObject<number>;
  manualAttackSeqAppliedRef: RefObject<number>;
  manualJumpSeqRef: RefObject<number>;
  manualJumpSeqAppliedRef: RefObject<number>;
};

export function useNpcManualControl(): UseNpcManualControlResult {
  // Keep arrow-key hero control available even in free camera mode.
  const manualControlHeroEnabled = true;

  const manualKeysRef = useRef<ManualKeysState>({
    up: false,
    down: false,
    left: false,
    right: false,
  });
  const manualRunToggleRef = useRef(false);
  const teleportHeroSeqRef = useRef(0);
  const teleportHeroSeqAppliedRef = useRef(0);
  const manualAttackSeqRef = useRef(0);
  const manualAttackSeqAppliedRef = useRef(0);
  const manualJumpSeqRef = useRef(0);
  const manualJumpSeqAppliedRef = useRef(0);

  useEffect(() => {
    if (!manualControlHeroEnabled) return;

    const setKey = (e: KeyboardEvent, pressed: boolean) => {
      let handled = true;
      switch (e.code) {
        case "ArrowUp":
          manualKeysRef.current.up = pressed;
          break;
        case "ArrowDown":
          manualKeysRef.current.down = pressed;
          break;
        case "ArrowLeft":
          manualKeysRef.current.left = pressed;
          break;
        case "ArrowRight":
          manualKeysRef.current.right = pressed;
          break;
        case "ShiftLeft":
        case "ShiftRight":
          // Toggle run/walk on a single press (no hold).
          if (pressed && !e.repeat) manualRunToggleRef.current = !manualRunToggleRef.current;
          break;
        case "Space":
          if (pressed && !e.repeat) manualJumpSeqRef.current += 1;
          break;
        default:
          handled = false;
      }

      if (handled) e.preventDefault();
    };

    const onKeyDown = (e: KeyboardEvent) => setKey(e, true);
    const onKeyUp = (e: KeyboardEvent) => setKey(e, false);

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown as any);
      window.removeEventListener("keyup", onKeyUp as any);
    };
  }, [manualControlHeroEnabled]);

  // Debug helper: teleport the hero in front of the camera (works in both camera modes).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyT") return;
      if (e.repeat) return;
      teleportHeroSeqRef.current += 1;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown as any);
  }, []);

  return {
    manualControlHeroEnabled,
    manualKeysRef,
    manualRunToggleRef,
    teleportHeroSeqRef,
    teleportHeroSeqAppliedRef,
    manualAttackSeqRef,
    manualAttackSeqAppliedRef,
    manualJumpSeqRef,
    manualJumpSeqAppliedRef,
  };
}
