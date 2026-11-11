// API client. In a browser, credentials travel in HttpOnly cookies and the
// CSRF token is read from the readable csrf cookie and echoed back in the
// X-CSRF-Token header. Inside the desktop shell the cookie cannot cross origins,
// so the shell stores a Bearer token instead and this client sends it — the two
// paths are mutually exclusive, chosen by whether a token is present.
const API_BASE = (() => {
  // The desktop shell injects the API origin at runtime; a bundled page has no
  // same-origin /api proxy, so this must win over the build-time value.
  const injected = (globalThis as { __KAOUD_API_BASE__?: string }).__KAOUD_API_BASE__;
  const base = injected ?? (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
  return base.replace(/\/$/, '');
})();

const TOKEN_KEY = 'kaoud_token';

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}
export function setToken(token: string | null): void {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
// True inside the desktop shell. The shell sets `window.__KAOUD_DESKTOP__` before
// the app boots, so even the very first login (no token yet) asks for a token.
export function isDesktopShell(): boolean {
  try { return (window as unknown as { __KAOUD_DESKTOP__?: boolean }).__KAOUD_DESKTOP__ === true; } catch { return false; }
}

function readCookie(name: string): string {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, public details?: unknown) {
    super(code);
  }
}

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  opKey?: string;
}

async function request<T>(path: string, options: RequestInit = {}, opKey?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (opKey) headers.set('X-Op-Key', opKey);
  const token = getToken();
  const desktop = isDesktopShell();
  const method = (options.method ?? 'GET').toUpperCase();
  if (token) {
    // Desktop shell: explicit Bearer token, no cookies, no CSRF (the token is
    // not ambient, so the server skips the double-submit check).
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (desktop) headers.set('X-Client', 'desktop');
  if (!token && !desktop && method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie('kaoud_csrf');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options, headers, credentials: token || desktop ? 'omit' : 'include',
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `http_${res.status}`, body?.details ?? body);
  }
  return body as T;
}

// Generic request used by the offline outbox; the opKey makes the write
// idempotent on the server so a replay never duplicates it.
function requestOp<T>(path: string, opts: ApiRequestOptions): Promise<T> {
  return request<T>(
    path,
    { method: opts.method ?? 'POST', body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
    opts.opKey,
  );
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(p: string, body?: unknown) => request<T>(p, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(p: string, body?: unknown) => request<T>(p, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
  request: requestOp,
};
