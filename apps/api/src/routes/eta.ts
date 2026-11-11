import { Hono } from 'hono';
import { calcInvoice, etaDateTime, buildEtaDocument, etaQrPayload, validateEtaDocument } from '@kaoud/core';
import type { Env } from '../db.js';
import { requireAuth, requireRole } from '../auth-middleware.js';
import { audit, newId } from '../audit.js';
import { loadSettings } from '../settings.js';
import { getInvoice, getInvoiceLines, taxConfigFromSettings } from '../invoices.js';
import { etaConfigured } from '../eta-service.js';
import { clientIp } from '../http.js';

export const etaRoutes = new Hono<{ Bindings: Env }>();

async function buildPayload(c: import('hono').Context<{ Bindings: Env }>, invoiceId: string) {
  const db = c.get('db');
  const { tenantId } = c.get('auth').user;
  const inv = await getInvoice(db, tenantId, invoiceId);
  if (!inv) return null;
  const settings = await loadSettings(db, tenantId);
  if (!settings) return null;
  const lines = await getInvoiceLines(db, tenantId, inv.id);
  const calc = calcInvoice({
    guestName: inv.guest_name,
    checkIn: inv.check_in ?? undefined,
    checkOut: inv.check_out ?? undefined,
    lines: lines.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unit_price, kind: l.kind as 'extra' })),
  }, taxConfigFromSettings(settings));
  const issuedAt = etaDateTime(new Date(inv.issued_at));
  const document = buildEtaDocument({
    serial: inv.serial, issuedAt, receiverName: inv.guest_name,
    receiverTaxId: inv.receiver_tax_id || undefined, calc,
    issuer: {
      taxRegistrationNumber: settings.tax_registration_number, name: settings.hotel_name,
      activityCode: settings.activity_code,
      address: { country: 'EG', governate: settings.city, regionCity: settings.city, street: settings.address || '-', buildingNumber: '-' },
    },
  });
  const qr = etaQrPayload({
    sellerName: settings.hotel_name, vatNumber: settings.tax_registration_number,
    issuedAt, total: calc.total, vatTotal: calc.taxTotal, uuid: inv.uuid,
  });
  return { inv, settings, calc, document, qr, issues: validateEtaDocument(document).map((i) => `${i.path}: ${i.message}`) };
}

// Preview the ETA payload and the QR without submitting.
etaRoutes.get('/api/invoices/:id/eta', requireAuth(), async (c) => {
  const built = await buildPayload(c, (c.req.param('id') ?? ''));
  if (!built) return c.json({ error: 'not_found' }, 404);
  return c.json({
    configured: etaConfigured(c.env),
    document: built.document,
    qr: built.qr,
    issues: built.issues,
    status: built.inv.eta_status,
    etaUuid: built.inv.eta_uuid,
  });
});

// Submit (queue) the document for ETA. Blocked if validation fails, or if the
// invoice is not locked. When ETA credentials are absent, the payload is queued
// locally and eta_status stays 'queued' — never reported as accepted.
etaRoutes.post('/api/invoices/:id/eta/submit', requireAuth(), requireRole('admin', 'manager', 'accountant'), async (c) => {
  const db = c.get('db');
  const { tenantId, id: userId } = c.get('auth').user;
  const built = await buildPayload(c, (c.req.param('id') ?? ''));
  if (!built) return c.json({ error: 'not_found' }, 404);
  if (built.inv.status !== 'locked' && built.inv.status !== 'printed') return c.json({ error: 'not_locked', message: 'Lock the invoice before submitting to ETA' }, 409);
  if (built.issues.length) return c.json({ error: 'eta_invalid', issues: built.issues }, 422);

  const queueId = newId('eta');
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO eta_queue (id, tenant_id, invoice_id, payload, status, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [queueId, tenantId, built.inv.id, JSON.stringify({ document: built.document, qr: built.qr }), now, now]);
  const status = etaConfigured(c.env) ? 'queued' : 'queued_unconfigured';
  await db.run(`UPDATE invoices SET eta_status = ?, eta_submitted_at = ?, eta_error = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    [status, now, now, built.inv.id, tenantId]);
  await audit(db, { tenantId, userId, action: 'eta.submit', entity: 'invoice', entityId: built.inv.id, detail: { status }, ip: clientIp(c) });
  return c.json({ ok: true, status, queueId });
});

// Poll / list the ETA queue for reconciliation.
etaRoutes.get('/api/eta/queue', requireAuth(), requireRole('admin', 'manager', 'accountant'), async (c) => {
  const db = c.get('db');
  const tenantId = c.get('auth').user.tenantId;
  const rows = await db.all(
    `SELECT q.id, q.invoice_id, q.status, q.attempts, q.last_error, q.created_at, q.updated_at, i.serial
       FROM eta_queue q JOIN invoices i ON i.id = q.invoice_id
      WHERE q.tenant_id = ? ORDER BY q.created_at DESC LIMIT 200`, [tenantId]);
  return c.json({ queue: rows, configured: etaConfigured(c.env) });
});

// Download the ETA-ready JSON for an invoice (for manual upload to the portal).
etaRoutes.get('/api/invoices/:id/eta/document.json', requireAuth(), async (c) => {
  const built = await buildPayload(c, (c.req.param('id') ?? ''));
  if (!built) return c.json({ error: 'not_found' }, 404);
  c.header('Content-Disposition', `attachment; filename="eta-${built.inv.serial}.json"`);
  return c.json({ documents: [built.document], signatures: [] });
});
