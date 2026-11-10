import { Db, type Env } from './db.js';
import { newId } from './audit.js';
import { hashPassword } from './crypto.js';

export interface Settings {
  tenant_id: string;
  hotel_name: string;
  hotel_name_en: string;
  tax_registration_number: string;
  commercial_register: string;
  activity_code: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  vat_rate: number;
  discount_rate: number;
  prices_include_tax: number;
  serial_start: number;
  currency: string;
  logo_data: string;
  signature_left: string;
  signature_right: string;
  footer_note: string;
}

export async function loadSettings(db: Db, tenantId: string): Promise<Settings | null> {
  return db.one<Settings>(`SELECT * FROM settings WHERE tenant_id = ?`, [tenantId]);
}

export interface BootstrapInput {
  tenantName: string;
  username: string;
  name: string;
  password: string;
}

// Creates the first tenant, its settings row, counter and owner user in one go.
// Guarded by "no users exist at all" so it can only ever run once.
export async function bootstrap(db: Db, input: BootstrapInput): Promise<{ tenantId: string; userId: string }> {
  const existing = await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM users`);
  if ((existing?.n ?? 0) > 0) throw new Error('already_initialised');

  const now = new Date().toISOString();
  const tenantId = newId('ten');
  const userId = newId('usr');
  const pw = await hashPassword(input.password);

  await db.batch([
    { sql: `INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)`, params: [tenantId, input.tenantName, now] },
    { sql: `INSERT INTO settings (tenant_id, updated_at) VALUES (?, ?)`, params: [tenantId, now] },
    { sql: `INSERT INTO counters (tenant_id, next_serial, next_override) VALUES (?, ?, NULL)`, params: [tenantId, 10246] },
    {
      sql: `INSERT INTO users (id, tenant_id, username, name, role, password_hash, password_salt, iterations, active, is_owner, created_at)
            VALUES (?, ?, ?, ?, 'admin', ?, ?, ?, 1, 1, ?)`,
      params: [userId, tenantId, input.username.toLowerCase(), input.name, pw.hash, pw.salt, pw.iterations, now],
    },
  ]);
  return { tenantId, userId };
}

export async function isInitialised(db: Db): Promise<boolean> {
  const row = await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM users`);
  return (row?.n ?? 0) > 0;
}

export interface Counter {
  tenant_id: string;
  next_serial: number;
  next_override: number | null;
}

export async function loadCounter(db: Db, tenantId: string): Promise<Counter | null> {
  return db.one<Counter>(`SELECT * FROM counters WHERE tenant_id = ?`, [tenantId]);
}

export function previewNextSerial(counter: Counter | null): number {
  if (!counter) return 10246;
  if (counter.next_override && counter.next_override > 0) return counter.next_override;
  return counter.next_serial;
}
