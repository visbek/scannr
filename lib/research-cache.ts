import { createHash } from 'node:crypto';
import { unstable_cache } from 'next/cache';
import { noteReuse } from './scan-usage';

export function researchKey(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function createMemoryCache() {
  const values = new Map<string, { value: unknown; expires: number }>();
  const pending = new Map<string, Promise<unknown>>();
  return async function cached<T>(key: string, ttl: number, work: () => Promise<T>): Promise<T> {
    const hit = values.get(key);
    if (hit && hit.expires > Date.now()) { noteReuse('memory'); return hit.value as T; }
    if (pending.has(key)) { noteReuse('in-flight'); return pending.get(key) as Promise<T>; }
    const promise = work().then(value => {
      if (values.size >= 500) values.delete(values.keys().next().value!);
      values.set(key, { value, expires: Date.now() + ttl * 1000 }); return value;
    }).finally(() => pending.delete(key));
    pending.set(key, promise); return promise;
  };
}
const memory = createMemoryCache();
// Cache public research only. Live measured answers and customer reports never enter this cache.
export async function cachedResearch<T>(namespace: string, key: unknown, ttl: number, work: () => Promise<T>): Promise<T> {
  const digest = researchKey([namespace, key]);
  return memory(digest, Math.max(1, ttl - (Date.now() / 1000) % ttl), async () => {
    if (process.env.SCANRR_CACHE_MODE === 'memory') return work();
    // Bucketed keys impose a hard freshness boundary, avoiding stale-while-revalidate answers.
    const bucket = Math.floor(Date.now() / (ttl * 1000));
    let executed = false;
    const get = unstable_cache(async () => { executed = true; return work(); },
      ['scanrr-research-v1', digest, String(bucket)], { revalidate: ttl });
    const result = await get();
    if (!executed) noteReuse(namespace);
    return result;
  });
}
