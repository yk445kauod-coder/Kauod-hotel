import { Hono } from 'hono';
import { CreateUserSchema, UpdateUserSchema, SettingsSchema, ChangeSerialSchema, SerialReserveSchema, SerialReleaseSchema } from '@kaoud/core';
import { passwordIssues } from '../crypto.js';
import type { Env } from '../db.js';
import { requireAuth, requireRole } from '../auth-middleware.js';
import { hashPassword } from '../crypto.js';
import { audit, newId } from '../audit.js';
import { loadSettings, loadCounter, previewNextSerial } from '../settings.js';
import { buildExportPayload } from '../backups.js';
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

// ---------- offline device number blocks ----------
// A desktop client reserves a contiguous block of serials it may allocate from
// while offline. Blocks never overlap: the new block starts after the highest
// number already reserved or used, so two devices can never print the same No.
adminRoutes.post('/api/serial/reserve', requireAuth(), requireRole('admin', 'manager', 'reception'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: actorId } = c.get('auth').user;
  const parsed = SerialReserveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const { deviceId, size } = parsed.data;

  const existing = await db.one<{ start_serial: number; end_serial: number }>(
    `SELECT start_serial, end_serial FROM device_serials WHERE tenant_id = ? AND device_id = ?`,
    [tenantId, deviceId]);
  if (existing) {
    return c.json({ deviceId, start: existing.start_serial, end: existing.end_serial, next: existing.start_serial });
  }

  const used = await db.one<{ m: number | null }>(`SELECT MAX(serial) AS m FROM invoices WHERE tenant_id = ?`, [tenantId]);
  const reserved = await db.one<{ m: number | null }>(`SELECT MAX(end_serial) AS m FROM device_serials WHERE tenant_id = ?`, [tenantId]);
  const counter = await loadCounter(db, tenantId);
  const start = Math.max(used?.m ?? 0, reserved?.m ?? 0, (counter?.next_serial ?? 10246) - 1) + 1;
  const end = start + size - 1;
  await db.run(
    `INSERT INTO device_serials (tenant_id, device_id, start_serial, end_serial, created_at) VALUES (?, ?, ?, ?, ?)`,
    [tenantId, deviceId, start, end, new Date().toISOString()]);
  // The block sits just past the counter; the online allocator skips over it
  // (nextOnlineSerial), so the counter itself is left untouched and numbering
  // stays contiguous for online invoices.
  await audit(db, { tenantId, userId: actorId, action: 'serial.reserve', entity: 'device', entityId: deviceId, detail: { start, end }, ip: clientIp(c) });
  return c.json({ deviceId, start, end, next: start });
});

// Releases a device's unused reserved numbers. Called when offline mode is turned
// off or its queue has drained, so the freed numbers return to the sequence and
// online numbering stays contiguous. Numbers already used by an invoice stay put.
adminRoutes.post('/api/serial/release', requireAuth(), requireRole('admin', 'manager', 'reception'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: actorId } = c.get('auth').user;
  const parsed = SerialReleaseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const { deviceId } = parsed.data;

  const block = await db.one<{ start_serial: number; end_serial: number }>(
    `SELECT start_serial, end_serial FROM device_serials WHERE tenant_id = ? AND device_id = ?`,
    [tenantId, deviceId]);
  if (!block) return c.json({ released: false });

  const used = await db.one<{ m: number | null }>(
    `SELECT MAX(serial) AS m FROM invoices WHERE tenant_id = ? AND serial BETWEEN ? AND ?`,
    [tenantId, block.start_serial, block.end_serial]);

  if (used?.m) {
    // Keep the used prefix as a block, release the unused tail.
    await db.run(
      `UPDATE device_serials SET end_serial = ? WHERE tenant_id = ? AND device_id = ?`,
      [used.m, tenantId, deviceId]);
  } else {
    await db.run(`DELETE FROM device_serials WHERE tenant_id = ? AND device_id = ?`, [tenantId, deviceId]);
  }
  await audit(db, { tenantId, userId: actorId, action: 'serial.release', entity: 'device', entityId: deviceId, detail: { start: block.start_serial, end: block.end_serial, usedUpTo: used?.m ?? null }, ip: clientIp(c) });
  return c.json({ released: true, usedUpTo: used?.m ?? null });
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

// ---------- user monitoring (V15 parity: مراقبة المستخدمين) ----------
// Per-user activity derived from the audit trail: how many logins, invoices,
// locks, cancellations and payments each user performed, plus last activity.
adminRoutes.get('/api/monitor/users', requireAuth(), requireRole('admin', 'manager'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  const users = await db.all<{ id: string; username: string; name: string; role: string; active: number }>(
    `SELECT id, username, name, role, active FROM users WHERE tenant_id = ? ORDER BY name`, [tenantId]);
  const agg = await db.all<{
    user_id: string | null; total: number; logins: number; invoices: number;
    locks: number; cancels: number; payments: number; last_at: string | null;
  }>(
    `SELECT user_id,
            COUNT(*) AS total,
            SUM(CASE WHEN action = 'login' THEN 1 ELSE 0 END) AS logins,
            SUM(CASE WHEN action = 'invoice.create' THEN 1 ELSE 0 END) AS invoices,
            SUM(CASE WHEN action IN ('invoice.lock','invoice.unlock') THEN 1 ELSE 0 END) AS locks,
            SUM(CASE WHEN action = 'invoice.cancel' THEN 1 ELSE 0 END) AS cancels,
            SUM(CASE WHEN action = 'payment.create' THEN 1 ELSE 0 END) AS payments,
            MAX(created_at) AS last_at
       FROM audit_log WHERE tenant_id = ? GROUP BY user_id`,
    [tenantId]);
  const byUser = new Map(agg.map((a) => [a.user_id ?? '', a]));
  return c.json({
    users: users.map((u) => {
      const a = byUser.get(u.id);
      return {
        id: u.id, username: u.username, name: u.name, role: u.role, active: !!u.active,
        total: a?.total ?? 0, logins: a?.logins ?? 0, invoices: a?.invoices ?? 0,
        locks: a?.locks ?? 0, cancels: a?.cancels ?? 0, payments: a?.payments ?? 0,
        lastAt: a?.last_at ?? null,
      };
    }),
  });
});

// ---------- full tenant data export (backup) ----------
adminRoutes.get('/api/export', requireAuth(), requireRole('admin'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  return c.json(await buildExportPayload(db, tenantId));
});

// ---------- daily snapshots ----------
adminRoutes.get('/api/backups', requireAuth(), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  const rows = await db.all<{ day: string; created_at: string }>(
    `SELECT day, created_at FROM backups WHERE tenant_id = ? ORDER BY day DESC`, [tenantId]);
  return c.json({ days: rows.map((r) => ({ day: r.day, createdAt: r.created_at })) });
});

adminRoutes.get('/api/backups/:day', requireAuth(), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  const row = await db.one<{ day: string; payload: string; created_at: string }>(
    `SELECT day, payload, created_at FROM backups WHERE tenant_id = ? AND day = ?`,
    [tenantId, c.req.param('day') ?? '']);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ day: row.day, createdAt: row.created_at, payload: JSON.parse(row.payload) });
});

// ---------- restore a backup produced by /api/export ----------
// Every table is scoped to the caller's tenant, so a restore can never touch
// another tenant's rows. Password hashes are intentionally NOT restorable:
// the users list carries no credentials and existing logins are preserved.
interface Backup { version?: number; settings?: Record<string, unknown>; counter?: Record<string, unknown>; invoices?: unknown[]; lines?: unknown[]; payments?: unknown[]; rooms?: unknown[]; guests?: unknown[]; reservations?: unknown[]; }

const SETTINGS_COLS = ['hotel_name', 'hotel_name_en', 'tax_registration_number', 'commercial_register', 'activity_code', 'address', 'city', 'phone', 'email', 'vat_rate', 'discount_rate', 'prices_include_tax', 'serial_start', 'currency', 'logo_data', 'signature_left', 'signature_right', 'footer_note'];
const INVOICE_COLS = ['id', 'serial', 'uuid', 'guest_id', 'guest_name', 'receiver_tax_id', 'room_number', 'check_in', 'check_out', 'status', 'issued_at', 'subtotal_net', 'subtotal_gross', 'tax_total', 'discount', 'total', 'notes', 'vat_rate', 'discount_rate', 'issuer_name', 'issuer_tax_id', 'issuer_address', 'payment_method', 'eta_uuid', 'eta_status', 'eta_submitted_at', 'eta_error', 'created_by', 'created_at', 'updated_at', 'locked_at', 'cancelled_at'];
const LINE_COLS = ['id', 'invoice_id', 'description', 'qty', 'unit_price', 'kind', 'gross', 'net', 'tax', 'position'];
const PAYMENT_COLS = ['id', 'invoice_id', 'amount', 'method', 'reference', 'paid_at', 'created_by', 'created_at'];
const ROOM_COLS = ['id', 'number', 'type', 'nightly_rate', 'capacity', 'active'];
const GUEST_COLS = ['id', 'name', 'phone', 'email', 'tax_id', 'address', 'created_at'];
const RESERVATION_COLS = ['id', 'guest_id', 'guest_name', 'room_number', 'check_in', 'check_out', 'nightly_rate', 'status', 'notes', 'created_at'];

function pick(obj: Record<string, unknown>, cols: string[]): unknown[] {
  return cols.map((k) => (obj[k] === undefined ? null : obj[k]));
}

adminRoutes.post('/api/import', requireAuth(), requireRole('admin'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  let body: Backup;
  try { body = await c.req.json<Backup>(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid_backup' }, 400);

  const invoices = Array.isArray(body.invoices) ? body.invoices as Record<string, unknown>[] : [];
  const invoiceIds = new Set(invoices.map((i) => String(i.id)));
  const lines = (Array.isArray(body.lines) ? body.lines as Record<string, unknown>[] : []).filter((l) => invoiceIds.has(String(l.invoice_id)));
  const payments = (Array.isArray(body.payments) ? body.payments as Record<string, unknown>[] : []).filter((p) => invoiceIds.has(String(p.invoice_id)));
  const rooms = Array.isArray(body.rooms) ? body.rooms as Record<string, unknown>[] : [];
  const guests = Array.isArray(body.guests) ? body.guests as Record<string, unknown>[] : [];
  const reservations = Array.isArray(body.reservations) ? body.reservations as Record<string, unknown>[] : [];

  const ins = (table: string, cols: string[], rows: Record<string, unknown>[]) => rows.map((r) => ({
    sql: `INSERT OR REPLACE INTO ${table} (tenant_id, ${cols.join(', ')}) VALUES (${['?', ...cols.map(() => '?')].join(', ')})`,
    params: [tenantId, ...pick(r, cols)],
  }));

  const statements = [
    { sql: `DELETE FROM payments WHERE tenant_id = ?`, params: [tenantId] },
    { sql: `DELETE FROM invoice_lines WHERE tenant_id = ?`, params: [tenantId] },
    { sql: `DELETE FROM invoices WHERE tenant_id = ?`, params: [tenantId] },
    { sql: `DELETE FROM reservations WHERE tenant_id = ?`, params: [tenantId] },
    { sql: `DELETE FROM rooms WHERE tenant_id = ?`, params: [tenantId] },
    ...ins('guests', GUEST_COLS, guests),
    ...ins('rooms', ROOM_COLS, rooms),
    ...ins('reservations', RESERVATION_COLS, reservations),
    ...ins('invoices', INVOICE_COLS, invoices),
    ...ins('invoice_lines', LINE_COLS, lines),
    ...ins('payments', PAYMENT_COLS, payments),
  ];

  const s = body.settings;
  if (s && typeof s === 'object') {
    statements.push({
      sql: `INSERT OR REPLACE INTO settings (tenant_id, ${SETTINGS_COLS.join(', ')}, updated_at) VALUES (${['?', ...SETTINGS_COLS.map(() => '?'), '?'].join(', ')})`,
      params: [tenantId, ...SETTINGS_COLS.map((k) => (s[k] === undefined ? null : s[k])), new Date().toISOString()],
    });
  }
  const cnt = body.counter;
  if (cnt && typeof cnt === 'object' && cnt.next_serial !== undefined) {
    statements.push({ sql: `INSERT OR REPLACE INTO counters (tenant_id, next_serial, next_override) VALUES (?, ?, ?)`, params: [tenantId, cnt.next_serial, cnt.next_override ?? null] });
  }

  try {
    await db.batch(statements);
  } catch (e) {
    return c.json({ error: 'import_failed', detail: String((e as Error).message ?? e) }, 400);
  }
  await audit(db, { tenantId, userId: c.get('auth').user.id, action: 'data.import', entity: 'tenant', entityId: tenantId, detail: { invoices: invoices.length, rooms: rooms.length, guests: guests.length, reservations: reservations.length }, ip: clientIp(c) });
  return c.json({ ok: true, imported: { invoices: invoices.length, lines: lines.length, payments: payments.length, rooms: rooms.length, guests: guests.length, reservations: reservations.length } });
});

// ---------- serial review (present / missing / duplicate / cancelled) ----------
adminRoutes.get('/api/serial/review', requireAuth(), requireRole('admin', 'manager', 'accountant'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  const settings = await loadSettings(db, tenantId);
  const start = settings?.serial_start ?? 10246;
  const rows = await db.all<{ serial: number; n: number; cancelled: number; guests: string }>(
    `SELECT serial, COUNT(*) AS n,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
            GROUP_CONCAT(guest_name, ' / ') AS guests
       FROM invoices WHERE tenant_id = ? GROUP BY serial`, [tenantId]);
  const byNum = new Map(rows.map((r) => [r.serial, r]));
  const max = rows.length ? Math.max(...rows.map((r) => r.serial)) : start - 1;
  const entries: Array<{ serial: number; state: string; cancelled: boolean; guests: string; note: string }> = [];
  for (let n = start; n <= max; n++) {
    const r = byNum.get(n);
    if (!r) {
      entries.push({ serial: n, state: 'missing', cancelled: false, guests: '—', note: 'ابحث عنه أو حرّر محضر فقد' });
    } else if (r.n > 1) {
      entries.push({ serial: n, state: 'duplicate', cancelled: false, guests: r.guests, note: 'رقم مكرر — راجع الفاتورتين فورًا' });
    } else if (r.cancelled > 0) {
      entries.push({ serial: n, state: 'cancelled', cancelled: true, guests: r.guests, note: 'فاتورة ملغاة — الرقم لا يُعاد استخدامه' });
    } else {
      entries.push({ serial: n, state: 'present', cancelled: false, guests: r.guests, note: 'سليم' });
    }
  }
  return c.json({ start, max, entries });
});
