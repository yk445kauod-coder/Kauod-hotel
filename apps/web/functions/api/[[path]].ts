// Same-origin API proxy.
//
// The SPA and the API live on different hosts (pages.dev vs workers.dev), so a
// direct browser fetch would be cross-site — and modern browsers block the
// session cookie there (third-party cookie). Routing /api/* through this Pages
// Function keeps every request same-origin, so the cookie is first-party.

type PagesContext = {
  request: Request;
  env: Record<string, string | undefined>;
};

const DEFAULT_API = 'https://kaoud-hotel-api.yk445kauod.workers.dev';

export const onRequest = async (ctx: PagesContext): Promise<Response> => {
  const api = (ctx.env.API_ORIGIN || DEFAULT_API).replace(/\/$/, '');
  const url = new URL(ctx.request.url);
  const target = `${api}${url.pathname}${url.search}`;

  const headers = new Headers(ctx.request.headers);
  headers.delete('host');
  headers.delete('content-length');

  const method = ctx.request.method;
  const init: RequestInit = { method, headers, redirect: 'manual' };
  if (method !== 'GET' && method !== 'HEAD') init.body = ctx.request.body;

  return fetch(target, init);
};
