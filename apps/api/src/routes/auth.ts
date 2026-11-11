import { Hono } from 'hono';
import { LoginSchema, BootstrapSchema } from '@kaoud/core';
import { passwordIssues } from '../crypto.js';
import type { Env } from '../db.js';
import { Db } from '../db.js';
import { requireAuth } from '../auth-middleware.js';
import { hashPassword, verifyPassword, randomHex, sha256Hex } from '../crypto.js';
import { sessionCookie, csrfCookie, clearCookies, rateLimit, clientIp, SESSION_TTL_MS } from '../http.js';
import { audit } from '../audit.js';
import { bootstrap, isInitialised, loadSettings } from '../settings.js';

export const authRoutes = new Hono<{ Bindings: Env }>();

// Username-only sign-in: when true, the password field is optional and an
// omitted password is accepted. Flip to false to require a password again.
const ALLOW_USERNAME_ONLY_LOGIN = true;

authRoutes.get('/api/bootstrap', async (c) => {
  return c.json({ initialised: await isInitialised(new Db(c.env.DB)) });
});

// Public branding for the pre-auth screen: no tenant data beyond what is meant
// to appear on the login page, and only a logo if the caller's origin is allowed.
authRoutes.get('/api/branding', async (c) => {
  const db = new Db(c.env.DB);
  const row = await db.one<{ id: string }>(`SELECT id FROM tenants LIMIT 1`);
  const s = row ? await loadSettings(db, row.id) : null;
  return c.json({
    hotelName: s?.hotel_name ?? 'نظام الفواتير',
    hotelNameEn: s?.hotel_name_en ?? '',
    city: s?.city ?? '',
    logo: s?.logo_data ?? '',
  });
});

authRoutes.post('/api/bootstrap', async (c) => {
  const db = new Db(c.env.DB);
  if (!(await rateLimit(db, `bootstrap:${clientIp(c)}`, { limit: 5, windowSec: 3600 }))) {
    return c.json({ error: 'rate_limited' }, 429);
  }
  const parsed = BootstrapSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const issues = passwordIssues(parsed.data.password);
  if (issues.length) return c.json({ error: 'weak_password', details: issues }, 400);
  try {
    const { tenantId } = await bootstrap(db, parsed.data);
    await audit(db, { tenantId, action: 'bootstrap', entity: 'tenant', entityId: tenantId, ip: clientIp(c) });
    return c.json({ ok: true }, 201);
  } catch (e) {
    if (e instanceof Error && e.message === 'already_initialised') {
      return c.json({ error: 'already_initialised' }, 409);
    }
    throw e;
  }
});

authRoutes.post('/api/auth/login', async (c) => {
  const db = new Db(c.env.DB);
  const ip = clientIp(c);
  if (!(await rateLimit(db, `login:${ip}`, { limit: 10, windowSec: 300 }))) {
    return c.json({ error: 'rate_limited' }, 429);
  }
  const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const user = await db.one<{
    id: string; tenant_id: string; username: string; name: string; role: string;
    password_hash: string; password_salt: string; iterations: number; active: number; is_owner: number;
  }>(`SELECT * FROM users WHERE lower(username) = lower(?)`, [parsed.data.username]);

  // Username-only sign-in: a submitted password is still verified, but an
  // omitted password is accepted while ALLOW_USERNAME_ONLY_LOGIN is on.
  const ok = user
    ? (ALLOW_USERNAME_ONLY_LOGIN && !parsed.data.password)
      || await verifyPassword(parsed.data.password ?? '', { hash: user.password_hash, salt: user.password_salt, iterations: user.iterations })
    : false;
  if (!user || !ok) return c.json({ error: 'invalid_credentials' }, 401);
  if (!user.active) return c.json({ error: 'account_disabled' }, 403);

  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const csrf = randomHex(24);
  const now = new Date();
  await db.run(
    `INSERT INTO sessions (token_hash, user_id, tenant_id, csrf, created_at, expires_at, last_seen_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tokenHash, user.id, user.tenant_id, csrf, now.toISOString(),
      new Date(now.getTime() + SESSION_TTL_MS).toISOString(), now.toISOString(),
      c.req.header('User-Agent') ?? '', ip],
  );
  await db.run(`UPDATE users SET last_login_at = ? WHERE id = ?`, [now.toISOString(), user.id]);
  await audit(db, { tenantId: user.tenant_id, userId: user.id, action: 'login', entity: 'user', entityId: user.id, ip });

  c.header('Set-Cookie', sessionCookie(token, SESSION_TTL_MS / 1000));
  c.header('Set-Cookie', csrfCookie(csrf, SESSION_TTL_MS / 1000), { append: true });
  // The desktop shell cannot use the cross-origin HttpOnly cookie, so it asks
  // for the raw token via `X-Client: desktop` and stores it locally. The browser
  // never sends that header, so a token is never exposed to page scripts (XSS).
  const wantsToken = (c.req.header('X-Client') ?? '').toLowerCase() === 'desktop';
  return c.json({
    user: { id: user.id, username: user.username, name: user.name, role: user.role, isOwner: !!user.is_owner },
    csrf,
    ...(wantsToken ? { token } : {}),
  });
});

authRoutes.post('/api/auth/logout', requireAuth(), async (c) => {
  const { sessionTokenHash, user } = c.get('auth');
  await c.get('db').run(`DELETE FROM sessions WHERE token_hash = ?`, [sessionTokenHash]);
  await audit(c.get('db'), { tenantId: user.tenantId, userId: user.id, action: 'logout', entity: 'user', entityId: user.id, ip: clientIp(c) });
  for (const cookie of clearCookies()) c.header('Set-Cookie', cookie, { append: true });
  return c.json({ ok: true });
});

authRoutes.get('/api/me', requireAuth(), (c) => {
  const { user, csrf } = c.get('auth');
  return c.json({ user, csrf });
});

authRoutes.post('/api/me/password', requireAuth(), async (c) => {
  const db = c.get('db');
  const { user, sessionTokenHash } = c.get('auth');
  const body = await c.req.json().catch(() => null) as { currentPassword?: string; newPassword?: string } | null;
  if (!body?.currentPassword || !body?.newPassword) return c.json({ error: 'bad_request' }, 400);
  const issues = passwordIssues(body.newPassword);
  if (issues.length) return c.json({ error: 'weak_password', details: issues }, 400);
  const row = await db.one<{ password_hash: string; password_salt: string; iterations: number }>(
    `SELECT password_hash, password_salt, iterations FROM users WHERE id = ?`, [user.id]);
  if (!row || !(await verifyPassword(body.currentPassword, { hash: row.password_hash, salt: row.password_salt, iterations: row.iterations }))) {
    return c.json({ error: 'invalid_credentials' }, 401);
  }
  const pw = await hashPassword(body.newPassword);
  await db.run(`UPDATE users SET password_hash = ?, password_salt = ?, iterations = ? WHERE id = ?`,
    [pw.hash, pw.salt, pw.iterations, user.id]);
  await db.run(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`, [user.id, sessionTokenHash]);
  await audit(db, { tenantId: user.tenantId, userId: user.id, action: 'password_change', entity: 'user', entityId: user.id, ip: clientIp(c) });
  return c.json({ ok: true });
});

authRoutes.get('/api/sessions', requireAuth(), async (c) => {
  const { user, sessionTokenHash } = c.get('auth');
  const rows = await c.get('db').all(
    `SELECT token_hash, created_at, expires_at, last_seen_at, user_agent, ip FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC`,
    [user.id]);
  return c.json({ sessions: rows, current: sessionTokenHash });
});

authRoutes.delete('/api/sessions/:hash', requireAuth(), async (c) => {
  const { user } = c.get('auth');
  await c.get('db').run(`DELETE FROM sessions WHERE token_hash = ? AND user_id = ?`, [(c.req.param('hash') ?? ''), user.id]);
  return c.json({ ok: true });
});
