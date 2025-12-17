import type { CharacterInstance } from "./character/human-character.js";

export type LocomotionMode = "idle" | "walk" | "run" | "slide" | "slideBack" | "fallDown" | "fall" | "fallBack";

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
  update: (instance: CharacterInstance, mode: LocomotionMode) => void;
};

export function createLocomotionController(spec: LocomotionSpec): LocomotionController {
  let initialized = false;
  let lastMode: LocomotionMode = "idle";

  const play = (instance: CharacterInstance, anim: LocomotionAnimationSpec, next?: LocomotionAnimationSpec) => {
    (instance as any).__debugLocomotionRequested = {
      name: anim.name,
      loop: anim.loop,
      next: next ? { name: next.name, loop: next.loop } : null,
      atMs: Date.now(),
    };
    instance.setAnimation(anim.name, {
      loop: anim.loop,
      resetTime: true,
      fallbackNames: anim.fallbackNames,
      next: next
        ? {
            animationName: next.name,
            loop: next.loop,
            resetTime: true,
            fallbackNames: next.fallbackNames,
          }
        : undefined,
    });
  };

  return {
    update: (instance, mode) => {
      if (!initialized) {
        initialized = true;
        lastMode = mode;
        if (mode === "walk") play(instance, spec.walkStart, spec.walkLoop);
        else if (mode === "run") play(instance, spec.runStart, spec.runLoop);
        else if (mode === "slide") play(instance, spec.slide);
        else if (mode === "slideBack") play(instance, spec.slideBack);
        else if (mode === "fallDown") play(instance, spec.fallDown);
        else if (mode === "fall") play(instance, spec.fall);
        else if (mode === "fallBack") play(instance, spec.fallBack);
        else play(instance, spec.idle);
        return;
      }

      if (mode === lastMode) return;

      if (mode === "walk") {
        play(instance, spec.walkStart, spec.walkLoop);
      } else if (mode === "run") {
        play(instance, spec.runStart, spec.runLoop);
      } else if (mode === "slide") {
        play(instance, spec.slide);
      } else if (mode === "slideBack") {
        play(instance, spec.slideBack);
      } else if (mode === "fallDown") {
        play(instance, spec.fallDown);
      } else if (mode === "fall") {
        play(instance, spec.fall);
      } else if (mode === "fallBack") {
        play(instance, spec.fallBack);
      } else {
        if (lastMode === "walk") play(instance, spec.walkStop, spec.idle);
        else if (lastMode === "run") play(instance, spec.runStop, spec.idle);
        else play(instance, spec.idle);
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

  runStart: { name: "t_Run_2_RunL", loop: false, fallbackNames: ["s_RunL"] },
  runLoop: { name: "s_RunL", loop: true, fallbackNames: ["s_Run"] },
  runStop: { name: "t_RunL_2_Run", loop: false, fallbackNames: ["s_Run"] },

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
  push(spec.runStart);
  push(spec.runLoop);
  push(spec.runStop);
  push(spec.slide);
  push(spec.slideBack);
  push(spec.fallDown);
  push(spec.fall);
  push(spec.fallBack);
  return Array.from(new Set(out.map(s => (s || "").trim()).filter(Boolean)));
}

export const HUMAN_LOCOMOTION_PRELOAD_ANIS = collectLocomotionAnimationNames(HUMAN_LOCOMOTION_SPEC);

export function createHumanLocomotionController(): LocomotionController {
  return createLocomotionController(HUMAN_LOCOMOTION_SPEC);
}
