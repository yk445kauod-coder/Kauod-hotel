import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { api } from '../src/api';
import { mutate, flushOutbox, listOps } from '../src/outbox';

vi.mock('../src/api', () => ({ api: { request: vi.fn(), get: vi.fn() } }));

const ls = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => ls.get(k) ?? null,
  setItem: (k: string, v: string) => { ls.set(k, String(v)); },
  removeItem: (k: string) => { ls.delete(k); },
  clear: () => ls.clear(), key: () => null, length: 0,
} as unknown as Storage;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  ls.clear();
  vi.mocked(api.request).mockReset();
});

describe('offline outbox', () => {
  it('queues a write when the network is down and flushes it later', async () => {
    vi.mocked(api.request).mockRejectedValue(new TypeError('failed to fetch'));
    const r = await mutate({ method: 'POST', path: '/api/rooms', body: { number: '1' }, label: 'غرفة' });
    expect(r.queued).toBe(true);
    expect(await listOps()).toHaveLength(1);

    vi.mocked(api.request).mockResolvedValue({} as never);
    expect(await flushOutbox()).toEqual({ sent: 1, failed: 0 });
    expect(await listOps()).toHaveLength(0);
  });

  it('stops flushing on a network error and keeps the op', async () => {
    vi.mocked(api.request).mockRejectedValue(new TypeError('failed to fetch'));
    await mutate({ method: 'POST', path: '/api/rooms', body: {}, label: 'غرفة' });
    vi.mocked(api.request).mockRejectedValue(new TypeError('failed to fetch'));
    const res = await flushOutbox();
    expect(res.failed).toBe(1);
    expect(await listOps()).toHaveLength(1);
  });
});
