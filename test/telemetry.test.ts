// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Anonymous usage stats: only allowlisted fields, nothing that looks like a
// path, e-mail, address or host name, and every way of switching it off.

import { describe, expect, it } from 'vitest';
import { FEATURES, presetPatch, featureStates, setPatch } from '../core/features';
import { defaultSettings } from '../core/settings';
import {
  buildPayload, coarseCpu, coarseOsVersion, countBucket, enqueue, gpuVendor, localeParts, offReason, parsePolicy, policyPath, ramBucket,
  USAGE_SCHEMA, uuidFromBytes, validateBody, validatePayload, type TelemetryInputs, type UsagePayload,
} from '../core/telemetry';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const ID = uuidFromBytes(new Uint8Array(16).map((_, i) => i * 17 + 3));

function inputs(over: Partial<TelemetryInputs> = {}): TelemetryInputs {
  return {
    installId: ID, now: NOW, version: '0.1.0', official: false, installSource: 'direct', platform: 'linux', osRelease: '6.8.0-45-generic', arch: 'x64',
    cpuModel: '12th Gen Intel(R) Core(TM) i7-12700H', cores: 20, totalMemBytes: 15.5 * 1024 ** 3, gpuVendorIds: [0x8086, 0x10de], hasBattery: true,
    displays: 2, notch: false, locale: 'et-EE', activeDays: ['2026-10-31', '2026-10-30', '2026-10-27', '2026-10-01'], featuresOn: ['library', 'island', 'usageStats'],
    knownFeatures: FEATURES.map((f) => f.id), pageOpens: { home: 12, search: 3, settings: 140 }, aiProviders: 2, devices: 1, crashes: 1, restarts: 0,
    avgMemoryBytes: 400 * 1048576, avgCpuPct: 0.3, startupMs: 1800, ...over,
  };
}

/** Every dotted path in a payload, and every string in it. */
function walk(x: unknown, prefix = '', paths: string[] = [], strings: string[] = []) {
  if (Array.isArray(x)) { for (const v of x) walk(v, prefix, paths, strings); return { paths, strings }; }
  if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      const p = prefix ? `${prefix}.${k}` : k;
      // usage.pages is a map: its keys are values (page names), checked as strings.
      if (prefix === 'usage.pages') { strings.push(k); walk(v, prefix, paths, strings); continue; }
      if (!(v && typeof v === 'object' && !Array.isArray(v)) || p === 'usage.pages') paths.push(p);
      walk(v, p, paths, strings);
    }
    return { paths, strings };
  }
  if (typeof x === 'string') strings.push(x);
  return { paths, strings };
}

const LOOKS_PRIVATE: [string, RegExp][] = [
  ['a path', /[\\/]|^~|^[A-Za-z]:/],
  ['an e-mail address', /[^\s@]+@[^\s@]+/],
  ['an IPv4 address', /\b\d{1,3}(\.\d{1,3}){3}\b/],
  ['an IPv6 address', /\b[0-9a-f]{1,4}(:[0-9a-f]{0,4}){2,7}\b/i],
  ['a host name', /[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*/i],
  ['a MAC address', /\b[0-9a-f]{2}([:-][0-9a-f]{2}){5}\b/i],
];

function assertClean(p: UsagePayload) {
  const allowed = new Set(Object.keys(USAGE_SCHEMA));
  const { paths, strings } = walk(p);
  for (const path of paths) expect(allowed.has(path), `field outside the allowlist: ${path}`).toBe(true);
  for (const s of strings) {
    if (s === p.id) continue;
    for (const [what, re] of LOOKS_PRIVATE) expect(re.test(s), `"${s}" looks like ${what}`).toBe(false);
  }
}

describe('the payload', () => {
  it('has only allowlisted fields, all of them, and validates', () => {
    const p = buildPayload(inputs());
    assertClean(p);
    const v = validatePayload(p);
    expect(v.errors).toEqual([]);
    const { paths } = walk(p);
    expect(new Set(paths)).toEqual(new Set(Object.keys(USAGE_SCHEMA)));
  });

  it('coarsens and buckets what it is given', () => {
    const p = buildPayload(inputs());
    expect(p.system).toMatchObject({ os: 'linux', osVersion: '6.8', cpuVendor: 'intel', cpu: 'Intel Core i7 12th gen', ramGB: 16, gpu: 'nvidia', form: 'laptop', lang: 'et', region: 'EE' });
    expect(p.usage).toMatchObject({ active: true, days7: 3, pages: { home: '5-19', search: '1-4', settings: '100+' } });
    expect(p.usage.features).toEqual(['island', 'library', 'usageStats']);
    expect(p.health).toEqual({ crashes: 1, restarts: 0, memory: '250-500MB', cpu: '<1%', startup: '<2s' });
    expect(p.build).toEqual({ version: '0.1.0', channel: 'stable', official: false, via: 'direct' });
  });

  it('drops anything private that sneaks into the inputs', () => {
    const p = buildPayload(inputs({
      cpuModel: 'Intel /home/alice/secret.txt alice@example.com 10.0.0.7 box.local',
      locale: 'en_US.UTF-8@/etc/passwd',
      version: '1.0.0 /Users/alice',
      installSource: 'C:\\Users\\alice',
      featuresOn: ['library', '/home/alice', 'alice@example.com', 'island.example.org', 'notAFeature'],
      knownFeatures: [...FEATURES.map((f) => f.id), '/home/alice'],
      pageOpens: { '/home/alice/Documents': 3, 'alice@example.com': 2, 'host.example.org': 9, '192.168.1.4': 1, 'C:\\x': 4, search: 2 },
      cores: 100_000, displays: -3, aiProviders: 1e9, devices: NaN as unknown as number,
    }));
    assertClean(p);
    expect(validatePayload(p).errors).toEqual([]);
    expect(Object.keys(p.usage.pages)).toEqual(['search']);
    expect(p.usage.features).toEqual(['library']);
    expect(p.build.version).toBe('0.0.0');
    expect(p.build.via).toBe('direct');
  });

  it('fails validation with any extra or missing field', () => {
    const p = buildPayload(inputs());
    expect(validatePayload({ ...p, hostname: 'box' }).ok).toBe(false);
    expect(validatePayload({ ...p, system: { ...p.system, serial: 'C02X' } }).ok).toBe(false);
    expect(validatePayload({ ...p, usage: { ...p.usage, pages: { '/etc': '1-4' } } }).ok).toBe(false);
    expect(validatePayload({ ...p, usage: { ...p.usage, features: ['a b'] } }).ok).toBe(false);
    expect(validatePayload({ ...p, system: { ...p.system, cpu: 'x@y' } }).ok).toBe(false);
    expect(validatePayload({ ...p, id: 'not-a-uuid' }).ok).toBe(false);
    const { health: _h, ...rest } = p;
    expect(validatePayload(rest).ok).toBe(false);
  });

  it('validates whole bodies: one install, up to a week, no repeated days', () => {
    const a = buildPayload(inputs());
    const b = buildPayload(inputs({ now: NOW - 86_400_000 }));
    expect(validateBody({ pings: [b, a] }).ok).toBe(true);
    expect(validateBody({ pings: [a, a] }).ok).toBe(false);
    expect(validateBody({ pings: [] }).ok).toBe(false);
    expect(validateBody({ pings: [a], extra: 1 }).ok).toBe(false);
    expect(validateBody({ pings: [a, buildPayload(inputs({ now: NOW - 86_400_000, installId: uuidFromBytes(new Uint8Array(16)) }))] }).ok).toBe(false);
    expect(validateBody({ pings: Array.from({ length: 8 }, (_, i) => buildPayload(inputs({ now: NOW - i * 86_400_000 }))) }).ok).toBe(false);
  });
});

describe('coarsening', () => {
  it('names processor families, not models', () => {
    expect(coarseCpu('Apple M3 Pro', 'darwin', 'arm64')).toEqual({ vendor: 'apple', family: 'Apple M3' });
    expect(coarseCpu('Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz', 'linux', 'x64').family).toBe('Intel Core i5 8th gen');
    expect(coarseCpu('13th Gen Intel(R) Core(TM) i9-13900K', 'win32', 'x64').family).toBe('Intel Core i9 13th gen');
    expect(coarseCpu('Intel(R) Core(TM) Ultra 7 155H', 'win32', 'x64').family).toBe('Intel Core Ultra 7');
    expect(coarseCpu('AMD Ryzen 7 7840U w/ Radeon 780M Graphics', 'linux', 'x64')).toEqual({ vendor: 'amd', family: 'AMD Ryzen 7' });
    expect(coarseCpu('Snapdragon(R) X Elite - X1E78100 - Qualcomm(R) Oryon(TM) CPU', 'win32', 'arm64').family).toBe('Qualcomm Snapdragon');
    expect(coarseCpu('', 'linux', 'arm64').family).toBe('ARM');
  });
  it('rounds versions, memory, graphics and locales', () => {
    expect(coarseOsVersion('darwin', '15.1.0')).toBe('15.1');
    expect(coarseOsVersion('win32', '10.0.22631')).toBe('11');
    expect(coarseOsVersion('win32', '10.0.19045')).toBe('10');
    expect([3.7, 7.6, 15.5, 31, 128].map((g) => ramBucket(g * 1024 ** 3))).toEqual([4, 8, 16, 32, 64]);
    expect(gpuVendor([], 'darwin', 'arm64')).toBe('apple');
    expect(gpuVendor([0x8086], 'linux', 'x64')).toBe('intel');
    expect(gpuVendor([], 'linux', 'x64')).toBe('unknown');
    expect(localeParts('pt_BR.UTF-8')).toEqual({ lang: 'pt', region: 'BR' });
    expect(localeParts('zh-Hans-CN')).toEqual({ lang: 'zh', region: 'CN' });
    expect(localeParts('C')).toEqual({ lang: 'en', region: 'ZZ' });
    expect([0, 1, 4, 5, 19, 20, 99, 100].map(countBucket)).toEqual([null, '1-4', '1-4', '5-19', '5-19', '20-99', '20-99', '100+']);
  });
  it('makes v4 UUIDs', () => {
    expect(uuidFromBytes(new Uint8Array(16).fill(255))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('the queue', () => {
  it('keeps one ping per day, at most a week', () => {
    let q: UsagePayload[] = [];
    for (let d = 10; d >= 0; d--) q = enqueue(q, buildPayload(inputs({ now: NOW - d * 86_400_000 })), NOW);
    expect(q.length).toBe(7);
    expect(q[0].day).toBe('2026-10-25');
    q = enqueue(q, buildPayload(inputs({ crashes: 5 })), NOW);
    expect(q.length).toBe(7);
    expect(q[q.length - 1].health.crashes).toBe(5);
  });
});

describe('switching it off', () => {
  const env = {};
  it('the switch, KEEPER_TELEMETRY=0, DO_NOT_TRACK=1 and the policy file each turn it off', () => {
    expect(offReason({ switchOn: true, env, policy: null })).toBe(null);
    expect(offReason({ switchOn: false, env, policy: null })).toBe('switch');
    expect(offReason({ switchOn: true, env: { KEEPER_TELEMETRY: '0' }, policy: null })).toBe('env');
    expect(offReason({ switchOn: true, env: { KEEPER_TELEMETRY: 'off' }, policy: null })).toBe('env');
    expect(offReason({ switchOn: true, env: { KEEPER_TELEMETRY: '1' }, policy: null })).toBe(null);
    expect(offReason({ switchOn: true, env: { DO_NOT_TRACK: '1' }, policy: null })).toBe('dnt');
    expect(offReason({ switchOn: true, env: { DO_NOT_TRACK: '0' }, policy: null })).toBe(null);
    expect(offReason({ switchOn: true, env, policy: parsePolicy('{"usageStats": false}') })).toBe('policy');
    expect(offReason({ switchOn: true, env, policy: parsePolicy('{"telemetry": false}') })).toBe('policy');
    expect(offReason({ switchOn: true, env, policy: parsePolicy('not json') })).toBe(null);
  });
  it('the policy file sits in the system-wide place', () => {
    expect(policyPath('linux', {})).toBe('/etc/keeper/policy.json');
    expect(policyPath('darwin', {})).toBe('/Library/Application Support/Keeper/policy.json');
    expect(policyPath('win32', { ProgramData: 'C:\\ProgramData' })).toBe('C:\\ProgramData\\Keeper\\policy.json');
  });
  it('is a feature, on by default, that presets and saved sets never switch', () => {
    const s = defaultSettings([], []);
    expect(featureStates(s).get('usageStats')?.on).toBe(true);
    const off = { ...s, features: { ...(s.features ?? {}), usageStats: false } };
    expect(presetPatch(off, 'everything').features?.usageStats ?? false).toBe(false);
    expect(featureStates({ ...off, ...presetPatch(off, 'everything') }).get('usageStats')?.on).toBe(false);
    expect(featureStates({ ...off, ...setPatch(off, { features: { usageStats: true } }) }).get('usageStats')?.on).toBe(false);
  });
});

describe('the privacy page', () => {
  it('lists every field that can be sent', async () => {
    const { readFileSync } = await import('node:fs');
    const doc = readFileSync(new URL('../docs/PRIVACY-USAGE-STATS.md', import.meta.url), 'utf8');
    for (const path of Object.keys(USAGE_SCHEMA)) expect(doc, path).toContain(`| \`${path.split('.').pop()}\` |`);
  });
});
