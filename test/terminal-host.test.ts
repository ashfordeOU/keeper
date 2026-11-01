// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The terminal session host as a real process, spoken to over its real socket:
// creating terminals, live output with offsets, several viewers, resizing,
// refusing strangers, and scrollback saved and restored across a restart.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { HostClient } from '../electron/services/terminal/client';
import { encode, socketPath, type HostMsg } from '../core/terminal/protocol';
import type { SessionInfo } from '../core/terminal/types';

const win = process.platform === 'win32';
const out = path.join(__dirname, '..', 'node_modules', '.cache', 'keeper-test', 'term-host.cjs');
let data: string;
let sock: string;
let host: ChildProcess | undefined;

async function startHost() {
  host = spawn(process.execPath, [out], { env: { ...process.env, KEEPER_HOST_DATA: data, KEEPER_HOST_SOCKET: sock }, stdio: 'ignore' });
  const c = new HostClient(sock, path.join(data, 'terminal', 'host.token'), 'app');
  for (let i = 0; i < 100; i++) {
    try {
      await c.connect(1000);
      return c;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error('host did not start');
}

const shellLaunch = (cmd: string) => (win
  ? { file: 'cmd.exe', args: ['/d', '/c', cmd], cwd: os.tmpdir(), env: { ...process.env } as Record<string, string> }
  : { file: '/bin/sh', args: ['-c', cmd], cwd: os.tmpdir(), env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.homedir(), FOO: 'from-profile' } });

const spec = { profile: { id: 'p', name: 'Test', shell: 'custom' }, cols: 80, rows: 24 };

function collect(c: HostClient, id: string) {
  const got = { text: '', exit: undefined as number | undefined, chunks: [] as { at: number; len: number }[] };
  const prev = c.onMessage;
  c.onMessage = (m: HostMsg) => {
    prev(m);
    if (m.t === 'data' && m.id === id) {
      got.chunks.push({ at: m.at, len: m.data.length });
      got.text += m.data;
    }
    if (m.t === 'exit' && m.id === id) got.exit = m.code;
  };
  return got;
}

const until = async (fn: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

beforeAll(async () => {
  await build({ entryPoints: [path.join(__dirname, '..', 'electron', 'terminal-host.ts')], outfile: out, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['node-pty'], logLevel: 'silent' });
  data = mkdtempSync(path.join(os.tmpdir(), 'keeper-term-'));
  sock = socketPath(data, process.platform, `test${process.pid}`);
}, 60_000);

afterAll(() => {
  host?.kill('SIGKILL');
  rmSync(data, { recursive: true, force: true });
});

describe('terminal session host', () => {
  it('runs terminals, streams output with offsets and saves scrollback for next time', async () => {
    const c = await startHost();
    expect(c.hostPid).toBeGreaterThan(0);

    // A program that prints, waits and prints again, so output arrives in pieces.
    const info = await c.request<SessionInfo>({ t: 'create', spec, launch: shellLaunch(win ? 'echo first & ping -n 2 127.0.0.1 >nul & echo second %FOO%' : 'echo first; sleep 0.3; echo "second $FOO"; sleep 0.3'), scrollback: 1000 });
    const got = collect(c, info.id);
    const snap = await c.request<{ data: string; total: number; info: SessionInfo }>({ t: 'attach', id: info.id });
    await until(() => got.exit !== undefined);
    const all = snap.data + got.text.slice(Math.max(0, snap.total - (got.chunks[0]?.at ?? snap.total)));
    expect(all).toContain('first');
    if (!win) expect(all).toContain('second from-profile');
    // Offsets run on without gaps.
    for (let i = 1; i < got.chunks.length; i++) expect(got.chunks[i].at).toBe(got.chunks[i - 1].at + got.chunks[i - 1].len);

    // A second viewer gets everything so far as one snapshot.
    const again = await c.request<{ data: string; total: number }>({ t: 'attach', id: info.id });
    expect(again.data).toContain('first');
    expect(again.total).toBe(again.data.length);

    // A long-running terminal that stays alive; resizing is accepted.
    const live = await c.request<SessionInfo>({ t: 'create', spec, launch: shellLaunch(win ? 'ping -n 30 127.0.0.1 >nul' : 'echo ready; sleep 30'), scrollback: 1000 });
    c.post({ t: 'resize', id: live.id, cols: 120, rows: 40 });
    await new Promise((r) => setTimeout(r, 300));
    const listed = await c.request<SessionInfo[]>({ t: 'list' });
    expect(listed.find((s) => s.id === live.id)).toMatchObject({ cols: 120, rows: 40 });
    expect(listed.find((s) => s.id === info.id)?.exit?.code).toBe(0);

    // Someone without the token is cut off.
    const stranger = await new Promise<boolean>((resolve) => {
      const s = net.connect(sock, () => s.write(encode({ t: 'hello', token: 'wrong', client: 'x' })));
      s.on('close', () => resolve(true));
      s.on('data', () => resolve(false));
      s.on('error', () => resolve(true));
    });
    expect(stranger).toBe(true);

    // Stop with saving: the terminals come back as read-only scrollback after a restart.
    await c.request({ t: 'shutdown', save: true });
    await until(() => host!.exitCode !== null || host!.signalCode !== null);
    expect(existsSync(path.join(data, 'terminal', 'sessions.json.gz'))).toBe(true);

    const c2 = await startHost();
    const restored = await c2.request<SessionInfo[]>({ t: 'list' });
    const back = restored.find((s) => s.id === info.id);
    expect(back?.restored).toBe(true);
    const snap2 = await c2.request<{ data: string }>({ t: 'attach', id: info.id });
    expect(snap2.data).toContain('first');
    await c2.request({ t: 'shutdown', save: false });
  }, 40_000);
});
