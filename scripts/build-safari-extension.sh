#!/bin/sh
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# macOS only: turns Keeper's browser extension into a Safari Web Extension
# Xcode project (Apple's converter). The result must be built and signed in
# Xcode; Safari extensions can only exchange messages with the app they are
# packaged in, so linking Safari tabs to Keeper also needs a small containing
# app that forwards to Keeper's local socket. Not part of the release yet.
set -eu
[ "$(uname)" = Darwin ] || { echo "Safari extensions can only be built on macOS" >&2; exit 1; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-"$ROOT/build/safari-extension"}
mkdir -p "$OUT"
xcrun safari-web-extension-converter "$ROOT/browser-extension" \
  --project-location "$OUT" --app-name "Keeper Privacy" --bundle-identifier org.ashforde.keeper.safari \
  --swift --macos-only --no-open --no-prompt --force
echo "Xcode project written to $OUT"
