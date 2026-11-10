# Full Offline Writes + Logout Guard + Sync Indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every data-entry write (invoices, payments, lock/unlock/cancel, rooms, guests, reservations) work offline and sync when the network returns; cache the last good read lists so the app is usable offline; block logout while writes are pending; and show a clear sync indicator.

**Architecture:** A client-side **outbox** (one IndexedDB queue of operations) executes optimistically in the UI and flushes FIFO on reconnect. The server gains a generic **idempotency** guard (`X-Op-Key` header -> `op_log` table) and **accepts client-supplied ids** so offline-created rows are referenceable. Read lists are served from a last-good **read cache** when offline.

**Tech Stack:** Cloudflare Workers + Hono + D1 (API); React + Vite + IndexedDB (web); Zod schemas in `@kaoud/core`; Vitest (node) for both sides.

**Spec:** `docs/superpowers/specs/2026-11-10-full-offline-writes-design.md`

## Global Constraints

- Server id format: `^[a-z]{2,5}_[0-9a-f]{24}$` (e.g. `room_ab12...`, `gst_...`, `res_...`, `pay_...`, `inv_...`). One shared helper `newId(prefix)` in `@kaoud/core`.
- Idempotency header is exactly `X-Op-Key`; the table is `op_log(tenant_id, op_key, status, body, created_at)` with `PRIMARY KEY (tenant_id, op_key)`.
- Only **2xx** responses are recorded in `op_log`; replays return the stored status + body.
- Outbox flush order is **FIFO by `createdAt`**; a network error **stops** the flush; a 4xx other than 401/409 marks the op **rejected** (kept, shown, retryable/discardable).
- Admin/security writes stay online-only (users, settings, serial, ETA submit, password, import/backup).
- All Arabic UI copy stays RTL; `.no-print` on anything that must not print.
- Every task ends green: `npm run typecheck` and `npx vitest run` pass before commit.

## Review Focus

- **Double-submit safety:** the same outbox op flushed twice (retry, or two tabs) must create exactly one row - verified by an API test that posts twice with the same `X-Op-Key`.
- **Network failure mid-flush:** a `TypeError` from `fetch` must leave the op queued and stop the flush - verified by an outbox test.
- **Logout with pending work:** the guard must not log out while pending ops remain - verified by a test of the guard predicate.
- **Offline read:** with the network down, a cached list must render (not error) - verified by a cache test.
- **Offline-created row visible immediately:** a queued create must appear in the list from cache before it is flushed - verified by a cache-append test.

---

### Task 1: Server - generic idempotency (`X-Op-Key` + `op_log`)

**Files:**
- Create: `apps/api/migrations/0005_op_log.sql`
- Create: `apps/api/src/idempotency.ts`
- Modify: `apps/api/src/routes/invoices.ts` (add `idempotency()` to the 6 write routes)
- Modify: `apps/api/src/routes/directory.ts` (add to the 5 write routes)
- Modify: `apps/api/src/http.ts` (allow `X-Op-Key` in CORS)
- Test: `apps/api/test/api.test.ts`

**Interfaces:**
- Produces: `idempotency()` - a Hono middleware factory. Reads `X-Op-Key`; for non-GET requests, if `op_log` has the key for the caller's tenant it returns the stored response, else it runs `next()` and, when the response is 2xx, stores `{status, body}`.

- [ ] **Step 1: Write the migration**

```sql
-- Generic idempotency log. Any write carrying an X-Op-Key header is recorded
-- once; a replay returns the stored response instead of re-applying the write.
CREATE TABLE IF NOT EXISTS op_log (
  tenant_id  TEXT    NOT NULL,
  op_key     TEXT    NOT NULL,
  status     INTEGER NOT NULL,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (tenant_id, op_key)
);
```

- [ ] **Step 2: Implement `idempotency()` in `apps/api/src/idempotency.ts`**

Signature: `export function idempotency()`. Run it **after** `requireAuth()` so `c.get('auth')` and `c.get('db')` exist. On a stored hit, return `new Response(stored.body, { status: stored.status, headers: { 'content-type': 'application/json' } })`. After `next()`, clone `c.res` and persist only when `c.res.status` is 200-299. Use `INSERT OR IGNORE`.

- [ ] **Step 3: Add `idempotency()` to write routes**

In `invoices.ts` and `directory.ts`, append `idempotency()` to each mutating route's middleware chain, e.g. `requireAuth(), requireRole('admin','manager'), idempotency(), async (c) => {…}`. Do **not** add it to GET routes.

- [ ] **Step 4: Allow the header in CORS** (`apps/api/src/http.ts`)

`'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Op-Key'`.

- [ ] **Step 5: Write the failing test** (append to `apps/api/test/api.test.ts`)

```ts
it('applies a write with the same X-Op-Key exactly once', async () => {
  const ctx = await sharedCtx();
  const body = JSON.stringify({ number: 'op-1', nightlyRate: 100 });
  const first = await req('/api/rooms', { method: 'POST', headers: { 'X-Op-Key': 'k-rooms-1' }, body }, ctx);
  const second = await req('/api/rooms', { method: 'POST', headers: { 'X-Op-Key': 'k-rooms-1' }, body }, ctx);
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  const a = await first.json() as { id: string };
  const b = await second.json() as { id: string };
  expect(b.id).toBe(a.id);
  const list = await (await req('/api/rooms', {}, ctx)).json() as { rooms: { number: string }[] };
  expect(list.rooms.filter((r) => r.number === 'op-1')).toHaveLength(1);
});
```

Note: `req` merges `init.headers` over its defaults.

- [ ] **Step 6: Run** `npx vitest run apps/api` -> the new test fails first (no idempotency), then passes after Steps 1-5.

- [ ] **Step 7: Commit** `feat(api): generic X-Op-Key idempotency for write routes`

---

### Task 2: Shared `newId` + client-supplied ids on the server

**Files:**
- Create: `packages/core/src/ids.ts`; Modify: `packages/core/src/index.ts` (export)
- Modify: `packages/core/src/schemas.ts` (add optional `id`; relax `guestId`/`reservationId` to the id pattern)
- Modify: `apps/api/src/audit.ts` (re-export `newId` from core)
- Modify: `apps/api/src/routes/directory.ts`, `apps/api/src/routes/invoices.ts`, `apps/api/src/invoices.ts`
- Test: `apps/api/test/api.test.ts`, `packages/core/test/ids.test.ts`

**Interfaces:**
- Produces: `newId(prefix: string): string` and `IdSchema` (Zod string matching the global id pattern) in `@kaoud/core`.
- Consumes: Task 1's routes.

- [ ] **Step 1: Write the failing core test** (`packages/core/test/ids.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { newId, IdSchema } from '../src/index.js';
describe('newId', () => {
  it('matches the id pattern and is unique', () => {
    const a = newId('room'); const b = newId('room');
    expect(IdSchema.safeParse(a).success).toBe(true);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Implement `packages/core/src/ids.ts`**

`newId(prefix)` -> `` `${prefix}_${hex24}` `` using `crypto.getRandomValues(new Uint8Array(12))`. `IdSchema = z.string().regex(/^[a-z]{2,5}_[0-9a-f]{24}$/)`. Export both from `index.ts`.

- [ ] **Step 3: Re-export from `apps/api/src/audit.ts`** so existing `import { newId } from '../audit.js'` still works: `export { newId } from '@kaoud/core';` (keep the `audit` function).

- [ ] **Step 4: Add optional `id` to schemas and relax cross-references**

In `schemas.ts`: add `id: IdSchema.optional()` to `RoomSchema`, `GuestSchema`, `ReservationSchema`, `PaymentSchema`, and `InvoiceInputSchema`; change `guestId`/`reservationId` from `.uuid()` to `IdSchema.optional()`.

- [ ] **Step 5: Use the supplied id in routes**

`directory.ts` rooms/guests/reservations: `const id = parsed.data.id ?? newId('room')` (and `'gst'`, `'res'`). `routes/invoices.ts` payments: `const id = parsed.data.id ?? newId('pay')`. `invoices.ts` `createInvoice`: accept `input.id` - `const id = input.id ?? newId('inv')` - and keep inserting it.

- [ ] **Step 6: Write the failing test**

```ts
it('accepts a client-supplied id (offline-created row)', async () => {
  const ctx = await sharedCtx();
  const id = newId('room');
  const res = await req('/api/rooms', { method: 'POST', body: JSON.stringify({ id, number: 'cli-1', nightlyRate: 50 }) }, ctx);
  expect(res.status).toBe(201);
  expect((await res.json() as { id: string }).id).toBe(id);
});
```

- [ ] **Step 7: Run** `npx vitest run packages/core apps/api` -> pass.

- [ ] **Step 8: Commit** `feat(core): shared newId + client-supplied ids`

---

### Task 3: Web - generic outbox + `api` op-key support

**Files:**
- Modify: `apps/web/src/offline.ts` (DB v2: add `outbox` store)
- Create: `apps/web/src/outbox.ts`
- Modify: `apps/web/src/api.ts` (accept an optional `opKey` and send `X-Op-Key`)
- Test: `apps/web/test/outbox.test.ts`

**Interfaces:**
- Produces: `OutboxOp { opKey; method; path; body?; label; createdAt; status: 'pending'|'rejected'; error? }`; `enqueueOp(op)`, `listOps()`, `removeOp(opKey)`, `flushOutbox(): Promise<{sent:number; failed:number}>`, `mutate({method,path,body,label}): Promise<{queued:boolean}>`.
- Produces: `api.request<T>(path, { method, body, opKey })`.

- [ ] **Step 1: Bump the IndexedDB version and add the store** in `offline.ts` (`DB_VERSION = 2`; in `onupgradeneeded` create `outbox` with `keyPath: 'opKey'`).

- [ ] **Step 2: Write the failing test** (`apps/web/test/outbox.test.ts`)

```ts
it('queues a write when the network is down and flushes it later', async () => {
  vi.mocked(api.request).mockRejectedValue(new TypeError('failed to fetch'));
  const r = await mutate({ method: 'POST', path: '/api/rooms', body: { number: '1' }, label: 'غرفة' });
  expect(r.queued).toBe(true);
  expect(await listOps()).toHaveLength(1);
  vi.mocked(api.request).mockResolvedValue({} as never);
  expect(await flushOutbox()).toEqual({ sent: 1, failed: 0 });
  expect(await listOps()).toHaveLength(0);
});
```

- [ ] **Step 3: Implement `outbox.ts`** - `mutate` tries `api.request` first when `isOnline()`; on `TypeError` it enqueues; other errors rethrow. `flushOutbox` sorts by `createdAt`, calls `api.request` with `opKey`, removes on success, marks rejected on 4xx (except 401/409), breaks on `TypeError`.

- [ ] **Step 4: Add `opKey` to `api.request`** - set `X-Op-Key` when provided.

- [ ] **Step 5: Run** `npx vitest run apps/web` -> pass. **Commit** `feat(web): generic offline outbox + op-key`

---

### Task 4: Web - read cache + `useCachedList`

**Files:**
- Create: `apps/web/src/cache.ts`
- Create: `apps/web/src/useCachedList.ts`
- Test: `apps/web/test/cache.test.ts`

**Interfaces:**
- Produces: `cacheSet(key, data)`, `cacheGet<T>(key): Promise<{data:T; at:string}|null>`, `cacheAppend(key, item)`, `cacheUpdate(key, match, patch)` (all operate on a stored `{data, at}` envelope; append/update only apply when the cached value is an array).
- Produces: `useCachedList<T>(key, path, enabled?): { data:T|null; fromCache:boolean; loading:boolean; reload:()=>Promise<void> }`.

- [ ] **Step 1: Write the failing test** - `cacheSet('k',[1])` then `cacheAppend('k',2)` -> `cacheGet('k').data` is `[1,2]`; `cacheGet` on a missing key is `null`.

- [ ] **Step 2: Implement `cache.ts`** over the same IndexedDB (`KV` store, key `cache:<key>`).

- [ ] **Step 3: Implement `useCachedList`** - on mount, `api.get(path)` -> `cacheSet` + set state; on `TypeError` fall back to `cacheGet` with `fromCache=true`. Expose `reload`.

- [ ] **Step 4: Run** `npx vitest run apps/web` -> pass. **Commit** `feat(web): offline read cache`

---

### Task 5: Web - route Directory + Invoices writes through the outbox, lists through cache

**Files:**
- Modify: `apps/web/src/pages/Directory.tsx`, `apps/web/src/pages/Invoices.tsx`
- Modify: `apps/web/src/App.tsx` (pass `offline`/`online` down where needed)

**Interfaces:**
- Consumes: `mutate`, `useCachedList`, `cacheAppend`, `cacheUpdate`.

- [ ] **Step 1:** Directory rooms/guests/reservations: replace direct `api.post` with `mutate(...)`; on `queued:true`, `cacheAppend` the new row (with the client `newId` and a local `createdAt`) so it shows immediately. Load lists via `useCachedList` with keys `rooms`/`guests`/`reservations`.

- [ ] **Step 2:** Invoices: route `update`, `lock`, `unlock`, `cancel`, `payments` (create/delete) through `mutate`. Keep create-online as-is; keep offline create via the serial block. Load the invoice list via `useCachedList` (key `invoices`).

- [ ] **Step 3:** Show a small `.muted` badge «بيانات آخر اتصال» when `fromCache` is true.

- [ ] **Step 4:** Run `npm run typecheck` + `npx vitest run` -> pass. **Commit** `feat(web): offline writes for directory + invoice actions`

---

### Task 6: Web - logout guard + sync indicator + pending-ops view

**Files:**
- Modify: `apps/web/src/useOffline.ts` (flush the outbox alongside the invoice queue; expose `pending`, `rejected`)
- Modify: `apps/web/src/App.tsx` (logout guard)
- Modify: `apps/web/src/components/DynamicIsland.tsx` (spinner + count, pending list, retry)
- Modify: `apps/web/src/styles.css` (top sync bar, spinner, toast)
- Test: `apps/web/test/logout.test.ts`

**Interfaces:**
- Produces: `canLogout(pending: number, online: boolean): boolean` (pure, testable) and `syncAll()`.

- [ ] **Step 1: Write the failing test**

```ts
import { canLogout } from '../src/useOffline';
it('blocks logout while work is pending', () => {
  expect(canLogout(0, true)).toBe(true);
  expect(canLogout(2, true)).toBe(false);
  expect(canLogout(0, false)).toBe(true);
});
```

- [ ] **Step 2: Implement `canLogout` + `syncAll`** in `useOffline.ts`; `pending` = invoice queue + outbox count.

- [ ] **Step 3: Logout guard** in `App.tsx`: on logout, `await syncAll()`; if `pending > 0` after, show «لازم ترفع العمليات المعلّقة الأول (N)» and do not log out.

- [ ] **Step 4: Indicator** - island pill shows a spinner + `N` while `syncing`/`pending`; a fixed top bar (`.sync-bar`, `.no-print`) is visible while syncing; a toast «تم رفع N عملية» on completion; the island panel lists pending/rejected ops with «أعد المحاولة» / «تجاهل».

- [ ] **Step 5: Run** `npm run typecheck` + `npx vitest run` -> pass. **Commit** `feat(web): logout guard + sync indicator`

---

### Task 7: Deploy + verify (mandatory)

**Files:** none (operations)

- [ ] **Step 1:** `set -a && . ./.dev.vars && set +a` then `npx wrangler d1 migrations list kaoud_hotel --remote --config apps/api/wrangler.toml` - confirm **only** `0005_op_log.sql` is pending (no drift).
- [ ] **Step 2:** `npx wrangler d1 migrations apply kaoud_hotel --remote --config apps/api/wrangler.toml` -> `0005` done. Verify: `SELECT name FROM sqlite_master WHERE name='op_log'`.
- [ ] **Step 3:** `npm run deploy:api` -> new Version ID.
- [ ] **Step 4:** `npm run deploy:web` -> new Pages deployment URL.
- [ ] **Step 5: Live smoke** - `curl` `/api/health` = 200; `curl -X POST /api/rooms` without auth = 401.
- [ ] **Step 6:** Confirm no real data was deleted (row counts unchanged for `invoices`, `users`, `guests`).
- [ ] **Step 7: Commit** any version-stamp/doc change; report the deployed URLs.

---

## Self-Review

- **Spec coverage:** offline writes (Tasks 3,5), read cache (Task 4), logout guard (Task 6), sync indicator (Task 6), server idempotency (Task 1), client ids (Task 2), deployment (Task 7). All spec sections mapped.
- **Step scan:** each step names the file, the signature, and a checkable command.
- **Type consistency:** `newId`/`IdSchema` (Task 2) are the same names used in Tasks 3/5; `mutate`/`flushOutbox`/`listOps` (Task 3) match Task 6's usage; `useCachedList`/`cacheAppend` (Task 4) match Task 5.
- **Review Focus:** each of the five lines has a test in Tasks 1/3/4/6.
- **Proportion:** the plan is a set of decisions, not a transcript.
