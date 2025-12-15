import { createLocomotionController } from "../npc-locomotion";

describe("npc locomotion controller", () => {
  it("plays walk start->loop when walk begins, and walk stop->idle when walk ends", () => {
    const controller = createLocomotionController({
      idle: { name: "IDLE", loop: true },
      walkStart: { name: "WALK_START", loop: false },
      walkLoop: { name: "WALK_LOOP", loop: true },
      walkStop: { name: "WALK_STOP", loop: false },
      runStart: { name: "RUN_START", loop: false },
      runLoop: { name: "RUN_LOOP", loop: true },
      runStop: { name: "RUN_STOP", loop: false },
    });

    const setAnimation = jest.fn();
    const instance: any = { setAnimation };

    controller.update(instance, "idle");
    expect(setAnimation).toHaveBeenCalledWith("IDLE", expect.objectContaining({ loop: true }));

    controller.update(instance, "walk");
    expect(setAnimation).toHaveBeenCalledWith(
      "WALK_START",
      expect.objectContaining({
        loop: false,
        next: expect.objectContaining({ animationName: "WALK_LOOP", loop: true }),
      })
    );

    controller.update(instance, "idle");
    expect(setAnimation).toHaveBeenCalledWith(
      "WALK_STOP",
      expect.objectContaining({
        loop: false,
        next: expect.objectContaining({ animationName: "IDLE", loop: true }),
      })
    );
  });

  it("plays run start->loop when run begins, and run stop->idle when run ends", () => {
    const controller = createLocomotionController({
      idle: { name: "IDLE", loop: true },
      walkStart: { name: "WALK_START", loop: false },
      walkLoop: { name: "WALK_LOOP", loop: true },
      walkStop: { name: "WALK_STOP", loop: false },
      runStart: { name: "RUN_START", loop: false },
      runLoop: { name: "RUN_LOOP", loop: true },
      runStop: { name: "RUN_STOP", loop: false },
    });

    const setAnimation = jest.fn();
    const instance: any = { setAnimation };

    controller.update(instance, "idle");
    controller.update(instance, "run");
    expect(setAnimation).toHaveBeenCalledWith(
      "RUN_START",
      expect.objectContaining({
        loop: false,
        next: expect.objectContaining({ animationName: "RUN_LOOP", loop: true }),
      })
    );

    controller.update(instance, "idle");
    expect(setAnimation).toHaveBeenCalledWith(
      "RUN_STOP",
      expect.objectContaining({
        loop: false,
        next: expect.objectContaining({ animationName: "IDLE", loop: true }),
      })
    );
  });

  it("switches between walk and run without playing stop animations", () => {
    const controller = createLocomotionController({
      idle: { name: "IDLE", loop: true },
      walkStart: { name: "WALK_START", loop: false },
      walkLoop: { name: "WALK_LOOP", loop: true },
      walkStop: { name: "WALK_STOP", loop: false },
      runStart: { name: "RUN_START", loop: false },
      runLoop: { name: "RUN_LOOP", loop: true },
      runStop: { name: "RUN_STOP", loop: false },
    });

    const setAnimation = jest.fn();
    const instance: any = { setAnimation };

    controller.update(instance, "idle");
    controller.update(instance, "walk");
    controller.update(instance, "run");
    controller.update(instance, "walk");

    const calls = setAnimation.mock.calls.map(c => c[0]);
    expect(calls).toContain("WALK_START");
    expect(calls).toContain("RUN_START");
    expect(calls).not.toContain("WALK_STOP");
    expect(calls).not.toContain("RUN_STOP");
  });
});
