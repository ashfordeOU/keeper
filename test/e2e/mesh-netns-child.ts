// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One device in the network-namespace test (test/e2e/mesh-netns.cjs). Runs
// inside `ip netns exec <ns>` and talks to the parent with JSON lines.
//   device  Keeper's real data path: STUN through a real Linux NAT, then
//           simultaneous hole punching with the peer, then a WireGuard-shaped
//           packet through the local shim and back out on the other side;
//           optionally the mesh DNS responder on this device's mesh address
//   dnsq    asks a DNS server one question and prints the answer
//   stun    a STUN server

import dgram from 'node:dgram';
import readline from 'node:readline';
import { buildQuery, parseMessage } from '../../core/fw/dns';
import { MeshDnsServer } from '../../core/mesh/dns';
import { serveStun } from '../../core/mesh/stun';
import type { Candidate } from '../../core/mesh/types';
import { DataPath } from '../../electron/services/mesh/datapath';

const say = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');
const [role, json] = process.argv.slice(2);
const a = JSON.parse(json ?? '{}');

async function device() {
  const wgPort = 51000;
  const dp = new DataPath({ me: a.me, tag: Buffer.from('3f2a9c1d', 'hex'), port: 41820, wgPort: () => wgPort, relay: () => null, bind: '0.0.0.0', onChange: () => undefined });
  await dp.start();
  const pub = await dp.stun([`stun:${a.stun}:3478`]);
  const cands: Candidate[] = [{ kind: 'lan', addr: `${a.lan}:${dp.port}` }, ...(pub ? [{ kind: 'public' as const, addr: `${pub.ip}:${pub.port}` }] : [])];
  // the fake WireGuard: listens where WireGuard would, records what arrives
  const wg = dgram.createSocket('udp4');
  const got: string[] = [];
  wg.on('message', (m) => got.push(m.toString('hex')));
  await new Promise<void>((r) => wg.bind(wgPort, '127.0.0.1', () => r()));
  let dns: MeshDnsServer | undefined;
  if (a.dns) {
    const names = new Map<string, { a4?: string; a6?: string }>(Object.entries(a.dns.names));
    dns = new MeshDnsServer({ suffix: () => 'keeper', names: { get: (l) => names.get(l) } });
    await dns.listen(a.dns.addr, [53]);
  }
  say({ ev: 'ready', cands, stun: pub, dns: dns ? `${dns.address}:${dns.port}` : undefined });
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    const m = JSON.parse(line);
    if (m.cmd === 'punch') {
      const shim = await dp.addPeer(a.peer, Buffer.from(a.key, 'hex'), m.cands);
      dp.punch(a.peer);
      const t0 = Date.now();
      while (Date.now() - t0 < 7000) {
        dp.tick(Date.now());
        const p = dp.peer(a.peer)!.path;
        if (p.state === 'direct') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const p = dp.peer(a.peer)!.path;
      say({ ev: 'punched', state: p.state, path: p.path, best: p.best, rounds: p.rounds, shim });
    } else if (m.cmd === 'send') {
      const pkt = Buffer.alloc(120, 0x5a);
      pkt[0] = 4;
      pkt[1] = pkt[2] = pkt[3] = 0;
      wg.send(pkt, dp.shimPort(a.peer)!, '127.0.0.1');
      say({ ev: 'sent', hex: pkt.toString('hex') });
    } else if (m.cmd === 'received') {
      say({ ev: 'received', got });
    } else if (m.cmd === 'quit') {
      dns?.close();
      wg.close();
      dp.stop();
      process.exit(0);
    }
  }
}

async function dnsq() {
  const s = dgram.createSocket(a.server.includes(':') ? 'udp6' : 'udp4');
  const t = setTimeout(() => {
    say({ ev: 'dns', error: 'no answer' });
    process.exit(1);
  }, 3000);
  s.on('message', (m) => {
    clearTimeout(t);
    const r = parseMessage(m);
    say({ ev: 'dns', rcode: r.rcode, answers: r.answers.map((x) => x.data) });
    process.exit(0);
  });
  s.send(buildQuery(a.name, a.type), 53, a.server);
}

async function stun() {
  const s = dgram.createSocket('udp4');
  serveStun(s);
  await new Promise<void>((r) => s.bind(3478, a.ip, () => r()));
  say({ ev: 'ready' });
}

void (role === 'device' ? device() : role === 'dnsq' ? dnsq() : stun()).catch((e) => {
  say({ ev: 'error', error: String(e?.stack ?? e) });
  process.exit(1);
});
