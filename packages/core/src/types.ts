export type Role = 'admin' | 'manager' | 'reception' | 'accountant';
export type InvoiceStatus = 'draft' | 'open' | 'locked' | 'printed' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'instapay' | 'bank_transfer' | 'other';

// The canonical set of invoice line kinds. This is the single source of truth
// for the zod schema and every UI dropdown; adding a kind here (and nowhere
// else) keeps the client and the server in agreement. The register report
// buckets on these exact values, so an out-of-set kind would both be rejected
// on write and vanish from the per-kind breakdown.
export const LINE_KINDS = ['room', 'restaurant', 'minibar', 'laundry', 'extra'] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export interface LineItem {
  description: string;
  qty: number;              // e.g. nights, or count of units
  unitPrice: string;        // tax-inclusive price per unit, as decimal string
  kind: LineKind;
}

export interface InvoiceInput {
  guestName: string;
  roomNumber?: string;
  checkIn?: string;         // ISO date
  checkOut?: string;        // ISO date
  lines: LineItem[];
  discountPercent?: number; // withholding / commercial discount, default from settings
  applyDiscount?: boolean;
  notes?: string;
}

export interface TaxConfig {
  vatRate: number;          // e.g. 14 (%)
  discountRate: number;     // e.g. 3 (%)
  pricesIncludeTax: boolean;
}

export interface LineResult {
  description: string;
  qty: number;
  unitPrice: string;
  gross: string;            // tax-inclusive line total
  net: string;
  tax: string;
}

export interface CalcResult {
  lines: LineResult[];
  nights: number;
  subtotalNet: string;      // sum of line nets
  subtotalGross: string;    // sum of line gross
  taxTotal: string;
  discount: string;
  total: string;            // net + tax - discount  (== gross - discount)
  vatRate: number;
  discountRate: number;
}
