import { useMemo, type RefObject } from "react";
import * as THREE from "three";
import type { CharacterCaches } from "../../../character/character-instance";
import { getNpcVisualStateByInstanceIndex } from "../../../vm-manager";
import type { ModelScriptRegistry } from "../../../shared/model-script-registry";

export type NpcAnimationRef = {
  animationName: string;
  modelName: string;
  blendInMs: number | undefined;
  blendOutMs: number | undefined;
};

export function useNpcAnimationState(params: {
  characterCachesRef: RefObject<CharacterCaches>;
  modelScriptRegistryRef: RefObject<ModelScriptRegistry | null>;
  waypointPosIndex: Map<string, THREE.Vector3>;
  waypointDirIndex: Map<string, THREE.Quaternion>;
}) {
  const { characterCachesRef, modelScriptRegistryRef, waypointPosIndex, waypointDirIndex } = params;

  const estimateAnimationDurationMs = useMemo(() => {
    return (modelName: string, animationName: string): number | null => {
      const caches = characterCachesRef.current;
      const base = (modelName || "HUMANS").trim().toUpperCase() || "HUMANS";
      const key = `${base}:${(animationName || "").trim().toUpperCase()}`;
      const seq: any = caches?.animations?.get(key);
      const dur = seq?.totalTimeMs;
      return typeof dur === "number" && Number.isFinite(dur) && dur > 0 ? dur : null;
    };
  }, [characterCachesRef]);

  const getNearestWaypointDirectionQuat = useMemo(() => {
    return (pos: THREE.Vector3): THREE.Quaternion | null => {
      const wpPos = waypointPosIndex;
      const wpDir = waypointDirIndex;
      let bestKey: string | null = null;
      let bestD2 = Infinity;
      for (const [k, p] of wpPos.entries()) {
        if (!wpDir.has(k)) continue;
        const dx = p.x - pos.x;
        const dz = p.z - pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestKey = k;
        }
      }
      if (!bestKey) return null;
      const q = wpDir.get(bestKey);
      return q ? q.clone() : null;
    };
  }, [waypointDirIndex, waypointPosIndex]);

  const getAnimationMetaForNpc = useMemo(() => {
    return (npcInstanceIndex: number, animationName: string) => {
      const reg = modelScriptRegistryRef.current;
      if (!reg) return null;
      const st = getNpcVisualStateByInstanceIndex(npcInstanceIndex);
      const scripts = st
        ? {
            baseScript: st.baseScript,
            overlays: st.overlays,
          }
        : null;
      return reg.getAnimationMetaForNpc(scripts, animationName);
    };
  }, [modelScriptRegistryRef]);

  const resolveNpcAnimationRef = useMemo(() => {
    return (npcInstanceIndex: number, animationName: string): NpcAnimationRef => {
      const meta = getAnimationMetaForNpc(npcInstanceIndex, animationName);
      const st = getNpcVisualStateByInstanceIndex(npcInstanceIndex);
      const fallbackModel = (st?.baseScript || "HUMANS").trim().toUpperCase() || "HUMANS";
      const modelName = (meta?.model || fallbackModel).trim().toUpperCase() || fallbackModel;
      const blendInMs = Number.isFinite(meta?.blendIn)
        ? Math.max(0, (meta!.blendIn as number) * 1000)
        : undefined;
      const blendOutMs = Number.isFinite(meta?.blendOut)
        ? Math.max(0, (meta!.blendOut as number) * 1000)
        : undefined;
      return { animationName: (animationName || "").trim(), modelName, blendInMs, blendOutMs };
    };
  }, [getAnimationMetaForNpc]);

  return {
    estimateAnimationDurationMs,
    getNearestWaypointDirectionQuat,
    getAnimationMetaForNpc,
    resolveNpcAnimationRef,
  };
}
