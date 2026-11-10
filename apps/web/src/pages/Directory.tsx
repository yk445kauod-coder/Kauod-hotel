import { useState } from 'react';
import { newId } from '@kaoud/core';
import { ApiError } from '../api';
import type { SessionUser, Room, Guest, Reservation } from '../types';
import { egp, d, today, addDays, nightsBetween } from '../format';
import { useCachedList } from '../useCachedList';
import { cacheAppend } from '../cache';
import { mutate } from '../outbox';

const RES_STATUS: Record<string, string> = { booked: 'محجوز', checked_in: 'داخل', checked_out: 'خرج', cancelled: 'ملغى' };

export function DirectoryPage({ user }: { user: SessionUser }) {
  const canWrite = ['admin', 'manager', 'reception'].includes(user.role);
  const roomsQ = useCachedList<{ rooms: Room[] }>('rooms', '/api/rooms');
  const guestsQ = useCachedList<{ guests: Guest[] }>('guests', '/api/guests');
  const resQ = useCachedList<{ reservations: Reservation[] }>('reservations', '/api/reservations');
  const rooms = roomsQ.data?.rooms ?? [];
  const guests = guestsQ.data?.guests ?? [];
  const res = resQ.data?.reservations ?? [];
  const [err, setErr] = useState('');
  const [roomForm, setRoomForm] = useState({ number: '', type: 'غرفة مزدوجة', nightlyRate: '', capacity: 2 });
  const [resForm, setResForm] = useState({ guestName: '', roomNumber: '', checkIn: today(), checkOut: addDays(today(), 1), nightlyRate: '' });

  async function addRoom(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const id = newId('room');
    const row = { id, number: roomForm.number, type: roomForm.type, nightly_rate: (Number(roomForm.nightlyRate) || 0).toFixed(2), capacity: Number(roomForm.capacity) || 2, active: 1 };
    try {
      const r = await mutate({ method: 'POST', path: '/api/rooms', label: `غرفة ${roomForm.number}`, body: { id, number: roomForm.number, type: roomForm.type, nightlyRate: Number(roomForm.nightlyRate) || 0, capacity: Number(roomForm.capacity) || 2, active: true } });
      if (r.queued) await cacheAppend('rooms', row); else await roomsQ.reload();
      setRoomForm({ number: '', type: 'غرفة مزدوجة', nightlyRate: '', capacity: 2 });
    } catch (e2) { setErr(`تعذّر إضافة الغرفة (${(e2 as ApiError).code})`); }
  }

  async function addReservation(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const id = newId('res');
    const row = { id, guest_name: resForm.guestName, room_number: resForm.roomNumber, check_in: resForm.checkIn, check_out: resForm.checkOut, nightly_rate: (Number(resForm.nightlyRate) || 0).toFixed(2), status: 'booked' };
    try {
      const r = await mutate({ method: 'POST', path: '/api/reservations', label: `حجز ${resForm.guestName}`, body: { id, guestName: resForm.guestName, roomNumber: resForm.roomNumber, checkIn: resForm.checkIn, checkOut: resForm.checkOut, nightlyRate: Number(resForm.nightlyRate) || 0 } });
      if (r.queued) await cacheAppend('reservations', row); else await resQ.reload();
      setResForm({ guestName: '', roomNumber: '', checkIn: today(), checkOut: addDays(today(), 1), nightlyRate: '' });
    } catch (e2) { setErr(`تعذّر إضافة الحجز (${(e2 as ApiError).code})`); }
  }

  async function setResStatus(id: string, status: string) {
    try {
      await mutate({ method: 'PATCH', path: `/api/reservations/${id}`, label: 'تحديث حالة حجز', body: { status } });
      await resQ.reload();
    } catch (e) { setErr(`تعذّر التحديث (${(e as ApiError).code})`); }
  }

  const stale = roomsQ.fromCache || guestsQ.fromCache || resQ.fromCache;
  return (
    <>
      {stale && <div className="alert warn">أنت غير متصل — تُعرض بيانات آخر اتصال، وأي إضافة ستُزامَن عند عودة الشبكة.</div>}
      {err && <div className="alert err">{err}</div>}

      {canWrite && (
        <div className="card">
          <h3>إضافة غرفة</h3>
          <form onSubmit={addRoom} className="grid cols-4">
            <label className="field">رقم الغرفة<input dir="ltr" value={roomForm.number} onChange={(e) => setRoomForm({ ...roomForm, number: e.target.value })} required /></label>
            <label className="field">النوع<input value={roomForm.type} onChange={(e) => setRoomForm({ ...roomForm, type: e.target.value })} /></label>
            <label className="field">سعر الليلة<input type="number" dir="ltr" value={roomForm.nightlyRate} onChange={(e) => setRoomForm({ ...roomForm, nightlyRate: e.target.value })} /></label>
            <label className="field">السعة<input type="number" dir="ltr" value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: Number(e.target.value) })} /></label>
            <div className="row end" style={{ gridColumn: '1 / -1' }}><button className="btn primary">إضافة</button></div>
          </form>
        </div>
      )}

      <div className="card">
        <h3>الغرف ({rooms.length})</h3>
        <table data-mobile="cards">
          <thead><tr><th>الرقم</th><th>النوع</th><th className="num">سعر الليلة</th><th className="num">السعة</th><th>الحالة</th></tr></thead>
          <tbody>
            {rooms.length === 0 && <tr><td colSpan={5} className="muted">لا توجد غرف</td></tr>}
            {rooms.map((r) => (
              <tr key={r.id}><td className="mono" data-label="الرقم">{r.number}</td><td data-label="النوع">{r.type}</td><td className="num" data-label="سعر الليلة">{egp(r.nightly_rate)}</td><td className="num" data-label="السعة">{r.capacity}</td>
                <td data-label="الحالة">{r.active ? <span className="badge locked">مفعّلة</span> : <span className="badge cancelled">معطّلة</span>}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <div className="card">
          <h3>حجز جديد</h3>
          <form onSubmit={addReservation} className="grid cols-4">
            <label className="field">اسم النزيل<input value={resForm.guestName} onChange={(e) => setResForm({ ...resForm, guestName: e.target.value })} required /></label>
            <label className="field">الغرفة
              <select value={resForm.roomNumber} onChange={(e) => setResForm({ ...resForm, roomNumber: e.target.value })}>
                <option value="">—</option>
                {rooms.map((r) => <option key={r.id} value={r.number}>{r.number} ({r.type})</option>)}
              </select>
            </label>
            <label className="field">الدخول<input type="date" value={resForm.checkIn} onChange={(e) => setResForm({ ...resForm, checkIn: e.target.value })} /></label>
            <label className="field">الخروج<input type="date" value={resForm.checkOut} onChange={(e) => setResForm({ ...resForm, checkOut: e.target.value })} /></label>
            <label className="field">سعر الليلة<input type="number" dir="ltr" value={resForm.nightlyRate} onChange={(e) => setResForm({ ...resForm, nightlyRate: e.target.value })} /></label>
            <div className="row end" style={{ gridColumn: '1 / -1' }}>
              <span className="muted">عدد الليالي: {nightsBetween(resForm.checkIn, resForm.checkOut)}</span>
              <button className="btn primary">حجز</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <h3>الحجوزات</h3>
        <table data-mobile="cards">
          <thead><tr><th>النزيل</th><th>الغرفة</th><th>الدخول</th><th>الخروج</th><th className="num">السعر</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            {res.length === 0 && <tr><td colSpan={7} className="muted">لا حجوزات</td></tr>}
            {res.map((r) => (
              <tr key={r.id}>
                <td data-label="النزيل">{r.guest_name}</td><td className="mono" data-label="الغرفة">{r.room_number || '—'}</td><td data-label="الدخول">{d(r.check_in)}</td><td data-label="الخروج">{d(r.check_out)}</td>
                <td className="num" data-label="السعر">{egp(r.nightly_rate)}</td>
                <td data-label="الحالة"><span className="badge open">{RES_STATUS[r.status] ?? r.status}</span></td>
                <td data-label="">{canWrite && (
                  <select value={r.status} onChange={(e) => setResStatus(r.id, e.target.value)} style={{ padding: 5, border: '1px solid var(--border)', borderRadius: 6 }}>
                    {Object.entries(RES_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>سجل النزلاء ({guests.length})</h3>
        <table data-mobile="cards">
          <thead><tr><th>الاسم</th><th>الهاتف</th><th>البريد</th><th>الرقم الضريبي</th></tr></thead>
          <tbody>
            {guests.length === 0 && <tr><td colSpan={4} className="muted">لا نزلاء مسجّلون</td></tr>}
            {guests.map((g) => <tr key={g.id}><td data-label="الاسم">{g.name}</td><td className="mono" data-label="الهاتف">{g.phone || '—'}</td><td className="mono" data-label="البريد">{g.email || '—'}</td><td className="mono" data-label="الرقم الضريبي">{g.tax_id || '—'}</td></tr>)}
          </tbody>
        </table>
      </div>
    </>
  );
}
