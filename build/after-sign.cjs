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

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const codesign = (args) => execFileSync('/usr/bin/codesign', args, { stdio: 'inherit' });

/** agent-desktop's programs inside Contents/Resources (they sit outside what --deep reaches). */
function agentDesktopBinaries(resources) {
  const dir = path.join(resources, 'agent-desktop');
  return ['agent-desktop', 'agent-desktop-macos-helper'].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
}
exports.agentDesktopBinaries = agentDesktopBinaries;

/**
 * The core build's downloadable components (staged by build/after-pack.cjs): every Mach-O program
 * and library in them is signed with the app's own identity before scripts/components.mjs packs
 * them, so they run without Gatekeeper prompts, keep the permissions granted to Keeper and pass
 * the app's check when they are downloaded (electron/services/components.ts).
 */
function signComponents(staging, identity) {
  if (!fs.existsSync(staging)) return 0;
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const fd = fs.openSync(p, 'r');
        const b = Buffer.alloc(4);
        fs.readSync(fd, b, 0, 4, 0);
        fs.closeSync(fd);
        if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(b.readUInt32BE(0))) files.push(p);
      }
    }
  };
  walk(staging);
  for (const f of files) codesign(['--force', '--sign', identity, f]);
  return files.length;
}
exports.signComponents = signComponents;

/** The identity the app was signed with: KEEPER_SIGN_IDENTITY, the Developer ID electron-builder used, or ad hoc. */
function appIdentity(app) {
  if (process.env.KEEPER_SIGN_IDENTITY && !process.env.CSC_LINK) return process.env.KEEPER_SIGN_IDENTITY;
  // codesign -dvv prints the signing chain leaf first ("Authority=Developer ID Application: …") on stderr.
  const r = spawnSync('/usr/bin/codesign', ['-dvv', app], { encoding: 'utf8' });
  const m = /^Authority=(.+)$/m.exec(`${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  return m ? m[1].trim() : '-';
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName === 'darwin' && process.platform === 'darwin') {
    const { componentsStaging, ARCH } = require('./after-pack.cjs');
    const staging = componentsStaging(context.outDir, 'darwin', ARCH[context.arch] ?? 'x64');
    // Signed last, after the app, with the very identity the app now carries.
    context.__signComponents = () => {
      const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
      const n = signComponents(staging, appIdentity(app));
      if (n) console.log(`  • after-sign: signed ${n} program(s) in the downloadable components like the app`);
    };
  }
  try {
    await signApp(context);
  } finally {
    context.__signComponents?.();
  }
};

async function signApp(context) {
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
  // agent-desktop reads other apps through Accessibility: the same certificate as Keeper, so the
  // permission granted to Keeper covers it and survives updates.
  for (const f of agentDesktopBinaries(path.join(app, 'Contents', 'Resources'))) codesign(['--force', '--sign', identity, f]);
  const intents = path.join(app, 'Contents', 'Library', 'Helpers', 'Keeper Intents.app');
  if (fs.existsSync(intents)) codesign(['--force', '--sign', identity, '--preserve-metadata=entitlements,flags', intents]);
  // --deep reaches Electron's frameworks and helper apps; entitlements and flags each
  // piece already had are kept, the requirement is made fresh from the certificate.
  codesign(['--force', '--deep', '--sign', identity, '--preserve-metadata=entitlements,flags', app]);
  codesign(['--verify', '--deep', '--strict', '--verbose=2', app]);
  codesign(['-d', '-r-', app]);
};
