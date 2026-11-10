import { Db } from './db.js';
import { randomHex } from './crypto.js';

export function newId(prefix: string): string {
  return `${prefix}_${randomHex(12)}`;
}

export interface AuditEntry {
  tenantId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  detail?: unknown;
  ip?: string | null;
}

export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.run(
    `INSERT INTO audit_log (id, tenant_id, user_id, action, entity, entity_id, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('aud'),
      e.tenantId,
      e.userId ?? null,
      e.action,
      e.entity,
      e.entityId ?? null,
      e.detail === undefined ? '' : JSON.stringify(e.detail).slice(0, 4000),
      e.ip ?? null,
      new Date().toISOString(),
    ],
  );
}
