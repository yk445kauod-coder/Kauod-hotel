import { Hono } from 'hono';
import type { Env } from '../db.js';
import { requireAuth, requireRole } from '../auth-middleware.js';

export const reportRoutes = new Hono<{ Bindings: Env }>();

// Dashboard summary — excludes cancelled invoices from all money totals.
reportRoutes.get('/api/reports/summary', requireAuth(), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  const row = await db.one<{
    count: number; valid: number; cancelled: number; last_serial: number | null;
    total: number; tax: number; discount: number; net: number;
  }>(
    `SELECT
       COUNT(*) AS count,
       SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END) AS valid,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
       MAX(serial) AS last_serial,
       COALESCE(SUM(CASE WHEN status != 'cancelled' THEN CAST(total AS REAL) ELSE 0 END), 0) AS total,
       COALESCE(SUM(CASE WHEN status != 'cancelled' THEN CAST(tax_total AS REAL) ELSE 0 END), 0) AS tax,
       COALESCE(SUM(CASE WHEN status != 'cancelled' THEN CAST(discount AS REAL) ELSE 0 END), 0) AS discount,
       COALESCE(SUM(CASE WHEN status != 'cancelled' THEN CAST(subtotal_net AS REAL) ELSE 0 END), 0) AS net
     FROM invoices WHERE tenant_id = ?`,
    [tenantId]);
  const paidRow = await db.one<{ paid: number }>(
    `SELECT COALESCE(SUM(CAST(p.amount AS REAL)), 0) AS paid
       FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.tenant_id = ? AND i.status != 'cancelled'`,
    [tenantId]);
  return c.json({
    count: row?.count ?? 0,
    valid: row?.valid ?? 0,
    cancelled: row?.cancelled ?? 0,
    lastSerial: row?.last_serial ?? null,
    total: Number(row?.total ?? 0).toFixed(2),
    tax: Number(row?.tax ?? 0).toFixed(2),
    discount: Number(row?.discount ?? 0).toFixed(2),
    net: Number(row?.net ?? 0).toFixed(2),
    paid: Number(paidRow?.paid ?? 0).toFixed(2),
    outstanding: (Number(row?.total ?? 0) - Number(paidRow?.paid ?? 0)).toFixed(2),
  });
});

// Revenue grouped by day or month over a range.
reportRoutes.get('/api/reports/revenue', requireAuth(), requireRole('admin', 'manager', 'accountant'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  const group = c.req.query('group') === 'month' ? 'month' : 'day';
  const from = c.req.query('from') ?? '0000-01-01';
  const to = c.req.query('to') ?? '9999-12-31';
  const expr = group === 'month' ? "substr(issued_at, 1, 7)" : "substr(issued_at, 1, 10)";
  const rows = await db.all(
    `SELECT ${expr} AS bucket,
            COUNT(*) AS invoices,
            COALESCE(SUM(CAST(total AS REAL)), 0) AS total,
            COALESCE(SUM(CAST(tax_total AS REAL)), 0) AS tax
       FROM invoices
      WHERE tenant_id = ? AND status != 'cancelled' AND issued_at >= ? AND issued_at <= ?
      GROUP BY bucket ORDER BY bucket`,
    [tenantId, from, to + '\uffff']);
  return c.json({ group, rows: rows.map((r: Record<string, unknown>) => ({ ...r, total: Number(r.total).toFixed(2), tax: Number(r.tax).toFixed(2) })) });
});

// Dashboard charts data: a 14-day revenue trend and the top rooms by revenue.
reportRoutes.get('/api/reports/dashboard', requireAuth(), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;

  const trend = await db.all<{ day: string; total: number; count: number }>(
    `SELECT substr(issued_at, 1, 10) AS day,
            COALESCE(SUM(CAST(total AS REAL)), 0) AS total,
            COUNT(*) AS count
       FROM invoices
      WHERE tenant_id = ? AND status != 'cancelled'
        AND substr(issued_at, 1, 10) >= date('now', '-13 days')
      GROUP BY day ORDER BY day`,
    [tenantId]);

  const topRooms = await db.all<{ room: string; total: number; count: number }>(
    `SELECT room_number AS room,
            COALESCE(SUM(CAST(total AS REAL)), 0) AS total,
            COUNT(*) AS count
       FROM invoices
      WHERE tenant_id = ? AND status != 'cancelled' AND room_number != ''
      GROUP BY room_number ORDER BY total DESC LIMIT 6`,
    [tenantId]);

  // Fill the 14-day window so the chart has no gaps.
  const byDay = new Map(trend.map((r) => [r.day, r]));
  const days: { day: string; total: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const r = byDay.get(key);
    days.push({ day: key, total: Number(r?.total ?? 0).toFixed(2), count: r?.count ?? 0 });
  }

  return c.json({
    trend: days,
    topRooms: topRooms.map((r) => ({ room: r.room, total: Number(r.total).toFixed(2), count: r.count })),
  });
});

// Register: every invoice with a per-kind gross breakdown (room / restaurant /
// services / extra) so the on-screen register can be exported as Excel/CSV.
reportRoutes.get('/api/reports/register', requireAuth(), requireRole('admin', 'manager', 'accountant'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  const where = ['i.tenant_id = ?'];
  const params: unknown[] = [tenantId];
  if (from) { where.push('i.issued_at >= ?'); params.push(from); }
  if (to) { where.push('i.issued_at <= ?'); params.push(to + '\uffff'); }
  const serial = c.req.query('serial')?.trim() ?? '';
  const guest = c.req.query('guest')?.trim() ?? '';
  const room = c.req.query('room')?.trim() ?? '';
  if (serial) { where.push('CAST(i.serial AS TEXT) LIKE ?'); params.push(`%${serial}%`); }
  if (guest) { where.push('i.guest_name LIKE ?'); params.push(`%${guest}%`); }
  if (room) { where.push('i.room_number LIKE ?'); params.push(`%${room}%`); }

  const rows = await db.all<{
    id: string; serial: number; issued_at: string; guest_name: string; room_number: string;
    check_in: string | null; check_out: string | null; status: string;
    subtotal_gross: string; subtotal_net: string; tax_total: string; discount: string; total: string;
    stay: number; restaurant: number; services: number; extra: number;
  }>(
    `SELECT i.id, i.serial, i.issued_at, i.guest_name, i.room_number, i.check_in, i.check_out, i.status,
            i.subtotal_gross, i.subtotal_net, i.tax_total, i.discount, i.total,
            COALESCE(SUM(CASE WHEN l.kind = 'room' THEN CAST(l.gross AS REAL) ELSE 0 END), 0) AS stay,
            COALESCE(SUM(CASE WHEN l.kind = 'restaurant' THEN CAST(l.gross AS REAL) ELSE 0 END), 0) AS restaurant,
            COALESCE(SUM(CASE WHEN l.kind IN ('minibar','laundry') THEN CAST(l.gross AS REAL) ELSE 0 END), 0) AS services,
            COALESCE(SUM(CASE WHEN l.kind = 'extra' THEN CAST(l.gross AS REAL) ELSE 0 END), 0) AS extra
       FROM invoices i LEFT JOIN invoice_lines l ON l.invoice_id = i.id
      WHERE ${where.join(' AND ')}
      GROUP BY i.id ORDER BY i.serial`,
    params);

  return c.json({
    rows: rows.map((r) => ({
      id: r.id, serial: r.serial, issuedAt: r.issued_at, guest: r.guest_name, room: r.room_number,
      checkIn: r.check_in, checkOut: r.check_out, status: r.status,
      stay: Number(r.stay).toFixed(2), restaurant: Number(r.restaurant).toFixed(2),
      services: Number(r.services).toFixed(2), extra: Number(r.extra).toFixed(2),
      subtotal: Number(r.subtotal_gross).toFixed(2), net: Number(r.subtotal_net).toFixed(2),
      tax: Number(r.tax_total).toFixed(2), discount: Number(r.discount).toFixed(2), total: Number(r.total).toFixed(2),
    })),
  });
});

// VAT return figures for a period (for the accountant / ETA filing).
reportRoutes.get('/api/reports/vat', requireAuth(), requireRole('admin', 'manager', 'accountant'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  const from = c.req.query('from') ?? '0000-01-01';
  const to = c.req.query('to') ?? '9999-12-31';
  const row = await db.one<{ net: number; tax: number; gross: number; discount: number; count: number }>(
    `SELECT COALESCE(SUM(CAST(subtotal_net AS REAL)), 0) AS net,
            COALESCE(SUM(CAST(tax_total AS REAL)), 0) AS tax,
            COALESCE(SUM(CAST(subtotal_gross AS REAL)), 0) AS gross,
            COALESCE(SUM(CAST(discount AS REAL)), 0) AS discount,
            COUNT(*) AS count
       FROM invoices WHERE tenant_id = ? AND status != 'cancelled' AND issued_at >= ? AND issued_at <= ?`,
    [tenantId, from, to + '\uffff']);
  return c.json({
    period: { from, to },
    invoiceCount: row?.count ?? 0,
    netSales: (row?.net ?? 0).toFixed(2),
    vatCollected: (row?.tax ?? 0).toFixed(2),
    grossSales: (row?.gross ?? 0).toFixed(2),
    discounts: (row?.discount ?? 0).toFixed(2),
  });
});
