import { useEffect, useState, useCallback } from 'react';
import { isOnline, pendingCount, syncNow, isOfflineEnabled } from './offline';

export interface OfflineState {
  online: boolean;
  pending: number;
  syncing: boolean;
  sync: () => Promise<void>;
  refreshPending: () => Promise<void>;
}

// Tracks connectivity and the offline queue, and auto-flushes it when the
// browser comes back online (only while offline mode is enabled).
export function useOfflineSync(enabled: boolean): OfflineState {
  const [online, setOnline] = useState(isOnline());
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = useCallback(async () => {
    try { setPending(await pendingCount()); } catch { /* ignore */ }
  }, []);

  const sync = useCallback(async () => {
    if (!isOnline() || !isOfflineEnabled()) return;
    setSyncing(true);
    try { await syncNow(); await refreshPending(); }
    finally { setSyncing(false); }
  }, [refreshPending]);

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, refreshPending, sync]);

  return { online, pending, syncing, sync, refreshPending };
}
