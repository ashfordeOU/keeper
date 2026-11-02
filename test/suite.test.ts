// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The suite's rules (core/suite.ts) and its channel (electron/suite/channel.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, PARTS, frame, initialStatus, isPartRole, restartExit, roleOf, splitFrames, step, tokenMatches, validHello, type PartEvent, type PartStatus, type RestartPolicy } from '../core/suite';
import { connect, listen, readCoreInfo, roleRunning, socketPath, takeRoleLock, writeCoreInfo, type Peer } from '../electron/suite/channel';

function run(events: [PartEvent, number][], policy: RestartPolicy = DEFAULT_POLICY, from: PartStatus = initialStatus()) {
  let s = from;
  const actions: string[] = [];
  for (const [e, at] of events) {
    const r = step(s, e, at, policy);
    s = r.status;
    actions.push(r.action.do === 'schedule' ? `schedule ${r.action.inMs}` : r.action.do);
  }
  return { s, actions };
}

describe('suite: roles', () => {
  it('reads the role flag, and anything else is the app', () => {
    expect(roleOf(['/x/Keeper', '--keeper-role=island'])).toBe('island');
    expect(roleOf(['/x/Keeper', '.', '--keeper-role=widgets'])).toBe('widgets');
    expect(roleOf(['/x/Keeper', '--keeper-role=../../etc'])).toBe('app');
    expect(roleOf(['/x/Keeper', '--hidden'])).toBe('app');
    expect(roleOf(['/x/Keeper', '--keeper-role=mail'])).toBe('mail');
    expect(roleOf(['/x/Keeper', '--keeper-role=app'])).toBe('app');
  });

  it('every part has a name and the features it serves, its own switch first', () => {
    expect(PARTS.map((p) => p.role)).toEqual(['island', 'widgets', 'mail']);
    for (const p of PARTS) {
      expect(isPartRole(p.role)).toBe(true);
      expect(p.features[0]).toBe(p.feature);
    }
    expect(PARTS.find((p) => p.role === 'mail')!.features).toEqual(expect.arrayContaining(['mail', 'calendars', 'alarms']));
    expect(isPartRole('app')).toBe(false);
    expect(isPartRole(undefined)).toBe(false);
  });
});

describe('suite: the supervisor’s state machine', () => {
  it('starts a wanted part, and it runs once it says hello', () => {
    const { s, actions } = run([[{ type: 'want', on: true }, 0], [{ type: 'spawned', pid: 10 }, 5], [{ type: 'hello', pid: 10 }, 50]]);
    expect(actions).toEqual(['spawn', 'none', 'none']);
    expect(s).toMatchObject({ state: 'running', wanted: true, pid: 10, startedAt: 50 });
  });

  it('stops a part switched off, and the exit that follows is not a crash', () => {
    const { s, actions } = run([[{ type: 'want', on: true }, 0], [{ type: 'hello', pid: 10 }, 1], [{ type: 'want', on: false }, 2], [{ type: 'exited', reason: 'quit' }, 3]]);
    expect(actions).toEqual(['spawn', 'none', 'stop', 'none']);
    expect(s.state).toBe('off');
    expect(s.crashes).toEqual([]);
    expect(s.lastCrash).toBeUndefined();
  });

  it('restarts a crashed part after a wait that grows with each crash in a row', () => {
    const p: RestartPolicy = { ...DEFAULT_POLICY, backoffMs: [100, 1000, 5000], maxCrashes: 10, stableMs: 60_000 };
    let s = run([[{ type: 'want', on: true }, 0], [{ type: 'hello', pid: 1 }, 0]], p).s;
    const waits: number[] = [];
    let t = 0;
    for (let i = 0; i < 4; i++) {
      t += 10;
      const r = step(s, { type: 'exited', reason: 'killed' }, t, p);
      expect(r.status.state).toBe('waiting');
      waits.push(r.action.do === 'schedule' ? r.action.inMs : -1);
      // Too early: wait the rest.
      const early = step(r.status, { type: 'timer' }, t + 1, p);
      expect(early.action.do).toBe('schedule');
      t += waits[i];
      const again = step(r.status, { type: 'timer' }, t, p);
      expect(again.action.do).toBe('spawn');
      s = step(again.status, { type: 'hello', pid: 2 + i }, t, p).status;
    }
    expect(waits).toEqual([100, 1000, 5000, 5000]);
    expect(s.restarts).toBe(4);
    expect(s.lastCrash?.reason).toBe('killed');
  });

  it('a part that ran a good while starts the backoff from the beginning again', () => {
    const p: RestartPolicy = { ...DEFAULT_POLICY, backoffMs: [100, 1000], stableMs: 60_000 };
    let r = run([[{ type: 'want', on: true }, 0], [{ type: 'hello', pid: 1 }, 0], [{ type: 'exited', reason: 'x' }, 10], [{ type: 'timer' }, 200], [{ type: 'hello', pid: 2 }, 200]], p);
    expect(r.s.crashes.length).toBe(1);
    r = run([[{ type: 'exited', reason: 'y' }, 120_000]], p, r.s);
    expect(r.actions).toEqual(['schedule 100']);
  });

  it('gives up after too many crashes, until restarted by hand or switched on again', () => {
    const p: RestartPolicy = { ...DEFAULT_POLICY, backoffMs: [10], maxCrashes: 3, windowMs: 60_000, stableMs: 60_000 };
    let s = run([[{ type: 'want', on: true }, 0], [{ type: 'hello', pid: 1 }, 0]], p).s;
    let t = 0;
    for (let i = 0; i < 4; i++) {
      s = step(s, { type: 'exited', reason: 'boom' }, (t += 20), p).status;
      if (s.state === 'waiting') s = step(step(s, { type: 'timer' }, (t += 20), p).status, { type: 'hello', pid: 5 }, t, p).status;
    }
    expect(s.state).toBe('failed');
    expect(step(s, { type: 'timer' }, t + 1000, p).action.do).toBe('none');
    // The Restart button.
    const r = step(s, { type: 'restart' }, t + 2000, p);
    expect(r.action.do).toBe('spawn');
    expect(r.status.crashes).toEqual([]);
    // Or: off and on again.
    const off = step(s, { type: 'want', on: false }, t + 2000, p).status;
    expect(off.state).toBe('off');
    expect(step(off, { type: 'want', on: true }, t + 3000, p).action.do).toBe('spawn');
  });

  it('crashes long ago do not count against the limit', () => {
    const p: RestartPolicy = { ...DEFAULT_POLICY, backoffMs: [10], maxCrashes: 2, windowMs: 1000, stableMs: 1e9 };
    let s = run([[{ type: 'want', on: true }, 0], [{ type: 'hello', pid: 1 }, 0]], p).s;
    for (const t of [10, 5000, 10_000, 15_000]) {
      s = step(s, { type: 'exited', reason: 'x' }, t, p).status;
      expect(s.state).toBe('waiting');
      s = step(step(s, { type: 'timer' }, t + 20, p).status, { type: 'hello', pid: 2 }, t + 20, p).status;
    }
  });

  it('a restart by hand stops the part and brings it straight back, without counting a crash', () => {
    let { s } = run([[{ type: 'want', on: true }, 0], [{ type: 'hello', pid: 1 }, 0]]);
    const r = step(s, { type: 'restart' }, 10);
    expect(r.action.do).toBe('stop');
    s = r.status;
    const back = step(s, restartExit(s), 20);
    expect(back.action.do).toBe('spawn');
    expect(back.status.crashes).toEqual([]);
    expect(back.status.state).toBe('starting');
  });

  it('a part that never says hello is stopped and counted as a crash', () => {
    let { s } = run([[{ type: 'want', on: true }, 0]]);
    const r = step(s, { type: 'startTimeout' }, 30_000);
    expect(r.action.do).toBe('stop');
    s = step(r.status, { type: 'exited', reason: 'did not start' }, 30_100).status;
    expect(s.state).toBe('waiting');
    expect(s.crashes.length).toBe(1);
  });

  it('a part that is not wanted is told to go when it says hello (one left from an earlier run)', () => {
    const r = step(initialStatus(), { type: 'hello', pid: 7 }, 0);
    expect(r.action.do).toBe('stop');
    expect(step(r.status, { type: 'exited', reason: 'quit' }, 1).status.state).toBe('off');
  });

  it('switching off while waiting to restart cancels the restart', () => {
    let { s } = run([[{ type: 'want', on: true }, 0], [{ type: 'hello', pid: 1 }, 0], [{ type: 'exited', reason: 'x' }, 10]]);
    expect(s.state).toBe('waiting');
    s = step(s, { type: 'want', on: false }, 20).status;
    expect(s.state).toBe('off');
    expect(step(s, { type: 'timer' }, 10_000).action.do).toBe('none');
  });
});

describe('suite: messages', () => {
  it('frames survive being split and joined anywhere', () => {
    const msgs = [{ t: 'ping' }, { t: 'call', id: 1, channel: 'island.state', args: [new Uint8Array([1, 2, 3]), new Map([['a', 1]]), new Date(5)] }, { t: 'event', channel: 'event:x', args: ['é'.repeat(1000)] }];
    const bytes = Buffer.concat(msgs.map((m) => frame(v8.serialize(m))));
    for (const cut of [1, 3, 4, 5, 17, bytes.length - 1]) {
      const a = splitFrames(bytes.subarray(0, cut));
      const b = splitFrames(Buffer.concat([a.rest, bytes.subarray(cut)]));
      const got = [...a.frames, ...b.frames].map((f) => v8.deserialize(f));
      expect(got).toEqual(msgs);
      expect(b.rest.length).toBe(0);
    }
  });

  it('refuses a frame that claims to be enormous', () => {
    expect(() => splitFrames(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0]))).toThrow(/too large/);
  });

  it('checks the token and the first message', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abc', 'abd')).toBe(false);
    expect(tokenMatches('', '')).toBe(false);
    expect(tokenMatches('ab', 'abc')).toBe(false);
    expect(validHello({ t: 'hello', role: 'island', token: 'x', pid: 1 })).toBe(true);
    expect(validHello({ t: 'hello', role: 'mail', token: 'x', pid: 1 })).toBe(true);
    expect(validHello({ t: 'hello', role: 'app', token: 'x', pid: 1 })).toBe(false);
    expect(validHello({ t: 'hello', role: 'island', token: 5, pid: 1 })).toBe(false);
    expect(validHello({ t: 'call', id: 1 })).toBe(false);
    expect(validHello(null)).toBe(false);
  });
});

describe('suite: the channel', () => {
  const dirs: string[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-suite-')); dirs.push(d); return d; };

  it('carries messages both ways, Buffers and all', async () => {
    const dir = tmp();
    const sock = socketPath(dir, 'app-test');
    let server: Peer | null = null;
    const srv = await listen(sock, (p) => { server = p; p.onMessage((m) => { if (m.t === 'call') p.send({ t: 'result', id: m.id, ok: true, value: { echo: m.args[0] } }); }); });
    cleanups.push(() => srv.close());
    const c = await connect(sock);
    cleanups.push(() => c.close());
    const got = new Promise((r) => c.onMessage((m) => r(m)));
    c.send({ t: 'call', id: 9, channel: 'x', args: [Buffer.from('hello')] });
    const m = (await got) as { t: string; id: number; value: { echo: Uint8Array } };
    expect(m.t).toBe('result');
    expect(Buffer.from(m.value.echo).toString()).toBe('hello');
    expect(server).not.toBeNull();
    if (process.platform !== 'win32') expect(fs.statSync(sock).mode & 0o777).toBe(0o600);
  });

  it('an answer that cannot cross between processes fails the call, not the channel', async () => {
    const dir = tmp();
    const sock = socketPath(dir, 'app-test2');
    const srv = await listen(sock, (p) => p.onMessage((m) => { if (m.t === 'call') p.send({ t: 'result', id: m.id, ok: true, value: { fn: () => 1 } }); }));
    cleanups.push(() => srv.close());
    const c = await connect(sock);
    cleanups.push(() => c.close());
    const got = new Promise((r) => c.onMessage((m) => r(m)));
    c.send({ t: 'call', id: 1, channel: 'x', args: [] });
    expect(await got).toMatchObject({ t: 'result', id: 1, ok: false });
    expect(c.isClosed).toBe(false);
  });

  it('closes on garbage', async () => {
    const dir = tmp();
    const sock = socketPath(dir, 'app-test3');
    let peer: Peer | null = null;
    const srv = await listen(sock, (p) => { peer = p; });
    cleanups.push(() => srv.close());
    const c = await connect(sock);
    c.sock.write(Buffer.from([0, 0, 0, 3, 0xff, 0xfe, 0xfd]));
    await c.closedP;
    expect(peer!.isClosed).toBe(true);
  });

  it('one copy of each part: the second finds the first, and a lock left by a crash is taken over', async () => {
    const dir = tmp();
    const first = await takeRoleLock(dir, 'island');
    expect(first).not.toBeNull();
    expect(await roleRunning(dir, 'island')).toBe(true);
    expect(await takeRoleLock(dir, 'island')).toBeNull();
    // Another part has a lock of its own.
    const w = await takeRoleLock(dir, 'widgets');
    expect(w).not.toBeNull();
    w!.close();
    await new Promise<void>((r) => first!.close(() => r()));
    expect(await roleRunning(dir, 'island')).toBe(false);
    if (process.platform !== 'win32') {
      // A crash leaves the socket file behind: nobody answers, so it is taken over.
      fs.writeFileSync(socketPath(dir, 'part-island'), '');
      const again = await takeRoleLock(dir, 'island');
      expect(again).not.toBeNull();
      again!.close();
    }
  });

  it('keeps what a part needs to reach the app private', () => {
    const dir = tmp();
    writeCoreInfo(dir, { pid: 1, socket: '/x', token: 't', version: '1' });
    expect(readCoreInfo(dir)).toEqual({ pid: 1, socket: '/x', token: 't', version: '1' });
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(dir, 'suite', 'core.json')).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.join(dir, 'suite')).mode & 0o777).toBe(0o700);
    }
  });

  it('socket paths stay short enough for Unix', () => {
    const long = path.join(os.tmpdir(), 'x'.repeat(150));
    expect(socketPath(long, 'part-island', 'linux').length).toBeLessThan(105);
    expect(socketPath('C:\\Users\\a\\AppData\\Roaming\\Keeper', 'app-1', 'win32')).toMatch(/^\\\\\.\\pipe\\keeper-[0-9a-f]{12}-app-1$/);
  });
});
