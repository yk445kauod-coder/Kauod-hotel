import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from './api';
import type { SessionUser, Settings } from './types';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Invoices } from './pages/Invoices';
import { PrintView } from './pages/Print';
import { SettingsPage } from './pages/Settings';
import { UsersPage } from './pages/Users';
import { SerialPage } from './pages/Serial';
import { ReportsPage } from './pages/Reports';
import { DirectoryPage } from './pages/Directory';
import { AuditPage } from './pages/Audit';
import { ROLE_LABEL } from './format';
import { useTheme } from './theme';

type Tab = 'dashboard' | 'invoices' | 'reports' | 'directory' | 'serial' | 'users' | 'settings' | 'audit';

const NAV: { id: Tab; label: string; ico: string; roles?: SessionUser['role'][] }[] = [
  { id: 'dashboard', label: 'لوحة التحكم', ico: '▤' },
  { id: 'invoices', label: 'الفواتير', ico: '🧾' },
  { id: 'reports', label: 'التقارير', ico: '📊' },
  { id: 'directory', label: 'الغرف والنزلاء', ico: '🏨' },
  { id: 'serial', label: 'أرقام الفواتير', ico: '#️⃣', roles: ['admin', 'manager'] },
  { id: 'users', label: 'المستخدمون', ico: '👥', roles: ['admin', 'manager'] },
  { id: 'settings', label: 'الإعدادات', ico: '⚙️', roles: ['admin', 'manager'] },
  { id: 'audit', label: 'سجل النشاط', ico: '📜', roles: ['admin'] },
];

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [printId, setPrintId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [error, setError] = useState('');
  const { theme, toggle: toggleTheme } = useTheme();

  const loadSettings = useCallback(async () => {
    try { setSettings((await api.get<{ settings: Settings }>('/api/settings')).settings); }
    catch { /* settings may be unreadable for some roles; not fatal */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.get<{ user: SessionUser }>('/api/me');
        setUser(me.user);
        await loadSettings();
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401) setError('تعذّر الاتصال بالخدمة');
      } finally { setLoading(false); }
    })();
  }, [loadSettings]);

  // Close the mobile drawer with Escape and lock body scroll while it's open.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [navOpen]);

  const onLogin = async (u: SessionUser) => { setUser(u); await loadSettings(); setTab('dashboard'); };
  const onLogout = async () => {
    try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
    setUser(null); setSettings(null);
  };

  if (loading) return <div className="login-wrap"><div className="muted">جارٍ التحميل…</div></div>;
  if (!user) return <Login onLogin={onLogin} />;

  if (printId) {
    return <PrintView invoiceId={printId} onClose={() => setPrintId(null)} />;
  }

  const nav = NAV.filter((n) => !n.roles || n.roles.includes(user.role));
  const hotelName = settings?.hotel_name ?? 'فندق قاعود سبورتنج';

  return (
    <div className="app">
      <div className={`nav-scrim no-print ${navOpen ? 'open' : ''}`} onClick={() => setNavOpen(false)} aria-hidden="true" />
      <aside className={`sidebar no-print ${navOpen ? 'open' : ''}`}>
        <h1>
          {settings?.logo_data
            ? <img className="logo" src={settings.logo_data} alt={hotelName} />
            : <span className="logo-ph">{hotelName.trim().charAt(0) || 'ق'}</span>}
          <span>{hotelName}</span>
        </h1>
        <div className="hotel">نظام الفواتير والضرائب</div>
        {nav.map((n) => (
          <button key={n.id} className={`navbtn ${tab === n.id ? 'active' : ''}`} onClick={() => { setTab(n.id); setNavOpen(false); }}>
            <span className="ico">{n.ico}</span><span>{n.label}</span>
          </button>
        ))}
        <div className="spacer" />
        <div className="who">
          <b>{user.name}</b>
          <span>{ROLE_LABEL[user.role] ?? user.role}</span>
        </div>
        <button className="navbtn" onClick={onLogout}><span className="ico">⎋</span><span>خروج</span></button>
      </aside>

      <main className="main">
        <header className="topbar no-print">
          <div className="row" style={{ gap: 8, minWidth: 0, flex: 1, flexWrap: 'nowrap' }}>
            <button
              className="btn ghost nav-toggle"
              onClick={() => setNavOpen((v) => !v)}
              aria-label="القائمة"
              aria-expanded={navOpen}
              style={{ padding: '7px 10px', fontSize: 18 }}
            >
              ☰
            </button>
            <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {nav.find((n) => n.id === tab)?.label}
            </h2>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <span className="muted">{settings?.hotel_name ?? ''}</span>
            <button
              className="btn ghost"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
              aria-label={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
              style={{ padding: '7px 10px', fontSize: 16 }}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </header>
        <div className="content no-print">
          {error && <div className="alert err">{error}</div>}
          {tab === 'dashboard' && <Dashboard user={user} onOpenInvoice={(id) => { setPrintId(id); }} />}
          {tab === 'invoices' && <Invoices user={user} settings={settings} onPrint={(id) => setPrintId(id)} />}
          {tab === 'reports' && <ReportsPage />}
          {tab === 'directory' && <DirectoryPage user={user} />}
          {tab === 'serial' && <SerialPage user={user} />}
          {tab === 'users' && <UsersPage user={user} />}
          {tab === 'settings' && <SettingsPage user={user} onSaved={loadSettings} />}
          {tab === 'audit' && <AuditPage />}
        </div>
      </main>
    </div>
  );
}
