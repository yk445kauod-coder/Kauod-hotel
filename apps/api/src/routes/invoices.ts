import { Hono } from 'hono';
import {
  InvoiceInputSchema, PaymentSchema, calcInvoice, buildEtaDocument, etaQrPayload,
  etaDateTime, validateEtaDocument, tafqeet,
} from '@kaoud/core';
import type { Env } from '../db.js';
import { requireAuth, requireRole } from '../auth-middleware.js';
import { audit } from '../audit.js';
import { loadSettings, loadCounter, previewNextSerial } from '../settings.js';
import {
  createInvoice, getInvoice, getInvoiceLines, paidTotal, effectiveTaxConfig,
} from '../invoices.js';
import { newId } from '../audit.js';
import { etaConfigured } from '../eta-service.js';
import { clientIp } from '../http.js';

export const invoiceRoutes = new Hono<{ Bindings: Env }>();

const LIST_COLS = `id, serial, guest_name, room_number, check_in, check_out, status, issued_at,
  subtotal_net, subtotal_gross, tax_total, discount, total, eta_status, payment_method, created_at`;

invoiceRoutes.get('/api/invoices', requireAuth(), async (c) => {
  const db = c.get('db');
  const { tenantId } = c.get('auth').user;
  const q = c.req.query('q')?.trim() ?? '';
  const status = c.req.query('status') ?? '';
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50)));
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0));
  const sort = c.req.query('sort') === 'total' ? 'total' : 'serial';
  const dir = c.req.query('dir') === 'asc' ? 'ASC' : 'DESC';

  const where: string[] = ['tenant_id = ?'];
  const params: unknown[] = [tenantId];
  if (status) { where.push('status = ?'); params.push(status); }
  if (q) { where.push('(guest_name LIKE ? OR room_number LIKE ? OR CAST(serial AS TEXT) LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  // Field-specific filters for the register search (serial / date / guest / room).
  const serial = c.req.query('serial')?.trim() ?? '';
  const guest = c.req.query('guest')?.trim() ?? '';
  const room = c.req.query('room')?.trim() ?? '';
  if (serial) { where.push('CAST(serial AS TEXT) LIKE ?'); params.push(`%${serial}%`); }
  if (guest) { where.push('guest_name LIKE ?'); params.push(`%${guest}%`); }
  if (room) { where.push('room_number LIKE ?'); params.push(`%${room}%`); }
  if (from) { where.push('issued_at >= ?'); params.push(from); }
  if (to) { where.push('issued_at <= ?'); params.push(to + '\uffff'); }

  const clause = where.join(' AND ');
  const total = await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM invoices WHERE ${clause}`, params);
  const rows = await db.all(
    `SELECT ${LIST_COLS} FROM invoices WHERE ${clause} ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`,
    [...params, limit, offset]);
  return c.json({ invoices: rows, total: total?.n ?? 0, limit, offset });
});

invoiceRoutes.get('/api/invoices/next-serial', requireAuth(), async (c) => {
  const counter = await loadCounter(c.get('db'), c.get('auth').user.tenantId);
  return c.json({ nextSerial: previewNextSerial(counter) });
});

invoiceRoutes.get('/api/invoices/:id', requireAuth(), async (c) => {
  const db = c.get('db');
  const { tenantId } = c.get('auth').user;
  const inv = await getInvoice(db, tenantId, (c.req.param('id') ?? ''));
  if (!inv) return c.json({ error: 'not_found' }, 404);
  const lines = await getInvoiceLines(db, tenantId, inv.id);
  const paid = await paidTotal(db, tenantId, inv.id);
  return c.json({ invoice: inv, lines, paid });
});

invoiceRoutes.post('/api/invoices', requireAuth(), requireRole('admin', 'manager', 'reception'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const parsed = InvoiceInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  let id: string; let serial: number;
  try {
    ({ id, serial } = await createInvoice(db, tenantId, userId, parsed.data));
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'serial_not_reserved') return c.json({ error: 'serial_not_reserved' }, 409);
    if (msg === 'settings_missing' || msg === 'counter_missing') return c.json({ error: msg }, 500);
    throw e;
  }
  await audit(db, { tenantId, userId, action: 'invoice.create', entity: 'invoice', entityId: id, detail: { serial }, ip: clientIp(c) });
  const inv = await getInvoice(db, tenantId, id);
  const lines = await getInvoiceLines(db, tenantId, id);
  return c.json({ invoice: inv, lines }, 201);
});

// Recompute + update an invoice that is still open (not locked/cancelled).
invoiceRoutes.put('/api/invoices/:id', requireAuth(), requireRole('admin', 'manager', 'reception'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const inv = await getInvoice(db, tenantId, (c.req.param('id') ?? ''));
  if (!inv) return c.json({ error: 'not_found' }, 404);
  if (inv.status === 'locked') return c.json({ error: 'invoice_locked' }, 409);
  if (inv.status === 'cancelled') return c.json({ error: 'invoice_cancelled' }, 409);

  const parsed = InvoiceInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const settings = await loadSettings(db, tenantId);
  if (!settings) return c.json({ error: 'settings_missing' }, 500);
  const calc = calcInvoice(parsed.data, effectiveTaxConfig(settings, parsed.data));
  const now = new Date().toISOString();

  const stmts: Array<{ sql: string; params: unknown[] }> = [
    { sql: `DELETE FROM invoice_lines WHERE invoice_id = ? AND tenant_id = ?`, params: [inv.id, tenantId] },
    {
      sql: `UPDATE invoices SET guest_name = ?, room_number = ?, check_in = ?, check_out = ?,
              subtotal_net = ?, subtotal_gross = ?, tax_total = ?, discount = ?, total = ?, notes = ?,
              vat_rate = ?, discount_rate = ?, issuer_name = ?, issuer_tax_id = ?, issuer_address = ?,
              payment_method = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
      params: [parsed.data.guestName, parsed.data.roomNumber ?? '', parsed.data.checkIn ?? null, parsed.data.checkOut ?? null,
        calc.subtotalNet, calc.subtotalGross, calc.taxTotal, calc.discount, calc.total, parsed.data.notes ?? '',
        parsed.data.vatRate ?? null, parsed.data.discountRate ?? null,
        parsed.data.issuerName ?? null, parsed.data.issuerTaxId ?? null, parsed.data.issuerAddress ?? null,
        parsed.data.paymentMethod ?? 'cash',
        now, inv.id, tenantId],
    },
  ];
  calc.lines.forEach((l, idx) => {
    stmts.push({
      sql: `INSERT INTO invoice_lines (id, invoice_id, tenant_id, description, qty, unit_price, kind, gross, net, tax, position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [newId('ln'), inv.id, tenantId, l.description, l.qty, l.unitPrice, parsed.data.lines[idx].kind ?? 'extra', l.gross, l.net, l.tax, idx],
    });
  });
  await db.batch(stmts);
  await audit(db, { tenantId, userId, action: 'invoice.update', entity: 'invoice', entityId: inv.id, ip: clientIp(c) });
  const updated = await getInvoice(db, tenantId, inv.id);
  const lines = await getInvoiceLines(db, tenantId, inv.id);
  return c.json({ invoice: updated, lines });
});

invoiceRoutes.post('/api/invoices/:id/lock', requireAuth(), requireRole('admin', 'manager'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const inv = await getInvoice(db, tenantId, (c.req.param('id') ?? ''));
  if (!inv) return c.json({ error: 'not_found' }, 404);
  if (inv.status === 'cancelled') return c.json({ error: 'invoice_cancelled' }, 409);
  const now = new Date().toISOString();
  await db.run(`UPDATE invoices SET status = 'locked', locked_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    [now, now, inv.id, tenantId]);
  await audit(db, { tenantId, userId, action: 'invoice.lock', entity: 'invoice', entityId: inv.id, ip: clientIp(c) });
  return c.json({ ok: true });
});

invoiceRoutes.post('/api/invoices/:id/unlock', requireAuth(), requireRole('admin'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const inv = await getInvoice(db, tenantId, (c.req.param('id') ?? ''));
  if (!inv) return c.json({ error: 'not_found' }, 404);
  const now = new Date().toISOString();
  await db.run(`UPDATE invoices SET status = 'open', locked_at = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    [now, inv.id, tenantId]);
  await audit(db, { tenantId, userId, action: 'invoice.unlock', entity: 'invoice', entityId: inv.id, ip: clientIp(c) });
  return c.json({ ok: true });
});

// Cancel is a soft delete: the row stays for the serial audit trail.
invoiceRoutes.post('/api/invoices/:id/cancel', requireAuth(), requireRole('admin', 'manager'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const inv = await getInvoice(db, tenantId, (c.req.param('id') ?? ''));
  if (!inv) return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json().catch(() => ({})) as { reason?: string };
  const now = new Date().toISOString();
  await db.run(`UPDATE invoices SET status = 'cancelled', cancelled_at = ?, updated_at = ?, notes = notes || ? WHERE id = ? AND tenant_id = ?`,
    [now, now, body.reason ? `\n[cancel] ${body.reason}` : '', inv.id, tenantId]);
  await audit(db, { tenantId, userId, action: 'invoice.cancel', entity: 'invoice', entityId: inv.id, detail: { reason: body.reason ?? '' }, ip: clientIp(c) });
  return c.json({ ok: true });
});

// Full print payload: invoice + lines + computed tax breakdown + ETA QR + payment status.
invoiceRoutes.get('/api/invoices/:id/print', requireAuth(), async (c) => {
  const db = c.get('db');
  const { tenantId } = c.get('auth').user;
  const inv = await getInvoice(db, tenantId, (c.req.param('id') ?? ''));
  if (!inv) return c.json({ error: 'not_found' }, 404);
  if (inv.status !== 'locked' && inv.status !== 'cancelled') {
    return c.json({ error: 'not_printable', message: 'Invoice must be locked before printing' }, 409);
  }
  const settings = await loadSettings(db, tenantId);
  if (!settings) return c.json({ error: 'settings_missing' }, 500);
  const lines = await getInvoiceLines(db, tenantId, inv.id);
  const paid = await paidTotal(db, tenantId, inv.id);
  const calc = calcInvoice({
    guestName: inv.guest_name,
    checkIn: inv.check_in ?? undefined,
    checkOut: inv.check_out ?? undefined,
    lines: lines.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unit_price, kind: l.kind as 'extra' })),
  }, effectiveTaxConfig(settings, { vatRate: inv.vat_rate, discountRate: inv.discount_rate }));

  // Per-invoice overrides win over the tenant settings for issuer identity too.
  const issuerName = inv.issuer_name || settings.hotel_name;
  const issuerTaxId = inv.issuer_tax_id || settings.tax_registration_number;
  const issuerAddress = inv.issuer_address || settings.address;

  const etaDoc = buildEtaDocument({
    serial: inv.serial, issuedAt: etaDateTime(new Date(inv.issued_at)), receiverName: inv.guest_name,
    receiverTaxId: inv.receiver_tax_id || undefined, calc,
    issuer: {
      taxRegistrationNumber: issuerTaxId, name: issuerName,
      activityCode: settings.activity_code,
      address: { country: 'EG', governate: settings.city, regionCity: settings.city, street: issuerAddress || '-', buildingNumber: '-' },
    },
  });
  const qr = etaQrPayload({
    sellerName: issuerName, vatNumber: issuerTaxId,
    issuedAt: etaDateTime(new Date(inv.issued_at)), total: calc.total, vatTotal: calc.taxTotal, uuid: inv.uuid,
  });
  return c.json({
    invoice: inv, lines, calc, settings, paid, qr,
    totalInWords: tafqeet(calc.total),
    issuer: { name: issuerName, taxId: issuerTaxId, address: issuerAddress, city: settings.city },
    etaIssues: validateEtaDocument(etaDoc).map((i) => `${i.path}: ${i.message}`),
    etaConfigured: etaConfigured(c.env),
  });
});

// ---------- payments ----------
invoiceRoutes.get('/api/invoices/:id/payments', requireAuth(), async (c) => {
  const db = c.get('db');
  const { tenantId } = c.get('auth').user;
  const inv = await getInvoice(db, tenantId, (c.req.param('id') ?? ''));
  if (!inv) return c.json({ error: 'not_found' }, 404);
  const rows = await db.all(`SELECT * FROM payments WHERE invoice_id = ? AND tenant_id = ? ORDER BY paid_at`, [inv.id, tenantId]);
  return c.json({ payments: rows, paid: await paidTotal(db, tenantId, inv.id) });
});

invoiceRoutes.post('/api/invoices/:id/payments', requireAuth(), requireRole('admin', 'manager', 'reception', 'accountant'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const inv = await getInvoice(db, tenantId, (c.req.param('id') ?? ''));
  if (!inv) return c.json({ error: 'not_found' }, 404);
  if (inv.status === 'cancelled') return c.json({ error: 'invoice_cancelled' }, 409);
  const parsed = PaymentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.issues }, 400);
  const amount = parsed.data.amount.toFixed(2);
  const id = newId('pay');
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO payments (id, tenant_id, invoice_id, amount, method, reference, paid_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, tenantId, inv.id, amount, parsed.data.method, parsed.data.reference ?? '', parsed.data.paidAt ?? now.slice(0, 10), userId, now]);
  await audit(db, { tenantId, userId, action: 'payment.create', entity: 'invoice', entityId: inv.id, detail: { amount, method: parsed.data.method }, ip: clientIp(c) });
  return c.json({ ok: true, paid: await paidTotal(db, tenantId, inv.id) }, 201);
});

invoiceRoutes.delete('/api/payments/:id', requireAuth(), requireRole('admin', 'manager'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const pay = await db.one<{ id: string; invoice_id: string }>(
    `SELECT id, invoice_id FROM payments WHERE id = ? AND tenant_id = ?`, [(c.req.param('id') ?? ''), tenantId]);
  if (!pay) return c.json({ error: 'not_found' }, 404);
  await db.run(`DELETE FROM payments WHERE id = ? AND tenant_id = ?`, [pay.id, tenantId]);
  await audit(db, { tenantId, userId, action: 'payment.delete', entity: 'payment', entityId: pay.id, ip: clientIp(c) });
  return c.json({ ok: true });
});
