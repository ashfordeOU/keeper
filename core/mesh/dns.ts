// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The mesh's names: a tiny DNS server that answers "<device>.keeper" (or the
// ending you chose) with the device's mesh addresses. It listens on this
// device's own mesh address; the system sends only names under the mesh
// ending to it (split DNS, see os-plan.ts). Anything else is refused, unless
// this device is the exit node for a peer, in which case it passes the
// question on to this computer's own DNS server (so DNS goes through the exit
// node too).

import dgram from 'node:dgram';
import { familyOf } from '../net/addr';
import { parseMessage } from '../fw/dns';

export interface NameTable {
  /** "laptop" → its addresses (lowercase labels, without the ending) */
  get(label: string): { a4?: string; a6?: string } | undefined;
}

const TTL = 60;

function v6Bytes(ip: string): Buffer {
  const halves = ip.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const groups = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  const b = Buffer.alloc(16);
  groups.forEach((g, i) => b.writeUInt16BE(parseInt(g, 16), i * 2));
  return b;
}

/** Builds a reply for one question. rcode 0 = answer (possibly empty), 3 = no such name, 5 = refused. */
export function buildReply(query: Buffer, rcode: number, answers: { type: 1 | 28; ip: string }[] = []): Buffer {
  const id = query.readUInt16BE(0);
  const qflags = query.readUInt16BE(2);
  // the question section as it came (one question)
  let off = 12;
  while (off < query.length && query[off] !== 0) off += query[off] + 1;
  const qEnd = Math.min(query.length, off + 5);
  const question = query.subarray(12, qEnd);
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);
  // QR, opcode copied, AA, RD copied, RA
  head.writeUInt16BE(0x8000 | (qflags & 0x7800) | 0x0400 | (qflags & 0x0100) | 0x0080 | (rcode & 0xf), 2);
  head.writeUInt16BE(1, 4);
  head.writeUInt16BE(answers.length, 6);
  const rrs = answers.map((a) => {
    const rd = a.type === 1 ? Buffer.from(a.ip.split('.').map(Number)) : v6Bytes(a.ip);
    const rr = Buffer.alloc(12);
    rr.writeUInt16BE(0xc00c, 0); // pointer to the question's name
    rr.writeUInt16BE(a.type, 2);
    rr.writeUInt16BE(1, 4);
    rr.writeUInt32BE(TTL, 6);
    rr.writeUInt16BE(rd.length, 10);
    return Buffer.concat([rr, rd]);
  });
  return Buffer.concat([head, question, ...rrs]);
}

/**
 * The answer for one query: mesh names from the table, "no such name" for
 * other names under the ending, null for everything else (refuse or pass on).
 */
export function answer(query: Buffer, suffix: string, names: NameTable): Buffer | null {
  let m;
  try {
    m = parseMessage(query);
  } catch {
    return null;
  }
  const q = m.questions[0];
  if (!q || m.questions.length !== 1 || q.cls !== 1) return null;
  const name = q.name.toLowerCase().replace(/\.$/, '');
  const end = `.${suffix}`;
  if (name !== suffix && !name.endsWith(end)) return null;
  const label = name === suffix ? '' : name.slice(0, -end.length);
  const hit = label ? names.get(label) : undefined;
  if (!hit) return buildReply(query, 3);
  const out: { type: 1 | 28; ip: string }[] = [];
  if ((q.type === 1 || q.type === 255) && hit.a4) out.push({ type: 1, ip: hit.a4 });
  if ((q.type === 28 || q.type === 255) && hit.a6) out.push({ type: 28, ip: hit.a6 });
  return buildReply(query, 0, out);
}

export interface ResponderOpts {
  suffix: () => string;
  names: NameTable;
  /** pass other questions on to these servers (exit node only) */
  forward?: () => string[];
  /** who may use forwarding: mesh addresses only */
  mayForward?: (from: string) => boolean;
}

/** A UDP DNS server on one address. Port 53 when allowed, else the fallback port. */
export class MeshDnsServer {
  private sock: dgram.Socket | null = null;
  port = 0;
  address = '';
  answered = 0;

  constructor(private o: ResponderOpts) {}

  async listen(address: string, ports: number[] = [53, 5053]): Promise<number> {
    let lastErr: unknown;
    for (const port of ports) {
      const s = dgram.createSocket({ type: familyOf(address) === 6 ? 'udp6' : 'udp4', reuseAddr: false });
      try {
        await new Promise<void>((resolve, reject) => {
          s.once('error', reject);
          s.bind(port, address, () => {
            s.off('error', reject);
            resolve();
          });
        });
        s.on('message', (m, r) => void this.handle(s, m, r));
        s.on('error', () => undefined);
        this.sock = s;
        this.port = s.address().port;
        this.address = address;
        return this.port;
      } catch (e) {
        lastErr = e;
        s.close();
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Could not listen for mesh names');
  }

  private async handle(s: dgram.Socket, m: Buffer, r: dgram.RemoteInfo) {
    if (m.length < 12 || m.length > 4096) return;
    const reply = answer(m, this.o.suffix(), this.o.names);
    if (reply) {
      this.answered++;
      s.send(reply, r.port, r.address);
      return;
    }
    const servers = this.o.forward?.() ?? [];
    if (servers.length && this.o.mayForward?.(r.address)) {
      const back = await forwardQuery(m, servers).catch(() => null);
      if (back) s.send(back, r.port, r.address);
      return;
    }
    s.send(buildReply(m, 5), r.port, r.address);
  }

  close() {
    this.sock?.close();
    this.sock = null;
  }
}

/** Asks an upstream DNS server over UDP; the first answer wins. */
export function forwardQuery(q: Buffer, servers: string[], timeoutMs = 3000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socks: dgram.Socket[] = [];
    const done = (e: Error | null, b?: Buffer) => {
      clearTimeout(t);
      for (const s of socks) s.close();
      socks.length = 0;
      if (b) resolve(b);
      else reject(e);
    };
    const t = setTimeout(() => done(new Error('no answer')), timeoutMs);
    for (const srv of servers.slice(0, 3)) {
      // "1.2.3.4", "1.2.3.4:5353" or "[fd00::1]:5353"
      const m = srv.match(/^\[([^\]]+)\]:(\d+)$/) ?? srv.match(/^([\d.]+):(\d+)$/);
      const host = m ? m[1] : srv;
      const port = m ? Number(m[2]) : 53;
      const s = dgram.createSocket(familyOf(host) === 6 ? 'udp6' : 'udp4');
      socks.push(s);
      s.on('message', (b) => b.length >= 12 && b.readUInt16BE(0) === q.readUInt16BE(0) && done(null, b));
      s.on('error', () => undefined);
      s.send(q, port, host);
    }
  });
}
