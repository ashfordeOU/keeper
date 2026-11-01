// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One device in the network-namespace test (test/e2e/mesh-netns.cjs). Runs
// inside `ip netns exec <ns>` and talks to the parent with JSON lines.
//   device  Keeper's real data path: STUN through a real Linux NAT, then
//           simultaneous hole punching with the peer, then a WireGuard-shaped
//           packet through the local shim and back out on the other side;
//           optionally the mesh DNS responder on this device's mesh address
//   wgdevice  the same data path in front of a real WireGuard (wireguard-go):
//           configures the peer at its shim through the helper's own runner,
//           then runs the direct handoff (core/mesh/handoff.ts) against
//           WireGuard's real counters, reporting each change
//   dnsq    asks a DNS server one question and prints the answer
//   stun    a STUN server

import dgram from 'node:dgram';
import readline from 'node:readline';
import { buildQuery, parseMessage } from '../../core/fw/dns';
import { MeshDnsServer } from '../../core/mesh/dns';
import { freshHandoff, peerEndpointStep, stepHandoff, type HandoffPeer } from '../../core/mesh/handoff';
import { serveStun } from '../../core/mesh/stun';
import { parseUapiGet } from '../../core/mesh/wgconfig';
import type { runSteps as RunSteps } from '../../electron/services/mesh/helper';
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

async function wgdevice() {
  const guard = { os: 'linux' as const, wg: 'wg', wgGo: a.wgGo };
  // the helper's own runner, from the parent's bundle (bundling the helper here would start its main())
  const { runSteps } = (await import(a.lib)) as { runSteps: typeof RunSteps };
  const run = async (steps: Parameters<typeof RunSteps>[0]) => {
    const r = await runSteps(steps, guard);
    if (!r.ok) throw new Error(r.message);
    return r.outputs ?? [];
  };
  const dp = new DataPath({ me: a.me, tag: Buffer.from('3f2a9c1d', 'hex'), port: 41830, wgPort: () => a.wgPort, relay: () => null, bind: '0.0.0.0', onChange: () => undefined });
  await dp.start();
  const pub = await dp.stun([`stun:${a.stun}:3478`]);
  const cands: Candidate[] = [{ kind: 'lan', addr: `${a.lan}:${dp.port}` }, ...(pub ? [{ kind: 'public' as const, addr: `${pub.ip}:${pub.port}` }] : [])];
  const ticker = setInterval(() => dp.tick(Date.now()), 200);
  const wgStats = async () => parseUapiGet((await run([{ file: 'uapi', args: [a.iface], stdin: 'get=1\n\n' }]))[0] ?? '').find((x) => x.pub === a.peerPub);
  let handoff: HandoffPeer = freshHandoff(Date.now());
  let loop: NodeJS.Timeout | undefined;
  say({ ev: 'ready', cands, stun: pub });
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    const m = JSON.parse(line);
    const peer = () => dp.peer(a.peer)!;
    if (m.cmd === 'punch') {
      const shim = await dp.addPeer(a.peer, Buffer.from(a.key, 'hex'), m.cands);
      dp.punch(a.peer);
      const t0 = Date.now();
      while (Date.now() - t0 < 7000 && peer().path.state !== 'direct') await new Promise((r) => setTimeout(r, 100));
      // WireGuard sees the peer at its shim, exactly as the engine sets it up
      const hex = Buffer.from(a.peerPub, 'base64').toString('hex');
      await run([{ file: 'uapi', args: [a.iface], stdin: `set=1\npublic_key=${hex}\nendpoint=127.0.0.1:${shim}\npersistent_keepalive_interval=5\nreplace_allowed_ips=true\nallowed_ip=${a.peerAddr}/32\n\n` }]);
      say({ ev: 'punched', state: peer().path.state, path: peer().path.path, best: peer().path.best, shim });
    } else if (m.cmd === 'counters') {
      say({ ev: 'counters', tx: peer().tx, rx: peer().rx, wg: await wgStats() });
    } else if (m.cmd === 'handoff') {
      const t = { stableMs: 2000, verifyMs: 20_000, resetMs: 2000, brokenMs: 4000, backoffMs: [600_000] };
      let busy = false;
      loop = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          const now = Date.now();
          const st = await wgStats();
          const p = peer();
          const before = handoff;
          const { next, set } = stepHandoff(handoff, { now, direct: p.path.state === 'direct', best: p.path.best, peerWgPort: a.peerWgPort, active: true, stats: st ? { endpoint: st.endpoint, rx: st.rx, tx: st.tx } : undefined, allowed: true }, t);
          handoff = next;
          if (set) {
            const ep = set === 'shim' ? `127.0.0.1:${p.shimPort}` : set;
            await run([peerEndpointStep({ os: 'linux', impl: 'wireguard-go', iface: a.iface }, a.peerPub, ep)!]);
          }
          if (next.state !== before.state || set) say({ ev: 'handoff', state: next.state, set, endpoint: next.endpoint, wg: st?.endpoint, failures: next.failures });
        } catch (e) {
          say({ ev: 'handoff-error', error: String(e) });
        } finally {
          busy = false;
        }
      }, 500);
    } else if (m.cmd === 'quit') {
      clearInterval(ticker);
      if (loop) clearInterval(loop);
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

void (role === 'device' ? device() : role === 'wgdevice' ? wgdevice() : role === 'dnsq' ? dnsq() : stun()).catch((e) => {
  say({ ev: 'error', error: String(e?.stack ?? e) });
  process.exit(1);
});
