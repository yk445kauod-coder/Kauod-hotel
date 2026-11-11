// Electron shell for the Kaoud Hotel app.
//
// The whole web app is bundled into this exe and served from a custom
// `app://kaoud` scheme, so the window opens instantly with no network. The app
// then talks to the Cloudflare Worker API over HTTPS: online it syncs, offline
// it keeps working from its local IndexedDB store (the web app already has the
// outbox + read cache). The API origin is injected at runtime so the same built
// app works both here and on Pages (where it uses the same-origin /api proxy).
const { app, BrowserWindow, shell, protocol, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');

const APP_DIR = path.join(__dirname, 'app');
const SCHEME = 'app';
const HOST = 'kaoud';
const API_BASE = process.env.KAOUD_API_BASE || 'https://kaoud-hotel-api.yk445kauod.workers.dev';

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

function resolveInApp(requestUrl) {
  const parsed = new url.URL(requestUrl);
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  // Normalise and confine to APP_DIR (no path traversal).
  const target = path.normalize(path.join(APP_DIR, pathname));
  if (!target.startsWith(APP_DIR)) return null;
  return target;
}

app.whenReady().then(() => {
  protocol.registerFileProtocol(SCHEME, (request, callback) => {
    const target = resolveInApp(request.url);
    if (!target) return callback({ error: -6 }); // FILE_NOT_FOUND
    // SPA: any unknown path falls back to index.html (in-memory tabs, no routing).
    const file = fs.existsSync(target) && fs.statSync(target).isFile()
      ? target
      : path.join(APP_DIR, 'index.html');
    callback({ path: file });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

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

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
