export {};

let THREE: any;
let enqueueNpcEmMessage: typeof import("../npc-em-queue").enqueueNpcEmMessage;
let requestNpcEmClear: typeof import("../npc-em-queue").requestNpcEmClear;
let updateNpcEventManager: typeof import("../npc-em-runtime").updateNpcEventManager;

describe("npc event manager runtime", () => {
  beforeAll(async () => {
    jest.resetModules();
    jest.doMock("three", () => jest.requireActual("three"));
    THREE = await import("three");
    ({ enqueueNpcEmMessage, requestNpcEmClear } = await import("../npc-em-queue"));
    ({ updateNpcEventManager } = await import("../npc-em-runtime"));
  });

  it("queues non-overlay jobs and starts the next job only after the current one completes", () => {
    const npcIndex = 123;
    const npcId = `npc-${npcIndex}`;
    const group = new THREE.Group();
    group.userData.characterInstance = {
      setAnimation: jest.fn(),
    } as any;

    const moveState = new Map<string, { done: boolean; stepsLeft: number }>();
    const mover = {
      startMoveToWaypoint: (id: string) => {
        moveState.set(id, { done: false, stepsLeft: 2 });
        return true;
      },
      update: (id: string, g: any) => {
        const st = moveState.get(id);
        if (!st || st.done) return { moved: false, mode: "idle" as const };
        st.stepsLeft -= 1;
        g.position.x += 1;
        if (st.stepsLeft <= 0) st.done = true;
        return { moved: true, mode: st.done ? ("idle" as const) : ("walk" as const) };
      },
      getMoveState: (id: string) => {
        const st = moveState.get(id);
        return st ? ({ done: st.done } as any) : null;
      },
      clearForNpc: (id: string) => {
        moveState.delete(id);
      },
    } as any;

    enqueueNpcEmMessage(npcIndex, { type: "gotoWaypoint", waypointName: "A", locomotionMode: "walk" });
    enqueueNpcEmMessage(npcIndex, { type: "playAni", animationName: "T_STAND_2_LGUARD", loop: false });

    // First tick starts the move job; animation should not start yet.
    updateNpcEventManager(npcIndex, npcId, group, 0.016, { mover, estimateAnimationDurationMs: (_model: string, _ani: string) => 500 });
    expect((group.userData.characterInstance as any).setAnimation).not.toHaveBeenCalled();

    // Finish movement (2 updates in our mock).
    updateNpcEventManager(npcIndex, npcId, group, 0.016, { mover, estimateAnimationDurationMs: (_model: string, _ani: string) => 500 });
    updateNpcEventManager(npcIndex, npcId, group, 0.016, { mover, estimateAnimationDurationMs: (_model: string, _ani: string) => 500 });

    // Next tick starts the play-ani job.
    updateNpcEventManager(npcIndex, npcId, group, 0.016, { mover, estimateAnimationDurationMs: (_model: string, _ani: string) => 500 });
    expect((group.userData.characterInstance as any).setAnimation).toHaveBeenCalledWith(
      "T_STAND_2_LGUARD",
      expect.objectContaining({ loop: false, resetTime: true })
    );
  });

  it("clears pending and active jobs on clear request", () => {
    const npcIndex = 456;
    const npcId = `npc-${npcIndex}`;
    const group = new THREE.Group();
    const clearForNpc = jest.fn();
    const mover = { clearForNpc } as any;

    enqueueNpcEmMessage(npcIndex, { type: "waitMs", durationMs: 1000 });
    updateNpcEventManager(npcIndex, npcId, group, 0.016, { mover });

    requestNpcEmClear(npcIndex);
    updateNpcEventManager(npcIndex, npcId, group, 0.016, { mover });
    expect(clearForNpc).toHaveBeenCalledWith(npcId);
  });

  it("clears locomotion suppression after a one-shot playAni completes", () => {
    const npcIndex = 789;
    const npcId = `npc-${npcIndex}`;
    const group = new THREE.Group();
    group.userData.characterInstance = {
      setAnimation: jest.fn(),
    } as any;
    (group.userData as any)._emIdleAnimation = "S_LGUARD";

    enqueueNpcEmMessage(npcIndex, { type: "playAni", animationName: "T_LGUARD_SCRATCH", loop: false });
    updateNpcEventManager(npcIndex, npcId, group, 0.016, { mover: null, estimateAnimationDurationMs: (_model: string, _ani: string) => 1000 });
    expect((group.userData as any)._emSuppressLocomotion).toBe(true);

    // Advance enough time to finish the job.
    updateNpcEventManager(npcIndex, npcId, group, 2.0, { mover: null, estimateAnimationDurationMs: (_model: string, _ani: string) => 1000 });
    expect((group.userData as any)._emSuppressLocomotion).toBeUndefined();
  });
});
