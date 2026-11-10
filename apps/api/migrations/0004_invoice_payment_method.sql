-- Payment method recorded on the invoice itself (V15 parity: نقدي / فيزا /
-- تحويل بنكي / آجل). Kept separate from the `payments` ledger, which records
-- individual settlements; this is the intended method for the whole invoice.

ALTER TABLE invoices ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash';
