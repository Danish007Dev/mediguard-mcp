interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Small in-memory TTL cache with simple oldest-entry eviction at capacity.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();

  public constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 5000,
  ) {}

  public get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  public set(key: K, value: V): void {
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as K | undefined;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  public has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  public clear(): void {
    this.entries.clear();
  }
}
