-- Offline-capable desktop clients.
-- device_serials: blocks of invoice numbers reserved to a device so it can
-- number invoices offline without ever colliding with another device.
-- op_ids: idempotency keys so a replayed offline write is applied only once.

CREATE TABLE IF NOT EXISTS device_serials (
  tenant_id    TEXT    NOT NULL,
  device_id    TEXT    NOT NULL,
  start_serial INTEGER NOT NULL,
  end_serial   INTEGER NOT NULL,
  created_at   TEXT    NOT NULL,
  PRIMARY KEY (tenant_id, device_id)
);

CREATE TABLE IF NOT EXISTS op_ids (
  tenant_id  TEXT NOT NULL,
  op_id      TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, op_id)
);
