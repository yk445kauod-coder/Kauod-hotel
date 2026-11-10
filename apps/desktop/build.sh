#!/usr/bin/env bash
# Builds the native Windows desktop client (32-bit and 64-bit).
# Requires Go 1.20.x (the last release that runs on Windows 7/8).
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p dist

build() {
  local arch="$1"
  echo "building windows/$arch …"
  GOOS=windows GOARCH="$arch" CGO_ENABLED=0 \
    go build -trimpath -ldflags "-H=windowsgui -s -w" \
    -o "dist/kaoud-hotel-$arch.exe" .
}

build 386
build amd64
ls -la dist
