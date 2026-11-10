import type { Context } from 'hono';
import type { Env } from './db.js';

// Central error handler: never leak stack traces or internals to the client,
// always log server-side so wrangler tail can surface the cause.
export function handleError(err: Error, c: Context<{ Bindings: Env }>) {
  const id = crypto.randomUUID().slice(0, 8);
  console.error(`[error ${id}] ${c.req.method} ${c.req.path}:`, err?.message, err?.stack);
  return c.json({ error: 'internal_error', id }, 500);
}
