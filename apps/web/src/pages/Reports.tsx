import { useEffect, useState } from 'react';
import { api } from '../api';
import { egp, today, addDays } from '../format';

interface RevRow { bucket: string; invoices: number; total: string; tax: string; }
interface VatReport { period: { from: string; to: string }; invoiceCount: number; netSales: string; vatCollected: string; grossSales: string; discounts: string; }

export function ReportsPage() {
  const [from, setFrom] = useState(addDays(today(), -30));
  const [to, setTo] = useState(today());
  const [group, setGroup] = useState<'day' | 'month'>('day');
  const [rows, setRows] = useState<RevRow[]>([]);
  const [vat, setVat] = useState<VatReport | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      setErr('');
      try {
        const [r, v] = await Promise.all([
          api.get<{ rows: RevRow[] }>(`/api/reports/revenue?group=${group}&from=${from}&to=${to}`),
          api.get<VatReport>(`/api/reports/vat?from=${from}&to=${to}`),
        ]);
        setRows(r.rows); setVat(v);
      } catch { setErr('تعذّر تحميل التقارير'); }
    })();
  }, [from, to, group]);

  function exportCsv() {
    const header = 'الفترة,عدد الفواتير,الإجمالي,الضريبة';
    const lines = rows.map((r) => `${r.bucket},${r.invoices},${r.total},${r.tax}`);
    const blob = new Blob(['\ufeff' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `report-${from}-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
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
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>تصدير CSV</button>
        </div>
      </div>

      {err && <div className="alert err">{err}</div>}

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
    </>
  );
}
