import { describe, it, expect } from 'vitest';
import {
  calcInvoice, buildEtaDocument, buildEtaSubmission, validateEtaDocument,
  etaQrPayload, qrTlv, uuidv4, etaDateTime,
} from '../src/index.js';
import type { InvoiceInput, TaxConfig, EtaIssuerConfig } from '../src/index.js';

const cfg: TaxConfig = { vatRate: 14, discountRate: 3, pricesIncludeTax: true };
const issuer: EtaIssuerConfig = {
  taxRegistrationNumber: '706904204',
  name: 'فندق قاعود سبورتنج',
  activityCode: '5510',
  address: { country: 'EG', governate: 'Alexandria', regionCity: 'Alexandria', street: 'Corniche', buildingNumber: '1' },
};

const inv: InvoiceInput = {
  guestName: 'أحمد محمد',
  checkIn: '2026-11-05',
  checkOut: '2026-11-08',
  applyDiscount: true,
  lines: [
    { description: 'إقامة غرفة 305', qty: 3, unitPrice: '1000.00', kind: 'room' },
    { description: 'مطعم', qty: 1, unitPrice: '200.00', kind: 'restaurant' },
  ],
};

describe('uuid', () => {
  it('generates valid, unique v4 uuids', () => {
    const a = uuidv4(), b = uuidv4();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe('ETA document', () => {
  it('builds a document that passes its own validator', () => {
    const c = calcInvoice(inv, cfg);
    const doc = buildEtaDocument({ serial: 10246, issuedAt: etaDateTime(), receiverName: 'أحمد محمد', calc: c, issuer });
    expect(validateEtaDocument(doc)).toEqual([]);
  });

  it('flags an inconsistent total (the classic ETA rejection)', () => {
    const c = calcInvoice(inv, cfg);
    const doc = buildEtaDocument({ serial: 1, issuedAt: etaDateTime(), receiverName: 'x', calc: c, issuer });
    doc.totalAmount = '999.99';
    const issues = validateEtaDocument(doc);
    expect(issues.some((i) => i.path === 'totalAmount')).toBe(true);
  });

  it('flags a bad tax registration number and activity code', () => {
    const c = calcInvoice(inv, cfg);
    const doc = buildEtaDocument({ serial: 1, issuedAt: etaDateTime(), receiverName: 'x', calc: c, issuer: { ...issuer, taxRegistrationNumber: '123', activityCode: '99' } });
    const paths = validateEtaDocument(doc).map((i) => i.path);
    expect(paths).toContain('issuer.id');
    expect(paths).toContain('taxpayerActivityCode');
  });

  it('submission has no signature when no signer is configured', async () => {
    const c = calcInvoice(inv, cfg);
    const doc = buildEtaDocument({ serial: 1, issuedAt: etaDateTime(), receiverName: 'x', calc: c, issuer });
    const sub = await buildEtaSubmission(doc);
    expect(sub.documents).toHaveLength(1);
    expect(sub.signatures).toHaveLength(0);
  });

  it('submission is signed when a signer is provided', async () => {
    const c = calcInvoice(inv, cfg);
    const doc = buildEtaDocument({ serial: 1, issuedAt: etaDateTime(), receiverName: 'x', calc: c, issuer });
    const sub = await buildEtaSubmission(doc, { sign: async (p) => `sig:${p.length}` });
    expect(sub.signatures[0].signatureType).toBe('I');
    expect(sub.signatures[0].value.startsWith('sig:')).toBe(true);
  });
});

describe('QR TLV', () => {
  it('encodes tag/length/value and is decodable', () => {
    const b64 = qrTlv({ 1: 'AB', 2: 'CDE' });
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect([...bytes]).toEqual([1, 2, 65, 66, 2, 3, 67, 68, 69]);
  });

  it('produces a payload containing the uuid and totals', () => {
    const id = uuidv4();
    const p = etaQrPayload({ sellerName: 'X', vatNumber: '706904204', issuedAt: '2026-11-09T10:00:00', total: '100.00', vatTotal: '14.00', uuid: id });
    const text = atob(p);
    expect(text).toContain('706904204');
    expect(text).toContain(id.slice(0, 8));
  });
});
