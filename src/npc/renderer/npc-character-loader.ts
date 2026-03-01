import type { RefObject } from "react";
import * as THREE from "three";
import type { ZenKit } from "@kolarz3/zenkit";
import {
  createHumanoidCharacterInstance,
  type CharacterCaches,
  type CharacterInstance,
} from "../../character/character-instance";
import { disposeObject3D } from "../../world/distance-streaming";
import type { NpcData } from "../../shared/types";
import { ModelScriptRegistry } from "../../shared/model-script-registry";
import {
  createCreatureLocomotionController,
  createHumanLocomotionController,
} from "../physics/npc-locomotion";
import type { WaypointMover } from "../navigation/npc-waypoint-mover";
import { getNpcRuntimeId } from "./npc-renderer-utils";
import {
  canInstantiateNpcModel,
  preloadNpcModelScripts,
  resolveNpcModelDescriptor,
  type NpcModelDescriptor,
} from "./npc-model-descriptor";

async function instantiateFromDescriptor(
  descriptor: NpcModelDescriptor,
  {
    zenKit,
    caches,
    visualParent,
    modelScriptRegistryRef,
  }: {
    zenKit: ZenKit;
    caches: CharacterCaches;
    visualParent: THREE.Object3D;
    modelScriptRegistryRef: RefObject<ModelScriptRegistry | null>;
  },
): Promise<CharacterInstance | null> {
  return createHumanoidCharacterInstance({
    zenKit,
    caches,
    parent: visualParent,
    modelKey: descriptor.baseScript,
    animationName: "s_Run",
    loop: true,
    mirrorX: true,
    rootMotionTarget: "self",
    applyRootMotion: false,
    align: "ground",
    bodyMesh: descriptor.visual?.bodyMesh || descriptor.bodyMesh,
    bodyTex: descriptor.visual?.bodyTex,
    skin: descriptor.visual?.skin,
    headMesh: descriptor.visual?.headMesh,
    headTex: descriptor.visual?.headTex,
    teethTex: descriptor.visual?.teethTex,
    armorInst: descriptor.visual?.armorInst,
    canLoadAnimation: (modelName, animationName) =>
      modelScriptRegistryRef.current?.hasAnimation(modelName, animationName) ?? null,
  });
}

export async function loadNpcCharacter(
  npcGroup: THREE.Group,
  npcData: NpcData,
  {
    zenKit,
    characterCachesRef,
    modelScriptRegistryRef,
    waypointMoverRef,
    getNpcVisualRoot,
  }: {
    zenKit: ZenKit | null;
    characterCachesRef: RefObject<CharacterCaches>;
    modelScriptRegistryRef: RefObject<ModelScriptRegistry | null>;
    waypointMoverRef: RefObject<WaypointMover | null>;
    getNpcVisualRoot: (npcGroup: THREE.Group) => THREE.Object3D;
  },
) {
  if (!zenKit) return;
  const descriptor = resolveNpcModelDescriptor(npcData);
  const visual = descriptor.visual;
  const visualKey = descriptor.visualKey;

  if (npcGroup.userData.characterInstance && npcGroup.userData.visualKey === visualKey) return;
  if (npcGroup.userData.characterInstance && npcGroup.userData.visualKey !== visualKey) {
    const existing = npcGroup.userData.characterInstance as CharacterInstance;
    existing.dispose();
    npcGroup.userData.characterInstance = null;
  }

  npcGroup.userData.modelLoading = true;
  npcGroup.userData.visualKey = visualKey;

  try {
    if (!canInstantiateNpcModel(descriptor)) {
      // Wait for full VM visual state (Mdl_SetVisual/Mdl_SetVisualBody) before building creature model.
      return;
    }

    preloadNpcModelScripts(descriptor, modelScriptRegistryRef);

    const visualParent = getNpcVisualRoot(npcGroup);
    const instance = await instantiateFromDescriptor(descriptor, {
      zenKit,
      caches: characterCachesRef.current,
      visualParent,
      modelScriptRegistryRef,
    });
    if (npcGroup.userData.isDisposed) return;

    if (!instance) {
      const mesh = (visual?.bodyMesh || "").trim();
      console.warn(
        `Failed to create NPC character model for ${npcData.symbolName}${mesh ? ` (mesh: ${mesh})` : ""}`,
      );
      return;
    }

    npcGroup.userData.characterInstance = instance;
    npcGroup.userData.locomotion = descriptor.usesCreatureLocomotion
      ? createCreatureLocomotionController()
      : createHumanLocomotionController();
    (npcGroup.userData.characterInstance as CharacterInstance).update(0);
    if (npcGroup.userData.isDisposed) return;

    const npcId = getNpcRuntimeId(npcData);
    npcGroup.userData.startMoveToWaypoint = (targetWaypointName: string, options?: any) => {
      return (
        waypointMoverRef.current?.startMoveToWaypoint(
          npcId,
          npcGroup,
          targetWaypointName,
          options,
        ) ?? false
      );
    };
    npcGroup.userData.startMoveToFreepoint = (freepointName: string, options?: any) => {
      return (
        waypointMoverRef.current?.startMoveToFreepoint(npcId, npcGroup, freepointName, options) ??
        false
      );
    };

    const placeholder = npcGroup.getObjectByName("npc-placeholder");
    if (placeholder) {
      placeholder.parent?.remove(placeholder);
      disposeObject3D(placeholder);
    }

    const visualRoot = getNpcVisualRoot(npcGroup);
    const sprite = visualRoot.children.find((child) => child instanceof THREE.Sprite) as
      | THREE.Sprite
      | undefined;
    const healthBarRoot = (npcGroup.userData as any)?.healthBar?.root as THREE.Object3D | undefined;
    const modelObj = instance.object;
    if (sprite && modelObj) {
      visualRoot.updateMatrixWorld(true);
      modelObj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(modelObj);
      const center = box.getCenter(new THREE.Vector3());
      const topWorld = new THREE.Vector3(center.x, box.max.y, center.z);
      const topLocal = visualRoot.worldToLocal(topWorld);
      const LABEL_OFFSET_Y = 25;
      const HPBAR_OFFSET_Y = LABEL_OFFSET_Y + 18;
      sprite.position.y = topLocal.y + LABEL_OFFSET_Y;
      if (healthBarRoot) healthBarRoot.position.y = topLocal.y + HPBAR_OFFSET_Y;
    } else if (healthBarRoot && modelObj) {
      visualRoot.updateMatrixWorld(true);
      modelObj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(modelObj);
      const center = box.getCenter(new THREE.Vector3());
      const topWorld = new THREE.Vector3(center.x, box.max.y, center.z);
      const topLocal = visualRoot.worldToLocal(topWorld);
      healthBarRoot.position.y = topLocal.y + 43;
    }

    npcGroup.userData.modelLoaded = true;
  } catch (error) {
    console.warn(`Failed to load NPC character model for ${npcData.symbolName}:`, error);
  } finally {
    npcGroup.userData.modelLoading = false;
    if (npcGroup.userData.isDisposed) {
      const instance = npcGroup.userData.characterInstance as CharacterInstance | undefined;
      if (instance) instance.dispose();
      disposeObject3D(npcGroup);
    }
  }
}
