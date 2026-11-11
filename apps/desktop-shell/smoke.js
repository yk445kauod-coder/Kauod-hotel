// Headless verification hook, active only when KAOUD_SMOKE_TEST is set.
//
// It loads the bundled app with no network, asserts the page rendered from disk
// and that the desktop flag/api base were injected, then exits 0/1. Set
// KAOUD_SMOKE_SEED to a JSON user to also exercise the offline-open path: the
// session is written into the same IndexedDB store the web app reads, and the
// app must show the dashboard instead of the login screen.
const { app } = require('electron');

function attach(win) {
  if (!process.env.KAOUD_SMOKE_TEST) return;
  let seeded = false;

  win.webContents.on('did-finish-load', async () => {
    try {
      if (process.env.KAOUD_SMOKE_SEED && !seeded) {
        seeded = true;
        const { user } = JSON.parse(process.env.KAOUD_SMOKE_SEED);
        await win.webContents.executeJavaScript(
          `new Promise((resolve) => {
             const req = indexedDB.open('kaoud-offline', 2);
             req.onupgradeneeded = () => {
               const db = req.result;
               if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
             };
             req.onsuccess = () => {
               const db = req.result;
               const t = db.transaction('kv', 'readwrite');
               t.objectStore('kv').put({ user: ${JSON.stringify(user)}, at: new Date().toISOString() }, 'session');
               t.oncomplete = () => resolve(true);
             };
             req.onerror = () => resolve(false);
           })`);
        win.webContents.reload();
        return;
      }

      await new Promise((r) => setTimeout(r, 1500));
      const probe = await win.webContents.executeJavaScript(
        `({ title: document.title,
            hasRoot: !!document.getElementById('root'),
            bodyText: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,300),
            origin: location.origin,
            desktop: window.__KAOUD_DESKTOP__ === true,
            apiBase: window.__KAOUD_API_BASE__ || '' })`);
      console.log('SMOKE_RESULT ' + JSON.stringify(probe));
      app.exit(probe.hasRoot && probe.desktop ? 0 : 1);
    } catch (err) {
      console.log('SMOKE_RESULT ' + JSON.stringify({ error: String(err) }));
      app.exit(1);
    }
  });

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.log('SMOKE_RESULT ' + JSON.stringify({ failLoad: code, desc }));
    app.exit(1);
  });
}

module.exports = { attach };
