-- Editable branding + tax: global settings additions and per-invoice overrides.
-- All new columns are nullable or defaulted, so existing rows keep working.

ALTER TABLE settings ADD COLUMN logo_data TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN signature_left TEXT NOT NULL DEFAULT 'المدير المالي|Financial Controller';
ALTER TABLE settings ADD COLUMN signature_right TEXT NOT NULL DEFAULT 'مدير الائتمان|Credit Manager';
ALTER TABLE settings ADD COLUMN footer_note TEXT NOT NULL DEFAULT 'هذه الفاتورة صادرة إلكترونيًا وفق منظومة الفاتورة الإلكترونية لمصلحة الضرائب المصرية.';

-- Per-invoice tax overrides. NULL means "inherit from settings".
ALTER TABLE invoices ADD COLUMN vat_rate REAL;
ALTER TABLE invoices ADD COLUMN discount_rate REAL;
ALTER TABLE invoices ADD COLUMN issuer_name TEXT;
ALTER TABLE invoices ADD COLUMN issuer_tax_id TEXT;
ALTER TABLE invoices ADD COLUMN issuer_address TEXT;
