export type Role = 'admin' | 'manager' | 'reception' | 'accountant';
export type InvoiceStatus = 'draft' | 'open' | 'locked' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'instapay' | 'bank_transfer' | 'other';

export interface LineItem {
  description: string;
  qty: number;              // e.g. nights, or count of units
  unitPrice: string;        // tax-inclusive price per unit, as decimal string
  kind: 'room' | 'restaurant' | 'minibar' | 'laundry' | 'extra';
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
