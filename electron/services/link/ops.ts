// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote actions between your own devices, over Keeper Link: run a saved
// command ("Run commands" permission, off by default; the owner sees each new
// command once), a terminal ("Terminal on this device"), lock / sleep /
// restart and printing ("Control this computer"), and a system snapshot.
// Every one is written to the audit log on both devices. Plain Node.

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promises as fsp, statfsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clipOutput, powerCommand, printable, printCommand, shellCommand, type PowerAction, type SysInfo } from '../../../core/link/actions';
import { commandHash } from '../../../core/link/fleet';
import { call, type Stream } from '../../../core/link/mux';
import { safeName } from '../../../core/link/transfer';
import { parseControl, TermReader, termControl, termFrame, TERM_CTL, TERM_DATA, type TermControl } from '../../../core/link/term';
import type { LinkNode } from './node';

export interface OpsDeps {
  /** show the owner a command the first time a device asks to run it */
  approveCommand(deviceName: string, command: string): Promise<boolean>;
  /** a pseudo-terminal, when node-pty is available */
  pty?(shell: string, args: string[], cols: number, rows: number, cwd: string): PtyLike | null;
  /** runs the argument list (tests replace it) */
  run?(file: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }>;
  version: string;
  battery?(): Promise<{ percent: number; charging: boolean } | undefined>;
  /** a remote command or terminal started or ended (for the Island) */
  notify?(title: string, body: string): void;
}

export interface PtyLike {
  onData(fn: (d: string) => void): void;
  onExit(fn: (e: { exitCode: number }) => void): void;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

function runFile(file: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: process.env }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? ((err as unknown as { code: number }).code) : err.killed ? null : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err && !stdout ? err.message : '') });
    });
  });
}

export function installOps(node: LinkNode, deps: OpsDeps) {
  const run = deps.run ?? runFile;
  const nameOf = (device: string) => node.peer(device)?.name ?? 'A device';

  // ---- run a command
  node.registerRpc('exec.run', 'runCommands', async (p) => {
    const device = String(p.$device ?? '');
    const command = String(p.command ?? '').trim().slice(0, 4000);
    if (!command) throw new Error('No command');
    const who = nameOf(device);
    const hash = commandHash(command);
    if (!node.isApproved(device, hash)) {
      const ok = await deps.approveCommand(who, command);
      if (!ok) {
        node.audit({ kind: 'command', direction: 'in', device, deviceName: who, title: `${who} asked to run a command; you said no`, detail: command, ok: false });
        throw new Error(`${node.data.name} did not allow this command`);
      }
      node.approve(device, hash);
    }
    const timeout = Math.max(1000, Math.min(10 * 60_000, Number(p.timeoutMs) || 60_000));
    const t0 = Date.now();
    const sh = shellCommand(command, process.platform);
    const r = await run(sh.file, sh.args, timeout);
    const res: ExecResult = { code: r.code, stdout: clipOutput(r.stdout), stderr: clipOutput(r.stderr, 50_000), ms: Date.now() - t0 };
    node.audit({ kind: 'command', direction: 'in', device, deviceName: who, title: `${who} ran a command (exit ${r.code ?? 'timed out'})`, detail: command, ok: r.code === 0 });
    return res;
  });

  // ---- power
  for (const action of ['lock', 'sleep', 'restart'] as PowerAction[]) {
    node.registerRpc(`power.${action}`, 'screenControl', async (p) => {
      const device = String(p.$device ?? '');
      const who = nameOf(device);
      const c = powerCommand(action, process.platform);
      node.audit({ kind: 'power', direction: 'in', device, deviceName: who, title: `${who} chose ${action === 'lock' ? 'Lock' : action === 'sleep' ? 'Sleep' : 'Restart'}`, ok: true });
      deps.notify?.(`${who} chose ${action}`, action === 'restart' ? 'This computer restarts in a few seconds.' : '');
      // Answer first: after sleep or restart there is nobody to answer.
      setTimeout(() => void run(c.file, c.args, 20_000), 300).unref?.();
      return { ok: true };
    });
  }

  // ---- system snapshot
  node.registerRpc('sys.info', null, async () => snapshot(node.data.name, deps));

  // ---- print a file on the default printer
  node.registerStream('print', 'screenControl', (st, device) => void receivePrint(node, st, device, run));

  // ---- terminal
  node.registerStream('term', 'terminal', (st, device) => hostTerminal(node, st, device, deps));
}

async function snapshot(name: string, deps: OpsDeps): Promise<SysInfo> {
  const disks: SysInfo['disks'] = [];
  for (const mount of process.platform === 'win32' ? ['C:\\'] : ['/', os.homedir()]) {
    try {
      const s = statfsSync(mount);
      if (!disks.some((d) => d.total === s.blocks * s.bsize && d.free === s.bavail * s.bsize)) disks.push({ mount, total: s.blocks * s.bsize, free: s.bavail * s.bsize });
    } catch {
      /* not there */
    }
  }
  const cpus = os.cpus();
  return {
    name,
    os: ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[process.platform] ?? process.platform,
    release: os.release(),
    arch: process.arch,
    cpus: cpus.length,
    cpuModel: cpus[0]?.model?.trim() ?? '',
    memTotal: os.totalmem(),
    memFree: os.freemem(),
    uptime: os.uptime(),
    load: os.loadavg(),
    disks,
    battery: await deps.battery?.().catch(() => undefined),
    user: os.userInfo().username,
    keeper: deps.version,
    at: Date.now(),
  };
}

async function receivePrint(node: LinkNode, st: Stream, device: string, run: NonNullable<OpsDeps['run']>) {
  const who = node.peer(device)?.name ?? 'A device';
  const name = safeName(String(st.meta.name ?? 'document'));
  const size = Number(st.meta.size) || 0;
  if (size > 200 * 1024 * 1024) return st.reset('Too large to print');
  if (!printable(name)) {
    node.audit({ kind: 'print', direction: 'in', device, deviceName: who, title: `${who} tried to print ${name} here; that kind of file is not printed`, ok: false });
    return st.end({ ok: false, error: 'This kind of file cannot be printed remotely. Send a PDF, a picture, text or an Office document.' });
  }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-print-'));
  const file = path.join(dir, name);
  try {
    const { data } = await st.readAll(200 * 1024 * 1024);
    await fsp.writeFile(file, data);
    const c = printCommand(file, process.platform);
    const r = await run(c.file, c.args, 60_000);
    node.audit({ kind: 'print', direction: 'in', device, deviceName: who, title: `${who} printed ${name} here`, ok: r.code === 0, detail: r.code === 0 ? undefined : r.stderr.slice(0, 300) });
    st.end(r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim().slice(0, 300) || 'The printer did not take it' });
  } catch (e) {
    st.end({ ok: false, error: e instanceof Error ? e.message : String(e) });
  } finally {
    // The printing system has its own copy once it is queued.
    setTimeout(() => void fsp.rm(dir, { recursive: true, force: true }), 120_000).unref?.();
  }
}

function hostTerminal(node: LinkNode, st: Stream, device: string, deps: OpsDeps) {
  const who = node.peer(device)?.name ?? 'A device';
  let pty: PtyLike | null = null;
  let child: ChildProcess | null = null;
  let ended = false;
  const t0 = Date.now();
  const out = (d: string | Uint8Array) => void st.write(termFrame(TERM_DATA, typeof d === 'string' ? d : d)).catch(() => undefined);
  const finish = (code: number | null, reason?: string) => {
    if (ended) return;
    ended = true;
    void st.write(termControl({ t: 'exit', code, reason })).catch(() => undefined).finally(() => st.end());
    node.audit({ kind: 'terminal', direction: 'in', device, deviceName: who, title: `${who} used a terminal here for ${Math.max(1, Math.round((Date.now() - t0) / 60_000))} min`, ok: true });
  };
  const open = (c: Extract<TermControl, { t: 'open' }>) => {
    const shell = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL && /^\/[\w/.-]+$/.test(process.env.SHELL) ? process.env.SHELL : '/bin/sh';
    const cwd = os.homedir();
    pty = deps.pty?.(shell, process.platform === 'win32' ? [] : ['-l'], c.cols, c.rows, cwd) ?? null;
    if (pty) {
      pty.onData((d) => out(d));
      pty.onExit((e) => finish(e.exitCode));
    } else {
      // Without node-pty: a pseudo-terminal from `script` on Linux, plain pipes elsewhere (macOS's script needs a real terminal as its input).
      const viaScript = process.platform === 'linux' ? { file: 'script', args: ['-qfc', `${shell} -i`, '/dev/null'] } : process.platform === 'darwin' ? { file: shell, args: ['-i'] } : { file: shell, args: [] };
      child = spawn(viaScript.file, viaScript.args, { cwd, env: { ...process.env, TERM: 'xterm-256color', COLUMNS: String(c.cols), LINES: String(c.rows) }, windowsHide: true });
      child.stdout?.on('data', (d: Buffer) => out(new Uint8Array(d)));
      child.stderr?.on('data', (d: Buffer) => out(new Uint8Array(d)));
      child.on('exit', (code) => finish(code));
      child.on('error', (e) => finish(null, e.message));
    }
    deps.notify?.(`${who} opened a terminal here`, 'It runs as you. Close it from Devices.');
    node.audit({ kind: 'terminal', direction: 'in', device, deviceName: who, title: `${who} opened a terminal here`, ok: true });
  };
  const rd = new TermReader((kind, body) => {
    if (kind === TERM_DATA) {
      const s = new TextDecoder().decode(body);
      if (pty) pty.write(s);
      else child?.stdin?.write(s);
      return;
    }
    if (kind === TERM_CTL) {
      const c = parseControl(body);
      if (!c) return;
      if (c.t === 'open' && !pty && !child) open(c);
      if (c.t === 'resize') pty?.resize(c.cols, c.rows);
    }
  });
  st.ondata = (c) => {
    try {
      rd.push(c);
    } catch {
      st.reset('bad terminal frame');
    }
  };
  st.onend = () => {
    pty?.kill();
    child?.kill();
    finish(null, 'closed');
  };
  st.onreset = () => {
    pty?.kill();
    child?.kill();
    ended = true;
  };
  void st.start();
}

// ---------------------------------------------------------------- the calling side

export async function remoteExec(node: LinkNode, device: string, command: string, timeoutMs = 60_000): Promise<ExecResult> {
  const who = node.peer(device)?.name ?? device;
  try {
    const r = await call<ExecResult>(await node.connect(device), 'exec.run', { command, timeoutMs }, timeoutMs + 5 * 60_000);
    node.audit({ kind: 'command', direction: 'out', device, deviceName: who, title: `Ran a command on ${who} (exit ${r.code ?? 'timed out'})`, detail: command, ok: r.code === 0 });
    return r;
  } catch (e) {
    node.audit({ kind: 'command', direction: 'out', device, deviceName: who, title: `A command on ${who} was refused`, detail: `${command}\n${e instanceof Error ? e.message : String(e)}`, ok: false });
    throw e;
  }
}

export async function remotePower(node: LinkNode, device: string, action: PowerAction) {
  const who = node.peer(device)?.name ?? device;
  await call(await node.connect(device), `power.${action}`, {}, 15_000);
  node.audit({ kind: 'power', direction: 'out', device, deviceName: who, title: `${action === 'lock' ? 'Locked' : action === 'sleep' ? 'Put to sleep' : 'Restarted'} ${who}`, ok: true });
}

export async function remoteInfo(node: LinkNode, device: string): Promise<SysInfo> {
  return call<SysInfo>(await node.connect(device), 'sys.info', {}, 15_000);
}

export async function remotePrint(node: LinkNode, device: string, file: string): Promise<void> {
  const who = node.peer(device)?.name ?? device;
  const data = await fsp.readFile(file);
  const st = (await node.connect(device)).open({ k: 'print', name: path.basename(file), size: data.length });
  const reply = st.readAll(64 * 1024);
  await st.write(data);
  st.end();
  const { trailer } = await reply;
  const t = (trailer ?? {}) as { ok?: boolean; error?: string };
  node.audit({ kind: 'print', direction: 'out', device, deviceName: who, title: `Printed ${path.basename(file)} on ${who}`, ok: !!t.ok, detail: t.error });
  if (!t.ok) throw new Error(t.error ?? 'It was not printed');
}

/** A terminal on another device: returns functions to type, resize and close; output arrives through onData. */
export async function remoteTerminal(node: LinkNode, device: string, cols: number, rows: number, onData: (d: Uint8Array) => void, onExit: (code: number | null, reason?: string) => void) {
  const who = node.peer(device)?.name ?? device;
  const st = (await node.connect(device)).open({ k: 'term' });
  const rd = new TermReader((kind, body) => {
    if (kind === TERM_DATA) onData(body);
    else if (kind === TERM_CTL) {
      const c = parseControl(body);
      if (c?.t === 'exit') onExit(c.code, c.reason);
    }
  });
  let closed = false;
  st.ondata = (c) => rd.push(c);
  st.onend = () => {
    if (!closed) onExit(null);
    closed = true;
  };
  st.onreset = (r) => {
    if (!closed) onExit(null, r === 'not allowed' ? `${who} does not allow a terminal from this device. Turn on “Terminal on this device” there.` : r);
    closed = true;
  };
  void st.start();
  await st.write(termControl({ t: 'open', cols, rows }));
  node.audit({ kind: 'terminal', direction: 'out', device, deviceName: who, title: `Opened a terminal on ${who}`, ok: true });
  return {
    write: (s: string) => void st.write(termFrame(TERM_DATA, s)).catch(() => undefined),
    resize: (c: number, r: number) => void st.write(termControl({ t: 'resize', cols: c, rows: r })).catch(() => undefined),
    close: () => {
      closed = true;
      st.end();
    },
  };
}

// ---------------------------------------------------------------- a terminal from a phone (companion page)

/**
 * A paired phone's Terminal tab: only for phones allowed under Devices →
 * Phone ("Terminal from this phone"). The page polls for output (the
 * companion channel is request and answer).
 */
export function installCompanionTerminal(node: LinkNode, deps: Pick<OpsDeps, 'pty'> & { enabled: () => boolean }) {
  const terms = new Map<string, { cid: string; buf: string; base: number; exit?: string; pty?: PtyLike | null; child?: ChildProcess; used: number }>();
  const reap = setInterval(() => {
    for (const [id, t] of terms) if (Date.now() - t.used > 10 * 60_000) {
      t.pty?.kill();
      t.child?.kill();
      terms.delete(id);
    }
  }, 60_000);
  reap.unref?.();
  const get = (cid: string, id: unknown) => {
    const t = terms.get(String(id));
    if (!t || t.cid !== cid) throw new Error('No such terminal');
    t.used = Date.now();
    return t;
  };
  node.registerCompanionOp('term.open', async (h, _b, cid) => {
    if (!deps.enabled() || !node.companionTerminal(cid)) throw new Error('This computer does not let this phone open a terminal. Turn it on in Keeper → Devices → Phone.');
    const id = Math.random().toString(36).slice(2, 12);
    const shell = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL && /^\/[\w/.-]+$/.test(process.env.SHELL) ? process.env.SHELL : '/bin/sh';
    const cols = Math.max(20, Math.min(200, Number(h.cols) || 48));
    const rows = Math.max(5, Math.min(100, Number(h.rows) || 24));
    const t: { cid: string; buf: string; base: number; exit?: string; pty?: PtyLike | null; child?: ChildProcess; used: number } = { cid, buf: '', base: 0, used: Date.now() };
    const push = (s: string) => {
      t.buf += s;
      if (t.buf.length > 200_000) {
        t.base += t.buf.length - 100_000;
        t.buf = t.buf.slice(-100_000);
      }
    };
    t.pty = deps.pty?.(shell, process.platform === 'win32' ? [] : ['-l'], cols, rows, os.homedir()) ?? null;
    if (t.pty) {
      t.pty.onData(push);
      t.pty.onExit((e) => (t.exit = `Exited (${e.exitCode})`));
    } else {
      const s = process.platform === 'linux' ? { file: 'script', args: ['-qfc', `${shell} -i`, '/dev/null'] } : process.platform === 'darwin' ? { file: shell, args: ['-i'] } : { file: shell, args: [] };
      t.child = spawn(s.file, s.args, { cwd: os.homedir(), env: { ...process.env, TERM: 'xterm-256color', COLUMNS: String(cols), LINES: String(rows) }, windowsHide: true });
      t.child.stdout?.on('data', (d: Buffer) => push(d.toString()));
      t.child.stderr?.on('data', (d: Buffer) => push(d.toString()));
      t.child.on('exit', (c) => (t.exit = `Exited (${c ?? 0})`));
    }
    terms.set(id, t);
    const name = node.companionName(cid) ?? 'A phone';
    node.audit({ kind: 'terminal', direction: 'in', device: `phone:${cid}`, deviceName: name, title: `${name} opened a terminal here`, ok: true });
    return { r: { id } };
  });
  node.registerCompanionOp('term.read', async (h, _b, cid) => {
    const t = get(cid, h.id);
    const after = Math.max(t.base, Number(h.after) || 0);
    return { r: { text: t.buf.slice(after - t.base), next: t.base + t.buf.length, exit: t.exit } };
  });
  node.registerCompanionOp('term.write', async (h, _b, cid) => {
    const t = get(cid, h.id);
    const d = String(h.data ?? '').slice(0, 10_000);
    if (t.pty) t.pty.write(d);
    else t.child?.stdin?.write(d);
    return { r: true };
  });
  node.registerCompanionOp('term.close', async (h, _b, cid) => {
    const t = get(cid, h.id);
    t.pty?.kill();
    t.child?.kill();
    terms.delete(String(h.id));
    return { r: true };
  });
}
