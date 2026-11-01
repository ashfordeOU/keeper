// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The usage stats server's checks and aggregation, as plain functions (no Cloudflare runtime).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURES } from '../core/features';
import { buildPayload, uuidFromBytes, type TelemetryInputs } from '../core/telemetry';
import { aggregate, authorized, dailySummary, parsePing, rateDecision, retentionCutoff, ROW_COLUMNS, rowOf, type PingRow } from '../server/telemetry/src/logic';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const DAY = 86_400_000;
const id = (n: number) => uuidFromBytes(new Uint8Array(16).map((_, i) => (i * 31 + n * 7) & 255));

function payload(over: Partial<TelemetryInputs> = {}) {
  return buildPayload({
    installId: id(1), now: NOW, version: '0.1.0', official: true, installSource: 'brew', platform: 'darwin', osRelease: '15.1.0', arch: 'arm64',
    cpuModel: 'Apple M3', cores: 8, totalMemBytes: 16 * 1024 ** 3, gpuVendorIds: [], hasBattery: true, displays: 1, notch: true, locale: 'en-GB',
    activeDays: [new Date(over.now ?? NOW).toISOString().slice(0, 10)], featuresOn: ['library', 'island'], knownFeatures: FEATURES.map((f) => f.id),
    pageOpens: { home: 3 }, aiProviders: 0, devices: 0, crashes: 0, restarts: 0, avgMemoryBytes: 300 * 1048576, avgCpuPct: 0.5, startupMs: 1500, ...over,
  });
}

const req = (body: unknown, extra: Partial<Parameters<typeof parsePing>[0]> = {}) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return parsePing({ contentType: 'application/json', declaredLength: text.length, text, now: NOW, ...extra });
};

describe('POST /v1/ping', () => {
  it('accepts a valid report and makes one row per day, with no address in it', () => {
    const r = req({ pings: [payload({ now: NOW - DAY }), payload()] });
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.rows.map((x) => x.day)).toEqual(['2026-10-30', '2026-10-31']);
    expect(Object.keys(r.rows[0]).sort()).toEqual([...ROW_COLUMNS].sort());
    expect(Object.keys(r.rows[0]).some((k) => /ip|addr|host|agent|header/i.test(k))).toBe(false);
  });
  it('rejects anything outside the schema, too large, or not JSON', () => {
    expect(req({ pings: [{ ...payload(), hostname: 'box' }] }).status).toBe(400);
    expect(req({ pings: [payload()], ip: '1.2.3.4' }).status).toBe(400);
    expect(req('{nope').status).toBe(400);
    expect(req({ pings: [payload()] }, { contentType: 'text/plain' }).status).toBe(415);
    expect(req({ pings: [payload()] }, { declaredLength: 10_000_000 }).status).toBe(413);
    expect(req(JSON.stringify({ pings: [payload()], pad: 'x'.repeat(40_000) })).status).toBe(413);
  });
  it('refuses days in the future or older than a week', () => {
    expect(req({ pings: [payload({ now: NOW + 3 * DAY })] }).status).toBe(400);
    expect(req({ pings: [payload({ now: NOW - 9 * DAY })] }).status).toBe(400);
  });
  it('rate-limits each install ID', () => {
    let w: { window_start: number; count: number } | null = null;
    const allowed: boolean[] = [];
    for (let i = 0; i < 8; i++) { const d = rateDecision(w, NOW + i * 1000); allowed.push(d.allowed); w = d; }
    expect(allowed).toEqual([true, true, true, true, true, true, false, false]);
    expect(rateDecision(w, NOW + 3_600_000).allowed).toBe(true);
  });
});

describe('GET /v1/stats', () => {
  it('needs the bearer token', () => {
    const token = 'a'.repeat(32);
    expect(authorized(`Bearer ${token}`, token)).toBe(true);
    expect(authorized(`Bearer ${token}x`, token)).toBe(false);
    expect(authorized(null, token)).toBe(false);
    expect(authorized('Bearer short', 'short')).toBe(false);
  });

  it('aggregates installs, breakdowns, features, pages, crashes and builds', () => {
    const rows: PingRow[] = [];
    const add = (n: number, daysAgo: number, over: Partial<TelemetryInputs> = {}) => rows.push(rowOf(payload({ installId: id(n), now: NOW - daysAgo * DAY, ...over }), NOW));
    add(1, 0); add(1, 1); add(1, 2);
    add(2, 0, { platform: 'win32', osRelease: '10.0.22631', arch: 'x64', cpuModel: 'AMD Ryzen 7 7840U', totalMemBytes: 32 * 1024 ** 3, official: false, featuresOn: ['library'], pageOpens: { home: 30, search: 2 }, crashes: 2, hasBattery: false });
    add(3, 5, { platform: 'linux', osRelease: '6.8.0', arch: 'x64', cpuModel: 'Intel(R) Core(TM) i5-8250U', locale: 'de-DE', installSource: 'flatpak' });
    add(4, 20);
    add(5, 40); // outside the 30-day window
    const s = aggregate(rows, '2026-10-31');
    expect(s.active).toEqual({ daily: 2, weekly: 3, monthly: 4 });
    expect(s.series.length).toBe(30);
    expect(s.series[s.series.length - 1]).toEqual({ day: '2026-10-31', installs: 2 });
    expect(s.by.os.find((x) => x.key === 'macos')).toMatchObject({ count: 2, pct: 50 });
    expect(s.by.osVersion.map((x) => x.key)).toContain('windows 11');
    expect(s.by.machine.map((x) => x.key).sort()).toEqual(['AMD Ryzen 7', 'Apple M3', 'Intel Core i5 8th gen']);
    expect(s.by.ram.find((x) => x.key === '32 GB')?.count).toBe(1);
    expect(s.by.form.find((x) => x.key === 'desktop')?.count).toBe(1);
    expect(s.by.region.find((x) => x.key === 'DE')?.count).toBe(1);
    expect(s.features.find((x) => x.key === 'library')?.pct).toBe(100);
    expect(s.features.find((x) => x.key === 'island')?.pct).toBe(75);
    expect(s.pages[0]).toMatchObject({ key: 'home', count: 4 });
    expect(s.pages.find((x) => x.key === 'search')).toMatchObject({ count: 1, opens: 3 });
    expect(s.health.installDays).toBe(6);
    expect(s.health.crashDaysPct).toBeCloseTo(16.7, 1);
    expect(s.health.crashesPer100).toBeCloseTo(33.3, 1);
    expect(s.builds).toEqual({ official: 3, unofficial: 1 });
    // What is kept for good holds no install IDs.
    const kept = dailySummary(s);
    for (let n = 1; n <= 5; n++) expect(kept.data.includes(id(n))).toBe(false);
  });

  it('deletes raw rows after 13 months', () => {
    expect(retentionCutoff(Date.parse('2026-10-15T12:00:00Z'))).toBe('2025-09-15');
  });
});

describe('the server uses the app’s own schema', () => {
  it('imports core/telemetry.ts rather than a copy', () => {
    const src = readFileSync(new URL('../server/telemetry/src/logic.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/from '\.\.\/\.\.\/\.\.\/core\/telemetry'/);
    const worker = readFileSync(new URL('../server/telemetry/src/worker.ts', import.meta.url), 'utf8');
    // Never reads the client's address, never logs.
    expect(worker.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/cf-connecting-ip|x-forwarded-for|x-real-ip|request\.cf|req\.cf|console\./i);
  });
  it('stores every schema field in its own column', () => {
    const sql = readFileSync(new URL('../server/telemetry/schema.sql', import.meta.url), 'utf8');
    for (const c of ROW_COLUMNS) expect(sql).toMatch(new RegExp(`\\n\\s+${c}\\s`));
  });
});
