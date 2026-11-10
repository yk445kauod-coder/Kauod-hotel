import { useEffect, useState } from 'react';
import { api } from '../api';
import { exportCsv, exportExcel } from '../exports';
import { egp, egpEn, today, addDays } from '../format';

interface RevRow { bucket: string; invoices: number; total: string; tax: string; }
interface VatReport { period: { from: string; to: string }; invoiceCount: number; netSales: string; vatCollected: string; grossSales: string; discounts: string; }
interface Summary {
  count: number; valid: number; cancelled: number; lastSerial: number | null;
  total: string; tax: string; discount: string; net: string; paid: string; outstanding: string;
}
interface RegRow {
  id: string; serial: number; issuedAt: string; guest: string; room: string; checkIn: string | null; checkOut: string | null;
  status: string; stay: string; restaurant: string; services: string; extra: string;
  subtotal: string; net: string; tax: string; discount: string; total: string;
}
const STATUS_LABEL: Record<string, string> = { draft: 'مسودة', open: 'مفتوحة', locked: 'مقفلة', cancelled: 'ملغاة' };
const stamp = (from: string, to: string) => `${from}_${to}`;

export function ReportsPage() {
  const [from, setFrom] = useState(addDays(today(), -30));
  const [to, setTo] = useState(today());
  const [group, setGroup] = useState<'day' | 'month'>('day');
  const [rows, setRows] = useState<RevRow[]>([]);
  const [vat, setVat] = useState<VatReport | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [reg, setReg] = useState<RegRow[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      setErr('');
      try {
        const [r, v, s, g] = await Promise.all([
          api.get<{ rows: RevRow[] }>(`/api/reports/revenue?group=${group}&from=${from}&to=${to}`),
          api.get<VatReport>(`/api/reports/vat?from=${from}&to=${to}`),
          api.get<Summary>('/api/reports/summary'),
          api.get<{ rows: RegRow[] }>(`/api/reports/register?from=${from}&to=${to}`),
        ]);
        setRows(r.rows); setVat(v); setSum(s); setReg(g.rows);
      } catch { setErr('تعذّر تحميل التقارير'); }
    })();
  }, [from, to, group]);

  function exportRevenueCsv() {
    exportCsv(`revenue-${stamp(from, to)}.csv`, ['الفترة', 'عدد الفواتير', 'الإجمالي', 'الضريبة'],
      rows.map((r) => [r.bucket, r.invoices, r.total, r.tax]));
  }

  function exportRegisterExcel() {
    exportExcel({
      title: `فندق قاعود سبورتنج — سجل الفواتير (${from} إلى ${to})`,
      headers: ['رقم', 'التاريخ', 'النزيل', 'الغرفة', 'الدخول', 'الخروج', 'إقامة', 'مطعم', 'خدمات', 'إضافي', 'قبل الضريبة', 'الصافي', 'ضريبة', 'خصم', 'الإجمالي', 'الحالة'],
      rows: reg.map((r) => [r.serial, r.issuedAt.slice(0, 10), r.guest, r.room, r.checkIn ?? '', r.checkOut ?? '', r.stay, r.restaurant, r.services, r.extra, r.subtotal, r.net, r.tax, r.discount, r.total, STATUS_LABEL[r.status] ?? r.status]),
      filename: `kaoud-register-${stamp(from, to)}.xls`,
    });
  }

  function exportRegisterCsv() {
    exportCsv(`kaoud-register-${stamp(from, to)}.csv`,
      ['serial', 'date', 'guest', 'room', 'stay', 'restaurant', 'services', 'extra', 'subtotal', 'net', 'tax', 'discount', 'total', 'status'],
      reg.map((r) => [r.serial, r.issuedAt.slice(0, 10), r.guest, r.room, r.stay, r.restaurant, r.services, r.extra, r.subtotal, r.net, r.tax, r.discount, r.total, r.status]));
  }

  function exportDashboardExcel() {
    if (!sum) return;
    exportExcel({
      title: 'فندق قاعود سبورتنج — لوحة التحكم',
      headers: ['البيان', 'القيمة'],
      rows: [
        ['إجمالي الفواتير', sum.count], ['سليمة', sum.valid], ['ملغاة', sum.cancelled], ['آخر رقم', sum.lastSerial ?? '—'],
        ['إجمالي المبيعات', sum.total], ['إجمالي الضريبة', sum.tax], ['إجمالي الخصم', sum.discount], ['الصافي', sum.net],
        ['المحصّل', sum.paid], ['المتبقي', sum.outstanding],
      ],
      filename: 'kaoud-dashboard.xls',
    });
  }

  function exportVatExcel() {
    if (!vat) return;
    exportExcel({
      title: `فندق قاعود سبورتنج — إقرار ض.ق.م (${vat.period.from} إلى ${vat.period.to})`,
      headers: ['البيان', 'القيمة'],
      rows: [
        ['عدد الفواتير', vat.invoiceCount], ['صافي المبيعات', vat.netSales], ['إجمالي المبيعات', vat.grossSales],
        ['ض.ق.م المستحقة', vat.vatCollected], ['إجمالي الخصم', vat.discounts],
      ],
      filename: `kaoud-vat-${stamp(from, to)}.xls`,
    });
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div className="row">
            <label className="field">من<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field">إلى<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <label className="field">التجميع
              <select value={group} onChange={(e) => setGroup(e.target.value as 'day' | 'month')}>
                <option value="day">يومي</option>
                <option value="month">شهري</option>
              </select>
            </label>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn" onClick={exportRegisterExcel} disabled={!reg.length}>سجل الفواتير — Excel</button>
          <button className="btn" onClick={exportRegisterCsv} disabled={!reg.length}>سجل الفواتير — CSV</button>
          <button className="btn" onClick={exportRevenueCsv} disabled={!rows.length}>الإيرادات — CSV</button>
          <button className="btn" onClick={exportVatExcel} disabled={!vat}>إقرار ض.ق.م — Excel</button>
          <button className="btn" onClick={exportDashboardExcel} disabled={!sum}>ملخص الداشبورد — Excel</button>
        </div>
      </div>

      {err && <div className="alert err">{err}</div>}

      {sum && (
        <div className="kpi-grid">
          <div className="kpi-card brand"><div className="k">إجمالي المبيعات</div><div className="v">{egp(sum.total)}</div><div className="sub">{sum.valid} فاتورة سليمة</div></div>
          <div className="kpi-card ok"><div className="k">المحصّل</div><div className="v">{egp(sum.paid)}</div><div className="sub">{sum.outstanding === '0.00' ? 'مسدّد بالكامل' : `متبقي ${egp(sum.outstanding)}`}</div></div>
          <div className="kpi-card warn"><div className="k">ض.ق.م</div><div className="v">{egp(sum.tax)}</div><div className="sub">خصم {egp(sum.discount)}</div></div>
          <div className="kpi-card"><div className="k">عدد الفواتير</div><div className="v">{sum.count}</div><div className="sub">آخر رقم {sum.lastSerial ?? '—'}</div></div>
        </div>
      )}

      {vat && (
        <div className="grid cols-4" style={{ marginBottom: 16 }}>
          <div className="stat"><div className="k">عدد الفواتير</div><div className="v">{vat.invoiceCount}</div></div>
          <div className="stat"><div className="k">صافي المبيعات</div><div className="v">{egp(vat.netSales)}</div></div>
          <div className="stat"><div className="k">ض.ق.م المستحقة</div><div className="v">{egp(vat.vatCollected)}</div></div>
          <div className="stat"><div className="k">إجمالي المبيعات</div><div className="v">{egp(vat.grossSales)}</div></div>
        </div>
      )}

      <div className="card">
        <h3>الإيرادات {group === 'day' ? 'اليومية' : 'الشهرية'}</h3>
        <table data-mobile="cards">
          <thead><tr><th>الفترة</th><th className="num">عدد الفواتير</th><th className="num">الإجمالي</th><th className="num">الضريبة</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="muted">لا بيانات في هذه الفترة</td></tr>}
            {rows.map((r) => (
              <tr key={r.bucket}><td className="mono" data-label="الفترة">{r.bucket}</td><td className="num" data-label="عدد الفواتير">{r.invoices}</td><td className="num" data-label="الإجمالي">{egp(r.total)}</td><td className="num" data-label="الضريبة">{egp(r.tax)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="spread"><h3>سجل الفواتير</h3><span className="muted">{reg.length} فاتورة</span></div>
        <table data-mobile="cards">
          <thead><tr><th>رقم</th><th>التاريخ</th><th>النزيل</th><th>الغرفة</th><th className="num">إقامة</th><th className="num">مطعم</th><th className="num">خدمات</th><th className="num">إضافي</th><th className="num">قبل الضريبة</th><th className="num">الصافي</th><th className="num">ضريبة</th><th className="num">خصم</th><th className="num">الإجمالي</th><th>الحالة</th></tr></thead>
          <tbody>
            {reg.length === 0 && <tr><td colSpan={14} className="muted">لا فواتير في هذه الفترة</td></tr>}
            {reg.map((r) => (
              <tr key={r.id}>
                <td className="mono" data-label="رقم">{r.serial}</td>
                <td className="mono" data-label="التاريخ">{r.issuedAt.slice(0, 10)}</td>
                <td data-label="النزيل">{r.guest}</td>
                <td className="mono" data-label="الغرفة">{r.room}</td>
                <td className="num" data-label="إقامة">{egpEn(r.stay)}</td>
                <td className="num" data-label="مطعم">{egpEn(r.restaurant)}</td>
                <td className="num" data-label="خدمات">{egpEn(r.services)}</td>
                <td className="num" data-label="إضافي">{egpEn(r.extra)}</td>
                <td className="num" data-label="قبل الضريبة">{egpEn(r.subtotal)}</td>
                <td className="num" data-label="الصافي">{egpEn(r.net)}</td>
                <td className="num" data-label="ضريبة">{egpEn(r.tax)}</td>
                <td className="num" data-label="خصم">{egpEn(r.discount)}</td>
                <td className="num" data-label="الإجمالي">{egpEn(r.total)}</td>
                <td data-label="الحالة"><span className={`badge ${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
