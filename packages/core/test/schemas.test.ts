import { describe, it, expect } from 'vitest';
import { InvoiceInputSchema, LINE_KINDS, LineKindSchema } from '../src/index.js';

describe('InvoiceInputSchema', () => {
  const base = {
    guestName: 'أحمد محمد',
    lines: [{ description: 'إقامة', qty: 1, unitPrice: 500, kind: 'room' }],
  };

  it('accepts every canonical line kind', () => {
    for (const kind of LINE_KINDS) {
      const r = InvoiceInputSchema.safeParse({ ...base, lines: [{ description: 'x', qty: 1, unitPrice: 100, kind }] });
      expect(r.success).toBe(true);
    }
  });

  it('rejects a line kind outside the canonical set', () => {
    expect(LineKindSchema.safeParse('other').success).toBe(false);
    const r = InvoiceInputSchema.safeParse({ ...base, lines: [{ description: 'x', qty: 1, unitPrice: 100, kind: 'other' }] });
    expect(r.success).toBe(false);
  });

  it('keeps the receiver tax id instead of stripping it', () => {
    const r = InvoiceInputSchema.safeParse({ ...base, receiverTaxId: '123456789' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.receiverTaxId).toBe('123456789');
  });

  it('defaults the receiver tax id to empty when omitted', () => {
    const r = InvoiceInputSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.receiverTaxId).toBe('');
  });
});
