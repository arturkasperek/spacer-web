export {};

import { advanceNpcStateTime, getNpcStateTime, setNpcStateTime } from "../vm-manager";

describe("vm state time helpers", () => {
  it("advances state time monotonically and clamps invalid input", () => {
    const idx = 99999;
    setNpcStateTime(idx, 0);
    expect(getNpcStateTime(idx)).toBe(0);

    advanceNpcStateTime(idx, 0.5);
    expect(getNpcStateTime(idx)).toBeCloseTo(0.5, 6);

    // Negative deltas should not decrease the timer.
    advanceNpcStateTime(idx, -10);
    expect(getNpcStateTime(idx)).toBeCloseTo(0.5, 6);

    // Setting negative values clamps to 0.
    setNpcStateTime(idx, -123);
    expect(getNpcStateTime(idx)).toBe(0);
  });
});

