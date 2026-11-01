// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Moving WireGuard's packets for one mesh network, without privileges.
//
//   WireGuard (km-xxxx / utunN / tunnel service), listening on 127.0.0.1:wgPort
//        │ peer B's endpoint is 127.0.0.1:<shim port for B>
//        ▼
//   shim socket for B ──▶ the path to B: direct UDP from the mesh socket (after hole punching)
//                                       or the Keeper Relay WebSocket (wrapped, still encrypted)
//   mesh socket ◀── packets from B ──▶ sent to 127.0.0.1:wgPort from B's shim socket
//
// So WireGuard always sees each peer at a fixed local address, and Keeper can
// move the path (local network, internet, relay, roaming) underneath it
// without touching the interface. The mesh socket also carries the path
// probes and the STUN request, so the public port STUN reports is the one
// the peer's packets must be sent to. Plain Node: runs in tests too.

import dgram from 'node:dgram';
import { isStun, parseBindingResponse, parseStunUrl, stunQuery } from '../../../core/mesh/stun';
import { isProbe, isWireGuard, PeerPath, probeHeader, TIMINGS, type PathTimings } from '../../../core/mesh/paths';
import type { PacketRelayClient } from '../../../core/mesh/packet-relay';
import type { Candidate } from '../../../core/mesh/types';

export interface DataPathOpts {
  me: string;
  /** 4-byte tag of the network, put in front of relayed packets */
  tag: Buffer;
  port: number;
  wgPort: () => number;
  relay: () => PacketRelayClient | null;
  timings?: PathTimings;
  onChange?: () => void;
  /** where to bind the mesh socket (tests use 127.0.0.1 or a namespace address) */
  bind?: string;
}

interface Peer {
  path: PeerPath;
  shim: dgram.Socket;
  shimPort: number;
  rx: number;
  tx: number;
}

export class DataPath {
  private sock: dgram.Socket | null = null;
  private peers = new Map<string, Peer>();
  private stunWaits = new Map<string, (r: { ip: string; port: number } | null) => void>();
  port = 0;
  publicAddr?: { ip: string; port: number };
  relayed = { in: 0, out: 0 };

  constructor(private o: DataPathOpts) {}

  async start() {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.bind(this.o.port, this.o.bind, () => {
        s.off('error', reject);
        resolve();
      });
    }).catch(async () => {
      // the port is taken (or not allowed): any free one; peers learn it from the record
      await new Promise<void>((resolve, reject) => {
        s.once('error', reject);
        s.bind(0, this.o.bind, () => resolve());
      });
    });
    s.on('message', (m, r) => this.fromNet(m, r.address.replace(/^::ffff:/, ''), r.port));
    s.on('error', () => undefined);
    this.sock = s;
    this.port = s.address().port;
  }

  stop() {
    for (const p of this.peers.values()) p.shim.close();
    this.peers.clear();
    this.sock?.close();
    this.sock = null;
  }

  /** The send function the path machines use. */
  private send = (b: Buffer, port: number, host: string) => this.sock?.send(b, port, host);

  async addPeer(device: string, key: Buffer, cands: Candidate[]): Promise<number> {
    const have = this.peers.get(device);
    if (have) {
      have.path.setKey(key);
      have.path.setCandidates(cands);
      return have.shimPort;
    }
    const path = new PeerPath(this.o.me, device, key, { send: this.send }, this.o.timings ?? TIMINGS, { change: () => this.o.onChange?.(), relay: () => !!this.o.relay()?.connected });
    path.setCandidates(cands);
    const shim = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => shim.bind(0, '127.0.0.1', () => resolve()));
    const peer: Peer = { path, shim, shimPort: shim.address().port, rx: 0, tx: 0 };
    shim.on('message', (m, r) => {
      // only WireGuard itself, from its own port, sends through the shim
      if (r.address !== '127.0.0.1' || r.port !== this.o.wgPort()) return;
      this.toPeer(peer, device, m);
    });
    shim.on('error', () => undefined);
    this.peers.set(device, peer);
    return peer.shimPort;
  }

  removePeer(device: string) {
    const p = this.peers.get(device);
    if (!p) return;
    p.shim.close();
    this.peers.delete(device);
  }

  peer(device: string) {
    return this.peers.get(device);
  }

  shimPort(device: string) {
    return this.peers.get(device)?.shimPort;
  }

  devices() {
    return [...this.peers.keys()];
  }

  /** Path timers; returns how soon it wants to be called again. */
  tick(now: number): number {
    let next = 30_000;
    for (const p of this.peers.values()) {
      p.path.tick(now);
      if (p.path.state === 'punching') next = Math.min(next, (this.o.timings ?? TIMINGS).probeEveryMs);
      else if (now < p.path.activeUntil) next = Math.min(next, 5000);
    }
    return next;
  }

  punch(device: string, now = Date.now()) {
    this.peers.get(device)?.path.punch(now);
  }

  /** A packet relayed from `device` for this network. */
  fromRelay(device: string, packet: Uint8Array) {
    const p = this.peers.get(device);
    if (!p || !isWireGuard(packet)) return;
    this.relayed.in++;
    p.rx += packet.length;
    p.path.touch(Date.now());
    p.shim.send(packet, this.o.wgPort(), '127.0.0.1');
  }

  /** Learns this socket's public address from the STUN servers in Link's settings. */
  async stun(servers: string[], ms = 2500): Promise<{ ip: string; port: number } | null> {
    const list = servers.map(parseStunUrl).filter((x): x is { host: string; port: number } => !!x);
    if (!list.length || !this.sock) return null;
    const r = await stunQuery({ send: this.send }, list, (tid, wait) => new Promise((resolve) => {
      const t = setTimeout(() => {
        this.stunWaits.delete(tid);
        resolve(null);
      }, wait);
      this.stunWaits.set(tid, (x) => {
        clearTimeout(t);
        this.stunWaits.delete(tid);
        resolve(x);
      });
    }), ms);
    if (r) this.publicAddr = r;
    return r;
  }

  private toPeer(p: Peer, device: string, m: Buffer) {
    const now = Date.now();
    p.path.touch(now);
    const r = p.path.route();
    if (!r) return;
    p.tx += m.length;
    if (r.via === 'direct') this.sock?.send(m, r.port, r.host);
    else {
      this.relayed.out++;
      this.o.relay()?.send(device, Buffer.concat([this.o.tag, m]));
    }
  }

  private fromNet(m: Buffer, host: string, port: number) {
    const now = Date.now();
    if (isStun(m)) {
      const r = parseBindingResponse(m);
      if (r) this.stunWaits.get(r.tid)?.({ ip: r.ip, port: r.port });
      return;
    }
    if (isProbe(m)) {
      const h = probeHeader(m);
      const p = h ? this.peers.get(h.from) : undefined;
      if (p && p.path.receive(m, host, port, now)) this.o.onChange?.();
      return;
    }
    if (!isWireGuard(m)) return;
    // WireGuard data: only from the address a peer's probes proved is theirs
    for (const p of this.peers.values()) {
      const b = p.path.best;
      if (p.path.state === 'direct' && b && b.host === host && b.port === port) {
        p.rx += m.length;
        p.path.touch(now);
        p.shim.send(m, this.o.wgPort(), '127.0.0.1');
        return;
      }
    }
  }
}
