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
import { useOfflineSync } from './useOffline';
import { isOfflineEnabled, setOfflineEnabled, reserveBlock, getBlock, setBlock, cacheSettings } from './offline';

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
  const [newInvoiceSignal, setNewInvoiceSignal] = useState(0);
  const [error, setError] = useState('');
  const [offlineMode, setOfflineMode] = useState(isOfflineEnabled());
  const { theme, toggle: toggleTheme } = useTheme();
  const { online, pending, syncing, sync, refreshPending } = useOfflineSync(offlineMode);

  const loadSettings = useCallback(async () => {
    try {
      const s = (await api.get<{ settings: Settings }>('/api/settings')).settings;
      setSettings(s);
      cacheSettings({ vat_rate: s.vat_rate, discount_rate: s.discount_rate, prices_include_tax: s.prices_include_tax });
    } catch { /* settings may be unreadable for some roles; not fatal */ }
  }, []);

  // Turn offline mode on: reserve a serial block for this device (needs to be
  // online once), then keep creating invoices offline and syncing on reconnect.
  const toggleOfflineMode = useCallback(async () => {
    const next = !offlineMode;
    if (next) {
      try {
        const b = await getBlock();
        if (!b) await reserveBlock(500);
      } catch { setError('تعذّر تجهيز الوضع الأوفلاين — تأكد من الاتصال مرة واحدة أولًا'); return; }
    }
    setOfflineEnabled(next);
    setOfflineMode(next);
    if (next) sync();
  }, [offlineMode, sync]);

  const onSynced = useCallback(() => { refreshPending(); }, [refreshPending]);

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
  const canWrite = ['admin', 'manager', 'reception'].includes(user.role);
  // Bottom bar: two tabs each side of a centred "+" so the FAB never crowds a tab.
  const bnRightDefs: { id: Tab; label: string; ico: string }[] = [
    { id: 'dashboard', label: 'الرئيسية', ico: '▤' },
    { id: 'invoices', label: 'الفواتير', ico: '🧾' },
  ];
  const bnRight = bnRightDefs.filter((b) => nav.some((n) => n.id === b.id));
  const bnLeftTab = nav.find((n) => n.id === 'reports') ?? nav.find((n) => n.id === 'directory');
  const bnLeft: { id: Tab; label: string; ico: string }[] = bnLeftTab
    ? [{ id: bnLeftTab.id, label: bnLeftTab.label, ico: bnLeftTab.ico }]
    : [];

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
            {offlineMode && (
              <button
                className={`offline-chip ${online ? 'is-on' : 'is-off'}`}
                onClick={() => sync()}
                disabled={!online || syncing}
                title={online ? (pending ? `${pending} فاتورة في انتظار المزامنة` : 'متصل — كل شيء متزامن') : 'غير متصل — الفواتير محفوظة محليًا'}
              >
                {online ? '🟢' : '🔴'} {syncing ? 'جارٍ المزامنة…' : pending ? `${pending} بانتظار المزامنة` : 'متزامن'}
              </button>
            )}
            <button
              className={`btn ghost ${offlineMode ? 'is-active' : ''}`}
              onClick={toggleOfflineMode}
              title={offlineMode ? 'إيقاف الوضع الأوفلاين' : 'تشغيل الوضع الأوفلاين (إنشاء فواتير بدون إنترنت)'}
              style={{ padding: '7px 10px', fontSize: 16 }}
            >
              {offlineMode ? '📴' : '📶'}
            </button>
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
          {tab === 'dashboard' && <Dashboard user={user} onOpenInvoice={(id) => { setPrintId(id); }} onNewInvoice={() => { setTab('invoices'); setNewInvoiceSignal((n) => n + 1); }} />}
          {tab === 'invoices' && <Invoices user={user} settings={settings} onPrint={(id) => setPrintId(id)} openNewSignal={newInvoiceSignal} offline={offlineMode} online={online} onQueued={onSynced} />}
          {tab === 'reports' && <ReportsPage />}
          {tab === 'directory' && <DirectoryPage user={user} />}
          {tab === 'serial' && <SerialPage user={user} />}
          {tab === 'users' && <UsersPage user={user} />}
          {tab === 'settings' && <SettingsPage user={user} onSaved={loadSettings} />}
          {tab === 'audit' && <AuditPage />}
        </div>
      </main>

      <nav className="bottom-nav no-print" aria-label="التنقل السريع">
        <div className="bn-side">
          {bnRight.map((b) => (
            <button key={b.id} className={`bn-item ${tab === b.id ? 'active' : ''}`} onClick={() => { setTab(b.id); setNavOpen(false); }}>
              <span className="bn-ico">{b.ico}</span>
              <span className="bn-lbl">{b.label}</span>
            </button>
          ))}
        </div>
        {canWrite ? (
          <div className="bn-mid">
            <button className="bn-fab" onClick={() => { setTab('invoices'); setNewInvoiceSignal((n) => n + 1); setNavOpen(false); }} aria-label="فاتورة جديدة">
              <span className="bn-fab-ico">+</span>
            </button>
          </div>
        ) : <div className="bn-mid" aria-hidden="true" />}
        <div className="bn-side">
          {bnLeft.map((b) => (
            <button key={b.id} className={`bn-item ${tab === b.id ? 'active' : ''}`} onClick={() => { setTab(b.id); setNavOpen(false); }}>
              <span className="bn-ico">{b.ico}</span>
              <span className="bn-lbl">{b.label}</span>
            </button>
          ))}
          <button className={`bn-item ${navOpen ? 'active' : ''}`} onClick={() => setNavOpen((v) => !v)} aria-label="المزيد" aria-expanded={navOpen}>
            <span className="bn-ico">☰</span>
            <span className="bn-lbl">المزيد</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
