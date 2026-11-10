// Password hashing (PBKDF2-SHA256 via WebCrypto) and random token helpers.
// Never store a password in plaintext; the API only ever persists a hash.

const PBKDF2_ITERATIONS = 150_000;
const KEY_LEN = 32;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password: string, saltHex: string, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_LEN * 8,
  );
  return toHex(bits);
}

export interface PasswordRecord {
  hash: string;
  salt: string;
  iterations: number;
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomHex(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { hash, salt, iterations: PBKDF2_ITERATIONS };
}

export async function verifyPassword(password: string, rec: PasswordRecord): Promise<boolean> {
  const hash = await pbkdf2(password, rec.salt, rec.iterations);
  return timingSafeEqual(hash, rec.hash);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(digest);
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return toHex(sig);
}

export async function verifyHmac(secret: string, data: string, sigHex: string): Promise<boolean> {
  const expected = await hmacHex(secret, data);
  return timingSafeEqual(expected, sigHex);
}

// Password strength: at least 10 chars with mixed classes.
export function passwordIssues(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 10) issues.push('at least 10 characters');
  if (!/[a-z]/.test(pw)) issues.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) issues.push('an uppercase letter');
  if (!/[0-9]/.test(pw)) issues.push('a digit');
  return issues;
}
