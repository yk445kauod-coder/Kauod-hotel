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
//
// VAT is rounded ONCE on the document subtotal (exactly like the V15 reference,
// `Math.round(sub*14/114*100)/100`) and then reconciled onto the lines so the
// per-line taxes still sum to the document tax. Rounding each line independently
// and summing would drift by a piastre on multi-line invoices, so the printed VAT
// would not match V15.
export function calcInvoice(input: InvoiceInput, cfg: TaxConfig): CalcResult {
  const vatRate = Math.max(0, cfg.vatRate);
  const discountRate = input.applyDiscount === false ? 0 : Math.max(0, input.discountPercent ?? cfg.discountRate);

  const grossM: Minor[] = [];
  for (const li of input.lines) {
    const qty = Number(li.qty) || 0;
    grossM.push(Math.round(qty * parseMoney(li.unitPrice)));
  }
  const subtotalGrossM = sum(...grossM);

  // Document-level net/tax, each rounded a single time (matches V15).
  const taxTotalM = cfg.pricesIncludeTax
    ? mulDiv(subtotalGrossM, vatRate, 100 + vatRate)
    : mulDiv(subtotalGrossM, vatRate, 100);
  const subtotalNetM = cfg.pricesIncludeTax ? subtotalGrossM - taxTotalM : subtotalGrossM;

  // Distribute onto lines, then fold any rounding drift into the last line so
  // sum(line.net) == subtotalNet and sum(line.tax) == taxTotal exactly.
  const netM = grossM.map((g) => (cfg.pricesIncludeTax ? mulDiv(g, 100, 100 + vatRate) : g));
  const taxM = cfg.pricesIncludeTax
    ? grossM.map((g, i) => g - netM[i])
    : netM.map((n) => mulDiv(n, vatRate, 100));
  if (netM.length > 0) {
    const last = netM.length - 1;
    netM[last] += subtotalNetM - sum(...netM);
    taxM[last] += taxTotalM - sum(...taxM);
  }

  const lines: LineResult[] = input.lines.map((li, i) => ({
    description: li.description,
    qty: Number(li.qty) || 0,
    unitPrice: formatMoney(parseMoney(li.unitPrice)),
    gross: formatMoney(grossM[i]),
    net: formatMoney(netM[i]),
    tax: formatMoney(taxM[i]),
  }));

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
