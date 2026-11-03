// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The separate app icons on a Mac (core/launchers.ts): "Keeper Mail.app",
// "Keeper Calendar.app", "Keeper Notes.app", "Keeper Files.app" and the others,
// made inside Keeper.app at Contents/Library/Launchers by build/after-pack.cjs,
// before the app is signed.
//
// Each is a plain app bundle: an Info.plist naming its app icon (KeeperApp) and
// page (KeeperPage), its icon (build/launchers/keeper-<app>.icns,
// scripts/launcher-icons.mjs) and a copy of keeper-launcher, the small universal
// program native/macos/KeeperHelper builds with keeper-helper (`swift build -c
// release --arch arm64 --arch x86_64`, the release workflow's "macOS helper" step
// and scripts/build-mac-native.mjs). It starts Keeper as a light app
// (--keeper-solo=<app>, docs/SOLO.md), or opens keeper://open/<page> in a Keeper
// that is running, and quits.
//
// Signing: they are nested code in Keeper.app, so they are signed with the app's
// own identity: by electron-builder for a Developer ID build (hardened runtime,
// then notarized with the app), or by build/after-sign.cjs with the self-signed
// certificate (each launcher first, then the app).

const fs = require('node:fs');
const path = require('node:path');

/** The same pages, names and identifiers as core/launchers.ts (test/launchers.test.ts keeps them equal). */
const LAUNCHERS = [
  { page: 'mail', name: 'Keeper Mail', bundleId: 'io.github.ashfordeou.keeper.mail' },
  { page: 'calendar', name: 'Keeper Calendar', bundleId: 'io.github.ashfordeou.keeper.calendar' },
  { page: 'notes', name: 'Keeper Notes', bundleId: 'io.github.ashfordeou.keeper.notes' },
  { page: 'reminders', name: 'Keeper Reminders', bundleId: 'io.github.ashfordeou.keeper.reminders' },
  { page: 'planner', name: 'Keeper Planner', bundleId: 'io.github.ashfordeou.keeper.planner' },
  { page: 'files', opens: 'browse', name: 'Keeper Files', bundleId: 'io.github.ashfordeou.keeper.files' },
  { page: 'studio', name: 'Keeper Studio', bundleId: 'io.github.ashfordeou.keeper.studio' },
  { page: 'terminal', name: 'Keeper Terminal', bundleId: 'io.github.ashfordeou.keeper.terminal' },
  { page: 'rdc', name: 'Keeper Remote Desktops', bundleId: 'io.github.ashfordeou.keeper.rdc' },
];
exports.LAUNCHERS = LAUNCHERS;

const ROOT = path.join(__dirname, '..');
/** Where swift build leaves keeper-launcher: universal first, then a build for this Mac's processor only. */
const BINARIES = [
  path.join(ROOT, 'native/macos/KeeperHelper/.build/apple/Products/Release/keeper-launcher'),
  path.join(ROOT, 'native/macos/KeeperHelper/.build/release/keeper-launcher'),
];
exports.BINARIES = BINARIES;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A launcher's Info.plist. */
function infoPlist(l, version) {
  const entries = {
    CFBundleDevelopmentRegion: 'en',
    CFBundleExecutable: l.name,
    CFBundleIconFile: 'AppIcon',
    CFBundleIdentifier: l.bundleId,
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: l.name,
    CFBundleDisplayName: l.name,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    LSMinimumSystemVersion: '13.0',
    LSApplicationCategoryType: 'public.app-category.productivity',
    NSHumanReadableCopyright: '© 2026 Ashforde OÜ. Keeper by Ashforde®',
    KeeperApp: l.page,
    KeeperPage: l.opens ?? l.page,
  };
  const body = Object.entries(entries).map(([k, v]) => `\t<key>${esc(k)}</key>\n\t<string>${esc(v)}</string>`).join('\n');
  // It quits as soon as Keeper has started (or has the link): no Dock icon of its own while it runs;
  // the light app it starts shows this app's icon in the Dock.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}\n\t<key>LSUIElement</key>\n\t<true/>\n</dict>\n</plist>\n`;
}
exports.infoPlist = infoPlist;

/** The files of one launcher bundle, relative to the bundle: [path, contents or source file, executable]. */
function bundleFiles(l, version, binary, icon) {
  return [
    ['Contents/Info.plist', { text: infoPlist(l, version) }, false],
    ['Contents/PkgInfo', { text: 'APPL????' }, false],
    [`Contents/MacOS/${l.name}`, { file: binary }, true],
    ['Contents/Resources/AppIcon.icns', { file: icon }, false],
  ];
}
exports.bundleFiles = bundleFiles;

/** Where the launchers go inside Keeper.app. */
const launchersDir = (app) => path.join(app, 'Contents', 'Library', 'Launchers');
exports.launchersDir = launchersDir;

/**
 * Makes the launchers inside `app`. Returns how many were made, or 0 (with the reason)
 * when keeper-launcher was not built: Keeper works without them; Settings then says they are
 * not in this copy.
 */
function makeLaunchers(app, version, opts = {}) {
  const binary = opts.binary ?? BINARIES.find((b) => fs.existsSync(b));
  if (!binary || !fs.existsSync(binary)) return { made: 0, reason: 'keeper-launcher is not built (swift build in native/macos/KeeperHelper)' };
  const dir = launchersDir(app);
  fs.rmSync(dir, { recursive: true, force: true });
  let made = 0;
  for (const l of LAUNCHERS) {
    const icon = path.join(opts.icons ?? path.join(ROOT, 'build', 'launchers'), `keeper-${l.page}.icns`);
    if (!fs.existsSync(icon)) return { made, reason: `${path.basename(icon)} is missing (node scripts/launcher-icons.mjs)` };
    const bundle = path.join(dir, `${l.name}.app`);
    for (const [rel, src, exec] of bundleFiles(l, version, binary, icon)) {
      const out = path.join(bundle, rel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      if (src.text !== undefined) fs.writeFileSync(out, src.text);
      else fs.copyFileSync(src.file, out);
      if (exec) fs.chmodSync(out, 0o755);
    }
    made++;
  }
  return { made };
}
exports.makeLaunchers = makeLaunchers;

/** The launcher bundles in a finished Keeper.app (for signing and checks). */
function launcherBundles(app) {
  const dir = launchersDir(app);
  return LAUNCHERS.map((l) => path.join(dir, `${l.name}.app`)).filter((b) => fs.existsSync(b));
}
exports.launcherBundles = launcherBundles;
