// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// scripts/notarize-mac.mjs: an app is sent to Apple once; every retry or re-run waits on the
// submission ID it recorded (written before any waiting), and Invalid is final. Run with a
// stand-in for ditto and xcrun: nothing here talks to Apple.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without type declarations
import { backoffMs, decide, deadlineFrom, notarizeApp, readRecords, submissionName, waitForResult, zipPath } from '../scripts/notarize-mac.mjs';

type Rec = { id: string; sha256: string; version: string; arch: string; edition: string; commit?: string; submittedAt: string; status?: string };
type Result = { code: number; stdout: string; stderr: string };
type Call = { cmd: string; args: string[] };

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const rec = (over: Partial<Rec> = {}): Rec => ({ id: 'id-1', sha256: SHA_A, version: '1.0.1', arch: 'arm64', edition: 'core', commit: 'c1', submittedAt: '2026-11-03T10:00:00.000Z', ...over });
const base = { sha256: SHA_A, version: '1.0.1', arch: 'arm64', edition: 'core', commit: 'c1', hasZip: () => false };

describe('decide: send, wait on a recorded ID, or put the sent app back', () => {
  it('sends only when no record matches', () => {
    expect(decide({ ...base, records: [] })).toEqual({ action: 'submit', superseded: undefined });
    // Another version or processor is never reused.
    expect(decide({ ...base, records: [rec({ version: '1.0.0' }), rec({ arch: 'x64' })] }).action).toBe('submit');
  });

  it('waits on the recorded ID when Apple already has these exact bytes', () => {
    expect(decide({ ...base, records: [rec()] })).toEqual({ action: 'wait', record: rec() });
    // The offline edition's app, byte for byte the core one: the core submission is reused.
    expect(decide({ ...base, edition: 'full', records: [rec()] })).toMatchObject({ action: 'wait', record: { id: 'id-1', edition: 'core' } });
  });

  it('a re-run of the same commit (re-signed, so other bytes) puts the sent app back instead of sending again', () => {
    const records = [rec(), rec({ id: 'id-2', submittedAt: '2026-11-03T11:00:00.000Z' })];
    const r = decide({ ...base, sha256: SHA_B, records, hasZip: () => true });
    expect(r).toMatchObject({ action: 'restore', record: { id: 'id-2' } });
    // Not for another edition, another commit, or a local build without a commit.
    expect(decide({ ...base, sha256: SHA_B, edition: 'full', records, hasZip: () => true }).action).toBe('submit');
    expect(decide({ ...base, sha256: SHA_B, commit: 'c2', records, hasZip: () => true }).action).toBe('submit');
    expect(decide({ ...base, sha256: SHA_B, commit: '', records, hasZip: () => true }).action).toBe('submit');
  });

  it('names the earlier submission when its app is gone and a new one has to be sent', () => {
    expect(decide({ ...base, sha256: SHA_B, records: [rec()], hasZip: () => false })).toMatchObject({ action: 'submit', superseded: { id: 'id-1' } });
  });
});

describe('waitForResult', () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => { t += ms; }, advance: (ms: number) => { t += ms; } };
  };

  it('retries network errors with backoff and never submits', async () => {
    const c = clock();
    const calls: string[][] = [];
    let n = 0;
    const notarytool = async (args: string[]): Promise<Result> => {
      calls.push(args);
      if (args[0] === 'wait') n++;
      if (n <= 2) return { code: 1, stdout: '', stderr: 'Error: NSURLErrorDomain Code=-1009 The Internet connection appears to be offline.' };
      return { code: 0, stdout: '{"status":"Accepted","id":"id-1"}', stderr: '' };
    };
    await expect(waitForResult({ id: 'id-1', deadline: 60 * 60_000, notarytool, now: c.now, sleep: c.sleep })).resolves.toEqual({ status: 'Accepted' });
    expect(calls.some((a) => a[0] === 'submit')).toBe(false);
    expect(c.now()).toBe(backoffMs(1) + backoffMs(2));
  });

  it('stops at the deadline with "timeout"', async () => {
    const c = clock();
    const notarytool = async (args: string[]): Promise<Result> => {
      if (args[0] === 'wait') c.advance(Number(args[3].replace('m', '')) * 60_000);
      return { code: args[0] === 'wait' ? 1 : 0, stdout: '{"status":"In Progress"}', stderr: '' };
    };
    await expect(waitForResult({ id: 'id-1', deadline: 300 * 60_000, notarytool, now: c.now, sleep: c.sleep })).resolves.toEqual({ status: 'timeout' });
    expect(c.now()).toBe(300 * 60_000);
  });

  it('wrong credentials stop at once instead of waiting out the budget', async () => {
    const c = clock();
    const notarytool = async (): Promise<Result> => ({ code: 1, stdout: '', stderr: 'Error: HTTP status code: 401. Unable to authenticate.' });
    await expect(waitForResult({ id: 'id-1', deadline: 300 * 60_000, notarytool, now: c.now, sleep: c.sleep })).rejects.toThrow(/refused submission id-1/);
  });
});

/** A stand-in for ditto and xcrun: the app's bytes are a marker file; Apple answers from `apple`. */
function harness(opts: { bytes?: string; statuses?: string[]; history?: { id: string; name: string; createdDate: string }[]; submit?: Result } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-notary-'));
  dirs.push(root);
  const app = path.join(root, 'out', 'Keeper.app');
  const dir = path.join(root, '.notary');
  const state = { bytes: opts.bytes ?? 'signed-1', statuses: [...(opts.statuses ?? ['Accepted'])], submits: 0, calls: [] as Call[], recordsAtWait: [] as Rec[][] };
  const writeApp = (bytes: string) => {
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'bytes'), bytes);
  };
  writeApp(state.bytes);
  let t = Date.parse('2026-11-03T12:00:00Z');
  const run = async (cmd: string, args: string[]): Promise<Result> => {
    state.calls.push({ cmd, args: args.filter((a) => !['--apple-id', 'me@example.com', '--password', 'secret', '--team-id', 'D69G45342Y'].includes(a)) });
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    if (cmd === 'ditto' && args[0] === '-c') {
      fs.writeFileSync(args[4], fs.readFileSync(path.join(args[3], 'bytes')));
      return ok();
    }
    if (cmd === 'ditto' && args[0] === '-x') {
      writeApp(fs.readFileSync(args[2], 'utf8'));
      return ok();
    }
    const [tool, sub] = args;
    if (tool === 'notarytool' && sub === 'history') return ok(JSON.stringify({ history: opts.history ?? [] }));
    if (tool === 'notarytool' && sub === 'submit') {
      state.submits++;
      return opts.submit ?? ok(JSON.stringify({ id: `sub-${state.submits}`, message: 'Successfully uploaded file' }));
    }
    if (tool === 'notarytool' && sub === 'wait') {
      state.recordsAtWait.push(readRecords(dir));
      const status = state.statuses.length > 1 ? state.statuses.shift()! : state.statuses[0];
      if (status === 'In Progress') t += Number(args[4].replace('m', '')) * 60_000;
      return { code: status === 'In Progress' ? 1 : 0, stdout: JSON.stringify({ status, id: args[2] }), stderr: '' };
    }
    if (tool === 'notarytool' && sub === 'info') return ok(JSON.stringify({ status: state.statuses[0], id: args[2] }));
    if (tool === 'notarytool' && sub === 'log') return ok('{"issues":[{"message":"The binary is not signed."}]}');
    if (tool === 'stapler') return ok('The staple and validate action worked!');
    return { code: 1, stdout: '', stderr: `unexpected ${cmd} ${args.join(' ')}` };
  };
  const logs: string[] = [];
  const go = (over: Record<string, unknown> = {}) => notarizeApp({
    app, version: '1.0.1', arch: 'arm64', edition: 'core', commit: 'c1', dir, deadline: t + 300 * 60_000,
    credentials: ['--apple-id', 'me@example.com', '--password', 'secret', '--team-id', 'D69G45342Y'],
    run, now: () => t, sleep: async (ms: number) => { t += ms; }, log: (l: string) => logs.push(l), ...over,
  });
  return { app, dir, state, go, logs, writeApp };
}

describe('notarizeApp', () => {
  it('sends a new app once, records the ID before waiting, then staples', async () => {
    const h = harness();
    const r = await h.go();
    expect(r).toMatchObject({ id: 'sub-1', status: 'Accepted', action: 'submit' });
    expect(h.state.submits).toBe(1);
    // The record existed when the first wait began.
    expect(h.state.recordsAtWait[0]).toEqual([expect.objectContaining({ id: 'sub-1', version: '1.0.1', arch: 'arm64', edition: 'core', commit: 'c1' })]);
    const sent = h.state.calls.find((c) => c.args[1] === 'submit')!;
    expect(sent.args).toEqual(['notarytool', 'submit', expect.stringMatching(/Keeper-1\.0\.1-arm64-core-[0-9a-f]{12}\.zip$/), '--no-wait', '--output-format', 'json']);
    expect(h.state.calls.some((c) => c.cmd === 'xcrun' && c.args.join(' ') === `stapler staple ${h.app}`)).toBe(true);
    expect(readRecords(h.dir)).toEqual([expect.objectContaining({ id: 'sub-1', status: 'Accepted' })]);
    // Credentials never reach the log.
    expect(h.logs.join('\n')).not.toContain('secret');
  });

  it('the same bytes again: no submission, it waits on the recorded ID', async () => {
    const h = harness();
    await h.go();
    const r = await h.go();
    expect(r).toMatchObject({ id: 'sub-1', action: 'wait' });
    expect(h.state.submits).toBe(1);
  });

  it('the offline edition with the same app reuses the core submission', async () => {
    const h = harness();
    await h.go();
    expect(await h.go({ edition: 'full' })).toMatchObject({ id: 'sub-1', action: 'wait' });
    expect(h.state.submits).toBe(1);
    // With other contents it gets its own, single submission.
    h.writeApp('signed-full');
    expect(await h.go({ edition: 'full' })).toMatchObject({ id: 'sub-2', action: 'submit' });
    expect(h.state.submits).toBe(2);
  });

  it('a re-run after the budget ran out waits on the same ID with the app that was sent', async () => {
    const h = harness({ statuses: ['In Progress'] });
    await expect(h.go()).rejects.toThrow(/sub-1 within the notarization budget\. Re-run the failed job: it waits on sub-1 again and sends nothing new/);
    expect(readRecords(h.dir)).toEqual([expect.objectContaining({ id: 'sub-1', status: 'In Progress' })]);
    expect(fs.existsSync(zipPath(h.dir, readRecords(h.dir)[0]))).toBe(true);
    // The re-run signs again: other bytes. The sent app is put back and its ID waited on.
    h.writeApp('signed-2');
    h.state.statuses = ['Accepted'];
    const r = await h.go();
    expect(r).toMatchObject({ id: 'sub-1', action: 'restore', status: 'Accepted' });
    expect(h.state.submits).toBe(1);
    expect(fs.readFileSync(path.join(h.app, 'bytes'), 'utf8')).toBe('signed-1');
  });

  it('Invalid prints the log and fails without sending again; a re-run fails the same way', async () => {
    const h = harness({ statuses: ['Invalid'] });
    await expect(h.go()).rejects.toThrow(/sub-1 is Invalid .*not sent again/);
    expect(h.logs.join('\n')).toContain('The binary is not signed.');
    expect(h.state.calls.filter((c) => c.args[1] === 'wait')).toHaveLength(1);
    expect(h.state.calls.some((c) => c.args[0] === 'stapler')).toBe(false);
    expect(readRecords(h.dir)[0].status).toBe('Invalid');
    await expect(h.go()).rejects.toThrow(/Invalid/);
    expect(h.state.submits).toBe(1);
  });

  it('a submission whose answer was lost is found in history by its name, not sent again', async () => {
    const probe = harness();
    await probe.go();
    const name = submissionName(readRecords(probe.dir)[0]);
    const h = harness({ history: [{ id: 'lost-1', name, createdDate: '2026-11-03T09:00:00Z' }] });
    expect(await h.go()).toMatchObject({ id: 'lost-1', action: 'submit' });
    expect(h.state.submits).toBe(0);
  });

  it('a failed submit records nothing', async () => {
    const h = harness({ submit: { code: 1, stdout: '', stderr: 'Error: upload failed' } });
    await expect(h.go()).rejects.toThrow(/notarytool submit failed/);
    expect(readRecords(h.dir)).toEqual([]);
  });

  it('the budget: a deadline from the workflow, or minutes from now (300 by default)', () => {
    expect(deadlineFrom({}, { KEEPER_NOTARY_DEADLINE: '1000' }, 0)).toBe(1_000_000);
    expect(deadlineFrom({}, {}, 0)).toBe(300 * 60_000);
    expect(deadlineFrom({ 'budget-minutes': '10' }, {}, 0)).toBe(600_000);
  });
});
