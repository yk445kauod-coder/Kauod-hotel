import type { D1Database } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  ENVIRONMENT: string;
  APP_ORIGIN: string;
  APP_ORIGIN_EXTRA?: string;
  DESKTOP_ORIGINS?: string;
  // Optional ETA e-invoicing integration
  ETA_CLIENT_ID?: string;
  ETA_CLIENT_SECRET?: string;
  ETA_ENV?: 'preprod' | 'prod';
  ETA_PRIVATE_KEY?: string;
}

export interface Row { [k: string]: unknown }

// Thin typed wrapper over D1. Every tenant-scoped read/write in this app goes
// through `q`/`one` with an explicit tenant_id predicate; the helper does not
// let a caller forget it because callers must pass tenantId in the params.
export class Db {
  constructor(private readonly db: D1Database) {}

  async all<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql).bind(...params.map(norm));
    const res = await stmt.all<T>();
    return (res.results ?? []) as T[];
  }

  async one<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
    const stmt = this.db.prepare(sql).bind(...params.map(norm));
    return (await stmt.first<T>()) ?? null;
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.db.prepare(sql).bind(...params.map(norm)).run();
  }

  async batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    const prepared = statements.map((s) => this.db.prepare(s.sql).bind(...(s.params ?? []).map(norm)));
    await this.db.batch(prepared);
  }
}

function norm(v: unknown): unknown {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) return null;
  return v;
}

export interface SessionUser {
  id: string;
  tenantId: string;
  username: string;
  name: string;
  role: 'admin' | 'manager' | 'reception' | 'accountant';
  isOwner: boolean;
}

export interface AuthContext {
  user: SessionUser;
  csrf: string;
  sessionTokenHash: string;
}
