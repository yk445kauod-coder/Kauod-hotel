// Runs in an isolated world before the page loads. It marks the window as the
// desktop shell (so the app asks the server for a Bearer token instead of
// relying on a cross-origin cookie) and hands it the API origin, since a
// bundled page has no same-origin /api proxy to fall back on. It also exposes
// the remote-update bridge so the app can pull a newer web build on demand.
const { contextBridge, ipcRenderer } = require('electron');

const API_BASE = process.env.KAOUD_API_BASE || 'https://kaoud-hotel-api.yk445kauod.workers.dev';

contextBridge.exposeInMainWorld('__KAOUD_DESKTOP__', true);
contextBridge.exposeInMainWorld('__KAOUD_API_BASE__', API_BASE);
contextBridge.exposeInMainWorld('__KAOUD_UPDATER__', {
  check: () => ipcRenderer.invoke('kaoud:check-update'),
  relaunch: () => ipcRenderer.invoke('kaoud:relaunch'),
  status: () => ipcRenderer.invoke('kaoud:update-status'),
});
