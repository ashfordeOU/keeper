// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs after electron-builder signs the app, before the dmg and zip are made.
//
// When KEEPER_SIGN_IDENTITY is set (the release workflow sets it, to the SHA-1 of
// "Keeper Self-Signed", after scripts/ci-import-signing-cert.sh), the finished Mac
// app is re-signed with that certificate. Every release then has the same
// designated requirement, so macOS keeps Accessibility, Screen Recording and the
// other permissions across updates, and the in-app updater accepts only builds
// signed the same way. Without the variable this does nothing: builds stay
// ad-hoc signed. A Developer ID build (CSC_LINK) is signed by electron-builder itself.
//
// The requirements are deliberately not preserved: an ad-hoc requirement pins
// one build's cdhash, which is exactly what this replaces.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const codesign = (args) => execFileSync('/usr/bin/codesign', args, { stdio: 'inherit' });

exports.default = async function afterSign(context) {
  const identity = process.env.KEEPER_SIGN_IDENTITY;
  if (!identity || context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return;
  if (process.env.CSC_LINK) {
    console.log('  • after-sign: Developer ID build, KEEPER_SIGN_IDENTITY ignored');
    return;
  }
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • after-sign: signing ${path.basename(app)} with ${identity}`);

  // Inner code first, outer bundle last.
  const helper = path.join(app, 'Contents', 'MacOS', 'keeper-helper');
  if (fs.existsSync(helper)) codesign(['--force', '--sign', identity, helper]);
  const intents = path.join(app, 'Contents', 'Library', 'Helpers', 'Keeper Intents.app');
  if (fs.existsSync(intents)) codesign(['--force', '--sign', identity, '--preserve-metadata=entitlements,flags', intents]);
  // --deep reaches Electron's frameworks and helper apps; entitlements and flags each
  // piece already had are kept, the requirement is made fresh from the certificate.
  codesign(['--force', '--deep', '--sign', identity, '--preserve-metadata=entitlements,flags', app]);
  codesign(['--verify', '--deep', '--strict', '--verbose=2', app]);
  codesign(['-d', '-r-', app]);
};
