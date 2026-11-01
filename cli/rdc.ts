// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// `keeper rdc …`: Remote Desktops from any terminal. Talks to the running app
// when it is open (saved passwords, VNC in a Keeper tab, Keeper Link); without
// it, reads the saved list itself and starts the right program right here
// (SSH, Mosh, Telnet and serial in this terminal; RDP, SPICE and viewers in
// their own windows). Saved passwords stay in the app's keychain: without the
// app, the program asks for them.

import { spawn } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectToApp } from '../core/brain/client';
import { keeperDataDir } from '../core/brain/paths';
import { launchPlan, portOf } from '../core/rdc/clients';
import { ENGINES, type Os } from '../core/rdc/engines';
import { decodeText, detectFormat, exportText, importText, type Format } from '../core/rdc/formats';
import { findConnection, sortConnections } from '../core/rdc/list';
import { probePorts } from '../core/rdc/probe';
import type { ConnectResult, Connection } from '../core/rdc/types';
import { defaultPort } from '../core/rdc/types';
import { guessFromPorts, GUESS_PORTS, parseTarget, toUri } from '../core/rdc/uri';

type Out = (data: unknown, human: () => void) => void;
const OS = process.platform as Os;
const file = () => path.join(keeperDataDir(), 'rdc', 'connections.json');

async function app<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T | undefined> {
  const a = await connectToApp().catch(() => null);
  if (!a) return undefined;
  try {
    return (await a.call('keeper/rdc', { cmd, args })) as T;
  } finally {
    a.close();
  }
}

async function needApp<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await app<T>(cmd, args);
  if (r === undefined) throw new Error('This needs the Keeper app. Open Keeper and try again.');
  return r;
}

async function readList(): Promise<Connection[]> {
  try {
    const raw = JSON.parse(await fsp.readFile(file(), 'utf8')) as { connections?: Connection[] };
    return raw.connections ?? [];
  } catch {
    return [];
  }
}

async function writeList(list: Connection[]) {
  await fsp.mkdir(path.dirname(file()), { recursive: true, mode: 0o700 });
  await fsp.writeFile(file(), JSON.stringify({ version: 1, connections: list }, null, 1), { mode: 0o600 });
}

async function which(bin: string): Promise<string | null> {
  if (path.isAbsolute(bin)) return existsSync(bin) ? bin : null;
  const exts = OS === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const d of (process.env.PATH ?? '').split(path.delimiter)) for (const e of exts) {
    const p = path.join(d, bin + e);
    if (existsSync(p)) return p;
  }
  return null;
}

async function found() {
  const out: Record<string, { path: string; bin: string } | undefined> = {};
  for (const e of ENGINES) for (const b of e.bins[OS] ?? []) {
    const p = await which(b);
    if (p) { out[e.id] = { path: p, bin: path.basename(b).replace(/\.exe$/i, '').toLowerCase() }; break; }
  }
  return out;
}

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    if (!stdin.isTTY) {
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { stdin.pause(); resolve(buf.slice(0, i).replace(/\r$/, '')); } });
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let s = '';
    const on = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stderr.write('\n'); resolve(s); return; }
        if (c === '\u0003') { process.stderr.write('\n'); process.exit(130); }
        if (c === '\u007f') { if (s) { s = s.slice(0, -1); if (!hidden) process.stderr.write('\b \b'); } continue; }
        s += c;
        if (!hidden) process.stderr.write(c);
      }
    };
    stdin.on('data', on);
  });
}

const line = (c: Connection) => `${(c.favourite ? '★ ' : '  ') + c.name.padEnd(28)} ${c.protocol.padEnd(7)} ${toUri(c)}${c.folder ? `   [${c.folder}]` : ''}`;

/** A connection from the saved list, or one made from a link or address on the spot. */
async function resolve(list: Connection[], target: string): Promise<Connection> {
  const c = findConnection(list, target);
  if (c) return c;
  const t = parseTarget(target);
  if (!t) throw new Error(`No connection called “${target}”. See: keeper rdc list`);
  let protocol = t.protocol;
  let port = t.port;
  if (!protocol) {
    const probed = await probePorts(t.host, t.port ? [t.port] : GUESS_PORTS, { timeoutMs: 600 });
    const g = guessFromPorts(probed.filter((p) => p.open).map((p) => p.port));
    if (!g) throw new Error(`Nothing answers at ${t.host} on the usual ports. Say which: rdp://${t.host}, vnc://${t.host} or ssh://${t.host}`);
    protocol = g.protocol;
    port = g.port;
  }
  return { id: `tmp-${randomUUID()}`, created: Date.now(), name: t.host, protocol, host: t.host, user: t.user, port: port !== defaultPort(protocol) ? port : undefined, ...(t.extra ?? {}) };
}

/** Without the app: start the program here (terminal ones in this terminal). */
async function connectHere(c: Connection, external: boolean) {
  if (c.gateway && c.gateway.kind !== 'none' && c.gateway.kind !== 'mesh' && !(c.gateway.kind === 'ssh' && (c.protocol === 'ssh' || c.protocol === 'mosh'))) throw new Error('This connection goes through a gateway; open the Keeper app first.');
  if (c.protocol === 'web') {
    const url = c.web?.url ?? `https://${c.host}${c.port ? `:${c.port}` : ''}/`;
    const opener = OS === 'darwin' ? 'open' : OS === 'win32' ? 'explorer' : 'xdg-open';
    spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
    return console.log(`Opened ${url} in your browser`);
  }
  if (c.protocol === 'keeper') throw new Error('Keeper devices open from the Keeper app.');
  if (c.protocol === 'vnc' && !external) external = true;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-rdc-'));
  const host = c.gateway?.kind === 'mesh' ? c.gateway.address : c.host;
  const plan = launchPlan(c, { os: OS, found: await found(), host, port: portOf(c), tmp, home: os.homedir(), aliasOf: c.gateway?.kind === 'mesh' ? c.host : undefined });
  for (const f of plan.files ?? []) await fsp.writeFile(f.path, f.content, { mode: f.mode });
  const done = () => void fsp.rm(tmp, { recursive: true, force: true });
  if (plan.where === 'terminal') {
    const child = spawn(plan.file, plan.args, { stdio: 'inherit', env: { ...process.env, ...plan.env } });
    await new Promise<void>((r) => child.on('exit', (code) => { done(); process.exitCode = code ?? 0; r(); }));
    return;
  }
  const child = spawn(plan.file, plan.args, { stdio: ['ignore', 'ignore', 'ignore'], detached: true, env: { ...process.env, ...plan.env } });
  child.unref();
  setTimeout(done, plan.cleanupMs ?? 30_000).unref();
  console.log(`Opened ${c.name} with ${plan.engine}${plan.note ? `. ${plan.note}` : ''}`);
}

export async function cmdRdc(rest: string[], flags: Record<string, string | boolean>, out: Out) {
  const [sub, ...args] = rest;
  switch (sub ?? 'list') {
    case 'list': case 'ls': {
      const list = sortConnections((await app<Connection[]>('list')) ?? (await readList()));
      return out(list, () => {
        if (!list.length) return console.log('No saved connections. Add one: keeper rdc add rdp://office-pc --name "Office PC"');
        for (const c of list) console.log(line(c));
      });
    }
    case 'names': {
      // For shell completion: one name per line.
      for (const c of (await app<Connection[]>('list')) ?? (await readList())) console.log(c.name);
      return;
    }
    case 'connect': case 'open': {
      const target = args.join(' ');
      if (!target) throw new Error('Usage: keeper rdc connect <name | rdp://host | vnc://host:5901 | ssh user@host> [--external]');
      const external = !!flags.external;
      const list = (await app<Connection[]>('list')) ?? (await readList());
      const running = (await connectToApp().catch(() => null));
      if (running) running.close();
      const c = await resolve(list, target);
      const terminalKind = ['ssh', 'mosh', 'telnet', 'serial', 'winrm'].includes(c.protocol);
      // In a terminal already: SSH and friends run right here, not in a new Keeper tab (unless --app).
      if (!running || (terminalKind && !flags.app)) return connectHere(c, external);
      let opts: Record<string, unknown> = { target: c.id.startsWith('tmp-') ? target : c.id, external };
      for (let tries = 0; tries < 3; tries++) {
        const r = await needApp<ConnectResult>('connect', opts);
        if (r.hostKey) {
          console.log(`${r.hostKey.changed ? 'WARNING: the key changed for' : 'First connection to'} ${r.hostKey.host}\n  ${r.hostKey.type} ${r.hostKey.fingerprint}`);
          if (r.hostKey.changed) throw new Error('Refusing to connect. If the computer was reinstalled, remove its old line from ~/.ssh/known_hosts.');
          if (!/^y(es)?$/i.test(await ask('Trust it and connect? [y/N] '))) return;
          opts = { ...opts, trustKey: r.hostKey.fingerprint };
          continue;
        }
        if (r.needPassword) {
          opts = { ...opts, password: await ask(`Password for ${c.name}: `, true) };
          continue;
        }
        return out(r, () => {
          if (r.session?.state === 'error') { console.error(r.session.error ?? 'Did not connect'); process.exitCode = 1; return; }
          console.log(r.route ? `Opened ${c.name} in a Keeper tab${r.session?.via ? ` (${r.session.via})` : ''}` : `Opened ${c.name}${r.session?.program ? ` with ${r.session.program}` : ''}${r.message ? `. ${r.message}` : ''}`);
        });
      }
      return;
    }
    case 'add': {
      const uri = args[0];
      if (!uri) throw new Error('Usage: keeper rdc add <rdp://host | vnc://host:5901 | ssh://user@host | host> [--name "Office PC"] [--folder Work]');
      const name = typeof flags.name === 'string' ? flags.name : undefined;
      const folder = typeof flags.folder === 'string' ? flags.folder : undefined;
      const viaApp = await app<Connection>('add', { uri, name, folder });
      if (viaApp) return out(viaApp, () => console.log(`Added ${viaApp.name} (${toUri(viaApp)})`));
      const list = await readList();
      const c = await resolve([], uri);
      const saved: Connection = { ...c, id: randomUUID(), name: name ?? c.name, folder };
      list.push(saved);
      await writeList(list);
      return out(saved, () => console.log(`Added ${saved.name} (${toUri(saved)})`));
    }
    case 'import': {
      const f = args[0];
      if (!f) throw new Error('Usage: keeper rdc import <file.rdp | file.vnc | ~/.ssh/config | connections.json>');
      const p = path.resolve(f.replace(/^~(?=$|\/)/, os.homedir()));
      const text = decodeText(new Uint8Array(await fsp.readFile(p)));
      const viaApp = await app<{ added: Connection[]; secrets: number; skipped: number }>('import', { text, name: p });
      const r = viaApp ?? await (async () => {
        const fmt = detectFormat(text, p);
        if (!fmt) throw new Error('Keeper does not recognise this file');
        const list = await readList();
        const added: Connection[] = [];
        let skipped = 0;
        for (const it of importText(text, fmt, p)) {
          if (list.some((x) => x.protocol === it.conn.protocol && x.host === it.conn.host && (x.port ?? 0) === (it.conn.port ?? 0))) { skipped++; continue; }
          const c: Connection = { ...it.conn, id: randomUUID(), created: Date.now() };
          list.push(c);
          added.push(c);
        }
        await writeList(list);
        return { added, secrets: 0, skipped };
      })();
      return out(r, () => console.log(`Imported ${r.added.length} connection(s)${r.skipped ? `, ${r.skipped} already saved` : ''}${r.secrets ? `, ${r.secrets} password(s) into the keychain` : ''}`));
    }
    case 'export': {
      const format = (typeof flags.format === 'string' ? flags.format : 'json') as Format;
      if (!['json', 'ssh', 'rdp', 'vnc'].includes(format)) throw new Error('--format json | ssh | rdp | vnc');
      const list = (await app<Connection[]>('list')) ?? (await readList());
      const chosen = args.length ? args.map((a) => findConnection(list, a)).filter((c): c is Connection => !!c) : list;
      process.stdout.write(exportText(chosen, format));
      return;
    }
    case 'probe': {
      const host = args[0];
      if (!host) throw new Error('Usage: keeper rdc probe <host> [--ports 3389,5900,22]');
      const ports = typeof flags.ports === 'string' ? flags.ports.split(',').map(Number).filter((n) => n > 0 && n < 65536) : GUESS_PORTS;
      const r = await probePorts(host, ports, { timeoutMs: Number(flags.timeout ?? 700) });
      const g = guessFromPorts(r.filter((x) => x.open).map((x) => x.port));
      return out({ host, ports: r, guess: g }, () => {
        for (const p of r) if (p.open) console.log(`  ${String(p.port).padStart(5)}  open   ${p.ms} ms`);
        const closed = r.filter((p) => !p.open).map((p) => p.port);
        if (closed.length) console.log(`  closed or filtered: ${closed.join(', ')}`);
        console.log(g ? `Looks like ${g.protocol.toUpperCase()} on port ${g.port}: keeper rdc connect ${g.protocol}://${host}${g.port !== defaultPort(g.protocol) ? `:${g.port}` : ''}` : 'No remote desktop, VNC, SSH or PowerShell port answers.');
      });
    }
    case 'command': {
      const r = await app<{ file: string; args: string[] } | { error: string }>('command', { target: args.join(' ') });
      if (!r) throw new Error('This needs the Keeper app.');
      if ('error' in r) throw new Error(r.error);
      return out(r, () => console.log([r.file, ...r.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')));
    }
    case 'host': {
      const [what, proto] = args;
      type St = { items: { id: string; name: string; protocol: string; available: boolean; on?: boolean; listening?: string; reason?: string }[]; checks: { title: string; ok?: boolean; detail: string }[] };
      const st = await needApp<St>('host-status');
      if (!what || what === 'status') {
        return out(st, () => {
          for (const i of st.items) console.log(`${i.on ? '●' : '○'} ${i.name.padEnd(40)} ${i.available ? (i.on ? `on${i.listening === 'local' ? ' (this computer only)' : i.listening === 'all' ? ' (every network)' : ''}` : 'off') : `not available: ${i.reason ?? ''}`}`);
          for (const c of st.checks) console.log(`  ${c.ok === true ? 'ok  ' : c.ok === false ? 'FIX ' : '·   '} ${c.title}: ${c.detail}`);
        });
      }
      if (what !== 'enable' && what !== 'disable') throw new Error('Usage: keeper rdc host status | enable rdp|vnc [--password P] [--everywhere] | disable rdp|vnc');
      if (proto !== 'rdp' && proto !== 'vnc') throw new Error('Say which: rdp or vnc');
      const item = st.items.find((i) => i.protocol === proto && i.available && (what === 'disable' ? i.on : true));
      if (!item) throw new Error(`No ${proto.toUpperCase()} server Keeper can switch here. keeper rdc host status says why.`);
      let password = typeof flags.password === 'string' ? flags.password : undefined;
      if (what === 'enable' && item.id === 'x11vnc' && !password) password = await ask('VNC password (up to 8 characters): ', true);
      const r = await needApp<{ ok: boolean; message: string; manual?: string[] }>('host-set', { id: item.id, on: what === 'enable', password, localOnly: !flags.everywhere });
      return out(r, () => { console.log(r.message); for (const m of r.manual ?? []) console.log(`  - ${m}`); if (!r.ok) process.exitCode = 1; });
    }
    case 'forward': {
      const name = args[0];
      const device = typeof flags['via-link'] === 'string' ? flags['via-link'] : args[1];
      if (!name || !device) throw new Error('Usage: keeper rdc forward <name> --via-link <device> [--port <local port>]');
      const r = await needApp<{ localPort: number; device: string; host: string; port: number }>('forward', { name, device, localPort: flags.port ? Number(flags.port) : undefined });
      return out(r, () => console.log(`127.0.0.1:${r.localPort} now reaches ${r.host}:${r.port} through ${r.device} (until Keeper quits, or remove it in Devices)`));
    }
    default:
      throw new Error('Usage: keeper rdc list | connect <name|uri> [--external] | add <uri> [--name …] | import <file> | export [--format json|ssh|rdp|vnc] | probe <host> | host status|enable rdp|enable vnc|disable … | forward <name> --via-link <device>');
  }
}
