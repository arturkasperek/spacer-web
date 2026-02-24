import * as THREE from "three";
import { createMeshMaterial, loadCompiledTexAsDataTexture } from "./mesh-utils";

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

describe("createMeshMaterial material profile mapping", () => {
  const makeZenKit = (baseAlpha: number) =>
    ({
      Texture: jest.fn(() => ({
        loadFromArray: jest.fn(() => ({ success: true })),
        width: 2,
        height: 2,
        asRgba8: jest.fn(() => {
          const p = new Uint8Array(2 * 2 * 4);
          for (let i = 0; i < p.length; i += 4) {
            p[i + 0] = 255;
            p[i + 1] = 255;
            p[i + 2] = 255;
            p[i + 3] = baseAlpha;
          }
          return p;
        }),
      })),
    }) as any;

  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(16),
      headers: { get: () => "application/octet-stream" },
    })) as any;

    // Ensure fresh material objects with userData for each constructor call.
    (THREE.MeshBasicMaterial as unknown as jest.Mock).mockImplementation(() => ({
      color: { setHex: jest.fn() },
      userData: {},
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0,
      depthWrite: true,
      depthTest: true,
      blending: THREE.NormalBlending,
      map: null,
      needsUpdate: false,
      dispose: jest.fn(),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("maps default+alpha texture to alphaTest queue", async () => {
    const mat = await createMeshMaterial(
      { texture: "ITAR_SCROLL1.TGA", alphaFunc: 1, colorA: 255 },
      makeZenKit(128),
      new Map(),
      new Map(),
    );
    expect(mat.transparent).toBe(false);
    expect(mat.alphaTest).toBe(0.5);
    expect(mat.depthWrite).toBe(true);
    expect((mat.userData as any).renderQueue).toBe("alphaTest");
  });

  it("maps BLEND alpha function to transparent queue", async () => {
    const mat = await createMeshMaterial(
      { texture: "ITAR_SCROLL1.TGA", alphaFunc: 2, colorA: 255 },
      makeZenKit(255),
      new Map(),
      new Map(),
    );
    expect(mat.transparent).toBe(true);
    expect(mat.alphaTest).toBe(0);
    expect(mat.depthWrite).toBe(false);
    expect((mat.userData as any).renderQueue).toBe("transparent");
  });

  it("maps ADD alpha function to additive blending", async () => {
    const mat = await createMeshMaterial(
      { texture: "ITAR_SCROLL1.TGA", alphaFunc: 3, colorA: 255 },
      makeZenKit(255),
      new Map(),
      new Map(),
    );
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect((mat.userData as any).renderQueue).toBe("transparent");
  });

  it("maps default + opaque texture to solid queue", async () => {
    const mat = await createMeshMaterial(
      { texture: "ITAR_SCROLL1.TGA", alphaFunc: 0, colorA: 255 },
      makeZenKit(255),
      new Map(),
      new Map(),
    );
    expect(mat.transparent).toBe(false);
    expect(mat.alphaTest).toBe(0);
    expect(mat.depthWrite).toBe(true);
    expect((mat.userData as any).renderQueue).toBe("opaque");
  });

  it("separates material cache entries by alphaFunc/colorA signature", async () => {
    const textureCache = new Map<string, THREE.DataTexture>();
    const materialCache = new Map<string, THREE.Material>();
    const zenKit = makeZenKit(255);

    const solid = await createMeshMaterial(
      { texture: "ITAR_SCROLL1.TGA", alphaFunc: 0, colorA: 255 },
      zenKit,
      textureCache,
      materialCache,
    );
    const blend = await createMeshMaterial(
      { texture: "ITAR_SCROLL1.TGA", alphaFunc: 2, colorA: 255 },
      zenKit,
      textureCache,
      materialCache,
    );

    expect(solid).not.toBe(blend);
  });
});
