import type { Context, Next } from 'hono';
import type { Db, Env } from './db.js';

// Generic idempotency for write routes. A client that may retry a request
// (an offline queue flushing on reconnect) sends an X-Op-Key header. The first
// successful response is stored; any replay returns that stored response
// without running the handler again. Must run after requireAuth().
export function idempotency() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const key = c.req.header('X-Op-Key');
    if (!key) return next();
    const db: Db = c.get('db');
    const tenantId = c.get('auth').user.tenantId;

    const prior = await db.one<{ status: number; body: string }>(
      `SELECT status, body FROM op_log WHERE tenant_id = ? AND op_key = ?`,
      [tenantId, key],
    );
    if (prior) {
      return new Response(prior.body, {
        status: prior.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    await next();
    if (c.res.status >= 200 && c.res.status < 300) {
      const body = await c.res.clone().text();
      await db.run(
        `INSERT OR IGNORE INTO op_log (tenant_id, op_key, status, body, created_at) VALUES (?, ?, ?, ?, ?)`,
        [tenantId, key, c.res.status, body, new Date().toISOString()],
      );
    }
  };
}
