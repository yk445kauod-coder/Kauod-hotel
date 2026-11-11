-- Add the 'printed' invoice status (V15's x-step) and the daily-backup table.
--
-- SQLite cannot alter a CHECK constraint, so `invoices` must be rebuilt. D1
-- runs with foreign_keys=ON and ignores PRAGMA foreign_keys=OFF, so dropping
-- `invoices` would CASCADE-delete every invoice_lines / payments / eta_queue
-- row. Those three children are therefore rebuilt too, staged as *_new tables
-- that point at `invoices_new`; after the renames the FK text is rewritten to
-- `invoices` and cascades keep working. Child order: build new children,
-- insert, then drop children before the parent, then rename parent first.

CREATE TABLE invoices_new (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  serial          INTEGER NOT NULL,
  uuid            TEXT NOT NULL,
  guest_id        TEXT REFERENCES guests(id) ON DELETE SET NULL,
  guest_name      TEXT NOT NULL,
  receiver_tax_id TEXT NOT NULL DEFAULT '',
  room_number     TEXT NOT NULL DEFAULT '',
  check_in        TEXT,
  check_out       TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','locked','printed','cancelled')),
  issued_at       TEXT NOT NULL,
  subtotal_net    TEXT NOT NULL,
  subtotal_gross  TEXT NOT NULL,
  tax_total       TEXT NOT NULL,
  discount        TEXT NOT NULL,
  total           TEXT NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  eta_uuid        TEXT,
  eta_status      TEXT NOT NULL DEFAULT 'unconfigured',
  eta_submitted_at TEXT,
  eta_error       TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  locked_at       TEXT,
  cancelled_at    TEXT,
  vat_rate        REAL,
  discount_rate   REAL,
  issuer_name     TEXT,
  issuer_tax_id   TEXT,
  issuer_address  TEXT,
  payment_method  TEXT NOT NULL DEFAULT 'cash'
);

INSERT INTO invoices_new SELECT * FROM invoices;

CREATE TABLE invoice_lines_new (
  id          TEXT PRIMARY KEY,
  invoice_id  TEXT NOT NULL REFERENCES invoices_new(id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL,
  description TEXT NOT NULL,
  qty         REAL NOT NULL,
  unit_price  TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'extra',
  gross       TEXT NOT NULL,
  net         TEXT NOT NULL,
  tax         TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO invoice_lines_new SELECT * FROM invoice_lines;

CREATE TABLE payments_new (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoices_new(id) ON DELETE CASCADE,
  amount     TEXT NOT NULL,
  method     TEXT NOT NULL CHECK (method IN ('cash','card','instapay','bank_transfer','other')),
  reference  TEXT NOT NULL DEFAULT '',
  paid_at    TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO payments_new SELECT * FROM payments;

CREATE TABLE eta_queue_new (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  invoice_id  TEXT NOT NULL REFERENCES invoices_new(id) ON DELETE CASCADE,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
INSERT INTO eta_queue_new SELECT * FROM eta_queue;

DROP TABLE invoice_lines;
DROP TABLE payments;
DROP TABLE eta_queue;
DROP TABLE invoices;

ALTER TABLE invoices_new RENAME TO invoices;
ALTER TABLE invoice_lines_new RENAME TO invoice_lines;
ALTER TABLE payments_new RENAME TO payments;
ALTER TABLE eta_queue_new RENAME TO eta_queue;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_tenant_serial ON invoices(tenant_id, serial);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status ON invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_issued ON invoices(tenant_id, issued_at);
CREATE INDEX IF NOT EXISTS idx_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_eta_queue_status ON eta_queue(status, created_at);

-- Lazy daily backup snapshots (one row per tenant per day).
CREATE TABLE IF NOT EXISTS backups (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, day)
);
