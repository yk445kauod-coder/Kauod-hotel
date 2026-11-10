# Editable tax fields (global + per-invoice) + professional V13-style invoice

Date: 2026-11-10

## Intent
The hotel owner wants two things:
1. Tax data and fixed invoice text must be **editable**, not hard-coded — both as
   **global settings** and **per individual invoice**.
2. The **printed invoice** must be redesigned to match the uploaded
   `Kaoud-Invoice-Complete-Professional-V13.html`, professionally, and include
   the **hotel logo**.

## Goals
- Global settings (already partly editable) gain: signature labels, footer note,
  and a logo.
- Per-invoice editable tax fields: VAT %, discount %, issuer name, issuer tax
  number, issuer address — for that invoice only, falling back to settings.
- Print layout rebuilt to match V13: gradient bar, 3-column header with logo,
  "BILL TO" card, navy total card, lines table, summary box, two signatures, QR.
- Cancelled invoices print a red CANCELLED banner.

## Non-goals
- Submitting to the ETA (still optional; invoice stays ETA-ready).
- Multi-currency; credit/debit notes.
- Redesigning screens other than the invoice editor + print.

## Anti-goals
- Breaking the money invariant `net + tax − discount == total`.
- Letting tax be edited on a locked/cancelled invoice.

## Key decisions (my picks — correctable)
1. **Per-invoice overrides** live in new nullable columns on `invoices`
   (`vat_rate`, `discount_rate`, `issuer_name`, `issuer_tax_id`,
   `issuer_address`); `NULL` = inherit from settings. Typed columns beat a JSON
   blob for validation and reporting.
2. **Editable only while `open`.** Once locked, tax fields freeze — matches the
   existing "must lock before print" gate and protects the audit trail.
3. **Logo** is a base64 data URI in `settings.logo_data` (~5 KB, same pattern
   the V13 file uses). Uploaded from Settings. No file storage / BLOB needed.
4. **Signature labels + footer** are new settings columns
   (`signature_left`, `signature_right`, `footer_note`), defaulted to the V13
   Arabic/English text.
5. **Per-invoice edit surface** is a collapsible "بيانات الضريبة" section inside
   the invoice editor.
6. **Print** = the V13 structure, driven by CSS classes in `styles.css`
   (navy `#0F2340`, gold `#8A6D00`, A4).

## What's left to the builder
- Exact spacing/typography; verify print on A4.
- Migration `0002` for the new columns (both tables).
