import type { ZenKit } from "@kolarz3/zenkit";
import { DEFAULT_MALE_HEADS, findHeadBoneIndex, loadHeadMesh } from "./head";

jest.mock("./binary-cache", () => ({
  fetchBinaryCached: jest.fn(),
}));

jest.mock("../shared/mesh-utils", () => ({
  buildThreeJSGeometry: jest.fn(() => ({ mocked: true })),
  buildMaterialGroups: jest.fn(),
  createMeshMaterial: jest.fn(async () => ({ type: "MockMaterial" })),
}));

import { fetchBinaryCached } from "./binary-cache";
import { createMeshMaterial } from "../shared/mesh-utils";

describe("findHeadBoneIndex", () => {
  it("finds head bone by exact BIP01 HEAD name", () => {
    expect(findHeadBoneIndex(["BIP01 PELVIS", "BIP01 HEAD", "BIP01 NECK"])).toBe(1);
  });

  it("finds head bone by substring match", () => {
    expect(findHeadBoneIndex(["Pelvis", "SomeHeadBone", "Other"])).toBe(1);
  });

  it("returns -1 when not found", () => {
    expect(findHeadBoneIndex(["BIP01 PELVIS", "BIP01 NECK"])).toBe(-1);
  });
});

describe("loadHeadMesh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses DEFAULT_MALE_HEADS when headNames is not provided", async () => {
    (fetchBinaryCached as unknown as jest.Mock).mockRejectedValue(new Error("not found"));

    const zenKit = {
      createMorphMesh: jest.fn(() => ({
        loadFromArray: jest.fn(() => ({ success: false })),
      })),
    } as unknown as ZenKit;

    const res = await loadHeadMesh({
      zenKit,
      binaryCache: new Map(),
      textureCache: new Map(),
      materialCache: new Map(),
    });

    expect(res).toBeNull();
    // At least one attempt should be made when defaults are used
    expect(fetchBinaryCached).toHaveBeenCalledWith(
      `/ANIMS/_COMPILED/${DEFAULT_MALE_HEADS[0]}.MMB`,
      expect.any(Map),
    );
  });

  it("normalizes head name and applies texture overrides for HEAD and TEETH materials", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    (fetchBinaryCached as unknown as jest.Mock).mockResolvedValue(bytes);

    const processed = {
      indices: { size: () => 3 },
      vertices: { size: () => 3 },
      materials: {
        size: () => 2,
        get: (i: number) =>
          i === 0 ? { texture: "HUM_HEAD_V0_C0.TGA" } : { texture: "HUM_TEETH_V0.TGA" },
      },
    };

    const zenKit = {
      createMorphMesh: jest.fn(() => ({
        loadFromArray: jest.fn(() => ({ success: true })),
        convertToProcessedMesh: jest.fn(() => processed),
      })),
    } as unknown as ZenKit;

    const mesh = await loadHeadMesh({
      zenKit,
      binaryCache: new Map(),
      textureCache: new Map(),
      materialCache: new Map(),
      headNames: ["  hum_head_custom.mmb  "],
      headTex: 2,
      skin: 3,
      teethTex: 1,
    });

    expect(mesh).not.toBeNull();
    expect(fetchBinaryCached).toHaveBeenCalledWith(
      "/ANIMS/_COMPILED/HUM_HEAD_CUSTOM.MMB",
      expect.any(Map),
    );
    expect(createMeshMaterial).toHaveBeenCalledWith(
      { texture: "HUM_HEAD_V2_C3" },
      expect.anything(),
      expect.any(Map),
      expect.any(Map),
    );
    expect(createMeshMaterial).toHaveBeenCalledWith(
      { texture: "HUM_TEETH_V1" },
      expect.anything(),
      expect.any(Map),
      expect.any(Map),
    );
  });
});
