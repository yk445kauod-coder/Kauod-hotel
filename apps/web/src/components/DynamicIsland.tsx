import { useEffect, useRef, useState } from 'react';
import type { SessionUser } from '../types';

export interface IslandShortcut { id: string; label: string; ico: string; }

interface Props {
  user: SessionUser;
  shortcuts: IslandShortcut[];
  activeTab: string;
  online: boolean;
  pending: number;
  syncing: boolean;
  onNavigate: (id: string) => void;
  onNewInvoice: () => void;
  onSync: () => void;
  onBackup: () => void;
  onTodayReport: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
}

interface Macro { key: string; label: string; ico: string; run: () => void; adminOnly?: boolean; }

export function DynamicIsland({
  user, shortcuts, activeTab, online, pending, syncing,
  onNavigate, onNewInvoice, onSync, onBackup, onTodayReport, onToggleTheme, onLogout,
}: Props) {
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Collapse on Escape or a click outside the island.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  const macros: Macro[] = [
    { key: 'new', label: 'فاتورة جديدة', ico: '➕', run: onNewInvoice },
    { key: 'sync', label: syncing ? 'جارٍ المزامنة…' : `مزامنة الآن${pending ? ` (${pending})` : ''}`, ico: '🔄', run: onSync },
    { key: 'backup', label: 'نسخة احتياطية', ico: '💾', run: onBackup, adminOnly: true },
    { key: 'today', label: 'تقرير اليوم', ico: '🧾', run: onTodayReport },
    { key: 'theme', label: 'تبديل الوضع', ico: '🌗', run: onToggleTheme },
    { key: 'logout', label: 'خروج', ico: '⎋', run: onLogout },
  ].filter((m) => !m.adminOnly || user.isOwner || user.role === 'admin');

  const time = clock.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  const statusIco = online ? (pending ? '🟡' : '🟢') : '🔴';
  const statusTxt = online ? (pending ? `${pending} بانتظار الرفع` : 'متصل') : 'غير متصل';

  return (
    <div className={`island no-print ${open ? 'open' : ''}`} ref={ref}>
      <button
        className="island-pill"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="الجزيرة الديناميكية — اختصارات وإجراءات"
        title="الجزيرة الديناميكية"
      >
        <span className="island-brand">🏝️</span>
        <span className={`island-dot ${online ? (pending ? 'warn' : 'ok') : 'off'}`} aria-hidden="true" />
        <span className="island-status">{statusTxt}</span>
        <span className="island-time">{time}</span>
        <span className={`island-chev ${open ? 'up' : ''}`} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="island-panel" role="menu">
          <div className="island-head">
            <span>الجزيرة الديناميكية</span>
            <button className="island-x" onClick={() => setOpen(false)} aria-label="إغلاق">✕</button>
          </div>

          <div className="island-sec">اختصارات</div>
          <div className="island-grid">
            {shortcuts.map((s) => (
              <button
                key={s.id}
                className={`island-item ${activeTab === s.id ? 'active' : ''}`}
                onClick={() => { onNavigate(s.id); setOpen(false); }}
                role="menuitem"
              >
                <span className="island-item-ico">{s.ico}</span>
                <span className="island-item-lbl">{s.label}</span>
              </button>
            ))}
          </div>

          <div className="island-sec">إجراءات سريعة</div>
          <div className="island-grid">
            {macros.map((m) => (
              <button key={m.key} className="island-item macro" onClick={() => { m.run(); setOpen(false); }} role="menuitem">
                <span className="island-item-ico">{m.ico}</span>
                <span className="island-item-lbl">{m.label}</span>
              </button>
            ))}
          </div>

          <div className="island-foot">
            {user.name} · {online ? 'متصل بالخادم' : 'أوفلاين — الفواتير تُحفظ محليًا'}
          </div>
        </div>
      )}
    </div>
  );
}
