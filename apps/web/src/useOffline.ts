import { useEffect, useState, useCallback } from 'react';
import { isOnline, pendingCount, syncNow, isOfflineEnabled } from './offline';
import { flushOutbox, pendingOps } from './outbox';

export interface OfflineState {
  online: boolean;
  pending: number;
  syncing: boolean;
  sync: () => Promise<void>;
  refreshPending: () => Promise<void>;
}

// Tracks connectivity and the offline queues (the legacy invoice queue plus the
// generic write outbox), and auto-flushes them when the browser reconnects.
// The generic outbox is always active; the invoice queue only while offline mode
// is on, which `sync()` checks itself.
export function useOfflineSync(): OfflineState {
  const [online, setOnline] = useState(isOnline());
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = useCallback(async () => {
    try {
      const [invoices, ops] = await Promise.all([pendingCount(), pendingOps()]);
      setPending(invoices + ops);
    } catch { /* ignore */ }
  }, []);

  const sync = useCallback(async () => {
    if (!isOnline()) return;
    setSyncing(true);
    try {
      if (isOfflineEnabled()) await syncNow();
      await flushOutbox();
      await refreshPending();
    } finally { setSyncing(false); }
  }, [refreshPending]);

  useEffect(() => {
    refreshPending();
    const goOnline = () => { setOnline(true); sync(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // Periodic retry so a queue created while "online" but the server was down still flushes.
    const timer = window.setInterval(() => { if (isOnline()) sync(); }, 30_000);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.clearInterval(timer);
    };
  }, [refreshPending, sync]);

  return { online, pending, syncing, sync, refreshPending };
}
