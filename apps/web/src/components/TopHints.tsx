import { useEffect, useState } from 'react';

interface Hint { ico: string; text: string; }

const HINTS: Hint[] = [
  { ico: '🧾', text: 'اعمل فاتورة جديدة من زر «+» في منتصف الشريط السفلي.' },
  { ico: '📶', text: 'فعّل الوضع الأوفلاين قبل الخروج من الفندق عشان تكمل شغل بدون إنترنت.' },
  { ico: '🟡', text: 'لو شفت «بانتظار الرفع» بالأعلى، اضغط المؤشر للمزامنة اليدوية.' },
  { ico: '🏨', text: 'أضف غرفك بنفسك من «الغرف والنزلاء» — مفيش أرقام افتراضية.' },
  { ico: '⌨️', text: 'اضغط «؟» في أي وقت لفتح الدليل السريع.' },
  { ico: '💾', text: 'خد نسخة احتياطية من المركز السريع (زر «النسخة الاحتياطية»).' },
];

const HIDE_KEY = 'kaoud.hints.hidden';

interface Props {
  onOpenGuide: () => void;
}

export function TopHints({ onOpenGuide }: Props) {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
  });
  const [i, setI] = useState(() => Math.floor(Math.random() * HINTS.length));

  useEffect(() => {
    if (hidden) return;
    const t = setInterval(() => setI((n) => (n + 1) % HINTS.length), 9000);
    return () => clearInterval(t);
  }, [hidden]);

  if (hidden) return null;

  const hint = HINTS[i];
  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* ignore */ }
  };

  return (
    <div className="hint-bar no-print" role="status">
      <span className="hint-ico" aria-hidden="true">{hint.ico}</span>
      <span className="hint-text" key={i}>{hint.text}</span>
      <div className="hint-actions">
        <button className="hint-nav" onClick={() => setI((n) => (n - 1 + HINTS.length) % HINTS.length)} aria-label="السابق">‹</button>
        <button className="hint-nav" onClick={() => setI((n) => (n + 1) % HINTS.length)} aria-label="التالي">›</button>
        <button className="hint-guide" onClick={onOpenGuide}>الدليل</button>
        <button className="hint-x" onClick={dismiss} aria-label="إخفاء النصائح">✕</button>
      </div>
    </div>
  );
}
