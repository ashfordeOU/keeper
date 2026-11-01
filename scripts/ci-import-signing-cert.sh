#!/bin/bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# CI only (macOS runners): imports the certificate from KEEPER_SIGNING_CERT /
# KEEPER_SIGNING_PASSWORD (made by scripts/make-signing-cert.sh) into a temporary
# keychain, trusts it for code signing, and exports KEEPER_SIGN_IDENTITY (its
# SHA-1 hash) to GITHUB_ENV for build/after-sign.cjs.
set -euo pipefail

: "${KEEPER_SIGNING_CERT:?}" "${KEEPER_SIGNING_PASSWORD:?}"
NAME="Keeper Self-Signed"
TMP="${RUNNER_TEMP:-$(mktemp -d)}"
KEYCHAIN="$TMP/keeper-signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -hex 16)"

printf '%s' "$KEEPER_SIGNING_CERT" | base64 --decode > "$TMP/keeper-cert.p12"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$TMP/keeper-cert.p12" -k "$KEYCHAIN" -P "$KEEPER_SIGNING_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" > /dev/null
# Put the keychain on the search list so codesign can find the identity.
# shellcheck disable=SC2046 # one word per keychain path
security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')

# Trust the self-signed certificate for code signing on this runner.
security find-certificate -c "$NAME" -p "$KEYCHAIN" > "$TMP/keeper-cert.pem"
sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain "$TMP/keeper-cert.pem"
rm -f "$TMP/keeper-cert.p12"

HASH="$(security find-identity -p codesigning "$KEYCHAIN" | awk -v name="\"$NAME\"" 'index($0, name) {print $2; exit}')"
[ -n "$HASH" ] || { security find-identity -p codesigning "$KEYCHAIN"; echo "Signing identity not found" >&2; exit 1; }
echo "KEEPER_SIGN_IDENTITY=$HASH" >> "${GITHUB_ENV:-/dev/null}"
echo "Imported \"$NAME\" ($HASH)"
