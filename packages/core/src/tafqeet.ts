// Arabic amount-in-words (تفقيط) for invoice totals. Pragmatic grammar: it
// reads naturally for the amounts that appear on hotel invoices without
// attempting full classical number agreement.

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];

function under1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (r >= 10 && r < 20) parts.push(TEENS[r - 10]);
  else {
    const t = Math.floor(r / 10);
    const o = r % 10;
    if (o) parts.push(ONES[o]);
    if (t) parts.push(TENS[t]);
  }
  return parts.join(' و');
}

// one/two/few (3-10)/many (11-99) forms of a scale word (thousand, million).
function scale(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${under1000(n)} ${few}`;
  if (n < 100) return `${under1000(n)} ${many}`;
  return `${under1000(n)} ${one}`;
}

export function arabicInteger(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`tafqeet: unsupported value ${n}`);
  if (n === 0) return 'صفر';
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  if (millions) parts.push(scale(millions, 'مليون', 'مليونان', 'ملايين', 'مليون'));
  if (thousands) parts.push(scale(thousands, 'ألف', 'ألفان', 'آلاف', 'ألف'));
  if (rest) parts.push(under1000(rest));
  return parts.join(' و');
}

export interface TafqeetOptions {
  currency?: string; // pound unit, e.g. "جنيه مصري"
  subunit?: string;  // piastre unit, e.g. "قرش"
}

// Renders a money amount (decimal string or number of EGP) in Arabic words.
export function tafqeet(value: string | number, opts: TafqeetOptions = {}): string {
  const currency = opts.currency ?? 'جنيه مصري';
  const subunit = opts.subunit ?? 'قرش';
  const minor = Math.round(Number(value) * 100);
  const pounds = Math.floor(minor / 100);
  const piastres = minor % 100;

  const segs: string[] = [];
  if (pounds) segs.push(`${arabicInteger(pounds)} ${currency}`);
  if (piastres) segs.push(`${arabicInteger(piastres)} ${subunit}`);

  const body = segs.length ? segs.join(' و') : `صفر ${currency}`;
  return `فقط ${body} لا غير`;
}
