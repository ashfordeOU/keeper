// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// With Keeper Pro switched off (the default for 1.0.0) nothing about it shows
// anywhere and nothing goes out: no section, row, part, search result, pill,
// sheet, usage-stats field, request or timer. Switched on, the same places show
// it. The real app is checked the same way end to end (test/e2e/pro.cjs).

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEATURES, featureOffered, featureStates } from '../core/features';
import { ProClient } from '../core/pro/client';
import { proEnabled, setProSwitchForTests } from '../core/pro-switch';
import { defaultSettings } from '../core/settings';
import { searchSettings, sectionRows, SECTIONS, SETTINGS } from '../core/settings-schema';
import { buildPayload, usageSchema, uuidFromBytes, validatePayload, type TelemetryInputs } from '../core/telemetry';

const status = vi.fn(async () => ({ enabled: false }));
vi.mock('../src/api', () => ({ api: { pro: { status }, on: () => () => undefined }, isDemo: false }));
vi.mock('../src/state', () => ({ useStore: () => ({ toast: () => undefined }) }));

const { ProAccountPanel, ProCatalogPanel, ProPill, UpgradeSheet } = await import('../src/components/ProAccount');

const PRO_WORDS = /keeper pro|account & pro|\bupgrade\b|\bpro\b|license|subscription|restore purchase/i;
const PLATFORMS = ['darwin', 'win32', 'linux'];
const settings = () => defaultSettings([], []);

function visibleSections(platform: string) {
  const states = featureStates(settings(), platform);
  return SECTIONS.filter((s) => !s.feature || states.get(s.feature)?.on !== false);
}

const inputs = (over: Partial<TelemetryInputs> = {}): TelemetryInputs => ({
  installId: uuidFromBytes(new Uint8Array(16).fill(7)), now: Date.parse('2026-11-03T12:00:00Z'), version: '1.0.0', official: true, installSource: 'direct', platform: 'linux', osRelease: '6.8.0', arch: 'x64',
  cpuModel: 'AMD Ryzen 7 7840U', cores: 16, totalMemBytes: 32 * 1024 ** 3, gpuVendorIds: [0x1002], hasBattery: true, displays: 1, notch: false, locale: 'en-GB', activeDays: ['2026-11-03'],
  featuresOn: [...featureStates(defaultSettings([], []), 'linux').values()].filter((f) => f.on).map((f) => f.id), knownFeatures: FEATURES.map((f) => f.id), pageOpens: {}, aiProviders: 0, devices: 0, crashes: 0, restarts: 0, avgMemoryBytes: 3e8, avgCpuPct: 0.5, ...over,
});

afterEach(() => setProSwitchForTests({}));

describe('Keeper Pro switched off (1.0.0)', () => {
  it('is off in this build', () => {
    expect(proEnabled()).toBe(false);
  });
  it('no Settings section, row or part mentions it, on any system', () => {
    for (const p of PLATFORMS) {
      const shown = visibleSections(p);
      expect(shown.map((s) => s.id)).not.toContain('account');
      for (const s of shown) {
        expect(s.label).not.toMatch(PRO_WORDS);
        const rows = sectionRows(s.id, p);
        for (const d of [...rows.basic, ...rows.advanced]) expect(`${d.label} ${d.help ?? ''}`, d.id).not.toMatch(/keeper pro|account & pro|upgrade/i);
      }
      expect(sectionRows('account', p)).toEqual({ basic: [], advanced: [] });
      // Settings → Features and the first-run setup list only what the build offers.
      const parts = FEATURES.filter((f) => featureOffered(f, p));
      expect(parts.map((f) => f.id)).not.toContain('proAccount');
      for (const f of parts) expect(f.name, f.id).not.toMatch(/keeper pro|account & pro/i);
      expect(featureStates(settings(), p).get('proAccount')?.on).toBe(false);
    }
  });
  it('searching Settings (and Quick Search, which uses the same search) finds nothing of it', () => {
    for (const q of ['pro', 'keeper pro', 'license', 'upgrade', 'subscription', 'restore purchase', 'plan', 'account', 'team']) {
      for (const p of PLATFORMS) {
        const hits = searchSettings(q, settings(), p);
        expect(hits.filter((h) => h.section === 'account' || h.id === 'proAccount' || h.id === 'proCatalog'), `${q} on ${p}`).toEqual([]);
      }
    }
  });
  it('the pill, the sheet and the panels draw nothing and ask nothing', () => {
    const s = { enabled: true as const, offered: true, plan: 'free' as const, buy: [{ plan: 'pro' as const, period: 'year' as const }], manage: false, edition: 'direct' as const, features: [] };
    expect(renderToStaticMarkup(createElement(ProPill, { plan: 'pro' }))).toBe('');
    expect(renderToStaticMarkup(createElement(UpgradeSheet, { s, onClose: () => undefined }))).toBe('');
    expect(renderToStaticMarkup(createElement(ProAccountPanel))).toBe('');
    expect(renderToStaticMarkup(createElement(ProCatalogPanel))).toBe('');
    expect(status).not.toHaveBeenCalled();
  });
  it('usage stats never carry or show a plan', () => {
    expect(Object.keys(usageSchema(false))).not.toContain('usage.plan');
    const p = buildPayload(inputs());
    expect('plan' in p.usage).toBe(false);
    expect(validatePayload(p).ok).toBe(true);
    expect(p.usage.features).not.toContain('proAccount');
  });
  it('no request to pro.json or the license server, and no timer', async () => {
    const fetch = vi.fn();
    const every = vi.fn();
    const c = new ProClient({
      enabled: proEnabled(), freeThrough: null, edition: 'direct', keys: ['x'], configUrl: 'https://keeper.ashforde.org/pro.json', serverUrl: 'https://license.ashforde.org',
      now: () => Date.now(), fetch, load: vi.fn(), save: vi.fn(), getSecret: vi.fn(), setSecret: vi.fn(), openExternal: vi.fn(), randomRef: () => 'r', every,
    });
    await c.start();
    await c.tick();
    await c.status();
    expect(fetch).not.toHaveBeenCalled();
    expect(every).not.toHaveBeenCalled();
  });
});

describe('Keeper Pro switched on (a later version)', () => {
  it('shows its section, rows and part, and the pill', () => {
    setProSwitchForTests({ pro: true, freeThrough: '1.2.0' });
    expect(visibleSections('linux').map((s) => s.id)).toContain('account');
    expect(sectionRows('account', 'linux').basic.map((d) => d.id)).toEqual(['proAccount', 'proCatalog']);
    expect(searchSettings('license', settings(), 'linux').some((h) => h.id === 'proAccount')).toBe(true);
    expect(renderToStaticMarkup(createElement(ProPill, { plan: 'pro' }))).toContain('>Pro<');
    expect(renderToStaticMarkup(createElement(ProPill, { plan: 'free' }))).toBe('');
    expect(Object.keys(usageSchema(true))).toContain('usage.plan');
    const p = buildPayload(inputs({ plan: 'pro' }));
    expect(p.usage.plan).toBe('pro');
    expect(validatePayload(p).ok).toBe(true);
    expect(validatePayload({ ...p, usage: { ...p.usage, plan: 'gold' } }).ok).toBe(false);
    expect(SETTINGS.filter((d) => d.section === 'account').every((d) => d.feature === 'proAccount')).toBe(true);
  });
});
