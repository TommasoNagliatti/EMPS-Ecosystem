export type ReadSnapshot<T> = { value: T; updatedAt: number };

export class NavigationReadCache {
  private entries = new Map<string, ReadSnapshot<unknown>>();
  private pending = new Map<string, Promise<unknown>>();
  private generation = 0;

  constructor(private now = Date.now, private lifetime = 30_000, private capacity = 24) {}

  peek<T>(key: string, maxAge = this.lifetime): ReadSnapshot<T> | null {
    const entry = this.entries.get(key);
    if (!entry || this.now() - entry.updatedAt >= Math.min(maxAge, this.lifetime)) {
      if (entry && this.now() - entry.updatedAt >= this.lifetime) this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { value: structuredClone(entry.value) as T, updatedAt: entry.updatedAt };
  }

  clear() {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
  }

  async read<T>(key: string, load: () => Promise<T>, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<T> {
    if (options.signal?.aborted) throw new DOMException('Read cancelled', 'AbortError');
    const cached = !options.force && this.peek<T>(key, 5_000);
    if (cached) return cached.value;
    let shared = this.pending.get(key) as Promise<T> | undefined;
    if (!shared) {
      const generation = this.generation;
      shared = Promise.resolve().then(load).then(value => {
        // A completed read from a previous login or invalidation cannot repopulate the cache.
        if (generation !== this.generation) throw new DOMException('Read invalidated', 'AbortError');
        this.entries.delete(key);
        this.entries.set(key, { value: structuredClone(value), updatedAt: this.now() });
        while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
        return value;
      }).finally(() => { if (this.pending.get(key) === shared) this.pending.delete(key); });
      this.pending.set(key, shared);
    }
    // Cancelling one screen must not cancel a shared prefetch or another screen's read.
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new DOMException('Read cancelled', 'AbortError'));
      options.signal?.addEventListener('abort', abort, { once: true });
      shared!.then(value => resolve(structuredClone(value)), reject)
        .finally(() => options.signal?.removeEventListener('abort', abort));
    });
  }
}

export function navigationReadTargets(href: string): Array<{ path: string; stationId?: string }> {
  const resourcePaths: Record<string, string> = { '/stations': '/v2/stations', '/chargers': '/v2/chargers', '/sessions': '/charging-sessions', '/payments': '/payments', '/clients': '/clients', '/alerts': '/alerts' };
  if (href === '/chargers') return [{ path: '/v2/chargers' }, { path: '/v2/stations' }];
  if (resourcePaths[href]) return [{ path: resourcePaths[href] }];
  const station = /^\/stations\/(\d+)(\/dashboard)?$/.exec(href);
  if (!station) return [];
  const stationId = station[1];
  return [{ path: `/v2/stations/${stationId}`, stationId }, ...(station[2] ? [{ path: '/dashboard/panel', stationId }] : [])];
}
