import * as THREE from "three";
import type { ZenKit } from "@kolarz3/zenkit";
import type { CharacterCaches, CharacterInstance } from "./character-instance.js";
import { fetchBinaryCached } from "./binary-cache.js";
import { loadAnimationSequence, evaluatePose } from "./animation.js";
import { buildSkeletonFromHierarchy } from "./skeleton.js";
import { applyCpuSkinning, type CpuSkinningData } from "./cpu-skinning.js";
import { buildSoftSkinMeshCPU } from "./soft-skin.js";
import { disposeObject3D } from "../distance-streaming.js";

function normalizeModelKey(input: string): string {
  return (input || "")
    .trim()
    .replace(/\.(ASC|MDM|MDH|MDL|MDS|MSB|MMS|MMB)$/i, "")
    .replace(/\.+$/, "")
    .toUpperCase();
}

export async function createCreatureCharacterInstance(params: {
  zenKit: ZenKit;
  caches: CharacterCaches;
  parent: THREE.Object3D;
  modelKey: string;
  meshKey?: string;
  animationName?: string;
  loop?: boolean;
  mirrorX?: boolean;
  rootMotion?: boolean;
  applyRootMotion?: boolean;
  rootMotionTarget?: "self" | "parent";
  align?: "center" | "ground";
}): Promise<CharacterInstance | null> {
  const {
    zenKit,
    caches,
    parent,
    modelKey,
    meshKey,
    animationName = "s_Run",
    loop = true,
    mirrorX = true,
    rootMotion = true,
    applyRootMotion = true,
    rootMotionTarget = "parent",
    align = "ground",
  } = params;

  const model = normalizeModelKey(modelKey);
  const mesh = normalizeModelKey(meshKey || modelKey);
  if (!model || !mesh) return null;

  const root = new THREE.Group();
  root.name = "npc-character";
  parent.add(root);

  const group = new THREE.Group();
  group.name = "npc-character-model";
  root.add(group);

  try {
    const mdhPath = `/ANIMS/_COMPILED/${model}.MDH`;
    const mdmPath = `/ANIMS/_COMPILED/${mesh}.MDM`;

    const mdhBytes = await fetchBinaryCached(mdhPath, caches.binary);
    const mdmBytes = await fetchBinaryCached(mdmPath, caches.binary);

    const hierarchyLoader = zenKit.createModelHierarchyLoader();
    const mdhLoadResult = hierarchyLoader.loadFromArray(mdhBytes);
    if (!mdhLoadResult || !mdhLoadResult.success) return null;

    const meshLoader = zenKit.createModelMeshLoader();
    const mdmLoadResult = meshLoader.loadFromArray(mdmBytes);
    if (!mdmLoadResult || !mdmLoadResult.success) return null;

    const zModel = zenKit.createModel();
    zModel.setHierarchy(hierarchyLoader.getHierarchy());
    zModel.setMesh(meshLoader.getMesh());

    const hierarchy = zModel.getHierarchy();
    const skeleton = buildSkeletonFromHierarchy(hierarchy);

    for (const rootIdx of skeleton.rootNodes) {
      group.add(skeleton.bones[rootIdx]);
    }

    const softSkinMeshes = zModel.getSoftSkinMeshes();
    const softSkinCount = softSkinMeshes ? softSkinMeshes.size() : 0;
    if (softSkinCount === 0) return null;

    const skinningDataList: CpuSkinningData[] = [];
    for (let i = 0; i < softSkinCount; i++) {
      const softSkinMesh = softSkinMeshes.get(i);
      if (!softSkinMesh) continue;
      const { mesh: threeMesh, skinningData } = await buildSoftSkinMeshCPU({
        zenKit,
        softSkinMesh,
        bindWorld: skeleton.bindWorld,
        textureCache: caches.textures,
      });
      threeMesh.userData.cpuSkinningData = skinningData;
      skinningDataList.push(skinningData);
      group.add(threeMesh);
    }

    if (mirrorX) {
      group.scale.x = -Math.abs(group.scale.x || 1);
    }

    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const offsetWorld = align === "ground" ? new THREE.Vector3(center.x, box.min.y, center.z) : center.clone();
    const offsetLocal = group.worldToLocal(offsetWorld.clone());
    group.position.sub(offsetLocal);

    const initialCandidates = Array.from(
      new Set(
        [animationName, "s_Run", "s_Walk", "s_Stand", "s_Idle", "t_Stand", "t_Dance_01"]
          .map((s) => (s || "").trim())
          .filter(Boolean)
      )
    );
    let initialSequence: any | null = null;
    let initialName = animationName;
    for (const cand of initialCandidates) {
      const seq = await loadAnimationSequence(zenKit, caches.binary, caches.animations, model, cand);
      if (seq) {
        initialSequence = seq;
        initialName = cand;
        break;
      }
    }

    let currentSequence = initialSequence;
    let currentAnimationName = initialName;
    let currentModelName = model;
    let currentLoop = loop;
    let currentTimeMs = 0;
    const failedAnis = new Set<string>();
    let pendingLoad: { modelName: string; name: string; loop: boolean; resetTime: boolean; fallbackNames?: string[] } | null = null;
    let loadingPromise: Promise<void> | null = null;
    let nextAfterNonLoop:
      | { animationName: string; modelName: string; loop: boolean; resetTime: boolean; fallbackNames?: string[] }
      | null = null;

    const rootMotionPos = new THREE.Vector3();
    const lastRootMotionPos = new THREE.Vector3();
    const rootMotionDelta = new THREE.Vector3();
    let hasLastRootMotionPos = false;
    let lastPoseTimeMs = 0;

    const ensureLoaderRunning = () => {
      if (loadingPromise) return;
      loadingPromise = (async () => {
        while (pendingLoad) {
          const next = pendingLoad;
          pendingLoad = null;

          const candidates = [next.name, ...(next.fallbackNames || [])].filter(Boolean);
          let loaded: { seq: any; name: string } | null = null;

          for (const cand of candidates) {
            const key = `${next.modelName}:${cand}`.toUpperCase();
            if (failedAnis.has(key)) continue;
            const seq = await loadAnimationSequence(zenKit, caches.binary, caches.animations, next.modelName, cand);
            if (seq) {
              loaded = { seq, name: cand };
              break;
            }
            failedAnis.add(key);
          }

          if (loaded) {
            currentSequence = loaded.seq;
            currentAnimationName = loaded.name;
            currentModelName = next.modelName;
            currentLoop = next.loop;
            if (next.resetTime) currentTimeMs = 0;
            hasLastRootMotionPos = false;
            lastPoseTimeMs = 0;
            root.userData.__currentAnimationName = currentAnimationName;
            root.userData.__currentAnimationModel = currentModelName;
          } else {
            currentLoop = next.loop;
          }
        }
      })().finally(() => {
        loadingPromise = null;
        if (pendingLoad) ensureLoaderRunning();
      });
    };

    const tryLoadAnimation = (req: { modelName: string; name: string; loop: boolean; resetTime: boolean; fallbackNames?: string[] }) => {
      const names = [req.name, ...(req.fallbackNames || [])].filter(Boolean);
      for (const n of names) failedAnis.delete(`${req.modelName}:${n}`.toUpperCase());
      pendingLoad = req;
      ensureLoaderRunning();
    };

    const setAnimation: CharacterInstance["setAnimation"] = (nextName, options) => {
      const name = (nextName || "").trim();
      if (!name) return;
      const nextModel = normalizeModelKey(options?.modelName || currentModelName || model) || model;
      const nextLoop = options?.loop ?? currentLoop;
      const resetTime = options?.resetTime ?? false;

      if (name.toUpperCase() === (currentAnimationName || "").toUpperCase() && nextModel === currentModelName) {
        currentLoop = nextLoop;
        if (resetTime) currentTimeMs = 0;
        if (currentLoop) nextAfterNonLoop = null;
        return;
      }

      if (!nextLoop && options?.next) {
        nextAfterNonLoop = {
          animationName: options.next.animationName,
          modelName: normalizeModelKey(options.next.modelName || nextModel || model) || model,
          loop: options.next.loop ?? true,
          resetTime: options.next.resetTime ?? true,
          fallbackNames: options.next.fallbackNames,
        };
      } else {
        nextAfterNonLoop = null;
      }

      tryLoadAnimation({ modelName: nextModel, name, loop: nextLoop, resetTime, fallbackNames: options?.fallbackNames });
    };

    const update = (deltaSeconds: number) => {
      if (!currentSequence) return;
      currentTimeMs += deltaSeconds * 1000;

      const animUpper = (currentAnimationName || "").toUpperCase();
      const stripRootMotionY =
        animUpper === "S_JUMP" ||
        animUpper === "T_STAND_2_JUMP" ||
        animUpper === "T_RUNL_2_JUMP" ||
        animUpper === "T_JUMP_2_STAND" ||
        animUpper === "T_STAND_2_JUMPUPLOW" ||
        animUpper === "T_STAND_2_JUMPUPMID" ||
        animUpper === "T_STAND_2_JUMPUP" ||
        animUpper === "S_JUMPUPLOW" ||
        animUpper === "S_JUMPUPMID" ||
        animUpper === "S_JUMPUP" ||
        animUpper === "S_HANG" ||
        animUpper === "T_JUMPUPLOW_2_STAND" ||
        animUpper === "T_JUMPUPMID_2_STAND" ||
        animUpper === "T_JUMPUP_2_STAND" ||
        animUpper === "T_HANG_2_STAND";
      const ok = evaluatePose(skeleton, currentSequence, currentTimeMs, currentLoop, {
        extractRootMotion: rootMotion,
        outRootMotionPos: rootMotionPos,
        stripRootMotionY,
      });
      if (!ok) return;

      if (!currentLoop && nextAfterNonLoop && currentTimeMs >= currentSequence.totalTimeMs) {
        const next = nextAfterNonLoop;
        nextAfterNonLoop = null;
        setAnimation(next.animationName, {
          modelName: next.modelName,
          loop: next.loop,
          resetTime: next.resetTime,
          fallbackNames: next.fallbackNames,
        });
      }

      if (rootMotion) {
        const totalTimeMs = currentSequence.totalTimeMs;
        const poseTimeMs = currentLoop
          ? ((currentTimeMs % totalTimeMs) + totalTimeMs) % totalTimeMs
          : Math.max(0, Math.min(totalTimeMs, currentTimeMs));

        rootMotionDelta.set(0, 0, 0);

        if (!hasLastRootMotionPos) {
          lastRootMotionPos.copy(rootMotionPos);
          hasLastRootMotionPos = true;
          lastPoseTimeMs = poseTimeMs;
        } else if (currentLoop && poseTimeMs < lastPoseTimeMs) {
          lastRootMotionPos.copy(rootMotionPos);
          lastPoseTimeMs = poseTimeMs;
        } else {
          rootMotionDelta.subVectors(rootMotionPos, lastRootMotionPos);
          lastRootMotionPos.copy(rootMotionPos);
          lastPoseTimeMs = poseTimeMs;

          if (mirrorX) rootMotionDelta.x *= -1;

          if (applyRootMotion) {
            const target = rootMotionTarget === "parent" ? parent : root;
            if (rootMotionDelta.x) target.translateX(rootMotionDelta.x);
            if (rootMotionDelta.y) target.translateY(rootMotionDelta.y);
            if (rootMotionDelta.z) target.translateZ(rootMotionDelta.z);
          }
        }

        root.userData.__rootMotionDelta = { x: rootMotionDelta.x, y: rootMotionDelta.y, z: rootMotionDelta.z };
      } else {
        root.userData.__rootMotionDelta = { x: 0, y: 0, z: 0 };
      }

      for (let i = 0; i < skinningDataList.length; i++) {
        applyCpuSkinning(skeleton.animWorld, skinningDataList[i]);
      }
    };

    const dispose = () => {
      parent.remove(root);
      disposeObject3D(root);
    };

    root.userData.__currentAnimationName = currentAnimationName;
    root.userData.__currentAnimationModel = currentModelName;
    root.userData.__rootMotionDelta = { x: 0, y: 0, z: 0 };
    return { object: root, update, setAnimation, dispose };
  } catch (error) {
    console.warn("Failed to create creature character instance:", error);
    parent.remove(root);
    disposeObject3D(root);
    return null;
  }
}
