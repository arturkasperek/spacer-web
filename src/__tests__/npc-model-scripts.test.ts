export {};

import {
  __resetNpcModelScriptsForTests,
  addNpcOverlayModelScript,
  getNpcModelScriptsState,
  removeNpcOverlayModelScript,
  setNpcBaseModelScript,
} from "../npc-model-scripts";

describe("npc-model-scripts", () => {
  beforeEach(() => {
    __resetNpcModelScriptsForTests();
  });

  it("defaults to base HUMANS with no overlays", () => {
    const st = getNpcModelScriptsState(123);
    expect(st).toEqual({ baseScript: "HUMANS", overlays: [] });
  });

  it("sets base script and clears overlays", () => {
    addNpcOverlayModelScript(1, "HUMANS_RELAXED");
    setNpcBaseModelScript(1, "humans_mage");
    const st = getNpcModelScriptsState(1);
    expect(st.baseScript).toBe("HUMANS_MAGE");
    expect(st.overlays).toEqual([]);
  });

  it("adds overlays uniquely and removes them", () => {
    addNpcOverlayModelScript(5, "humans_relaxed");
    addNpcOverlayModelScript(5, "HUMANS_RELAXED");
    addNpcOverlayModelScript(5, "HUMANS_MILITIA");
    expect(getNpcModelScriptsState(5).overlays).toEqual(["HUMANS_RELAXED", "HUMANS_MILITIA"]);

    removeNpcOverlayModelScript(5, "humans_relaxed");
    expect(getNpcModelScriptsState(5).overlays).toEqual(["HUMANS_MILITIA"]);
  });
});

