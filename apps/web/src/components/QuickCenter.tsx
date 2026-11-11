import { useEffect, useRef, useState } from 'react';
import type { SessionUser } from '../types';
import { Icon, type IconName } from './Icon';

export interface QuickShortcut { id: string; label: string; ico: IconName; }

interface Props {
  user: SessionUser;
  shortcuts: QuickShortcut[];
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
  onOpenGuide: () => void;
  onLogout: () => void;
}

interface Macro { key: string; label: string; ico: IconName; run: () => void; adminOnly?: boolean; }

export function QuickCenter({
  user, shortcuts, activeTab, online, pending, syncing,
  onNavigate, onNewInvoice, onSync, onBackup, onTodayReport, onToggleTheme, onOpenGuide, onLogout,
}: Props) {
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Collapse on Escape or a click outside the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  const macros = ([
    { key: 'new', label: 'فاتورة جديدة', ico: 'plus', run: onNewInvoice },
    { key: 'sync', label: syncing ? 'جارٍ المزامنة…' : `مزامنة الآن${pending ? ` (${pending})` : ''}`, ico: 'sync', run: onSync },
    { key: 'backup', label: 'نسخة احتياطية', ico: 'save', run: onBackup, adminOnly: true },
    { key: 'today', label: 'تقرير اليوم', ico: 'invoice', run: onTodayReport },
    { key: 'guide', label: 'الدليل', ico: 'help', run: onOpenGuide },
    { key: 'theme', label: 'تبديل الوضع', ico: 'moon', run: onToggleTheme },
    { key: 'logout', label: 'خروج', ico: 'logout', run: onLogout },
  ] satisfies Macro[]).filter((m) => !m.adminOnly || user.isOwner || user.role === 'admin');

  const time = clock.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  const statusTxt = online ? (pending ? `${pending} بانتظار الرفع` : 'متصل') : 'غير متصل';

  return (
    <div className={`qc no-print ${open ? 'open' : ''}`} ref={ref}>
      <button
        className="qc-pill"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="المركز السريع — اختصارات وإجراءات"
        title="المركز السريع"
      >
        <span className={`qc-dot ${online ? (pending ? 'warn' : 'ok') : 'off'}`} aria-hidden="true" />
        <span className="qc-status">{statusTxt}</span>
        <span className="qc-time">{time}</span>
        <span className={`qc-chev ${open ? 'up' : ''}`} aria-hidden="true"><Icon name="chevronDown" size={15} /></span>
      </button>

      {open && (
        <div className="qc-panel" role="menu">
          <div className="qc-head">
            <span>المركز السريع</span>
            <button className="qc-x" onClick={() => setOpen(false)} aria-label="إغلاق"><Icon name="close" size={18} /></button>
          </div>

          <div className="qc-sec">اختصارات</div>
          <div className="qc-grid">
            {shortcuts.map((s) => (
              <button
                key={s.id}
                className={`qc-item ${activeTab === s.id ? 'active' : ''}`}
                onClick={() => { onNavigate(s.id); setOpen(false); }}
                role="menuitem"
              >
                <span className="qc-item-ico"><Icon name={s.ico} size={20} /></span>
                <span className="qc-item-lbl">{s.label}</span>
              </button>
            ))}
          </div>

          <div className="qc-sec">إجراءات سريعة</div>
          <div className="qc-grid">
            {macros.map((m) => (
              <button key={m.key} className="qc-item macro" onClick={() => { m.run(); setOpen(false); }} role="menuitem">
                <span className="qc-item-ico"><Icon name={m.ico} size={20} /></span>
                <span className="qc-item-lbl">{m.label}</span>
              </button>
            ))}
          </div>

          <div className="qc-foot">
            {user.name} · {online ? 'متصل بالخادم' : 'أوفلاين — التغييرات تُحفظ محليًا'}
          </div>
        </div>
      )}
    </div>
  );
}
