import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { SessionUser } from '../types';

interface Branding { hotelName: string; hotelNameEn: string; city: string; logo: string; }

export function Login({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [initialised, setInitialised] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'login' | 'setup'>('login');
  const [branding, setBranding] = useState<Branding | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tenantName, setTenantName] = useState('فندق قاعود سبورتنج');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<{ initialised: boolean }>('/api/bootstrap');
        setInitialised(r.initialised);
        setMode(r.initialised ? 'login' : 'setup');
      } catch { setInitialised(true); }
      try { setBranding(await api.get<Branding>('/api/branding')); } catch { /* branding is optional */ }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (mode === 'setup') {
        await api.post('/api/bootstrap', { tenantName, username, name, password });
      }
      const body = mode === 'setup' ? { username, password } : { username };
      const res = await api.post<{ user: SessionUser }>('/api/auth/login', body);
      onLogin(res.user);
    } catch (e2) {
      const ae = e2 as ApiError;
      const map: Record<string, string> = {
        invalid_credentials: 'اسم المستخدم أو كلمة المرور غير صحيحة',
        already_initialised: 'تم إعداد النظام بالفعل، سجّل الدخول',
        weak_password: 'كلمة المرور ضعيفة (10 أحرف على الأقل مع حرف كبير وصغير ورقم)',
        bad_request: 'بيانات غير صحيحة',
        rate_limited: 'محاولات كثيرة، حاول لاحقًا',
      };
      setErr(map[ae.code] ?? 'حدث خطأ، حاول مرة أخرى');
    } finally { setBusy(false); }
  }

  if (initialised === null) return <div className="login-wrap"><div className="muted">جارٍ التحميل…</div></div>;

  const hotelName = branding?.hotelName || 'فندق قاعود سبورتنج';
  const hotelNameEn = branding?.hotelNameEn || '';
  const initial = hotelName.trim().charAt(0) || 'ق';

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand">
          <div className="logo-badge">
            {branding?.logo
              ? <img src={branding.logo} alt={hotelName} />
              : <span className="mono-name">{initial}</span>}
          </div>
          <h2>{hotelName}</h2>
          <div className="muted">{hotelNameEn || 'نظام الفواتير الإلكترونية والضرائب'}</div>
        </div>

        <h3 className="login-title">{mode === 'setup' ? 'إعداد النظام لأول مرة' : 'تسجيل الدخول'}</h3>
        {err && <div className="alert err">{err}</div>}

        <form onSubmit={submit} className="grid" style={{ gap: 14 }}>
          {mode === 'setup' && (
            <>
              <label className="field">اسم المنشأة
                <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} required />
              </label>
              <label className="field">الاسم الكامل للمسؤول
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
            </>
          )}
          <label className="field">اسم المستخدم
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required dir="ltr" autoFocus />
          </label>
          {mode === 'setup' && (
            <>
              <label className="field">كلمة المرور
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required dir="ltr" />
              </label>
              <div className="muted">يجب أن تكون كلمة المرور 10 أحرف على الأقل وتحتوي حرفًا كبيرًا وصغيرًا ورقمًا.</div>
            </>
          )}
          <button className="btn primary block" disabled={busy} style={{ marginTop: 4, padding: '11px 16px' }}>
            {busy ? '…' : mode === 'setup' ? 'إنشاء الحساب والدخول' : 'دخول'}
          </button>
        </form>

        <div className="login-foot">
          <span className="lock">🔒 محمي — جميع عمليات الدخول والتعديل مسجّلة.</span>
        </div>
      </div>
    </div>
  );
}
