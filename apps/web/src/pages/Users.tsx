import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../api';
import type { SessionUser } from '../types';
import { dt, ROLE_LABEL } from '../format';

interface UserRow { id: string; username: string; name: string; role: string; active: number; is_owner: number; created_at: string; last_login_at: string | null; }

const ROLES = ['admin', 'manager', 'accountant', 'reception'] as const;
const ERR: Record<string, string> = {
  username_taken: 'اسم المستخدم مستخدم بالفعل',
  weak_password: 'كلمة المرور ضعيفة (10 أحرف على الأقل، حرف كبير وصغير ورقم)',
  cannot_demote_owner: 'لا يمكن تغيير دور حساب المالك',
  cannot_disable_self: 'لا يمكنك تعطيل حسابك',
  cannot_disable_owner: 'لا يمكن تعطيل حساب المالك',
  forbidden: 'لا تملك الصلاحية لهذا الإجراء',
  not_found: 'المستخدم غير موجود',
  bad_request: 'بيانات غير صحيحة',
};

export function UsersPage({ user }: { user: SessionUser }) {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'reception' });
  const isAdmin = user.role === 'admin';

  const load = useCallback(async () => {
    try { setRows((await api.get<{ users: UserRow[] }>('/api/users')).users); }
    catch { setErr('تعذّر تحميل المستخدمين'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const fail = (e: unknown, fallback: string) => setErr(ERR[(e as ApiError).code] ?? fallback);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    try {
      await api.post('/api/users', form);
      setMsg('تم إنشاء المستخدم'); setForm({ username: '', name: '', password: '', role: 'reception' }); await load();
    } catch (e2) { fail(e2, 'تعذّر الإنشاء'); }
  }

  async function changeRole(u: UserRow, role: string) {
    setErr(''); setMsg('');
    try { await api.patch(`/api/users/${u.id}`, { role }); setMsg(`تم تحديث صلاحيات ${u.name}`); await load(); }
    catch (e) { fail(e, 'تعذّر تغيير الدور'); await load(); }
  }

  async function toggleActive(u: UserRow) {
    setErr(''); setMsg('');
    try { await api.patch(`/api/users/${u.id}`, { active: u.active === 0 }); await load(); }
    catch (e) { fail(e, 'تعذّر التعديل'); }
  }

  async function resetPassword(u: UserRow) {
    const pw = prompt(`كلمة مرور جديدة للمستخدم ${u.username} (10 أحرف على الأقل، حرف كبير وصغير ورقم):`);
    if (!pw) return; setErr(''); setMsg('');
    try { await api.patch(`/api/users/${u.id}`, { password: pw }); setMsg('تم تغيير كلمة المرور'); }
    catch (e) { fail(e, 'تعذّر التغيير'); }
  }

  async function removeUser(u: UserRow) {
    if (!confirm(`حذف المستخدم "${u.name}" (${u.username}) نهائيًا؟ لا يمكن التراجع.`)) return;
    setErr(''); setMsg('');
    try { await api.del(`/api/users/${u.id}`); setMsg('تم حذف المستخدم'); await load(); }
    catch (e) { fail(e, 'تعذّر الحذف'); }
  }

  return (
    <>
      {isAdmin && (
        <div className="card">
          <h3>إضافة مستخدم</h3>
          {msg && <div className="alert ok">{msg}</div>}
          {err && <div className="alert err">{err}</div>}
          <form onSubmit={create} className="grid cols-4">
            <label className="field">اسم المستخدم<input dir="ltr" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
            <label className="field">الاسم<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label className="field">كلمة المرور<input type="password" dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
            <label className="field">الدور
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="reception">استقبال</option>
                <option value="accountant">محاسب</option>
                <option value="manager">مدير</option>
                <option value="admin">مدير النظام</option>
              </select>
            </label>
            <div className="row end" style={{ gridColumn: '1 / -1' }}><button className="btn primary">إضافة</button></div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="spread">
          <h3>المستخدمون</h3>
          <span className="muted">تعديل الدور يغيّر صلاحيات المستخدم فورًا</span>
        </div>
        {msg && <div className="alert ok">{msg}</div>}
        {err && <div className="alert err">{err}</div>}
        <table data-mobile="cards">
          <thead><tr><th>اسم المستخدم</th><th>الاسم</th><th>الصلاحية</th><th>الحالة</th><th>آخر دخول</th><th></th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="mono" data-label="اسم المستخدم">{u.username}{u.is_owner ? ' ★' : ''}</td>
                <td data-label="الاسم">{u.name}</td>
                <td data-label="الصلاحية">
                  {isAdmin && !u.is_owner
                    ? <select value={u.role} onChange={(e) => changeRole(u, e.target.value)}
                        style={{ padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 8 }}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    : <span>{ROLE_LABEL[u.role] ?? u.role}{u.is_owner ? ' (مالك)' : ''}</span>}
                </td>
                <td data-label="الحالة">{u.active ? <span className="badge locked">نشط</span> : <span className="badge cancelled">معطّل</span>}</td>
                <td data-label="آخر دخول">{u.last_login_at ? dt(u.last_login_at) : '—'}</td>
                <td data-label="">{isAdmin && !u.is_owner && (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn ghost" onClick={() => toggleActive(u)}>{u.active ? 'تعطيل' : 'تفعيل'}</button>
                    <button className="btn ghost" onClick={() => resetPassword(u)}>كلمة المرور</button>
                    <button className="btn ghost" onClick={() => removeUser(u)} style={{ color: 'var(--danger, #c0392b)' }}>حذف</button>
                  </div>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="card">
          <h3>دليل الصلاحيات</h3>
          <table data-mobile="cards">
            <thead><tr><th>الدور</th><th>ما يستطيع فعله</th></tr></thead>
            <tbody>
              <tr><td data-label="الدور"><strong>{ROLE_LABEL.admin}</strong></td><td data-label="الصلاحيات">كل شيء: إدارة المستخدمين والأدوار، الإعدادات، الضرائب، الأرقام، سجل النشاط، التصدير</td></tr>
              <tr><td data-label="الدور"><strong>{ROLE_LABEL.manager}</strong></td><td data-label="الصلاحيات">الفواتير والحجوزات والتقارير، تعديل الإعدادات والأرقام، حجز الأرقام للأجهزة، عرض المستخدمين (بدون إنشاء/تعديل)</td></tr>
              <tr><td data-label="الدور"><strong>{ROLE_LABEL.accountant}</strong></td><td data-label="الصلاحيات">التقارير، فحص مصلحة الضرائب وتدقيق الأرقام — بدون تعديل البيانات</td></tr>
              <tr><td data-label="الدور"><strong>{ROLE_LABEL.reception}</strong></td><td data-label="الصلاحيات">إنشاء وتعديل الفواتير، إدارة الغرف والحجوزات والنزلاء</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
