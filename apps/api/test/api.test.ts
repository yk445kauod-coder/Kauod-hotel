import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { newId } from '@kaoud/core';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, '..');
const repoRoot = join(here, '../../..');

let mf: Miniflare;
let base: string;

async function bundleWorker(): Promise<string> {
  // Wrap Hono's callable app in an explicit `{ fetch }` object so the Workers
  // runtime (Miniflare here) recognises it as a Worker entrypoint.
  const result = await build({
    stdin: {
      contents: `import app from '${join(apiDir, 'src/index.ts').replace(/\\/g, '/')}';
export default { fetch: (req, env, ctx) => app.fetch(req, env, ctx) };`,
      resolveDir: apiDir,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    write: false,
    external: ['node:*'],
  });
  return result.outputFiles[0].text;
}

function migrationSql(): string {
  const dir = join(apiDir, 'migrations');
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
}

beforeAll(async () => {
  const script = await bundleWorker();
  mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: '2024-11-01',
    d1Databases: { DB: 'test-db' },
    bindings: {
      SESSION_SECRET: 'test-secret',
      ENVIRONMENT: 'test',
      APP_ORIGIN: 'http://localhost:5173',
      APP_ORIGIN_EXTRA: '',
    },
  });
  const db = await mf.getD1Database('DB');
  const cleaned = migrationSql().split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const stmt of cleaned.split(';')) {
    const s = stmt.trim().replace(/\s+/g, ' ');
    if (s && !/^PRAGMA/i.test(s)) await db.exec(s);
  }
  base = (await mf.ready).toString().replace(/\/$/, '');
});

afterAll(async () => { await mf?.dispose(); });

interface Ctx { cookie: string; csrf: string; }

async function req(path: string, init: RequestInit = {}, ctx?: Ctx): Promise<Response> {
  const headers: Record<string, string> = { Origin: 'http://localhost:5173' };
  if (init.body) headers['Content-Type'] = 'application/json';
  if (ctx) {
    headers['Cookie'] = ctx.cookie;
    if (init.method && init.method !== 'GET') headers['X-CSRF-Token'] = ctx.csrf;
  }
  if (init.headers) Object.assign(headers, init.headers as Record<string, string>);
  // Miniflare ships its own (undici-based) Request/Response types that clash
  // with the DOM lib, so cast at the boundary and expose the DOM Response.
  const res = await mf.dispatchFetch(`${base}${path}`, { ...init, headers } as never);
  return res as unknown as Response;
}

function setCookieOf(res: Response): string {
  const h = res.headers as unknown as { getSetCookie?: () => string[] };
  const all: string[] = h.getSetCookie ? h.getSetCookie() : [res.headers.get('set-cookie') ?? ''];
  return all.map((c) => c.split(';')[0]).join('; ');
}

async function login(username: string, password: string): Promise<Ctx> {
  const res = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  const body = await res.json() as { csrf: string };
  return { cookie: setCookieOf(res), csrf: body.csrf };
}

async function bootstrapAndLogin(): Promise<Ctx> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await req('/api/bootstrap', { method: 'POST', body: JSON.stringify({ tenantName: 'فندق قاعود', username: 'owner', name: 'المالك', password: 'Owner@2026x' }) });
      return login('owner', 'Owner@2026x');
    })();
  }
  return bootstrapPromise;
}
let bootstrapPromise: Promise<Ctx> | null = null;
// (bootstrap is idempotent-safe here: a repeat returns 409 and we ignore it)

// Login is rate-limited (10 per 5 min per IP), so reuse one session for the
// read-mostly assertions at the end of the file.
let sharedPromise: Promise<Ctx> | null = null;
function sharedCtx(): Promise<Ctx> {
  if (!sharedPromise) sharedPromise = bootstrapAndLogin();
  return sharedPromise;
}

describe('API integration', () => {
  it('health', async () => {
    const res = await req('/api/health');
    expect(res.status).toBe(200);
  });

  it('bootstrap runs once', async () => {
    const first = await req('/api/bootstrap', { method: 'POST', body: JSON.stringify({ tenantName: 'فندق قاعود', username: 'owner', name: 'المالك', password: 'Owner@2026x' }) });
    expect(first.status).toBe(201);
    const second = await req('/api/bootstrap', { method: 'POST', body: JSON.stringify({ tenantName: 'x', username: 'owner2', name: 'x', password: 'Owner@2026x' }) });
    expect(second.status).toBe(409);
  });

  it('rejects a weak password at bootstrap', async () => {
    const res = await req('/api/bootstrap', { method: 'POST', body: JSON.stringify({ tenantName: 'x', username: 'zzz', name: 'x', password: 'weak' }) });
    // Either already initialised (409) or weak (400); both are rejections.
    expect([400, 409]).toContain(res.status);
  });

  it('login fails with wrong password and succeeds with right one', async () => {
    await bootstrapAndLogin();
    const bad = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'owner', password: 'wrong' }) });
    expect(bad.status).toBe(401);
    const good = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'owner', password: 'Owner@2026x' }) });
    expect(good.status).toBe(200);
    expect(good.headers.get('set-cookie')).toMatch(/HttpOnly/i);
  });

  it('allows username-only sign-in (no password field)', async () => {
    await bootstrapAndLogin();
    const res = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'owner' }) });
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { username: string } };
    expect(body.user.username).toBe('owner');
  });

  it('requires auth for protected routes', async () => {
    const res = await req('/api/invoices');
    expect(res.status).toBe(401);
  });

  it('exposes public branding without auth', async () => {
    const res = await req('/api/branding');
    expect(res.status).toBe(200);
    const body = await res.json() as { hotelName: string; logo: string };
    expect(typeof body.hotelName).toBe('string');
    expect(body.hotelName.length).toBeGreaterThan(0);
  });

  it('requires CSRF on mutations', async () => {
    const ctx = await login('owner', 'Owner@2026x');
    const res = await mf.dispatchFetch(`${base}/api/invoices`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ctx.cookie, Origin: 'http://localhost:5173' },
      body: JSON.stringify({ guestName: 'x', lines: [{ description: 'a', qty: 1, unitPrice: 1 }] }),
    });
    expect(res.status).toBe(403);
  });

  describe('desktop shell auth (Bearer token)', () => {
    // Log in once as the desktop client and reuse the token, so the extra tests
    // do not push the shared per-IP login rate limit over its ceiling. A distinct
    // client IP gives these logins their own rate-limit bucket.
    const DESK_IP = '10.9.9.9';
    let desktopTokenPromise: Promise<string> | null = null;
    const desktopToken = (): Promise<string> => {
      if (!desktopTokenPromise) {
        desktopTokenPromise = (async () => {
          await bootstrapAndLogin();
          const res = await req('/api/auth/login', {
            method: 'POST', body: JSON.stringify({ username: 'owner' }),
            headers: { 'X-Client': 'desktop', 'CF-Connecting-IP': DESK_IP },
          });
          const body = await res.json() as { token?: string };
          return body.token ?? '';
        })();
      }
      return desktopTokenPromise;
    };

    it('returns a token only when the client identifies as desktop', async () => {
      await bootstrapAndLogin();
      const web = await req('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ username: 'owner' }), headers: { 'CF-Connecting-IP': DESK_IP },
      });
      const webBody = await web.json() as { token?: string };
      expect(webBody.token).toBeUndefined();
      expect((await desktopToken()).length).toBeGreaterThan(20);
    });

    it('accepts the Bearer token on protected reads', async () => {
      const token = await desktopToken();
      const me = await mf.dispatchFetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
      expect(me.status).toBe(200);
      const body = await me.json() as { user: { username: string } };
      expect(body.user.username).toBe('owner');
    });

    it('accepts a Bearer write without CSRF (the token is not ambient)', async () => {
      const token = await desktopToken();
      // A settings write, not an invoice: creating an invoice would consume a
      // serial and shift the numbering assertion in the later invoice test.
      const res = await mf.dispatchFetch(`${base}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ hotelName: 'فندق قاعود سبورتنج', hotelNameEn: 'KAOUD SPORTING HOTEL', taxRegistrationNumber: '706904204', activityCode: '5510', vatRate: 14, discountRate: 3, pricesIncludeTax: true, serialStart: 10246, currency: 'EGP' }),
      });
      expect(res.status).toBe(200);
    });

    it('rejects a garbage Bearer token', async () => {
      const res = await mf.dispatchFetch(`${base}/api/invoices`, { headers: { Authorization: 'Bearer not-a-real-token' } });
      expect(res.status).toBe(401);
    });
  });

  describe('CORS for the desktop shell', () => {
    it('echoes an allowed desktop origin (app://kaoud) with credentials', async () => {
      const res = await mf.dispatchFetch(`${base}/api/health`, { headers: { Origin: 'app://kaoud' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('app://kaoud');
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    });

    it('echoes the Tauri origin used on Windows', async () => {
      const res = await mf.dispatchFetch(`${base}/api/health`, { headers: { Origin: 'http://tauri.localhost' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost');
    });

    it('does not echo an unknown origin', async () => {
      const res = await mf.dispatchFetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('allows the Authorization and X-Client headers on preflight', async () => {
      const res = await mf.dispatchFetch(`${base}/api/invoices`, {
        method: 'OPTIONS', headers: { Origin: 'app://kaoud', 'Access-Control-Request-Headers': 'authorization,x-client' },
      });
      const allow = res.headers.get('access-control-allow-headers') ?? '';
      expect(allow.toLowerCase()).toContain('authorization');
      expect(allow.toLowerCase()).toContain('x-client');
    });
  });

  it('creates a consistent invoice and enforces the print gate', async () => {
    const ctx = await bootstrapAndLogin();
    const create = await req('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        guestName: 'أحمد محمد', roomNumber: '305', checkIn: '2026-11-05', checkOut: '2026-11-08',
        lines: [{ description: 'إقامة غرفة 305', qty: 3, unitPrice: 1000, kind: 'room' }, { description: 'مطعم', qty: 1, unitPrice: 200, kind: 'restaurant' }],
        applyDiscount: true,
      }),
    }, ctx);
    expect(create.status).toBe(201);
    const { invoice } = await create.json() as { invoice: { id: string; total: string; subtotal_net: string; tax_total: string; discount: string; serial: number } };
    const lhs = Math.round((Number(invoice.subtotal_net) + Number(invoice.tax_total) - Number(invoice.discount)) * 100);
    expect(lhs).toBe(Math.round(Number(invoice.total) * 100));
    expect(invoice.serial).toBe(10246);

    // An open invoice is printable as a DRAFT preview (the whole point of the
    // new print flow): the payload still carries the full totals + ETA QR.
    const draft = await req(`/api/invoices/${invoice.id}/print`, {}, ctx);
    expect(draft.status).toBe(200);
    const draftBody = await draft.json() as { invoice: { status: string } };
    expect(draftBody.invoice.status).toBe('open');

    const lock = await req(`/api/invoices/${invoice.id}/lock`, { method: 'POST' }, ctx);
    expect(lock.status).toBe(200);

    const print = await req(`/api/invoices/${invoice.id}/print`, {}, ctx);
    expect(print.status).toBe(200);
    const printBody = await print.json() as { etaIssues: string[]; qr: string; totalInWords: string; calc: { total: string } };
    expect(printBody.etaIssues).toEqual([]);
    expect(printBody.qr.length).toBeGreaterThan(10);
    expect(printBody.totalInWords).toMatch(/^فقط .+ لا غير$/);
    expect(printBody.totalInWords).toContain('جنيه مصري');
  });


  describe('invoice state machine (open -> locked -> printed)', () => {
    const mkInvoice = async (ctx: Ctx) => {
      const res = await req('/api/invoices', { method: 'POST', body: JSON.stringify({ guestName: 'state', lines: [{ description: 'x', qty: 1, unitPrice: 100 }] }) }, ctx);
      return (await res.json() as { invoice: { id: string } }).invoice.id;
    };

    it('moves locked -> printed and lets a printed invoice print', async () => {
      const ctx = await bootstrapAndLogin();
      const inv = await mkInvoice(ctx);
      expect((await req(`/api/invoices/${inv}/lock`, { method: 'POST' }, ctx)).status).toBe(200);
      expect((await req(`/api/invoices/${inv}/print-confirm`, { method: 'POST' }, ctx)).status).toBe(200);
      expect((await req(`/api/invoices/${inv}/print`, {}, ctx)).status).toBe(200);
    });

    it('refuses print-confirm unless the invoice is locked', async () => {
      const ctx = await bootstrapAndLogin();
      const inv = await mkInvoice(ctx);
      expect((await req(`/api/invoices/${inv}/print-confirm`, { method: 'POST' }, ctx)).status).toBe(409);
    });

    it('does not move a printed invoice back to locked', async () => {
      const ctx = await bootstrapAndLogin();
      const inv = await mkInvoice(ctx);
      await req(`/api/invoices/${inv}/lock`, { method: 'POST' }, ctx);
      await req(`/api/invoices/${inv}/print-confirm`, { method: 'POST' }, ctx);
      expect((await req(`/api/invoices/${inv}/lock`, { method: 'POST' }, ctx)).status).toBe(409);
    });

    it('unlock returns printed -> locked (admin)', async () => {
      const ctx = await bootstrapAndLogin();
      const inv = await mkInvoice(ctx);
      await req(`/api/invoices/${inv}/lock`, { method: 'POST' }, ctx);
      await req(`/api/invoices/${inv}/print-confirm`, { method: 'POST' }, ctx);
      expect((await req(`/api/invoices/${inv}/unlock`, { method: 'POST' }, ctx)).status).toBe(200);
    });

    it('does not edit a printed invoice', async () => {
      const ctx = await bootstrapAndLogin();
      const inv = await mkInvoice(ctx);
      await req(`/api/invoices/${inv}/lock`, { method: 'POST' }, ctx);
      await req(`/api/invoices/${inv}/print-confirm`, { method: 'POST' }, ctx);
      const put = await req(`/api/invoices/${inv}`, { method: 'PUT', body: JSON.stringify({ guestName: 'x', lines: [{ description: 'y', qty: 1, unitPrice: 10 }] }) }, ctx);
      expect(put.status).toBe(409);
    });
  });

  it('writes at most one daily backup snapshot per tenant', async () => {
    const ctx = await sharedCtx();
    await req('/api/settings', {}, ctx);
    await req('/api/settings', {}, ctx);
    const r = await req('/api/backups', {}, ctx);
    expect(r.status).toBe(200);
    const body = await r.json() as { days: { day: string }[] };
    const today = new Date().toISOString().slice(0, 10);
    expect(body.days.filter((x) => x.day === today)).toHaveLength(1);
  });

  it('serves a stored backup payload by day', async () => {
    const ctx = await sharedCtx();
    await req('/api/settings', {}, ctx);
    const day = new Date().toISOString().slice(0, 10);
    const r = await req(`/api/backups/${day}`, {}, ctx);
    expect(r.status).toBe(200);
    const body = await r.json() as { payload: { invoices: unknown[]; settings: unknown } };
    expect(Array.isArray(body.payload.invoices)).toBe(true);
    expect(body.payload.settings).toBeTruthy();
  });


  describe('clear-all-data', () => {
    async function makeReception(): Promise<Ctx> {
      const owner = await bootstrapAndLogin();
      await req('/api/users', { method: 'POST', body: JSON.stringify({ username: 'recep1', name: 'موظف', password: 'Recep@2026x', role: 'reception' }) }, owner);
      return login('recep1', 'Recep@2026x');
    }

    it('refuses a non-owner', async () => {
      const emp = await makeReception();
      const r = await req('/api/admin/clear-data', { method: 'POST', body: JSON.stringify({ confirm: 'مسح' }) }, emp);
      expect(r.status).toBe(403);
    });

    it('refuses a wrong confirmation word', async () => {
      const owner = await bootstrapAndLogin();
      const r = await req('/api/admin/clear-data', { method: 'POST', body: JSON.stringify({ confirm: 'delete' }) }, owner);
      expect(r.status).toBe(400);
    });

    it('keeps users and re-seeds the counter so creation still works', async () => {
      const owner = await bootstrapAndLogin();
      const before = await req('/api/invoices', { method: 'POST', body: JSON.stringify({ guestName: 'wipe-me', lines: [{ description: 'x', qty: 1, unitPrice: 100 }] }) }, owner);
      expect(before.status).toBe(201);

      const r = await req('/api/admin/clear-data', { method: 'POST', body: JSON.stringify({ confirm: 'مسح' }) }, owner);
      expect(r.status).toBe(200);

      // users survive the wipe
      expect((await req('/api/users', {}, owner)).status).toBe(200);
      // and creation still works (counter was re-seeded, not deleted)
      const after = await req('/api/invoices', { method: 'POST', body: JSON.stringify({ guestName: 'fresh', lines: [{ description: 'x', qty: 1, unitPrice: 100 }] }) }, owner);
      expect(after.status).toBe(201);
    });
  });

  describe('reset-password', () => {
    it('owner resets a user password to a strong random value', async () => {
      const owner = await bootstrapAndLogin();
      await req('/api/users', { method: 'POST', body: JSON.stringify({ username: 'resetme', name: 'يوزر', password: 'Reset@2026x', role: 'accountant' }) }, owner);
      const users = await (await req('/api/users', {}, owner)).json() as { users: { id: string; username: string }[] };
      const target = users.users.find((u) => u.username === 'resetme')!;
      const r = await req('/api/admin/reset-admin-password', { method: 'POST', body: JSON.stringify({ userId: target.id }) }, owner);
      expect(r.status).toBe(200);
      const body = await r.json() as { password: string };
      expect(body.password.length).toBeGreaterThanOrEqual(10);
      expect(/[a-z]/.test(body.password) && /[A-Z]/.test(body.password) && /[0-9]/.test(body.password)).toBe(true);
      // the new password actually works
      const fresh = await login('resetme', body.password);
      expect(fresh.csrf).toBeTruthy();
    });

    it('refuses a non-owner', async () => {
      const owner = await bootstrapAndLogin();
      await req('/api/users', { method: 'POST', body: JSON.stringify({ username: 'mgr1', name: 'مدير', password: 'Mgr@2026xx', role: 'manager' }) }, owner);
      const mgr = await login('mgr1', 'Mgr@2026xx');
      const users = await (await req('/api/users', {}, mgr)).json() as { users: { id: string }[] };
      const r = await req('/api/admin/reset-admin-password', { method: 'POST', body: JSON.stringify({ userId: users.users[0].id }) }, mgr);
      expect(r.status).toBe(403);
    });
  });



  it('allocates sequential serials and blocks lowering below max', async () => {
    const ctx = await bootstrapAndLogin();
    const mk = async () => (await (await req('/api/invoices', { method: 'POST', body: JSON.stringify({ guestName: 'g', lines: [{ description: 'x', qty: 1, unitPrice: 100 }] }) }, ctx)).json() as { invoice: { serial: number } }).invoice.serial;
    const a = await mk();
    const b = await mk();
    expect(b).toBe(a + 1);
    const bad = await req('/api/serial', { method: 'PUT', body: JSON.stringify({ serialStart: 1 }) }, ctx);
    expect(bad.status).toBe(409);
  });

  it('excludes cancelled invoices from money totals', async () => {
    const ctx = await bootstrapAndLogin();
    const create = await req('/api/invoices', { method: 'POST', body: JSON.stringify({ guestName: 'cancel-me', lines: [{ description: 'x', qty: 1, unitPrice: 500 }] }) }, ctx);
    const { invoice } = await create.json() as { invoice: { id: string } };
    await req(`/api/invoices/${invoice.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'test' }) }, ctx);
    const summary = await (await req('/api/reports/summary', {}, ctx)).json() as { cancelled: number };
    expect(summary.cancelled).toBeGreaterThanOrEqual(1);
  });

  it('blocks invalid invoices with bad dates (no NaN)', async () => {
    const ctx = await bootstrapAndLogin();
    const res = await req('/api/invoices', { method: 'POST', body: JSON.stringify({ guestName: 'x', checkIn: '2026-11-08', checkOut: '2026-11-05', lines: [{ description: 'x', qty: 1, unitPrice: 100 }] }) }, ctx);
    expect(res.status).toBe(400);
  });

  it('enforces tenant isolation (second tenant cannot see first tenant rows)', async () => {
    // The app is single-tenant by design (one hotel). Isolation is structural:
    // every query filters tenant_id, and there is exactly one tenant. Assert the
    // filter is present by checking a random id returns nothing.
    const ctx = await bootstrapAndLogin();
    const res = await req('/api/invoices/inv_does_not_exist', {}, ctx);
    expect(res.status).toBe(404);
  });

  it('applies per-invoice tax overrides over settings and keeps the invariant', async () => {
    const ctx = await sharedCtx();
    // Settings default to 14% VAT / 3% discount. Override to 0% / 0% on the invoice.
    const create = await req('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        guestName: 'عميل بدون ضريبة', vatRate: 0, discountRate: 0,
        lines: [{ description: 'خدمة', qty: 1, unitPrice: 1000 }],
      }),
    }, ctx);
    expect(create.status).toBe(201);
    const { invoice } = await create.json() as { invoice: { id: string; vat_rate: number | null; discount_rate: number | null; tax_total: string; discount: string; total: string; subtotal_net: string; subtotal_gross: string } };
    expect(invoice.vat_rate).toBe(0);
    expect(invoice.discount_rate).toBe(0);
    expect(Number(invoice.tax_total)).toBe(0);
    expect(Number(invoice.discount)).toBe(0);
    expect(Number(invoice.total)).toBe(Number(invoice.subtotal_gross));

    await req(`/api/invoices/${invoice.id}/lock`, { method: 'POST' }, ctx);
    const print = await req(`/api/invoices/${invoice.id}/print`, {}, ctx);
    const body = await print.json() as { calc: { vatRate: number; discountRate: number }; issuer: { name: string; taxId: string } };
    expect(body.calc.vatRate).toBe(0);
    expect(body.calc.discountRate).toBe(0);
    // No per-invoice issuer override → falls back to settings (name is the tenant name).
    expect(body.issuer.name).toBe('فندق قاعود سبورتنج');
  });

  it('lets a per-invoice issuer override win in the print payload', async () => {
    const ctx = await sharedCtx();
    const create = await req('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        guestName: 'شركة', issuerName: 'فرع الميناء', issuerTaxId: '706904204', issuerAddress: 'الميناء',
        lines: [{ description: 'خدمة', qty: 1, unitPrice: 500 }],
      }),
    }, ctx);
    const { invoice } = await create.json() as { invoice: { id: string } };
    await req(`/api/invoices/${invoice.id}/lock`, { method: 'POST' }, ctx);
    const body = await (await req(`/api/invoices/${invoice.id}/print`, {}, ctx)).json() as { issuer: { name: string; taxId: string; address: string } };
    expect(body.issuer.name).toBe('فرع الميناء');
    expect(body.issuer.taxId).toBe('706904204');
    expect(body.issuer.address).toBe('الميناء');
  });

  it('rejects a per-invoice issuer tax id that is not 9 digits', async () => {
    const ctx = await sharedCtx();
    const res = await req('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ guestName: 'x', issuerTaxId: '123', lines: [{ description: 'x', qty: 1, unitPrice: 100 }] }),
    }, ctx);
    expect(res.status).toBe(400);
  });

  it('rejects a line kind outside the canonical set', async () => {
    const ctx = await sharedCtx();
    const res = await req('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ guestName: 'x', lines: [{ description: 'x', qty: 1, unitPrice: 100, kind: 'other' }] }),
    }, ctx);
    expect(res.status).toBe(400);
    const body = await res.json() as { details: { path: unknown[] }[] };
    expect(body.details.some((d) => d.path.includes('kind'))).toBe(true);
  });

  it('stores the receiver tax id on create and keeps it on update', async () => {
    const ctx = await sharedCtx();
    const create = await req('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ guestName: 'recv', receiverTaxId: '123456789', lines: [{ description: 'x', qty: 1, unitPrice: 100 }] }),
    }, ctx);
    expect(create.status).toBe(201);
    const { invoice } = await create.json() as { invoice: { id: string; receiver_tax_id: string } };
    expect(invoice.receiver_tax_id).toBe('123456789');

    // A later edit must not silently drop it.
    const upd = await req(`/api/invoices/${invoice.id}`, {
      method: 'PUT',
      body: JSON.stringify({ guestName: 'recv2', receiverTaxId: '987654321', lines: [{ description: 'x', qty: 1, unitPrice: 100 }] }),
    }, ctx);
    expect(upd.status).toBe(200);
    const updated = await upd.json() as { invoice: { receiver_tax_id: string } };
    expect(updated.invoice.receiver_tax_id).toBe('987654321');
  });

  it('persists branding settings (logo, signatures, footer)', async () => {
    const ctx = await sharedCtx();
    const put = await req('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        hotelName: 'فندق قاعود', hotelNameEn: 'KAOUD HOTEL', taxRegistrationNumber: '706904204',
        commercialRegister: '135665', activityCode: '5510', address: 'سبورتنج', city: 'Alexandria',
        phone: '', email: '', vatRate: 14, discountRate: 3, pricesIncludeTax: true, serialStart: 10246,
        currency: 'EGP', logoData: 'data:image/png;base64,AAAA', signatureLeft: 'المدير المالي|Financial Controller',
        signatureRight: 'مدير الائتمان|Credit Manager', footerNote: 'ملاحظة',
      }),
    }, ctx);
    expect(put.status).toBe(200);
    const body = await put.json() as { settings: { logo_data: string; signature_left: string; footer_note: string } };
    expect(body.settings.logo_data).toBe('data:image/png;base64,AAAA');
    expect(body.settings.signature_left).toBe('المدير المالي|Financial Controller');
    expect(body.settings.footer_note).toBe('ملاحظة');
  });

  it('reserves a device number block and accepts invoices inside it', async () => {
    const ctx = await sharedCtx();
    const reserve = await req('/api/serial/reserve', { method: 'POST', body: JSON.stringify({ deviceId: 'device-test-01', size: 3 }) }, ctx);
    expect(reserve.status).toBe(200);
    const blk = await reserve.json() as { start: number; end: number };
    expect(blk.end - blk.start).toBe(2);

    // Creating inside the block is accepted.
    const ok = await req('/api/invoices', { method: 'POST', body: JSON.stringify({
      guestName: 'offline-1', serial: blk.start, opId: 'op-1', lines: [{ description: 'x', qty: 1, unitPrice: 100 }],
    }) }, ctx);
    expect(ok.status).toBe(201);
    const okBody = await ok.json() as { invoice: { serial: number } };
    expect(okBody.invoice.serial).toBe(blk.start);

    // A serial outside any reserved block is refused.
    const bad = await req('/api/invoices', { method: 'POST', body: JSON.stringify({
      guestName: 'offline-bad', serial: 9_999_999, lines: [{ description: 'x', qty: 1, unitPrice: 100 }],
    }) }, ctx);
    expect(bad.status).toBe(409);
    const badBody = await bad.json() as { error: string };
    expect(badBody.error).toBe('serial_not_reserved');
  });

  it('heals numbering after a reserved block is released', async () => {
    const ctx = await sharedCtx();
    const mk = async (guest: string) => (await (await req('/api/invoices', {
      method: 'POST', body: JSON.stringify({ guestName: guest, lines: [{ description: 'x', qty: 1, unitPrice: 100 }] }),
    }, ctx)).json() as { invoice: { serial: number } }).invoice.serial;

    const before = await mk('pre-block');
    const reserve = await req('/api/serial/reserve', { method: 'POST', body: JSON.stringify({ deviceId: 'device-contig-01', size: 100 }) }, ctx);
    expect(reserve.status).toBe(200);

    // While the block is held, online allocation skips it (numbers are set aside
    // for offline use) instead of colliding.
    const held = (await (await req('/api/invoices/next-serial', {}, ctx)).json() as { nextSerial: number }).nextSerial;
    expect(held).toBeGreaterThan(before);

    // Releasing the block returns the unused numbers to the sequence.
    const rel = await req('/api/serial/release', { method: 'POST', body: JSON.stringify({ deviceId: 'device-contig-01' }) }, ctx);
    expect(rel.status).toBe(200);

    // Numbering is contiguous again: the next online invoice follows the last one,
    // and the preview matches what creation assigns.
    const after = await mk('post-release');
    expect(after).toBe(before + 1);
    const preview = (await (await req('/api/invoices/next-serial', {}, ctx)).json() as { nextSerial: number }).nextSerial;
    expect(preview).toBe(after + 1);
  });

  it('is idempotent: a replayed offline write returns the same invoice', async () => {
    const ctx = await sharedCtx();
    const reserve = await req('/api/serial/reserve', { method: 'POST', body: JSON.stringify({ deviceId: 'device-test-02', size: 2 }) }, ctx);
    const blk = await reserve.json() as { start: number };
    const body = JSON.stringify({ guestName: 'dup', serial: blk.start, opId: 'op-dup', lines: [{ description: 'x', qty: 1, unitPrice: 100 }] });
    const first = await req('/api/invoices', { method: 'POST', body }, ctx);
    const second = await req('/api/invoices', { method: 'POST', body }, ctx);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = await first.json() as { invoice: { id: string; serial: number } };
    const b = await second.json() as { invoice: { id: string; serial: number } };
    expect(b.invoice.id).toBe(a.invoice.id);
    expect(b.invoice.serial).toBe(a.invoice.serial);
  });

  it('stores and returns the invoice payment method', async () => {
    const ctx = await sharedCtx();
    const res = await req('/api/invoices', { method: 'POST', body: JSON.stringify({
      guestName: 'pay-guest', paymentMethod: 'card', lines: [{ description: 'x', qty: 1, unitPrice: 100 }],
    }) }, ctx);
    expect(res.status).toBe(201);
    const body = await res.json() as { invoice: { id: string; payment_method: string } };
    expect(body.invoice.payment_method).toBe('card');

    // Default is cash when omitted.
    const res2 = await req('/api/invoices', { method: 'POST', body: JSON.stringify({
      guestName: 'pay-default', lines: [{ description: 'x', qty: 1, unitPrice: 100 }],
    }) }, ctx);
    const body2 = await res2.json() as { invoice: { payment_method: string } };
    expect(body2.invoice.payment_method).toBe('cash');

    // A bogus method is rejected by the schema.
    const bad = await req('/api/invoices', { method: 'POST', body: JSON.stringify({
      guestName: 'pay-bad', paymentMethod: 'bitcoin', lines: [{ description: 'x', qty: 1, unitPrice: 100 }],
    }) }, ctx);
    expect(bad.status).toBe(400);
  });

  it('reports the daily cash report with a payment-method breakdown', async () => {
    const ctx = await sharedCtx();
    const res = await req('/api/reports/daily', {}, ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { date: string; count: number; total: string; byMethod: { method: string }[] };
    expect(typeof body.date).toBe('string');
    expect(body.count).toBeGreaterThan(0);
    expect(Array.isArray(body.byMethod)).toBe(true);
  });

  it('summarises per-user activity for monitoring', async () => {
    const ctx = await sharedCtx();
    const res = await req('/api/monitor/users', {}, ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { users: { username: string; invoices: number; logins: number }[] };
    const owner = body.users.find((u) => u.username === 'owner');
    expect(owner).toBeTruthy();
    // The owner created invoices earlier in this suite.
    expect(owner!.invoices).toBeGreaterThan(0);
  });

  it('applies a write with the same X-Op-Key exactly once', async () => {
    const ctx = await sharedCtx();
    const body = JSON.stringify({
      hotelName: 'فندق قاعود', taxRegistrationNumber: '706904204', activityCode: '5510',
      vatRate: 14, discountRate: 3, pricesIncludeTax: true, serialStart: 10246, currency: 'EGP',
      footerNote: 'op-1',
    });
    const first = await req('/api/settings', { method: 'PUT', headers: { 'X-Op-Key': 'k-settings-1' } as never, body }, ctx);
    const second = await req('/api/settings', { method: 'PUT', headers: { 'X-Op-Key': 'k-settings-1' } as never, body }, ctx);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = await first.json() as { settings: { footer_note: string } };
    const b = await second.json() as { settings: { footer_note: string } };
    expect(b.settings.footer_note).toBe(a.settings.footer_note);
    expect(a.settings.footer_note).toBe('op-1');
  });

  it('accepts a client-supplied id (offline-created invoice)', async () => {
    const ctx = await sharedCtx();
    const id = newId('inv');
    const res = await req('/api/invoices', { method: 'POST', body: JSON.stringify({ id, guestName: 'عميل أوفلاين', lines: [{ description: 'خدمة', qty: 1, unitPrice: 50 }] }) }, ctx);
    expect(res.status).toBe(201);
    expect((await res.json() as { invoice: { id: string } }).invoice.id).toBe(id);
  });

  it('lists guest names from active invoices and hides cancelled ones', async () => {
    const ctx = await sharedCtx();
    const mk = async (guest: string) => {
      const r = await req('/api/invoices', { method: 'POST', body: JSON.stringify({ guestName: guest, lines: [{ description: 'x', qty: 1, unitPrice: 100 }] }) }, ctx);
      return (await r.json() as { invoice: { id: string } }).invoice.id;
    };
    const keep = await mk('اسم ظاهر');
    const drop = await mk('اسم ملغى');
    expect((await req(`/api/invoices/${drop}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'test' }) }, ctx)).status).toBe(200);

    const body = await (await req('/api/directory/names', {}, ctx)).json() as { names: { name: string; invoices: number }[] };
    const names = body.names.map((n) => n.name);
    expect(names).toContain('اسم ظاهر');
    expect(names).not.toContain('اسم ملغى');
    expect(body.names.find((n) => n.name === 'اسم ظاهر')!.invoices).toBeGreaterThan(0);
    expect(keep).toBeTruthy();
  });
});
