import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { api } from '../src/api';
import { queueInvoice, syncNow, listQueue, setBlock, getBlock, getDeviceId } from '../src/offline';

vi.mock('../src/api', () => ({ api: { post: vi.fn() } }));

// Minimal localStorage for the node environment.
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
  vi.mocked(api.post).mockReset();
});

const draft = (guest: string) => ({
  guestName: guest, roomNumber: '10', applyDiscount: false,
  lines: [{ description: 'إقامة', qty: 2, unitPrice: '100', kind: 'room' as const }],
});

describe('offline invoice queue', () => {
  it('numbers queued invoices from the reserved block, in order', async () => {
    await setBlock({ start: 500, end: 502, next: 500 });
    const a = await queueInvoice(draft('أ'));
    const b = await queueInvoice(draft('ب'));
    expect([a.serial, b.serial]).toEqual([500, 501]);
    expect((await getBlock())?.next).toBe(502);
    expect(await listQueue()).toHaveLength(2);
  });

  it('refuses to queue once the block is exhausted', async () => {
    await setBlock({ start: 10, end: 10, next: 11 });
    await expect(queueInvoice(draft('ج'))).rejects.toThrow('no_block');
  });

  it('syncs the queue and clears what the server accepted', async () => {
    await setBlock({ start: 700, end: 705, next: 700 });
    await queueInvoice(draft('د'));
    await queueInvoice(draft('هـ'));
    vi.mocked(api.post).mockResolvedValue({} as never);

    const res = await syncNow();
    expect(res).toEqual({ sent: 2, failed: 0, rejected: 0 });
    expect(await listQueue()).toHaveLength(0);
    expect(vi.mocked(api.post).mock.calls[0]?.[1]).toMatchObject({ serial: 700 });
  });

  it('keeps a queued invoice when the network is still down', async () => {
    await setBlock({ start: 900, end: 905, next: 900 });
    await queueInvoice(draft('و'));
    vi.mocked(api.post).mockRejectedValue(new TypeError('failed to fetch'));

    const res = await syncNow();
    expect(res.failed).toBe(1);
    expect(res.rejected).toBe(0);
    expect(await listQueue()).toHaveLength(1);
  });

  it('flags a payload the server permanently rejects, but keeps it', async () => {
    await setBlock({ start: 920, end: 925, next: 920 });
    await queueInvoice(draft('ز'));
    vi.mocked(api.post).mockRejectedValue(new Error('bad_request'));

    const res = await syncNow();
    expect(res).toEqual({ sent: 0, failed: 1, rejected: 1 });
    expect(await listQueue()).toHaveLength(1);
  });

  it('mints a stable device id', async () => {
    const id = await getDeviceId();
    expect(id).toBeTruthy();
    expect(await getDeviceId()).toBe(id);
  });
});
