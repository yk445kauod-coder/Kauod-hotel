# Native desktop app (offline + online) — design

Date: 2026-11-10
Status: approved-in-advance by the user ("figure out the best architecture and implement it")

## Intent / why

The hotel needs the invoicing system to keep working when the internet is down,
on several reception machines at once, on weak Windows machines — including
**Windows 7 32-bit with 1–2 GB RAM** — delivered as an **.exe**, not a PWA.

Today the product is a React SPA that talks to a Cloudflare Worker + D1 on every
action. There is no local copy of anything, so a dropped connection stops work.

The change: add a **native Windows desktop client** that keeps a local copy of
the data, works fully offline, and syncs with the existing Cloudflare API when
online. The Cloudflare side (Worker + D1, RLS, sessions, ETA, numbering) stays
the authoritative backend and is reused as-is.

## Goals

- Works fully offline: create invoices, record payments, print, run reports.
- Works online, and across several machines at once (cloud is the hub).
- One small native `.exe` (≈3–8 MB), no installer runtime, no WebView2.
- Runs on Windows 7 SP1 32-bit and 64-bit; low CPU; target < 80 MB RAM.
- Reuses the existing Worker API for auth, numbering, validation, ETA.
- Same professional invoice look as the web app, with the hotel logo.

## Non-goals

- Replacing the web app. The SPA stays for phones/tablets/any browser.
- Rewriting the backend. The Worker/D1 API is unchanged.
- Real-time multi-master (CRDT) editing. Cloud stays authoritative.

## Anti-goals (would make this a failure)

- Two machines printing the same invoice number.
- Offline edits that silently vanish or overwrite each other.
- Anything that needs an internet connection to start the app.
- A heavy runtime (Electron/Tauri/WebView2) that fails on Win7 or eats RAM.

## Constraints

- **Windows 7 32-bit** support rules out every browser-based shell:
  - Tauri → needs WebView2, unsupported on Win7.
  - Electron → ~150 MB, 300–400 MB RAM.
  - PWA → no modern browser on Win7 32-bit.
  ⇒ native compiled UI only.
- **Go 1.20.x is the last release that runs on Windows 7/8** (Go 1.21+ dropped it).
- **32-bit** means the whole dependency tree must build for `GOARCH=386`.
- Target machines: weak CPU, 1–2 GB RAM.

## Approaches considered

1. **Native Go (walk) + local embedded store + cloud sync** — chosen.
   Small exe, native Win32 controls, offline-first, cross-compiles from Linux,
   talks to the existing API.
2. **Tauri / Electron / PWA** — rejected: fail the Win7 32-bit + RAM constraints.
3. **Lazarus/Free Pascal** — even smaller and goes back to XP, but a weaker
   ecosystem and a harder Windows toolchain; Go is the better effort/return.

### Stack (verified by a compile spike)

- **Go 1.20.14** (last Win7-capable).
- **github.com/lxn/walk** — native Win32 GUI (common controls; no WebView2).
- **go.etcd.io/bbolt** — pure-Go embedded transactional store (offline data,
  outbox, caches). Chosen over SQLite because the pure-Go SQLite driver needs
  Go ≥ 1.21; bbolt is a single file, zero deps, and perfect for an outbox.
- **net/http** + **net/http/cookiejar** — talks to the Worker.
- Cross-compiles to `windows/386` **and** `windows/amd64`; spike produced
  ~3 MB exes with `CGO_ENABLED=0`.

## Architecture

```
  ┌────────────── Windows desktop app (Go, walk) ──────────────┐
  │  UI screens ── local reads ──► bbolt store (per machine)    │
  │      │                              ▲                       │
  │      └─ writes ─► store + outbox ───┘                       │
  │  Sync engine (background): pull changes, push outbox        │
  └──────────────────────────┬─────────────────────────────────┘
                             │ HTTPS (cookie session + CSRF)
                 ┌───────────▼───────────┐
                 │  Cloudflare Worker API │  ← authoritative
                 │  D1 + RLS + ETA + no.  │
                 └───────────────────────┘
```

### Local store (bbolt buckets)

- `meta` — server base URL, tenant id, last pull cursor, schema version.
- `auth` — cookie jar snapshot + csrf token (encrypted at rest, DPAPI).
- `invoices` / `lines` / `payments` — mirrored rows keyed by server id.
- `settings`, `rooms`, `guests`, `users` — mirrored reference data.
- `outbox` — queued mutations: `{seq, method, path, body, entity, createdAt}`.
- `reserved` — offline number blocks handed out by the server.
- `syncstate` — per-entity last-synced timestamp / etag.

### Sync model (offline-first, cloud authoritative)

- **Reads** always hit the local store → instant and offline.
- **Writes** apply locally first (optimistic) and enqueue an `outbox` item;
  the sync engine replays them in order when online.
- **Pull**: incremental by `updated_at` per entity; last cursor in `syncstate`.
- **Conflicts**: the cloud row wins on pull; if a pulled row's `updated_at` is
  newer than a locally-modified row, the local change is kept in the outbox
  only if the server still accepts it, otherwise it is surfaced to the user in
  a "needs attention" list. Invoices are only editable while `open`, which
  removes most conflict surface.
- **Idempotency**: every outbox item carries a client-generated `opId`; the
  server ignores duplicates (a lightweight `op_id` table or a header echo).

### Offline invoice numbering (the key decision)

Serials are legal documents and must never collide across machines. Chosen:
**server-issued number blocks per device.**

- Each install has a `device_id` and asks the server to **reserve a block**
  (e.g. 100 numbers) with `POST /api/serial/reserve`.
- Offline, the device allocates from its block (monotonic, gap-free locally).
- Unused numbers at the end of a block simply never appear (acceptable gaps).
- Online, the server still hands out single numbers as today.
- The server rejects any number outside a device's reserved block → no
  collisions, ever. A one-time `serial_start`/override flow stays available.

### UI (native, RTL Arabic)

Screens, matching the web app: Login, Dashboard, Invoices (list + editor),
Print preview, Payments, Reports, Settings, Users, Rooms/Guests, Sync status.
Native Win32 controls, right-to-left, a small embedded font fallback (Segoe UI
+ Tahoma are on every Windows), no web fonts.

### Print

Rendered with GDI (native `Print`/`DrawText`/`Rectangle`), reproducing the
V13 invoice: gradient bar, 3-column header with logo, BILL TO card, navy total
box, lines table, summary, signatures, QR (generated locally), footer, UUID.
`Print Preview` uses the same drawing code onto a window DC.

## Packaging & build

- `make build` → `kaoud-hotel-386.exe` and `kaoud-hotel-amd64.exe`.
- Windows build via **GitHub Actions `windows-latest`** (also builds the 386
  target), producing signed-ready artifacts. Linux can cross-compile too.
- Single self-contained exe; the bbolt data file lives next to it or in
  `%APPDATA%\KaoudHotel`.
- Code-signing (when a cert is available) to avoid SmartScreen warnings.

## Security

- Passwords never stored; only the session cookie, encrypted at rest with
  **Windows DPAPI** (per-user).
- All traffic over HTTPS to the existing Worker; CSRF token persisted and
  echoed on writes.
- Local store encrypted via DPAPI-wrapped key.
- The app never bypasses the server's auth/RLS; offline reads are only of data
  the user already synced.

## What's left to the builder

- Exact screen layout and Arabic copy.
- The `op_id` idempotency mechanism on the server (small migration).
- Auto-update channel (out of scope for v1; manual exe replace).
- Reports parity details (which reports ship in v1).
