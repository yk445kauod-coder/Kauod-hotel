import { Hono } from 'hono';
import { RoomSchema, GuestSchema, ReservationSchema } from '@kaoud/core';
import type { Env } from '../db.js';
import { requireAuth, requireRole } from '../auth-middleware.js';
import { audit, newId } from '../audit.js';
import { clientIp } from '../http.js';
import { idempotency } from '../idempotency.js';

export const directoryRoutes = new Hono<{ Bindings: Env }>();

// ---------- rooms ----------
directoryRoutes.get('/api/rooms', requireAuth(), async (c) => {
  const rows = await c.get('db').all(`SELECT * FROM rooms WHERE tenant_id = ? ORDER BY number`, [c.get('auth').user.tenantId]);
  return c.json({ rooms: rows });
});

directoryRoutes.post('/api/rooms', requireAuth(), requireRole('admin', 'manager'), idempotency(), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const parsed = RoomSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const id = newId('room');
  await db.run(
    `INSERT INTO rooms (id, tenant_id, number, type, nightly_rate, capacity, active) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, tenantId, parsed.data.number, parsed.data.type ?? '', parsed.data.nightlyRate.toFixed(2), parsed.data.capacity ?? 2, parsed.data.active ? 1 : 0]);
  await audit(db, { tenantId, userId, action: 'room.create', entity: 'room', entityId: id, ip: clientIp(c) });
  return c.json({ ok: true, id }, 201);
});

directoryRoutes.patch('/api/rooms/:id', requireAuth(), requireRole('admin', 'manager'), idempotency(), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const parsed = RoomSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const sets: string[] = []; const params: unknown[] = [];
  const d = parsed.data;
  if (d.number !== undefined) { sets.push('number = ?'); params.push(d.number); }
  if (d.type !== undefined) { sets.push('type = ?'); params.push(d.type); }
  if (d.nightlyRate !== undefined) { sets.push('nightly_rate = ?'); params.push(d.nightlyRate.toFixed(2)); }
  if (d.capacity !== undefined) { sets.push('capacity = ?'); params.push(d.capacity); }
  if (d.active !== undefined) { sets.push('active = ?'); params.push(d.active ? 1 : 0); }
  if (!sets.length) return c.json({ ok: true });
  params.push((c.req.param('id') ?? ''), tenantId);
  await db.run(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
  await audit(db, { tenantId, userId, action: 'room.update', entity: 'room', entityId: (c.req.param('id') ?? ''), ip: clientIp(c) });
  return c.json({ ok: true });
});

directoryRoutes.delete('/api/rooms/:id', requireAuth(), requireRole('admin', 'manager'), idempotency(), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  await db.run(`DELETE FROM rooms WHERE id = ? AND tenant_id = ?`, [(c.req.param('id') ?? ''), tenantId]);
  await audit(db, { tenantId, userId, action: 'room.delete', entity: 'room', entityId: (c.req.param('id') ?? ''), ip: clientIp(c) });
  return c.json({ ok: true });
});

// ---------- guests ----------
directoryRoutes.get('/api/guests', requireAuth(), async (c) => {
  const q = c.req.query('q')?.trim() ?? '';
  const tenantId = c.get('auth').user.tenantId;
  const rows = q
    ? await c.get('db').all(`SELECT * FROM guests WHERE tenant_id = ? AND name LIKE ? ORDER BY name LIMIT 100`, [tenantId, `%${q}%`])
    : await c.get('db').all(`SELECT * FROM guests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100`, [tenantId]);
  return c.json({ guests: rows });
});

directoryRoutes.post('/api/guests', requireAuth(), requireRole('admin', 'manager', 'reception'), idempotency(), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const parsed = GuestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const id = newId('gst');
  await db.run(
    `INSERT INTO guests (id, tenant_id, name, phone, email, tax_id, address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, tenantId, parsed.data.name, parsed.data.phone ?? '', parsed.data.email ?? '', parsed.data.taxId ?? '', parsed.data.address ?? '', new Date().toISOString()]);
  await audit(db, { tenantId, userId, action: 'guest.create', entity: 'guest', entityId: id, ip: clientIp(c) });
  return c.json({ ok: true, id }, 201);
});

// ---------- reservations ----------
directoryRoutes.get('/api/reservations', requireAuth(), async (c) => {
  const tenantId = c.get('auth').user.tenantId;
  const status = c.req.query('status') ?? '';
  const rows = status
    ? await c.get('db').all(`SELECT * FROM reservations WHERE tenant_id = ? AND status = ? ORDER BY check_in DESC LIMIT 200`, [tenantId, status])
    : await c.get('db').all(`SELECT * FROM reservations WHERE tenant_id = ? ORDER BY check_in DESC LIMIT 200`, [tenantId]);
  return c.json({ reservations: rows });
});

directoryRoutes.post('/api/reservations', requireAuth(), requireRole('admin', 'manager', 'reception'), idempotency(), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const parsed = ReservationSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const id = newId('res');
  await db.run(
    `INSERT INTO reservations (id, tenant_id, guest_id, guest_name, room_number, check_in, check_out, nightly_rate, status, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?)`,
    [id, tenantId, parsed.data.guestId ?? null, parsed.data.guestName, parsed.data.roomNumber ?? '', parsed.data.checkIn,
      parsed.data.checkOut, parsed.data.nightlyRate.toFixed(2), parsed.data.notes ?? '', new Date().toISOString()]);
  await audit(db, { tenantId, userId, action: 'reservation.create', entity: 'reservation', entityId: id, ip: clientIp(c) });
  return c.json({ ok: true, id }, 201);
});

directoryRoutes.patch('/api/reservations/:id', requireAuth(), requireRole('admin', 'manager', 'reception'), idempotency(), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const body = await c.req.json().catch(() => ({})) as { status?: string };
  const allowed = ['booked', 'checked_in', 'checked_out', 'cancelled'];
  if (!body.status || !allowed.includes(body.status)) return c.json({ error: 'bad_request' }, 400);
  await db.run(`UPDATE reservations SET status = ? WHERE id = ? AND tenant_id = ?`, [body.status, (c.req.param('id') ?? ''), tenantId]);
  await audit(db, { tenantId, userId, action: 'reservation.status', entity: 'reservation', entityId: (c.req.param('id') ?? ''), detail: body, ip: clientIp(c) });
  return c.json({ ok: true });
});
