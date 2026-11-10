export function egp(v: string | number): string {
  const n = typeof v === 'number' ? v : Number(v || 0);
  return n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function egpEn(v: string | number): string {
  const n = typeof v === 'number' ? v : Number(v || 0);
  return n.toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  const d1 = Date.parse(a + 'T00:00:00Z');
  const d2 = Date.parse(b + 'T00:00:00Z');
  if (Number.isNaN(d1) || Number.isNaN(d2)) return 0;
  return Math.max(0, Math.round((d2 - d1) / 86_400_000));
}

export function dt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

export function d(iso: string | null): string {
  if (!iso) return '—';
  const dt2 = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  if (Number.isNaN(dt2.getTime())) return iso;
  return dt2.toLocaleDateString('ar-EG', { dateStyle: 'medium' });
}

export const STATUS_LABEL: Record<string, string> = {
  draft: 'مسودة', open: 'مفتوحة', locked: 'مقفلة', cancelled: 'ملغاة',
};

export const ETA_LABEL: Record<string, string> = {
  unconfigured: 'غير مفعّل', queued: 'في الانتظار', queued_unconfigured: 'في الانتظار (غير مُهيأ)',
  submitted: 'تم الإرسال', accepted: 'مقبولة', rejected: 'مرفوضة', failed: 'فشل',
};

export const PAY_LABEL: Record<string, string> = {
  cash: 'نقدي', card: 'بطاقة', instapay: 'إنستاباي', bank_transfer: 'تحويل بنكي', other: 'أخرى',
};

export const ROLE_LABEL: Record<string, string> = {
  admin: 'مدير النظام', manager: 'مدير', reception: 'استقبال', accountant: 'محاسب',
};
