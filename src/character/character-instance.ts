import * as THREE from "three";
import type { ZenKit } from "@kolarz3/zenkit";
import type { BinaryCache } from "./binary-cache.js";
import type { AnimationCache } from "./animation.js";
import { fetchBinaryCached } from "./binary-cache.js";
import { loadAnimationSequence, evaluatePose } from "./animation.js";
import { buildSkeletonFromHierarchy } from "./skeleton.js";
import { applyCpuSkinning, type CpuSkinningData } from "./cpu-skinning.js";
import { buildSoftSkinMeshCPU } from "./soft-skin.js";
import { findHeadBoneIndex, loadHeadMesh } from "./head.js";
import { disposeObject3D } from "../distance-streaming.js";

export type CharacterCaches = {
  binary: BinaryCache;
  textures: Map<string, THREE.DataTexture>;
  materials: Map<string, THREE.Material>;
  animations: AnimationCache;
};

export type CharacterInstance = {
  object: THREE.Group;
  update: (deltaSeconds: number) => void;
  setAnimation: (
    animationName: string,
    options?: {
      modelName?: string;
      loop?: boolean;
      resetTime?: boolean;
      fallbackNames?: string[];
      blendInMs?: number;
      blendOutMs?: number;
      next?: {
        animationName: string;
        modelName?: string;
        loop?: boolean;
        resetTime?: boolean;
        fallbackNames?: string[];
        blendInMs?: number;
        blendOutMs?: number;
      };
    },
  ) => void;
  dispose: () => void;
};

export function __blendAnimWorld(
  prevWorld: THREE.Matrix4[],
  currWorld: THREE.Matrix4[],
  t: number,
  outWorld: THREE.Matrix4[] = [],
  temps?: {
    pos0: THREE.Vector3;
    pos1: THREE.Vector3;
    quat0: THREE.Quaternion;
    quat1: THREE.Quaternion;
    scale0: THREE.Vector3;
    scale1: THREE.Vector3;
  },
): THREE.Matrix4[] {
  const count = Math.min(prevWorld.length, currWorld.length);
  if (count === 0) return outWorld;
  const pos0 = temps?.pos0 ?? new THREE.Vector3();
  const pos1 = temps?.pos1 ?? new THREE.Vector3();
  const quat0 = temps?.quat0 ?? new THREE.Quaternion();
  const quat1 = temps?.quat1 ?? new THREE.Quaternion();
  const scale0 = temps?.scale0 ?? new THREE.Vector3(1, 1, 1);
  const scale1 = temps?.scale1 ?? new THREE.Vector3(1, 1, 1);

  for (let i = 0; i < count; i++) {
    const prev = prevWorld[i];
    const curr = currWorld[i];
    if (!prev || !curr) continue;
    prev.decompose(pos0, quat0, scale0);
    curr.decompose(pos1, quat1, scale1);
    const pos = pos0.lerp(pos1, t);
    const quat = quat0.slerp(quat1, t);
    const scale = scale0.lerp(scale1, t);
    const world = outWorld[i] ?? (outWorld[i] = new THREE.Matrix4());
    world.compose(pos, quat, scale);
  }

  return outWorld;
}

export async function createHumanoidCharacterInstance(params: {
  zenKit: ZenKit;
  caches: CharacterCaches;
  parent: THREE.Object3D;
  animationName?: string;
  loop?: boolean;
  mirrorX?: boolean;
  rootMotion?: boolean;
  applyRootMotion?: boolean;
  rootMotionTarget?: "self" | "parent";
  align?: "center" | "ground";
  bodyMesh?: string;
  bodyTex?: number;
  skin?: number;
  headMesh?: string;
  headTex?: number;
  teethTex?: number;
  armorInst?: number;
}): Promise<CharacterInstance | null> {
  const {
    zenKit,
    caches,
    parent,
    animationName = "t_dance_01",
    loop = true,
    mirrorX = true,
    rootMotion = true,
    applyRootMotion = true,
    rootMotionTarget = "parent",
    align = "ground",
    bodyMesh,
    bodyTex = 0,
    skin = 0,
    headMesh,
    headTex = 0,
    teethTex = 0,
    armorInst: _armorInst = -1,
  } = params;
  void _armorInst;

  const root = new THREE.Group();
  root.name = "npc-character";
  parent.add(root);

  const group = new THREE.Group();
  group.name = "npc-character-model";
  root.add(group);

  try {
    const mdhPath = `/ANIMS/_COMPILED/HUMANS.MDH`;
    const normalizedBodyMesh = (bodyMesh || "HUM_BODY_NAKED0")
      .replace(/\.(ASC|MDM|MDH|MDL)$/i, "")
      .toUpperCase();
    if (!normalizedBodyMesh.startsWith("HUM_")) {
      return null;
    }
    const mdmPath = `/ANIMS/_COMPILED/${normalizedBodyMesh}.MDM`;

    const mdhBytes = await fetchBinaryCached(mdhPath, caches.binary);
    const mdmBytes = await fetchBinaryCached(mdmPath, caches.binary);

    const hierarchyLoader = zenKit.createModelHierarchyLoader();
    const mdhLoadResult = hierarchyLoader.loadFromArray(mdhBytes);
    if (!mdhLoadResult || !mdhLoadResult.success) return null;

    const meshLoader = zenKit.createModelMeshLoader();
    const mdmLoadResult = meshLoader.loadFromArray(mdmBytes);
    if (!mdmLoadResult || !mdmLoadResult.success) return null;

    const model = zenKit.createModel();
    model.setHierarchy(hierarchyLoader.getHierarchy());
    model.setMesh(meshLoader.getMesh());

    const hierarchy = model.getHierarchy();
    const skeleton = buildSkeletonFromHierarchy(hierarchy);

    // Add bones to scene graph so attachments (like head) can be parented to them.
    for (const rootIdx of skeleton.rootNodes) {
      group.add(skeleton.bones[rootIdx]);
    }

    const softSkinMeshes = model.getSoftSkinMeshes();
    const softSkinCount = softSkinMeshes ? softSkinMeshes.size() : 0;
    if (softSkinCount === 0) return null;

    const skinningDataList: CpuSkinningData[] = [];

    for (let i = 0; i < softSkinCount; i++) {
      const softSkinMesh = softSkinMeshes.get(i);
      if (!softSkinMesh) continue;

      const { mesh, skinningData } = await buildSoftSkinMeshCPU({
        zenKit,
        softSkinMesh,
        bindWorld: skeleton.bindWorld,
        textureCache: caches.textures,
        textureOverride: (name: string) => {
          const upper = (name || "").toUpperCase();
          if (!upper.includes("BODY")) return name;
          return upper.replace(/_V\d+/g, `_V${bodyTex}`).replace(/_C\d+/g, `_C${skin}`);
        },
      });

      skinningDataList.push(skinningData);
      group.add(mesh);
    }

    // Try to load and attach head mesh (MMB) to the head bone
    const nodeNames = skeleton.nodes.map((n) => n.name);
    const headNodeIndex = findHeadBoneIndex(nodeNames);
    const requestedHeadName = headMesh ? headMesh.trim() : "";
    if (headNodeIndex >= 0 && headNodeIndex < skeleton.bones.length) {
      const headMesh = await loadHeadMesh({
        zenKit,
        binaryCache: caches.binary,
        textureCache: caches.textures,
        materialCache: caches.materials,
        headNames: requestedHeadName ? [requestedHeadName] : undefined,
        headTex,
        skin,
        teethTex,
      });
      if (headMesh) {
        skeleton.bones[headNodeIndex].add(headMesh);
      }
    } else {
      const headMeshObj = await loadHeadMesh({
        zenKit,
        binaryCache: caches.binary,
        textureCache: caches.textures,
        materialCache: caches.materials,
        headNames: requestedHeadName ? [requestedHeadName] : undefined,
        headTex,
        skin,
        teethTex,
      });
      if (headMeshObj) {
        group.add(headMeshObj);
      }
    }

    if (mirrorX) {
      group.scale.x = -Math.abs(group.scale.x || 1);
    }

    // IMPORTANT: Box3.setFromObject() operates in world space. Since `group` is already parented
    // (e.g. under an NPC positioned in the world), we must convert the computed world offset back
    // to this group's local space before applying it, otherwise the character jumps away.
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const offsetWorld =
      align === "ground" ? new THREE.Vector3(center.x, box.min.y, center.z) : center.clone();
    const offsetLocal = group.worldToLocal(offsetWorld.clone());
    group.position.sub(offsetLocal);

    const sequence = await loadAnimationSequence(
      zenKit,
      caches.binary,
      caches.animations,
      "HUMANS",
      animationName,
    );
    let currentSequence = sequence;
    let currentAnimationName = animationName;
    let currentModelName = "HUMANS";
    let currentLoop = loop;
    let currentTimeMs = 0;
    let globalTimeMs = 0;
    const failedAnis = new Set<string>();
    let pendingLoad: {
      modelName: string;
      name: string;
      loop: boolean;
      resetTime: boolean;
      fallbackNames?: string[];
      blendInMs?: number;
      blendOutMs?: number;
    } | null = null;
    let loadingPromise: Promise<void> | null = null;
    let nextAfterNonLoop: {
      animationName: string;
      modelName: string;
      loop: boolean;
      resetTime: boolean;
      fallbackNames?: string[];
      blendInMs?: number;
      blendOutMs?: number;
    } | null = null;
    const rootMotionPos = new THREE.Vector3();
    const lastRootMotionPos = new THREE.Vector3();
    const rootMotionDelta = new THREE.Vector3();
    let hasLastRootMotionPos = false;
    let lastPoseTimeMs = 0;
    let blendFromWorld: THREE.Matrix4[] | null = null;
    let blendStartMs = 0;
    let blendDurationMs = 0;
    const blendedAnimWorld: THREE.Matrix4[] = [];
    const blendedAnimLocal: THREE.Matrix4[] = [];
    const tmpPos0 = new THREE.Vector3();
    const tmpPos1 = new THREE.Vector3();
    const tmpQuat0 = new THREE.Quaternion();
    const tmpQuat1 = new THREE.Quaternion();
    const tmpScale0 = new THREE.Vector3();
    const tmpScale1 = new THREE.Vector3();
    const tmpMat = new THREE.Matrix4();

    const startBlendFromCurrentPose = (
      blendMs: number,
      meta?: { name?: string; model?: string },
    ) => {
      const dur = Math.max(0, blendMs);
      if (dur <= 0) {
        blendFromWorld = null;
        blendDurationMs = 0;
        return;
      }
      if (!skeleton.animWorld || skeleton.animWorld.length === 0) {
        blendFromWorld = null;
        blendDurationMs = 0;
        return;
      }
      blendFromWorld = skeleton.animWorld.map((m) => m.clone());
      blendStartMs = globalTimeMs;
      blendDurationMs = dur;
      void meta;
    };

    const applyBlendToSkeleton = (t: number) => {
      if (!blendFromWorld || blendFromWorld.length === 0 || !skeleton.animWorld) return;
      __blendAnimWorld(blendFromWorld, skeleton.animWorld, t, blendedAnimWorld, {
        pos0: tmpPos0,
        pos1: tmpPos1,
        quat0: tmpQuat0,
        quat1: tmpQuat1,
        scale0: tmpScale0,
        scale1: tmpScale1,
      });
      skeleton.animWorld = blendedAnimWorld;

      if (skeleton.bones && skeleton.bones.length === skeleton.animWorld.length) {
        for (let i = 0; i < skeleton.bones.length; i++) {
          const bone = skeleton.bones[i];
          const parentIdx = skeleton.nodes[i].parent;
          const local = blendedAnimLocal[i] ?? (blendedAnimLocal[i] = new THREE.Matrix4());
          if (parentIdx >= 0) {
            const parentWorld = skeleton.animWorld[parentIdx];
            tmpMat.copy(parentWorld).invert().multiply(skeleton.animWorld[i]);
            local.copy(tmpMat);
          } else {
            local.copy(skeleton.animWorld[i]);
          }
          local.decompose(tmpPos0, tmpQuat0, tmpScale0);
          bone.position.copy(tmpPos0);
          bone.quaternion.copy(tmpQuat0);
          bone.scale.copy(tmpScale0);
        }

        if (skeleton.rootNodes) {
          for (const rootIdx of skeleton.rootNodes) {
            skeleton.bones[rootIdx].updateMatrixWorld(true);
          }
        }
      }
    };

    const ensureLoaderRunning = () => {
      if (loadingPromise) return;
      loadingPromise = (async () => {
        while (pendingLoad) {
          const next = pendingLoad;
          pendingLoad = null;

          const candidates = [next.name, ...(next.fallbackNames || [])].filter(Boolean);
          let loaded: { seq: any; name: string } | null = null;

          for (const cand of candidates) {
            const key = cand.toUpperCase();
            if (failedAnis.has(key)) continue;
            const seq = await loadAnimationSequence(
              zenKit,
              caches.binary,
              caches.animations,
              next.modelName,
              cand,
            );
            if (seq) {
              loaded = { seq, name: cand };
              break;
            }
            failedAnis.add(key);
          }

          if (loaded) {
            const rawBlendMs = Math.max(0, Math.max(next.blendInMs ?? 0, next.blendOutMs ?? 0));
            const blendMs = rawBlendMs;
            if (blendMs > 0) {
              startBlendFromCurrentPose(blendMs, { name: loaded.name, model: next.modelName });
            }
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

    const tryLoadAnimation = (req: {
      modelName: string;
      name: string;
      loop: boolean;
      resetTime: boolean;
      fallbackNames?: string[];
      blendInMs?: number;
      blendOutMs?: number;
    }) => {
      const names = [req.name, ...(req.fallbackNames || [])].filter(Boolean);
      for (const n of names) failedAnis.delete(n.toUpperCase());
      pendingLoad = req;
      ensureLoaderRunning();
    };

    const setAnimation: CharacterInstance["setAnimation"] = (nextName, options) => {
      const name = (nextName || "").trim();
      if (!name) return;
      const nextModel =
        (options?.modelName || currentModelName || "HUMANS").trim().toUpperCase() || "HUMANS";
      const nextLoop = options?.loop ?? currentLoop;
      const resetTime = options?.resetTime ?? false;

      if (
        name.toUpperCase() === (currentAnimationName || "").toUpperCase() &&
        nextModel === currentModelName
      ) {
        currentLoop = nextLoop;
        if (resetTime) currentTimeMs = 0;
        if (currentLoop) nextAfterNonLoop = null;
        return;
      }

      if (!nextLoop && options?.next) {
        nextAfterNonLoop = {
          animationName: options.next.animationName,
          modelName:
            (options.next.modelName || nextModel || "HUMANS").trim().toUpperCase() || "HUMANS",
          loop: options.next.loop ?? true,
          resetTime: options.next.resetTime ?? true,
          fallbackNames: options.next.fallbackNames,
          blendInMs: options.next.blendInMs,
          blendOutMs: options.next.blendOutMs,
        };
      } else {
        nextAfterNonLoop = null;
      }

      tryLoadAnimation({
        modelName: nextModel,
        name,
        loop: nextLoop,
        resetTime,
        fallbackNames: options?.fallbackNames,
        blendInMs: options?.blendInMs,
        blendOutMs: options?.blendOutMs,
      });
    };

    const update = (deltaSeconds: number) => {
      if (!currentSequence) return;
      globalTimeMs += deltaSeconds * 1000;
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
          blendInMs: next.blendInMs,
          blendOutMs: next.blendOutMs,
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

        root.userData.__rootMotionDelta = {
          x: rootMotionDelta.x,
          y: rootMotionDelta.y,
          z: rootMotionDelta.z,
        };
      } else {
        root.userData.__rootMotionDelta = { x: 0, y: 0, z: 0 };
      }

      if (blendFromWorld && blendDurationMs > 0) {
        const elapsed = globalTimeMs - blendStartMs;
        if (elapsed < blendDurationMs) {
          const t = Math.max(0, Math.min(1, elapsed / blendDurationMs));
          applyBlendToSkeleton(t);
        } else {
          blendFromWorld = null;
          blendDurationMs = 0;
        }
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
    return { object: root, update, setAnimation, dispose };
  } catch (error) {
    console.warn("Failed to create character instance:", error);
    parent.remove(root);
    disposeObject3D(root);
    return null;
  }
}

// Backwards-compatible alias (older import name).
export const createHumanCharacterInstance = createHumanoidCharacterInstance;
