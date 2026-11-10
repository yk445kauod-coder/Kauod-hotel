import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../api';
import type { EtaQueueItem } from '../types';
import { dt, ETA_LABEL } from '../format';

interface QueueResp { queue: EtaQueueItem[]; configured: boolean; }

export function EtaPage() {
  const [data, setData] = useState<QueueResp | null>(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { setData(await api.get<QueueResp>('/api/eta/queue')); }
    catch { setErr('تعذّر تحميل قائمة الضرائب'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function download(invoiceId: string, serial: number) {
    setErr(''); setMsg('');
    try {
      const doc = await api.get<unknown>(`/api/invoices/${invoiceId}/eta/document.json`);
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `eta-${serial}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(`تعذّر التنزيل (${(e as ApiError).code})`); }
  }

  return (
    <>
      <div className={`card`}>
        <h3>حالة الربط مع مصلحة الضرائب المصرية</h3>
        {data?.configured
          ? <div className="alert ok">تم تهيئة بيانات الاعتماد — الفواتير المقفلة تُدرج في قائمة الإرسال.</div>
          : <div className="alert warn">لم يتم تهيئة بيانات اعتماد مصلحة الضرائب بعد. الفواتير تُحفظ في قائمة محلية ويمكن تنزيل ملف JSON لإرساله يدويًا من بوابة المصلحة. لإتمام الربط، أضف أسرار <span className="mono">ETA_CLIENT_ID</span> و<span className="mono">ETA_CLIENT_SECRET</span> عبر <span className="mono">wrangler secret put</span>.</div>}
        {err && <div className="alert err">{err}</div>}
        {msg && <div className="alert ok">{msg}</div>}
      </div>

      <div className="card">
        <h3>قائمة الإرسال ({data?.queue.length ?? 0})</h3>
        <table data-mobile="cards">
          <thead><tr><th>رقم الفاتورة</th><th>الحالة</th><th>المحاولات</th><th>آخر خطأ</th><th>التاريخ</th><th></th></tr></thead>
          <tbody>
            {(!data || data.queue.length === 0) && <tr><td colSpan={6} className="muted">لا توجد فواتير في القائمة</td></tr>}
            {data?.queue.map((q) => (
              <tr key={q.id}>
                <td className="mono" data-label="رقم الفاتورة">{q.serial}</td>
                <td data-label="الحالة"><span className="badge eta">{ETA_LABEL[q.status] ?? q.status}</span></td>
                <td className="num" data-label="المحاولات">{q.attempts}</td>
                <td className="muted" data-label="آخر خطأ">{q.last_error ?? '—'}</td>
                <td data-label="التاريخ">{dt(q.created_at)}</td>
                <td data-label=""><button className="btn ghost" onClick={() => download(q.invoice_id, q.serial)}>تنزيل JSON</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
