import { HotObjectPool } from "./hot-object-pool";

describe("HotObjectPool", () => {
  it("stores and restores entries by key", () => {
    const disposed: string[] = [];
    const pool = new HotObjectPool<string>(1024, (v) => disposed.push(v));

    pool.put("TREE_A", "obj-1", 100);
    const hit = pool.take("TREE_A");
    const miss = pool.take("TREE_A");

    expect(hit?.value).toBe("obj-1");
    expect(miss).toBeNull();
    expect(disposed).toEqual([]);
    expect(pool.getStats()).toEqual(
      expect.objectContaining({
        count: 0,
        bytes: 0,
      }),
    );
  });

  it("evicts oldest key buckets when byte limit is exceeded", () => {
    const disposed: string[] = [];
    const pool = new HotObjectPool<string>(150, (v) => disposed.push(v));

    pool.put("A", "a-1", 100);
    pool.put("B", "b-1", 100); // exceeds limit => evict from A

    expect(disposed).toEqual(["a-1"]);
    expect(pool.take("A")).toBeNull();
    expect(pool.take("B")?.value).toBe("b-1");
  });

  it("disposes unknown-key inserts and clear() disposes remaining entries", () => {
    const disposed: string[] = [];
    const pool = new HotObjectPool<string>(1024, (v) => disposed.push(v));

    pool.put("", "bad", 10);
    pool.put("K", "k-1", 10);
    pool.put("K", "k-2", 20);
    pool.clear();

    expect(disposed).toEqual(["bad", "k-1", "k-2"]);
    expect(pool.getStats()).toEqual(
      expect.objectContaining({
        count: 0,
        bytes: 0,
        bucketCount: 0,
      }),
    );
  });
});
