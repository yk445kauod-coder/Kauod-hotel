import { calcInvoice, parseMoney, formatMoney, uuidv4, type InvoiceInput, type CalcResult } from '@kaoud/core';
import { Db } from './db.js';
import { newId } from './audit.js';
import { loadSettings, loadCounter, type Settings } from './settings.js';
import { etaDateTime } from '@kaoud/core';

export interface InvoiceRecord {
  id: string;
  tenant_id: string;
  serial: number;
  uuid: string;
  guest_id: string | null;
  guest_name: string;
  receiver_tax_id: string;
  room_number: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  issued_at: string;
  subtotal_net: string;
  subtotal_gross: string;
  tax_total: string;
  discount: string;
  total: string;
  notes: string;
  vat_rate: number | null;
  discount_rate: number | null;
  issuer_name: string | null;
  issuer_tax_id: string | null;
  issuer_address: string | null;
  eta_uuid: string | null;
  eta_status: string;
  eta_submitted_at: string | null;
  eta_error: string | null;
  created_at: string;
  updated_at: string;
  locked_at: string | null;
  cancelled_at: string | null;
}

export function taxConfigFromSettings(s: Settings) {
  return {
    vatRate: s.vat_rate,
    discountRate: s.discount_rate,
    pricesIncludeTax: !!s.prices_include_tax,
  };
}

export interface TaxOverrides {
  vatRate?: number | null;
  discountRate?: number | null;
}

// Per-invoice overrides win; null/undefined falls back to the tenant settings.
export function effectiveTaxConfig(s: Settings, o: TaxOverrides) {
  return {
    vatRate: o.vatRate ?? s.vat_rate,
    discountRate: o.discountRate ?? s.discount_rate,
    pricesIncludeTax: !!s.prices_include_tax,
  };
}

export interface CreateInvoiceInput extends InvoiceInput {
  guestId?: string;
  reservationId?: string;
  receiverTaxId?: string;
  vatRate?: number | null;
  discountRate?: number | null;
  issuerName?: string | null;
  issuerTaxId?: string | null;
  issuerAddress?: string | null;
  serial?: number;
  opId?: string;
}

// A device that reserved serial numbers may submit a serial inside its block.
export async function findDeviceBlock(
  db: Db, tenantId: string, serial: number,
): Promise<{ device_id: string } | null> {
  return db.one<{ device_id: string }>(
    `SELECT device_id FROM device_serials
     WHERE tenant_id = ? AND ? BETWEEN start_serial AND end_serial`,
    [tenantId, serial],
  );
}

export async function findOp(db: Db, tenantId: string, opId: string): Promise<{ entity_id: string } | null> {
  return db.one<{ entity_id: string }>(
    `SELECT entity_id FROM op_ids WHERE tenant_id = ? AND op_id = ?`, [tenantId, opId],
  );
}

// Allocates the next serial atomically, computes totals with the shared engine,
// and writes the invoice + its lines. The counter is advanced only on success.
export async function createInvoice(
  db: Db, tenantId: string, userId: string, input: CreateInvoiceInput,
): Promise<{ id: string; serial: number; calc: CalcResult; deduped?: boolean }> {
  const settings = await loadSettings(db, tenantId);
  if (!settings) throw new Error('settings_missing');
  const counter = await loadCounter(db, tenantId);
  if (!counter) throw new Error('counter_missing');

  // Idempotency: an offline write replayed twice returns the original invoice.
  if (input.opId) {
    const existing = await findOp(db, tenantId, input.opId);
    if (existing) {
      const inv = await getInvoice(db, tenantId, existing.entity_id);
      if (inv) return { id: inv.id, serial: inv.serial, calc: calcInvoice(input, effectiveTaxConfig(settings, input)), deduped: true };
    }
  }

  // Serial: an offline client supplies one from its reserved block; otherwise
  // the server allocates from the counter as before.
  let serial: number;
  if (input.serial !== undefined) {
    const block = await findDeviceBlock(db, tenantId, input.serial);
    if (!block) throw new Error('serial_not_reserved');
    serial = input.serial;
  } else {
    serial = counter.next_override && counter.next_override > 0 ? counter.next_override : counter.next_serial;
  }
  const calc = calcInvoice(input, effectiveTaxConfig(settings, input));
  const id = newId('inv');
  const now = new Date().toISOString();
  const uuid = uuidv4();

  const statements: Array<{ sql: string; params: unknown[] }> = [
    {
      sql: `INSERT INTO invoices
        (id, tenant_id, serial, uuid, guest_id, guest_name, receiver_tax_id, room_number, check_in, check_out,
         status, issued_at, subtotal_net, subtotal_gross, tax_total, discount, total, notes,
         vat_rate, discount_rate, issuer_name, issuer_tax_id, issuer_address,
         eta_uuid, eta_status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unconfigured', ?, ?, ?)`,
      params: [
        id, tenantId, serial, uuid, input.guestId ?? null, input.guestName, input.receiverTaxId ?? '',
        input.roomNumber ?? '', input.checkIn ?? null, input.checkOut ?? null,
        etaDateTime(), calc.subtotalNet, calc.subtotalGross, calc.taxTotal, calc.discount, calc.total,
        input.notes ?? '', input.vatRate ?? null, input.discountRate ?? null,
        input.issuerName ?? null, input.issuerTaxId ?? null, input.issuerAddress ?? null,
        uuid, userId, now, now,
      ],
    },
  ];

  calc.lines.forEach((l, idx) => {
    statements.push({
      sql: `INSERT INTO invoice_lines (id, invoice_id, tenant_id, description, qty, unit_price, kind, gross, net, tax, position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [newId('ln'), id, tenantId, l.description, l.qty, l.unitPrice, input.lines[idx].kind ?? 'extra', l.gross, l.net, l.tax, idx],
    });
  });

  // Advance the counter only when the server allocated the serial (an offline
  // block serial does not touch it); clear a one-shot override.
  if (input.serial === undefined) {
    statements.push({
      sql: `UPDATE counters SET next_serial = ?, next_override = NULL WHERE tenant_id = ?`,
      params: [serial + 1, tenantId],
    });
  }
  if (input.opId) {
    statements.push({
      sql: `INSERT OR IGNORE INTO op_ids (tenant_id, op_id, entity_id, created_at) VALUES (?, ?, ?, ?)`,
      params: [tenantId, input.opId, id, now],
    });
  }

  await db.batch(statements);
  return { id, serial, calc };
}

export async function getInvoice(db: Db, tenantId: string, id: string): Promise<InvoiceRecord | null> {
  return db.one<InvoiceRecord>(`SELECT * FROM invoices WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
}

export async function getInvoiceBySerial(db: Db, tenantId: string, serial: number): Promise<InvoiceRecord | null> {
  return db.one<InvoiceRecord>(`SELECT * FROM invoices WHERE serial = ? AND tenant_id = ?`, [serial, tenantId]);
}

export interface InvoiceLineRecord {
  id: string; description: string; qty: number; unit_price: string; kind: string;
  gross: string; net: string; tax: string; position: number;
}
export async function getInvoiceLines(db: Db, tenantId: string, invoiceId: string): Promise<InvoiceLineRecord[]> {
  return db.all<InvoiceLineRecord>(
    `SELECT id, description, qty, unit_price, kind, gross, net, tax, position
       FROM invoice_lines WHERE invoice_id = ? AND tenant_id = ? ORDER BY position`,
    [invoiceId, tenantId],
  );
}

export async function paidTotal(db: Db, tenantId: string, invoiceId: string): Promise<string> {
  const rows = await db.all<{ amount: string }>(`SELECT amount FROM payments WHERE invoice_id = ? AND tenant_id = ?`, [invoiceId, tenantId]);
  return formatMoney(rows.reduce((s, r) => s + parseMoney(r.amount), 0));
}
