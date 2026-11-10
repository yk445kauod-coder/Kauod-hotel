import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function current(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(current);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('kaoud_theme', theme); } catch { /* storage may be unavailable */ }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
}
