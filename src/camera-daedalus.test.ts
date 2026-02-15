import { extractCameraModes, readCameraModeDef } from "./camera-daedalus";

describe("camera-daedalus", () => {
  it("extracts CAMMOD* instances into a map", () => {
    const symbols = ["FOO", "CAMMODNORMAL", "BAR", "CAMMODMELEE"];

    const floats: Record<string, Record<string, number>> = {
      CAMMODNORMAL: {
        "CCAMSYS.BESTRANGE": 3,
        "CCAMSYS.BESTELEVATION": 30,
        "CCAMSYS.MINRANGE": 2,
        "CCAMSYS.MAXRANGE": 10,
        "CCAMSYS.MINELEVATION": 0,
        "CCAMSYS.MAXELEVATION": 90,
        "CCAMSYS.BESTAZIMUTH": 0,
        "CCAMSYS.MINAZIMUTH": -90,
        "CCAMSYS.MAXAZIMUTH": 90,
        "CCAMSYS.BESTROTZ": 0,
        "CCAMSYS.MINROTZ": 0,
        "CCAMSYS.MAXROTZ": 0,
        "CCAMSYS.ROTOFFSETX": 23,
        "CCAMSYS.ROTOFFSETY": 0,
        "CCAMSYS.ROTOFFSETZ": 0,
        "CCAMSYS.TARGETOFFSETX": 0,
        "CCAMSYS.TARGETOFFSETY": 0,
        "CCAMSYS.TARGETOFFSETZ": 0,
        "CCAMSYS.VELOTRANS": 40,
        "CCAMSYS.VELOROT": 2,
      },
      CAMMODMELEE: {
        "CCAMSYS.BESTRANGE": 2.5,
        "CCAMSYS.BESTELEVATION": 35,
        "CCAMSYS.MINRANGE": 1.4,
        "CCAMSYS.MAXRANGE": 10,
        "CCAMSYS.MINELEVATION": 0,
        "CCAMSYS.MAXELEVATION": 89,
        "CCAMSYS.BESTAZIMUTH": 0,
        "CCAMSYS.MINAZIMUTH": -90,
        "CCAMSYS.MAXAZIMUTH": 90,
        "CCAMSYS.BESTROTZ": 0,
        "CCAMSYS.MINROTZ": 0,
        "CCAMSYS.MAXROTZ": 0,
        "CCAMSYS.ROTOFFSETX": 20,
        "CCAMSYS.ROTOFFSETY": 0,
        "CCAMSYS.ROTOFFSETZ": 0,
        "CCAMSYS.TARGETOFFSETX": 0,
        "CCAMSYS.TARGETOFFSETY": 0,
        "CCAMSYS.TARGETOFFSETZ": 0,
        "CCAMSYS.VELOTRANS": 40,
        "CCAMSYS.VELOROT": 2,
      },
    };

    const ints: Record<string, Record<string, number>> = {
      CAMMODNORMAL: {
        "CCAMSYS.TRANSLATE": 1,
        "CCAMSYS.ROTATE": 1,
        "CCAMSYS.COLLISION": 1,
      },
      CAMMODMELEE: {
        "CCAMSYS.TRANSLATE": 1,
        "CCAMSYS.ROTATE": 1,
        "CCAMSYS.COLLISION": 1,
      },
    };

    const vm = {
      symbolCount: symbols.length,
      getSymbolNameByIndex: (i: number) => ({ success: true, data: symbols[i] }),
      getSymbolFloat: (symbolName: string, instanceName?: string) => {
        if (!instanceName) return 0;
        return floats[instanceName]?.[symbolName] ?? 0;
      },
      getSymbolInt: (symbolName: string, instanceName?: string) => {
        if (!instanceName) return 0;
        return ints[instanceName]?.[symbolName] ?? 0;
      },
    };

    const out = extractCameraModes(vm as any);
    expect(Object.keys(out).sort()).toEqual(["CAMMODMELEE", "CAMMODNORMAL"]);
    expect(out.CAMMODNORMAL.bestRange).toBe(3);
    expect(out.CAMMODNORMAL.bestElevation).toBe(30);
    expect(out.CAMMODMELEE.bestRange).toBe(2.5);
  });

  it("returns null when instance does not look like CCAMSYS (bestRange <= 0)", () => {
    const vm = {
      getSymbolFloat: () => 0,
      getSymbolInt: () => 0,
    };
    expect(readCameraModeDef(vm as any, "CAMMODNORMAL")).toBeNull();
  });
});
