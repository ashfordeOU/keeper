// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The usage tracker's sources: the coding CLIs' local files (5-hour blocks,
// weeks, status-line limits, Codex's rate-limit snapshots) and each
// service's documented response (recorded JSON in test/fixtures/usage-tracker).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeTokenLines } from '../core/island-tools/usage';
import {
  anthropicCostUsd, anthropicUsageTokens, apiMonthLimits, ccLocalWindows, ccOAuth, ccStatusLine, codexLatest, codexSnapshots, costLimits, dailyLimits, deepseekBalance, durationMs,
  httpLimits, jsonPath, keeperLimits, mergeExact, monthStartUtc, nextMonthUtc, openaiCostsUsd, openaiUsage, openrouterKey, parseRateHeaders, rateLimits, serviceOf, toMs, xaiBalance,
} from '../core/usage-tracker/sources';

const FIX = path.join(__dirname, 'fixtures', 'usage-tracker');
const text = (f: string) => readFileSync(path.join(FIX, f), 'utf8');
const json = (f: string) => JSON.parse(text(f));
const NOW = Date.parse('2026-11-01T12:00:00Z');
const H = 3600_000;

describe('the Anthropic coding CLI on this computer', () => {
  const lines = claudeTokenLines(text('cc-session.jsonl'));

  it('reads token lines once each (streamed duplicates and half-written lines skipped)', () => {
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.tokens)).toEqual([200, 1000, 10_000, 5000]);
  });

  it('works out the 5-hour block (from the hour of its first message) and the last 7 days', () => {
    const [five, week] = ccLocalWindows(lines, NOW);
    expect(five.used).toBe(15_000);
    expect(five.resetsAt).toBe(Date.parse('2026-11-01T13:00:00Z'));
    expect(five.windowMs).toBe(5 * H);
    expect(five.usedPercent).toBeUndefined();
    expect(five.estimated).toBe(true);
    expect(week.label).toBe('Last 7 days');
    expect(week.used).toBe(16_000);
    expect(week.resetsAt).toBeUndefined();
  });

  it('estimates the share against plan limits the person entered', () => {
    const [five, week] = ccLocalWindows(lines, NOW, { fiveHourTokens: 20_000, weeklyTokens: 64_000 });
    expect(five.usedPercent).toBe(75);
    expect(week.usedPercent).toBe(25);
  });

  it('follows a learned weekly reset, moved to the current week', () => {
    // Learned three weeks ago: Wednesday 00:00 UTC.
    const learned = Date.parse('2026-10-14T00:00:00Z');
    const [, week] = ccLocalWindows(lines, NOW, {}, learned);
    expect(week.label).toBe('Weekly');
    expect(week.resetsAt).toBe(Date.parse('2026-11-04T00:00:00Z'));
    // The week began 2026-10-28 00:00, so the 10-28 message counts.
    expect(week.used).toBe(16_000);
  });

  it('reads exact limits from the status-line data (and drops passed windows)', () => {
    const l = ccStatusLine(json('cc-status.json'), NOW);
    expect(l.map((x) => x.key)).toEqual(['5h', 'weekly', 'spend']);
    expect(l[0]).toMatchObject({ label: '5-hour', usedPercent: 71.5, resetsAt: 1793563200_000, windowMs: 5 * H });
    expect(l[2]).toMatchObject({ used: 20, limit: 50, unit: 'usd', usedPercent: 40 });
    expect(ccStatusLine(json('cc-status.json'), 1793563200_000 + 1).map((x) => x.key)).toEqual(['weekly', 'spend']);
    expect(ccStatusLine({ model: {} }, NOW)).toEqual([]);
  });

  it('merges exact shares with local token counts', () => {
    const merged = mergeExact(ccLocalWindows(lines, NOW), ccStatusLine(json('cc-status.json'), NOW));
    const five = merged.find((x) => x.key === '5h')!;
    expect(five.usedPercent).toBe(71.5);
    expect(five.used).toBe(15_000);
    expect(five.estimated).toBeUndefined();
    expect(merged.some((x) => x.key === 'spend')).toBe(true);
  });

  it('maps the sign-in usage answer to the same keys', () => {
    const l = ccOAuth({ five_hour: { utilization: 42, resets_at: '2026-11-01T15:00:00Z' }, seven_day: { utilization: 0.5, resets_at: '2026-11-05T00:00:00Z' } });
    expect(l.map((x) => x.key)).toEqual(['5h', 'weekly']);
    expect(l[0].windowMs).toBe(5 * H);
  });
});

describe('Codex rate-limit logs', () => {
  const snaps = codexSnapshots(text('codex-rollout.jsonl'), NOW);

  it('reads every snapshot, older and newer shapes', () => {
    expect(snaps).toHaveLength(3);
    // Older shape: resets_in_seconds counts from the line's own time.
    expect(snaps[0].limits[0]).toMatchObject({ key: '5h', usedPercent: 10, resetsAt: Date.parse('2026-11-01T10:05:00Z') });
    expect(snaps[0].limits[1]).toMatchObject({ key: 'weekly', usedPercent: 50 });
  });

  it('keeps the newest per limit id, with credits and the plan', () => {
    const l = codexLatest(snaps)!;
    expect(l.plan).toBe('plus');
    expect(l.limits.map((x) => x.key)).toEqual(['5h', 'weekly', 'credits', 'codex_other:5h']);
    expect(l.limits[0]).toMatchObject({ usedPercent: 64, resetsAt: 1793556000_000, windowMs: 5 * H });
    expect(l.limits[1]).toMatchObject({ label: 'Weekly', usedPercent: 97, windowMs: 7 * 24 * H });
    expect(l.limits[2]).toMatchObject({ used: 42, unit: 'credits' });
    expect(l.limits[3].label).toBe('Other model 5-hour');
  });

  it('ignores lines without limits and broken lines', () => {
    expect(codexSnapshots('{"type":"x"}\nnot json rate_limits\n', NOW)).toEqual([]);
    expect(codexLatest([])).toBeUndefined();
  });
});

describe('other tools on this computer', () => {
  it('counts daily requests against an allowance', () => {
    const lines = [{ at: NOW - H, tokens: 10 }, { at: NOW - 2 * H, tokens: 20 }, { at: NOW - 3 * 86_400_000, tokens: 5 }];
    const [day, week] = dailyLimits(lines, NOW, 4);
    expect(day).toMatchObject({ used: 2, limit: 4, usedPercent: 50, unit: 'requests' });
    expect(week.used).toBe(35);
  });

  it('adds up the month’s cost against a budget', () => {
    const [month] = costLimits([{ at: NOW - H, tokens: 1, cost: 2.5 }, { at: NOW - 40 * 86_400_000, tokens: 1, cost: 99 }], NOW, 10);
    expect(month).toMatchObject({ used: 2.5, limit: 10, usedPercent: 25, unit: 'usd' });
  });
});

describe('service responses (recorded)', () => {
  it('Anthropic Admin API: tokens and cost (cents → dollars)', () => {
    expect(anthropicUsageTokens(json('anthropic-usage.json')).tokens).toBe(3200);
    const c = anthropicCostUsd(json('anthropic-cost.json'));
    expect(c.usd).toBeCloseTo(20, 6);
    expect(c.byDay['2026-11-01']).toBeCloseTo(15, 6);
  });

  it('OpenAI organization usage and costs', () => {
    expect(openaiUsage(json('openai-usage.json'))).toEqual({ tokens: 150_957, requests: 470 });
    expect(openaiCostsUsd(json('openai-costs.json')).usd).toBeCloseTo(12.6308, 3);
  });

  it('a month of spend against the budget resets at the start of the next UTC month', () => {
    const [cost, tokens] = apiMonthLimits({ usd: 30, tokens: 9, budget: 40 }, NOW);
    expect(cost).toMatchObject({ usedPercent: 75, resetsAt: Date.parse('2026-12-01T00:00:00Z'), windowMs: 30 * 86_400_000 });
    expect(tokens.usedPercent).toBeUndefined();
    expect(monthStartUtc(NOW)).toBe(Date.parse('2026-11-01T00:00:00Z'));
    expect(nextMonthUtc(Date.parse('2026-12-31T23:00:00Z'))).toBe(Date.parse('2027-01-01T00:00:00Z'));
  });

  it('OpenRouter key: credits left, the reset period and free requests', () => {
    const l = openrouterKey(json('openrouter-key.json'), NOW);
    expect(l[0]).toMatchObject({ key: 'credits', label: 'Monthly credits', limit: 50, unit: 'usd', resetsAt: Date.parse('2026-12-01T00:00:00Z') });
    expect(l[0].used).toBeCloseTo(12.4, 6);
    expect(l[0].usedPercent).toBeCloseTo(24.8, 6);
    expect(l[1]).toMatchObject({ key: 'free-daily', used: 12, limit: 1000, resetsAt: Date.parse('2026-11-02T00:00:00Z') });
    expect(l.find((x) => x.key === 'month-cost')?.used).toBe(12.4);
    expect(openrouterKey({ data: { limit: null, limit_remaining: null, usage_monthly: 3 } }, NOW).map((x) => x.key)).toEqual(['month-cost']);
  });

  it('DeepSeek balance, with and without the amount topped up', () => {
    expect(deepseekBalance(json('deepseek-balance.json'))[0]).toMatchObject({ label: 'Balance left', used: 7.5, unit: 'usd' });
    expect(deepseekBalance(json('deepseek-balance.json'), 10)[0]).toMatchObject({ used: 2.5, limit: 10, usedPercent: 25 });
  });

  it('xAI prepaid balance (negative cents are credit)', () => {
    expect(xaiBalance(json('xai-balance.json'))[0]).toMatchObject({ used: 18, unit: 'usd' });
    const topped = xaiBalance(json('xai-balance.json'), 25)[0];
    expect(topped).toMatchObject({ limit: 25, note: '$18.00 left' });
    expect(topped.used).toBeCloseTo(7, 6);
    expect(topped.usedPercent).toBeCloseTo(28, 6);
    expect(xaiBalance({})).toEqual([]);
  });

  it('a custom JSON endpoint with named fields', () => {
    const [l] = httpLimits(json('custom.json'), { url: 'x', used: '$.data.quota.used', limit: 'data.quota.limit', reset: '$.data.quota.resets_at', label: 'Monthly requests', unit: 'requests' }, NOW);
    expect(l).toMatchObject({ label: 'Monthly requests', used: 340, limit: 500, usedPercent: 68, resetsAt: Date.parse('2026-12-01T00:00:00Z') });
    expect(httpLimits({ p: 12 }, { url: 'x', used: 'p', percent: true }, NOW)[0].usedPercent).toBe(12);
    expect(httpLimits({}, { url: 'x', used: 'nope' }, NOW)).toEqual([]);
  });

  it('JSONPath-style lookups and times', () => {
    expect(jsonPath({ a: [{ b: 1 }, { b: 2 }] }, '$.a[1].b')).toBe(2);
    expect(jsonPath({ 'x-y': { z: 3 } }, "['x-y'].z")).toBe(3);
    expect(jsonPath(null, 'a.b')).toBeUndefined();
    expect(toMs(1793563200, NOW)).toBe(1793563200_000);
    expect(toMs('90', NOW)).toBe(NOW + 90_000);
    expect(toMs('2026-11-02T00:00:00Z', NOW)).toBe(Date.parse('2026-11-02T00:00:00Z'));
  });

  it('Keeper’s own calls this month', () => {
    const l = keeperLimits([{ calls: 3, input: 100, output: 50, cost: 0.25 }, { calls: 1, input: 10, output: 5 }], NOW, 1);
    expect(l[0]).toMatchObject({ key: 'month-cost', used: 0.25, usedPercent: 25 });
    expect(l[1].used).toBe(165);
    expect(l[2].used).toBe(4);
  });
});

describe('rate-limit headers on Keeper’s own calls', () => {
  it('reads OpenAI-style headers with durations', () => {
    const h: Record<string, string> = { 'x-ratelimit-limit-requests': '60', 'x-ratelimit-remaining-requests': '45', 'x-ratelimit-reset-requests': '6m0s', 'x-ratelimit-limit-tokens': '150000', 'x-ratelimit-remaining-tokens': '149000', 'x-ratelimit-reset-tokens': '400ms' };
    const r = parseRateHeaders((n) => h[n], NOW)!;
    expect(r.requests).toEqual({ limit: 60, remaining: 45, resetsAt: NOW + 360_000 });
    expect(r.tokens?.resetsAt).toBe(NOW + 400);
    const l = rateLimits(r, NOW);
    expect(l[0]).toMatchObject({ key: 'rpm', used: 15, limit: 60, usedPercent: 25 });
    // Old readings and passed windows are dropped.
    expect(rateLimits(r, NOW + 11 * 60_000)).toEqual([]);
  });

  it('reads Anthropic-style headers with dates', () => {
    const h: Record<string, string> = { 'anthropic-ratelimit-requests-limit': '50', 'anthropic-ratelimit-requests-remaining': '49', 'anthropic-ratelimit-requests-reset': '2026-11-01T12:01:00Z' };
    expect(parseRateHeaders((n) => h[n], NOW)?.requests).toEqual({ limit: 50, remaining: 49, resetsAt: NOW + 60_000 });
    expect(parseRateHeaders(() => undefined, NOW)).toBeUndefined();
    expect(durationMs('1m30.5s')).toBe(90_500);
    expect(durationMs('soon')).toBeUndefined();
  });

  it('knows which service a connection belongs to', () => {
    expect(serviceOf('https://api.groq.com/openai/v1')).toBe('groq');
    expect(serviceOf('https://api.x.ai/v1')).toBe('xai');
    expect(serviceOf('anthropic')).toBe('anthropic-api');
    expect(serviceOf('https://generativelanguage.googleapis.com/v1beta/openai')).toBe('gemini-api');
    expect(serviceOf('http://localhost:1234/v1')).toBeUndefined();
  });
});

describe('unofficial sources (opt-in, recorded answers)', () => {
  it('Copilot: premium requests left this month (unlimited quotas skipped)', async () => {
    const { copilotQuota } = await import('../core/island-tools/usage');
    const { fromUsageWindows } = await import('../core/usage-tracker/sources');
    const l = fromUsageWindows(copilotQuota(json('copilot-user.json')));
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ key: 'premium-requests', label: 'Premium requests', used: 264, limit: 300, usedPercent: 88, unit: 'requests', resetsAt: Date.parse('2026-12-01') });
  });

  it('Cursor: requests used against the monthly allowance', async () => {
    const { cursorUsage } = await import('../core/island-tools/usage');
    const { fromUsageWindows } = await import('../core/usage-tracker/sources');
    const l = fromUsageWindows(cursorUsage(json('cursor-usage.json')));
    expect(l[0]).toMatchObject({ key: 'premium-requests', used: 410, limit: 500, usedPercent: 82, resetsAt: Date.parse('2026-11-15T00:00:00.000Z') });
    expect(l[1]).toMatchObject({ key: 'gpt-3-5-turbo-requests', used: 12, limit: undefined, usedPercent: undefined });
  });

  it('Gemini CLI: Code Assist quota buckets', async () => {
    const { geminiQuota } = await import('../core/usage-tracker/sources');
    const l = geminiQuota(json('gemini-quota.json'), NOW);
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ key: 'quota:gemini-2.5-pro:requests', label: 'gemini-2.5-pro requests', usedPercent: 75, resetsAt: Date.parse('2026-11-02T00:00:00Z'), note: '25 left' });
    expect(l[1].usedPercent).toBeCloseTo(10, 6);
    expect(geminiQuota({}, NOW)).toEqual([]);
  });
});
