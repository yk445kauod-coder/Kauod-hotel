// Generic write outbox. Any data-entry write that fails because the network is
// down is queued here and flushed FIFO on reconnect. Each op carries an opKey
// that the server treats as an idempotency key, so a replayed op applies once.
import { api, ApiError } from './api';
import { idbTx, OUTBOX_STORE, isOnline } from './offline';

export interface OutboxOp {
  opKey: string;
  method: string;
  path: string;
  body?: unknown;
  label: string;
  createdAt: string;
  status: 'pending' | 'rejected';
  error?: string;
}

export interface MutateInput {
  method: string;
  path: string;
  body?: unknown;
  label: string;
}

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const allOps = () => idbTx<OutboxOp[]>(OUTBOX_STORE, 'readonly', (s) => s.getAll());
const putOp = (op: OutboxOp) => idbTx(OUTBOX_STORE, 'readwrite', (s) => s.put(op));
const delOp = (opKey: string) => idbTx(OUTBOX_STORE, 'readwrite', (s) => s.delete(opKey));

export const listOps = allOps;
export const removeOp = delOp;
export const enqueueOp = putOp;

export async function pendingOps(): Promise<number> {
  return (await allOps()).length;
}

// Try the write now; if the network is down, queue it. A server-side rejection
// (4xx) is surfaced immediately so the user can correct the input.
export async function mutate(input: MutateInput): Promise<{ queued: boolean; result?: unknown }> {
  const opKey = uuid();
  if (isOnline()) {
    try {
      const result = await api.request(input.path, { method: input.method, body: input.body, opKey });
      return { queued: false, result };
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
    }
  }
  await putOp({
    opKey, method: input.method, path: input.path, body: input.body,
    label: input.label, createdAt: new Date().toISOString(), status: 'pending',
  });
  return { queued: true };
}

// Flush FIFO. A network error stops the run (still offline). A 4xx other than
// 401/409 marks the op rejected and continues; 401/409 also stop the run.
export async function flushOutbox(): Promise<{ sent: number; failed: number }> {
  const ops = (await allOps()).filter((o) => o.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let sent = 0; let failed = 0;
  for (const op of ops) {
    try {
      await api.request(op.path, { method: op.method, body: op.body, opKey: op.opKey });
      await delOp(op.opKey);
      sent++;
    } catch (e) {
      failed++;
      if (e instanceof TypeError) break;
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401 || status === 409) break;
      await putOp({ ...op, status: 'rejected', error: e instanceof ApiError ? e.code : 'error' });
    }
  }
  return { sent, failed };
}
