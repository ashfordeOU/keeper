// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { enqueue, errorName, makeReport, MAX_REPORTS, nextBatch, scrubStack, signature, validateCrashBody, type CrashReport } from '../core/crash-report';
import { crashCutoff, CRASH_COLUMNS, parseCrash } from '../server/telemetry/src/logic';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const STACK = `TypeError: Cannot read properties of undefined (reading 'name') for /Users/maria.k/Documents/Taxes 2026.pdf
    at Object.render (/Applications/Keeper.app/Contents/Resources/app.asar/dist/assets/index-4f2a9c.js:12:345)
    at async Promise.all (index 0)
    at loadFile (C:\\Users\\Maria\\AppData\\Local\\Programs\\Keeper\\resources\\app.asar\\dist-electron\\main-AB12.mjs:88:9)
    at file:///home/maria/.config/Keeper/plugins/x.js:1:1
    at http://localhost:5173/src/screens/Home.tsx?t=123:40:7
    at mariaHelper (/opt/keeper/resources/app.asar/dist-electron/main.cjs:5:5)
    at sendTo maria.k@example.com (main.cjs:9:9)
    at new Watcher (node:internal/fs/watchers:247:19)
    at Array.forEach (<anonymous>)
    at 10.0.0.5 (main.cjs:1:1)`;

const report = (o: Partial<Parameters<typeof makeReport>[0]> = {}) => makeReport({ version: '1.0.0', prerelease: false, platform: 'darwin', osRelease: '15.1.0', arch: 'arm64', process: 'main', kind: 'exception', name: 'TypeError', stack: STACK, personal: ['maria'], now: NOW, ...o });

describe('scrubbing', () => {
  it('keeps only function, file name and line, never folders, the message or anything personal', () => {
    const frames = scrubStack(STACK, ['maria']);
    expect(frames).toEqual([
      'at Object.render (index-4f2a9c.js:12:345)',
      'at loadFile (main-AB12.mjs:88:9)',
      'at x.js:1:1',
      'at Home.tsx:40:7',
      'at <anonymous> (main.cjs:9:9)',
      'at Watcher (watchers:247:19)',
      'at Array.forEach (<anonymous>)',
    ]);
    const all = frames.join('\n');
    for (const bad of ['Users', 'maria', 'Maria', 'Taxes', 'AppData', 'localhost', '@', 'Cannot read', '10.0.0.5', '/', '\\']) expect(all).not.toContain(bad);
  });
  it('keeps at most 12 frames', () => {
    const long = ['Error: x', ...Array.from({ length: 40 }, (_, i) => `    at f${i} (a.js:${i + 1}:1)`)].join('\n');
    expect(scrubStack(long)).toHaveLength(12);
    expect(scrubStack(undefined)).toEqual([]);
  });
  it('names errors by class only', () => {
    expect(errorName(new TypeError('secret'))).toBe('TypeError');
    expect(errorName('RangeError: secret /Users/x')).toBe('RangeError');
    expect(errorName('something odd happened')).toBe('Error');
    expect(errorName({ name: 'bad name with spaces' })).toBe('Error');
    expect(errorName(42)).toBe('NonError');
  });
});

describe('a report', () => {
  it('has only coarse facts about the system', () => {
    const r = report();
    expect(r).toMatchObject({ version: '1.0.0', channel: 'stable', os: 'macos', osVersion: '15.1', arch: 'arm64', process: 'main', kind: 'exception', name: 'TypeError', count: 1, first: '2026-11-03', last: '2026-11-03' });
    expect(Object.keys(r).sort()).toEqual(['arch', 'channel', 'count', 'first', 'kind', 'last', 'name', 'os', 'osVersion', 'process', 'stack', 'version']);
    expect(report({ version: 'weird' }).version).toBe('0.0.0');
    expect(report({ version: '1.1.0-beta.2', prerelease: true }).channel).toBe('prerelease');
    expect(report({ platform: 'win32', osRelease: '10.0.22631' }).osVersion).toBe('11');
  });
  it('the same problem counts up instead of piling up', () => {
    let q: CrashReport[] = [];
    q = enqueue(q, report(), NOW);
    q = enqueue(q, report(), NOW);
    q = enqueue(q, report({ name: 'RangeError' }), NOW);
    expect(q).toHaveLength(2);
    expect(q[0].count).toBe(2);
    expect(signature(q[0])).not.toBe(signature(q[1]));
  });
  it('drops reports older than a week and keeps at most 50', () => {
    let q = enqueue([], report({ now: NOW - 9 * 86_400_000 }), NOW - 9 * 86_400_000);
    q = enqueue(q, report({ name: 'Other', now: NOW }), NOW);
    expect(q.map((x) => x.name)).toEqual(['Other']);
    for (let i = 0; i < 80; i++) q = enqueue(q, report({ name: `E${i}`, now: NOW }), NOW);
    expect(q).toHaveLength(50);
  });
  it('sends at most 20 at once, the most frequent first', () => {
    let q: CrashReport[] = [];
    for (let i = 0; i < 25; i++) q = enqueue(q, report({ name: `E${i}` }), NOW);
    q = enqueue(q, report({ name: 'E24' }), NOW);
    const { body, rest } = nextBatch(q);
    expect(body.reports).toHaveLength(MAX_REPORTS);
    expect(body.reports[0].name).toBe('E24');
    expect(rest).toHaveLength(5);
  });
});

describe('the one check', () => {
  const body = () => ({ v: 1, reports: [report()] });
  it('accepts what the app makes', () => {
    expect(validateCrashBody(body()).ok).toBe(true);
  });
  it('refuses anything else', () => {
    const bad = (mut: (b: ReturnType<typeof body>) => unknown) => { const b = body(); const x = mut(b) ?? b; return validateCrashBody(x).ok; };
    expect(bad((b) => ({ ...b, installId: 'x' }))).toBe(false);
    expect(bad((b) => { (b.reports[0] as unknown as Record<string, unknown>).message = 'secret'; })).toBe(false);
    expect(bad((b) => { b.reports[0].stack = ['at f (/Users/maria/x.js:1:1)']; })).toBe(false);
    expect(bad((b) => { b.reports[0].stack = ['at f (x.js:1:1)', 'at maria@example.com (x.js:1:1)']; })).toBe(false);
    expect(bad((b) => { b.reports[0].name = 'Error: secret'; })).toBe(false);
    expect(bad((b) => { b.reports[0].osVersion = '15.1.2'; })).toBe(false);
    expect(bad((b) => { b.reports[0].process = 'evil' as never; })).toBe(false);
    expect(bad((b) => { b.reports[0].count = 0; })).toBe(false);
    expect(bad(() => ({ v: 1, reports: [] }))).toBe(false);
    expect(bad((b) => ({ v: 1, reports: Array.from({ length: 21 }, () => b.reports[0]) }))).toBe(false);
  });
});

describe('POST /v1/crash', () => {
  const req = (b: unknown, extra: Partial<Parameters<typeof parseCrash>[0]> = {}) => {
    const text = typeof b === 'string' ? b : JSON.stringify(b);
    return parseCrash({ contentType: 'application/json', declaredLength: text.length, text, now: NOW, ...extra });
  };
  it('stores one row per report with no ID or address', async () => {
    const r = await req({ v: 1, reports: [report(), report({ kind: 'window-error', process: 'window', name: 'RangeError' })] });
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.rows).toHaveLength(2);
    expect(Object.keys(r.rows[0]).sort()).toEqual([...CRASH_COLUMNS].sort());
    expect(CRASH_COLUMNS.some((c) => /ip|addr|host|agent|install|header|user/i.test(c))).toBe(false);
    expect(r.rows[0].signature).toMatch(/^[0-9a-f]{24}$/);
    expect(JSON.parse(r.rows[0].stack)[0]).toBe('at Object.render (index-4f2a9c.js:12:345)');
  });
  it('refuses wrong types, sizes and days', async () => {
    expect((await req({ v: 1, reports: [report()] }, { contentType: 'text/plain' })).status).toBe(415);
    expect((await req('x'.repeat(30_000))).status).toBe(413);
    expect((await req('{nope')).status).toBe(400);
    expect((await req({ v: 1, reports: [{ ...report(), first: '2026-01-01', last: '2026-01-02' }] })).status).toBe(400);
    expect((await req({ v: 1, reports: [{ ...report(), first: '2026-11-03', last: '2026-12-01' }] })).status).toBe(400);
  });
  it('keeps reports 90 days', () => {
    expect(crashCutoff(NOW)).toBe('2026-08-05');
  });
});

describe('the worker', () => {
  /** A stand-in for D1 that records what is written. */
  function fakeDb() {
    const writes: { sql: string; args: unknown[] }[] = [];
    const prep = (sql: string) => {
      let args: unknown[] = [];
      const p = {
        bind: (...a: unknown[]) => { args = a; return p; },
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => { writes.push({ sql, args }); return {}; },
      };
      return p;
    };
    return { writes, db: { prepare: prep, batch: async (ss: { run(): Promise<unknown> }[]) => Promise.all(ss.map((s) => s.run())) } };
  }
  it('stores reports from POST /v1/crash and nothing about the sender', async () => {
    const { default: worker } = await import('../server/telemetry/src/worker');
    const { writes, db } = fakeDb();
    const body = JSON.stringify({ v: 1, reports: [report()] });
    const res = await worker.fetch(new Request('https://telemetry.example/v1/crash', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'x' }, body }), { DB: db } as never);
    expect(res.status).toBe(200);
    const ins = writes.filter((w) => /INSERT INTO crashes/.test(w.sql));
    expect(ins).toHaveLength(1);
    expect(JSON.stringify(ins[0].args)).not.toMatch(/203\.0\.113\.9|"x"/);
    const bad = await worker.fetch(new Request('https://telemetry.example/v1/crash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, reports: [{ ...report(), message: 'secret' }] }) }), { DB: db } as never);
    expect(bad.status).toBe(400);
    expect((await worker.fetch(new Request('https://telemetry.example/v1/crash'), { DB: db } as never)).status).toBe(405);
  });
  it('the daily job deletes crash reports older than 90 days', async () => {
    const { default: worker } = await import('../server/telemetry/src/worker');
    const { writes, db } = fakeDb();
    let job: Promise<unknown> | undefined;
    await worker.scheduled({}, { DB: db } as never, { waitUntil: (p) => { job = p; } });
    await job;
    expect(writes.some((w) => /DELETE FROM crashes WHERE received_day < \?/.test(w.sql))).toBe(true);
  });
});
