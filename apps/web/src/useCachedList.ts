import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { cacheGet, cacheSet } from './cache';

export interface CachedList<T> {
  data: T | null;
  fromCache: boolean;
  loading: boolean;
  reload: () => Promise<void>;
}

// Loads a list from the API, caching the last good response. When the network
// is down the cached copy is served instead and `fromCache` is set so the UI
// can label it "last connection".
export function useCachedList<T>(key: string, path: string, enabled = true): CachedList<T> {
  const [data, setData] = useState<T | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(enabled);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await api.get<T>(path);
      setData(fresh);
      setFromCache(false);
      await cacheSet(key, fresh);
    } catch (e) {
      const hit = await cacheGet<T>(key);
      if (hit) { setData(hit.data); setFromCache(true); }
      else if (!(e instanceof TypeError)) { /* server error with no cache: leave empty */ }
    } finally {
      setLoading(false);
    }
  }, [key, path]);

  useEffect(() => { if (enabled) reload(); }, [enabled, reload]);

  return { data, fromCache, loading, reload };
}
