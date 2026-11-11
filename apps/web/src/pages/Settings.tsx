import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { downloadJson, readJsonFile } from '../exports';
import type { SessionUser, Settings } from '../types';

export function SettingsPage({ user, onSaved }: { user: SessionUser; onSaved: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [clearWord, setClearWord] = useState('');
  const canEdit = ['admin', 'manager'].includes(user.role);
  const isAdmin = user.role === 'admin';

  useEffect(() => { api.get<{ settings: Settings }>('/api/settings').then((r) => setS(r.settings)).catch(() => setErr('تعذّر التحميل')); }, []);

  function upd<K extends keyof Settings>(k: K, v: Settings[K]) { setS((x) => x ? { ...x, [k]: v } : x); }

  async function save() {
    if (!s) return; setErr(''); setMsg('');
    try {
      await api.put('/api/settings', {
        hotelName: s.hotel_name, hotelNameEn: s.hotel_name_en, taxRegistrationNumber: s.tax_registration_number,
        commercialRegister: s.commercial_register, activityCode: s.activity_code, address: s.address, city: s.city,
        phone: s.phone, email: s.email, vatRate: Number(s.vat_rate), discountRate: Number(s.discount_rate),
        pricesIncludeTax: s.prices_include_tax === 1, serialStart: Number(s.serial_start), currency: s.currency,
        logoData: s.logo_data, signatureLeft: s.signature_left, signatureRight: s.signature_right, footerNote: s.footer_note,
      });
      setMsg('تم الحفظ'); onSaved();
    } catch (e) { setErr(`تعذّر الحفظ (${(e as ApiError).code})`); }
  }

  async function onLogo(file: File | undefined) {
    if (!file) return;
    setErr('');
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) { setErr('صيغة اللوجو غير مدعومة (PNG / JPG / WebP / SVG)'); return; }
    if (file.size > 200_000) { setErr('حجم اللوجو كبير — الحد الأقصى 200 كيلوبايت'); return; }
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file);
    });
    upd('logo_data', data);
  }

  async function backup() {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const data = await api.get<unknown>('/api/export');
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJson(`kaoud-backup-${stamp}.json`, data);
      setMsg('تم تنزيل النسخة الاحتياطية');
    } catch { setErr('تعذّر إنشاء النسخة الاحتياطية'); }
    finally { setBusy(false); }
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    setErr(''); setMsg('');
    if (!window.confirm('سيتم استبدال كل البيانات الحالية (الفواتير، الغرف، النزلاء، الحجوزات، الإعدادات) بمحتوى النسخة الاحتياطية. المستخدمون وكلمات المرور لن تتأثر. هل تريد المتابعة؟')) return;
    setBusy(true);
    try {
      const data = await readJsonFile(file);
      const r = await api.post<{ imported: Record<string, number> }>('/api/import', data);
      const n = r.imported;
      setMsg(`تم الاستيراد: ${n.invoices} فاتورة، ${n.rooms} غرفة، ${n.guests} نزيل، ${n.reservations} حجز`);
      onSaved();
      const fresh = await api.get<{ settings: Settings }>('/api/settings');
      setS(fresh.settings);
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.code === 'invalid_json' ? 'الملف ليس ملف نسخة احتياطية صالحًا' : `تعذّر الاستيراد (${ae.code ?? 'error'})`);
    } finally { setBusy(false); }
  }

  async function clearData() {
    if (clearWord !== 'مسح') return;
    if (!window.confirm('سيتم حذف كل الفواتير والغرف والنزلاء والحجوزات نهائيًا. المستخدمون والإعدادات لن تتأثر. هل أنت متأكد؟')) return;
    setErr(''); setMsg(''); setBusy(true);
    try {
      await api.post('/api/admin/clear-data', { confirm: 'مسح' });
      setMsg('تم مسح البيانات التشغيلية');
      setClearWord('');
      onSaved();
    } catch (e) { setErr(`تعذّر المسح (${(e as ApiError).code})`); }
    finally { setBusy(false); }
  }

  if (!s) return <div className="muted">جارٍ التحميل…</div>;

  const num = (v: number) => Number(v) || 0;

  return (
    <>
      <div className="card">
        <h3>بيانات المنشأة (تظهر على الفاتورة الضريبية)</h3>
        {msg && <div className="alert ok">{msg}</div>}
        {err && <div className="alert err">{err}</div>}
        <div className="grid cols-2">
          <label className="field">الاسم بالعربية<input value={s.hotel_name} disabled={!canEdit} onChange={(e) => upd('hotel_name', e.target.value)} /></label>
          <label className="field">الاسم بالإنجليزية<input dir="ltr" value={s.hotel_name_en} disabled={!canEdit} onChange={(e) => upd('hotel_name_en', e.target.value)} /></label>
          <label className="field">الرقم الضريبي (9 أرقام)<input dir="ltr" value={s.tax_registration_number} disabled={!canEdit} onChange={(e) => upd('tax_registration_number', e.target.value)} /></label>
          <label className="field">السجل التجاري<input dir="ltr" value={s.commercial_register} disabled={!canEdit} onChange={(e) => upd('commercial_register', e.target.value)} /></label>
          <label className="field">كود النشاط (4 أرقام)<input dir="ltr" value={s.activity_code} disabled={!canEdit} onChange={(e) => upd('activity_code', e.target.value)} /></label>
          <label className="field">المدينة<input value={s.city} disabled={!canEdit} onChange={(e) => upd('city', e.target.value)} /></label>
          <label className="field">العنوان<input value={s.address} disabled={!canEdit} onChange={(e) => upd('address', e.target.value)} /></label>
          <label className="field">الهاتف<input dir="ltr" value={s.phone} disabled={!canEdit} onChange={(e) => upd('phone', e.target.value)} /></label>
          <label className="field">البريد الإلكتروني<input dir="ltr" value={s.email} disabled={!canEdit} onChange={(e) => upd('email', e.target.value)} /></label>
        </div>
      </div>

      <div className="card">
        <h3>اللوجو والتوقيعات (تظهر على الفاتورة المطبوعة)</h3>
        <div className="grid cols-2">
          <div className="field">
            <span>لوجو الفندق</span>
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              {s.logo_data
                ? <img src={s.logo_data} alt="logo" style={{ height: 64, maxWidth: 160, objectFit: 'contain', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 4 }} />
                : <span className="muted">لا يوجد لوجو</span>}
              {canEdit && (
                <div className="row" style={{ gap: 8 }}>
                  <label className="btn ghost" style={{ cursor: 'pointer' }}>
                    اختيار صورة
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => onLogo(e.target.files?.[0])} />
                  </label>
                  {s.logo_data && <button className="btn ghost" onClick={() => upd('logo_data', '')}>حذف</button>}
                </div>
              )}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>PNG / JPG / WebP / SVG — حتى 200 كيلوبايت. يُحفظ داخل قاعدة البيانات.</span>
          </div>
          <div className="field">
            <span>النص أسفل الفاتورة</span>
            <textarea rows={3} value={s.footer_note} disabled={!canEdit} onChange={(e) => upd('footer_note', e.target.value)} />
          </div>
          <label className="field">اسم التوقيع (يسار)<input value={s.signature_left} disabled={!canEdit} onChange={(e) => upd('signature_left', e.target.value)} placeholder="المدير المالي|Financial Controller" /></label>
          <label className="field">اسم التوقيع (يمين)<input value={s.signature_right} disabled={!canEdit} onChange={(e) => upd('signature_right', e.target.value)} placeholder="مدير الائتمان|Credit Manager" /></label>
        </div>
      </div>

      <div className="card">
        <h3>الإعدادات الضريبية والترقيم</h3>
        <div className="grid cols-3">
          <label className="field">نسبة ضريبة القيمة المضافة %<input type="number" dir="ltr" value={s.vat_rate} disabled={!canEdit} onChange={(e) => upd('vat_rate', num(Number(e.target.value)))} /></label>
          <label className="field">نسبة الخصم %<input type="number" dir="ltr" value={s.discount_rate} disabled={!canEdit} onChange={(e) => upd('discount_rate', num(Number(e.target.value)))} /></label>
          <label className="field">العملة<input dir="ltr" value={s.currency} disabled={!canEdit} onChange={(e) => upd('currency', e.target.value)} /></label>
          <label className="field">رقم بداية الفواتير<input type="number" dir="ltr" value={s.serial_start} disabled={!canEdit} onChange={(e) => upd('serial_start', num(Number(e.target.value)))} /></label>
          <label className="row" style={{ alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={s.prices_include_tax === 1} disabled={!canEdit} onChange={(e) => upd('prices_include_tax', e.target.checked ? 1 : 0)} />
            الأسعار تشمل الضريبة
          </label>
        </div>
        {canEdit && <button className="btn primary" style={{ marginTop: 14 }} onClick={save}>حفظ الإعدادات</button>}
      </div>

      {isAdmin && (
        <div className="card">
          <h3>النسخ الاحتياطي والاستيراد</h3>
          <p className="muted" style={{ marginTop: 0 }}>نزّل نسخة كاملة من بيانات الفندق (إعدادات، فواتير، بنود، مدفوعات، غرف، نزلاء، حجوزات) بصيغة JSON، أو استعِد نسخة سابقة.</p>
          {msg && <div className="alert ok">{msg}</div>}
          {err && <div className="alert err">{err}</div>}
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={busy} onClick={backup}>تنزيل نسخة احتياطية</button>
            <label className="btn ghost" style={{ cursor: 'pointer' }}>
              استيراد نسخة (استبدال)
              <input type="file" accept="application/json,.json" hidden onChange={(e) => { restore(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>الاستيراد يستبدل البيانات الحالية بالكامل. حسابات المستخدمين وكلمات المرور لا تتأثر.</div>
        </div>
      )}

      {user.isOwner && (
        <div className="card" style={{ borderColor: 'var(--danger-border)' }}>
          <h3>مسح كل البيانات (للمالك فقط)</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            يحذف كل الفواتير والبنود والمدفوعات والغرف والنزلاء والحجوزات وسجل الأرقام المحجوزة.
            المستخدمون وكلمات المرور والإعدادات والسجل لا تتأثر. اكتب كلمة «مسح» للتأكيد.
          </p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={clearWord} onChange={(e) => setClearWord(e.target.value)} placeholder="اكتب: مسح" style={{ maxWidth: 200 }} />
            <button className="btn danger" disabled={busy || clearWord !== 'مسح'} onClick={clearData}>مسح كل البيانات</button>
          </div>
        </div>
      )}
    </>
  );
}
