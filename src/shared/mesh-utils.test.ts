import * as THREE from "three";
import { createMeshMaterial, decodeCompiledTexAsDataTexture } from "./mesh-utils";

describe("decodeCompiledTexAsDataTexture", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("decodes TEX bytes into DataTexture", async () => {
    const zenKit = {
      Texture: jest.fn(() => ({
        loadFromArray: jest.fn(() => ({ success: true })),
        width: 2,
        height: 2,
        asRgba8: jest.fn(() => new Uint8Array(2 * 2 * 4)),
      })),
    } as any;

    const result = decodeCompiledTexAsDataTexture(new Uint8Array([1, 2, 3]), zenKit);

    expect(result).not.toBeNull();
    expect(zenKit.Texture).toHaveBeenCalled();
  });

  it("returns null when ZenKit texture parse fails", async () => {
    const zenKit = {
      Texture: jest.fn(() => ({
        loadFromArray: jest.fn(() => ({ success: false })),
        width: 2,
        height: 2,
        asRgba8: jest.fn(() => new Uint8Array(2 * 2 * 4)),
      })),
    } as any;

    const result = decodeCompiledTexAsDataTexture(new Uint8Array([1, 2, 3]), zenKit);

    expect(result).toBeNull();
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
  const textureLoader = async (_url: string | null, zenKit: any) =>
    decodeCompiledTexAsDataTexture(new Uint8Array([1, 2, 3]), zenKit);

  beforeEach(() => {
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
      textureLoader,
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
      textureLoader,
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
      textureLoader,
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
      textureLoader,
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
      textureLoader,
    );
    const blend = await createMeshMaterial(
      { texture: "ITAR_SCROLL1.TGA", alphaFunc: 2, colorA: 255 },
      zenKit,
      textureCache,
      materialCache,
      textureLoader,
    );

    expect(solid).not.toBe(blend);
  });
});
