// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper-to-Keeper remote access with two real Link nodes in one process:
// the relay path moving to a direct UDP path (and a file going over it), help
// mode, run-commands with its permission and first-use approval, a terminal
// over Link, the command line's byte pipe, and the audit log on both sides.
import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RelayServer } from '../core/link/relay';
import { LinkNode, type LinkData, type LinkHooks } from '../electron/services/link/node';
import { installOps, remoteExec, remoteInfo, remoteTerminal } from '../electron/services/link/ops';

let root: string;
const made: LinkNode[] = [];
const closers: (() => void)[] = [];

const waitFor = async (fn: () => boolean | Promise<boolean>, ms = 15_000) => {
  const t0 = Date.now();
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 30));
  }
};

interface H {
  node: LinkNode;
  dir: string;
  offers: { id: string }[];
  approvals: string[];
  allow: { ok: boolean };
}

async function makeNode(name: string, opts: Partial<ConstructorParameters<typeof LinkNode>[1]> = {}, extra: Partial<LinkHooks> = {}): Promise<H> {
  const dir = await fsp.mkdtemp(path.join(root, name + '-'));
  let stored: LinkData | null = null;
  const h: H = { node: null as unknown as LinkNode, dir, offers: [], approvals: [], allow: { ok: true } };
  const hooks: LinkHooks = {
    load: async () => stored,
    save: async (d) => void (stored = JSON.parse(JSON.stringify(d))),
    getSecret: async () => undefined,
    setSecret: async () => false,
    changed: () => undefined,
    transfer: () => undefined,
    pairPrompt: (p) => setTimeout(() => h.node.confirmPair(p.id, true), 5),
    offer: (o) => {
      h.offers.push(o);
      h.node.answerOffer(o.id, true);
    },
    approveCompanion: async () => true,
    notify: () => undefined,
    clipboard: { read: () => '', write: () => undefined },
    downloads: () => path.join(dir, 'Downloads'),
    companionDir: () => dir,
    qr: async (t) => t,
    tunnel: () => undefined,
    ...extra,
  };
  h.node = new LinkNode(hooks, { hostname: name, os: 'linux', mdns: false, controlToken: 'tok-' + name.padEnd(20, 'x'), ...opts });
  await h.node.start();
  await h.node.setSettings({ port: 0 });
  installOps(h.node, {
    approveCommand: async (_who, command) => {
      h.approvals.push(command);
      return h.allow.ok;
    },
    version: 'test',
  });
  made.push(h.node);
  return h;
}

beforeAll(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-k2k-'));
});

afterAll(async () => {
  for (const n of made) await n.stop();
  for (const c of closers) c();
  await fsp.rm(root, { recursive: true, force: true });
});

async function startRelay() {
  const relay = new RelayServer();
  const server = http.createServer((q, r) => {
    if (!relay.handleHttp(q, r)) {
      r.writeHead(404);
      r.end();
    }
  });
  relay.attach(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  closers.push(() => {
    relay.close();
    server.close();
  });
  return { relay, url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}` };
}

async function pairedOverRelay() {
  const { relay, url } = await startRelay();
  const a = await makeNode('desk', { noLanDial: true, directLoopback: true });
  const b = await makeNode('laptop', { noLanDial: true, directLoopback: true });
  const inv = await a.node.createInvite();
  expect(await b.node.pair({ address: `127.0.0.1:${a.node.port}`, code: inv.code })).toMatchObject({ ok: true });
  await waitFor(() => a.node.state().devices.length === 1);
  for (const x of [a, b]) await x.node.setSettings({ mode: 'internet', relayUrl: url, mailbox: '', stun: [] });
  await waitFor(() => relay.listeners.size === 2);
  b.node.data.devices[0].reach = { relay: url };
  return { a, b, relay, url };
}

describe('the direct carrier', () => {
  it('starts on the relay, moves to a direct path, and sends a file over it', async () => {
    const { a, b } = await pairedOverRelay();
    const r = await b.node.check(a.node.id);
    expect(r).toMatchObject({ ok: true, via: 'relay' });
    // The dialling side looks for a direct path on its own.
    await waitFor(() => b.node.state().devices[0].via === 'direct', 20_000);
    await waitFor(() => a.node.state().devices[0].via === 'direct');
    expect(b.node.direct.stats.ok).toBe(1);
    const before = b.node.state().devices[0].paths!.find((p) => p.kind === 'direct')!.bytesOut;
    const src = path.join(b.dir, 'Big.bin');
    const data = crypto.randomBytes(2_000_000);
    await fsp.writeFile(src, data);
    await b.node.sendFiles(a.node.id, [src]);
    expect(await fsp.readFile(path.join(a.dir, 'Downloads', 'Keeper', 'Big.bin'))).toEqual(data);
    const paths = b.node.state().devices[0].paths!;
    const direct = paths.find((p) => p.kind === 'direct')!;
    expect(direct.active).toBe(true);
    expect(direct.bytesOut - before).toBeGreaterThan(2_000_000);
    // The relay path stays as a quiet standby.
    expect(paths.find((p) => p.kind === 'relay')!.bytesOut).toBeLessThan(200_000);
    // The transfer is in the audit log on both sides, with the carrier.
    expect(b.node.auditLog({ kind: 'transfer' })[0]).toMatchObject({ direction: 'out', ok: true });
    expect(b.node.auditLog({ kind: 'transfer' })[0].detail).toContain('direct');
    expect(a.node.auditLog({ kind: 'transfer' })[0]).toMatchObject({ direction: 'in', ok: true });
  });

  it('falls back to the relay with streams intact when the direct path dies', async () => {
    const { a, b } = await pairedOverRelay();
    await b.node.check(a.node.id);
    await waitFor(() => b.node.state().devices[0].via === 'direct', 20_000);
    // Kill the direct path's sockets on the answering side.
    a.node.direct.stop();
    await waitFor(() => b.node.state().devices[0].via === 'relay', 40_000);
    const info = await remoteInfo(b.node, a.node.id);
    expect(info.cpus).toBeGreaterThan(0);
  }, 60_000);

  it('does not look for a direct path in "Never leaves my network"', async () => {
    const a = await makeNode('n1');
    await a.node.setSettings({ mode: 'internet', localOnly: true });
    expect(await a.node.direct.attempt('x', { mux: { closed: false } as never, initiator: true, directTries: 0 })).toBe(false);
    expect(a.node.direct.openSockets).toBe(0);
  });
});

async function pairedLan() {
  const a = await makeNode('host');
  const b = await makeNode('viewer');
  const inv = await a.node.createInvite();
  expect(await b.node.pair({ address: `127.0.0.1:${a.node.port}`, code: inv.code })).toMatchObject({ ok: true });
  await waitFor(() => a.node.state().devices.length === 1);
  return { a, b };
}

describe('remote actions', () => {
  it('refuses a command without "Run commands", then shows it once and runs it', async () => {
    const { a, b } = await pairedLan();
    await expect(remoteExec(b.node, a.node.id, 'echo hello-k2k')).rejects.toThrow(/does not allow/);
    expect(a.approvals).toEqual([]);
    a.node.setPermissions(b.node.id, { ...a.node.state().devices[0].permissions, runCommands: true });
    a.allow.ok = false;
    await expect(remoteExec(b.node, a.node.id, 'echo hello-k2k')).rejects.toThrow(/did not allow/);
    a.allow.ok = true;
    const r = await remoteExec(b.node, a.node.id, 'echo hello-k2k');
    expect(r).toMatchObject({ code: 0 });
    expect(r.stdout.trim()).toBe('hello-k2k');
    // Seen once: the same command does not ask again; a new one does.
    await remoteExec(b.node, a.node.id, 'echo hello-k2k');
    expect(a.approvals).toEqual(['echo hello-k2k', 'echo hello-k2k']);
    expect((await remoteExec(b.node, a.node.id, 'exit 3')).code).toBe(3);
    expect(a.approvals).toHaveLength(3);
    expect(a.node.auditLog({ kind: 'command' }).map((e) => e.ok)).toEqual([false, true, true, false]);
    expect(b.node.auditLog({ kind: 'command', device: a.node.id }).length).toBe(5);
  });

  it('opens a terminal over Link only with "Terminal on this device"', async () => {
    const { a, b } = await pairedLan();
    let exit: string | undefined;
    await remoteTerminal(b.node, a.node.id, 80, 24, () => undefined, (_c, r) => (exit = r ?? 'exit'));
    await waitFor(() => exit !== undefined);
    expect(exit).toMatch(/does not allow a terminal/);
    a.node.setPermissions(b.node.id, { ...a.node.state().devices[0].permissions, terminal: true });
    let out = '';
    // A plain shell, so a fresh zsh's first-run questions cannot get in the way; cmd.exe on Windows.
    const win = process.platform === 'win32';
    const shell = process.env.SHELL;
    if (!win) process.env.SHELL = '/bin/sh';
    const t = await remoteTerminal(b.node, a.node.id, 80, 24, (d) => (out += new TextDecoder().decode(d)), () => undefined);
    if (shell !== undefined) process.env.SHELL = shell;
    t.write(win ? 'set /a 40+2\r\n' : 'echo k2k-$((40+2))\n');
    await waitFor(() => (win ? /(^|\D)42(\D|$)/.test(out.replace(/40\+2/g, '')) : out.includes('k2k-42')));
    t.write(win ? 'exit\r\n' : 'exit\n');
    t.close();
    expect(a.node.auditLog({ kind: 'terminal' })[0].title).toMatch(/terminal/);
  });

  it('pipes bytes to a port on the other device for ssh ProxyCommand', async () => {
    const { a, b } = await pairedLan();
    a.node.setPermissions(b.node.id, { ...a.node.state().devices[0].permissions, forward: true });
    const echo = net.createServer((s) => s.pipe(s));
    await new Promise<void>((r) => echo.listen(0, '127.0.0.1', () => r()));
    closers.push(() => echo.close());
    const port = (echo.address() as net.AddressInfo).port;
    const sock = net.connect(b.node.port, '127.0.0.1');
    await new Promise((r) => sock.once('connect', r));
    sock.write(`GET /local/pipe?device=host&port=${port} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: keeper-pipe\r\nx-keeper-token: tok-viewer${'x'.repeat(14)}\r\n\r\n`);
    let got = Buffer.alloc(0);
    sock.on('data', (d) => (got = Buffer.concat([got, d])));
    await waitFor(() => got.includes('\r\n\r\n'));
    expect(got.toString()).toMatch(/^HTTP\/1.1 101/);
    const head = got.indexOf('\r\n\r\n') + 4;
    got = got.subarray(head);
    sock.write('SSH-2.0-test\r\n');
    await waitFor(() => got.toString().includes('SSH-2.0-test'));
    sock.destroy();
    // A wrong token is refused.
    const bad = net.connect(b.node.port, '127.0.0.1');
    let badReply = '';
    bad.on('data', (d) => (badReply += d));
    bad.write(`GET /local/pipe?device=host&port=${port} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: keeper-pipe\r\nx-keeper-token: nope\r\n\r\n`);
    await waitFor(() => badReply.length > 0);
    expect(badReply).toMatch(/403/);
    bad.destroy();
  });

  it('gives a system snapshot to any paired device', async () => {
    const { a, b } = await pairedLan();
    const info = await remoteInfo(b.node, a.node.id);
    expect(info.name).toBe('host');
    expect(info.memTotal).toBeGreaterThan(0);
    expect(info.disks.length).toBeGreaterThan(0);
  });

  it('keeps groups, tags and notes per device', async () => {
    const { b, a } = await pairedLan();
    b.node.setMeta(a.node.id, { tags: ['Office', 'GPU'], group: 'Work', notes: 'Under the desk' });
    expect(b.node.state().devices[0].meta).toMatchObject({ tags: ['office', 'gpu'], group: 'Work', notes: 'Under the desk' });
  });
});

describe('help mode', () => {
  it('a helper who is not paired connects with the code and password over the relay, sees only the screen, and nothing is kept', async () => {
    const { url, relay } = await startRelay();
    // A tiny ntfy-style mailbox.
    const notes: Record<string, string[]> = {};
    const mbox = http.createServer(async (q, r) => {
      const u = new URL(q.url!, 'http://x');
      const topic = u.pathname.split('/')[1];
      if (q.method === 'POST') {
        let body = '';
        for await (const c of q) body += c;
        (notes[topic] ??= []).push(body);
        r.end('{}');
      } else {
        r.end((notes[topic] ?? []).map((m) => JSON.stringify({ event: 'message', message: m })).join('\n'));
      }
    });
    await new Promise<void>((r) => mbox.listen(0, '127.0.0.1', () => r()));
    closers.push(() => mbox.close());
    const mailbox = `http://127.0.0.1:${(mbox.address() as net.AddressInfo).port}`;
    const host = await makeNode('mum', { noLanDial: true });
    const helper = await makeNode('sam', { noLanDial: true });
    for (const x of [host, helper]) await x.node.setSettings({ mode: 'internet', relayUrl: url, mailbox });
    const offer = await host.node.help.start();
    expect(offer.code).toMatch(/^\d{9}$/);
    expect(offer.reach).toContain('relay');
    await waitFor(() => relay.listeners.size >= 3);
    // A wrong password first: over the internet even the note saying where to go cannot be opened.
    await expect(helper.node.help.join(offer.code, 'WRONG1', 'Sam')).rejects.toThrow(/No one is waiting/);
    const g = await helper.node.help.join(offer.code, offer.password.toLowerCase(), 'Sam');
    expect(g.name).toBe('mum');
    await waitFor(() => host.node.help.status().guests.length === 1);
    expect(host.node.help.status().guests[0]).toMatchObject({ name: 'Sam', role: 'host', via: 'relay' });
    // The code works once.
    expect(host.node.help.status().offer).toBeUndefined();
    // Nothing but the screen: no commands, files or terminal.
    const mux = await helper.node.connect(g.id);
    const { call } = await import('../core/link/mux');
    await expect(call(mux, 'exec.run', { command: 'id' })).rejects.toThrow(/Not in a help session/);
    await expect(call(mux, 'fs.shares')).rejects.toThrow(/Not in a help session/);
    const st = mux.open({ k: 'term' });
    const reset = await new Promise<string>((r) => {
      st.onreset = r;
      st.ondata = () => undefined;
      void st.start();
    });
    expect(reset).toBe('not allowed');
    // Never paired, never trusted.
    expect(host.node.state().devices).toHaveLength(0);
    expect(helper.node.state().devices).toHaveLength(0);
    host.node.help.stop('Done');
    await waitFor(() => helper.node.help.status().guests.length === 0);
    expect(host.node.auditLog({ kind: 'help' }).map((e) => e.ok)).toEqual([true]);
    expect(helper.node.auditLog({ kind: 'help' })[0].title).toBe('You helped mum');
  });
});

describe('location between paired devices', () => {
  it('answers only with "Share my location", and logs it', async () => {
    const { installLocation, setOwnPositionSource, devicePosition } = await import('../electron/services/link/location');
    const { a, b } = await pairedLan();
    installLocation(a.node);
    setOwnPositionSource(() => ({ lat: 51.5, lon: -0.12, acc: 12, t: Date.now(), battery: 80 }));
    expect(await devicePosition(a.node.id, b.node)).toBeNull();
    a.node.setPermissions(b.node.id, { ...a.node.state().devices[0].permissions, location: true });
    const p = await devicePosition(a.node.id, b.node);
    expect(p).toMatchObject({ device: a.node.id, name: 'host', lat: 51.5, lon: -0.12, acc: 12, battery: 80 });
    expect(a.node.auditLog({ kind: 'location' })).toHaveLength(1);
    setOwnPositionSource(null);
    expect(await devicePosition(a.node.id, b.node)).toBeNull();
  });
});
