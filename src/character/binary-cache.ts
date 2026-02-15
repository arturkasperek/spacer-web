export type BinaryCache = Map<string, Uint8Array>;

export async function fetchBinaryCached(url: string, cache: BinaryCache): Promise<Uint8Array> {
  const cached = cache.get(url);
  if (cached) return cached;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  cache.set(url, bytes);
  return bytes;
}
