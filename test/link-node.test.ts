// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Two Keeper devices in one process, talking over real sockets.
import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PairPrompt } from '../core/api-link';
import { companionKeys, inviteId, Opener, Sealer, fromB64u, toB64u } from '../core/link/companion-proto';
import { RelayServer } from '../core/link/relay';
import { connectWs } from '../core/link/ws';
import { LinkNode, type LinkData, type LinkHooks } from '../electron/services/link/node';

let root: string;
const made: LinkNode[] = [];

interface Harness {
  node: LinkNode;
  prompts: PairPrompt[];
  offers: { id: string; name: string }[];
  clip: { text: string };
  dir: string;
  approve: { ok: boolean };
}

async function makeNode(name: string, extra: Partial<LinkHooks> = {}): Promise<Harness> {
  const dir = await fsp.mkdtemp(path.join(root, name + '-'));
  let stored: LinkData | null = null;
  const prompts: PairPrompt[] = [];
  const offers: { id: string; name: string }[] = [];
  const clip = { text: '' };
  const approve = { ok: true };
  const h: Harness = { node: null as unknown as LinkNode, prompts, offers, clip, dir, approve };
  const hooks: LinkHooks = {
    load: async () => stored,
    save: async (d) => void (stored = JSON.parse(JSON.stringify(d))),
    getSecret: async () => undefined,
    setSecret: async () => false,
    changed: () => undefined,
    transfer: () => undefined,
    pairPrompt: (p) => {
      prompts.push(p);
      setTimeout(() => h.node.confirmPair(p.id, true), 5);
    },
    offer: (o) => offers.push(o),
    approveCompanion: async () => approve.ok,
    notify: () => undefined,
    clipboard: { read: () => clip.text, write: (t) => void (clip.text = t) },
    downloads: () => path.join(dir, 'Downloads'),
    companionDir: () => dir,
    qr: async (t) => `qr:${t}`,
    tunnel: () => undefined,
    ...extra,
  };
  h.node = new LinkNode(hooks, { hostname: name, os: 'linux', mdns: false });
  await h.node.start();
  await h.node.setSettings({ port: 0 });
  made.push(h.node);
  return h;
}

beforeAll(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-linknode-'));
});

afterAll(async () => {
  for (const n of made) await n.stop();
  await fsp.rm(root, { recursive: true, force: true });
});

async function paired() {
  const a = await makeNode('desk');
  const b = await makeNode('laptop');
  const inv = await a.node.createInvite();
  const r = await b.node.pair({ address: `127.0.0.1:${a.node.port}`, code: inv.code });
  expect(r).toMatchObject({ ok: true, device: a.node.id });
  // the host stores the pairing a moment after the joiner hears it is done
  await waitFor(() => a.node.state().devices.length === 1);
  return { a, b };
}

describe('two devices', () => {
  it('pair with a code; both see the same digits and keep the pairing', async () => {
    const { a, b } = await paired();
    expect(a.prompts[0].sas).toBe(b.prompts[0].sas);
    expect(a.prompts[0].role).toBe('host');
    expect(a.node.state().devices.map((d) => d.name)).toEqual(['laptop']);
    expect(b.node.state().devices.map((d) => d.name)).toEqual(['desk']);
    // the identity key is not protected by a keychain in tests, and says so
    expect(a.node.state().me.keyProtected).toBe(false);
  });

  it('a wrong code is refused, and five wrong codes end the invitation', async () => {
    const a = await makeNode('host');
    const b = await makeNode('guest');
    const inv = await a.node.createInvite();
    const wrong = inv.code === '000000' ? '000001' : '000000';
    expect(await b.node.pair({ address: `127.0.0.1:${a.node.port}`, code: wrong })).toMatchObject({ ok: false, error: 'That code is not right' });
    for (let i = 0; i < 4; i++) await b.node.pair({ address: `127.0.0.1:${a.node.port}`, code: wrong });
    const r = await b.node.pair({ address: `127.0.0.1:${a.node.port}`, code: inv.code });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not waiting to pair/);
  });

  it('pairs from a QR link without asking the joiner to compare digits', async () => {
    const a = await makeNode('tv');
    const b = await makeNode('phone-ish');
    const inv = await a.node.createInvite();
    const link = inv.link.replace(/a=[^&]*/, `a=${encodeURIComponent(`127.0.0.1:${a.node.port}`)}`);
    expect(await b.node.pair({ link })).toMatchObject({ ok: true });
    expect(b.prompts).toHaveLength(0);
    expect(a.prompts).toHaveLength(1);
  });

  it('sends a file after asking, and saves it intact', async () => {
    const { a, b } = await paired();
    const src = path.join(b.dir, 'Holiday.mov');
    const data = crypto.randomBytes(1_500_000);
    await fsp.writeFile(src, data);
    const sending = b.node.sendFiles(a.node.id, [src]);
    await waitFor(() => a.offers.length === 1);
    expect(a.offers[0].name).toBe('Holiday.mov');
    a.node.answerOffer(a.offers[0].id, true, true);
    await sending;
    expect(await fsp.readFile(path.join(a.dir, 'Downloads', 'Keeper', 'Holiday.mov'))).toEqual(data);
    // "always" turned on automatic accept: the next one does not ask
    await b.node.sendFiles(a.node.id, [src]);
    expect(a.offers).toHaveLength(1);
    expect((await fsp.readdir(path.join(a.dir, 'Downloads', 'Keeper'))).sort()).toEqual(['.keeper-partial', 'Holiday 2.mov', 'Holiday.mov']);
  });

  it('a declined file is not saved', async () => {
    const { a, b } = await paired();
    const src = path.join(b.dir, 'x.txt');
    await fsp.writeFile(src, 'x');
    const sending = b.node.sendFiles(a.node.id, [src]);
    await waitFor(() => a.offers.length === 1);
    a.node.answerOffer(a.offers[0].id, false);
    await expect(sending).rejects.toThrow(/declined/);
  });

  it('browses a shared folder only with permission, and never outside it', async () => {
    const { a, b } = await paired();
    const share = path.join(a.dir, 'Shared');
    await fsp.mkdir(path.join(share, 'Photos'), { recursive: true });
    await fsp.writeFile(path.join(share, 'Photos', 'cat.jpg'), 'meow');
    await fsp.writeFile(path.join(a.dir, 'secret.txt'), 'no');
    await fsp.symlink(path.join(a.dir, 'secret.txt'), path.join(share, 'link.txt'));
    await a.node.addShare(share);
    await expect(b.node.remoteShares(a.node.id)).rejects.toThrow(/does not allow/);
    a.node.setPermissions(b.node.id, { sendFiles: true, browse: true });
    const shares = await b.node.remoteShares(a.node.id);
    expect(shares.map((s) => s.name)).toEqual(['Shared']);
    const top = await b.node.remoteList(a.node.id, shares[0].id, '');
    expect(top.map((e) => e.name)).toEqual(['Photos']); // the link is not listed
    expect((await b.node.remoteList(a.node.id, shares[0].id, 'Photos'))[0]).toMatchObject({ name: 'cat.jpg', size: 4 });
    await expect(b.node.remoteList(a.node.id, shares[0].id, '../')).rejects.toThrow(/Outside/);
    await expect(b.node.remoteDownload(a.node.id, shares[0].id, '../secret.txt')).rejects.toThrow();
    await expect(b.node.remoteDownload(a.node.id, shares[0].id, 'link.txt')).rejects.toThrow(/Outside/);
    const got = await b.node.remoteDownload(a.node.id, shares[0].id, 'Photos/cat.jpg');
    expect(await fsp.readFile(got, 'utf8')).toBe('meow');
  });

  it('shares the clipboard only when allowed', async () => {
    const { a, b } = await paired();
    b.clip.text = 'hello from the laptop';
    await expect(b.node.sendClipboard(a.node.id)).rejects.toThrow(/does not allow/);
    a.node.setPermissions(b.node.id, { clipboard: true });
    await b.node.sendClipboard(a.node.id);
    expect(a.clip.text).toBe('hello from the laptop');
  });

  it('forwards a port to the other device', async () => {
    const { a, b } = await paired();
    const web = http.createServer((_q, r) => r.end('served on desk'));
    await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
    const port = (web.address() as net.AddressInfo).port;
    a.node.setPermissions(b.node.id, { forward: true });
    const local = 20000 + Math.floor(Math.random() * 20000);
    const f = await b.node.addForward({ device: a.node.id, kind: 'port', localPort: local, port });
    expect(f.active).toBe(true);
    expect(await (await fetch(`http://127.0.0.1:${local}/`)).text()).toBe('served on desk');
    await b.node.removeForward(f.id);
    web.close();
  });

  it('a forget on one side ends the link', async () => {
    const { a, b } = await paired();
    expect((await b.node.check(a.node.id)).ok).toBe(true);
    a.node.forget(b.node.id);
    const r = await b.node.check(a.node.id);
    // the old connection was closed; a new one is refused because a no longer trusts b
    expect(r.ok).toBe(false);
  });
});

describe('internet carriers', () => {
  it('reaches a device through a relay when there is no local address', async () => {
    const relay = new RelayServer();
    const server = http.createServer((q, r) => { if (!relay.handleHttp(q, r)) { r.writeHead(404); r.end(); } });
    relay.attach(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    const { a, b } = await paired();
    await a.node.setSettings({ mode: 'internet', relayUrl: url, mailbox: '' });
    await b.node.setSettings({ mode: 'internet', relayUrl: url, mailbox: '' });
    await waitFor(() => relay.listeners.size === 2);
    // forget what b knows about a's local address, so only the relay is left
    b.node.data.devices[0].reach = { relay: url };
    const r = await b.node.check(a.node.id);
    expect(r).toMatchObject({ ok: true, via: 'relay' });
    expect(relay.stats.calls).toBeGreaterThan(0);
    relay.close();
    server.close();
  });

  it('never leaves the network in local-only mode', async () => {
    const { b, a } = await paired();
    await b.node.setSettings({ mode: 'internet', localOnly: true, relayUrl: 'http://127.0.0.1:1', mailbox: '' });
    b.node.data.devices[0].reach = { relay: 'http://127.0.0.1:1', tunnel: 'https://example.invalid' };
    await a.node.stop();
    const r = await b.node.check(a.node.id);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not on this network/);
  });
});

describe('phone companion', () => {
  type Reply = { ok?: boolean; r?: unknown; e?: string; body: Uint8Array };
  type Phone = { req: (op: string, args?: Record<string, unknown>, body?: Uint8Array) => Promise<Reply>; close: () => void } | { error: string | undefined };
  async function phone(base: string, hello: Record<string, unknown>, secret: Uint8Array): Promise<Phone> {
    const w = await connectWs(`${base.replace('http', 'ws')}/c/ws`, 'lan');
    const nP = crypto.randomBytes(16);
    const hi = await new Promise<{ t: string; n: string; e?: string }>((resolve) => {
      w.ontext = (s) => resolve(JSON.parse(s));
      w.sendText(JSON.stringify({ t: 'hello', v: 1, n: toB64u(nP), ...hello }));
    });
    if (hi.t !== 'hi') return { error: hi.e };
    const k = companionKeys(secret, nP, fromB64u(hi.n));
    const sealer = new Sealer(k.phoneToApp);
    const opener = new Opener(k.appToPhone);
    let seq = 0;
    const waiting = new Map<number, (r: { ok?: boolean; r?: unknown; e?: string; body: Uint8Array }) => void>();
    w.onmessage = (d) => {
      const m = opener.open(d)!;
      waiting.get(m.header.id as number)?.({ ...(m.header as object), body: m.body });
    };
    const req = (op: string, args: Record<string, unknown> = {}, body?: Uint8Array) =>
      new Promise<{ ok?: boolean; r?: unknown; e?: string; body: Uint8Array }>((resolve) => {
        const id = ++seq;
        waiting.set(id, resolve);
        w.send(sealer.seal({ id, op, ...args }, body));
      });
    return { req, close: () => w.close() };
  }

  it('pairs a phone from the QR secret, then sends a file and reads shared files', async () => {
    const a = await makeNode('mac');
    const base = `http://127.0.0.1:${a.node.port}`;
    const inv = await a.node.companionInvite(base);
    const secret = fromB64u(new URL(inv.url).hash.match(/k=([^&]+)/)![1]);
    const p = await phone(base, { inv: inviteId(secret) }, secret);
    if (!('req' in p)) throw new Error(p.error);
    expect((await p.req('shares')).e).toMatch(/Pair this phone first/);
    const reg = await p.req('register', { name: 'iPhone' });
    expect(reg.ok).toBe(true);
    const creds = reg.r as { cid: string; key: string };
    p.close();
    // the QR code cannot be used twice
    const again = await phone(base, { inv: inviteId(secret) }, secret);
    expect('error' in again && again.error).toMatch(/expired/);
    // the phone comes back with its own key
    const p2 = await phone(base, { cid: creds.cid }, fromB64u(creds.key));
    if (!('req' in p2)) throw new Error('no');
    const data = crypto.randomBytes(1_200_000);
    let off = 0;
    let last;
    while (off < data.length) {
      const chunk = data.subarray(off, off + 512 * 1024);
      last = await p2.req('put', { xid: 'up1', name: 'IMG_0001.HEIC', total: data.length, offset: off }, chunk);
      off += chunk.length;
    }
    expect(last!.r).toMatchObject({ done: true, savedAs: 'IMG_0001.HEIC' });
    expect(await fsp.readFile(path.join(a.dir, 'Downloads', 'Keeper', 'IMG_0001.HEIC'))).toEqual(data);
    const share = path.join(a.dir, 'Pictures');
    await fsp.mkdir(share);
    await fsp.writeFile(path.join(share, 'sunset.jpg'), 'pixels');
    await a.node.addShare(share);
    const shares = (await p2.req('shares')).r as { id: string }[];
    const list = (await p2.req('list', { share: shares[0].id, dir: '' })).r as { name: string }[];
    expect(list.map((x) => x.name)).toEqual(['sunset.jpg']);
    const read = await p2.req('read', { share: shares[0].id, path: 'sunset.jpg', offset: 0 });
    expect(Buffer.from(read.body).toString()).toBe('pixels');
    a.clip.text = 'copied on the mac';
    expect(((await p2.req('clip.get')).r as { text: string }).text).toBe('copied on the mac');
    expect(a.node.state().companions[0]).toMatchObject({ name: 'iPhone', online: true });
    p2.close();
    // a forgotten phone cannot come back
    a.node.forgetCompanion(creds.cid);
    const p3 = await phone(base, { cid: creds.cid }, fromB64u(creds.key));
    expect('error' in p3).toBe(true);
  });

  it('refuses a phone the computer did not allow', async () => {
    const a = await makeNode('pc');
    a.approve.ok = false;
    const base = `http://127.0.0.1:${a.node.port}`;
    const inv = await a.node.companionInvite(base);
    const secret = fromB64u(new URL(inv.url).hash.match(/k=([^&]+)/)![1]);
    const p = await phone(base, { inv: inviteId(secret) }, secret);
    if (!('req' in p)) throw new Error('no');
    expect((await p.req('register', { name: 'Stranger' })).e).toMatch(/did not allow/);
  });
});

async function waitFor(fn: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('cloudflared supervisor', () => {
  // The stand-in tunnel is a script with a #! line, which Windows cannot run directly; the supervisor's logic is the same everywhere.
  it.skipIf(process.platform === 'win32')('reads the address, and restarts a crashing tunnel with growing waits', async () => {
    const { TunnelSupervisor } = await import('../electron/services/link/cloudflared');
    const fake = path.join(root, 'fake-cloudflared');
    // Prints what cloudflared prints, then "crashes".
    await fsp.writeFile(fake, `#!/usr/bin/env node
console.error('INF Requesting new quick Tunnel on trycloudflare.com...');
console.error('INF |  https://calm-river-test.trycloudflare.com  |');
// Only the first run gets a connection; later runs fail straight away.
const fs = require('fs');
const mark = __filename + '.ran';
if (!fs.existsSync(mark)) { fs.writeFileSync(mark, '1'); console.error('INF Registered tunnel connection connIndex=0'); }
setTimeout(() => process.exit(1), 150);
`);
    await fsp.chmod(fake, 0o755);
    const urls: (string | undefined)[] = [];
    const states: string[] = [];
    const waits: number[] = [];
    const sup = new TunnelSupervisor({
      binDir: root,
      binPath: fake,
      port: () => 1234,
      token: async () => undefined,
      onStatus: (s) => states.push(s.state),
      onUrl: (u) => urls.push(u),
      backoff: (n) => (waits.push(n), 0.05),
      healthEveryMs: 60_000,
    });
    await sup.start({ mode: 'quick' });
    await waitFor(() => sup.status.restarts >= 3, 8000);
    expect(urls).toContain('https://calm-river-test.trycloudflare.com');
    expect(states).toContain('connected');
    expect(states).toContain('reconnecting');
    // the first crash came after a good connection (count starts over); then each failure waits longer
    expect(waits.slice(0, 3)).toEqual([1, 2, 3]);
    await sup.stop();
    const n = sup.status.restarts;
    await new Promise((r) => setTimeout(r, 400));
    expect(sup.status.restarts).toBe(n); // stopped means stopped
    expect(sup.status.state).toBe('stopped');
  });

  it('a named tunnel needs its token first', async () => {
    const { TunnelSupervisor } = await import('../electron/services/link/cloudflared');
    const sup = new TunnelSupervisor({ binDir: root, binPath: '/bin/false', port: () => 1, token: async () => undefined, onStatus: () => undefined, onUrl: () => undefined });
    const s = await sup.start({ mode: 'named', hostname: 'me.example.com' });
    expect(s.state).toBe('error');
    expect(s.lastError).toMatch(/token/);
  });

  it('refuses a download whose checksum is wrong', async () => {
    const { TunnelSupervisor } = await import('../electron/services/link/cloudflared');
    const fetchFn = (async () => new Response(new Blob([Buffer.from('not cloudflared')]).stream(), { status: 200, headers: { 'content-length': '15' } })) as unknown as typeof fetch;
    const sup = new TunnelSupervisor({ binDir: path.join(root, 'bins'), port: () => 1, token: async () => undefined, onStatus: () => undefined, onUrl: () => undefined, platform: 'linux', arch: 'x64', fetchFn });
    await expect(sup.ensureBinary()).rejects.toThrow(/checksum/);
    await expect(fsp.readdir(path.join(root, 'bins', '2026.10.7'))).resolves.toEqual([]);
  });
});
