import type { Db } from './db.js';
import { newId } from './audit.js';
import { loadSettings, loadCounter } from './settings.js';

// One snapshot payload shape, shared by the manual export and the daily
// snapshot so a restored backup and a downloaded one are interchangeable.
export async function buildExportPayload(db: Db, tenantId: string) {
  const [settings, counter, invoices, lines, payments, rooms, guests, reservations, users] = await Promise.all([
    loadSettings(db, tenantId),
    loadCounter(db, tenantId),
    db.all(`SELECT * FROM invoices WHERE tenant_id = ?`, [tenantId]),
    db.all(`SELECT * FROM invoice_lines WHERE tenant_id = ?`, [tenantId]),
    db.all(`SELECT * FROM payments WHERE tenant_id = ?`, [tenantId]),
    db.all(`SELECT * FROM rooms WHERE tenant_id = ?`, [tenantId]),
    db.all(`SELECT * FROM guests WHERE tenant_id = ?`, [tenantId]),
    db.all(`SELECT * FROM reservations WHERE tenant_id = ?`, [tenantId]),
    db.all(`SELECT id, username, name, role, active, is_owner, created_at FROM users WHERE tenant_id = ?`, [tenantId]),
  ]);
  return { exportedAt: new Date().toISOString(), version: 1, settings, counter, invoices, lines, payments, rooms, guests, reservations, users };
}

// There is no cron trigger, so the snapshot is taken lazily: the first
// authenticated request of the day writes one row per tenant. UNIQUE(tenant_id,
// day) plus INSERT OR IGNORE make it idempotent under concurrent requests.
export async function ensureDailyBackup(db: Db, tenantId: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const existing = await db.one(`SELECT id FROM backups WHERE tenant_id = ? AND day = ?`, [tenantId, day]);
  if (existing) return;
  const payload = await buildExportPayload(db, tenantId);
  await db.run(
    `INSERT OR IGNORE INTO backups (id, tenant_id, day, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    [newId('bak'), tenantId, day, JSON.stringify(payload), new Date().toISOString()],
  );
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  await db.run(`DELETE FROM backups WHERE tenant_id = ? AND day < ?`, [tenantId, cutoff]);
}
