// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// electron-builder configuration for signed builds. The release workflow uses it instead of
// electron-builder.yml for a Developer ID Mac build and for Azure-signed Windows builds.
//
// macOS, only when KEEPER_MAC_SIGNING=developer-id (the release workflow sets it from
// .github/release.json's "macSigning"; see RELEASING.md → Moving to the Developer ID):
//   CSC_LINK + CSC_KEY_PASSWORD (the "Developer ID Application" certificate as base64 .p12),
//   signed with the hardened runtime and build/entitlements.mac.plist, then notarized and
//   stapled with APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID by scripts/notarize-mac.mjs
//   (run from build/after-sign.cjs, so the submission ID is kept). Every one of them is
//   required: a missing one stops the build instead of making a self-signed or un-notarized one.
//   APPLE_TEAM_ID must be the team in core/update-verify.ts, the one the updater's bridge accepts.
//   A CSC_LINK without KEEPER_MAC_SIGNING=developer-id is refused too, so a certificate in the
//   environment can never change who signs a release by itself.
// Windows: WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (a code-signing .pfx) are read by electron-builder
//   itself; or Azure Trusted Signing with AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET,
//   AZURE_TRUSTED_SIGNING_ENDPOINT, AZURE_TRUSTED_SIGNING_ACCOUNT and AZURE_TRUSTED_SIGNING_PROFILE.

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
// Everything in electron-builder.yml carries over, the afterPack and afterSign hooks included
// (build/after-sign.cjs leaves a Developer ID app alone and signs the downloadable components
// with the same Developer ID).
const config = yaml.load(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'));
const env = process.env;

/** The Team ID the updater's bridge accepts (APPLE_TEAM_ID in core/update-verify.ts, the one place it is written). */
function teamId() {
  const m = /export const APPLE_TEAM_ID = '([A-Z0-9]{10})'/.exec(fs.readFileSync(path.join(root, 'core', 'update-verify.ts'), 'utf8'));
  if (!m) throw new Error('APPLE_TEAM_ID not found in core/update-verify.ts');
  return m[1];
}

/** The mac section of a Developer ID build; throws when anything it needs is missing. */
function developerIdMac(base, e = env) {
  const missing = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].filter((k) => !e[k]);
  if (missing.length) throw new Error(`Developer ID build: ${missing.join(', ')} not set (see RELEASING.md → Moving to the Developer ID)`);
  if (e.APPLE_TEAM_ID !== teamId()) throw new Error(`Developer ID build: APPLE_TEAM_ID is not ${teamId()}, the team Keeper's updater accepts (core/update-verify.ts)`);
  const mac = { ...base };
  delete mac.identity; // electron-builder picks the "Developer ID Application" identity from CSC_LINK
  Object.assign(mac, {
    // Every program in the app (Electron's helpers, keeper-helper, Keeper Intents.app, agent-desktop,
    // rclone, the native modules) is signed with the hardened runtime and a secure timestamp.
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // Not notarized by electron-builder: its notarization sends the app again whenever it is run
    // again. build/after-sign.cjs runs scripts/notarize-mac.mjs instead (APPLE_ID /
    // APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID), which keeps the submission ID, waits on it, and
    // staples the ticket to the app before electron-builder makes the dmg and zip.
    notarize: false,
    // Programs placed next to Keeper's own executable are signed with the same Developer ID first.
    // agent-desktop (Contents/Resources/agent-desktop) too, when it was fetched: it reads other apps
    // through Keeper's Accessibility permission.
    binaries: ['Contents/MacOS/keeper-helper', ...['agent-desktop', 'agent-desktop-macos-helper']
      .filter((f) => fs.existsSync(path.join(root, 'vendor', 'agent-desktop', 'current', f)))
      .map((f) => `Contents/Resources/agent-desktop/${f}`)],
  });
  return mac;
}

if (env.KEEPER_MAC_SIGNING === 'developer-id') {
  config.mac = developerIdMac(config.mac);
} else if (env.CSC_LINK) {
  throw new Error('CSC_LINK is set but KEEPER_MAC_SIGNING is not "developer-id": set "macSigning": "developer-id" in .github/release.json to sign with the Developer ID');
}

if (env.AZURE_TRUSTED_SIGNING_ACCOUNT && env.AZURE_TRUSTED_SIGNING_PROFILE && env.AZURE_TRUSTED_SIGNING_ENDPOINT) {
  config.win = {
    ...config.win,
    azureSignOptions: {
      publisherName: env.AZURE_TRUSTED_SIGNING_PUBLISHER || 'Ashforde OÜ',
      endpoint: env.AZURE_TRUSTED_SIGNING_ENDPOINT,
      codeSigningAccountName: env.AZURE_TRUSTED_SIGNING_ACCOUNT,
      certificateProfileName: env.AZURE_TRUSTED_SIGNING_PROFILE,
    },
  };
}

module.exports = config;
