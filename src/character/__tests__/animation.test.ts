import type { ZenKit } from "@kolarz3/zenkit";
import { loadAnimationSequence } from "../animation";

jest.mock("../binary-cache", () => ({
  fetchBinaryCached: jest.fn(),
}));

import { fetchBinaryCached } from "../binary-cache";

describe("loadAnimationSequence", () => {
  it("loads, parses, and caches animation sequence", async () => {
    (fetchBinaryCached as unknown as jest.Mock).mockResolvedValue(new Uint8Array([1, 2, 3]));

    const man = {
      loadFromArray: jest.fn(() => ({ success: true })),
      getFrameCount: jest.fn(() => 2),
      getFps: jest.fn(() => 10),
      getNodeCount: jest.fn(() => 1),
      getNodeIndex: jest.fn(() => 0),
      getSample: jest.fn((frame: number) => ({
        position: { x: frame * 10, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      })),
    };

    const zenKit = {
      createModelAnimation: jest.fn(() => man),
    } as unknown as ZenKit;

    const binaryCache = new Map<string, Uint8Array>();
    const animationCache = new Map<string, any>();

    const seq1 = await loadAnimationSequence(
      zenKit,
      binaryCache,
      animationCache,
      "humans",
      "t_walk",
    );
    const seq2 = await loadAnimationSequence(
      zenKit,
      binaryCache,
      animationCache,
      "humans",
      "t_walk",
    );

    expect(seq1).not.toBeNull();
    expect(seq1).toBe(seq2);
    expect(seq1?.numFrames).toBe(2);
    expect(seq1?.fpsRate).toBe(10);
    expect(seq1?.totalTimeMs).toBe(200);
    expect(fetchBinaryCached).toHaveBeenCalledTimes(1);
  });

  it("returns null when MAN file fetch fails", async () => {
    (fetchBinaryCached as unknown as jest.Mock).mockRejectedValue(new Error("nope"));

    const zenKit = {
      createModelAnimation: jest.fn(),
    } as unknown as ZenKit;

    const seq = await loadAnimationSequence(zenKit, new Map(), new Map(), "humans", "missing");
    expect(seq).toBeNull();
  });
});
