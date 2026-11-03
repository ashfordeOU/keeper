// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Pro's entitlements: what is free stays free (every part Keeper has today,
// and everything up to the version payments were switched on), plans and where
// they come from, and the release switch.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { entitlements, FREE_BASELINE, freeForever, PAID_FEATURES, planOf, receiptSource, sourcePlan, type EntitlementSource } from '../core/entitlements';
import { FEATURES } from '../core/features';
import { PRO_PUBLIC_KEYS } from '../core/pro/keys';
import type { LicenseCheck, LicensePayload } from '../core/pro/license';
import { compareVersions } from '../core/updates';
import { proFlags } from '../scripts/pro-flags.mjs';

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/free-forever-features.json'), 'utf8')) as { version: string; features: string[] };
const REL = JSON.parse(readFileSync(path.join(ROOT, '.github/release.json'), 'utf8'));
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string;
const NOW = Date.parse('2027-03-01T12:00:00Z');

const payload = (over: Partial<LicensePayload> = {}): LicensePayload => ({ v: 1, id: 'lic_abcdef', plan: 'pro', seats: 2, email: 'a'.repeat(64), iat: NOW - 1000, exp: null, via: 'lemonsqueezy', ...over });
const license = (over: Partial<LicensePayload> = {}): EntitlementSource => ({ kind: 'license', check: { ok: true, payload: payload(over), state: 'active' } });
const bad: EntitlementSource = { kind: 'license', check: { ok: false, reason: 'expired', payload: payload() } as LicenseCheck };

describe('free forever', () => {
  it('every part Keeper has today is free for everyone, whatever the plan or the version', () => {
    expect(FIXTURE.features.length).toBeGreaterThanOrEqual(150);
    const paid = new Set(PAID_FEATURES.map((f) => f.id));
    for (const id of FIXTURE.features) {
      expect(paid.has(id), `${id} is in the paid registry`).toBe(false);
      for (const ft of [null, '1.0.0', '1.4.0', '9.9.9']) expect(planOf(id, ft), id).toBe('free');
      for (const plan of [[], [license()], [license({ plan: 'team' })]]) {
        expect(entitlements({ enabled: true, freeThrough: '1.2.0', sources: plan, now: NOW }).has(id), id).toBe(true);
        expect(entitlements({ enabled: false, freeThrough: null, sources: plan, now: NOW }).has(id), id).toBe(true);
      }
    }
  });
  it('the list of today’s parts only grows: every part in core/features.ts is on it', () => {
    const missing = FEATURES.map((f) => f.id).filter((id) => !FIXTURE.features.includes(id));
    expect(missing, 'add new parts to test/fixtures/free-forever-features.json').toEqual([]);
    expect(FIXTURE.version).toBe(FREE_BASELINE);
  });
  it('paid features are only ones that cost money to run or are for teams, and are not built yet', () => {
    expect(new Set(PAID_FEATURES.map((f) => f.id)).size).toBe(PAID_FEATURES.length);
    for (const f of PAID_FEATURES) {
      expect(f.id).toMatch(f.plan === 'team' ? /^team\./ : /^pro\./);
      expect(['costs', 'teams']).toContain(f.why);
      expect(f.introducedIn, `${f.id} is a proposal`).toBeNull();
      expect(FEATURES.some((x) => x.id === f.id)).toBe(false);
    }
    expect(PAID_FEATURES.map((f) => f.id)).toEqual(expect.arrayContaining(['pro.cloudSync', 'pro.cloudBackup', 'pro.hostedLinks', 'pro.aiCredits', 'pro.monorailBundle', 'team.shared', 'team.admin', 'team.sso', 'team.support']));
  });
  it('anything introduced up to freeThrough is free regardless of plan', () => {
    expect(freeForever('0.9.0', null)).toBe(true);
    expect(freeForever('1.0.0', null)).toBe(true);
    expect(freeForever('1.1.0', null)).toBe(false);
    expect(freeForever('1.3.0', '1.3.0')).toBe(true);
    expect(freeForever('1.3.1', '1.3.0')).toBe(false);
    expect(freeForever(null, '9.0.0')).toBe(false);
    // A paid feature that shipped in (or before) the version payments were switched on is free for everyone.
    const f = PAID_FEATURES[0];
    const was = f.introducedIn;
    try {
      f.introducedIn = '1.3.0';
      expect(planOf(f.id, '1.3.0')).toBe('free');
      expect(entitlements({ enabled: true, freeThrough: '1.3.0', now: NOW }).has(f.id)).toBe(true);
      expect(planOf(f.id, '1.2.0')).toBe('pro');
      expect(entitlements({ enabled: true, freeThrough: '1.2.0', now: NOW }).has(f.id)).toBe(false);
      expect(entitlements({ enabled: true, freeThrough: '1.2.0', sources: [license()], now: NOW }).has(f.id)).toBe(true);
    } finally {
      f.introducedIn = was;
    }
  });
});

describe('plans', () => {
  const built = (id: string, fn: () => void) => {
    const f = PAID_FEATURES.find((x) => x.id === id)!;
    const was = f.introducedIn;
    f.introducedIn = '2.0.0';
    try { fn(); } finally { f.introducedIn = was; }
  };
  it('Free by default; a valid license gives its plan; Team includes Pro', () => built('pro.cloudSync', () => built('team.sso', () => {
    const free = entitlements({ enabled: true, freeThrough: '1.5.0', now: NOW });
    expect(free.plan).toBe('free');
    expect(free.has('pro.cloudSync')).toBe(false);
    const pro = entitlements({ enabled: true, freeThrough: '1.5.0', sources: [license()], now: NOW });
    expect(pro.plan).toBe('pro');
    expect(pro.has('pro.cloudSync')).toBe(true);
    expect(pro.has('team.sso')).toBe(false);
    const team = entitlements({ enabled: true, freeThrough: '1.5.0', sources: [license(), license({ plan: 'team' })], now: NOW });
    expect(team.plan).toBe('team');
    expect(team.has('pro.cloudSync') && team.has('team.sso')).toBe(true);
    expect(entitlements({ enabled: true, freeThrough: '1.5.0', sources: [bad], now: NOW }).plan).toBe('free');
  })));
  it('with Pro switched off, paid features do not exist, whatever is on the computer', () => built('pro.cloudSync', () => {
    const e = entitlements({ enabled: false, freeThrough: null, sources: [license({ plan: 'team' })], now: NOW });
    expect(e.plan).toBe('free');
    expect(e.enabled).toBe(false);
    expect(PAID_FEATURES.some((f) => e.has(f.id))).toBe(false);
  }));
  it('a feature that is only a proposal is never available, even on Team', () => {
    const e = entitlements({ enabled: true, freeThrough: '1.5.0', sources: [license({ plan: 'team' })], now: NOW });
    for (const f of PAID_FEATURES) expect(e.has(f.id), f.id).toBe(false);
    expect(e.needs('pro.cloudSync')).toBe('pro');
    expect(e.needs('library')).toBe('free');
    expect(e.has('something-unknown')).toBe(true);
  });
  it('an App Store purchase is a source like a license (for the Mac App Store edition)', () => {
    const plans = (id: string) => (id === 'org.ashforde.keeper.pro.year' ? 'pro' as const : null);
    const r = receiptSource({ productId: 'org.ashforde.keeper.pro.year', originalTransactionId: '2000001', expires: NOW + 1000, revoked: false }, plans);
    expect(sourcePlan(r, NOW)).toBe('pro');
    expect(sourcePlan(r, NOW + 2000)).toBe('free');
    expect(sourcePlan(receiptSource({ productId: 'org.ashforde.keeper.pro.year', originalTransactionId: '2', expires: null, revoked: true }, plans), NOW)).toBe('free');
    expect(sourcePlan(receiptSource({ productId: 'other', originalTransactionId: '3', expires: null, revoked: false }, plans), NOW)).toBe('free');
    expect(entitlements({ enabled: true, freeThrough: '1.0.0', sources: [r], now: NOW }).plan).toBe('pro');
  });
});

describe('the release switch', () => {
  it('is off for 1.0.0, and freeThrough is unset until payments are first switched on', () => {
    expect(typeof REL.proEnabled).toBe('boolean');
    expect('freeThrough' in REL).toBe(true);
    if (!REL.proEnabled && VERSION === '1.0.0') {
      expect(REL.proEnabled).toBe(false);
      expect(REL.freeThrough).toBeNull();
    }
  });
  it('switched on, it needs a recorded freeThrough no newer than this version, and a public key', () => {
    if (REL.freeThrough !== null) {
      expect(REL.freeThrough).toMatch(/^\d+\.\d+\.\d+$/);
      expect(compareVersions(REL.freeThrough, VERSION)).toBeLessThanOrEqual(0);
      expect(compareVersions(REL.freeThrough, FREE_BASELINE)).toBeGreaterThanOrEqual(0);
    }
    if (REL.proEnabled) {
      expect(REL.freeThrough).not.toBeNull();
      expect(PRO_PUBLIC_KEYS.length).toBeGreaterThan(0);
    }
  });
  it('the build reads it, and KEEPER_PRO overrides it for one build', () => {
    const was = process.env.KEEPER_PRO;
    try {
      delete process.env.KEEPER_PRO;
      expect(proFlags().pro).toBe(REL.proEnabled);
      process.env.KEEPER_PRO = '1';
      expect(proFlags()).toEqual({ pro: true, freeThrough: REL.freeThrough ?? VERSION });
      process.env.KEEPER_PRO = '0';
      expect(proFlags().pro).toBe(false);
    } finally {
      if (was === undefined) delete process.env.KEEPER_PRO;
      else process.env.KEEPER_PRO = was;
    }
  });
});
