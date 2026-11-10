import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { SessionUser, Settings } from '../types';

export function SettingsPage({ user, onSaved }: { user: SessionUser; onSaved: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const canEdit = ['admin', 'manager'].includes(user.role);

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
      });
      setMsg('تم الحفظ'); onSaved();
    } catch (e) { setErr(`تعذّر الحفظ (${(e as ApiError).code})`); }
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
    </>
  );
}
