// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// DNS messages (RFC 1035) as far as a filtering resolver needs them: read a
// question, read the answers (A, AAAA, CNAME, HTTPS/SVCB names), build a
// query, and build "blocked" and "refused" replies. Used by the local resolver
// and by the DNS-over-HTTPS / DNS-over-TLS clients.

export const TYPES: Record<string, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, SVCB: 64, HTTPS: 65, ANY: 255 };
const TYPE_NAME = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k]));
export const typeName = (t: number) => TYPE_NAME[t] ?? `TYPE${t}`;

export interface Question { name: string; type: number; cls: number }
export interface Answer { name: string; type: number; ttl: number; data: string }
export interface Message {
  id: number;
  flags: number;
  rcode: number;
  questions: Question[];
  answers: Answer[];
}

function readName(buf: Buffer, off: number, depth = 0): { name: string; next: number } {
  if (depth > 20) throw new Error('DNS name loop');
  const labels: string[] = [];
  let next = -1;
  for (let i = off; ;) {
    if (i >= buf.length) throw new Error('DNS name runs past the message');
    const len = buf[i];
    if (len === 0) { if (next < 0) next = i + 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (i + 1 >= buf.length) throw new Error('Bad DNS pointer');
      const ptr = ((len & 0x3f) << 8) | buf[i + 1];
      if (next < 0) next = i + 2;
      const rest = readName(buf, ptr, depth + 1).name;
      if (rest) labels.push(rest);
      break;
    }
    if (len > 63 || i + 1 + len > buf.length) throw new Error('Bad DNS label');
    labels.push(buf.toString('latin1', i + 1, i + 1 + len));
    i += 1 + len;
  }
  return { name: labels.join('.'), next };
}

function writeName(name: string): Buffer {
  const parts = name.replace(/\.$/, '').split('.').filter(Boolean);
  const bufs: Buffer[] = [];
  for (const p of parts) {
    const b = Buffer.from(p, 'latin1');
    if (b.length > 63) throw new Error('DNS label too long');
    bufs.push(Buffer.from([b.length]), b);
  }
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

export function parseMessage(buf: Buffer): Message {
  if (buf.length < 12) throw new Error('DNS message too short');
  const id = buf.readUInt16BE(0);
  const flags = buf.readUInt16BE(2);
  const qd = buf.readUInt16BE(4);
  const an = buf.readUInt16BE(6);
  let off = 12;
  const questions: Question[] = [];
  for (let i = 0; i < qd; i++) {
    const n = readName(buf, off);
    if (n.next + 4 > buf.length) throw new Error('DNS question runs past the message');
    questions.push({ name: n.name.toLowerCase(), type: buf.readUInt16BE(n.next), cls: buf.readUInt16BE(n.next + 2) });
    off = n.next + 4;
  }
  const answers: Answer[] = [];
  for (let i = 0; i < an && off < buf.length; i++) {
    const n = readName(buf, off);
    if (n.next + 10 > buf.length) break;
    const type = buf.readUInt16BE(n.next);
    const ttl = buf.readUInt32BE(n.next + 4);
    const len = buf.readUInt16BE(n.next + 8);
    const start = n.next + 10;
    if (start + len > buf.length) break;
    let data = '';
    if (type === 1 && len === 4) data = [...buf.subarray(start, start + 4)].join('.');
    else if (type === 28 && len === 16) data = Array.from({ length: 8 }, (_, k) => buf.readUInt16BE(start + k * 2).toString(16)).join(':').replace(/(^|:)0(:0)+(:|$)/, '::');
    else if (type === 5 || type === 12 || type === 2) data = readName(buf, start).name;
    else if (type === 64 || type === 65) data = readName(buf, start + 2).name || '.';
    answers.push({ name: n.name.toLowerCase(), type, ttl, data });
    off = start + len;
  }
  return { id, flags, rcode: flags & 0xf, questions, answers };
}

export function buildQuery(name: string, type: number, id = Math.floor(Math.random() * 65536)): Buffer {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);
  head.writeUInt16BE(0x0100, 2); // recursion desired
  head.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(1, 2);
  return Buffer.concat([head, writeName(name), tail]);
}

/** The question part of a query, re-encoded (no compression), for building replies. */
function questionBytes(q: Question): Buffer {
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(q.type, 0);
  tail.writeUInt16BE(q.cls, 2);
  return Buffer.concat([writeName(q.name), tail]);
}

/**
 * The reply for a blocked name: 0.0.0.0 / :: for A and AAAA (apps fail fast
 * instead of waiting), and an empty "no such name" answer otherwise.
 */
export function blockedReply(query: Buffer, ttl = 60): Buffer {
  const q = parseMessage(query);
  const question = q.questions[0];
  const head = Buffer.alloc(12);
  head.writeUInt16BE(q.id, 0);
  const rd = q.flags & 0x0100;
  const sink = question && (question.type === 1 || question.type === 28);
  head.writeUInt16BE(0x8000 | rd | 0x0080 | (sink ? 0 : 3), 2); // QR, RD copied, RA, NOERROR or NXDOMAIN
  head.writeUInt16BE(question ? 1 : 0, 4);
  head.writeUInt16BE(sink ? 1 : 0, 6);
  if (!question) return head;
  const parts = [head, questionBytes(question)];
  if (sink) {
    const rr = Buffer.alloc(12);
    rr.writeUInt16BE(0xc00c, 0); // pointer to the question name
    rr.writeUInt16BE(question.type, 2);
    rr.writeUInt16BE(1, 4);
    rr.writeUInt32BE(ttl, 6);
    rr.writeUInt16BE(question.type === 1 ? 4 : 16, 10);
    parts.push(rr, Buffer.alloc(question.type === 1 ? 4 : 16));
  }
  return Buffer.concat(parts);
}

/** SERVFAIL (upstream unreachable) or REFUSED, echoing the question. */
export function errorReply(query: Buffer, rcode: 2 | 5): Buffer {
  const q = parseMessage(query);
  const head = Buffer.alloc(12);
  head.writeUInt16BE(q.id, 0);
  head.writeUInt16BE(0x8000 | (q.flags & 0x0100) | 0x0080 | rcode, 2);
  head.writeUInt16BE(q.questions.length ? 1 : 0, 4);
  return Buffer.concat([head, ...(q.questions[0] ? [questionBytes(q.questions[0])] : [])]);
}

/** Copies a reply for a different query id (cached answers). */
export function withId(reply: Buffer, id: number): Buffer {
  const b = Buffer.from(reply);
  b.writeUInt16BE(id, 0);
  return b;
}

/** The smallest TTL in a reply, for caching (bounded). */
export function minTtl(m: Message, floor = 10, ceil = 3600): number {
  if (!m.answers.length) return floor * 3;
  return Math.max(floor, Math.min(ceil, ...m.answers.map((a) => a.ttl)));
}

/** Every name in a reply: the question, CNAME targets and HTTPS/SVCB targets (a chain can hide a tracker behind an innocent name). */
export function namesIn(m: Message): string[] {
  const out = new Set<string>();
  for (const q of m.questions) out.add(q.name);
  for (const a of m.answers) if ((a.type === 5 || a.type === 64 || a.type === 65) && a.data && a.data !== '.') out.add(a.data.toLowerCase());
  return [...out];
}

/** Addresses in a reply, for "this address belongs to that name" (connection names). */
export function addressesIn(m: Message): string[] {
  return m.answers.filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
}

/** One question in the filter's log. */
export interface QueryLogEntry {
  t: number;
  name: string;
  type: string;
  /** blocked by which list or rule; undefined when answered */
  blockedBy?: string;
  /** addresses in the answer */
  answer?: string[];
  ms: number;
  cached?: boolean;
  error?: string;
  /** who asked, when it can be told (loopback source port → process) */
  client?: string;
}

// ---------------------------------------------------------------- upstreams

export interface Upstream {
  id: string;
  name: string;
  kind: 'doh' | 'dot' | 'udp' | 'doq';
  /** https URL for DoH; host:port for DoT/UDP/DoQ */
  address: string;
  /** TLS name to check for DoT (and the IPs to reach it without asking the system resolver) */
  tlsName?: string;
  bootstrap?: string[];
  /** filters malware on the resolver side too */
  note?: string;
}

export const UPSTREAMS: Upstream[] = [
  { id: 'quad9-doh', name: 'Quad9 (encrypted, blocks malware)', kind: 'doh', address: 'https://dns.quad9.net/dns-query', bootstrap: ['9.9.9.9', '149.112.112.112'], note: 'Non-profit, based in Switzerland; no logging of addresses' },
  { id: 'quad9-dot', name: 'Quad9 over TLS', kind: 'dot', address: '9.9.9.9:853', tlsName: 'dns.quad9.net' },
  { id: 'cloudflare-doh', name: 'Cloudflare (encrypted)', kind: 'doh', address: 'https://cloudflare-dns.com/dns-query', bootstrap: ['1.1.1.1', '1.0.0.1'] },
  { id: 'cloudflare-dot', name: 'Cloudflare over TLS', kind: 'dot', address: '1.1.1.1:853', tlsName: 'cloudflare-dns.com' },
  { id: 'mullvad-doh', name: 'Mullvad (encrypted)', kind: 'doh', address: 'https://dns.mullvad.net/dns-query', bootstrap: ['194.242.2.2'] },
  { id: 'system', name: 'The network’s own DNS (not encrypted)', kind: 'udp', address: 'system' },
];
