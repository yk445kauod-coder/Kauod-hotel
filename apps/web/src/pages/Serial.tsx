import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../api';
import type { SessionUser } from '../types';

interface SerialInfo { serialStart: number; nextSerial: number; nextOverride: number | null; }
interface AuditRow { serial: number; state: string; }

const STATE_LABEL: Record<string, string> = { present: 'موجود', missing: 'ناقص', duplicate: 'مكرر' };
const STATE_BADGE: Record<string, string> = { present: 'locked', missing: 'cancelled', duplicate: 'open' };

export function SerialPage({ user }: { user: SessionUser }) {
  const [info, setInfo] = useState<SerialInfo | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [override, setOverride] = useState('');
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const isAdmin = user.role === 'admin';

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        api.get<SerialInfo>('/api/serial'),
        api.get<{ entries: AuditRow[] }>('/api/serial/audit'),
      ]);
      setInfo(s); setAudit(a.entries);
    } catch { setErr('تعذّر التحميل'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function applyOverride() {
    setErr(''); setMsg('');
    const v = override.trim() === '' ? null : Number(override);
    if (v !== null && (!Number.isInteger(v) || v <= 0)) { setErr('رقم غير صحيح'); return; }
    try { const r = await api.put<SerialInfo>('/api/serial', { nextOverride: v }); setInfo(r); setMsg(v === null ? 'تم إلغاء التخصيص' : `سيُستخدم الرقم ${v} للفاتورة القادمة`); await load(); }
    catch (e) { const ae = e as ApiError; setErr(ae.code === 'serial_below_max' ? 'الرقم أقل من أو يساوي آخر رقم مستخدم' : `تعذّر التحديث (${ae.code})`); }
  }

  const problems = audit.filter((a) => a.state !== 'present');

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="k">رقم بداية السلسلة</div><div className="v">{info?.serialStart ?? '—'}</div></div>
        <div className="stat"><div className="k">الرقم التالي</div><div className="v">{info?.nextSerial ?? '—'}</div></div>
        <div className="stat"><div className="k">تخصيص مؤقت</div><div className="v">{info?.nextOverride ?? '—'}</div></div>
      </div>

      {isAdmin && (
        <div className="card">
          <h3>تخصيص الرقم التالي (يُستخدم مرة واحدة)</h3>
          {msg && <div className="alert ok">{msg}</div>}
          {err && <div className="alert err">{err}</div>}
          <div className="row">
            <input dir="ltr" placeholder="مثال: 20000" value={override} onChange={(e) => setOverride(e.target.value)} style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, width: 160 }} />
            <button className="btn primary" onClick={applyOverride}>تطبيق</button>
            <button className="btn" onClick={() => { setOverride(''); }}>مسح الحقل</button>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>لا يمكن اختيار رقم أقل من أو يساوي آخر رقم فاتورة مستخدم، للحفاظ على سلامة السلسلة الضريبية.</div>
        </div>
      )}

      <div className="card">
        <div className="spread"><h3>تدقيق سلسلة الأرقام</h3><span className={`badge ${problems.length ? 'cancelled' : 'locked'}`}>{problems.length ? `${problems.length} مشكلة` : 'السلسلة سليمة'}</span></div>
        {problems.length === 0
          ? <div className="muted">لا توجد أرقام ناقصة أو مكررة.</div>
          : (
            <table>
              <thead><tr><th>الرقم</th><th>الحالة</th></tr></thead>
              <tbody>
                {problems.map((p) => (
                  <tr key={p.serial}><td className="mono">{p.serial}</td><td><span className={`badge ${STATE_BADGE[p.state]}`}>{STATE_LABEL[p.state]}</span></td></tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </>
  );
}
