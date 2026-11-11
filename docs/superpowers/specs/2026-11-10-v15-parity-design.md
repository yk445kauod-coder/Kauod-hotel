# V15 feature parity (structure-first) — design

Date: 2026-11-10

## Intent / why

The user wants the deployed app to have **every feature** of
`Kaoud-Invoice-WorldClass-V15.html` (the reference single-file app), no more
and no fewer in terms of capability — but built on the current, better
structure and stack, and **keeping the current visual design** (not V15's
markup). The point is: same features, cleaner architecture.

## Goals

- Every V15 capability is reachable in the app.
- The employee workflow (سليمة → مقفولة → x) behaves exactly like V15.
- One clean state machine instead of V15's three parallel fields
  (`status` + `lock` + `print`).

## Non-goals / anti-goals

- Not copying V15's architecture (single HTML file, localStorage as the store,
  plaintext passwords, client-only).
- Not changing the app's look, layout, tabs, or component style.
- Anti-goal: reintroducing a hardcoded default password, or an unguarded
  "wipe all data" that can destroy real tenant data.

## Constraints

- Stack stays: Cloudflare Workers (Hono) + D1 + custom RLS auth + React/Vite.
- Existing tests (62) must keep passing; offline/outbox model stays intact.
- Financial-record invariants stay: serial audit trail, cancelled rows retained,
  InstaPay-only payments, `activatePlan` for plans.

## Approaches considered (from the conversation)

- **A — literal triple state:** add `lock` + `print` columns beside `status`.
  Maximal fidelity, but duplicates state (the exact "bad structure" being
  avoided). Rejected.
- **B — one extended state machine (chosen):** keep a single `status`, extend it
  to `draft → open → locked → printed`, plus `cancelled`. Same rules and same
  user-visible behaviour as V15, clean internals.
- **C — minimal (x-only):** keep the current gate and only add an x confirm.
  Too little to count as parity. Rejected.

## Design

### 1. Invoice state machine (option B)

Single `status` column. Values:

| status | V15 equivalent | meaning |
|---|---|---|
| `open` | سليمة / مفتوحة | editable, active |
| `locked` | مقفولة | final for amounts, ready to print, ETA submitted |
| `printed` | مقفولة + x | print confirmed, immutable for employees |
| `cancelled` | ملغية | void, kept for the serial audit trail |
| `draft` | — | retained in the enum for future use; not produced today |

Transitions (who may do them):

- create → `open` (admin/manager/reception)
- `POST /:id/lock`: `open → locked` (admin/manager/**reception** — V15 lets the
  employee lock after confirming the invoice is correct)
- `POST /:id/print-confirm` (NEW): `locked → printed` (admin/manager/reception)
- `POST /:id/unlock`: `printed → locked` or `locked → open` (**admin only**;
  employee can never step back)
- `POST /:id/cancel`: `open|locked|printed → cancelled` (admin/manager only;
  employee can never cancel) — unchanged
- `PUT /:id` (edit): only while `open`

This reproduces V15's rules exactly:
- employee cannot cancel;
- employee cannot print directly (create leaves `open`; the print page/endpoint
  needs `locked`);
- order enforced: سليمة → مقفولة → x;
- employee cannot clear the x (only `unlock`, admin-only, moves it back);
- once `locked`/`printed`, employee cannot edit.

### 2. Feature parity checklist (V15 → app)

Already present (no work): login + roles, invoice form (multi-line, richer than
V15's fixed fields), 14% VAT + 3% discount, lock, cancel (soft, with reason),
A4 print with ETA QR + tafqeet, serial audit (missing/duplicate/cancelled),
reports + Excel/CSV export, users CRUD, audit log, JSON backup (download) +
import, settings (branding, logo, tax, serial start/override), daily report by
payment method, user monitoring.

To add:

1. **`printed` (x) step** — endpoint + UI button + register column + badge.
2. **"إنشاء وطباعة" (save & print)** — admin: create → lock → printed in one
   action; reception: create → open only (matches V15 `saveAndPrint`).
3. **Daily automatic backup + reminder banner** — keep the last ~7 daily
   snapshots **server-side** (new `backups` table) and show a dismissible
   "اعمل نسخة احتياطية النهاردة" banner; "تحميل نسخة احتياطية" downloads the
   snapshot. (V15 used localStorage; we keep the data in D1.)
4. **Reset default login** → **safe re-translation**: "إعادة تعيين كلمة مرور
   المدير" that sets a **random** password shown once. No fixed default password.
5. **Clear all data** → **safe re-translation**: owner-only
   (`is_platform_admin`), typed confirmation (`مسح`), clears **operational data**
   (invoices, lines, payments, rooms, guests, reservations, counters, device
   blocks, backups) but **never users/sessions/settings**. Audit-logged.
6. **Register search** (guest/room/date-range/number) — confirm parity of the
   existing filter bar; add any missing field.
7. **Coloured badges** — status badges already exist; ensure cancelled/printed
   colours are distinct (styles only).
8. **Show/hide password** — impossible for stored passwords (hashed); keep the
   existing "تغيير كلمة المرور" action. Add show/hide on the **login** password
   field only (client-side convenience).

Explicitly **not** ported:
- **Language toggle (EN/AR):** in V15 it only flips direction; there is no
  English content. No value → skipped (user confirmed "سيب الشكل الأحدث").
- **localStorage persistence / plaintext users:** replaced by the existing
  server + hashed-auth design.

### 3. Data / API changes

- **Migration `0006_printed_and_backups.sql`** (the one that actually matters):
  - SQLite enforces status via `CHECK (status IN ('draft','open','locked','cancelled'))`
    in `0001_init.sql:115`, so `'printed'` is rejected at the DB. SQLite cannot
    alter a CHECK: the migration **rebuilds the `invoices` table** (create new,
    copy, drop, rename) with `CHECK (status IN ('draft','open','locked','printed','cancelled'))`.
  - New table `backups(id, tenant_id, day, payload, created_at, UNIQUE(tenant_id, day))`.
- **Type unions** (not just the Zod enum): `packages/core/src/types.ts` `InvoiceStatus`
  and `apps/web/src/types.ts` `InvoiceSummary.status`; add `printed` to
  `STATUS_LABEL` (`apps/web/src/format.ts`) and a `.badge.printed` rule
  (`apps/web/src/styles.css`). (`InvoiceStatusSchema` is currently unused but
  will be updated for consistency.)
- **Route guards → allowlists** (today they are denylists and would leak `printed`):
  - `PUT /:id`: only when `status === 'open'`.
  - `lock`: only `open → locked`; must not touch `printed`/`cancelled`.
  - `print-confirm` (NEW): only `locked → printed`.
  - `unlock`: `printed → locked` or `locked → open` (admin only); never from `cancelled`.
  - `cancel`: `open|locked|printed → cancelled` (admin/manager).
  - print endpoint gate: `locked | printed | cancelled`.
  - `eta.ts` submit guard: widen to `locked | printed` (else printing blocks ETA).
- **New routes:** `POST /api/invoices/:id/print-confirm`;
  `GET/POST /api/backups/*` (list + download); `POST /api/admin/reset-admin-password`;
  `POST /api/admin/clear-data`. `print-confirm`/`clear-data` are **online-only**
  (not routed through the outbox): a replayed `print-confirm` after an `unlock`
  must not silently re-print.
- **ETA is a separate step, not part of `lock`** (today it is `POST /:id/eta/submit`,
  role admin/manager/accountant). This design does not change that.

### 4. Roles

- `reception` gains `lock` and `print-confirm` (V15 parity). The UI must stop
  hiding the lock button from reception (`Invoices.tsx:491`) and the status
  filter must include `printed`.
- Cancel stays admin/manager. Unlock stays admin. Clear-data owner-only
  (**`users.is_owner`** — there is no `is_platform_admin` column; that memory
  note refers to a different flag).
- ETA submit stays admin/manager/accountant (unchanged; reception excluded).

### 5. Clear-all-data (safe re-translation)

Owner-only (`isOwner`), typed confirmation (`مسح`). Deletes tenant-scoped
operational rows: `invoices, invoice_lines, payments, rooms, guests,
reservations, eta_queue, device_serials, op_ids, op_log, backups`. Then
**re-seeds `counters`** from `settings.serial_start` (deleting it without a
re-seed makes every create return 500 `counter_missing`). **Keeps**
`users, sessions, settings, tenants` and the `audit_log` (V15 keeps history;
the wipe itself is audit-logged). The client clears its outbox queue first so
queued ops cannot resurrect invoices.

### 6. Daily backup (no scheduler available)

There is no cron trigger in `wrangler.toml`, so "automatic" is done
**lazily**: the first authenticated request of the day writes one snapshot row
per tenant into `backups` (idempotent via `UNIQUE(tenant_id, day)`), and the UI
shows a dismissible banner with "تحميل نسخة احتياطية" when today's snapshot
exists. Retention: keep the last 7 days.


## What's left to the builder

- Exact wording of Arabic labels and the banner copy.
- Whether `printed` also fires an ETA (ETA stays attached to `lock`, unchanged).
- The precise set of tables cleared by "clear all data" (default: all operational
  tables, never `users`/`sessions`/`settings`).
- Tests: state-machine transition matrix, role gates, backup snapshot, clear-data
  guard, reset-password.
- Deployment: API worker + Pages, then push to `origin/main`.
