import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../api';
import type { SessionUser } from '../types';
import { dt, ROLE_LABEL } from '../format';

interface UserRow { id: string; username: string; name: string; role: string; active: number; is_owner: number; created_at: string; last_login_at: string | null; }

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

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    try {
      await api.post('/api/users', form);
      setMsg('تم إنشاء المستخدم'); setForm({ username: '', name: '', password: '', role: 'reception' }); await load();
    } catch (e2) { setErr(`تعذّر الإنشاء (${(e2 as ApiError).code})`); }
  }

  async function toggleActive(u: UserRow) {
    setErr('');
    try { await api.patch(`/api/users/${u.id}`, { active: u.active === 0 }); await load(); }
    catch (e) { setErr(`تعذّر التعديل (${(e as ApiError).code})`); }
  }

  async function resetPassword(u: UserRow) {
    const pw = prompt(`كلمة مرور جديدة للمستخدم ${u.username} (10 أحرف على الأقل، حرف كبير وصغير ورقم):`);
    if (!pw) return; setErr('');
    try { await api.patch(`/api/users/${u.id}`, { password: pw }); setMsg('تم تغيير كلمة المرور'); }
    catch (e) { setErr(`تعذّر التغيير (${(e as ApiError).code})`); }
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
        <h3>المستخدمون</h3>
        <table data-mobile="cards">
          <thead><tr><th>اسم المستخدم</th><th>الاسم</th><th>الدور</th><th>الحالة</th><th>آخر دخول</th><th></th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="mono" data-label="اسم المستخدم">{u.username}{u.is_owner ? ' ★' : ''}</td>
                <td data-label="الاسم">{u.name}</td>
                <td data-label="الدور">{ROLE_LABEL[u.role] ?? u.role}</td>
                <td data-label="الحالة">{u.active ? <span className="badge locked">نشط</span> : <span className="badge cancelled">معطّل</span>}</td>
                <td data-label="آخر دخول">{u.last_login_at ? dt(u.last_login_at) : '—'}</td>
                <td data-label="">{isAdmin && !u.is_owner && (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn ghost" onClick={() => toggleActive(u)}>{u.active ? 'تعطيل' : 'تفعيل'}</button>
                    <button className="btn ghost" onClick={() => resetPassword(u)}>كلمة المرور</button>
                  </div>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
