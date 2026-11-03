// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// packaging/electron-builder.signed.cjs: a Developer ID Mac build is complete (hardened runtime,
// entitlements, notarization for the team the updater accepts) or it does not build at all.
// Notarization is build/after-sign.cjs running scripts/notarize-mac.mjs (submission ID kept),
// never electron-builder's own, which would send the app again on every retry.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { APPLE_TEAM_ID, DEVELOPER_ID_APP_REQUIREMENT } from '../core/update-verify';
// @ts-expect-error plain JavaScript module without type declarations
import { signingConstants } from '../scripts/check-mac-signing.mjs';

const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const CONFIG = path.join(ROOT, 'packaging', 'electron-builder.signed.cjs');
const KEYS = ['KEEPER_MAC_SIGNING', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'AZURE_TRUSTED_SIGNING_ACCOUNT'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

type Mac = { identity?: string; hardenedRuntime?: boolean; notarize?: boolean; entitlements?: string; entitlementsInherit?: string; binaries?: string[] };
function load(env: Record<string, string>): { mac: Mac } {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[CONFIG];
  return require(CONFIG) as { mac: Mac };
}
const ALL = { KEEPER_MAC_SIGNING: 'developer-id', CSC_LINK: 'base64p12', CSC_KEY_PASSWORD: 'pw', APPLE_ID: 'a@b.c', APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh', APPLE_TEAM_ID: APPLE_TEAM_ID };

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  delete require.cache[CONFIG];
});

describe('Developer ID build configuration', () => {
  it('signs with the hardened runtime and the entitlements; notarization is left to notarize-mac.mjs', () => {
    const { mac } = load(ALL);
    expect(mac.identity).toBeUndefined();
    expect(mac.hardenedRuntime).toBe(true);
    expect(mac.notarize).toBe(false);
    expect(mac.entitlements).toBe('build/entitlements.mac.plist');
    expect(mac.entitlementsInherit).toBe('build/entitlements.mac.plist');
    expect(mac.binaries).toContain('Contents/MacOS/keeper-helper');
  });

  it.each(['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'])('stops without %s', (key) => {
    const env: Record<string, string> = { ...ALL };
    delete env[key];
    expect(() => load(env)).toThrow(new RegExp(key));
  });

  it('stops for another team (installed copies would refuse the update)', () => {
    expect(() => load({ ...ALL, APPLE_TEAM_ID: 'ABCDE12345' })).toThrow(/APPLE_TEAM_ID is not D69G45342Y/);
  });

  it('a certificate alone never makes a Developer ID build', () => {
    expect(() => load({ CSC_LINK: 'base64p12', CSC_KEY_PASSWORD: 'pw' })).toThrow(/KEEPER_MAC_SIGNING/);
    // Azure-signed Windows builds use this file too and keep the self-signed Mac section.
    const { mac } = load({ AZURE_TRUSTED_SIGNING_ACCOUNT: 'acct' });
    expect(mac.identity).toBe('-');
    expect(mac.notarize).toBe(false);
  });

  it('the entitlements cover what Keeper uses under the hardened runtime', () => {
    const plist = readFileSync(path.join(ROOT, 'build', 'entitlements.mac.plist'), 'utf8');
    for (const k of [
      'com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory', 'com.apple.security.cs.disable-library-validation',
      'com.apple.security.device.audio-input', 'com.apple.security.device.camera', 'com.apple.security.automation.apple-events',
      'com.apple.security.personal-information.calendars', 'com.apple.security.personal-information.location',
    ]) expect(plist).toMatch(new RegExp(`<key>${k.replace(/\./g, '\\.')}</key>\\s*<true/>`));
    // No sandbox: Keeper is a file library for the whole disk (the App Store edition is separate).
    expect(plist).not.toContain('com.apple.security.app-sandbox');
  });

  it('after-sign notarizes a Developer ID app with notarize-mac.mjs, before the dmg and zip are made', () => {
    const hook = readFileSync(path.join(ROOT, 'build', 'after-sign.cjs'), 'utf8');
    expect(hook).toMatch(/developerIdBuild\(\)\) notarize\(context\)/);
    const { notarizeArgs } = require(path.join(ROOT, 'build', 'after-sign.cjs')) as { notarizeArgs(c: unknown, env: Record<string, string>): string[] };
    const context = { appOutDir: '/out/mac-arm64', arch: 3, packager: { appInfo: { productFilename: 'Keeper', version: '1.0.1' } } };
    expect(notarizeArgs(context, { KEEPER_EDITION: 'core', KEEPER_NOTARY_COMMIT: 'abc' })).toEqual([
      path.join(ROOT, 'scripts', 'notarize-mac.mjs'), '--app', path.join('/out/mac-arm64', 'Keeper.app'), '--version', '1.0.1', '--arch', 'arm64', '--edition', 'core', '--commit', 'abc',
    ]);
    expect(notarizeArgs(context, {})).toContain('full');
  });

  it('the release check reads the team and the bridge requirement from core/update-verify.ts', async () => {
    const c = await signingConstants();
    expect(c.team).toBe(APPLE_TEAM_ID);
    expect(c.requirement).toBe(DEVELOPER_ID_APP_REQUIREMENT);
  });
});
