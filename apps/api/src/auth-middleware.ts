import type { Context, Next } from 'hono';
import { Db, type AuthContext, type Env, type SessionUser } from './db.js';
import { parseCookies, SESSION_COOKIE, CSRF_COOKIE, clientIp } from './http.js';
import { sha256Hex, timingSafeEqual } from './crypto.js';
import { ensureDailyBackup } from './backups.js';

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
    db: Db;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireAuth() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const db = new Db(c.env.DB);
    const cookies = parseCookies(c.req.header('Cookie') ?? null);
    const token = cookies[SESSION_COOKIE];
    if (!token) return c.json({ error: 'unauthorized' }, 401);

    const tokenHash = await sha256Hex(token);
    const row = await db.one<{
      token_hash: string; user_id: string; tenant_id: string; csrf: string;
      expires_at: string; username: string; name: string; role: SessionUser['role'];
      active: number; is_owner: number;
    }>(
      `SELECT s.token_hash, s.user_id, s.tenant_id, s.csrf, s.expires_at,
              u.username, u.name, u.role, u.active, u.is_owner
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
      [tokenHash],
    );
    if (!row) return c.json({ error: 'unauthorized' }, 401);
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await db.run(`DELETE FROM sessions WHERE token_hash = ?`, [tokenHash]);
      return c.json({ error: 'session_expired' }, 401);
    }
    if (!row.active) return c.json({ error: 'account_disabled' }, 403);

    const csrfHeader = c.req.header('X-CSRF-Token') ?? '';
    const csrfCookie = cookies[CSRF_COOKIE] ?? '';
    const needsCsrf = !SAFE_METHODS.has(c.req.method);
    if (needsCsrf) {
      const okHeader = csrfHeader && timingSafeEqual(csrfHeader, row.csrf);
      const okCookie = csrfCookie && timingSafeEqual(csrfCookie, row.csrf);
      if (!okHeader || !okCookie) return c.json({ error: 'csrf_failed' }, 403);
    }

    await db.run(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`, [new Date().toISOString(), tokenHash]);

    c.set('db', db);
    c.set('auth', {
      user: {
        id: row.user_id,
        tenantId: row.tenant_id,
        username: row.username,
        name: row.name,
        role: row.role,
        isOwner: !!row.is_owner,
      },
      csrf: row.csrf,
      sessionTokenHash: tokenHash,
    });
    // Lazy daily backup: the first authenticated GET of the day writes a
    // snapshot. A backup failure must never break the request.
    if (c.req.method === 'GET') {
      try { await ensureDailyBackup(db, row.tenant_id); } catch { /* ignore */ }
    }
    await next();
  };
}

// Role gate. admin/manager are privileged; reception and accountant are limited.
export function requireRole(...roles: SessionUser['role'][]) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const auth = c.get('auth');
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    if (!roles.includes(auth.user.role)) return c.json({ error: 'forbidden' }, 403);
    await next();
  };
}

export { clientIp };
