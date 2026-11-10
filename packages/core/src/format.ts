export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isValidIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export function formatSerial(prefix: string, serial: number, pad = 5): string {
  return `${prefix}${String(serial).padStart(pad, '0')}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

// Convert a stored UTC timestamp to a local ETA date-time string (no timezone suffix)
export function etaDateTime(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}
