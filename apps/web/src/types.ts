export type Role = 'admin' | 'manager' | 'reception' | 'accountant';

export interface SessionUser { id: string; username: string; name: string; role: Role; isOwner: boolean; }

export interface InvoiceSummary {
  id: string; serial: number; guest_name: string; room_number: string;
  check_in: string | null; check_out: string | null; status: 'draft' | 'open' | 'locked' | 'printed' | 'cancelled';
  issued_at: string; subtotal_net: string; subtotal_gross: string; tax_total: string;
  discount: string; total: string; eta_status: string; payment_method?: string; created_at: string;
}

export interface InvoiceLine {
  id: string; description: string; qty: number; unit_price: string; kind: string;
  gross: string; net: string; tax: string; position: number;
}

export interface InvoiceFull extends Omit<InvoiceSummary, 'created_at'> {
  uuid: string; receiver_tax_id: string; notes: string; eta_uuid: string | null;
  eta_submitted_at: string | null; eta_error: string | null;
  vat_rate: number | null; discount_rate: number | null;
  issuer_name: string | null; issuer_tax_id: string | null; issuer_address: string | null;
  payment_method: string;
}

export interface Settings {
  hotel_name: string; hotel_name_en: string; tax_registration_number: string; commercial_register: string;
  activity_code: string; address: string; city: string; phone: string; email: string;
  vat_rate: number; discount_rate: number; prices_include_tax: number; serial_start: number; currency: string;
  logo_data: string; signature_left: string; signature_right: string; footer_note: string;
}

export interface CalcResult {
  nights: number; subtotalGross: string; subtotalNet: string; taxTotal: string;
  discount: string; total: string; vatRate: number; discountRate: number;
  lines: { description: string; qty: number; unitPrice: string; gross: string; net: string; tax: string }[];
}

export interface Payment { id: string; amount: string; method: string; reference: string; paid_at: string; created_at: string; }
export interface Room { id: string; number: string; type: string; nightly_rate: string; capacity: number; active: number; }
export interface Guest { id: string; name: string; phone: string; email: string; tax_id: string; address: string; created_at: string; }
export interface Reservation {
  id: string; guest_name: string; room_number: string; check_in: string; check_out: string;
  nightly_rate: string; status: string; notes: string; created_at: string;
}
export interface AuditEntry { id: string; user_id: string | null; action: string; entity: string; entity_id: string | null; detail: string; ip: string | null; created_at: string; }
export interface EtaQueueItem { id: string; invoice_id: string; status: string; attempts: number; last_error: string | null; created_at: string; updated_at: string; serial: number; }
