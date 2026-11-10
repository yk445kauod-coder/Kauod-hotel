import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AuditEntry } from '../types';
import { dt } from '../format';

const ACTION_LABEL: Record<string, string> = {
  'login': 'تسجيل دخول', 'logout': 'تسجيل خروج', 'password_change': 'تغيير كلمة مرور',
  'bootstrap': 'تهيئة النظام', 'invoice.create': 'إنشاء فاتورة', 'invoice.update': 'تعديل فاتورة',
  'invoice.lock': 'قفل فاتورة', 'invoice.unlock': 'فتح قفل فاتورة', 'invoice.cancel': 'إلغاء فاتورة',
  'payment.create': 'تسجيل دفعة', 'payment.delete': 'حذف دفعة', 'user.create': 'إضافة مستخدم',
  'user.update': 'تعديل مستخدم', 'user.delete': 'حذف مستخدم', 'settings.update': 'تعديل الإعدادات',
  'serial.update': 'تعديل الترقيم', 'eta.submit': 'إرسال للضرائب', 'room.create': 'إضافة غرفة',
  'room.update': 'تعديل غرفة', 'room.delete': 'حذف غرفة', 'guest.create': 'إضافة نزيل',
  'reservation.create': 'إضافة حجز', 'reservation.status': 'تغيير حالة حجز',
};

export function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get<{ entries: AuditEntry[] }>('/api/audit?limit=300')
      .then((r) => setRows(r.entries))
      .catch(() => setErr('تعذّر تحميل السجل'));
  }, []);

  return (
    <div className="card">
      <h3>سجل النشاط</h3>
      {err && <div className="alert err">{err}</div>}
      <table>
        <thead><tr><th>التاريخ</th><th>الإجراء</th><th>الكيان</th><th>المعرّف</th><th>IP</th><th>التفاصيل</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="muted">لا سجلات</td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{dt(r.created_at)}</td>
              <td>{ACTION_LABEL[r.action] ?? r.action}</td>
              <td className="mono">{r.entity}</td>
              <td className="mono">{r.entity_id?.slice(0, 16) ?? '—'}</td>
              <td className="mono">{r.ip ?? '—'}</td>
              <td className="muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.detail || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
