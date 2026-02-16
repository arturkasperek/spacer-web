import type { CharacterInstance } from "../../character/character-instance";

export type LocomotionMode =
  | "idle"
  | "walk"
  | "walkBack"
  | "run"
  | "slide"
  | "slideBack"
  | "fallDown"
  | "fall"
  | "fallBack";

export type AnimationRef = {
  animationName: string;
  modelName?: string;
  blendInMs?: number;
  blendOutMs?: number;
};

export type AnimationResolver = (animationName: string) => AnimationRef | null;

export type LocomotionAnimationSpec = {
  name: string;
  loop: boolean;
  fallbackNames?: string[];
};

export type LocomotionSpec = {
  idle: LocomotionAnimationSpec;

  walkStart: LocomotionAnimationSpec;
  walkLoop: LocomotionAnimationSpec;
  walkStop: LocomotionAnimationSpec;
  walkBackStart: LocomotionAnimationSpec;
  walkBackLoop: LocomotionAnimationSpec;
  walkBackStop: LocomotionAnimationSpec;

  runStart: LocomotionAnimationSpec;
  runLoop: LocomotionAnimationSpec;
  runStop: LocomotionAnimationSpec;

  slide: LocomotionAnimationSpec;
  slideBack: LocomotionAnimationSpec;

  fallDown: LocomotionAnimationSpec;
  fall: LocomotionAnimationSpec;
  fallBack: LocomotionAnimationSpec;
};

export type LocomotionController = {
  update: (instance: CharacterInstance, mode: LocomotionMode, resolve?: AnimationResolver) => void;
};

export function createLocomotionController(spec: LocomotionSpec): LocomotionController {
  let initialized = false;
  let lastMode: LocomotionMode = "idle";
  let lastAnimName = "";
  const FORCE_BLEND_MS = 200;
  const isFallAnim = (name: string) => {
    const n = (name || "").trim().toUpperCase();
    return (
      n === "S_FALLDN" ||
      n === "S_FALL" ||
      n === "S_FALLB" ||
      n === "T_RUNL_2_RUN" ||
      n === "T_WALKL_2_WALK"
    );
  };
  const shouldForceBlend = (name: string, prevName: string) =>
    isFallAnim(name) || isFallAnim(prevName);

  const play = (
    instance: CharacterInstance,
    anim: LocomotionAnimationSpec,
    next?: LocomotionAnimationSpec,
    resolve?: AnimationResolver,
  ) => {
    const ref = resolve?.(anim.name) ?? { animationName: anim.name };
    const nextRef = next ? (resolve?.(next.name) ?? { animationName: next.name }) : null;
    const useForcedBlend = shouldForceBlend(anim.name, lastAnimName);
    const blendInMs = useForcedBlend ? FORCE_BLEND_MS : ref.blendInMs;
    const blendOutMs = useForcedBlend ? FORCE_BLEND_MS : ref.blendOutMs;
    (instance as any).__debugLocomotionRequested = {
      name: anim.name,
      loop: anim.loop,
      next: next ? { name: next.name, loop: next.loop } : null,
      atMs: Date.now(),
    };
    instance.setAnimation(ref.animationName, {
      modelName: ref.modelName,
      loop: anim.loop,
      resetTime: true,
      fallbackNames: anim.fallbackNames,
      blendInMs,
      blendOutMs,
      next: next
        ? {
            animationName: nextRef?.animationName ?? next.name,
            modelName: nextRef?.modelName,
            loop: next.loop,
            resetTime: true,
            fallbackNames: next.fallbackNames,
            blendInMs: useForcedBlend ? FORCE_BLEND_MS : nextRef?.blendInMs,
            blendOutMs: useForcedBlend ? FORCE_BLEND_MS : nextRef?.blendOutMs,
          }
        : undefined,
    });
    lastAnimName = anim.name;
  };

  return {
    update: (instance, mode, resolve) => {
      if (!initialized) {
        initialized = true;
        lastMode = mode;
        if (mode === "walk") play(instance, spec.walkStart, spec.walkLoop, resolve);
        else if (mode === "walkBack")
          play(instance, spec.walkBackStart, spec.walkBackLoop, resolve);
        else if (mode === "run") play(instance, spec.runStart, spec.runLoop, resolve);
        else if (mode === "slide") play(instance, spec.slide, undefined, resolve);
        else if (mode === "slideBack") play(instance, spec.slideBack, undefined, resolve);
        else if (mode === "fallDown") play(instance, spec.fallDown, undefined, resolve);
        else if (mode === "fall") play(instance, spec.fall, undefined, resolve);
        else if (mode === "fallBack") play(instance, spec.fallBack, undefined, resolve);
        else play(instance, spec.idle, undefined, resolve);
        return;
      }

      if (mode === lastMode) return;

      if (mode === "walk") {
        play(instance, spec.walkStart, spec.walkLoop, resolve);
      } else if (mode === "walkBack") {
        play(instance, spec.walkBackStart, spec.walkBackLoop, resolve);
      } else if (mode === "run") {
        play(instance, spec.runStart, spec.runLoop, resolve);
      } else if (mode === "slide") {
        play(instance, spec.slide, undefined, resolve);
      } else if (mode === "slideBack") {
        play(instance, spec.slideBack, undefined, resolve);
      } else if (mode === "fallDown") {
        play(instance, spec.fallDown, undefined, resolve);
      } else if (mode === "fall") {
        play(instance, spec.fall, undefined, resolve);
      } else if (mode === "fallBack") {
        play(instance, spec.fallBack, undefined, resolve);
      } else {
        if (lastMode === "walk") play(instance, spec.walkStop, spec.idle, resolve);
        else if (lastMode === "walkBack") play(instance, spec.walkBackStop, spec.idle, resolve);
        else if (lastMode === "run") play(instance, spec.runStop, spec.idle, resolve);
        else play(instance, spec.idle, undefined, resolve);
      }

      lastMode = mode;
    },
  };
}

export const HUMAN_LOCOMOTION_SPEC: LocomotionSpec = {
  // Notes from HumanS.mds:
  // - walk start: t_Walk_2_WalkL -> s_WalkL
  // - walk stop:  t_WalkL_2_Walk -> s_Run (idle/breath)
  // - run start:  t_Run_2_RunL  -> s_RunL
  // - run stop:   t_RunL_2_Run  -> s_Run (idle/breath)
  // - slide:      s_Slide / s_SlideB
  // - falling:    s_FallDn, s_Fall / s_FallB
  idle: { name: "s_Run", loop: true, fallbackNames: ["t_dance_01"] },

  walkStart: { name: "t_Walk_2_WalkL", loop: false, fallbackNames: ["s_WalkL"] },
  walkLoop: { name: "s_WalkL", loop: true, fallbackNames: ["s_RunL", "s_Run"] },
  walkStop: { name: "t_WalkL_2_Walk", loop: false, fallbackNames: ["s_Run"] },
  // OpenGothic-compatible backward move uses JUMPB-family animation for HUMANS.
  walkBackStart: { name: "t_JumpB", loop: false, fallbackNames: ["s_Run"] },
  walkBackLoop: { name: "t_JumpB", loop: true, fallbackNames: ["s_Run"] },
  walkBackStop: { name: "s_Run", loop: true, fallbackNames: ["s_Run"] },

  runStart: { name: "t_Run_2_RunL", loop: false, fallbackNames: ["s_RunL"] },
  runLoop: { name: "s_RunL", loop: true, fallbackNames: ["s_Run"] },
  runStop: { name: "t_RunL_2_Run", loop: false, fallbackNames: ["s_Run"] },

  slide: { name: "s_Slide", loop: true, fallbackNames: ["s_SlideB", "s_Run"] },
  slideBack: { name: "s_SlideB", loop: true, fallbackNames: ["s_Slide", "s_Run"] },

  fallDown: { name: "s_FallDn", loop: true, fallbackNames: ["s_Fall", "s_Run"] },
  fall: { name: "s_Fall", loop: true, fallbackNames: ["s_FallB", "s_Run"] },
  fallBack: { name: "s_FallB", loop: true, fallbackNames: ["s_Fall", "s_Run"] },
};

// Creature locomotion should avoid humanoid-specific fallback probes.
// Keep candidates narrow to reduce missing MAN requests for non-human models.
export const CREATURE_LOCOMOTION_SPEC: LocomotionSpec = {
  idle: { name: "s_Run", loop: true, fallbackNames: ["s_Walk", "s_WalkL"] },

  walkStart: { name: "t_Walk_2_WalkL", loop: false, fallbackNames: ["s_WalkL", "s_Walk"] },
  walkLoop: { name: "s_WalkL", loop: true, fallbackNames: ["s_Walk", "s_RunL", "s_Run"] },
  walkStop: { name: "t_WalkL_2_Walk", loop: false, fallbackNames: ["s_Walk", "s_Run"] },
  walkBackStart: { name: "t_JumpB", loop: false, fallbackNames: ["s_Walk", "s_Run"] },
  walkBackLoop: { name: "t_JumpB", loop: true, fallbackNames: ["s_Walk", "s_Run"] },
  walkBackStop: { name: "s_Walk", loop: true, fallbackNames: ["s_Run"] },

  runStart: { name: "t_Run_2_RunL", loop: false, fallbackNames: ["s_RunL", "s_Run"] },
  runLoop: { name: "s_RunL", loop: true, fallbackNames: ["s_Run", "s_WalkL", "s_Walk"] },
  runStop: { name: "t_RunL_2_Run", loop: false, fallbackNames: ["s_Run", "s_Walk"] },

  slide: { name: "s_Slide", loop: true, fallbackNames: ["s_SlideB", "s_Run"] },
  slideBack: { name: "s_SlideB", loop: true, fallbackNames: ["s_Slide", "s_Run"] },

  fallDown: { name: "s_FallDn", loop: true, fallbackNames: ["s_Fall", "s_Run"] },
  fall: { name: "s_Fall", loop: true, fallbackNames: ["s_FallB", "s_Run"] },
  fallBack: { name: "s_FallB", loop: true, fallbackNames: ["s_Fall", "s_Run"] },
};

export function collectLocomotionAnimationNames(spec: LocomotionSpec): string[] {
  const out: string[] = [];
  const push = (a: LocomotionAnimationSpec) => {
    out.push(a.name);
    if (a.fallbackNames) out.push(...a.fallbackNames);
  };
  push(spec.idle);
  push(spec.walkStart);
  push(spec.walkLoop);
  push(spec.walkStop);
  push(spec.walkBackStart);
  push(spec.walkBackLoop);
  push(spec.walkBackStop);
  push(spec.runStart);
  push(spec.runLoop);
  push(spec.runStop);
  push(spec.slide);
  push(spec.slideBack);
  push(spec.fallDown);
  push(spec.fall);
  push(spec.fallBack);
  return Array.from(new Set(out.map((s) => (s || "").trim()).filter(Boolean)));
}

export const HUMAN_LOCOMOTION_PRELOAD_ANIS = collectLocomotionAnimationNames(HUMAN_LOCOMOTION_SPEC);

export function createHumanLocomotionController(): LocomotionController {
  return createLocomotionController(HUMAN_LOCOMOTION_SPEC);
}

export function createCreatureLocomotionController(): LocomotionController {
  return createLocomotionController(CREATURE_LOCOMOTION_SPEC);
}
