// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// electron-builder configuration for signed builds. The release workflow uses it instead of
// electron-builder.yml when signing secrets exist; with none, releases stay ad-hoc signed.
//
// macOS (CSC_LINK + CSC_KEY_PASSWORD, a Developer ID Application certificate as base64 .p12):
//   Developer ID signature with the hardened runtime, notarized when APPLE_ID,
//   APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID are set too.
// Windows: WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (a code-signing .pfx) are read by electron-builder
//   itself; or Azure Trusted Signing with AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET,
//   AZURE_TRUSTED_SIGNING_ENDPOINT, AZURE_TRUSTED_SIGNING_ACCOUNT and AZURE_TRUSTED_SIGNING_PROFILE.

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
// Everything in electron-builder.yml carries over, the afterPack and afterSign hooks included
// (build/after-sign.cjs does nothing for a Developer ID build).
const config = yaml.load(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'));
const env = process.env;

if (env.CSC_LINK) {
  const mac = { ...config.mac };
  delete mac.identity; // let electron-builder pick the Developer ID from CSC_LINK
  Object.assign(mac, {
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: Boolean(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID),
    // Programs placed next to Keeper's own executable are signed with the same Developer ID first.
    // agent-desktop (Contents/Resources/agent-desktop) too, when it was fetched: it reads other apps
    // through Keeper's Accessibility permission.
    binaries: ['Contents/MacOS/keeper-helper', ...['agent-desktop', 'agent-desktop-macos-helper']
      .filter((f) => fs.existsSync(path.join(root, 'vendor', 'agent-desktop', 'current', f)))
      .map((f) => `Contents/Resources/agent-desktop/${f}`)],
  });
  config.mac = mac;
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
