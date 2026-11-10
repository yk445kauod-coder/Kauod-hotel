// API client. Credentials travel in HttpOnly cookies; the CSRF token is read
// from the readable csrf cookie and echoed back in the X-CSRF-Token header.
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

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
  const method = (options.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie('kaoud_csrf');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: 'include' });
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
