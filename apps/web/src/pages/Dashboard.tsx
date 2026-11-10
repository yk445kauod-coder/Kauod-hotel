import { useEffect, useState } from 'react';
import { api } from '../api';
import type { SessionUser, InvoiceSummary } from '../types';
import { egp, d, STATUS_LABEL } from '../format';

interface Summary {
  count: number; valid: number; cancelled: number; lastSerial: number | null;
  total: string; tax: string; discount: string; net: string; paid: string; outstanding: string;
}

export function Dashboard({ user, onOpenInvoice }: { user: SessionUser; onOpenInvoice: (id: string) => void }) {
  const [sum, setSum] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<InvoiceSummary[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [s, list] = await Promise.all([
          api.get<Summary>('/api/reports/summary'),
          api.get<{ invoices: InvoiceSummary[] }>('/api/invoices?limit=8'),
        ]);
        setSum(s); setRecent(list.invoices);
      } catch { setErr('تعذّر تحميل البيانات'); }
    })();
  }, []);

  if (err) return <div className="alert err">{err}</div>;
  if (!sum) return <div className="muted">جارٍ التحميل…</div>;

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="k">إجمالي الفواتير</div><div className="v">{sum.count}</div></div>
        <div className="stat"><div className="k">إجمالي المبيعات</div><div className="v">{egp(sum.total)}</div></div>
        <div className="stat"><div className="k">ضريبة القيمة المضافة</div><div className="v">{egp(sum.tax)}</div></div>
        <div className="stat"><div className="k">آخر رقم فاتورة</div><div className="v">{sum.lastSerial ?? '—'}</div></div>
        <div className="stat"><div className="k">المحصّل</div><div className="v">{egp(sum.paid)}</div></div>
        <div className="stat"><div className="k">المتبقي</div><div className="v">{egp(sum.outstanding)}</div></div>
        <div className="stat"><div className="k">صافي المبيعات</div><div className="v">{egp(sum.net)}</div></div>
        <div className="stat"><div className="k">فواتير ملغاة</div><div className="v">{sum.cancelled}</div></div>
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
