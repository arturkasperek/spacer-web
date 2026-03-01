import type { RefObject } from "react";
import type { NpcData } from "../../shared/types";
import { ModelScriptRegistry } from "../../shared/model-script-registry";
import {
  getNpcVisualStateByInstanceIndex,
  getNpcVisualStateHashByInstanceIndex,
} from "../../vm-manager";

function hasMeaningfulVisual(visual: NpcData["visual"] | null | undefined): boolean {
  if (!visual) return false;
  return Boolean((visual.bodyMesh || "").trim() || (visual.headMesh || "").trim());
}

export type NpcModelDescriptor = {
  visual: NpcData["visual"] | undefined;
  visualKey: string;
  bodyMesh: string;
  baseScript: string;
  hasExplicitBaseScript: boolean;
  isReady: boolean;
  overlays: string[];
  usesCreatureLocomotion: boolean;
};

export function resolveNpcModelDescriptor(npcData: NpcData): NpcModelDescriptor {
  const visualState = getNpcVisualStateByInstanceIndex(npcData.instanceIndex);
  const visual =
    hasMeaningfulVisual(visualState?.visual) || !hasMeaningfulVisual(npcData.visual)
      ? visualState?.visual
      : npcData.visual;
  const bodyMesh = (visual?.bodyMesh || "").trim().toUpperCase();
  const inferredBaseScriptFromBody = bodyMesh && !bodyMesh.startsWith("HUM_") ? bodyMesh : "HUMANS";
  const baseScript =
    (visualState?.baseScript || inferredBaseScriptFromBody).trim().toUpperCase() ||
    inferredBaseScriptFromBody;
  const hasExplicitBaseScript =
    visualState?.hasExplicitBaseScript === true ||
    (!visualState && !!bodyMesh && !bodyMesh.startsWith("HUM_"));
  const isReady = visualState?.isReady === true;
  const overlays = [...(visualState?.overlays || [])];
  const visualKey =
    getNpcVisualStateHashByInstanceIndex(npcData.instanceIndex) ??
    (visual
      ? `${baseScript}|${hasExplicitBaseScript ? 1 : 0}|ov:${overlays.join(",")}|${visual.bodyMesh}|${visual.bodyTex}|${visual.skin}|${visual.headMesh}|${visual.headTex}|${visual.teethTex}|${visual.armorInst}`
      : `${baseScript}|${hasExplicitBaseScript ? 1 : 0}|ov:${overlays.join(",")}|default`);
  const usesCreatureLocomotion = hasExplicitBaseScript && baseScript !== "HUMANS";

  return {
    visual,
    visualKey,
    bodyMesh,
    baseScript,
    hasExplicitBaseScript,
    isReady,
    overlays,
    usesCreatureLocomotion,
  };
}

export function canInstantiateNpcModel(descriptor: NpcModelDescriptor): boolean {
  return descriptor.isReady;
}

export function preloadNpcModelScripts(
  descriptor: NpcModelDescriptor,
  modelScriptRegistryRef: RefObject<ModelScriptRegistry | null>,
): void {
  if (!descriptor.usesCreatureLocomotion) return;
  modelScriptRegistryRef.current?.startLoadScript(descriptor.baseScript);
  for (const overlay of descriptor.overlays) {
    modelScriptRegistryRef.current?.startLoadScript(overlay);
  }
}
