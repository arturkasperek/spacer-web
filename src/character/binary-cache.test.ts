import { fetchBinaryCached } from "./binary-cache";

describe("fetchBinaryCached", () => {
  beforeEach(() => {
    (global.fetch as any) = jest.fn();
  });

  it("caches by URL and avoids refetching", async () => {
    const cache = new Map<string, Uint8Array>();
    const bytes = new Uint8Array([1, 2, 3]);

    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => bytes.buffer,
    });

    const a = await fetchBinaryCached("/test.bin", cache);
    const b = await fetchBinaryCached("/test.bin", cache);

    expect(a).toBe(b);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("throws when response is not ok", async () => {
    const cache = new Map<string, Uint8Array>();

    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    await expect(fetchBinaryCached("/missing.bin", cache)).rejects.toThrow(
      "Failed to fetch /missing.bin: 404 Not Found",
    );
  });
});
