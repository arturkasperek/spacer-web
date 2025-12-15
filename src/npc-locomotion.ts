import type { CharacterInstance } from "./character/human-character.js";

export type LocomotionState = "idle" | "walking";

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
};

export type LocomotionController = {
  update: (instance: CharacterInstance, isMoving: boolean) => void;
};

export function createLocomotionController(spec: LocomotionSpec): LocomotionController {
  let initialized = false;
  let wasMoving = false;

  const play = (instance: CharacterInstance, anim: LocomotionAnimationSpec, next?: LocomotionAnimationSpec) => {
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
    update: (instance, isMoving) => {
      if (!initialized) {
        initialized = true;
        wasMoving = isMoving;
        if (isMoving) play(instance, spec.walkStart, spec.walkLoop);
        else play(instance, spec.idle);
        return;
      }

      if (isMoving && !wasMoving) {
        // TODO: extend for multiple locomotion modes (run/sneak/swim) and blending between them.
        play(instance, spec.walkStart, spec.walkLoop);
      } else if (!isMoving && wasMoving) {
        play(instance, spec.walkStop, spec.idle);
      }

      wasMoving = isMoving;
    },
  };
}

export const HUMAN_LOCOMOTION_SPEC: LocomotionSpec = {
  // Notes from HumanS.mds:
  // - walk start: t_Walk_2_WalkL -> s_WalkL
  // - walk stop:  t_WalkL_2_Walk -> s_Run (idle/breath)
  idle: { name: "s_Run", loop: true, fallbackNames: ["t_dance_01"] },
  walkStart: { name: "t_Walk_2_WalkL", loop: false, fallbackNames: ["s_WalkL"] },
  walkLoop: { name: "s_WalkL", loop: true, fallbackNames: ["s_RunL", "s_Run"] },
  walkStop: { name: "t_WalkL_2_Walk", loop: false, fallbackNames: ["s_Run"] },
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
  return Array.from(new Set(out.map(s => (s || "").trim()).filter(Boolean)));
}

export const HUMAN_LOCOMOTION_PRELOAD_ANIS = collectLocomotionAnimationNames(HUMAN_LOCOMOTION_SPEC);

export function createHumanLocomotionController(): LocomotionController {
  return createLocomotionController(HUMAN_LOCOMOTION_SPEC);
}
