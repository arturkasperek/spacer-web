export {};

import {
  ModelScriptRegistry,
  modelScriptKeyToCompiledPath,
  normalizeMdsToScriptKey,
} from "../model-script-registry";

type FakeModelScript = {
  loadFromArray: (b: Uint8Array) => { success: boolean };
  getAnimationCount: () => number;
  getAnimationName: (i: number) => string;
  getAnimationLayer: (i: number) => number;
  getAnimationNext: (i: number) => string;
  getAnimationBlendIn: (i: number) => number;
  getAnimationBlendOut: (i: number) => number;
  getAnimationFlags: (i: number) => number;
  getAnimationModel: (i: number) => string;
  getAnimationFirstFrame: (i: number) => number;
  getAnimationLastFrame: (i: number) => number;
  getAnimationFps: (i: number) => number;
  getAnimationSpeed: (i: number) => number;
};

describe("model-script-registry helpers", () => {
  it("normalizes MDS names to script keys", () => {
    expect(normalizeMdsToScriptKey("Humans_Relaxed.mds")).toBe("HUMANS_RELAXED");
    expect(normalizeMdsToScriptKey("  /ANIMS/MDS_OVERLAY/HumanS_Arrogance.MDS  ")).toBe(
      "HUMANS_ARROGANCE",
    );
    expect(normalizeMdsToScriptKey("HUMANS")).toBe("HUMANS");
    expect(normalizeMdsToScriptKey("")).toBe("");
  });

  it("converts script keys to compiled MSB paths", () => {
    expect(modelScriptKeyToCompiledPath("HUMANS")).toBe("/ANIMS/_COMPILED/HUMANS.MSB");
    expect(modelScriptKeyToCompiledPath(" humans_relaxed ")).toBe(
      "/ANIMS/_COMPILED/HUMANS_RELAXED.MSB",
    );
  });
});

describe("ModelScriptRegistry", () => {
  it("loads MSB once and exposes animation meta by name", async () => {
    const fakeScript: FakeModelScript = {
      loadFromArray: () => ({ success: true }),
      getAnimationCount: () => 2,
      getAnimationName: (i) => (i === 0 ? "t_Test" : "s_Test"),
      getAnimationLayer: (i) => (i === 0 ? 1 : 2),
      getAnimationNext: (i) => (i === 0 ? "s_Test" : "s_Test"),
      getAnimationBlendIn: () => 0.1,
      getAnimationBlendOut: () => 0.2,
      getAnimationFlags: () => 123,
      getAnimationModel: () => "SomeSource.asc",
      getAnimationFirstFrame: () => 1,
      getAnimationLastFrame: () => 10,
      getAnimationFps: () => 25,
      getAnimationSpeed: () => 1,
    };

    const createModelScript = jest.fn(() => fakeScript);
    const zenKit: any = { createModelScript };
    const fetchBinary = jest.fn(async () => new Uint8Array([1, 2, 3]));

    const reg = new ModelScriptRegistry({ zenKit, fetchBinary });

    const a = await reg.loadScript("HUMANS_RELAXED");
    expect(a?.key).toBe("HUMANS_RELAXED");
    expect(fetchBinary).toHaveBeenCalledTimes(1);
    expect(fetchBinary).toHaveBeenCalledWith("/ANIMS/_COMPILED/HUMANS_RELAXED.MSB");
    expect(createModelScript).toHaveBeenCalledTimes(1);

    const again = await reg.loadScript("HUMANS_RELAXED");
    expect(again).toBe(a);
    expect(fetchBinary).toHaveBeenCalledTimes(1);
    expect(createModelScript).toHaveBeenCalledTimes(1);

    const meta = reg.getLoadedScript("HUMANS_RELAXED")!.animationsByName.get("T_TEST");
    expect(meta).toEqual(
      expect.objectContaining({
        name: "t_Test",
        layer: 1,
        next: "s_Test",
        model: "HUMANS_RELAXED",
      }),
    );
  });

  it("resolves meta from overlays first, then base", async () => {
    const mkScript = (names: Array<{ name: string; next?: string }>): FakeModelScript => ({
      loadFromArray: () => ({ success: true }),
      getAnimationCount: () => names.length,
      getAnimationName: (i) => names[i]!.name,
      getAnimationLayer: () => 1,
      getAnimationNext: (i) => names[i]!.next ?? "",
      getAnimationBlendIn: () => 0,
      getAnimationBlendOut: () => 0,
      getAnimationFlags: () => 0,
      getAnimationModel: () => "",
      getAnimationFirstFrame: () => 0,
      getAnimationLastFrame: () => 0,
      getAnimationFps: () => 25,
      getAnimationSpeed: () => 1,
    });

    const scriptsByKey: Record<string, FakeModelScript> = {
      HUMANS: mkScript([{ name: "s_Run" }]),
      HUMANS_RELAXED: mkScript([{ name: "s_Run", next: "s_Run" }, { name: "s_WalkL" }]),
    };

    const zenKit: any = {
      createModelScript: () => {
        // placeholder, overwritten below
        return {} as any;
      },
    };

    const fetchBinary = jest.fn(async (url: string) => {
      const key = url
        .split("/")
        .pop()!
        .replace(/\.MSB$/i, "")
        .toUpperCase();
      (scriptsByKey as any).__lastKey__ = scriptsByKey[key];
      return new Uint8Array([7]);
    });

    zenKit.createModelScript = jest.fn(() => (scriptsByKey as any).__lastKey__);

    const reg = new ModelScriptRegistry({ zenKit, fetchBinary });
    await reg.loadScript("HUMANS");
    await reg.loadScript("HUMANS_RELAXED");

    const meta = reg.getAnimationMetaForNpc(
      { baseScript: "HUMANS", overlays: ["HUMANS_RELAXED"] },
      "s_WalkL",
    );
    expect(meta?.model).toBe("HUMANS_RELAXED");

    const meta2 = reg.getAnimationMetaForNpc(
      { baseScript: "HUMANS", overlays: ["HUMANS_RELAXED"] },
      "s_Run",
    );
    expect(meta2?.model).toBe("HUMANS_RELAXED");

    const meta3 = reg.getAnimationMetaForNpc(
      { baseScript: "HUMANS", overlays: ["HUMANS_RELAXED"] },
      "t_DOES_NOT_EXIST",
    );
    expect(meta3).toBeNull();
  });
});
