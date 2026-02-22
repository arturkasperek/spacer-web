import { loadCompiledTexAsDataTexture } from "./mesh-utils";

describe("loadCompiledTexAsDataTexture", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("falls back to DEFAULT-C.TEX when requested texture is missing", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/TEXTURES/_COMPILED/DEFAULT-C.TEX")) {
        return {
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(16),
        } as Response;
      }
      return {
        ok: false,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response;
    });
    global.fetch = fetchMock as any;

    const zenKit = {
      Texture: jest.fn(() => ({
        loadFromArray: jest.fn(() => ({ success: true })),
        width: 2,
        height: 2,
        asRgba8: jest.fn(() => new Uint8Array(2 * 2 * 4)),
      })),
    } as any;

    const result = await loadCompiledTexAsDataTexture(
      "/TEXTURES/_COMPILED/DOG_BODY_V0-C.TEX",
      zenKit,
    );

    expect(result).not.toBeNull();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "/TEXTURES/_COMPILED/DOG_BODY_V0-C.TEX",
      "/TEXTURES/_COMPILED/DEFAULT-C.TEX",
    ]);
  });

  it("tries _C0 variant before DEFAULT-C.TEX", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("HUM_HEAD_V0_C0-C.TEX")) {
        return {
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(16),
        } as Response;
      }
      return {
        ok: false,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response;
    });
    global.fetch = fetchMock as any;

    const zenKit = {
      Texture: jest.fn(() => ({
        loadFromArray: jest.fn(() => ({ success: true })),
        width: 2,
        height: 2,
        asRgba8: jest.fn(() => new Uint8Array(2 * 2 * 4)),
      })),
    } as any;

    const result = await loadCompiledTexAsDataTexture(
      "/TEXTURES/_COMPILED/HUM_HEAD_V0_C3-C.TEX",
      zenKit,
    );

    expect(result).not.toBeNull();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "/TEXTURES/_COMPILED/HUM_HEAD_V0_C3-C.TEX",
      "/TEXTURES/_COMPILED/HUM_HEAD_V0_C0-C.TEX",
    ]);
  });
});
