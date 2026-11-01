#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Builds the native macOS pieces electron-builder copies into Keeper.app
// (see mac.extraFiles in electron-builder.yml), the same way the release
// workflow does:
//
//   keeper-helper         native/macos/KeeperHelper, universal (arm64 + x86_64):
//                         swift build -c release --arch arm64 --arch x86_64
//                         → .build/apple/Products/Release/keeper-helper
//   Keeper Intents.app    native/macos/KeeperIntents/build.sh (needs full Xcode
//                         and XcodeGen); Siri and Shortcuts actions, optional
//
// Run by `npm run dist:mac` and `npm run dist` (it does nothing on Linux and
// Windows). Without keeper-helper a Mac build would quietly lose Apple
// Intelligence, Live Text, Spotlight, Stage's display modes and more, so a
// failed helper build stops packaging. KEEPER_ALLOW_NO_HELPER=1 packages
// without it anyway (with a warning). KEEPER_REQUIRE_INTENTS=1 makes a missing
// Keeper Intents an error too.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HELPER_DIR = path.join(root, 'native/macos/KeeperHelper');
export const HELPER_BIN = path.join(HELPER_DIR, '.build/apple/Products/Release/keeper-helper');
export const INTENTS_DIR = path.join(root, 'native/macos/KeeperIntents');
export const INTENTS_APP = path.join(INTENTS_DIR, 'build/Release/Keeper Intents.app');

const yes = (v) => v === '1' || v === 'true' || v === 'yes';
const warn = (m) => console.warn(`\x1b[33mwarning:\x1b[0m ${m}`);
const fail = (m) => { console.error(`\x1b[31merror:\x1b[0m ${m}`); process.exit(1); };

function has(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

function sh(cmd, args, cwd) {
  console.log(`$ ${[cmd, ...args].join(' ')}${cwd ? `   (in ${path.relative(root, cwd) || '.'})` : ''}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  return !r.error && r.status === 0;
}

/** What to do about a helper that could not be built: stop, or go on when the override is set. */
export function helperProblem(reason, env = process.env) {
  if (yes(env.KEEPER_ALLOW_NO_HELPER)) return { stop: false, message: `${reason}. KEEPER_ALLOW_NO_HELPER is set, so Keeper.app is packaged WITHOUT keeper-helper: Apple Intelligence, Live Text, Spotlight, Stage's display modes, calls and the other native parts stay off in this build.` };
  return { stop: true, message: `${reason}. Keeper.app would ship without keeper-helper, so packaging stops here. Install Xcode or the Command Line Tools (xcode-select --install) and try again, or set KEEPER_ALLOW_NO_HELPER=1 to package without it.` };
}

function buildHelper() {
  if (!has('swift')) return helperProblem('Swift is not installed');
  if (!sh('swift', ['build', '-c', 'release', '--arch', 'arm64', '--arch', 'x86_64'], HELPER_DIR)) return helperProblem('swift build failed for keeper-helper');
  if (!existsSync(HELPER_BIN)) return helperProblem(`swift build finished but ${path.relative(root, HELPER_BIN)} is missing`);
  const archs = spawnSync('lipo', ['-archs', HELPER_BIN], { encoding: 'utf8' }).stdout?.trim() ?? '';
  if (archs && !(archs.includes('arm64') && archs.includes('x86_64'))) warn(`keeper-helper is not universal (${archs}); the other processor's build would lack it`);
  console.log(`keeper-helper built: ${path.relative(root, HELPER_BIN)}${archs ? ` (${archs})` : ''}`);
  return null;
}

function buildIntents() {
  const required = yes(process.env.KEEPER_REQUIRE_INTENTS);
  const missing = (why) => {
    const m = `Keeper Intents (Siri, Spotlight and Shortcuts actions) is not built: ${why}. Keeper.app works without it; those actions just are not offered.`;
    if (required) fail(`${m} KEEPER_REQUIRE_INTENTS is set.`);
    warn(m);
  };
  // App Intents metadata needs xcodebuild from full Xcode (the Command Line Tools alone cannot build it).
  if (!has('xcodebuild', ['-version'])) return missing('it needs full Xcode (xcodebuild)');
  if (!has('xcodegen', ['--version'])) return missing('it needs XcodeGen (brew install xcodegen)');
  if (!sh('/bin/sh', [path.join(INTENTS_DIR, 'build.sh')])) return missing('native/macos/KeeperIntents/build.sh failed');
  if (!existsSync(INTENTS_APP)) return missing(`${path.relative(root, INTENTS_APP)} is missing after the build`);
  console.log(`Keeper Intents built: ${path.relative(root, INTENTS_APP)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.platform !== 'darwin') {
    console.log('build-mac-native: not on macOS, nothing to build');
    process.exit(0);
  }
  const problem = buildHelper();
  if (problem?.stop) fail(problem.message);
  if (problem) warn(problem.message);
  buildIntents();
}
