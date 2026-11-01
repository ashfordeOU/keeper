// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Asking an upstream DNS server: DNS over HTTPS (RFC 8484), DNS over TLS
// (RFC 7858, one kept-open connection with queued queries), or plain UDP.
// DNS over QUIC (RFC 9250) needs a QUIC stack this runtime does not have yet;
// it is listed but reported as unavailable.

import dgram from 'node:dgram';
import dns from 'node:dns';
import https from 'node:https';
import tls from 'node:tls';
import type { Upstream } from '../../../core/fw/dns';

export interface DnsClient {
  query(msg: Buffer, timeoutMs?: number): Promise<Buffer>;
  close(): void;
}

/** RFC 8484 POST with application/dns-message. `ca`/`lookup` are for tests. */
export function dohClient(url: string, opts: { bootstrap?: string[]; ca?: string | Buffer; rejectUnauthorized?: boolean } = {}): DnsClient {
  const u = new URL(url);
  const agent = new https.Agent({ keepAlive: true, maxSockets: 4, ca: opts.ca, rejectUnauthorized: opts.rejectUnauthorized });
  // Reaching the resolver must not depend on DNS (which may be us): use its known addresses.
  const lookup = opts.bootstrap?.length
    ? ((_h: string, o: unknown, cb: (e: Error | null, addr: string | dns.LookupAddress[], fam?: number) => void) => {
      const a = opts.bootstrap![0];
      if ((o as { all?: boolean })?.all) cb(null, [{ address: a, family: a.includes(':') ? 6 : 4 }]);
      else cb(null, a, a.includes(':') ? 6 : 4);
    }) as never
    : undefined;
  return {
    query(msg, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const req = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST', agent, lookup, timeout: timeoutMs,
          headers: { 'content-type': 'application/dns-message', accept: 'application/dns-message', 'content-length': msg.length } }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error(`DNS server answered ${res.statusCode}`))));
        });
        req.on('timeout', () => req.destroy(new Error('DNS server took too long')));
        req.on('error', reject);
        req.end(msg);
      });
    },
    close: () => agent.destroy(),
  };
}

/** RFC 7858: TLS to port 853, each message prefixed by its 2-byte length; answers matched by id. */
export function dotClient(address: string, opts: { servername?: string; ca?: string | Buffer; rejectUnauthorized?: boolean } = {}): DnsClient {
  const [host, portS] = address.includes(']') ? [address.slice(1, address.indexOf(']')), address.split(']:')[1]] : address.split(':');
  const port = Number(portS || 853);
  let sock: tls.TLSSocket | null = null;
  let buf = Buffer.alloc(0);
  const waiting = new Map<number, { resolve: (b: Buffer) => void; reject: (e: Error) => void; t: NodeJS.Timeout }>();
  const fail = (e: Error) => { for (const w of waiting.values()) { clearTimeout(w.t); w.reject(e); } waiting.clear(); sock?.destroy(); sock = null; };
  const connect = () => {
    if (sock) return sock;
    buf = Buffer.alloc(0);
    const s = tls.connect({ host, port, servername: opts.servername ?? host, ca: opts.ca, rejectUnauthorized: opts.rejectUnauthorized });
    s.setKeepAlive(true);
    s.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const len = buf.readUInt16BE(0);
        if (buf.length < 2 + len) break;
        const m = buf.subarray(2, 2 + len);
        buf = buf.subarray(2 + len);
        const w = waiting.get(m.readUInt16BE(0));
        if (w) { clearTimeout(w.t); waiting.delete(m.readUInt16BE(0)); w.resolve(Buffer.from(m)); }
      }
    });
    s.on('error', fail);
    s.on('close', () => { if (sock === s) sock = null; });
    // An idle connection is closed by the server after a while; open a new one on the next question.
    s.setTimeout(30_000, () => s.end());
    sock = s;
    return s;
  };
  return {
    query(msg, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const id = msg.readUInt16BE(0);
        const t = setTimeout(() => { waiting.delete(id); reject(new Error('DNS server took too long')); }, timeoutMs);
        waiting.set(id, { resolve, reject, t });
        const len = Buffer.alloc(2);
        len.writeUInt16BE(msg.length);
        connect().write(Buffer.concat([len, msg]));
      });
    },
    close: () => { sock?.destroy(); sock = null; },
  };
}

export function udpClient(server: string, port = 53): DnsClient {
  return {
    query(msg, timeoutMs = 4000) {
      return new Promise((resolve, reject) => {
        const s = dgram.createSocket(server.includes(':') ? 'udp6' : 'udp4');
        const t = setTimeout(() => { s.close(); reject(new Error('DNS server took too long')); }, timeoutMs);
        s.on('message', (m) => { if (m.length >= 2 && m.readUInt16BE(0) === msg.readUInt16BE(0)) { clearTimeout(t); s.close(); resolve(m); } });
        s.on('error', (e) => { clearTimeout(t); s.close(); reject(e); });
        s.send(msg, port, server);
      });
    },
    close: () => undefined,
  };
}

/** The system's own DNS servers (before Keeper took over), for "the network's own DNS". */
export function systemServers(exclude: string[] = []): string[] {
  return dns.getServers().map((s) => s.replace(/^\[|\](:\d+)?$/g, '').replace(/:53$/, '')).filter((s) => !exclude.includes(s));
}

export function clientFor(u: Upstream, test?: { ca?: string | Buffer; rejectUnauthorized?: boolean }): DnsClient {
  if (u.kind === 'doh') return dohClient(u.address, { bootstrap: u.bootstrap, ...test });
  if (u.kind === 'dot') return dotClient(u.address, { servername: u.tlsName, ...test });
  if (u.kind === 'doq') throw new Error('DNS over QUIC needs a QUIC stack that this version of Keeper does not have yet; choose DNS over HTTPS or TLS.');
  if (u.address === 'system') {
    const servers = systemServers(['127.0.0.1', '::1']);
    if (!servers.length) throw new Error('No system DNS server found');
    return udpClient(servers[0]);
  }
  const [h, p] = u.address.split(':');
  return udpClient(h, p ? Number(p) : 53);
}
