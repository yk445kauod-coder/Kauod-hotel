import { Hono } from 'hono';
import { CreateUserSchema, UpdateUserSchema, SettingsSchema, ChangeSerialSchema } from '@kaoud/core';
import { passwordIssues } from '../crypto.js';
import type { Env } from '../db.js';
import { requireAuth, requireRole } from '../auth-middleware.js';
import { hashPassword } from '../crypto.js';
import { audit, newId } from '../audit.js';
import { loadSettings, loadCounter, previewNextSerial } from '../settings.js';
import { clientIp } from '../http.js';

export const adminRoutes = new Hono<{ Bindings: Env }>();

// ---------- users ----------
adminRoutes.get('/api/users', requireAuth(), requireRole('admin', 'manager'), async (c) => {
  const rows = await c.get('db').all(
    `SELECT id, username, name, role, active, is_owner, created_at, last_login_at
       FROM users WHERE tenant_id = ? ORDER BY created_at`,
    [c.get('auth').user.tenantId]);
  return c.json({ users: rows });
});

adminRoutes.post('/api/users', requireAuth(), requireRole('admin'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: actorId } = c.get('auth').user;
  const parsed = CreateUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const issues = passwordIssues(parsed.data.password);
  if (issues.length) return c.json({ error: 'weak_password', details: issues }, 400);
  const exists = await db.one(`SELECT id FROM users WHERE tenant_id = ? AND lower(username) = ?`, [tenantId, parsed.data.username]);
  if (exists) return c.json({ error: 'username_taken' }, 409);
  const pw = await hashPassword(parsed.data.password);
  const id = newId('usr');
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO users (id, tenant_id, username, name, role, password_hash, password_salt, iterations, active, is_owner, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
    [id, tenantId, parsed.data.username, parsed.data.name, parsed.data.role, pw.hash, pw.salt, pw.iterations, now]);
  await audit(db, { tenantId, userId: actorId, action: 'user.create', entity: 'user', entityId: id, detail: { username: parsed.data.username, role: parsed.data.role }, ip: clientIp(c) });
  return c.json({ ok: true, id }, 201);
});

adminRoutes.patch('/api/users/:id', requireAuth(), requireRole('admin'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: actorId } = c.get('auth').user;
  const target = await db.one<{ id: string; role: string; is_owner: number }>(
    `SELECT id, role, is_owner FROM users WHERE id = ? AND tenant_id = ?`, [(c.req.param('id') ?? ''), tenantId]);
  if (!target) return c.json({ error: 'not_found' }, 404);
  const parsed = UpdateUserSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (parsed.data.name !== undefined) { sets.push('name = ?'); params.push(parsed.data.name); }
  if (parsed.data.role !== undefined) {
    if (target.is_owner && parsed.data.role !== 'admin') return c.json({ error: 'cannot_demote_owner' }, 409);
    sets.push('role = ?'); params.push(parsed.data.role);
  }
  if (parsed.data.active !== undefined) {
    if (target.id === actorId && !parsed.data.active) return c.json({ error: 'cannot_disable_self' }, 409);
    if (target.is_owner && !parsed.data.active) return c.json({ error: 'cannot_disable_owner' }, 409);
    sets.push('active = ?'); params.push(parsed.data.active ? 1 : 0);
    if (!parsed.data.active) await db.run(`DELETE FROM sessions WHERE user_id = ?`, [target.id]);
  }
  if (parsed.data.password !== undefined) {
    const issues = passwordIssues(parsed.data.password);
    if (issues.length) return c.json({ error: 'weak_password', details: issues }, 400);
    const pw = await hashPassword(parsed.data.password);
    sets.push('password_hash = ?', 'password_salt = ?', 'iterations = ?');
    params.push(pw.hash, pw.salt, pw.iterations);
    await db.run(`DELETE FROM sessions WHERE user_id = ?`, [target.id]);
  }
  if (!sets.length) return c.json({ ok: true });
  params.push(target.id, tenantId);
  await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
  await audit(db, { tenantId, userId: actorId, action: 'user.update', entity: 'user', entityId: target.id, detail: { fields: sets.length }, ip: clientIp(c) });
  return c.json({ ok: true });
});

adminRoutes.delete('/api/users/:id', requireAuth(), requireRole('admin'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: actorId } = c.get('auth').user;
  const target = await db.one<{ id: string; is_owner: number }>(
    `SELECT id, is_owner FROM users WHERE id = ? AND tenant_id = ?`, [(c.req.param('id') ?? ''), tenantId]);
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (target.id === actorId) return c.json({ error: 'cannot_delete_self' }, 409);
  if (target.is_owner) return c.json({ error: 'cannot_delete_owner' }, 409);
  await db.run(`DELETE FROM users WHERE id = ? AND tenant_id = ?`, [target.id, tenantId]);
  await audit(db, { tenantId, userId: actorId, action: 'user.delete', entity: 'user', entityId: target.id, ip: clientIp(c) });
  return c.json({ ok: true });
});

// ---------- settings ----------
adminRoutes.get('/api/settings', requireAuth(), async (c) => {
  const s = await loadSettings(c.get('db'), c.get('auth').user.tenantId);
  return c.json({ settings: s });
});

adminRoutes.put('/api/settings', requireAuth(), requireRole('admin', 'manager'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: actorId } = c.get('auth').user;
  const parsed = SettingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const d = parsed.data;
  await db.run(
    `UPDATE settings SET hotel_name = ?, hotel_name_en = ?, tax_registration_number = ?, commercial_register = ?,
       activity_code = ?, address = ?, city = ?, phone = ?, email = ?, vat_rate = ?, discount_rate = ?,
       prices_include_tax = ?, serial_start = ?, currency = ?, logo_data = ?, signature_left = ?,
       signature_right = ?, footer_note = ?, updated_at = ?
     WHERE tenant_id = ?`,
    [d.hotelName, d.hotelNameEn ?? '', d.taxRegistrationNumber, d.commercialRegister ?? '', d.activityCode,
      d.address ?? '', d.city ?? 'Alexandria', d.phone ?? '', d.email ?? '', d.vatRate, d.discountRate,
      d.pricesIncludeTax ? 1 : 0, d.serialStart, d.currency, d.logoData ?? '', d.signatureLeft ?? '',
      d.signatureRight ?? '', d.footerNote ?? '', new Date().toISOString(), tenantId]);
  await audit(db, { tenantId, userId: actorId, action: 'settings.update', entity: 'settings', entityId: tenantId, ip: clientIp(c) });
  return c.json({ settings: await loadSettings(db, tenantId) });
});

// ---------- serial ----------
adminRoutes.get('/api/serial', requireAuth(), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  const counter = await loadCounter(db, tenantId);
  const settings = await loadSettings(db, tenantId);
  return c.json({
    serialStart: settings?.serial_start ?? 10246,
    nextSerial: previewNextSerial(counter),
    nextOverride: counter?.next_override ?? null,
  });
});

adminRoutes.put('/api/serial', requireAuth(), requireRole('admin'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: actorId } = c.get('auth').user;
  const parsed = ChangeSerialSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const maxRow = await db.one<{ m: number | null }>(`SELECT MAX(serial) AS m FROM invoices WHERE tenant_id = ?`, [tenantId]);
  const maxSerial = maxRow?.m ?? 0;

  if (parsed.data.serialStart !== undefined) {
    if (maxSerial && parsed.data.serialStart <= maxSerial) {
      return c.json({ error: 'serial_below_max', maxSerial }, 409);
    }
    await db.run(`UPDATE settings SET serial_start = ? WHERE tenant_id = ?`, [parsed.data.serialStart, tenantId]);
    await db.run(`UPDATE counters SET next_serial = ? WHERE tenant_id = ? AND next_override IS NULL`, [parsed.data.serialStart, tenantId]);
  }
  if (parsed.data.nextOverride !== undefined) {
    if (parsed.data.nextOverride !== null && maxSerial && parsed.data.nextOverride <= maxSerial) {
      return c.json({ error: 'serial_below_max', maxSerial }, 409);
    }
    await db.run(`UPDATE counters SET next_override = ? WHERE tenant_id = ?`, [parsed.data.nextOverride, tenantId]);
  }
  await audit(db, { tenantId, userId: actorId, action: 'serial.update', entity: 'counter', entityId: tenantId, detail: parsed.data, ip: clientIp(c) });
  const counter = await loadCounter(db, tenantId);
  const settings = await loadSettings(db, tenantId);
  return c.json({ serialStart: settings?.serial_start, nextSerial: previewNextSerial(counter), nextOverride: counter?.next_override ?? null });
});

// ---------- serial audit (gaps / duplicates) ----------
adminRoutes.get('/api/serial/audit', requireAuth(), requireRole('admin', 'manager', 'accountant'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  const settings = await loadSettings(db, tenantId);
  const start = settings?.serial_start ?? 10246;
  const rows = await db.all<{ serial: number; n: number }>(
    `SELECT serial, COUNT(*) AS n FROM invoices WHERE tenant_id = ? GROUP BY serial`, [tenantId]);
  const byNum = new Map(rows.map((r) => [r.serial, r.n]));
  const max = rows.length ? Math.max(...rows.map((r) => r.serial)) : start - 1;
  const result: Array<{ serial: number; state: string }> = [];
  for (let n = start; n <= max; n++) {
    const c2 = byNum.get(n) ?? 0;
    result.push({ serial: n, state: c2 === 0 ? 'missing' : c2 > 1 ? 'duplicate' : 'present' });
  }
  return c.json({ start, max, entries: result });
});

// ---------- audit log ----------
adminRoutes.get('/api/audit', requireAuth(), requireRole('admin'), async (c) => {
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? 100)));
  const rows = await c.get('db').all(
    `SELECT id, user_id, action, entity, entity_id, detail, ip, created_at FROM audit_log
      WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
    [c.get('auth').user.tenantId, limit]);
  return c.json({ entries: rows });
});

// ---------- full tenant data export (backup) ----------
adminRoutes.get('/api/export', requireAuth(), requireRole('admin'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  const [settings, invoices, lines, payments, rooms, guests, reservations, users] = await Promise.all([
    loadSettings(db, tenantId),
    db.all(`SELECT * FROM invoices WHERE tenant_id = ?`, [tenantId]),
    db.all(`SELECT * FROM invoice_lines WHERE tenant_id = ?`, [tenantId]),
    db.all(`SELECT * FROM payments WHERE tenant_id = ?`, [tenantId]),
    db.all(`SELECT * FROM rooms WHERE tenant_id = ?`, [tenantId]),
    db.all(`SELECT * FROM guests WHERE tenant_id = ?`, [tenantId]),
    db.all(`SELECT * FROM reservations WHERE tenant_id = ?`, [tenantId]),
    db.all(`SELECT id, username, name, role, active, is_owner, created_at FROM users WHERE tenant_id = ?`, [tenantId]),
  ]);
  return c.json({ exportedAt: new Date().toISOString(), version: 1, settings, invoices, lines, payments, rooms, guests, reservations, users });
});
