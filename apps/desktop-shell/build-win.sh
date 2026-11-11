#!/usr/bin/env bash
# Builds the Windows desktop exe for the Kaoud Hotel app.
#
#  1. Build the web app (vite) into apps/web/dist.
#  2. Copy that output into the shell as `app/` so the exe carries the whole
#     application and opens with no network.
#  3. Package with electron-builder (bundles Chromium, so it runs on Win7 too).
#
# Run from apps/desktop-shell. The API origin defaults to the production Worker;
# override with KAOUD_API_BASE to point at another deployment.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
API_BASE="${KAOUD_API_BASE:-https://kaoud-hotel-api.yk445kauod.workers.dev}"

echo "==> Building web app"
npm --prefix "$ROOT" run build -w @kaoud/web

echo "==> Bundling web output into the shell (app/)"
rm -rf "$HERE/app"
mkdir -p "$HERE/app"
cp -r "$ROOT/apps/web/dist/." "$HERE/app/"

echo "==> Shell icon"
cp "$ROOT/apps/web/public/icon-512.png" "$HERE/icon.png"

echo "==> Packaging Windows exe (API base: $API_BASE)"
cd "$HERE"
KAOUD_API_BASE="$API_BASE" npx electron-builder --win --x64 --config electron-builder.yml

echo "==> Done. Artifacts in apps/desktop-shell/dist/"
