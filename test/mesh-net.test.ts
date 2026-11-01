// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh with sockets: hole punching through simulated NATs (fake
// sockets, fake clock), the relay's packet path over real WebSockets, the DNS
// responder over real UDP on localhost, STUN, and two real Link nodes that
// pair, exchange signed WireGuard keys over the Link channel, punch a direct
// path, pass packets through the local shims (and through the relay), and
// clean up after themselves.
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import { promises as fsp } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildQuery, parseMessage } from '../core/fw/dns';
import { deviceId, newIdentity } from '../core/link/identity';
import { RelayServer } from '../core/link/relay';
import { answer, MeshDnsServer } from '../core/mesh/dns';
import { newWgKey } from '../core/mesh/keys';
import { emptyApplied, type Step } from '../core/mesh/os-plan';
import { attachRelays, MAX_PACKET, PacketRelayClient, PacketRelayServer, unwrap, wrap } from '../core/mesh/packet-relay';
import { isProbe, isWireGuard, openProbe, PeerPath, PING, probe, rankCandidates, type PathTimings } from '../core/mesh/paths';
import { bindingRequest, isStun, parseBindingResponse, parseStunUrl, serveStun } from '../core/mesh/stun';
import { LinkNode, type LinkData, type LinkHooks } from '../electron/services/link/node';
import { MeshEngine, type MeshData, type MeshDriver } from '../electron/services/mesh/engine';
import { linkPort } from '../electron/services/mesh/link-port';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => boolean | Promise<boolean>, ms = 8000) {
  const t0 = Date.now();
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await wait(25);
  }
}

// ---------------------------------------------------------------- hole punching with fake sockets

/**
 * A tiny simulated internet: hosts with addresses, and NATs in front of some.
 * "cone" NATs keep one public port per inside socket and let a packet in only
 * from an address the inside already sent to (address-and-port filtering);
 * "symmetric" NATs use a new public port for every destination.
 */
class FakeNet {
  queue: { to: string; from: string; b: Buffer }[] = [];
  hosts = new Map<string, (b: Buffer, fromHost: string, fromPort: number) => void>();
  nats = new Map<string, { pub: string; kind: 'cone' | 'symmetric'; map: Map<string, number>; back: Map<number, string>; allowed: Set<string>; next: number }>();

  nat(inside: string, pub: string, kind: 'cone' | 'symmetric') {
    // a symmetric NAT's port for the peer differs from the one STUN reported (40000)
    this.nats.set(inside.split(':')[0], { pub, kind, map: new Map(), back: new Map(), allowed: new Set(), next: kind === 'cone' ? 40000 : 50000 });
  }

  socket(addr: string, on: (b: Buffer, h: string, p: number) => void) {
    this.hosts.set(addr, on);
    return {
      send: (b: Buffer, port: number, host: string) => {
        let from = addr;
        const n = this.nats.get(addr.split(':')[0]);
        const to = `${host}:${port}`;
        // a private address behind someone else's NAT cannot be reached from outside
        if (this.nats.has(host) && host !== addr.split(':')[0]) return;
        if (n && !this.nats.has(host)) {
          const key = n.kind === 'cone' ? addr : `${addr}>${to}`;
          let p = n.map.get(key);
          if (!p) {
            p = n.next++;
            n.map.set(key, p);
            n.back.set(p, addr);
          }
          n.allowed.add(`${p}<${to}`);
          from = `${n.pub}:${p}`;
        }
        this.queue.push({ to, from, b });
      },
    };
  }

  /** Delivers everything queued (and what that causes), like one round trip. */
  flush() {
    for (let i = 0; i < 50 && this.queue.length; i++) {
      const q = this.queue.splice(0);
      for (const m of q) {
        let to = m.to;
        const [h, p] = to.split(':');
        const n = [...this.nats.values()].find((x) => x.pub === h);
        if (n) {
          const inside = n.back.get(Number(p));
          // filtering: only from where the inside sent to before
          if (!inside || !n.allowed.has(`${p}<${m.from}`)) continue;
          to = inside;
        }
        const [fh, fp] = m.from.split(':');
        this.hosts.get(to)?.(m.b, fh, Number(fp));
      }
    }
  }
}

const T: PathTimings = { probeEveryMs: 200, punchForMs: 2000, keepaliveMs: 25_000, deadAfterMs: 80_000, retryDirectMs: 60_000 };

function pair(net: FakeNet, a: { addr: string; cands: string[] }, b: { addr: string; cands: string[] }, relay = false) {
  const key = crypto.randomBytes(32);
  const pa: { p?: PeerPath } = {};
  const pb: { p?: PeerPath } = {};
  let now = 0;
  const sa = net.socket(a.addr, (m, h, p) => pa.p!.receive(m, h, p, now));
  const sb = net.socket(b.addr, (m, h, p) => pb.p!.receive(m, h, p, now));
  pa.p = new PeerPath('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', key, sa, T, { relay: () => relay });
  pb.p = new PeerPath('bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa', key, sb, T, { relay: () => relay });
  pa.p.setCandidates(b.cands.map((addr) => ({ kind: 'public' as const, addr })));
  pb.p.setCandidates(a.cands.map((addr) => ({ kind: 'public' as const, addr })));
  const run = (ms: number) => {
    for (const end = now + ms; now <= end; now += 100) {
      pa.p!.tick(now);
      pb.p!.tick(now);
      net.flush();
    }
  };
  const punch = () => {
    pa.p!.punch(now);
    pb.p!.punch(now);
    net.flush();
  };
  return { a: pa.p, b: pb.p, run, punch, at: () => now, set: (t: number) => (now = t) };
}

describe('probes and candidates', () => {
  it('authenticates probes and tells them from WireGuard and STUN', () => {
    const k = crypto.randomBytes(32);
    const p = probe(k, PING, 'aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', crypto.randomBytes(8), 1234);
    expect(isProbe(p)).toBe(true);
    expect(openProbe(k, p)).toMatchObject({ type: PING, from: 'aaaaaaaaaaaaaaaa', to: 'bbbbbbbbbbbbbbbb', sent: 1234 });
    expect(openProbe(crypto.randomBytes(32), p)).toBeNull();
    const bad = Buffer.from(p);
    bad[10] ^= 1;
    expect(openProbe(k, bad)).toBeNull();
    const wg = Buffer.alloc(148);
    wg[0] = 1;
    expect(isWireGuard(wg)).toBe(true);
    expect(isWireGuard(p)).toBe(false);
    expect(isStun(bindingRequest())).toBe(true);
    expect(isWireGuard(bindingRequest())).toBe(false);
  });

  it('ranks local addresses before public ones and skips relays', () => {
    const r = rankCandidates([{ kind: 'public', addr: '203.0.113.5:41820' }, { kind: 'relay', addr: 'https://relay.example' }, { kind: 'lan', addr: '192.168.1.4:41820' }, { kind: 'lan', addr: '[fd00::4]:41820' }]);
    expect(r.map((x) => `${x.kind} ${x.host}`)).toEqual(['lan 192.168.1.4', 'lan fd00::4', 'internet 203.0.113.5']);
  });
});

describe('hole punching (fake sockets)', () => {
  it('finds the direct local path on the same network', () => {
    const net = new FakeNet();
    const s = pair(net, { addr: '192.168.1.2:41820', cands: ['192.168.1.2:41820'] }, { addr: '192.168.1.3:41820', cands: ['192.168.1.3:41820'] });
    s.punch();
    s.run(300);
    expect(s.a.state).toBe('direct');
    expect(s.a.path).toBe('lan');
    expect(s.b.path).toBe('lan');
  });

  it('punches through two cone NATs when both sides probe at once', () => {
    const net = new FakeNet();
    net.nat('10.0.0.2', '198.51.100.1', 'cone');
    net.nat('10.1.0.2', '198.51.100.2', 'cone');
    // their public addresses as STUN would have reported them (the NAT keeps one port per socket)
    const s = pair(net, { addr: '10.0.0.2:41820', cands: ['10.0.0.2:41820', '198.51.100.1:40000'] }, { addr: '10.1.0.2:41820', cands: ['10.1.0.2:41820', '198.51.100.2:40000'] });
    s.punch();
    s.run(1000);
    expect(s.a.state).toBe('direct');
    expect(s.a.path).toBe('internet');
    expect(s.a.best).toMatchObject({ host: '198.51.100.2', port: 40000 });
    expect(s.b.best).toMatchObject({ host: '198.51.100.1', port: 40000 });
  });

  it('only one side probing does not get through a filtering NAT', () => {
    const net = new FakeNet();
    net.nat('10.0.0.2', '198.51.100.1', 'cone');
    net.nat('10.1.0.2', '198.51.100.2', 'cone');
    const s = pair(net, { addr: '10.0.0.2:41820', cands: ['198.51.100.1:40000'] }, { addr: '10.1.0.2:41820', cands: ['198.51.100.2:40000'] });
    s.a.punch(s.at());
    s.run(2500);
    expect(s.a.state).toBe('failed');
  });

  it('falls back to the relay behind symmetric NATs, and tries direct again later', () => {
    const net = new FakeNet();
    net.nat('10.0.0.2', '198.51.100.1', 'symmetric');
    net.nat('10.1.0.2', '198.51.100.2', 'symmetric');
    const s = pair(net, { addr: '10.0.0.2:41820', cands: ['198.51.100.1:40000'] }, { addr: '10.1.0.2:41820', cands: ['198.51.100.2:40000'] }, true);
    s.punch();
    s.run(2500);
    expect(s.a.state).toBe('relay');
    expect(s.a.path).toBe('relay');
    expect(s.a.route()).toEqual({ via: 'relay' });
    const rounds = s.a.rounds;
    s.run(61_000);
    expect(s.a.rounds).toBeGreaterThan(rounds);
    expect(s.a.path).toBe('relay');
  });

  it('follows a peer that moves (roaming) and keeps alive only while active', () => {
    const net = new FakeNet();
    const s = pair(net, { addr: '192.168.1.2:41820', cands: ['192.168.1.2:41820'] }, { addr: '192.168.1.3:41820', cands: ['192.168.1.3:41820'] });
    s.punch();
    s.run(300);
    expect(s.a.best).toMatchObject({ host: '192.168.1.3' });
    // b's laptop moves to another address: it probes from there, and a follows
    const key = (s.b as unknown as { key: Buffer }).key;
    const b2: { p?: PeerPath } = {};
    const moved = net.socket('192.168.7.9:5555', (m, h, p) => b2.p!.receive(m, h, p, s.at()));
    b2.p = new PeerPath('bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa', key, moved, T);
    b2.p.setCandidates([{ kind: 'lan', addr: '192.168.1.2:41820' }]);
    s.set(s.at() + 30_000);
    b2.p.punch(s.at());
    net.flush();
    expect(s.a.best).toMatchObject({ host: '192.168.7.9', port: 5555 });
    // idle: no keepalive probes
    const sent: string[] = [];
    const quiet = new PeerPath('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', key, { send: (_b, _p, h) => sent.push(h) }, T);
    quiet.setCandidates([{ kind: 'lan', addr: '192.168.1.3:41820' }]);
    (quiet as unknown as { state: string }).state = 'direct';
    quiet.best = { host: '192.168.1.3', port: 41820, kind: 'lan', rtt: 1, at: 0 };
    quiet.lastPong = 0;
    quiet.tick(1000);
    expect(sent).toHaveLength(0);
    quiet.touch(1000);
    quiet.tick(1000);
    expect(sent).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- the relay's packet path

describe('relay packet path', () => {
  let server: http.Server;
  let url: string;
  let relay: PacketRelayServer;

  beforeAll(async () => {
    server = http.createServer((_q, s) => s.end('x'));
    relay = new PacketRelayServer();
    relay.attach(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => {
    relay.close();
    server.close();
  });

  it('wraps packets with the device id', () => {
    const w = wrap('abcdefghijkmnpqr', Buffer.from([1, 2, 3]));
    expect(unwrap(w)).toEqual({ id: 'abcdefghijkmnpqr', packet: new Uint8Array([1, 2, 3]) });
    expect(() => wrap('nope', Buffer.alloc(1))).toThrow();
    expect(() => wrap('abcdefghijkmnpqr', Buffer.alloc(MAX_PACKET + 1))).toThrow();
    expect(unwrap(new Uint8Array(10))).toBeNull();
  });

  it('passes packets blindly, only between devices that allow each other', async () => {
    const a = newIdentity();
    const b = newIdentity();
    const c = newIdentity();
    const A = deviceId(a.publicKey);
    const B = deviceId(b.publicKey);
    const ca = new PacketRelayClient(url, a);
    const cb = new PacketRelayClient(url, b);
    const cc = new PacketRelayClient(url, c);
    await Promise.all([ca.connect(), cb.connect(), cc.connect()]);
    const got: { from: string; p: Buffer }[] = [];
    cb.onpacket = (from, p) => got.push({ from, p: Buffer.from(p) });
    const pkt = crypto.randomBytes(1400);
    // b has not allowed a yet: dropped
    ca.setAllow([B]);
    ca.send(B, pkt);
    await wait(150);
    expect(got).toHaveLength(0);
    cb.setAllow([A]);
    await wait(50);
    ca.send(B, pkt);
    await waitFor(() => got.length === 1);
    expect(got[0].from).toBe(A);
    expect(got[0].p.equals(pkt)).toBe(true);
    // a third device that b never allowed cannot send to it
    cc.setAllow([B]);
    await wait(50);
    cc.send(B, pkt);
    await wait(150);
    expect(got).toHaveLength(1);
    expect(relay.stats.dropped).toBeGreaterThanOrEqual(2);
    ca.close();
    cb.close();
    cc.close();
  });

  it('refuses a device that cannot prove its id', async () => {
    const real = newIdentity();
    const fake = newIdentity();
    const c = new PacketRelayClient(url, { ...fake, publicKey: real.publicKey });
    await expect(c.connect(3000)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------- names

describe('DNS responder (real UDP on localhost)', () => {
  const table = new Map([['laptop', { a6: 'fd12:3456:789a::2', a4: '100.99.0.2' }], ['nas', { a6: 'fd12:3456:789a::3' }]]);
  let dns: MeshDnsServer;
  let upstream: dgram.Socket;

  beforeAll(async () => {
    // a stand-in upstream DNS server for forwarding (exit node)
    upstream = dgram.createSocket('udp4');
    upstream.on('message', (m, r) => {
      const reply = Buffer.from(m);
      reply.writeUInt16BE(0x8183, 2); // NXDOMAIN, so it is recognisably from upstream
      upstream.send(reply, r.port, r.address);
    });
    await new Promise<void>((r) => upstream.bind(0, '127.0.0.1', () => r()));
    dns = new MeshDnsServer({ suffix: () => 'keeper', names: { get: (l) => table.get(l) } });
    await dns.listen('127.0.0.1', [0]);
  });
  afterAll(() => {
    dns.close();
    upstream.close();
  });

  const ask = (name: string, type: number) =>
    new Promise<ReturnType<typeof parseMessage>>((resolve, reject) => {
      const s = dgram.createSocket('udp4');
      const t = setTimeout(() => reject(new Error('no answer')), 2000);
      s.on('message', (m) => {
        clearTimeout(t);
        s.close();
        resolve(parseMessage(m));
      });
      s.send(buildQuery(name, type), dns.port, '127.0.0.1');
    });

  it('answers mesh names with AAAA and A records', async () => {
    const a6 = await ask('laptop.keeper', 28);
    expect(a6.rcode).toBe(0);
    expect(a6.answers).toEqual([{ name: 'laptop.keeper', type: 28, ttl: 60, data: 'fd12:3456:789a::2' }]);
    const a4 = await ask('LAPTOP.Keeper.', 1);
    expect(a4.answers.map((x) => x.data)).toEqual(['100.99.0.2']);
    // a device with IPv6 only: an empty answer, not an error
    const none = await ask('nas.keeper', 1);
    expect(none.rcode).toBe(0);
    expect(none.answers).toEqual([]);
  });

  it('says no such name inside the ending, and refuses everything else', async () => {
    expect((await ask('ghost.keeper', 28)).rcode).toBe(3);
    expect((await ask('example.com', 1)).rcode).toBe(5);
    expect(answer(Buffer.from('junk'), 'keeper', { get: () => undefined })).toBeNull();
  });

  it('passes other questions on to the system’s DNS only for mesh peers of an exit node', async () => {
    const upPort = (upstream.address() as { port: number }).port;
    let allow = false;
    const fwd = new MeshDnsServer({ suffix: () => 'keeper', names: { get: () => undefined }, forward: () => [`127.0.0.1:${upPort}`], mayForward: () => allow });
    await fwd.listen('127.0.0.1', [0]);
    const q = (name: string) =>
      new Promise<ReturnType<typeof parseMessage>>((resolve) => {
        const s = dgram.createSocket('udp4');
        s.on('message', (m) => {
          s.close();
          resolve(parseMessage(m));
        });
        s.send(buildQuery(name, 1), fwd.port, '127.0.0.1');
      });
    // not an exit node's peer: refused
    expect((await q('example.com')).rcode).toBe(5);
    // a peer using this device as its exit node: the stand-in upstream answers (NXDOMAIN marks it)
    allow = true;
    expect((await q('example.com')).rcode).toBe(3);
    fwd.close();
  });
});

describe('STUN', () => {
  it('learns the mapped address from a Binding response', async () => {
    const srv = dgram.createSocket('udp4');
    serveStun(srv);
    await new Promise<void>((r) => srv.bind(0, '127.0.0.1', () => r()));
    const c = dgram.createSocket('udp4');
    await new Promise<void>((r) => c.bind(0, '127.0.0.1', () => r()));
    const got = await new Promise<ReturnType<typeof parseBindingResponse>>((resolve) => {
      c.on('message', (m) => resolve(parseBindingResponse(m)));
      c.send(bindingRequest(), (srv.address() as { port: number }).port, '127.0.0.1');
    });
    expect(got).toMatchObject({ ip: '127.0.0.1', port: (c.address() as { port: number }).port });
    expect(parseStunUrl('stun:stun.cloudflare.com:3478')).toEqual({ host: 'stun.cloudflare.com', port: 3478 });
    expect(parseStunUrl('turn:user:pass@x:3478')).toBeNull();
    srv.close();
    c.close();
  });
});

// ---------------------------------------------------------------- two real devices

let root: string;
const nodes: LinkNode[] = [];
const engines: MeshEngine[] = [];

beforeAll(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-mesh-'));
});
afterAll(async () => {
  for (const e of engines) await e.stop().catch(() => undefined);
  for (const n of nodes) await n.stop();
  await fsp.rm(root, { recursive: true, force: true });
});

async function makeNode(name: string): Promise<LinkNode> {
  let stored: LinkData | null = null;
  const dir = await fsp.mkdtemp(path.join(root, name + '-'));
  const hooks: LinkHooks = {
    load: async () => stored,
    save: async (d) => void (stored = JSON.parse(JSON.stringify(d))),
    getSecret: async () => undefined,
    setSecret: async () => false,
    changed: () => undefined,
    transfer: () => undefined,
    pairPrompt: (p) => setTimeout(() => node.confirmPair(p.id, true), 5),
    offer: () => undefined,
    approveCompanion: async () => false,
    notify: () => undefined,
    clipboard: { read: () => '', write: () => undefined },
    downloads: () => dir,
    companionDir: () => dir,
    qr: async (t) => t,
    tunnel: () => undefined,
  };
  const node = new LinkNode(hooks, { hostname: name, os: 'linux', mdns: false });
  await node.start();
  await node.setSettings({ port: 0 });
  nodes.push(node);
  return node;
}

/** Records the steps instead of running them, like a computer where WireGuard is installed. */
function fakeDriver(withWg: boolean) {
  const ran: Step[][] = [];
  let cleanup: Step[] = [];
  const d: MeshDriver & { ran: Step[][]; cleanup: () => Step[] } = {
    os: 'linux',
    ran,
    cleanup: () => cleanup,
    detect: async () => (withWg ? { impl: 'kernel', wg: '/usr/bin/wg', state: 'up' } : { state: 'no-wireguard', message: 'WireGuard is not installed' }),
    ifaceName: async (n) => `km-${n.id.slice(0, 4)}`,
    run: async (s) => {
      ran.push(s);
      return { ok: true, message: '' };
    },
    setCleanup: async (s) => void (cleanup = s),
    readHosts: async () => '127.0.0.1 localhost\n',
    localPrefixes: async () => ['192.168.1.0/24'],
    defaults: async () => ({ gw4: '192.168.1.1', wan: 'eth0', lan: ['192.168.1.0/24'], forwarding: { v4: '0', v6: '0' } }),
    stats: async () => [],
  };
  return d;
}

async function makeMesh(node: LinkNode, driver: MeshDriver, relayUrl?: string) {
  let stored: MeshData | null = null;
  const wg = newWgKey();
  const invites: string[] = [];
  if (relayUrl) await node.setSettings({ mode: 'internet', relayUrl, stun: [] });
  const e = new MeshEngine(linkPort(node), driver, {
    load: async () => stored,
    save: async (d) => void (stored = JSON.parse(JSON.stringify(d))),
    wgKey: async () => wg,
    changed: () => undefined,
    invite: (i) => invites.push(i.id),
    confirm: async () => true,
  }, { bind: '127.0.0.1', basePort: 0 });
  await e.start();
  engines.push(e);
  return { e, wg, invites, stored: () => stored };
}

async function pairNodes(a: LinkNode, b: LinkNode) {
  const inv = await a.createInvite();
  const r = await b.pair({ address: `127.0.0.1:${a.port}`, code: inv.code });
  expect(r.ok).toBe(true);
  await waitFor(() => a.state().devices.length === 1);
}

/** A stand-in for WireGuard's own socket: listens on the network's wgPort. */
async function fakeWg(port: number) {
  const s = dgram.createSocket('udp4');
  const got: Buffer[] = [];
  s.on('message', (m) => got.push(m));
  await new Promise<void>((r) => s.bind(port, '127.0.0.1', () => r()));
  return { s, got };
}

const wgPacket = () => {
  const b = crypto.randomBytes(200);
  b[0] = 4;
  b[1] = b[2] = b[3] = 0;
  return b;
};

describe('two devices over Keeper Link', () => {
  it('exchange signed WireGuard keys, agree on addresses and configs, punch, pass packets, clean up', async () => {
    const A = await makeNode('desk');
    const B = await makeNode('laptop');
    await pairNodes(A, B);
    const da = fakeDriver(true);
    const db = fakeDriver(true);
    const ma = await makeMesh(A, da);
    const mb = await makeMesh(B, db);
    await ma.e.setOn(true);
    await mb.e.setOn(true);
    let s = await ma.e.createNetwork('Home');
    const net = s.networks[0];
    expect(net.prefix6).toMatch(/^fd/);
    expect(net.prefix4).toMatch(/^100\./);
    // A invites B as one of its own devices; B says yes
    await ma.e.addMember(net.id, B.id, 'own');
    await waitFor(() => mb.invites.length === 1);
    expect(mb.e.state().invites[0]).toMatchObject({ name: 'Home', fromName: 'desk', role: 'own' });
    await mb.e.answerInvite(mb.invites[0], true);
    // keys exchanged and verified both ways
    await waitFor(() => ma.e.state().networks[0].peers[0]?.keyVerified === true && mb.e.state().networks[0]?.peers[0]?.keyVerified === true);
    const va = ma.e.state().networks[0];
    const vb = mb.e.state().networks[0];
    expect(va.peers[0].a6).toBe(vb.me.a6);
    expect(vb.peers[0].a6).toBe(va.me.a6);
    expect(va.peers[0].a4).toBe(vb.me.a4);
    expect(va.peers[0].dns).toBe('laptop.keeper');
    expect(vb.peers[0].dns).toBe('desk.keeper');
    // each side's config has the other's public key and addresses
    const ca = ma.e.config(net.id);
    const cb = mb.e.config(net.id);
    expect(ca).toContain(`PublicKey = ${mb.wg.pub}`);
    expect(cb).toContain(`PublicKey = ${ma.wg.pub}`);
    expect(ca).toContain(`AllowedIPs = ${vb.me.a6}/128, ${vb.me.a4}/32`);
    expect(cb).toContain(`AllowedIPs = ${va.me.a6}/128, ${va.me.a4}/32`);
    expect(ca).toContain(`Address = ${va.me.a6}/48, ${va.me.a4}/16`);
    expect(ca).not.toContain(ma.wg.priv);
    // the interface was put into the (fake) system with the right commands
    const flat = da.ran.flat().map((x) => [x.file, ...x.args].join(' '));
    expect(flat).toContain(`ip link add dev km-${net.id.slice(0, 4)} type wireguard`);
    expect(flat).toContain(`ip -6 address add ${va.me.a6}/48 dev km-${net.id.slice(0, 4)}`);
    const sync = da.ran.flat().filter((x) => x.args[0] === 'syncconf').pop();
    expect(sync?.stdin).toContain(`PublicKey = ${mb.wg.pub}`);
    // a direct path over the local network
    await waitFor(() => ma.e.state().networks[0].peers[0].path === 'lan' && mb.e.state().networks[0].peers[0].path === 'lan');
    // WireGuard packets pass through the shims: A's WireGuard → A's shim for B → B's mesh socket → B's WireGuard
    const ra = ma.e.runtime(net.id)!;
    const rb = mb.e.runtime(net.id)!;
    const wa = await fakeWg(ra.wgPort!);
    const wb = await fakeWg(rb.wgPort!);
    const pkt = wgPacket();
    wa.s.send(pkt, ra.shim(B.id)!, '127.0.0.1');
    await waitFor(() => wb.got.length === 1);
    expect(wb.got[0].equals(pkt)).toBe(true);
    const back = wgPacket();
    wb.s.send(back, rb.shim(A.id)!, '127.0.0.1');
    await waitFor(() => wa.got.length === 1);
    expect(wa.got[0].equals(back)).toBe(true);
    // a packet that does not come from WireGuard's own port is ignored
    const stranger = dgram.createSocket('udp4');
    stranger.send(wgPacket(), ra.shim(B.id)!, '127.0.0.1');
    await wait(150);
    expect(wb.got).toHaveLength(1);
    stranger.close();
    wa.s.close();
    wb.s.close();
    // names
    const st = ma.e.state();
    expect(st.dns.responder).toMatch(/^127\.0\.0\.1:\d+$/);
    // the crash-safe plan is with the helper, and turning off runs it
    expect(da.cleanup().length).toBeGreaterThan(0);
    s = await ma.e.setOn(false);
    expect(s.iface.state).toBe('off');
    const last = da.ran[da.ran.length - 1].map((x) => [x.file, ...x.args].join(' '));
    expect(last).toContain(`ip link delete dev km-${net.id.slice(0, 4)}`);
    expect(last).toContain('nft delete table inet keeper_mesh_acl');
    expect(da.cleanup()).toEqual([]);
    expect(ma.stored()!.applied).toBeUndefined();
    await mb.e.setOn(false);
  });

  it('refuses a mesh key from a device that is not a member, and a tampered record', async () => {
    const A = await makeNode('a1');
    const B = await makeNode('b1');
    await pairNodes(A, B);
    const ma = await makeMesh(A, fakeDriver(true));
    const mb = await makeMesh(B, fakeDriver(true));
    await ma.e.setOn(true);
    await mb.e.setOn(true);
    const s = await ma.e.createNetwork('Work');
    // B was never invited: A will not take its record
    await expect(mb.e.ctl(A.id, 'hello', { net: s.networks[0].id, rec: {} })).rejects.toThrow(/not a member/);
    // invited, but the record is altered on the way
    await ma.e.addMember(s.networks[0].id, B.id, 'guest');
    await waitFor(() => mb.invites.length === 1);
    await mb.e.answerInvite(mb.invites[0], true);
    await waitFor(() => ma.e.state().networks[0].peers[0]?.keyVerified === true);
    const forged = { rec: { v: 1, net: s.networks[0].id, dev: B.id, to: A.id, name: 'x', wg: newWgKey().pub, a6: 'fd00::1', port: 1, cands: [], pk: Buffer.alloc(32).toString('base64'), seq: 999, ts: Date.now() }, sig: Buffer.alloc(64).toString('base64') };
    await expect(mb.e.ctl(A.id, 'hello', { net: s.networks[0].id, rec: forged })).rejects.toThrow(/bad signature/);
    // guests: a firewall that lets them reach nothing but ping and names
    const acl = (ma.e as unknown as { acl(n: unknown): unknown[] }).acl(ma.e.data.networks[0]);
    expect(acl).toEqual([]);
  });

  it('passes packets through the Keeper Relay when no direct path is allowed', async () => {
    const httpSrv = http.createServer((_q, r) => r.end());
    const linkRelay = new RelayServer();
    const pktRelay = new PacketRelayServer();
    attachRelays(httpSrv, linkRelay, pktRelay);
    await new Promise<void>((r) => httpSrv.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(httpSrv.address() as { port: number }).port}`;
    const A = await makeNode('r-a');
    const B = await makeNode('r-b');
    await pairNodes(A, B);
    const ma = await makeMesh(A, fakeDriver(false), url);
    const mb = await makeMesh(B, fakeDriver(false), url);
    ma.e.forceRelay = true;
    mb.e.forceRelay = true;
    await ma.e.setOn(true);
    await mb.e.setOn(true);
    expect(ma.e.state().iface.state).toBe('config-only');
    expect(ma.e.state().relay?.connected).toBe(true);
    const s = await ma.e.createNetwork('Away');
    const id = s.networks[0].id;
    await ma.e.addMember(id, B.id, 'own');
    await waitFor(() => mb.invites.length === 1);
    await mb.e.answerInvite(mb.invites[0], true);
    await waitFor(() => ma.e.state().networks[0].peers[0]?.keyVerified === true && mb.e.state().networks[0]?.peers[0]?.keyVerified === true);
    await waitFor(() => ma.e.state().networks[0].peers[0].path === 'relay' && mb.e.state().networks[0].peers[0].path === 'relay', 10_000);
    const ra = ma.e.runtime(id)!;
    const rb = mb.e.runtime(id)!;
    const wa = await fakeWg(ra.wgPort!);
    const wb = await fakeWg(rb.wgPort!);
    const pkt = wgPacket();
    wa.s.send(pkt, ra.shim(B.id)!, '127.0.0.1');
    await waitFor(() => wb.got.length === 1);
    expect(wb.got[0].equals(pkt)).toBe(true);
    expect(pktRelay.stats.packets).toBeGreaterThanOrEqual(1);
    expect(ra.relayed.out).toBe(1);
    wa.s.close();
    wb.s.close();
    await ma.e.setOn(false);
    await mb.e.setOn(false);
    pktRelay.close();
    linkRelay.close();
    httpSrv.close();
  }, 30_000);

  it('cleans up what a crash left behind when it starts again', async () => {
    const A = await makeNode('crash');
    const d = fakeDriver(true);
    let stored: MeshData | null = { v: 1, on: false, suffix: 'keeper', hosts: false, networks: [], peers: {}, seq: 0, pk: Buffer.alloc(32).toString('base64'), exit: { killSwitch: true, dnsThrough: true, allowLan: true }, offerExit: false, advertise: [], acceptRoutes: [], applied: { ...emptyApplied('linux'), ifaces: [{ os: 'linux', iface: 'km-dead', impl: 'kernel' }], dns: [{ iface: 'km-dead', suffix: 'keeper' }], exitUse: { os: 'linux', iface: 'km-dead', bypass: ['203.0.113.7'], killSwitch: true, allowLan: false, lan: [] } } };
    const e = new MeshEngine(linkPort(A), d, { load: async () => stored, save: async (x) => void (stored = JSON.parse(JSON.stringify(x))), wgKey: async () => newWgKey(), changed: () => undefined }, { bind: '127.0.0.1', basePort: 0 });
    await e.start();
    const l = d.ran.flat().map((x) => [x.file, ...x.args].join(' '));
    expect(l[0]).toBe('nft delete table inet keeper_mesh_kill');
    expect(l).toContain('resolvectl revert km-dead');
    expect(l).toContain('ip link delete dev km-dead');
    expect(stored!.applied).toBeUndefined();
  });
});
