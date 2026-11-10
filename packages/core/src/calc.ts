import { parseMoney, formatMoney, mulDiv, sum, type Minor } from './money.js';
import type { CalcResult, InvoiceInput, LineItem, LineResult, TaxConfig } from './types.js';

export function nightsBetween(checkIn?: string, checkOut?: string): number {
  if (!checkIn || !checkOut) return 0;
  const a = Date.parse(checkIn + 'T00:00:00Z');
  const b = Date.parse(checkOut + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  const d = Math.round((b - a) / 86_400_000);
  return d > 0 ? d : 0;
}

// Prices are tax-INCLUSIVE by default (the hotel quotes a gross nightly rate).
// The invoice must show net + tax - discount == total, always. That is the
// invariant the previous version violated (subtotal + tax - discount != total).
export function calcInvoice(input: InvoiceInput, cfg: TaxConfig): CalcResult {
  const vatRate = Math.max(0, cfg.vatRate);
  const discountRate = input.applyDiscount === false ? 0 : Math.max(0, input.discountPercent ?? cfg.discountRate);

  const lines: LineResult[] = [];
  let subtotalGrossM = 0;
  let subtotalNetM = 0;
  let taxTotalM = 0;

  for (const li of input.lines) {
    const qty = Number(li.qty) || 0;
    const unitM = parseMoney(li.unitPrice);
    const grossM = Math.round(qty * unitM);
    let netM: number;
    let taxM: number;
    if (cfg.pricesIncludeTax) {
      netM = mulDiv(grossM, 100, 100 + vatRate);
      taxM = grossM - netM;
    } else {
      netM = grossM;
      taxM = mulDiv(netM, vatRate, 100);
    }
    subtotalGrossM += grossM;
    subtotalNetM += netM;
    taxTotalM += taxM;
    lines.push({
      description: li.description,
      qty,
      unitPrice: formatMoney(unitM),
      gross: formatMoney(grossM),
      net: formatMoney(netM),
      tax: formatMoney(taxM),
    });
  }

  const discountM = mulDiv(subtotalNetM, Math.round(discountRate * 100), 10_000);
  const totalM = subtotalNetM + taxTotalM - discountM;

  return {
    lines,
    nights: nightsBetween(input.checkIn, input.checkOut),
    subtotalNet: formatMoney(subtotalNetM),
    subtotalGross: formatMoney(subtotalGrossM),
    taxTotal: formatMoney(taxTotalM),
    discount: formatMoney(discountM),
    total: formatMoney(totalM),
    vatRate,
    discountRate,
  };
}

export function roomLines(input: InvoiceInput): LineItem[] {
  return input.lines;
}

export { sum };
