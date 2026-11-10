-- Generic idempotency log. Any write carrying an X-Op-Key header is recorded
-- once; a replay returns the stored response instead of re-applying the write.
CREATE TABLE IF NOT EXISTS op_log (
  tenant_id  TEXT    NOT NULL,
  op_key     TEXT    NOT NULL,
  status     INTEGER NOT NULL,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (tenant_id, op_key)
);
