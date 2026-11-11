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
import { MonitoringPage } from './pages/Monitoring';
import { ROLE_LABEL } from './format';
import { useTheme } from './theme';
import { useOfflineSync } from './useOffline';
import { isOfflineEnabled, setOfflineEnabled, reserveBlock, releaseBlock, cacheSettings, pendingCount } from './offline';
import { pendingOps } from './outbox';
import { QuickCenter } from './components/QuickCenter';
import { Guide } from './components/Guide';
import { TopHints } from './components/TopHints';
import { downloadJson } from './exports';

type Tab = 'dashboard' | 'invoices' | 'reports' | 'directory' | 'serial' | 'users' | 'monitor' | 'settings' | 'audit';

const NAV: { id: Tab; label: string; ico: string; roles?: SessionUser['role'][] }[] = [
  { id: 'dashboard', label: 'لوحة التحكم', ico: '▤' },
  { id: 'invoices', label: 'الفواتير', ico: '🧾' },
  { id: 'reports', label: 'التقارير', ico: '📊' },
  { id: 'directory', label: 'الغرف والنزلاء', ico: '🏨' },
  { id: 'serial', label: 'أرقام الفواتير', ico: '#️⃣', roles: ['admin', 'manager'] },
  { id: 'users', label: 'المستخدمون', ico: '👥', roles: ['admin', 'manager'] },
  { id: 'monitor', label: 'مراقبة المستخدمين', ico: '🕵️', roles: ['admin', 'manager'] },
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
  const [guideOpen, setGuideOpen] = useState(false);
  const [backupDay, setBackupDay] = useState<string | null>(null);
  const [dismissedBackup, setDismissedBackup] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();
  const { online, pending, syncing, sync, refreshPending } = useOfflineSync();

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
        await reserveBlock(50);
      } catch { setError('تعذّر تجهيز الوضع الأوفلاين — تأكد من الاتصال مرة واحدة أولًا'); return; }
    } else {
      // Leaving offline mode: hand back unused reserved numbers so the sequence
      // returns to contiguous numbering. Only when nothing is still queued, so a
      // not-yet-synced offline number is never reissued to an online invoice.
      const pending = await pendingCount().catch(() => 1);
      if (pending === 0) { try { await releaseBlock(); } catch { /* ignore */ } }
    }
    setOfflineEnabled(next);
    setOfflineMode(next);
    if (next) sync();
  }, [offlineMode, sync]);

  const onSynced = useCallback(() => { refreshPending(); }, [refreshPending]);

  // Quick center action: download a full JSON backup (admin only, same payload as Settings).
  const downloadBackup = useCallback(async () => {
    try {
      const data = await api.get<unknown>('/api/export');
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJson(`kaoud-backup-${stamp}.json`, data);
    } catch { setError('تعذّر إنشاء النسخة الاحتياطية'); }
  }, []);

  const openNewInvoice = useCallback(() => { setTab('invoices'); setNewInvoiceSignal((n) => n + 1); }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.get<{ user: SessionUser }>('/api/me');
        setUser(me.user);
        await loadSettings();
        try {
          const b = await api.get<{ days: { day: string }[] }>('/api/backups');
          const today = new Date().toISOString().slice(0, 10);
          if (b.days.some((x) => x.day === today)) {
            setBackupDay(today);
            setDismissedBackup(localStorage.getItem(`kaoud.backup.banner.${today}`) === '1');
          }
        } catch { /* banner is optional */ }
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

  // Summon the guide from anywhere with "?" (Shift + /).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      if (e.key === '?') { e.preventDefault(); setGuideOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Show the guide once on a device's first login, then never auto-open again.
  useEffect(() => {
    if (!user) return;
    try {
      if (localStorage.getItem('kaoud.guide.seen') !== '1') {
        setGuideOpen(true);
        localStorage.setItem('kaoud.guide.seen', '1');
      }
    } catch { /* ignore */ }
  }, [user]);

  const onLogin = async (u: SessionUser) => { setUser(u); await loadSettings(); setTab('dashboard'); };
  const onLogout = async () => {
    // Logging out must not strand local writes: block it while anything is
    // queued or while the network is down, so nothing is lost.
    const queued = await pendingOps().catch(() => 0);
    const invoicePending = await pendingCount().catch(() => 0);
    if (queued + invoicePending > 0) {
      if (!online) { setError('لا يمكن تسجيل الخروج الآن — لديك بيانات بانتظار المزامنة وأنت غير متصل بالإنترنت'); return; }
      setError('جارٍ رفع البيانات المتبقية قبل تسجيل الخروج…');
      await sync();
      const left = (await pendingOps().catch(() => 0)) + (await pendingCount().catch(() => 0));
      if (left > 0) { setError('تعذّر رفع كل البيانات — أعد المحاولة قبل تسجيل الخروج'); return; }
    } else if (!online) {
      setError('لا يمكن تسجيل الخروج بدون اتصال بالإنترنت');
      return;
    }
    setError('');
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
            <button
              className={`offline-chip ${online ? 'is-on' : 'is-off'}`}
              onClick={() => sync()}
              disabled={!online || syncing}
              title={online ? (pending ? `${pending} عملية في انتظار المزامنة` : 'متصل — كل شيء متزامن') : 'غير متصل — التغييرات محفوظة محليًا'}
            >
              {online ? '🟢' : '🔴'} {syncing ? 'جارٍ المزامنة…' : pending ? `${pending} بانتظار المزامنة` : 'متزامن'}
            </button>
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
              onClick={() => setGuideOpen(true)}
              title="الدليل السريع (؟)"
              aria-label="فتح الدليل السريع"
              style={{ padding: '7px 10px', fontSize: 16 }}
            >
              ❓
            </button>
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
          {backupDay && !dismissedBackup && (
            <div className="alert warn" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 200 }}>نسخة اليوم ({backupDay}) جاهزة — احفظها على فلاشة أو درايف.</span>
              <button className="btn" onClick={async () => {
                try {
                  const r = await api.get<{ payload: unknown }>(`/api/backups/${backupDay}`);
                  downloadJson(`Kaoud_Backup_${backupDay}.json`, r.payload);
                } catch { setError('تعذّر تحميل النسخة الاحتياطية'); }
              }}>تحميل نسخة احتياطية</button>
              <button className="btn ghost" onClick={() => { setDismissedBackup(true); localStorage.setItem(`kaoud.backup.banner.${backupDay}`, '1'); }}>إخفاء</button>
            </div>
          )}
          <TopHints onOpenGuide={() => setGuideOpen(true)} />
          {tab === 'dashboard' && <Dashboard user={user} onOpenInvoice={(id) => { setPrintId(id); }} onNewInvoice={() => { setTab('invoices'); setNewInvoiceSignal((n) => n + 1); }} />}
          {tab === 'invoices' && <Invoices user={user} settings={settings} onPrint={(id) => setPrintId(id)} openNewSignal={newInvoiceSignal} offline={offlineMode} online={online} onQueued={onSynced} />}
          {tab === 'reports' && <ReportsPage />}
          {tab === 'directory' && <DirectoryPage user={user} />}
          {tab === 'serial' && <SerialPage user={user} />}
          {tab === 'users' && <UsersPage user={user} />}
          {tab === 'monitor' && <MonitoringPage />}
          {tab === 'settings' && <SettingsPage user={user} onSaved={loadSettings} />}
          {tab === 'audit' && <AuditPage />}
        </div>
      </main>

        <QuickCenter
          user={user}
          activeTab={tab}
          online={online}
          pending={pending}
          syncing={syncing}
          shortcuts={nav.map((n) => ({ id: n.id, label: n.label, ico: n.ico }))}
          onNavigate={(id) => setTab(id as Tab)}
          onNewInvoice={openNewInvoice}
          onSync={() => sync()}
          onBackup={downloadBackup}
          onTodayReport={() => setTab('dashboard')}
          onToggleTheme={toggleTheme}
          onOpenGuide={() => setGuideOpen(true)}
          onLogout={onLogout}
        />

        <Guide open={guideOpen} onClose={() => setGuideOpen(false)} user={user} />

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
