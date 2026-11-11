import { useEffect, useState } from 'react';

interface Updater {
  check: () => Promise<{ updated: boolean; current?: boolean; error?: string }>;
  relaunch: () => Promise<void>;
  status: () => Promise<{ bundled: boolean; hasUpdate: boolean; at: string | null }>;
}

const updater = (): Updater | null =>
  (window as unknown as { __KAOUD_UPDATER__?: Updater }).__KAOUD_UPDATER__ ?? null;

// Desktop-shell only: lets the user pull the newest web build that was deployed
// to Pages without reinstalling the exe. Hidden in the browser (there, a normal
// reload already gets the latest deploy).
export function UpdaterCard() {
  const [info, setInfo] = useState<{ bundled: boolean; hasUpdate: boolean; at: string | null } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const bridge = updater();
  useEffect(() => { bridge?.status().then(setInfo).catch(() => {}); }, [bridge]);
  if (!bridge) return null;

  async function check() {
    setBusy(true); setMsg('');
    try {
      const r = await bridge!.check();
      if (r.error) setMsg('تعذّر التحقق — تأكد من الاتصال بالإنترنت.');
      else if (r.updated) { setMsg('تم تنزيل آخر إصدار. اقفل البرنامج وافتحه تاني لتفعيله.'); setInfo(await bridge!.status()); }
      else setMsg('أنت على آخر إصدار.');
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h3>تحديث البرنامج</h3>
      <p className="muted" style={{ marginTop: -6 }}>
        {info?.hasUpdate
          ? `مشغّل نسخة محدّثة نُزّلت بتاريخ ${info.at ? info.at.slice(0, 10) : '—'}.`
          : 'مشغّل النسخة المدمجة مع البرنامج.'}
      </p>
      <div className="row">
        <button className="btn" onClick={check} disabled={busy}>{busy ? 'جارٍ التحقق…' : 'التحقق من التحديث'}</button>
        {info?.hasUpdate && <button className="btn primary" onClick={() => bridge!.relaunch()}>إعادة التشغيل</button>}
      </div>
      {msg && <div className="alert" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  );
}
