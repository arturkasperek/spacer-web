import {
  WLD_TICKSPERDAY,
  WLD_TICKSPERMIN,
  __resetWorldTimeForTests,
  getSkyTime01,
  getWorldTime,
  setWorldTime,
  tickWorldTime,
} from "../world-time";

describe("world-time", () => {
  beforeEach(() => {
    __resetWorldTimeForTests();
  });

  it("converts day/hour/minute like Gothic", () => {
    setWorldTime(3, 12, 34);
    const t = getWorldTime();
    expect(t.day).toBe(3);
    expect(t.hour).toBe(12);
    expect(t.minute).toBe(34);
  });

  it("advances time using frame delta and wraps days", () => {
    setWorldTime(0, 23, 59);
    // Jump forward by 2 in-game minutes to cross midnight.
    tickWorldTime((WLD_TICKSPERMIN * 2) / 1000);
    const t = getWorldTime();
    expect(t.day).toBe(1);
    expect(t.hour).toBe(0);
  });

  it("keeps worldTimeMs within [0..ticksPerDay)", () => {
    setWorldTime(0, 0, 0);
    tickWorldTime((WLD_TICKSPERDAY * 3.25) / 1000);
    const t = getWorldTime();
    expect(t.day).toBe(3);
    expect(t.worldTimeMs).toBeGreaterThanOrEqual(0);
    expect(t.worldTimeMs).toBeLessThan(WLD_TICKSPERDAY + 1e-6);
  });

  it("produces a stable sky time in [0..1]", () => {
    setWorldTime(0, 0, 0);
    const s0 = getSkyTime01();
    expect(s0).toBeGreaterThanOrEqual(0);
    expect(s0).toBeLessThanOrEqual(1);
  });
});
