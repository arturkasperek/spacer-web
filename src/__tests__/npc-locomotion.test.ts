import { createLocomotionController } from "../npc-locomotion";

describe("npc locomotion controller", () => {
  it("plays walk start->loop when movement begins, and walk stop->idle when movement ends", () => {
    const controller = createLocomotionController({
      idle: { name: "IDLE", loop: true },
      walkStart: { name: "WALK_START", loop: false },
      walkLoop: { name: "WALK_LOOP", loop: true },
      walkStop: { name: "WALK_STOP", loop: false },
    });

    const setAnimation = jest.fn();
    const instance: any = { setAnimation };

    controller.update(instance, false);
    expect(setAnimation).toHaveBeenCalledWith("IDLE", expect.objectContaining({ loop: true }));

    controller.update(instance, true);
    expect(setAnimation).toHaveBeenCalledWith(
      "WALK_START",
      expect.objectContaining({
        loop: false,
        next: expect.objectContaining({ animationName: "WALK_LOOP", loop: true }),
      })
    );

    controller.update(instance, false);
    expect(setAnimation).toHaveBeenCalledWith(
      "WALK_STOP",
      expect.objectContaining({
        loop: false,
        next: expect.objectContaining({ animationName: "IDLE", loop: true }),
      })
    );
  });
});

