import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Role } from '../types';
import { dt, ROLE_LABEL } from '../format';

interface UserActivity {
  id: string; username: string; name: string; role: Role; active: boolean;
  total: number; logins: number; invoices: number; locks: number;
  cancels: number; payments: number; lastAt: string | null;
}

export function MonitoringPage() {
  const [rows, setRows] = useState<UserActivity[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<{ users: UserActivity[] }>('/api/monitor/users')
      .then((r) => setRows(r.users))
      .catch(() => setErr('تعذّر تحميل بيانات المراقبة'));
  }, []);

  return (
    <div className="card">
      <div className="spread">
        <h3>مراقبة المستخدمين</h3>
        <span className="muted">آخر نشاط لكل مستخدم — من سجل التحركات</span>
      </div>
      {err && <div className="alert err">{err}</div>}
      <table data-mobile="cards">
        <thead>
          <tr>
            <th>المستخدم</th><th>الدور</th><th>الحالة</th>
            <th className="num">دخول</th><th className="num">فواتير</th><th className="num">قفل/فتح</th>
            <th className="num">إلغاء</th><th className="num">دفعات</th><th className="num">إجمالي التحركات</th><th>آخر نشاط</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={10} className="muted">لا بيانات</td></tr>}
          {rows.map((u) => (
            <tr key={u.id}>
              <td data-label="المستخدم"><b>{u.name}</b><div className="muted mono" style={{ fontSize: 12 }}>{u.username}</div></td>
              <td data-label="الدور">{ROLE_LABEL[u.role] ?? u.role}</td>
              <td data-label="الحالة">
                <span className={`badge ${u.active ? 'locked' : 'cancelled'}`}>{u.active ? 'نشِط' : 'موقوف'}</span>
              </td>
              <td className="num" data-label="دخول">{u.logins}</td>
              <td className="num" data-label="فواتير">{u.invoices}</td>
              <td className="num" data-label="قفل/فتح">{u.locks}</td>
              <td className="num" data-label="إلغاء">{u.cancels}</td>
              <td className="num" data-label="دفعات">{u.payments}</td>
              <td className="num" data-label="إجمالي التحركات"><strong>{u.total}</strong></td>
              <td data-label="آخر نشاط">{u.lastAt ? dt(u.lastAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
