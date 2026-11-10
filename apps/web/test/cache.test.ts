import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { cacheSet, cacheGet, cacheAppend } from '../src/cache';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('read cache', () => {
  it('stores and returns an array envelope', async () => {
    await cacheSet('k', [1]);
    await cacheAppend('k', 2);
    const hit = await cacheGet<number[]>('k');
    expect(hit?.data).toEqual([1, 2]);
    expect(hit?.at).toBeTruthy();
  });

  it('returns null for a missing key', async () => {
    expect(await cacheGet('missing')).toBeNull();
  });
});
