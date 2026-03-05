import { AssetManager } from "./asset-manager";

class MockTexWorker {
  onmessage: ((event: MessageEvent<any>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  postMessage(msg: { id: number; type: "decodeTex"; url: string }) {
    const run = async () => {
      const candidates: string[] = [msg.url];
      if (/_C\d+-C\.TEX$/i.test(msg.url) && !/_C0-C\.TEX$/i.test(msg.url)) {
        candidates.push(msg.url.replace(/_C\d+(-C\.TEX)$/i, "_C0$1"));
      }
      if (!msg.url.toUpperCase().endsWith("/DEFAULT-C.TEX")) {
        candidates.push("/TEXTURES/_COMPILED/DEFAULT-C.TEX");
      }

      for (const candidate of candidates) {
        const response = await fetch(candidate);
        if (!response.ok) continue;
        const data = {
          id: msg.id,
          ok: true as const,
          width: 2,
          height: 2,
          rgba: new Uint8Array(2 * 2 * 4).buffer,
          hasAlpha: false,
          resolvedUrl: candidate,
        };
        this.onmessage?.({ data } as MessageEvent<any>);
        return;
      }
      this.onmessage?.({
        data: { id: msg.id, ok: false, error: "decode failed" },
      } as MessageEvent<any>);
    };
    void run();
  }

  terminate() {
    // no-op
  }
}

describe("AssetManager.loadTexture", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (globalThis as any).Worker;
    delete (globalThis as any).__ASSET_MANAGER_TEX_WORKER_URL__;
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
    (globalThis as any).Worker = jest.fn(() => new MockTexWorker());
    (globalThis as any).__ASSET_MANAGER_TEX_WORKER_URL__ = "https://localhost/mock-entry.js";

    const zenKit = {
      Texture: jest.fn(() => ({
        loadFromArray: jest.fn(() => ({ success: true })),
        width: 2,
        height: 2,
        asRgba8: jest.fn(() => new Uint8Array(2 * 2 * 4)),
      })),
    } as any;

    const manager = new AssetManager();
    const result = await manager.loadTexture("/TEXTURES/_COMPILED/DOG_BODY_V0-C.TEX", zenKit);

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
    (globalThis as any).Worker = jest.fn(() => new MockTexWorker());
    (globalThis as any).__ASSET_MANAGER_TEX_WORKER_URL__ = "https://localhost/mock-entry.js";

    const zenKit = {
      Texture: jest.fn(() => ({
        loadFromArray: jest.fn(() => ({ success: true })),
        width: 2,
        height: 2,
        asRgba8: jest.fn(() => new Uint8Array(2 * 2 * 4)),
      })),
    } as any;

    const manager = new AssetManager();
    const result = await manager.loadTexture("/TEXTURES/_COMPILED/HUM_HEAD_V0_C3-C.TEX", zenKit);

    expect(result).not.toBeNull();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "/TEXTURES/_COMPILED/HUM_HEAD_V0_C3-C.TEX",
      "/TEXTURES/_COMPILED/HUM_HEAD_V0_C0-C.TEX",
    ]);
  });
});

describe("AssetManager.fetchBinary", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deduplicates concurrent fetches for the same URL", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    global.fetch = fetchMock as any;

    const manager = new AssetManager();
    const [a, b, c] = await Promise.all([
      manager.fetchBinary("/ANIMS/_COMPILED/HUM_BODY_NAKED0.MDM"),
      manager.fetchBinary("/ANIMS/_COMPILED/HUM_BODY_NAKED0.MDM"),
      manager.fetchBinary("/ANIMS/_COMPILED/HUM_BODY_NAKED0.MDM"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(manager.binaryCache.get("/ANIMS/_COMPILED/HUM_BODY_NAKED0.MDM")).toBe(a);
    expect(manager.binaryInFlight.size).toBe(0);
  });
});

describe("AssetManager.loadTexture in-flight", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deduplicates concurrent texture loads for the same URL", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(16),
    }));
    global.fetch = fetchMock as any;
    (globalThis as any).Worker = jest.fn(() => new MockTexWorker());
    (globalThis as any).__ASSET_MANAGER_TEX_WORKER_URL__ = "https://localhost/mock-entry.js";

    const zenKit = {
      Texture: jest.fn(() => ({
        loadFromArray: jest.fn(() => ({ success: true })),
        width: 2,
        height: 2,
        asRgba8: jest.fn(() => new Uint8Array(2 * 2 * 4)),
      })),
    } as any;

    const manager = new AssetManager();
    const [a, b, c] = await Promise.all([
      manager.loadTexture("/TEXTURES/_COMPILED/RATTE2-C.TEX", zenKit),
      manager.loadTexture("/TEXTURES/_COMPILED/RATTE2-C.TEX", zenKit),
      manager.loadTexture("/TEXTURES/_COMPILED/RATTE2-C.TEX", zenKit),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(manager.textureInFlight.size).toBe(0);
  });
});
