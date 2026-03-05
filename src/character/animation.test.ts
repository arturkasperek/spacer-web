import type { ZenKit } from "@kolarz3/zenkit";
import { loadAnimationSequence } from "./animation";

describe("loadAnimationSequence", () => {
  const mockLoadAnimationData = jest.fn();
  const makeAssetManager = () =>
    ({
      loadAnimationData: mockLoadAnimationData,
      animationCache: new Map<string, any>(),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads, parses, and caches animation sequence", async () => {
    mockLoadAnimationData.mockResolvedValue({
      numFrames: 2,
      fpsRate: 10,
      nodeIndex: [0],
      samples: [
        { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        { position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      ],
    });

    const zenKit = {} as unknown as ZenKit;

    const assetManager = makeAssetManager();

    const seq1 = await loadAnimationSequence(zenKit, assetManager, "humans", "t_walk");
    const seq2 = await loadAnimationSequence(zenKit, assetManager, "humans", "t_walk");

    expect(seq1).not.toBeNull();
    expect(seq1).toBe(seq2);
    expect(seq1?.numFrames).toBe(2);
    expect(seq1?.fpsRate).toBe(10);
    expect(seq1?.totalTimeMs).toBe(200);
    expect(mockLoadAnimationData).toHaveBeenCalledTimes(1);
  });

  it("returns null when MAN file fetch fails", async () => {
    mockLoadAnimationData.mockResolvedValue(null);
    const zenKit = {} as unknown as ZenKit;

    const seq = await loadAnimationSequence(zenKit, makeAssetManager(), "humans", "missing");
    expect(seq).toBeNull();
  });

  it("skips MAN fetch when precheck says animation is unavailable", async () => {
    const zenKit = {
      createModelAnimation: jest.fn(),
    } as unknown as ZenKit;

    const seq = await loadAnimationSequence(zenKit, makeAssetManager(), "GIANT_BUG", "S_STAND", {
      canLoadAnimation: () => false,
    });
    expect(seq).toBeNull();
    expect(mockLoadAnimationData).not.toHaveBeenCalled();
  });
});
