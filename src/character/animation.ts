import * as THREE from "three";
import type { ZenKit } from "@kolarz3/zenkit";
import type { BinaryCache } from "./binary-cache.js";
import { fetchBinaryCached } from "./binary-cache.js";

export type AnimationSample = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
};

export type AnimationSequence = {
  name: string;
  samples: AnimationSample[];
  nodeIndex: number[];
  numFrames: number;
  fpsRate: number;
  totalTimeMs: number;
};

export type AnimationCache = Map<string, AnimationSequence>;

export type EvaluatePoseOptions = {
  extractRootMotion?: boolean;
  rootNodeIndex?: number;
  outRootMotionPos?: THREE.Vector3;
};

export async function preloadAnimationSequences(
  zenKit: ZenKit,
  binaryCache: BinaryCache,
  animationCache: AnimationCache,
  baseName: string,
  animationNames: string[]
): Promise<void> {
  const unique = Array.from(
    new Set(
      (animationNames || [])
        .map(s => (s || "").trim())
        .filter(Boolean)
        .map(s => s.toUpperCase())
    )
  );

  await Promise.allSettled(unique.map(name => loadAnimationSequence(zenKit, binaryCache, animationCache, baseName, name)));
}

export async function loadAnimationSequence(
  zenKit: ZenKit,
  binaryCache: BinaryCache,
  animationCache: AnimationCache,
  baseName: string,
  animationName: string
): Promise<AnimationSequence | null> {
  const cacheKey = `${baseName.toUpperCase()}:${animationName.toUpperCase()}`;
  const cached = animationCache.get(cacheKey);
  if (cached) return cached;

  const manFileName = `${baseName}-${animationName}.MAN`.toUpperCase();
  const manPath = `/ANIMS/_COMPILED/${manFileName}`;

  let bytes: Uint8Array;
  try {
    bytes = await fetchBinaryCached(manPath, binaryCache);
  } catch {
    return null;
  }

  const man = zenKit.createModelAnimation();
  const loadResult = man.loadFromArray(bytes);
  if (!loadResult.success) return null;

  const numFrames = man.getFrameCount ? man.getFrameCount() : 0;
  const fpsRate = man.getFps ? man.getFps() : 25.0;
  const nodeIdxCount = man.getNodeCount ? man.getNodeCount() : 0;
  if (numFrames <= 0 || fpsRate <= 0 || nodeIdxCount <= 0) return null;

  const nodeIndex: number[] = [];
  for (let i = 0; i < nodeIdxCount; i++) {
    nodeIndex.push(man.getNodeIndex(i));
  }

  const samples: AnimationSample[] = [];
  for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
    for (let nodeIdx = 0; nodeIdx < nodeIdxCount; nodeIdx++) {
      const sample = man.getSample(frameIdx, nodeIdx);
      if (sample && sample.position && sample.rotation) {
        samples.push({
          position: { x: sample.position.x, y: sample.position.y, z: sample.position.z },
          rotation: { x: sample.rotation.x, y: sample.rotation.y, z: sample.rotation.z, w: sample.rotation.w },
        });
      } else {
        samples.push({
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        });
      }
    }
  }

  const seq: AnimationSequence = {
    name: animationName,
    samples,
    nodeIndex,
    numFrames,
    fpsRate,
    totalTimeMs: (numFrames * 1000.0) / fpsRate,
  };

  animationCache.set(cacheKey, seq);
  return seq;
}

export function evaluatePose(
  skeleton: { nodes: Array<{ parent: number }>; bindLocal: THREE.Matrix4[]; animWorld: THREE.Matrix4[]; bones?: THREE.Bone[]; rootNodes?: number[] },
  sequence: AnimationSequence,
  nowMs: number,
  loop: boolean,
  options?: EvaluatePoseOptions
): boolean {
  const nodeCount = skeleton.nodes.length;
  const nodeIndexCount = sequence.nodeIndex.length;
  if (nodeCount === 0 || nodeIndexCount === 0 || sequence.totalTimeMs <= 0) return false;

  const extractRootMotion = Boolean(options?.extractRootMotion);
  const rootNodeIndex = options?.rootNodeIndex ?? skeleton.rootNodes?.[0] ?? 0;
  if (extractRootMotion && options?.outRootMotionPos) options.outRootMotionPos.set(0, 0, 0);

  const timeMs = loop ? ((nowMs % sequence.totalTimeMs) + sequence.totalTimeMs) % sequence.totalTimeMs : Math.max(0, Math.min(sequence.totalTimeMs, nowMs));
  const frameFloat = (timeMs / 1000.0) * sequence.fpsRate;
  const frame0 = Math.max(0, Math.min(sequence.numFrames - 1, Math.floor(frameFloat))) % sequence.numFrames;
  const frame1 = loop ? ((frame0 + 1) % sequence.numFrames) : Math.min(sequence.numFrames - 1, frame0 + 1);
  const t = frameFloat - Math.floor(frameFloat);

  const animLocal: THREE.Matrix4[] = new Array(nodeCount);
  const animWorld: THREE.Matrix4[] = new Array(nodeCount);

  for (let i = 0; i < nodeCount; i++) {
    animLocal[i] = skeleton.bindLocal[i].clone();
  }

  for (let i = 0; i < nodeIndexCount; i++) {
    const nodeId = sequence.nodeIndex[i];
    if (nodeId < 0 || nodeId >= nodeCount) continue;

    const s0 = sequence.samples[frame0 * nodeIndexCount + i];
    const s1 = sequence.samples[frame1 * nodeIndexCount + i];
    if (!s0 || !s1) continue;

    const p0 = new THREE.Vector3(s0.position.x, s0.position.y, s0.position.z);
    const p1 = new THREE.Vector3(s1.position.x, s1.position.y, s1.position.z);
    const pos = p0.lerp(p1, t);

    let q0 = new THREE.Quaternion(s0.rotation.x, s0.rotation.y, s0.rotation.z, s0.rotation.w);
    let q1 = new THREE.Quaternion(s1.rotation.x, s1.rotation.y, s1.rotation.z, s1.rotation.w);

    // Gothic (LH) -> Three.js (RH): conjugate quaternion
    q0 = new THREE.Quaternion(-q0.x, -q0.y, -q0.z, q0.w);
    q1 = new THREE.Quaternion(-q1.x, -q1.y, -q1.z, q1.w);

    const rot = q0.slerp(q1, t).normalize();

    if (extractRootMotion && nodeId === rootNodeIndex) {
      if (options?.outRootMotionPos) options.outRootMotionPos.copy(pos);
      const bind = skeleton.bindLocal[nodeId];
      const bindPos = new THREE.Vector3(bind.elements[12], bind.elements[13], bind.elements[14]);
      // Keep the animation's vertical offset on the root node so poses like kneeling/crouching don't appear to
      // "float" when we extract horizontal root motion for moving the VOB/NPC.
      // Gothic MAN root samples are effectively offsets relative to the bind pose, so keep bind translation and
      // apply only the animated Y delta here (relative to the first frame baseline).
      const base = sequence.samples[i];
      const baseY = base ? base.position.y : 0;
      animLocal[nodeId] = new THREE.Matrix4().compose(
        new THREE.Vector3(bindPos.x, bindPos.y + (pos.y - baseY), bindPos.z),
        rot,
        new THREE.Vector3(1, 1, 1)
      );
    } else {
      animLocal[nodeId] = new THREE.Matrix4().compose(pos, rot, new THREE.Vector3(1, 1, 1));
    }
  }

  for (let i = 0; i < nodeCount; i++) {
    const parentIdx = skeleton.nodes[i].parent;
    if (parentIdx >= 0) {
      animWorld[i] = new THREE.Matrix4().multiplyMatrices(animWorld[parentIdx], animLocal[i]);
    } else {
      animWorld[i] = animLocal[i].clone();
    }
  }

  if (skeleton.bones && skeleton.bones.length === nodeCount) {
    for (let i = 0; i < nodeCount; i++) {
      const bone = skeleton.bones[i];
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      animLocal[i].decompose(pos, quat, scl);
      bone.position.copy(pos);
      bone.quaternion.copy(quat);
      bone.scale.copy(scl);
    }

    if (skeleton.rootNodes) {
      for (const rootIdx of skeleton.rootNodes) {
        skeleton.bones[rootIdx].updateMatrixWorld(true);
      }
    }
  }

  skeleton.animWorld = animWorld;
  return true;
}
