#!/bin/sh
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Builds "Keeper Intents.app" (universal) and checks that Xcode extracted the
# App Intents metadata Siri and Shortcuts read. Needs Xcode and XcodeGen.
set -eu
cd "$(dirname "$0")"
command -v xcodegen >/dev/null 2>&1 || brew install xcodegen
xcodegen generate --quiet
xcodebuild -project KeeperIntents.xcodeproj -target KeeperIntents -configuration Release SYMROOT="$PWD/build" build | tail -n 25
APP="build/Release/Keeper Intents.app"
test -x "$APP/Contents/MacOS/Keeper Intents" || { echo "Keeper Intents.app was not built" >&2; exit 1; }
if [ -d "$APP/Contents/Resources/Metadata.appintents" ]; then
  echo "App Intents metadata: $(ls "$APP/Contents/Resources/Metadata.appintents" | tr '\n' ' ')"
else
  echo "App Intents metadata was not generated: Siri and Shortcuts would not see Keeper's actions" >&2
  exit 1
fi
