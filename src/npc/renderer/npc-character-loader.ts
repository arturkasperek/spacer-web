import type { MutableRefObject } from "react";
import * as THREE from "three";
import type { ZenKit } from "@kolarz3/zenkit";
import {
  createHumanoidCharacterInstance,
  type CharacterCaches,
  type CharacterInstance,
} from "../../character/character-instance";
import { createCreatureCharacterInstance } from "../../character/creature-character";
import { disposeObject3D } from "../../distance-streaming";
import type { NpcData } from "../../types";
import { getNpcModelScriptsState, setNpcBaseModelScript } from "../scripting/npc-model-scripts";
import { ModelScriptRegistry } from "../../model-script-registry";
import { createHumanLocomotionController } from "../physics/npc-locomotion";
import type { WaypointMover } from "../navigation/npc-waypoint-mover";

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
    characterCachesRef: MutableRefObject<CharacterCaches>;
    modelScriptRegistryRef: MutableRefObject<ModelScriptRegistry | null>;
    waypointMoverRef: MutableRefObject<WaypointMover | null>;
    getNpcVisualRoot: (npcGroup: THREE.Group) => THREE.Object3D;
  },
) {
  if (!zenKit) return;
  const visual = npcData.visual;
  const visualKey = visual
    ? `${visual.bodyMesh}|${visual.bodyTex}|${visual.skin}|${visual.headMesh}|${visual.headTex}|${visual.teethTex}|${visual.armorInst}`
    : "default";

  if (npcGroup.userData.characterInstance && npcGroup.userData.visualKey === visualKey) return;
  if (npcGroup.userData.characterInstance && npcGroup.userData.visualKey !== visualKey) {
    const existing = npcGroup.userData.characterInstance as CharacterInstance;
    existing.dispose();
    npcGroup.userData.characterInstance = null;
  }

  npcGroup.userData.modelLoading = true;
  npcGroup.userData.visualKey = visualKey;

  try {
    const bodyMesh = (visual?.bodyMesh || "").trim().toUpperCase();
    const isHuman = bodyMesh.startsWith("HUM_");

    let instance: CharacterInstance | null = null;
    const visualParent = getNpcVisualRoot(npcGroup);
    if (isHuman || !bodyMesh) {
      instance = await createHumanoidCharacterInstance({
        zenKit,
        caches: characterCachesRef.current,
        parent: visualParent,
        animationName: "s_Run",
        loop: true,
        mirrorX: true,
        rootMotionTarget: "self",
        applyRootMotion: false,
        align: "ground",
        bodyMesh: visual?.bodyMesh,
        bodyTex: visual?.bodyTex,
        skin: visual?.skin,
        headMesh: visual?.headMesh,
        headTex: visual?.headTex,
        teethTex: visual?.teethTex,
        armorInst: visual?.armorInst,
      });
    } else {
      const scripts = getNpcModelScriptsState(npcData.instanceIndex);
      const baseScript = (scripts?.baseScript || "").trim().toUpperCase();
      const modelKey = baseScript && baseScript !== "HUMANS" ? baseScript : bodyMesh;
      if (baseScript === "HUMANS" && modelKey && modelKey !== "HUMANS") {
        setNpcBaseModelScript(npcData.instanceIndex, modelKey);
      }
      modelScriptRegistryRef.current?.startLoadScript(modelKey);

      instance = await createCreatureCharacterInstance({
        zenKit,
        caches: characterCachesRef.current,
        parent: visualParent,
        modelKey,
        meshKey: bodyMesh,
        animationName: "s_Run",
        loop: true,
        mirrorX: true,
        rootMotionTarget: "self",
        applyRootMotion: false,
        align: "ground",
      });

      if (!instance && modelKey !== bodyMesh) {
        instance = await createCreatureCharacterInstance({
          zenKit,
          caches: characterCachesRef.current,
          parent: visualParent,
          modelKey: bodyMesh,
          meshKey: bodyMesh,
          animationName: "s_Run",
          loop: true,
          mirrorX: true,
          rootMotionTarget: "self",
          applyRootMotion: false,
          align: "ground",
        });
      }
    }
    if (npcGroup.userData.isDisposed) return;

    if (!instance) {
      const mesh = (visual?.bodyMesh || "").trim();
      console.warn(
        `Failed to create NPC character model for ${npcData.symbolName}${mesh ? ` (mesh: ${mesh})` : ""}`,
      );
      return;
    }

    npcGroup.userData.characterInstance = instance;
    npcGroup.userData.locomotion = createHumanLocomotionController();
    (npcGroup.userData.characterInstance as CharacterInstance).update(0);
    if (npcGroup.userData.isDisposed) return;

    const npcId = `npc-${npcData.instanceIndex}`;
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
