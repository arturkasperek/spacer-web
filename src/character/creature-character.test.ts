import { buildInitialCreatureAnimationCandidates } from "./creature-character";

describe("creature-character", () => {
  it("builds creature initial animation candidates without human-only probes", () => {
    const candidates = buildInitialCreatureAnimationCandidates("s_Run");
    const upper = candidates.map((s) => s.toUpperCase());

    expect(upper).toContain("S_RUN");
    expect(upper).toContain("S_RUNL");
    expect(upper).toContain("S_WALK");
    expect(upper).toContain("S_WALKL");
    expect(upper).toContain("S_STAND");
    expect(upper).toContain("T_STAND");
    expect(upper).not.toContain("S_IDLE");
    expect(upper).not.toContain("T_DANCE_01");
  });

  it("deduplicates and trims candidate names", () => {
    const candidates = buildInitialCreatureAnimationCandidates("  s_Run  ");
    const runCount = candidates.filter((s) => s.toLowerCase() === "s_run").length;

    expect(runCount).toBe(1);
    expect(candidates[0]).toBe("s_Run");
  });
});
