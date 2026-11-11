import { useEffect, useState, lazy, Suspense } from 'react';
import { Icon } from '../components/Icon';
import { api } from '../api';
import type { SessionUser, InvoiceSummary } from '../types';
import { egp, d, STATUS_LABEL, PAY_LABEL, today } from '../format';
import { downloadJson } from '../exports';
const DashboardCharts = lazy(() => import('../components/DashboardCharts').then((m) => ({ default: m.DashboardCharts })));

interface Summary {
  count: number; valid: number; cancelled: number; lastSerial: number | null;
  total: string; tax: string; discount: string; net: string; paid: string; outstanding: string;
}
interface DashData {
  trend: { day: string; total: string; count: number }[];
  topRooms: { room: string; total: string; count: number }[];
}
interface DailyReport {
  date: string; count: number; total: string;
  byMethod: { method: string; count: number; total: string }[];
}

export function Dashboard({ user, onOpenInvoice, onNewInvoice }: {
  user: SessionUser;
  onOpenInvoice: (id: string) => void;
  onNewInvoice?: () => void;
}) {
  const [sum, setSum] = useState<Summary | null>(null);
  const [dash, setDash] = useState<DashData | null>(null);
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [recent, setRecent] = useState<InvoiceSummary[]>([]);
  const [err, setErr] = useState('');
  const [backupMsg, setBackupMsg] = useState('');
  const canSeeReports = ['admin', 'manager', 'accountant'].includes(user.role);
  const isAdmin = user.isOwner || user.role === 'admin';

  useEffect(() => {
    (async () => {
      try {
        const [s, list] = await Promise.all([
          api.get<Summary>('/api/reports/summary'),
          api.get<{ invoices: InvoiceSummary[] }>('/api/invoices?limit=8'),
        ]);
        setSum(s); setRecent(list.invoices);
      } catch { setErr('تعذّر تحميل البيانات'); }
      try { setDaily(await api.get<DailyReport>('/api/reports/daily')); }
      catch { /* daily report is optional */ }
      if (canSeeReports) {
        try { setDash(await api.get<DashData>('/api/reports/dashboard')); }
        catch { /* charts are optional */ }
      }
    })();
  }, [canSeeReports]);

  async function backup() {
    setBackupMsg('');
    try {
      const data = await api.get<unknown>('/api/export');
      downloadJson(`kaoud-backup-${today()}.json`, data);
      setBackupMsg('تم تنزيل النسخة الاحتياطية — احفظها على فلاشة أو جوجل درايف');
    } catch { setBackupMsg('تعذّر إنشاء النسخة الاحتياطية'); }
  }

  if (err) return <div className="alert err">{err}</div>;
  if (!sum) return <div className="muted">جارٍ التحميل…</div>;

  const pct = Number(sum.total) > 0 ? Math.round((Number(sum.paid) / Number(sum.total)) * 100) : 0;

  return (
    <>
      <div className="dash-hero">
        <div>
          <div className="hero-hello">أهلاً {user.name}</div>
          <div className="hero-sub">
            {sum.count === 0 ? 'ابدأ بإصدار أول فاتورة اليوم.' : `لديك ${sum.count} فاتورة، منها ${sum.valid} سليمة و${sum.cancelled} ملغاة.`}
          </div>
        </div>
        {onNewInvoice && ['admin', 'manager', 'reception'].includes(user.role) && (
          <button className="btn primary" onClick={onNewInvoice}><Icon name="plus" size={16} /> فاتورة جديدة</button>
        )}
      </div>

      <div className="kpi-grid">
        <div className="kpi-card brand">
          <div className="k">إجمالي المبيعات</div>
          <div className="v">{egp(sum.total)}</div>
          <div className="sub">ض.ق.م {egp(sum.tax)}</div>
        </div>
        <div className="kpi-card ok">
          <div className="k">المحصّل</div>
          <div className="v">{egp(sum.paid)}</div>
          <div className="sub">{pct}% من الإجمالي</div>
        </div>
        <div className="kpi-card warn">
          <div className="k">المتبقي</div>
          <div className="v">{egp(sum.outstanding)}</div>
          <div className="sub">غير مسدّد</div>
        </div>
        <div className="kpi-card">
          <div className="k">عدد الفواتير</div>
          <div className="v">{sum.count}</div>
          <div className="sub">آخر رقم {sum.lastSerial ?? '—'}</div>
        </div>
      </div>

      {canSeeReports && dash && (
        <Suspense fallback={<div className="dash-charts"><div className="card chart-wide"><div className="muted" style={{ padding: '48px 0', textAlign: 'center' }}>جارٍ تحميل الرسوم…</div></div></div>}>
          <DashboardCharts paid={sum.paid} outstanding={sum.outstanding} trend={dash.trend} topRooms={dash.topRooms} />
        </Suspense>
      )}

      {isAdmin && (
        <div className="alert warn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span><Icon name="save" size={15} style={{ verticalAlign: '-2px' }} /> خُد نسخة احتياطية من بيانات الفندق النهاردة عشان تحفظها على فلاشة أو جوجل درايف.</span>
          <button className="btn" onClick={backup}>تحميل نسخة احتياطية</button>
        </div>
      )}
      {backupMsg && <div className="alert ok">{backupMsg}</div>}

      <div className="card">
        <div className="spread">
          <h3>تقرير اليوم — الخزنة</h3>
          <span className="muted">{d(daily?.date ?? today())}</span>
        </div>
        <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>تقرير اليوم فقط، من الفواتير السليمة. الملغاة خارج الحساب.</p>
        <div className="kpi-grid">
          <div className="kpi-card ok"><div className="k">فواتير اليوم</div><div className="v">{daily?.count ?? 0}</div></div>
          <div className="kpi-card brand"><div className="k">إجمالي اليوم</div><div className="v">{egp(daily?.total ?? '0')}</div></div>
        </div>
        {daily && daily.byMethod.length > 0 && (
          <table data-mobile="cards" style={{ marginTop: 12 }}>
            <thead><tr><th>طريقة الدفع</th><th className="num">عدد</th><th className="num">الإجمالي</th></tr></thead>
            <tbody>
              {daily.byMethod.map((m) => (
                <tr key={m.method}>
                  <td data-label="طريقة الدفع">{PAY_LABEL[m.method] ?? m.method}</td>
                  <td className="num" data-label="عدد">{m.count}</td>
                  <td className="num" data-label="الإجمالي">{egp(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="spread"><h3>أحدث الفواتير</h3><span className="muted">مرحبًا {user.name}</span></div>
        <table data-mobile="cards">
          <thead>
            <tr><th>رقم</th><th>النزيل</th><th>الغرفة</th><th>التاريخ</th><th className="num">الإجمالي</th><th>الحالة</th><th></th></tr>
          </thead>
          <tbody>
            {recent.length === 0 && <tr><td colSpan={7} className="muted">لا توجد فواتير بعد</td></tr>}
            {recent.map((inv) => (
              <tr key={inv.id}>
                <td className="mono" data-label="رقم">{inv.serial}</td>
                <td data-label="النزيل">{inv.guest_name}</td>
                <td className="mono" data-label="الغرفة">{inv.room_number || '—'}</td>
                <td data-label="التاريخ">{d(inv.issued_at)}</td>
                <td className="num" data-label="الإجمالي">{egp(inv.total)}</td>
                <td data-label="الحالة"><span className={`badge ${inv.status}`}>{STATUS_LABEL[inv.status]}</span></td>
                <td data-label=""><button className="btn ghost" onClick={() => onOpenInvoice(inv.id)}>عرض</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
