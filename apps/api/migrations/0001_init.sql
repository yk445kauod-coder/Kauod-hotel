-- Kaoud Hotel invoicing — D1 (SQLite) schema
-- Multi-tenant: every business row carries tenant_id, and every query filters on it.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username       TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin','manager','reception','accountant')),
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  iterations     INTEGER NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  is_owner       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_username ON users(tenant_id, lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id    TEXT NOT NULL,
  csrf         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  tenant_id                TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  hotel_name               TEXT NOT NULL DEFAULT 'فندق قاعود سبورتنج',
  hotel_name_en            TEXT NOT NULL DEFAULT 'KAOUD SPORTING HOTEL',
  tax_registration_number  TEXT NOT NULL DEFAULT '000000000',
  commercial_register      TEXT NOT NULL DEFAULT '',
  activity_code            TEXT NOT NULL DEFAULT '5510',
  address                  TEXT NOT NULL DEFAULT '',
  city                     TEXT NOT NULL DEFAULT 'Alexandria',
  phone                    TEXT NOT NULL DEFAULT '',
  email                    TEXT NOT NULL DEFAULT '',
  vat_rate                 REAL NOT NULL DEFAULT 14,
  discount_rate            REAL NOT NULL DEFAULT 3,
  prices_include_tax       INTEGER NOT NULL DEFAULT 1,
  serial_start             INTEGER NOT NULL DEFAULT 10246,
  currency                 TEXT NOT NULL DEFAULT 'EGP',
  updated_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  tenant_id     TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  next_serial   INTEGER NOT NULL,
  next_override INTEGER
);

CREATE TABLE IF NOT EXISTS rooms (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number       TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT '',
  nightly_rate TEXT NOT NULL DEFAULT '0.00',
  capacity     INTEGER NOT NULL DEFAULT 2,
  active       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_tenant_number ON rooms(tenant_id, number);

CREATE TABLE IF NOT EXISTS guests (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  tax_id     TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guests_tenant_name ON guests(tenant_id, name);

CREATE TABLE IF NOT EXISTS reservations (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  guest_id     TEXT REFERENCES guests(id) ON DELETE SET NULL,
  guest_name   TEXT NOT NULL,
  room_number  TEXT NOT NULL DEFAULT '',
  check_in     TEXT NOT NULL,
  check_out    TEXT NOT NULL,
  nightly_rate TEXT NOT NULL DEFAULT '0.00',
  status       TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','checked_in','checked_out','cancelled')),
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_res_tenant_dates ON reservations(tenant_id, check_in);

CREATE TABLE IF NOT EXISTS invoices (
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
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','locked','cancelled')),
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
  cancelled_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_tenant_serial ON invoices(tenant_id, serial);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status ON invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_issued ON invoices(tenant_id, issued_at);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id          TEXT PRIMARY KEY,
  invoice_id  TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_lines_invoice ON invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount     TEXT NOT NULL,
  method     TEXT NOT NULL CHECK (method IN ('cash','card','instapay','bank_transfer','other')),
  reference  TEXT NOT NULL DEFAULT '',
  paid_at    TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  user_id    TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  detail     TEXT NOT NULL DEFAULT '',
  ip         TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_log(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE IF NOT EXISTS eta_queue (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  invoice_id  TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eta_queue_status ON eta_queue(status, created_at);
