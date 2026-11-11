import { useState } from 'react';
import { d } from '../format';
import { useCachedList } from '../useCachedList';
import type { DirectoryName } from '../types';

// The guest directory is derived from invoices: every distinct name on an
// ACTIVE (non-cancelled) invoice. There is no separate room/guest/reservation
// data to maintain — the register is the single source of truth.
export function DirectoryPage() {
  const q = useCachedList<{ names: DirectoryName[] }>('directory-names', '/api/directory/names');
  const names = q.data?.names ?? [];
  const [filter, setFilter] = useState('');
  const shown = filter.trim()
    ? names.filter((n) => n.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : names;

  return (
    <>
      {q.fromCache && <div className="alert warn">أنت غير متصل — تُعرض أسماء آخر اتصال.</div>}
      <div className="card">
        <div className="spread">
          <h3>النزلاء ({names.length})</h3>
          <input
            placeholder="بحث بالاسم"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, minWidth: 220 }}
          />
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          الأسماء المستخرجة من الفواتير السليمة (غير الملغاة) — تتحدث تلقائيًا مع كل فاتورة.
        </div>
        <table data-mobile="cards">
          <thead><tr><th>الاسم</th><th className="num">عدد الفواتير</th><th>آخر فاتورة</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={3} className="muted">لا أسماء بعد — تظهر هنا أول ما تُنشئ فاتورة.</td></tr>}
            {shown.map((n) => (
              <tr key={n.name}>
                <td data-label="الاسم">{n.name}</td>
                <td className="num" data-label="عدد الفواتير">{n.invoices}</td>
                <td data-label="آخر فاتورة">{n.last_issued ? d(n.last_issued) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
