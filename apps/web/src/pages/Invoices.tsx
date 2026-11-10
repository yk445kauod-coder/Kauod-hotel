import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../api';
import type { SessionUser, Settings, InvoiceSummary, InvoiceFull, InvoiceLine } from '../types';
import { egp, d, dt, STATUS_LABEL, ETA_LABEL, PAY_LABEL, today, addDays, nightsBetween } from '../format';
import { calcInvoice } from '@kaoud/core';

interface DraftLine { description: string; qty: number; unitPrice: string; kind: string; }

const KIND_LABEL: Record<string, string> = { room: 'إقامة', restaurant: 'مطعم', minibar: 'ميني بار', laundry: 'مغسلة', other: 'أخرى', extra: 'إضافي' };

export function Invoices({ user, settings, onPrint, openNewSignal = 0 }: { user: SessionUser; settings: Settings | null; onPrint: (id: string) => void; openNewSignal?: number }) {
  const canWrite = ['admin', 'manager', 'reception'].includes(user.role);
  const [list, setList] = useState<InvoiceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<null | { id?: string; draft: DraftState }>(null);

  const load = useCallback(async () => {
    setErr('');
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      const r = await api.get<{ invoices: InvoiceSummary[]; total: number }>(`/api/invoices?${params}`);
      setList(r.invoices); setTotal(r.total);
    } catch { setErr('تعذّر تحميل الفواتير'); }
  }, [q, status, offset]);

  useEffect(() => { load(); }, [load]);

  // Open the "new invoice" editor when the shell bumps the signal (FAB / hero button).
  useEffect(() => {
    if (openNewSignal > 0 && canWrite) setEditing({ draft: blankDraft(settings) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewSignal]);

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <input placeholder="بحث برقم الفاتورة أو النزيل أو الغرفة" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, minWidth: 260 }} />
            <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8 }}>
              <option value="">كل الحالات</option>
              <option value="open">مفتوحة</option>
              <option value="locked">مقفلة</option>
              <option value="cancelled">ملغاة</option>
            </select>
          </div>
          {canWrite && <button className="btn primary" onClick={() => setEditing({ draft: blankDraft(settings) })}>+ فاتورة جديدة</button>}
        </div>
      </div>

      {err && <div className="alert err">{err}</div>}

      <div className="card">
        <table data-mobile="cards">
          <thead>
            <tr>
              <th>رقم</th><th>النزيل</th><th>الغرفة</th><th>الدخول</th><th>الخروج</th>
              <th className="num">صافي</th><th className="num">ضريبة</th><th className="num">الإجمالي</th>
              <th>الحالة</th><th>الضرائب</th><th></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={11} className="muted">لا نتائج</td></tr>}
            {list.map((inv) => (
              <tr key={inv.id}>
                <td className="mono" data-label="رقم">{inv.serial}</td>
                <td data-label="النزيل">{inv.guest_name}</td>
                <td className="mono" data-label="الغرفة">{inv.room_number || '—'}</td>
                <td data-label="الدخول">{d(inv.check_in)}</td>
                <td data-label="الخروج">{d(inv.check_out)}</td>
                <td className="num" data-label="صافي">{egp(inv.subtotal_net)}</td>
                <td className="num" data-label="ضريبة">{egp(inv.tax_total)}</td>
                <td className="num" data-label="الإجمالي"><strong>{egp(inv.total)}</strong></td>
                <td data-label="الحالة"><span className={`badge ${inv.status}`}>{STATUS_LABEL[inv.status]}</span></td>
                <td data-label="الضرائب"><span className="badge eta">{ETA_LABEL[inv.eta_status] ?? inv.eta_status}</span></td>
                <td data-label="">
                  <div className="row" style={{ gap: 6 }}>
                    {inv.status !== 'cancelled' && <button className="btn ghost" onClick={() => onPrint(inv.id)}>طباعة</button>}
                    {canWrite && inv.status === 'open' && <button className="btn ghost" onClick={() => openEdit(inv.id, setEditing)}>تعديل</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <span className="muted">{total} فاتورة</span>
          <div className="row">
            <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>السابق</button>
            <span className="muted">صفحة {Math.floor(offset / limit) + 1}</span>
            <button className="btn" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>التالي</button>
          </div>
        </div>
      </div>

      {editing && (
        <InvoiceEditor
          user={user}
          settings={settings}
          id={editing.id}
          initial={editing.draft}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </>
  );
}

interface DraftState {
  guestName: string; roomNumber: string; checkIn: string; checkOut: string;
  receiverTaxId: string; notes: string; applyDiscount: boolean; lines: DraftLine[];
  vatRate: string; discountRate: string; issuerName: string; issuerTaxId: string; issuerAddress: string;
}

function blankDraft(settings: Settings | null): DraftState {
  const t = today();
  return {
    guestName: '', roomNumber: '', checkIn: t, checkOut: addDays(t, 1), receiverTaxId: '', notes: '',
    applyDiscount: (settings?.discount_rate ?? 0) > 0,
    lines: [{ description: '', qty: 1, unitPrice: '', kind: 'room' }],
    vatRate: '', discountRate: '', issuerName: '', issuerTaxId: '', issuerAddress: '',
  };
}

async function openEdit(id: string, setEditing: (v: { id: string; draft: DraftState }) => void) {
  const r = await api.get<{ invoice: InvoiceFull; lines: InvoiceLine[] }>(`/api/invoices/${id}`);
  const iv = r.invoice;
  const opt = (v: number | null) => (v === null || v === undefined ? '' : String(v));
  setEditing({
    id,
    draft: {
      guestName: iv.guest_name, roomNumber: iv.room_number,
      checkIn: iv.check_in ?? today(), checkOut: iv.check_out ?? today(),
      receiverTaxId: iv.receiver_tax_id, notes: iv.notes,
      applyDiscount: Number(iv.discount) > 0,
      lines: r.lines.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unit_price, kind: l.kind })),
      vatRate: opt(iv.vat_rate), discountRate: opt(iv.discount_rate),
      issuerName: iv.issuer_name ?? '', issuerTaxId: iv.issuer_tax_id ?? '', issuerAddress: iv.issuer_address ?? '',
    },
  });
}

function InvoiceEditor({ user, settings, id, initial, onClose, onSaved }: {
  user: SessionUser; settings: Settings | null; id?: string; initial: DraftState;
  onClose: () => void; onSaved: () => void;
}) {
  const [draft, setDraft] = useState<DraftState>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [nextSerial, setNextSerial] = useState<number | null>(null);
  const [showTax, setShowTax] = useState(false);

  useEffect(() => {
    if (id) return;
    api.get<{ nextSerial: number }>('/api/invoices/next-serial').then((r) => setNextSerial(r.nextSerial)).catch(() => {});
  }, [id]);

  const optNum = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v));
  const taxCfg = {
    vatRate: optNum(draft.vatRate) ?? settings?.vat_rate ?? 14,
    discountRate: optNum(draft.discountRate) ?? settings?.discount_rate ?? 3,
    pricesIncludeTax: (settings?.prices_include_tax ?? 1) === 1,
  };
  const hasOverrides = draft.vatRate.trim() !== '' || draft.discountRate.trim() !== ''
    || draft.issuerName.trim() !== '' || draft.issuerTaxId.trim() !== '' || draft.issuerAddress.trim() !== '';
  const calc = calcInvoice({
    guestName: draft.guestName || '—',
    checkIn: draft.checkIn, checkOut: draft.checkOut, applyDiscount: draft.applyDiscount,
    lines: draft.lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice || '0', kind: l.kind as 'extra' })),
  }, taxCfg);

  function setLine(i: number, patch: Partial<DraftLine>) {
    setDraft((dd) => ({ ...dd, lines: dd.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  }

  async function save() {
    setErr(''); setBusy(true);
    try {
      const body = {
        guestName: draft.guestName.trim(),
        roomNumber: draft.roomNumber.trim(),
        checkIn: draft.checkIn || undefined,
        checkOut: draft.checkOut || undefined,
        receiverTaxId: draft.receiverTaxId.trim() || undefined,
        notes: draft.notes.trim() || undefined,
        applyDiscount: draft.applyDiscount,
        vatRate: optNum(draft.vatRate) ?? null,
        discountRate: optNum(draft.discountRate) ?? null,
        issuerName: draft.issuerName.trim() || null,
        issuerTaxId: draft.issuerTaxId.trim() || null,
        issuerAddress: draft.issuerAddress.trim() || null,
        lines: draft.lines.filter((l) => l.description.trim()).map((l) => ({
          description: l.description.trim(), qty: Number(l.qty) || 1, unitPrice: l.unitPrice || '0', kind: l.kind,
        })),
      };
      if (id) await api.put(`/api/invoices/${id}`, body);
      else await api.post('/api/invoices', body);
      onSaved();
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.code === 'bad_request' ? 'تحقق من صحة البيانات (الوصف والمبلغ مطلوبان)' : `تعذّر الحفظ (${ae.code})`);
    } finally { setBusy(false); }
  }

  async function action(path: string, label: string) {
    if (!id) return;
    setErr(''); setBusy(true);
    try { await api.post(`/api/invoices/${id}/${path}`, {}); onSaved(); }
    catch (e) { setErr(`تعذّر ${label} (${(e as ApiError).code})`); }
    finally { setBusy(false); }
  }

  const nights = nightsBetween(draft.checkIn, draft.checkOut);

  return (
    <div className="card" style={{ borderColor: 'var(--brand)' }}>
      <div className="spread">
        <h3>{id ? 'تعديل فاتورة' : `فاتورة جديدة ${nextSerial ? `— رقم ${nextSerial}` : ''}`}</h3>
        <button className="btn ghost" onClick={onClose}>إغلاق</button>
      </div>
      {err && <div className="alert err">{err}</div>}

      <div className="grid cols-3">
        <label className="field">اسم النزيل<input value={draft.guestName} onChange={(e) => setDraft({ ...draft, guestName: e.target.value })} required /></label>
        <label className="field">رقم الغرفة<input value={draft.roomNumber} onChange={(e) => setDraft({ ...draft, roomNumber: e.target.value })} /></label>
        <label className="field">الرقم الضريبي للنزيل (اختياري)<input dir="ltr" value={draft.receiverTaxId} onChange={(e) => setDraft({ ...draft, receiverTaxId: e.target.value })} /></label>
        <label className="field">تاريخ الدخول<input type="date" value={draft.checkIn} onChange={(e) => setDraft({ ...draft, checkIn: e.target.value })} /></label>
        <label className="field">تاريخ الخروج<input type="date" value={draft.checkOut} onChange={(e) => setDraft({ ...draft, checkOut: e.target.value })} /></label>
        <label className="field">عدد الليالي<input value={nights} readOnly dir="ltr" /></label>
      </div>

      <div style={{ marginTop: 14 }}>
        <button className="btn ghost" onClick={() => setShowTax((v) => !v)}>
          {showTax ? '▾' : '▸'} بيانات الضريبة والإصدار {hasOverrides ? '(مخصّصة لهذه الفاتورة)' : '(من الإعدادات)'}
        </button>
        {showTax && (
          <div className="card" style={{ marginTop: 8, background: 'var(--surface-2)' }}>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
              اترك الحقل فارغًا لاستخدام الإعدادات العامة. املأه لتخصيص هذه الفاتورة فقط. لا يمكن تعديلها بعد قفل الفاتورة.
            </div>
            <div className="grid cols-3">
              <label className="field">نسبة الضريبة %<input type="number" min="0" max="100" step="0.01" dir="ltr" value={draft.vatRate} placeholder={`${settings?.vat_rate ?? 14}`} onChange={(e) => setDraft({ ...draft, vatRate: e.target.value })} /></label>
              <label className="field">نسبة الخصم %<input type="number" min="0" max="100" step="0.01" dir="ltr" value={draft.discountRate} placeholder={`${settings?.discount_rate ?? 3}`} onChange={(e) => setDraft({ ...draft, discountRate: e.target.value })} /></label>
              <label className="field">اسم المُصدر<input value={draft.issuerName} placeholder={settings?.hotel_name ?? ''} onChange={(e) => setDraft({ ...draft, issuerName: e.target.value })} /></label>
              <label className="field">الرقم الضريبي للمُصدر<input dir="ltr" value={draft.issuerTaxId} placeholder={settings?.tax_registration_number ?? ''} onChange={(e) => setDraft({ ...draft, issuerTaxId: e.target.value })} /></label>
              <label className="field">عنوان المُصدر<input value={draft.issuerAddress} placeholder={settings?.address ?? ''} onChange={(e) => setDraft({ ...draft, issuerAddress: e.target.value })} /></label>
            </div>
          </div>
        )}
      </div>

      <h4 style={{ marginTop: 18 }}>بنود الفاتورة</h4>
      <table>
        <thead><tr><th>الوصف</th><th>النوع</th><th className="num">الكمية</th><th className="num">سعر الوحدة</th><th className="num">الإجمالي</th><th></th></tr></thead>
        <tbody>
          {draft.lines.map((l, i) => (
            <tr key={i}>
              <td><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="مثال: إقامة غرفة" style={{ width: '100%', padding: 7, border: '1px solid var(--border)', borderRadius: 6 }} /></td>
              <td>
                <select value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value })} style={{ padding: 7, border: '1px solid var(--border)', borderRadius: 6 }}>
                  {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
              <td className="num"><input type="number" min="0" step="1" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} style={{ width: 80, padding: 7, border: '1px solid var(--border)', borderRadius: 6 }} dir="ltr" /></td>
              <td className="num"><input type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} style={{ width: 110, padding: 7, border: '1px solid var(--border)', borderRadius: 6 }} dir="ltr" /></td>
              <td className="num">{egp((Number(l.qty) || 0) * (Number(l.unitPrice) || 0))}</td>
              <td>{draft.lines.length > 1 && <button className="btn ghost" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}>✕</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn" style={{ marginTop: 10 }} onClick={() => setDraft({ ...draft, lines: [...draft.lines, { description: '', qty: 1, unitPrice: '', kind: 'extra' }] })}>+ إضافة بند</button>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 16, alignItems: 'flex-start' }}>
        <div>
          <label className="row" style={{ fontSize: 14, gap: 8 }}>
            <input type="checkbox" checked={draft.applyDiscount} onChange={(e) => setDraft({ ...draft, applyDiscount: e.target.checked })} />
            تطبيق خصم {taxCfg.discountRate}%
          </label>
          <label className="field" style={{ marginTop: 10, maxWidth: 360 }}>ملاحظات<textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
        </div>
        <div className="totals">
          <div><span>الإجمالي قبل الضريبة</span><span className="mono">{egp(calc.subtotalGross)}</span></div>
          <div><span>الصافي</span><span className="mono">{egp(calc.subtotalNet)}</span></div>
          <div><span>الخصم</span><span className="mono">{egp(calc.discount)}</span></div>
          <div><span>ضريبة القيمة المضافة {taxCfg.vatRate}%</span><span className="mono">{egp(calc.taxTotal)}</span></div>
          <div className="grand"><span>الإجمالي المستحق</span><span className="mono">{egp(calc.total)}</span></div>
        </div>
      </div>

      <div className="row end" style={{ marginTop: 16 }}>
        <button className="btn" onClick={onClose}>إلغاء</button>
        {id && user.role !== 'reception' && <button className="btn" disabled={busy} onClick={() => action('lock', 'القفل')}>قفل الفاتورة</button>}
        {id && user.role !== 'reception' && <button className="btn danger" disabled={busy} onClick={() => action('cancel', 'الإلغاء')}>إلغاء الفاتورة</button>}
        <button className="btn primary" disabled={busy || !draft.guestName.trim()} onClick={save}>{id ? 'حفظ التعديلات' : 'إنشاء الفاتورة'}</button>
      </div>
      {id && <div className="muted" style={{ marginTop: 8 }}>ملاحظة: يجب قفل الفاتورة قبل الطباعة أو الإرسال للضرائب.</div>}
    </div>
  );
}
