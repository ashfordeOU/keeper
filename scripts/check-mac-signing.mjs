#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Checks a Developer ID Mac release before it is uploaded (the release workflow runs it on
// every dmg it made, the core and the full edition), so nothing reaches people that the
// installed copies would refuse or Gatekeeper would stop:
//
//   node scripts/check-mac-signing.mjs release/Keeper-mac-arm64.dmg release/Keeper-mac-arm64-full.dmg
//   node scripts/check-mac-signing.mjs --print team          # the Team ID (core/update-verify.ts)
//   node scripts/check-mac-signing.mjs --print requirement   # the requirement self-signed copies accept
//
// For the app inside each dmg: a valid deep signature; it meets DEVELOPER_ID_APP_REQUIREMENT,
// the bridge every self-signed copy's updater applies (core/update-verify.ts); the app,
// keeper-helper, Keeper Intents.app and agent-desktop carry the team's Developer ID with the
// hardened runtime; the notarization ticket is stapled; and Gatekeeper accepts it as
// "Notarized Developer ID". macOS only (codesign, hdiutil, stapler, spctl).

import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** APPLE_TEAM_ID and the requirements, from core/update-verify.ts (the one place they are written). */
export async function signingConstants() {
  const dir = mkdtempSync(path.join(tmpdir(), 'keeper-signing-'));
  const out = path.join(dir, 'verify.mjs');
  try {
    await build({ entryPoints: [path.join(ROOT, 'core', 'update-verify.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
    const m = await import(pathToFileURL(out).href);
    return { team: m.APPLE_TEAM_ID, requirement: m.DEVELOPER_ID_APP_REQUIREMENT, bundleId: m.KEEPER_BUNDLE_ID };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};

function checkApp(app, { team, requirement }) {
  const problems = [];
  const deep = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  if (!deep.ok) problems.push(`signature not valid: ${deep.out.split('\n').pop()}`);
  if (!run('/usr/bin/codesign', ['--verify', `-R=${requirement}`, app]).ok) problems.push(`does not meet the updater's Developer ID requirement (${requirement})`);
  const contents = path.join(app, 'Contents');
  const pieces = [app, path.join(contents, 'MacOS', 'keeper-helper'), path.join(contents, 'Library', 'Helpers', 'Keeper Intents.app'),
    path.join(contents, 'Resources', 'agent-desktop', 'agent-desktop'), path.join(contents, 'Resources', 'agent-desktop', 'agent-desktop-macos-helper')];
  for (const f of pieces.filter((p) => existsSync(p))) {
    const info = run('/usr/bin/codesign', ['-dvv', f]).out;
    const name = path.relative(path.dirname(app), f);
    if (!/^Authority=Developer ID Application:/m.test(info)) problems.push(`${name}: not signed with a Developer ID Application certificate`);
    if (!new RegExp(`^TeamIdentifier=${team}$`, 'm').test(info)) problems.push(`${name}: team is not ${team}`);
    if (!/flags=0x[0-9a-f]*\([^)]*\bruntime\b/.test(info)) problems.push(`${name}: no hardened runtime`);
  }
  const staple = run('/usr/bin/xcrun', ['stapler', 'validate', app]);
  if (!staple.ok) problems.push(`no stapled notarization ticket: ${staple.out.split('\n').pop()}`);
  const gk = run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  if (!gk.ok || !/source=Notarized Developer ID/.test(gk.out)) problems.push(`Gatekeeper: ${gk.out.split('\n').join(' ')}`);
  return problems;
}

function checkDmg(dmg, constants) {
  const mount = mkdtempSync(path.join(tmpdir(), 'keeper-dmg-'));
  execFileSync('/usr/bin/hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount], { stdio: 'ignore' });
  try {
    const app = readdirSync(mount).find((n) => n.endsWith('.app'));
    if (!app) return ['no app inside'];
    return checkApp(path.join(mount, app), constants);
  } finally {
    spawnSync('/usr/bin/hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' });
    rmSync(mount, { recursive: true, force: true });
  }
}

async function main(argv) {
  const constants = await signingConstants();
  if (argv[0] === '--print') {
    const v = { team: constants.team, requirement: constants.requirement }[argv[1]];
    if (!v) throw new Error('usage: check-mac-signing.mjs --print team|requirement');
    process.stdout.write(`${v}\n`);
    return;
  }
  if (!argv.length) throw new Error('usage: check-mac-signing.mjs <file.dmg|App.app>…');
  let failed = 0;
  for (const f of argv) {
    const problems = f.endsWith('.app') ? checkApp(f, constants) : checkDmg(f, constants);
    if (problems.length) {
      failed++;
      console.error(`✗ ${path.basename(f)}\n  ${problems.join('\n  ')}`);
    } else console.log(`✓ ${path.basename(f)}: Developer ID of ${constants.team}, hardened runtime, notarized and stapled; self-signed copies accept it`);
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
