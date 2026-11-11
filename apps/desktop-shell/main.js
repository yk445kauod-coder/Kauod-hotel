// Electron shell for the Kaoud Hotel app.
//
// The whole web app is bundled into this exe and served from a custom
// `app://kaoud` scheme, so the window opens instantly with no network. The app
// then talks to the Cloudflare Worker API over HTTPS: online it syncs, offline
// it keeps working from its local IndexedDB store (the web app already has the
// outbox + read cache). The API origin is injected at runtime so the same built
// app works both here and on Pages (where it uses the same-origin /api proxy).
//
// REMOTE UPDATES: on every launch the shell checks the deployed web app (the
// Pages site) for a newer build and, when one exists, mirrors it into userData
// and serves from there. The exe therefore only needs rebuilding when the shell
// itself changes — UI/feature updates ship by deploying the web app.
const { app, BrowserWindow, shell, protocol, Menu, dialog, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');

const SCHEME = 'app';
const HOST = 'kaoud';
const API_BASE = process.env.KAOUD_API_BASE || 'https://kaoud-hotel-api.yk445kauod.workers.dev';
const UPDATE_URL = process.env.KAOUD_UPDATE_URL || 'https://kaoud-hotel.pages.dev';
const POLL_MS = 30 * 60 * 1000; // re-check every 30 minutes while running

// Must run before app is ready. Marking the scheme standard + secure gives the
// page a real origin, so localStorage, IndexedDB and fetch all behave.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.txt': 'text/plain', '.map': 'application/json',
};

// Current build root: the downloaded copy in userData when present, otherwise
// the copy bundled in the exe.
let appDir = path.join(__dirname, 'app');

function resolveInDir(baseDir, requestUrl) {
  const parsed = new url.URL(requestUrl);
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const target = path.normalize(path.join(baseDir, pathname));
  if (!target.startsWith(baseDir)) return null;
  return target;
}

// ---------------------------------------------------------------- remote update
const metaFile = () => path.join(app.getPath('userData'), 'web-build.json');
const webDir = () => path.join(app.getPath('userData'), 'web');

function loadMeta() {
  try { return JSON.parse(fs.readFileSync(metaFile(), 'utf8')); } catch { return null; }
}
function saveMeta(m) {
  try { fs.writeFileSync(metaFile(), JSON.stringify(m)); } catch { /* ignore */ }
}

// Download a file, retrying a few times. Returns true on success.
async function download(url, dest, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await net.fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return true;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
}

// Copy every file referenced by index.html that the app needs to boot offline,
// plus the PWA manifest icons (referenced by the manifest, not index.html).
// Best effort: a single missing asset must not abort the update.
function collectAssets(html) {
  const urls = new Set();
  const re = /(?:src|href)="(\/[^"#?]+)"/g;
  let m;
  while ((m = re.exec(html))) urls.add(m[1]);
  for (const extra of ['/icon-192.png', '/icon-512.png']) urls.add(extra);
  return [...urls];
}

async function checkForUpdate({ interactive = false } = {}) {
  let html;
  try {
    const res = await net.fetch(UPDATE_URL + '/index.html?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    html = await res.text();
  } catch (e) {
    if (interactive) dialog.showMessageBox({ type: 'warning', title: 'تعذّر التحديث', message: 'مفيش اتصال بالسيرفر دلوقتي. حاول تاني بعدين.' });
    return { updated: false, error: String(e) };
  }

  const hash = require('crypto').createHash('sha256').update(html).digest('hex');
  const meta = loadMeta();
  if (meta && meta.hash === hash && fs.existsSync(path.join(webDir(), 'index.html'))) {
    return { updated: false, current: true };
  }

  try {
    const dir = webDir();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);

    const assets = collectAssets(html);
    const results = await Promise.allSettled(
      assets.map((a) => download(UPDATE_URL + a, path.join(dir, decodeURIComponent(a)))));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    if (ok === 0 && assets.length > 0) throw new Error('no assets downloaded');

    saveMeta({ hash, at: new Date().toISOString(), assets: assets.length, ok });
    if (interactive) dialog.showMessageBox({ type: 'info', title: 'تم التحديث', message: 'تم تنزيل آخر إصدار. أعد تشغيل البرنامج لتفعيله.' });
    return { updated: true, at: new Date().toISOString() };
  } catch (e) {
    if (interactive) dialog.showMessageBox({ type: 'error', title: 'فشل التحديث', message: String(e) });
    return { updated: false, error: String(e) };
  }
}

// ----------------------------------------------------------------------- window
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f172a',
    title: 'نظام فواتير فندق قاعود',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  win.loadURL(`${SCHEME}://${HOST}/index.html`);

  require('./smoke').attach(win);

  // Open external links (e.g. the InstaPay page) in the system browser, never
  // inside the app window.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });

  return win;
}

function applyPendingUpdate() {
  // Serve the downloaded build if the app is currently on the bundled one.
  const dir = webDir();
  if (fs.existsSync(path.join(dir, 'index.html')) && appDir !== dir) {
    appDir = dir;
    return true;
  }
  return false;
}

app.whenReady().then(() => {
  // Apply an update downloaded on a previous run, then verify the deploy in the
  // background. A downloaded update only takes effect after a restart so the
  // running session is never yanked out from under the user.
  applyPendingUpdate();

  protocol.registerFileProtocol(SCHEME, (request, callback) => {
    const target = resolveInDir(appDir, request.url);
    if (!target) return callback({ error: -6 }); // FILE_NOT_FOUND
    // SPA: any unknown path falls back to index.html (in-memory tabs, no routing).
    const file = fs.existsSync(target) && fs.statSync(target).isFile()
      ? target
      : path.join(appDir, 'index.html');
    callback({ path: file });
  });

  const win = createWindow();

  // Fire-and-forget update check; ignore failures (offline is fine).
  checkForUpdate().catch(() => {});
  setInterval(() => { checkForUpdate().catch(() => {}); }, POLL_MS).unref?.();

  // The web app can trigger an on-demand check and, if one is waiting, restart
  // into it — this is the "تحديث" button the UI can call.
  ipcMain.handle('kaoud:check-update', () => checkForUpdate({ interactive: true }));
  ipcMain.handle('kaoud:relaunch', () => { app.relaunch(); app.exit(0); });
  ipcMain.handle('kaoud:update-status', () => {
    const meta = loadMeta();
    return {
      bundled: path.basename(appDir) === 'app',
      hasUpdate: appDir === webDir() && fs.existsSync(path.join(webDir(), 'index.html')),
      at: meta?.at ?? null,
    };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
