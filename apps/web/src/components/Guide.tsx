import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionUser } from '../types';
import { Icon, type IconName } from './Icon';

interface GuideItem {
  title: string;
  body: string;
  roles?: SessionUser['role'][];
}

interface GuideSection {
  id: string;
  title: string;
  ico: IconName;
  items: GuideItem[];
  roles?: SessionUser['role'][];
}

const SECTIONS: GuideSection[] = [
  {
    id: 'start',
    title: 'البداية السريعة',
    ico: 'rocket',
    items: [
      { title: 'تسجيل الدخول', body: 'ادخل باسم المستخدم وكلمة المرور. أول مرة فقط تظهر شاشة التهيئة لإنشاء حساب المالك واسم الفندق.' },
      { title: 'لوحة التحكم', body: 'تعرض ملخص اليوم: عدد الفواتير، الإيراد، الضريبة، وأحدث الفواتير. منها تفتح أي فاتورة للطباعة.' },
      { title: 'التنقل', body: 'استخدم القائمة الجانبية على الكمبيوتر، أو الشريط السفلي على الموبايل. زر «+» الأوسط ينشئ فاتورة جديدة فورًا.' },
    ],
  },
  {
    id: 'invoices',
    title: 'الفواتير',
    ico: 'invoice',
    items: [
      { title: 'إنشاء فاتورة', body: 'اضغط «فاتورة جديدة»، اختر النزيل والغرفة، وضبط ليالي الإقامة. يظهر الإجمالي والضريبة والخصم لحظيًا.' },
      { title: 'الطباعة', body: 'من قائمة الفواتير اضغط «طباعة». تُفتح نسخة جاهزة للطابعة الحرارية أو A4.' },
      { title: 'الحالات', body: 'مفتوحة (قابلة للتعديل) → مقفلة (نهائية بعد الإرسال للضرائب) → ملغاة. الفاتورة الملغاة تخرج من الإجماليات.' },
      { title: 'الدفع', body: 'سجّل طريقة الدفع (نقدي / فيزا / إنستاباي / تحويل). الإنستاباي هو القناة الرسمية للمدفوعات.' },
    ],
  },
  {
    id: 'offline',
    title: 'العمل بدون إنترنت والمزامنة',
    ico: 'wifi',
    items: [
      { title: 'الوضع الأوفلاين', body: 'شغّله من أيقونة الواي فاي بالأعلى (يحتاج اتصالًا مرة واحدة لحجز أرقام فواتير). بعدها تقدر تنشئ فواتير بدون إنترنت.' },
      { title: 'مؤشر المزامنة', body: 'شريط بالأعلى يوضح الحالة: أخضر متزامن، أصفر بيانات بانتظار الرفع، أحمر غير متصل. اضغطه للمزامنة اليدوية.' },
      { title: 'حماية الخروج', body: 'لو فيه بيانات لسه مرفوعتش، النظام يرفض تسجيل الخروج أو يرفعها أولًا — عشان ما تضيعش أي فاتورة.' },
      { title: 'القراءة أوفلاين', body: 'آخر قوائم الفواتير والنزلاء محفوظة على الجهاز، فتقدر تشوفها حتى بدون اتصال.' },
    ],
  },
  {
    id: 'directory',
    title: 'الغرف والنزلاء',
    ico: 'hotel',
    items: [
      { title: 'إضافة غرفة', body: 'حدد الرقم والنوع والسعر الليلي والسعة. الأرقام التي أضفتها هي اللي تظهر — مفيش أرقام افتراضية.' },
      { title: 'سجل النزلاء', body: 'احفظ بيانات النزيل لاستخدامها تاني في فاتورة جديدة بسرعة.' },
      { title: 'الحجوزات', body: 'سجّل حجزًا بتاريخ دخول وخروج؛ يتحوّل لفاتورة عند الوصول.' },
    ],
  },
  {
    id: 'reports',
    title: 'التقارير',
    ico: 'reports',
    items: [
      { title: 'كشف المدة', body: 'للمديرين: اختر من/إلى تاريخ واطبع كشف فواتير كامل مع الإجماليات.' },
      { title: 'تصدير Excel', body: 'صدّر سجل الفواتير كملف Excel من أي شاشة فواتير.' },
      { title: 'تقرير اليوم', body: 'من المركز السريع: تقرير سريع بفواتير اليوم.' },
    ],
  },
  {
    id: 'settings',
    title: 'الإعدادات',
    ico: 'settings',
    roles: ['admin', 'manager'],
    items: [
      { title: 'الضرائب والخصم', body: 'حدّد نسبة الضريبة (VAT) والخصم، وهل الأسعار شاملة الضريبة أم لا.' },
      { title: 'الهوية', body: 'اسم الفندق، الشعار، الرقم الضريبي، العنوان — تظهر على الفاتورة.' },
      { title: 'أرقام الفواتير', body: 'من شاشة «أرقام الفواتير» تقدر تخصّص الرقم التالي للفاتورة القادمة.' },
    ],
  },
  {
    id: 'users',
    title: 'المستخدمون والصلاحيات',
    ico: 'users',
    roles: ['admin', 'manager'],
    items: [
      { title: 'الأدوار', body: 'المالك/المدير (كل شيء)، الاستقبال (إنشاء فواتير)، وأدوار أخرى للقراءة فقط.' },
      { title: 'إضافة مستخدم', body: 'من شاشة المستخدمين: أضف اسمًا وكلمة مرور ودورًا، وتقدر توقف أي حساب فورًا.' },
      { title: 'سجل النشاط', body: 'كل عملية مهمة مسجّلة باسم المستخدم ووقتها في «سجل النشاط».' },
    ],
  },
  {
    id: 'keys',
    title: 'اختصارات لوحة المفاتيح',
    ico: 'keyboard',
    items: [
      { title: '؟ (Shift + /)', body: 'افتح هذا الدليل في أي وقت.' },
      { title: 'Esc', body: 'أغلق الدليل أو أي نافذة مفتوحة.' },
      { title: 'المركز السريع', body: 'اضغط الزر العائم أعلى الشاشة للوصول السريع للاختصارات والإجراءات.' },
    ],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  user: SessionUser;
}

export function Guide({ open, onClose, user }: Props) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => { if (open) setQ(''); }, [open]);

  const sections = useMemo(() => {
    const allowed = SECTIONS.filter((s) => !s.roles || s.roles.includes(user.role));
    const needle = q.trim();
    if (!needle) return allowed;
    return allowed
      .map((s) => ({
        ...s,
        items: s.items.filter((i) => i.title.includes(needle) || i.body.includes(needle) || s.title.includes(needle)),
      }))
      .filter((s) => s.items.length > 0);
  }, [q, user.role]);

  if (!open) return null;

  return (
    <div className="guide-scrim no-print" onClick={onClose} role="presentation">
      <div className="guide" ref={ref} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="الدليل">
        <div className="guide-head">
          <div>
            <h2>الدليل السريع</h2>
            <p className="muted">كل اللي تحتاجه لاستخدام النظام — ابحث في أي وقت.</p>
          </div>
          <button className="qc-x" onClick={onClose} aria-label="إغلاق"><Icon name="close" size={18} /></button>
        </div>
        <input
          className="guide-search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث… مثال: أوفلاين، طباعة، ضريبة"
          aria-label="بحث في الدليل"
        />
        <div className="guide-body">
          {sections.length === 0 && <div className="muted" style={{ padding: 16 }}>مفيش نتائج — جرّب كلمة تانية.</div>}
          {sections.map((s) => (
            <section key={s.id} className="guide-sec">
              <h3><span className="ico"><Icon name={s.ico} size={16} /></span>{s.title}</h3>
              <div className="guide-items">
                {s.items.map((it) => (
                  <article key={it.title} className="guide-item">
                    <h4>{it.title}</h4>
                    <p>{it.body}</p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="guide-foot">
          افتح الدليل في أي وقت بالضغط على «؟» — أو من زر «الدليل» في المركز السريع.
        </div>
      </div>
    </div>
  );
}
