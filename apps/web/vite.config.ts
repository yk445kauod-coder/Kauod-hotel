import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Emits `precache-manifest.json` listing every file in the build output. The
// service worker and the desktop shell's updater read it so a lazy-loaded chunk
// (e.g. the dashboard charts, which no HTML file references) is cached too —
// otherwise the app boots offline but the charts screen fails.
function precacheManifest() {
  return {
    name: 'kaoud-precache-manifest',
    apply: 'build' as const,
    closeBundle() {
      const outDir = path.resolve(rootDir, 'dist');
      const files: string[] = [];
      const walk = (dir: string, base: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(dir, e.name), `${base}${e.name}/`);
          // Skip the manifest itself and host config files (`_headers`,
          // `_redirects`) which Pages consumes and does not serve as assets.
          else if (e.name !== 'precache-manifest.json' && !(base === '' && e.name.startsWith('_')))
            files.push(`/${base}${e.name}`);
        }
      };
      if (fs.existsSync(outDir)) {
        walk(outDir, '');
        fs.writeFileSync(path.join(outDir, 'precache-manifest.json'), JSON.stringify(files));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheManifest()],
  build: { outDir: 'dist', sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
});
