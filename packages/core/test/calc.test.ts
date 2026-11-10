import { describe, it, expect } from 'vitest';
import { calcInvoice, parseMoney, formatMoney } from '../src/index.js';
import type { InvoiceInput, TaxConfig } from '../src/index.js';

const cfg: TaxConfig = { vatRate: 14, discountRate: 3, pricesIncludeTax: true };

function input(over: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    guestName: 'أحمد محمد',
    roomNumber: '305',
    checkIn: '2026-11-05',
    checkOut: '2026-11-08',
    applyDiscount: true,
    lines: [
      { description: 'إقامة غرفة 305', qty: 3, unitPrice: '1000.00', kind: 'room' },
      { description: 'مطعم', qty: 1, unitPrice: '200.00', kind: 'restaurant' },
      { description: 'ميني بار', qty: 1, unitPrice: '100.00', kind: 'minibar' },
    ],
    ...over,
  };
}

describe('money', () => {
  it('parses and formats without float drift', () => {
    expect(formatMoney(parseMoney('1000'))).toBe('1000.00');
    expect(formatMoney(parseMoney('1234.567'))).toBe('1234.57');
    expect(formatMoney(parseMoney('0.005'))).toBe('0.01');
    expect(formatMoney(parseMoney('-50.25'))).toBe('-50.25');
    expect(formatMoney(parseMoney(''))).toBe('0.00');
  });
  it('rejects garbage', () => {
    expect(() => parseMoney('12abc')).toThrow();
  });
});

describe('calcInvoice (tax-inclusive)', () => {
  it('nights are computed from the date range', () => {
    expect(calcInvoice(input(), cfg).nights).toBe(3);
  });

  it('the invoice is internally consistent: net + tax - discount == total', () => {
    const c = calcInvoice(input(), cfg);
    const lhs = Math.round((Number(c.subtotalNet) + Number(c.taxTotal) - Number(c.discount)) * 100);
    expect(lhs).toBe(Math.round(Number(c.total) * 100));
  });

  it('total == gross - discount', () => {
    const c = calcInvoice(input(), cfg);
    const expected = Math.round((Number(c.subtotalGross) - Number(c.discount)) * 100);
    expect(Math.round(Number(c.total) * 100)).toBe(expected);
  });

  it('extracts 14% VAT that is inside the gross price', () => {
    const c = calcInvoice(input(), cfg);
    expect(c.subtotalGross).toBe('3300.00');
    expect(c.taxTotal).toBe('405.26');
  });

  it('applies no discount when applyDiscount is false', () => {
    expect(calcInvoice(input({ applyDiscount: false }), cfg).discount).toBe('0.00');
  });

  it('never yields NaN for missing dates', () => {
    const c = calcInvoice(input({ checkIn: undefined, checkOut: undefined }), cfg);
    expect(c.nights).toBe(0);
    expect(Number.isNaN(Number(c.total))).toBe(false);
  });

  it('treats checkout before checkin as zero nights', () => {
    expect(calcInvoice(input({ checkIn: '2026-11-08', checkOut: '2026-11-05' }), cfg).nights).toBe(0);
  });
});

describe('calcInvoice (tax-exclusive mode)', () => {
  it('adds VAT on top of net', () => {
    const c = calcInvoice(input(), { vatRate: 14, discountRate: 0, pricesIncludeTax: false });
    expect(c.subtotalNet).toBe('3300.00');
    expect(c.taxTotal).toBe('462.00');
    expect(c.total).toBe('3762.00');
  });
});

describe('per-invoice tax overrides (engine level)', () => {
  it('honours a 0% override and keeps net + tax - discount == total', () => {
    const r = calcInvoice(input({ lines: [{ description: 'خدمة', qty: 1, unitPrice: '1000.00', kind: 'extra' }] }),
      { vatRate: 0, discountRate: 0, pricesIncludeTax: true });
    expect(r.taxTotal).toBe('0.00');
    expect(r.discount).toBe('0.00');
    expect(r.total).toBe('1000.00');
  });

  it('a 10% VAT override changes tax but preserves the invariant', () => {
    const r = calcInvoice(input({ lines: [{ description: 'خدمة', qty: 1, unitPrice: '1100.00', kind: 'extra' }] }),
      { vatRate: 10, discountRate: 0, pricesIncludeTax: true });
    const lhs = parseMoney(r.subtotalNet) + parseMoney(r.taxTotal) - parseMoney(r.discount);
    expect(lhs).toBe(parseMoney(r.total));
    expect(r.taxTotal).toBe('100.00');
  });
});
