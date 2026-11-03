// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs after electron-builder signs the app, before the dmg and zip are made.
//
// When KEEPER_SIGN_IDENTITY is set (the release workflow sets it, to the SHA-1 of
// "Keeper Self-Signed", after scripts/ci-import-signing-cert.sh), the finished Mac
// app is re-signed with that certificate. Every release then has the same
// designated requirement, so macOS keeps Accessibility, Screen Recording and the
// other permissions across updates, and the in-app updater accepts only builds
// signed the same way. Without the variable this does nothing: builds stay
// ad-hoc signed.
//
// A Developer ID build (KEEPER_MAC_SIGNING=developer-id, packaging/electron-builder.signed.cjs)
// is signed by electron-builder itself, keeper-helper, Keeper Intents.app and agent-desktop
// included: here its pieces are checked (Developer ID of the expected team, hardened runtime),
// the downloadable components are signed with the same Developer ID, the hardened runtime and a
// secure timestamp, and then the app is notarized and stapled by scripts/notarize-mac.mjs, which
// keeps Apple's submission ID so a retry or a re-run waits on it instead of sending the app again.
// electron-builder makes the dmg and zip (and latest-mac.yml) from the stapled app afterwards.
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
function signComponents(staging, identity, extra = []) {
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
  for (const f of files) codesign(['--force', '--sign', identity, ...extra, f]);
  return files.length;
}
exports.signComponents = signComponents;

const developerIdBuild = () => process.env.KEEPER_MAC_SIGNING === 'developer-id';

/** `codesign -dvv` of a file or bundle (it prints on stderr): Authority, TeamIdentifier, flags… */
function signatureInfo(file) {
  const r = spawnSync('/usr/bin/codesign', ['-dvv', file], { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const field = (name) => new RegExp(`^${name}=(.+)$`, 'm').exec(out)?.[1].trim();
  return { authority: field('Authority'), team: field('TeamIdentifier'), runtime: /flags=0x[0-9a-f]*\([^)]*\bruntime\b/.test(out), out };
}
exports.signatureInfo = signatureInfo;

/** The identity the app was signed with: KEEPER_SIGN_IDENTITY, the Developer ID electron-builder used, or ad hoc. */
function appIdentity(app) {
  if (process.env.KEEPER_SIGN_IDENTITY && !developerIdBuild() && !process.env.CSC_LINK) return process.env.KEEPER_SIGN_IDENTITY;
  // codesign -dvv prints the signing chain leaf first ("Authority=Developer ID Application: …") on stderr.
  return signatureInfo(app).authority ?? '-';
}

/**
 * A Developer ID build: the app and the programs inside it that matter most must carry the
 * Developer ID of the team the updater accepts, with the hardened runtime. Throws otherwise.
 */
function checkDeveloperIdApp(app, team) {
  const contents = path.join(app, 'Contents');
  const pieces = [app, path.join(contents, 'MacOS', 'keeper-helper'), path.join(contents, 'Library', 'Helpers', 'Keeper Intents.app'), ...agentDesktopBinaries(path.join(contents, 'Resources'))]
    .filter((f) => fs.existsSync(f));
  for (const f of pieces) {
    const info = signatureInfo(f);
    const problems = [];
    if (!info.authority?.startsWith('Developer ID Application:')) problems.push(`signed by ${info.authority ?? 'nobody (ad hoc)'}`);
    if (info.team !== team) problems.push(`team ${info.team ?? 'none'}, not ${team}`);
    if (!info.runtime) problems.push('no hardened runtime');
    if (problems.length) throw new Error(`after-sign: ${path.relative(path.dirname(app), f)} is not a Developer ID build: ${problems.join(', ')}`);
  }
  return pieces.length;
}
exports.checkDeveloperIdApp = checkDeveloperIdApp;

/** The keychain electron-builder imported CSC_LINK into, so components are signed from the very same identity. */
async function builderKeychain(context) {
  try {
    return (await context.packager.codeSigningInfo?.value)?.keychainFile || undefined;
  } catch {
    return undefined;
  }
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName === 'darwin' && process.platform === 'darwin') {
    const { componentsStaging, ARCH } = require('./after-pack.cjs');
    const staging = componentsStaging(context.outDir, 'darwin', ARCH[context.arch] ?? 'x64');
    // Signed last, after the app, with the very identity the app now carries.
    const keychain = developerIdBuild() ? await builderKeychain(context) : undefined;
    context.__signComponents = () => {
      const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
      const identity = appIdentity(app);
      let extra = [];
      if (developerIdBuild()) {
        // Never a quiet fallback: a Developer ID release whose app is not Developer ID signed stops here.
        const team = process.env.APPLE_TEAM_ID;
        if (!team) throw new Error('after-sign: Developer ID build without APPLE_TEAM_ID');
        const n = checkDeveloperIdApp(app, team);
        console.log(`  • after-sign: ${n} piece(s) of the app carry the Developer ID of team ${team} with the hardened runtime`);
        extra = ['--options', 'runtime', '--timestamp', ...(keychain ? ['--keychain', keychain] : [])];
      }
      const n = signComponents(staging, identity, extra);
      if (n) console.log(`  • after-sign: signed ${n} program(s) in the downloadable components like the app`);
    };
  }
  try {
    await signApp(context);
  } finally {
    context.__signComponents?.();
  }
  if (context.electronPlatformName === 'darwin' && process.platform === 'darwin' && developerIdBuild()) notarize(context);
};

/** The notarize-mac.mjs command line for this app (edition as build/after-pack.cjs reads it). */
function notarizeArgs(context, env = process.env) {
  const { ARCH } = require('./after-pack.cjs');
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const args = [path.join(__dirname, '..', 'scripts', 'notarize-mac.mjs'), '--app', app, '--version', context.packager.appInfo.version,
    '--arch', ARCH[context.arch] ?? 'x64', '--edition', env.KEEPER_EDITION === 'core' ? 'core' : 'full'];
  if (env.KEEPER_NOTARY_COMMIT) args.push('--commit', env.KEEPER_NOTARY_COMMIT);
  return args;
}
exports.notarizeArgs = notarizeArgs;

/** Notarizes and staples the app before electron-builder makes the dmg and zip from it. */
function notarize(context) {
  const r = spawnSync(process.execPath, notarizeArgs(context), { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('after-sign: notarization did not finish (see the notarize-mac lines above)');
}

async function signApp(context) {
  const identity = process.env.KEEPER_SIGN_IDENTITY;
  if (!identity || context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return;
  if (developerIdBuild() || process.env.CSC_LINK) {
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
