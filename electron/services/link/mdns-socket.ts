// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Multicast DNS on the local network: answers "which Keeper devices are
// here?" with this device, and listens for the others. Quiet by design: it
// announces when something changes and answers questions; it never polls.

import dgram from 'node:dgram';
import os from 'node:os';
import { announcement, decode, encode, keeperDevices, MDNS_ADDR, MDNS_PORT, query, SERVICE, TYPE, type Announce, type Found } from '../../../core/link/mdns';

export class MdnsPeer {
  private sock: dgram.Socket | null = null;
  private me: (() => Announce | null) | null = null;
  readonly seen = new Map<string, Found & { at: number }>();
  onfound?: (f: Found) => void;
  error?: string;

  async start(me: () => Announce | null): Promise<boolean> {
    this.me = me;
    if (this.sock) return true;
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    try {
      await new Promise<void>((resolve, reject) => {
        sock.once('error', reject);
        sock.bind(MDNS_PORT, () => {
          sock.off('error', reject);
          resolve();
        });
      });
      for (const ip of lanIPv4()) {
        try {
          sock.addMembership(MDNS_ADDR, ip);
        } catch {
          /* that interface does not do multicast */
        }
      }
      try {
        sock.addMembership(MDNS_ADDR);
      } catch {
        /* already joined */
      }
      sock.setMulticastTTL(255);
      sock.setMulticastLoopback(true);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      sock.close();
      return false;
    }
    sock.on('message', (m) => this.receive(m));
    sock.on('error', () => undefined);
    this.sock = sock;
    this.announce();
    return true;
  }

  stop() {
    const me = this.me?.();
    if (me && this.sock) this.send(announcement(me, 0)); // goodbye
    this.sock?.close();
    this.sock = null;
  }

  /** Tells the network about this device (after a change: name, pairing, addresses). */
  announce() {
    const me = this.me?.();
    if (me) this.send(announcement(me));
  }

  /** Asks who is there; answers arrive through onfound. */
  query() {
    this.send(query());
  }

  private send(p: ReturnType<typeof query>) {
    if (!this.sock) return;
    const buf = Buffer.from(encode(p));
    this.sock.send(buf, MDNS_PORT, MDNS_ADDR, () => undefined);
  }

  private receive(m: Buffer) {
    let p;
    try {
      p = decode(new Uint8Array(m));
    } catch {
      return;
    }
    if (!p.response) {
      if (p.questions.some((q) => q.name.toLowerCase() === SERVICE && (q.type === TYPE.PTR || q.type === TYPE.ANY))) this.announce();
      return;
    }
    const mine = this.me?.()?.id;
    for (const f of keeperDevices(p)) {
      if (f.id === mine) continue;
      if (f.ttl === 0) this.seen.delete(f.id);
      else {
        this.seen.set(f.id, { ...f, at: Date.now() });
        this.onfound?.(f);
      }
    }
  }

  /** Devices heard from in the last few minutes. */
  fresh(maxAgeMs = 4 * 60_000): (Found & { at: number })[] {
    const now = Date.now();
    return [...this.seen.values()].filter((f) => now - f.at < maxAgeMs);
  }
}

/** This computer's addresses on local networks (no loopback, no link-local). */
export function lanIPv4(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  return out;
}

/** Interfaces that look like WireGuard, to show next to the device card. */
export function wireguardInterfaces(): string[] {
  return Object.keys(os.networkInterfaces()).filter((n) => /^(wg\d*|wireguard|wt\d)/i.test(n) || /wireguard/i.test(n));
}
