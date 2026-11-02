// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's DNS filter: a small resolver on this computer. It answers from a
// short cache, refuses names on the person's blocklists and "deny" host rules
// (also when a harmless name is only an alias for a blocked one), and asks the
// chosen upstream — encrypted when DNS over HTTPS or TLS is chosen — for the
// rest. Every question goes into a query log kept on this computer.
//
// Port 53 needs administrator rights; Keeper's helper (or the system service)
// forwards to it. Without that it listens on a high port that tests and
// advanced users can point at directly.

import dgram from 'node:dgram';
import net from 'node:net';
import { blockedReply, errorReply, minTtl, namesIn, parseMessage, addressesIn, withId, typeName, type QueryLogEntry, type Upstream } from '../../../core/fw/dns';
export type { QueryLogEntry };
import { clientFor, type DnsClient } from './dns-client';

export interface ResolverOptions {
  port: number;
  host?: string;
  upstream: Upstream;
  /** decides a name: undefined to allow, otherwise what blocked it */
  blocked: (name: string) => string | undefined;
  onLog?: (e: QueryLogEntry) => void;
  /** address → name, for naming connections in the monitor */
  onAnswer?: (name: string, addrs: string[]) => void;
  /** for tests: trust a local test certificate */
  test?: { ca?: string | Buffer; rejectUnauthorized?: boolean };
}

export class Resolver {
  private udp4?: dgram.Socket;
  private tcp?: net.Server;
  private client?: DnsClient;
  private cache = new Map<string, { reply: Buffer; until: number }>();
  stats = { queries: 0, blocked: 0, cached: 0, errors: 0 };

  constructor(private o: ResolverOptions) {}

  async start(): Promise<number> {
    this.client = clientFor(this.o.upstream, this.o.test);
    // Port 0 means "any free port": UDP gets one, but TCP may not be allowed the same number
    // (Windows reserves blocks of ports for Hyper-V and answers EACCES), so try another one.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.listenOnce();
      } catch (e) {
        this.udp4?.close();
        this.udp4 = undefined;
        this.tcp?.close();
        this.tcp = undefined;
        const code = (e as NodeJS.ErrnoException).code;
        if (this.o.port !== 0 || attempt >= 20 || (code !== 'EACCES' && code !== 'EADDRINUSE')) throw e;
      }
    }
  }

  private async listenOnce(): Promise<number> {
    const host = this.o.host ?? '127.0.0.1';
    this.udp4 = dgram.createSocket('udp4');
    await new Promise<void>((res, rej) => { this.udp4!.once('error', rej); this.udp4!.bind(this.o.port, host, () => res()); });
    const port = (this.udp4.address() as net.AddressInfo).port;
    this.udp4.on('message', (msg, rinfo) => void this.answer(msg).then((r) => r && this.udp4?.send(r, rinfo.port, rinfo.address)));
    this.tcp = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) {
          const len = buf.readUInt16BE(0);
          const q = buf.subarray(2, 2 + len);
          buf = buf.subarray(2 + len);
          void this.answer(Buffer.from(q)).then((r) => { if (r) { const l = Buffer.alloc(2); l.writeUInt16BE(r.length); sock.write(Buffer.concat([l, r])); } });
        }
      });
      sock.on('error', () => undefined);
      sock.setTimeout(10_000, () => sock.destroy());
    });
    await new Promise<void>((res, rej) => { this.tcp!.once('error', rej); this.tcp!.listen(port, host, () => res()); });
    return port;
  }

  setUpstream(u: Upstream) {
    this.client?.close();
    this.o.upstream = u;
    this.client = clientFor(u, this.o.test);
    this.cache.clear();
  }

  /** After lists or rules change, cached answers may no longer be right. */
  flush() { this.cache.clear(); }

  async answer(query: Buffer): Promise<Buffer | null> {
    const t0 = Date.now();
    let msg;
    try {
      msg = parseMessage(query);
    } catch {
      return null; // not DNS: no answer at all
    }
    const q = msg.questions[0];
    if (!q) return errorReply(query, 5);
    this.stats.queries++;
    const log = (e: Partial<QueryLogEntry>) => this.o.onLog?.({ t: t0, name: q.name, type: typeName(q.type), ms: Date.now() - t0, ...e });
    const by = this.o.blocked(q.name);
    if (by) {
      this.stats.blocked++;
      log({ blockedBy: by });
      return blockedReply(query);
    }
    const key = `${q.name}/${q.type}`;
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) {
      this.stats.cached++;
      log({ cached: true });
      return withId(hit.reply, msg.id);
    }
    try {
      const reply = await this.client!.query(query);
      const parsed = parseMessage(reply);
      // A harmless name can be an alias (CNAME) for a tracker: check every name in the answer.
      for (const n of namesIn(parsed)) {
        const b = n === q.name ? undefined : this.o.blocked(n);
        if (b) {
          this.stats.blocked++;
          log({ blockedBy: `${b} (through ${n})` });
          return blockedReply(query);
        }
      }
      const addrs = addressesIn(parsed);
      if (addrs.length) this.o.onAnswer?.(q.name, addrs);
      this.cache.set(key, { reply, until: Date.now() + minTtl(parsed) * 1000 });
      if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value!);
      log({ answer: addrs });
      return withId(reply, msg.id);
    } catch (e) {
      this.stats.errors++;
      log({ error: (e as Error).message });
      return errorReply(query, 2);
    }
  }

  async stop() {
    this.client?.close();
    await new Promise<void>((r) => (this.udp4 ? this.udp4.close(() => r()) : r()));
    await new Promise<void>((r) => (this.tcp ? this.tcp.close(() => r()) : r()));
    this.udp4 = undefined;
    this.tcp = undefined;
  }
}
