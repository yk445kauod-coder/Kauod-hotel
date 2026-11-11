import { useEffect, useState } from 'react';
import { Icon, type IconName } from './Icon';

interface Hint { ico: IconName; text: string; }

const HINTS: Hint[] = [
  { ico: 'invoice', text: 'اعمل فاتورة جديدة من زر «+» في منتصف الشريط السفلي.' },
  { ico: 'wifi', text: 'فعّل الوضع الأوفلاين قبل الخروج من الفندق عشان تكمل شغل بدون إنترنت.' },
  { ico: 'statusWarn', text: 'لو شفت «بانتظار الرفع» بالأعلى، اضغط المؤشر للمزامنة اليدوية.' },
  { ico: 'hotel', text: 'أضف غرفك بنفسك من «الغرف والنزلاء» — مفيش أرقام افتراضية.' },
  { ico: 'keyboard', text: 'اضغط «؟» في أي وقت لفتح الدليل السريع.' },
  { ico: 'save', text: 'خد نسخة احتياطية من المركز السريع (زر «النسخة الاحتياطية»).' },
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
      <span className="hint-ico" aria-hidden="true"><Icon name={hint.ico} size={16} /></span>
      <span className="hint-text" key={i}>{hint.text}</span>
      <div className="hint-actions">
        <button className="hint-nav" onClick={() => setI((n) => (n - 1 + HINTS.length) % HINTS.length)} aria-label="السابق"><Icon name="chevronRight" size={16} /></button>
        <button className="hint-nav" onClick={() => setI((n) => (n + 1) % HINTS.length)} aria-label="التالي"><Icon name="chevronLeft" size={16} /></button>
        <button className="hint-guide" onClick={onOpenGuide}>الدليل</button>
        <button className="hint-x" onClick={dismiss} aria-label="إخفاء النصائح"><Icon name="close" size={16} /></button>
      </div>
    </div>
  );
}
