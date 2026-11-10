// Last-good read cache. The most recent successful GET for a list is stored
// so the app can still show data offline. Every entry is an { data, at }
// envelope; `at` lets the UI flag "last connection" data.
import { idbTx } from './offline';

const KV = 'kv';
interface Envelope<T> { data: T; at: string; }

const key = (k: string) => `cache:${k}`;

export async function cacheSet<T>(k: string, data: T): Promise<void> {
  await idbTx(KV, 'readwrite', (s) => s.put({ data, at: new Date().toISOString() }, key(k)));
}

export async function cacheGet<T>(k: string): Promise<{ data: T; at: string } | null> {
  const hit = await idbTx<Envelope<T> | undefined>(KV, 'readonly', (s) => s.get(key(k)));
  return hit ?? null;
}

// Append a locally-created row so it shows before it is uploaded.
export async function cacheAppend<T>(k: string, item: T): Promise<void> {
  const hit = await cacheGet<T[]>(k);
  const list = Array.isArray(hit?.data) ? hit.data : [];
  await cacheSet(k, [...list, item]);
}

// Patch a cached row in place (e.g. after an offline status change).
export async function cacheUpdate<T extends Record<string, unknown>>(
  k: string, match: (row: T) => boolean, patch: Partial<T>,
): Promise<void> {
  const hit = await cacheGet<T[]>(k);
  if (!Array.isArray(hit?.data)) return;
  await cacheSet(k, hit.data.map((row) => (match(row) ? { ...row, ...patch } : row)));
}
