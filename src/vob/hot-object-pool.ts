export type HotPoolStats = {
  count: number;
  bytes: number;
  limitBytes: number;
  bucketCount: number;
};

type HotEntry<T> = {
  value: T;
  approxBytes: number;
};

export class HotObjectPool<T> {
  private readonly buckets = new Map<string, HotEntry<T>[]>();
  private totalCount = 0;
  private totalBytes = 0;

  constructor(
    private readonly limitBytes: number,
    private readonly disposeValue: (value: T) => void,
  ) {}

  put(key: string, value: T, approxBytes: number): void {
    if (!key) {
      this.disposeValue(value);
      return;
    }
    const safeBytes = Math.max(0, Number(approxBytes) || 0);
    const bucket = this.buckets.get(key) || [];
    bucket.push({ value, approxBytes: safeBytes });
    // Move key to the end to emulate LRU by key activity.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    this.totalCount += 1;
    this.totalBytes += safeBytes;
    this.prune();
  }

  take(key: string): HotEntry<T> | null {
    if (!key) return null;
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.length === 0) return null;
    const entry = bucket.pop() || null;
    if (!entry) return null;
    this.totalCount = Math.max(0, this.totalCount - 1);
    this.totalBytes = Math.max(0, this.totalBytes - entry.approxBytes);
    if (bucket.length === 0) {
      this.buckets.delete(key);
    } else {
      this.buckets.set(key, bucket);
    }
    return entry;
  }

  clear(): void {
    for (const bucket of this.buckets.values()) {
      for (const entry of bucket) this.disposeValue(entry.value);
    }
    this.buckets.clear();
    this.totalCount = 0;
    this.totalBytes = 0;
  }

  getStats(): HotPoolStats {
    return {
      count: this.totalCount,
      bytes: this.totalBytes,
      limitBytes: this.limitBytes,
      bucketCount: this.buckets.size,
    };
  }

  private prune(): void {
    while (this.totalBytes > this.limitBytes) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const bucket = this.buckets.get(oldestKey);
      if (!bucket || bucket.length === 0) {
        this.buckets.delete(oldestKey);
        continue;
      }
      const evicted = bucket.shift();
      if (!evicted) continue;
      this.totalCount = Math.max(0, this.totalCount - 1);
      this.totalBytes = Math.max(0, this.totalBytes - evicted.approxBytes);
      this.disposeValue(evicted.value);
      if (bucket.length === 0) {
        this.buckets.delete(oldestKey);
      } else {
        this.buckets.set(oldestKey, bucket);
      }
    }
  }
}
