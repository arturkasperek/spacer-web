import { useRef } from "react";
import type * as THREE from "three";
import type { NpcData } from "../types";
import { createCombatRuntime } from "../combat/combat-runtime";
import type { NpcAnimationRef } from "./use-npc-animation-state";

export function useNpcCombatTick() {
  const combatRuntimeRef = useRef(createCombatRuntime());

  const attachCombatBindings = (npcGroup: THREE.Group, npcData: NpcData) => {
    const ud: any = npcGroup.userData ?? (npcGroup.userData = {});
    if (typeof ud.requestMeleeAttack !== "function") {
      ud.requestMeleeAttack = (opts?: any) => {
        combatRuntimeRef.current.ensureNpc(npcData);
        return combatRuntimeRef.current.requestMeleeAttack(npcData.instanceIndex, opts);
      };
    }
    if (typeof ud.getCombatState !== "function") {
      ud.getCombatState = () => combatRuntimeRef.current.getState(npcData.instanceIndex);
    }
  };

  const runCombatTick = (
    delta: number,
    loadedNpcs: Iterable<THREE.Group>,
    resolveAnim: (npcInstanceIndex: number, animationName: string) => NpcAnimationRef,
  ) => {
    combatRuntimeRef.current.update({
      nowMs: Date.now(),
      dtSeconds: Math.max(0, delta),
      loadedNpcs,
      resolveAnim,
    });
  };

  return {
    combatRuntimeRef,
    attachCombatBindings,
    runCombatTick,
  };
}
