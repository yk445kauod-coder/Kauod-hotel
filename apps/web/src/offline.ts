// Offline layer. Invoices created without connectivity are numbered from a
// block of serials reserved for this device (so numbers never collide) and
// queued in IndexedDB. Each queued write carries an opId; the server applies
// it exactly once, so replaying the queue after a reconnect is safe.
import { calcInvoice } from '@kaoud/core';
import { api, ApiError } from './api';

const DB_NAME = 'kaoud-offline';
const DB_VERSION = 2;
const KV = 'kv';
const QUEUE = 'queue';
const OUTBOX = 'outbox';

export interface SerialBlock { start: number; end: number; next: number; }
export interface QueuedInvoice {
  opId: string; serial: number; createdAt: string;
  guestName: string; roomNumber: string; total: string;
  payload: Record<string, unknown>;
}
export interface OfflineInvoice extends QueuedInvoice { offline: true; }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'opId' });
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'opKey' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

// Exposed for the outbox module so all offline stores share one connection.
export const idbTx = tx;
export const OUTBOX_STORE = OUTBOX;

const kvGet = <T>(k: string) => tx<T>(KV, 'readonly', (s) => s.get(k));
const kvSet = (k: string, v: unknown) => tx(KV, 'readwrite', (s) => s.put(v, k));
const qAll = () => tx<QueuedInvoice[]>(QUEUE, 'readonly', (s) => s.getAll());
const qPut = (item: QueuedInvoice) => tx(QUEUE, 'readwrite', (s) => s.put(item));
const qDel = (opId: string) => tx(QUEUE, 'readwrite', (s) => s.delete(opId));

// ---- device identity + offline toggle -------------------------------------

export async function getDeviceId(): Promise<string> {
  let id = await kvGet<string>('deviceId');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await kvSet('deviceId', id);
  }
  return id;
}

export const isOfflineEnabled = () => localStorage.getItem('kaoud_offline') === '1';
export function setOfflineEnabled(on: boolean) { localStorage.setItem('kaoud_offline', on ? '1' : '0'); }

// ---- serial block ----------------------------------------------------------

export const getBlock = () => kvGet<SerialBlock>('block');
export const setBlock = (b: SerialBlock | null) => kvSet('block', b);

// Reserve (or reuse) a block of serials for this device. Needs connectivity.
// The block is small on purpose: the online allocator skips it, so any unused
// numbers in the block become a one-off gap in the sequence. Re-reserving keeps
// the local progress when the server returns the same block (so already-queued
// offline numbers are never reissued), and adopts a new block if it changed.
export async function reserveBlock(size = 50): Promise<SerialBlock> {
  const deviceId = await getDeviceId();
  const prev = await getBlock();
  const r = await api.post<{ deviceId: string; start: number; end: number; next: number }>(
    '/api/serial/reserve', { deviceId, size });
  const keepProgress = prev && prev.start === r.start && prev.end === r.end
    && prev.next >= r.start && prev.next <= r.end + 1;
  const block: SerialBlock = { start: r.start, end: r.end, next: keepProgress ? prev.next : r.next };
  await setBlock(block);
  return block;
}

// Give back this device's unused reserved numbers so the sequence returns to
// being contiguous. Called when offline mode is switched off. Safe to call when
// a block exists or not; the server keeps any numbers already used.
export async function releaseBlock(): Promise<void> {
  const deviceId = await getDeviceId();
  try { await api.post('/api/serial/release', { deviceId }); } catch { /* stay reserved; retry next time */ return; }
  await setBlock(null);
}

// ---- queue -----------------------------------------------------------------

function opId(): string {
  return (crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

export interface OfflineCreateInput {
  guestName: string; roomNumber: string; checkIn?: string; checkOut?: string;
  receiverTaxId?: string; notes?: string; applyDiscount: boolean;
  vatRate?: number | null; discountRate?: number | null;
  issuerName?: string | null; issuerTaxId?: string | null; issuerAddress?: string | null;
  paymentMethod?: string;
  lines: { description: string; qty: number; unitPrice: string; kind: 'room' | 'restaurant' | 'minibar' | 'laundry' | 'extra' }[];
}

// Queue an invoice offline, numbering it from the device's reserved block.
export async function queueInvoice(input: OfflineCreateInput): Promise<QueuedInvoice> {
  const block = await getBlock();
  if (!block || block.next > block.end) throw new Error('no_block');
  const serial = block.next;
  await setBlock({ ...block, next: serial + 1 });

  const op = opId();
  const settings = await kvGet<{ vat_rate: number; discount_rate: number; prices_include_tax: number }>('settings');
  const calc = calcInvoice(
    { guestName: input.guestName, checkIn: input.checkIn, checkOut: input.checkOut, applyDiscount: input.applyDiscount, lines: input.lines },
    {
      vatRate: input.vatRate ?? settings?.vat_rate ?? 14,
      discountRate: input.discountRate ?? settings?.discount_rate ?? 3,
      pricesIncludeTax: (settings?.prices_include_tax ?? 1) === 1,
    },
  );
  const item: QueuedInvoice = {
    opId: op, serial, createdAt: new Date().toISOString(),
    guestName: input.guestName, roomNumber: input.roomNumber, total: calc.total,
    payload: { ...input, serial, opId: op },
  };
  await qPut(item);
  return item;
}

export const listQueue = qAll;
export const removeQueued = qDel;
export const pendingCount = async () => (await qAll()).length;

// Push every queued invoice to the server; drop the ones the server accepted.
// A 4xx means the payload is permanently invalid (e.g. no lines) — keep it so
// it can be corrected, but count it as rejected so the UI can flag it. A network
// error (TypeError) means we're still offline, and a 5xx is a transient server
// fault (a bad migration, an outage) — both stop the run and retry later, so a
// valid invoice is never permanently wedged by a temporary failure.
export async function syncNow(): Promise<{ sent: number; failed: number; rejected: number }> {
  const items = (await qAll()).sort((a, b) => a.serial - b.serial);
  let sent = 0; let failed = 0; let rejected = 0;
  for (const it of items) {
    try {
      await api.post('/api/invoices', it.payload);
      await qDel(it.opId);
      sent++;
    } catch (e) {
      failed++;
      if (e instanceof TypeError) break;
      const status = e instanceof ApiError ? e.status : 0;
      if (status >= 500) break;
      rejected++;
    }
  }
  return { sent, failed, rejected };
}

export function isOnline(): boolean { return typeof navigator === 'undefined' ? true : navigator.onLine; }

// ---- offline session -------------------------------------------------------
// The last known user is cached so the app can open and work offline instead of
// falling back to the login screen when the network is down. The server session
// is still the source of truth: a cached user is only trusted while offline; on
// the next successful call the server's answer replaces it (or clears it on 401).

export async function cacheSession(user: unknown): Promise<void> {
  await kvSet('session', { user, at: new Date().toISOString() });
}

export async function getCachedSession<T>(): Promise<{ user: T; at: string } | null> {
  return (await kvGet<{ user: T; at: string }>('session')) ?? null;
}

export async function clearSession(): Promise<void> {
  await kvSet('session', null);
}

// Cache the tax defaults so invoices can be totalled while offline.
export function cacheSettings(s: { vat_rate: number; discount_rate: number; prices_include_tax: number }): Promise<void> {
  return kvSet('settings', { vat_rate: s.vat_rate, discount_rate: s.discount_rate, prices_include_tax: s.prices_include_tax }).then(() => undefined);
}
