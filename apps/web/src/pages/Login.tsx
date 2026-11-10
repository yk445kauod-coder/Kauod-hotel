import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { SessionUser } from '../types';

export function Login({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [initialised, setInitialised] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'login' | 'setup'>('login');
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
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (mode === 'setup') {
        await api.post('/api/bootstrap', { tenantName, username, name, password });
      }
      const res = await api.post<{ user: SessionUser }>('/api/auth/login', { username, password });
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

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand">
          <h2 style={{ margin: 0 }}>فندق قاعود سبورتنج</h2>
          <div className="muted">نظام الفواتير الإلكترونية والضرائب</div>
        </div>
        <h3 style={{ textAlign: 'center', marginTop: 16 }}>{mode === 'setup' ? 'إعداد النظام لأول مرة' : 'تسجيل الدخول'}</h3>
        {err && <div className="alert err">{err}</div>}
        <form onSubmit={submit} className="grid" style={{ gap: 12 }}>
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
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required dir="ltr" />
          </label>
          <label className="field">كلمة المرور
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} required dir="ltr" />
          </label>
          {mode === 'setup' && <div className="muted">يجب أن تكون كلمة المرور 10 أحرف على الأقل وتحتوي حرفًا كبيرًا وصغيرًا ورقمًا.</div>}
          <button className="btn primary" disabled={busy}>{busy ? '…' : mode === 'setup' ? 'إنشاء الحساب والدخول' : 'دخول'}</button>
        </form>
        <div className="muted" style={{ textAlign: 'center', marginTop: 12 }}>
          محمي — جميع عمليات الدخول والتعديل مسجّلة.
        </div>
      </div>
    </div>
  );
}
