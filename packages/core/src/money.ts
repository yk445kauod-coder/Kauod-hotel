// All monetary amounts are handled as integer minor units (piastres, 1 EGP = 100)
// to avoid floating point drift. Parsing accepts strings/numbers with up to 2dp.

export type Minor = number;

export function parseMoney(input: unknown): Minor {
  if (input === null || input === undefined || input === '') return 0;
  const s = String(input).trim().replace(/,/g, '');
  if (!/^-?\d*(\.\d*)?$/.test(s)) throw new Error(`Invalid money value: ${input}`);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [intPart = '0', fracPart = ''] = body.split('.');
  const frac2 = (fracPart + '00').slice(0, 2);
  const third = fracPart.length > 2 ? Number(fracPart[2]) : 0;
  let minor = Number(intPart || '0') * 100 + Number(frac2 || '0');
  if (third >= 5) minor += 1; // round half up on the third decimal
  return neg ? -minor : minor;
}

export function formatMoney(minor: Minor): string {
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${neg ? '-' : ''}${whole}.${String(cents).padStart(2, '0')}`;
}

// round half up for a*b/c in integer space
export function mulDiv(a: number, b: number, c: number): number {
  const prod = a * b;
  const q = Math.floor(prod / c);
  const r = prod - q * c;
  if (r * 2 >= c) return q + 1;
  return q;
}

export function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

export function sum(...xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
