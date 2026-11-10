import type { Context } from 'hono';
import type { Db, Env } from './db.js';

export const SESSION_COOKIE = 'kaoud_session';
export const CSRF_COOKIE = 'kaoud_csrf';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

// SameSite=None + Secure is required for the cookie to be sent cross-site
// (Pages front end -> Workers API). A paired CSRF cookie (readable by JS) plus
// an X-CSRF-Token header implements the double-submit defence.
export function sessionCookie(token: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAgeSec}`;
}

export function csrfCookie(token: string, maxAgeSec: number): string {
  return `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; Secure; SameSite=None; Max-Age=${maxAgeSec}`;
}

export function clearCookies(): string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/; Secure; SameSite=None; Max-Age=0`,
  ];
}

export function allowedOrigins(env: Env): string[] {
  const raw = [env.APP_ORIGIN ?? '', ...(env.APP_ORIGIN_EXTRA ?? '').split(',')];
  return raw.map((s) => s.trim()).filter(Boolean);
}

export function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = allowedOrigins(env);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

export function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  };
}

export interface RateRule { limit: number; windowSec: number; }

// Fixed-window rate limiter persisted in D1 so it works across isolates
// (an in-memory counter is per-isolate and trivially bypassed).
export async function rateLimit(db: Db, key: string, rule: RateRule): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % rule.windowSec);
  await db.run(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1`,
    [key, windowStart],
  );
  const row = await db.one<{ count: number }>(
    `SELECT count FROM rate_limits WHERE key = ? AND window_start = ?`,
    [key, windowStart],
  );
  // Opportunistic cleanup of old windows.
  if (Math.random() < 0.02) {
    await db.run(`DELETE FROM rate_limits WHERE window_start < ?`, [now - 3600]);
  }
  return (row?.count ?? 0) <= rule.limit;
}

export function clientIp(c: Context): string {
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

export interface ApiError { error: string; details?: unknown; }
export function badRequest(details?: unknown): ApiError { return { error: 'bad_request', details }; }
