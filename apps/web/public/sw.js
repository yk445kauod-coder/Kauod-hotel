// Service worker: keeps the whole app shell (HTML, hashed JS/CSS, fonts, logo)
// usable offline. API calls are never cached — offline reads/writes go through
// the IndexedDB cache/outbox in the app instead, so stale data is never served.
const CACHE = 'kaoud-shell-v4';
const CORE = [
  '/', '/index.html', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/favicon.png', '/apple-touch-icon.png',
  '/fonts/fonts.css',
];

// Cache every URL individually so one 404 (e.g. an asset dropped by a redeploy)
// cannot reject the whole install the way addAll() would.
async function addAll(cache, urls) {
  await Promise.all(urls.map(async (u) => {
    try { await cache.add(new Request(u, { cache: 'reload' })); } catch { /* skip */ }
  }));
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await addAll(cache, CORE);
    // Precache the exact build output from the manifest Vite emits. This covers
    // every hashed asset, including lazy-loaded chunks (the dashboard charts)
    // that no HTML file references — a static list would miss them and always
    // be stale, since the hashes change on every build.
    try {
      const res = await fetch(new Request('/precache-manifest.json', { cache: 'reload' }));
      // Clone before reading the body: a Response body can be consumed once.
      const urls = await res.clone().json();
      await cache.put('/precache-manifest.json', res);
      await addAll(cache, [...new Set(urls)].filter((u) => typeof u === 'string' && u !== '/sw.js'));
    } catch {
      // No manifest (older build): fall back to the assets referenced by the
      // current index.html so a fresh install can still boot offline.
      try {
        const res = await fetch(new Request('/index.html', { cache: 'reload' }));
        const html = await res.clone().text();
        await cache.put('/index.html', res);
        const urls = [...html.matchAll(/(?:src|href)="(\/(?:assets|fonts)\/[^"]+)"/g)].map((m) => m[1]);
        await addAll(cache, [...new Set(urls)]);
      } catch { /* offline install: CORE still covers the shell */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache the API: offline reads/writes are handled in the app layer.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first (fresh HTML when online), fall back to the
  // cached shell so the SPA still boots offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) (await caches.open(CACHE)).put('/index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('/index.html')) ?? (await caches.match('/')) ?? Response.error();
      }
    })());
    return;
  }

  // Static assets (hashed JS/CSS, fonts, logo): cache first, then network, and
  // populate the cache on the way through.
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  })());
});
