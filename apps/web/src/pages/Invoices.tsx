import { useEffect, useRef, useState, useCallback } from 'react';
import { api, ApiError } from '../api';
import { exportExcel, openPrintWindow } from '../exports';
import { queueInvoice, listQueue, removeQueued, syncNow, type QueuedInvoice } from '../offline';
import { Icon } from '../components/Icon';
import { cacheGet, cacheSet } from '../cache';
import type { SessionUser, Settings, InvoiceSummary, InvoiceFull, InvoiceLine } from '../types';
import { egp, egpEn, d, dt, STATUS_LABEL, ETA_LABEL, PAY_LABEL, today, addDays, nightsBetween } from '../format';
import { calcInvoice, LINE_KINDS, type LineKind } from '@kaoud/core';

interface DraftLine { description: string; qty: number; unitPrice: string; kind: string; }

// Labels for the canonical line kinds. The keys must match LINE_KINDS exactly —
// the server rejects any other value, and an offline invoice carrying one would
// sit in the queue forever.
const KIND_LABEL: Record<string, string> = { room: 'إقامة', restaurant: 'مطعم', minibar: 'ميني بار', laundry: 'مغسلة', extra: 'إضافي' };

export function Invoices({ user, settings, onPrint, openNewSignal = 0, offline = false, online = true, onQueued }: {
  user: SessionUser; settings: Settings | null; onPrint: (id: string) => void;
  openNewSignal?: number; offline?: boolean; online?: boolean; onQueued?: () => void;
}) {
  const canWrite = ['admin', 'manager', 'reception'].includes(user.role);
  const [list, setList] = useState<InvoiceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [fNum, setFNum] = useState('');
  const [fDate, setFDate] = useState('');
  const [fGuest, setFGuest] = useState('');
  const [fRoom, setFRoom] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QueuedInvoice[]>([]);
  const [editing, setEditing] = useState<null | { id?: string; draft: DraftState }>(null);
  const [fromCache, setFromCache] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    const cacheKey = `invoices:${offset}:${q}:${fNum}:${fDate}:${fGuest}:${fRoom}:${fFrom}:${fTo}:${status}`;
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (q) params.set('q', q);
      if (fNum) params.set('serial', fNum);
      if (fFrom) params.set('from', fFrom); else if (fDate) params.set('from', fDate);
      if (fTo) params.set('to', fTo); else if (fDate) params.set('to', fDate);
      if (fGuest) params.set('guest', fGuest);
      if (fRoom) params.set('room', fRoom);
      if (status) params.set('status', status);
      const r = await api.get<{ invoices: InvoiceSummary[]; total: number }>(`/api/invoices?${params}`);
      setList(r.invoices); setTotal(r.total); setFromCache(false);
      await cacheSet(cacheKey, r);
    } catch (e) {
      const hit = await cacheGet<{ invoices: InvoiceSummary[]; total: number }>(cacheKey);
      if (hit) { setList(hit.data.invoices); setTotal(hit.data.total); setFromCache(true); }
      else if (online && !(e instanceof TypeError)) setErr('تعذّر تحميل الفواتير');
    }
  }, [q, fNum, fDate, fGuest, fRoom, fFrom, fTo, status, offset, online]);

  const refreshQueue = useCallback(async () => { try { setQueue(await listQueue()); } catch { /* ignore */ } }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { refreshQueue(); }, [refreshQueue]);

  // Open the "new invoice" editor when the shell bumps the signal (FAB / hero button).
  useEffect(() => {
    if (openNewSignal > 0 && canWrite) setEditing({ draft: blankDraft(settings) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewSignal]);

  async function discardQueued(opId: string) {
    await removeQueued(opId);
    await refreshQueue();
    onQueued?.();
  }

  async function flushQueue() {
    setBusy(true); setInfo('');
    try {
      const r = await syncNow();
      await refreshQueue(); await load(); onQueued?.();
      if (r.rejected > 0) setErr(`${r.rejected} فاتورة مرفوضة من الخادم — عدّلها أو احذفها من القائمة.`);
      else if (r.sent > 0) setInfo(`تم رفع ${r.sent} فاتورة.`);
    } finally { setBusy(false); }
  }

  function clearSearch() {
    setQ(''); setFNum(''); setFDate(''); setFGuest(''); setFRoom(''); setFFrom(''); setFTo(''); setStatus(''); setOffset(0); setInfo('');
  }

  async function printConfirm(id: string) {
    setErr(''); setBusy(true);
    try { await api.post(`/api/invoices/${id}/print-confirm`, {}); await load(); }
    catch (e) { setErr(`تعذّر تأكيد الطباعة (${(e as ApiError).code})`); }
    finally { setBusy(false); }
  }

  // V15's lock step, reachable straight from the register: open -> locked.
  async function lockInvoice(id: string) {
    setErr(''); setBusy(true);
    try { await api.post(`/api/invoices/${id}/lock`, {}); await load(); }
    catch (e) { setErr(`تعذّر قفل الفاتورة (${(e as ApiError).code})`); }
    finally { setBusy(false); }
  }

  async function searchByNumber() {
    const v = fNum.trim();
    if (!v) { setErr('اكتب رقم الفاتورة الأول'); return; }
    setErr(''); setInfo(''); setBusy(true);
    try {
      const r = await api.get<{ invoices: InvoiceSummary[] }>(`/api/invoices?serial=${encodeURIComponent(v)}&limit=5`);
      const exact = r.invoices.find((i) => String(i.serial) === v) ?? r.invoices[0];
      if (!exact) { setInfo(`لا توجد فاتورة برقم ${v} — اتأكد من الرقم`); return; }
      setInfo(`فاتورة ${exact.serial} — النزيل: ${exact.guest_name} — الغرفة: ${exact.room_number || '—'} — الحالة: ${STATUS_LABEL[exact.status] ?? exact.status}`);
      onPrint(exact.id);
    } catch { setErr('تعذّر البحث'); }
    finally { setBusy(false); }
  }

  // Printable statement for the current filter/date range. Admin/manager only,
  // and only the fields the user actually set are applied as filters.
  async function printRange() {
    if (!['admin', 'manager'].includes(user.role)) { setErr('طباعة كشف المدة للمديرين فقط'); return; }
    setErr(''); setBusy(true);
    try {
      const params = new URLSearchParams();
      if (fFrom) params.set('from', fFrom);
      if (fTo) params.set('to', fTo);
      if (fNum) params.set('serial', fNum);
      if (fGuest) params.set('guest', fGuest);
      if (fRoom) params.set('room', fRoom);
      if (status) params.set('status', status);
      const r = await api.get<{ rows: RegRow[] }>(`/api/reports/register?${params}`);
      if (!r.rows.length) { setErr('مفيش فواتير في المدة دي — اتأكد من التواريخ'); return; }
      const valid = r.rows.filter((x) => x.status !== 'cancelled');
      const sum = (k: keyof RegRow) => valid.reduce((s, x) => s + Number(x[k] as string), 0).toFixed(2);
      const fromTxt = fFrom || 'من البداية'; const toTxt = fTo || 'حتى الآن';
      const rows = [
        ...valid.map((x) => `<tr><td>${x.serial}</td><td>${x.issuedAt.slice(0, 10)}</td><td>${esc(x.guest)}</td><td>${esc(x.room)}</td><td>${x.stay}</td><td>${x.restaurant}</td><td>${x.services}</td><td>${x.extra}</td><td>${x.subtotal}</td><td>${x.net}</td><td>${x.tax}</td><td>${x.discount}</td><td>${x.total}</td><td>سليمة</td></tr>`),
        ...r.rows.filter((x) => x.status === 'cancelled').map((x) => `<tr style="background:#ffe6e6"><td>${x.serial}</td><td>${x.issuedAt.slice(0, 10)}</td><td>${esc(x.guest)}</td><td>${esc(x.room)}</td><td colspan="8">ملغاة — خارج الإجماليات</td><td>${x.total}</td><td>ملغاة</td></tr>`),
      ].join('');
      const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>كشف فواتير</title>
        <style>body{font-family:Tahoma,Arial,sans-serif;padding:16px;color:#16202e}
        h2{margin:0 0 4px;color:#0F2340;text-align:center} p.sub{text-align:center;margin:0 0 12px;color:#555;font-size:13px}
        table{width:100%;border-collapse:collapse} th,td{border:1px solid #999;padding:6px;text-align:center;font-size:11.5px}
        th{background:#0F2340;color:#fff} tfoot td{background:#f6f5ef;font-weight:bold}
        @media print{@page{size:A4 landscape;margin:10mm}}</style></head><body>
        <h2>فندق قاعود سبورتنج — KAOUD SPORTING HOTEL</h2>
        <p class="sub">كشف فواتير من: ${fromTxt} إلى: ${toTxt} — عدد الفواتير: ${r.rows.length} — السليمة: ${valid.length} — الملغاة: ${r.rows.length - valid.length}</p>
        <table><thead><tr><th>رقم</th><th>التاريخ</th><th>النزيل</th><th>الغرفة</th><th>إقامة</th><th>مطعم</th><th>خدمات</th><th>إضافي</th><th>قبل الضريبة</th><th>الصافي</th><th>ضريبة</th><th>خصم</th><th>الإجمالي</th><th>الحالة</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="8">الإجمالي (السليمة فقط)</td><td>${sum('subtotal')}</td><td>${sum('net')}</td><td>${sum('tax')}</td><td>${sum('discount')}</td><td>${sum('total')}</td><td></td></tr></tfoot>
        </table></body></html>`;
      if (!openPrintWindow(html)) setErr('المتصفح منع فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة');
    } catch { setErr('تعذّر تجهيز الكشف'); }
    finally { setBusy(false); }
  }

  function exportRegisterExcel() {
    exportExcel({
      title: 'فندق قاعود سبورتنج — سجل الفواتير',
      headers: ['رقم', 'النزيل', 'الغرفة', 'الدخول', 'الخروج', 'الدفع', 'صافي', 'ضريبة', 'الإجمالي', 'الحالة'],
      rows: list.map((i) => [i.serial, i.guest_name, i.room_number || '', i.check_in ?? '', i.check_out ?? '', PAY_LABEL[i.payment_method ?? 'cash'] ?? 'نقدي', i.subtotal_net, i.tax_total, i.total, STATUS_LABEL[i.status] ?? i.status]),
      filename: 'kaoud-invoices.xls',
    });
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <input placeholder="بحث سريع (رقم / نزيل / غرفة)" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, minWidth: 240 }} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {canWrite && <button className="btn primary" onClick={() => setEditing({ draft: blankDraft(settings) })}><Icon name="plus" size={16} /> فاتورة جديدة</button>}
            <button className="btn" onClick={exportRegisterExcel} disabled={!list.length}>تصدير Excel</button>
          </div>
        </div>

        <div className="grid cols-3" style={{ marginTop: 12 }}>
          <label className="field">رقم الفاتورة<input dir="ltr" value={fNum} onChange={(e) => { setFNum(e.target.value); setOffset(0); }} placeholder="مثال: 10246" /></label>
          <label className="field">التاريخ<input type="date" value={fDate} onChange={(e) => { setFDate(e.target.value); setOffset(0); }} /></label>
          <label className="field">اسم النزيل<input value={fGuest} onChange={(e) => { setFGuest(e.target.value); setOffset(0); }} /></label>
          <label className="field">الغرفة<input value={fRoom} onChange={(e) => { setFRoom(e.target.value); setOffset(0); }} /></label>
          <label className="field">من تاريخ<input type="date" value={fFrom} onChange={(e) => { setFFrom(e.target.value); setOffset(0); }} /></label>
          <label className="field">إلى تاريخ<input type="date" value={fTo} onChange={(e) => { setFTo(e.target.value); setOffset(0); }} /></label>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }} style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8 }}>
            <option value="">كل الحالات</option>
            <option value="open">مفتوحة</option>
            <option value="locked">مقفلة</option>
            <option value="printed">مطبوعة</option>
            <option value="cancelled">ملغاة</option>
          </select>
          <button className="btn ghost" onClick={clearSearch}>مسح البحث</button>
          <button className="btn" disabled={busy} onClick={searchByNumber}>ابحث بالرقم واطبع</button>
          {['admin', 'manager'].includes(user.role) && <button className="btn" disabled={busy} onClick={printRange}>طباعة كشف المدة</button>}
        </div>
        {offline && !online && <div className="alert warn" style={{ marginTop: 10 }}>أنت غير متصل — يمكنك إنشاء فواتير وستُحفظ محليًا بأرقام محجوزة وتُرفع تلقائيًا عند عودة الاتصال.</div>}
        {fromCache && <div className="alert warn" style={{ marginTop: 10 }}>تُعرض قائمة آخر اتصال — قد لا تتضمن أحدث الفواتير.</div>}
        {info && <div className="alert ok" style={{ marginTop: 10 }}>{info}</div>}
      </div>

      {err && <div className="alert err">{err}</div>}

      {offline && queue.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="spread">
            <h3>فواتير بانتظار المزامنة ({queue.length})</h3>
            <button className="btn primary" disabled={busy || !online} onClick={flushQueue}>{online ? 'زامن الآن' : 'غير متصل'}</button>
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>اتحفظت محليًا على الجهاز بأرقام محجوزة، وستُرفع تلقائيًا عند عودة الاتصال.</div>
          <table data-mobile="cards" style={{ marginTop: 10 }}>
            <thead><tr><th>رقم</th><th>النزيل</th><th>الغرفة</th><th className="num">الإجمالي</th><th>الوقت</th><th></th></tr></thead>
            <tbody>
              {queue.map((it) => (
                <tr key={it.opId}>
                  <td className="mono" data-label="رقم">{it.serial}</td>
                  <td data-label="النزيل">{it.guestName}</td>
                  <td className="mono" data-label="الغرفة">{it.roomNumber || '—'}</td>
                  <td className="num" data-label="الإجمالي">{egp(it.total)}</td>
                  <td className="muted" data-label="الوقت">{dt(it.createdAt)}</td>
                  <td><button className="btn ghost" disabled={busy} onClick={() => discardQueued(it.opId)}>حذف</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <table data-mobile="cards">
          <thead>
            <tr>
              <th>رقم</th><th>النزيل</th><th>الغرفة</th><th>الدخول</th><th>الخروج</th>
              <th className="num">صافي</th><th className="num">ضريبة</th><th className="num">الإجمالي</th>
              <th>الدفع</th><th>الحالة</th><th>الضرائب</th><th></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={12} className="muted">لا نتائج</td></tr>}
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
                <td data-label="الدفع">{PAY_LABEL[inv.payment_method ?? 'cash'] ?? 'نقدي'}</td>
                <td data-label="الحالة"><span className={`badge ${inv.status}`}>{STATUS_LABEL[inv.status]}</span></td>
                <td data-label="الضرائب"><span className="badge eta">{ETA_LABEL[inv.eta_status] ?? inv.eta_status}</span></td>
                <td data-label="">
                  <div className="row" style={{ gap: 6 }}>
                    {inv.status !== 'cancelled' && <button className="btn ghost" onClick={() => onPrint(inv.id)} title="طباعة أو معاينة">طباعة</button>}
                    {canWrite && inv.status === 'open' && <button className="btn ghost" onClick={() => lockInvoice(inv.id)} disabled={busy}>قفل</button>}
                    {canWrite && inv.status === 'locked' && <button className="btn ghost" onClick={() => printConfirm(inv.id)} disabled={busy}>تأكيد الطباعة</button>}
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
          offline={offline && !editing.id}
          onClose={() => setEditing(null)}
          onPrint={onPrint}
          onSaved={async () => {
            setEditing(null);
            if (online) { try { await syncNow(); } catch { /* stays queued */ } }
            await refreshQueue(); await load(); onQueued?.();
          }}
        />
      )}
    </>
  );
}

interface RegRow {
  id: string; serial: number; issuedAt: string; guest: string; room: string;
  status: string; stay: string; restaurant: string; services: string; extra: string;
  subtotal: string; net: string; tax: string; discount: string; total: string;
}
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface DraftState {
  guestName: string; roomNumber: string; checkIn: string; checkOut: string;
  receiverTaxId: string; notes: string; applyDiscount: boolean; lines: DraftLine[];
  vatRate: string; discountRate: string; issuerName: string; issuerTaxId: string; issuerAddress: string;
  paymentMethod: string;
}

function blankDraft(settings: Settings | null): DraftState {
  const t = today();
  return {
    guestName: '', roomNumber: '', checkIn: t, checkOut: addDays(t, 1), receiverTaxId: '', notes: '',
    applyDiscount: (settings?.discount_rate ?? 0) > 0,
    lines: [{ description: '', qty: 1, unitPrice: '', kind: 'room' }],
    vatRate: '', discountRate: '', issuerName: '', issuerTaxId: '', issuerAddress: '',
    paymentMethod: 'cash',
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
      paymentMethod: iv.payment_method || 'cash',
    },
  });
}

function InvoiceEditor({ user, settings, id, initial, onClose, onSaved, onPrint, offline = false }: {
  user: SessionUser; settings: Settings | null; id?: string; initial: DraftState;
  onClose: () => void; onSaved: () => void; onPrint?: (id: string) => void; offline?: boolean;
}) {
  const [draft, setDraft] = useState<DraftState>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [nextSerial, setNextSerial] = useState<number | null>(null);
  const [showTax, setShowTax] = useState(false);
  const canWrite = ['admin', 'manager', 'reception'].includes(user.role);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (id) return;
    api.get<{ nextSerial: number }>('/api/invoices/next-serial').then((r) => setNextSerial(r.nextSerial)).catch(() => {});
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the guest-name field so the keyboard opens ready to type (the field
    // is the first thing the receptionist fills in a new invoice).
    firstFieldRef.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [onClose]);

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

  async function save(opts?: { print?: boolean }) {
    setErr(''); setBusy(true);
    try {
      const lines = draft.lines.filter((l) => l.description.trim()).map((l) => ({
        description: l.description.trim(), qty: Number(l.qty) || 1, unitPrice: l.unitPrice || '0',
        kind: l.kind as LineKind,
      }));
      // An invoice with no lines has no total; the server rejects it, and an
      // offline one would sit in the queue forever. Block it here instead.
      if (lines.length === 0) { setErr('أضف بندًا واحدًا على الأقل (الوصف مطلوب)'); return; }
      // The server requires the issuer tax number to be exactly 9 digits; a free
      // value would be rejected 400 (and wedge an offline queue item).
      const issuerTaxId = draft.issuerTaxId.trim();
      if (issuerTaxId !== '' && !/^\d{9}$/.test(issuerTaxId)) {
        setErr('الرقم الضريبي للمُصدر يجب أن يكون 9 أرقام بالضبط، أو اتركه فارغًا لاستخدام الإعدادات');
        return;
      }
      // Offline: queue the invoice locally, numbered from the device's reserved
      // block; it is pushed to the server on the next sync.
      if (offline && !id) {
        await queueInvoice({
          guestName: draft.guestName.trim(), roomNumber: draft.roomNumber.trim(),
          checkIn: draft.checkIn || undefined, checkOut: draft.checkOut || undefined,
          receiverTaxId: draft.receiverTaxId.trim() || undefined, notes: draft.notes.trim() || undefined,
          applyDiscount: draft.applyDiscount,
          vatRate: optNum(draft.vatRate) ?? null, discountRate: optNum(draft.discountRate) ?? null,
          issuerName: draft.issuerName.trim() || null, issuerTaxId: draft.issuerTaxId.trim() || null,
          issuerAddress: draft.issuerAddress.trim() || null,
          paymentMethod: draft.paymentMethod,
          lines,
        });
        onSaved();
        return;
      }
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
        paymentMethod: draft.paymentMethod,
        lines,
      };
      if (id) await api.put(`/api/invoices/${id}`, body);
      else if (opts?.print) {
        // V15's "create and print": lock + confirm print in one flow. Reception
        // can only create; it must lock from the register (the server would
        // reject a print-confirm on an open invoice anyway).
        const created = await api.post<{ invoice: { id: string } }>('/api/invoices', body);
        const newId = created.invoice.id;
        if (['admin', 'manager'].includes(user.role)) {
          await api.post(`/api/invoices/${newId}/lock`, {});
          await api.post(`/api/invoices/${newId}/print-confirm`, {});
        }
        onSaved();
        onPrint?.(newId);
        return;
      } else await api.post('/api/invoices', body);
      onSaved();
    } catch (e) {
      const ae = e as ApiError;
      if (e instanceof TypeError && !id) setErr('تعذّر الاتصال — شغّل الوضع الأوفلاين لتحفظ الفاتورة محليًا');
      else setErr(ae.code === 'bad_request' ? 'تحقق من صحة البيانات (الوصف والمبلغ مطلوبان)' : `تعذّر الحفظ (${ae.code})`);
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
    <div className="inv-editor-scrim no-print" role="dialog" aria-modal="true" aria-label={id ? 'تعديل فاتورة' : 'فاتورة جديدة'}>
      <div className="card inv-editor">
      <div className="spread">
        <h3>{id ? 'تعديل فاتورة' : `فاتورة جديدة ${nextSerial ? `— رقم ${nextSerial}` : ''}`}</h3>
        <button className="btn ghost" onClick={onClose}>إغلاق</button>
      </div>
      {err && <div className="alert err">{err}</div>}

      <div className="grid cols-3">
        <label className="field">اسم النزيل<input ref={firstFieldRef} value={draft.guestName} onChange={(e) => setDraft({ ...draft, guestName: e.target.value })} required /></label>
        <label className="field">رقم الغرفة<input value={draft.roomNumber} onChange={(e) => setDraft({ ...draft, roomNumber: e.target.value })} /></label>
        <label className="field">الرقم الضريبي للنزيل (اختياري)<input dir="ltr" value={draft.receiverTaxId} onChange={(e) => setDraft({ ...draft, receiverTaxId: e.target.value })} /></label>
        <label className="field">تاريخ الدخول<input type="date" value={draft.checkIn} onChange={(e) => setDraft({ ...draft, checkIn: e.target.value })} /></label>
        <label className="field">تاريخ الخروج<input type="date" value={draft.checkOut} onChange={(e) => setDraft({ ...draft, checkOut: e.target.value })} /></label>
        <label className="field">عدد الليالي<input value={nights} readOnly dir="ltr" /></label>
        <label className="field">طريقة الدفع
          <select value={draft.paymentMethod} onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value })}>
            <option value="cash">نقدي</option>
            <option value="card">فيزا / بطاقة</option>
            <option value="bank_transfer">تحويل بنكي</option>
            <option value="instapay">إنستاباي</option>
            <option value="other">آجل / شركات</option>
          </select>
        </label>
      </div>

      <div style={{ marginTop: 14 }}>
        <button className="btn ghost" onClick={() => setShowTax((v) => !v)}>
          <Icon name={showTax ? 'chevronDown' : 'chevronRight'} size={15} /> بيانات الضريبة والإصدار {hasOverrides ? '(مخصّصة لهذه الفاتورة)' : '(من الإعدادات)'}
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
                  {LINE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </td>
              <td className="num"><input type="number" min="0" step="1" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} style={{ width: 80, padding: 7, border: '1px solid var(--border)', borderRadius: 6 }} dir="ltr" /></td>
              <td className="num"><input type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} style={{ width: 110, padding: 7, border: '1px solid var(--border)', borderRadius: 6 }} dir="ltr" /></td>
              <td className="num">{egp((Number(l.qty) || 0) * (Number(l.unitPrice) || 0))}</td>
              <td>{draft.lines.length > 1 && <button className="btn ghost" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })} aria-label="حذف البند"><Icon name="close" size={15} /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn" style={{ marginTop: 10 }} onClick={() => setDraft({ ...draft, lines: [...draft.lines, { description: '', qty: 1, unitPrice: '', kind: 'extra' }] })}><Icon name="plus" size={15} /> إضافة بند</button>

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
        {id && canWrite && <button className="btn" disabled={busy} onClick={() => action('lock', 'القفل')}>قفل الفاتورة</button>}
        {id && ['admin', 'manager'].includes(user.role) && <button className="btn danger" disabled={busy} onClick={() => action('cancel', 'الإلغاء')}>إلغاء الفاتورة</button>}
        {!id && !offline && ['admin', 'manager'].includes(user.role) && <button className="btn" disabled={busy || !draft.guestName.trim()} onClick={() => save({ print: true })}>إنشاء وطباعة</button>}
        <button className="btn primary" disabled={busy || !draft.guestName.trim()} onClick={() => save()}>{id ? 'حفظ التعديلات' : 'إنشاء الفاتورة'}</button>
      </div>
      {id && <div className="muted" style={{ marginTop: 8 }}>ملاحظة: يجب قفل الفاتورة قبل الطباعة أو الإرسال للضرائب.</div>}
      </div>
    </div>
  );
}
