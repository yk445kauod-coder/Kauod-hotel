#!/usr/bin/env bash
# Builds the native Windows desktop client.
#
# The client is 32-bit only: a single 32-bit binary runs on every Windows
# version (7/8/10/11, 32- and 64-bit) and is the right fit for low-spec
# machines such as an Intel Core 2 Duo with 2 GB RAM.
#
# Requires Go 1.20.x (the last release that runs on Windows 7/8).
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p dist

echo "building windows/386 …"
GOOS=windows GOARCH=386 CGO_ENABLED=0 \
  go build -trimpath -ldflags "-H=windowsgui -s -w" \
  -o "dist/kaoud-invoice.exe" .

# Copy the binary into the tracked downloads/ folder so it is downloadable
# straight from the repository.
mkdir -p "$(dirname "$0")/../../downloads"
cp "dist/kaoud-invoice.exe" "$(dirname "$0")/../../downloads/kaoud-invoice.exe"

ls -la dist
