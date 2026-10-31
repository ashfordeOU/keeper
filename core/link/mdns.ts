// SPDX-License-Identifier: AGPL-3.0-or-later
// Just enough multicast DNS (RFC 6762/6763) for Keeper devices to find each
// other on the local network as _keeper._tcp, and to read what other services
// announce. Packets only; the sockets live in the Electron service.

export const MDNS_ADDR = '224.0.0.251';
export const MDNS_PORT = 5353;
export const SERVICE = '_keeper._tcp.local';

export const TYPE = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33, ANY: 255 } as const;

export interface Rec {
  name: string;
  type: number;
  ttl: number;
  /** PTR: target name; SRV: {port,target}; TXT: key/values; A/AAAA: address */
  data: string | { port: number; target: string; priority?: number; weight?: number } | Record<string, string>;
  /** cache-flush bit */
  flush?: boolean;
}

export interface Packet {
  id: number;
  response: boolean;
  questions: { name: string; type: number; unicast?: boolean }[];
  answers: Rec[];
}

// ---------------------------------------------------------------- encoding

function nameBytes(name: string): number[] {
  const out: number[] = [];
  for (const label of name.replace(/\.$/, '').split('.')) {
    const b = [...new TextEncoder().encode(label)];
    if (b.length > 63) throw new Error('label too long');
    out.push(b.length, ...b);
  }
  out.push(0);
  return out;
}

function u16(n: number) {
  return [(n >> 8) & 255, n & 255];
}
function u32(n: number) {
  return [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rdata(r: Rec): number[] {
  switch (r.type) {
    case TYPE.PTR:
      return nameBytes(r.data as string);
    case TYPE.SRV: {
      const d = r.data as { port: number; target: string; priority?: number; weight?: number };
      return [...u16(d.priority ?? 0), ...u16(d.weight ?? 0), ...u16(d.port), ...nameBytes(d.target)];
    }
    case TYPE.TXT: {
      const out: number[] = [];
      for (const [k, v] of Object.entries(r.data as Record<string, string>)) {
        const b = [...new TextEncoder().encode(`${k}=${v}`)].slice(0, 255);
        out.push(b.length, ...b);
      }
      return out.length ? out : [0];
    }
    case TYPE.A:
      return (r.data as string).split('.').map((x) => Number(x) & 255);
    case TYPE.AAAA: {
      const parts = expand6(r.data as string);
      return parts.flatMap((p) => u16(p));
    }
  }
  return [];
}

function expand6(a: string): number[] {
  const [head, tail] = a.split('%')[0].split('::');
  const h = head ? head.split(':').map((x) => parseInt(x, 16)) : [];
  const t = tail !== undefined ? (tail ? tail.split(':').map((x) => parseInt(x, 16)) : []) : [];
  return tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill(0), ...t] : h;
}

export function encode(p: Packet): Uint8Array {
  const out: number[] = [...u16(p.id), ...u16(p.response ? 0x8400 : 0), ...u16(p.questions.length), ...u16(p.answers.length), 0, 0, 0, 0];
  for (const q of p.questions) out.push(...nameBytes(q.name), ...u16(q.type), ...u16(1 | (q.unicast ? 0x8000 : 0)));
  for (const r of p.answers) {
    const d = rdata(r);
    out.push(...nameBytes(r.name), ...u16(r.type), ...u16(1 | (r.flush ? 0x8000 : 0)), ...u32(r.ttl), ...u16(d.length), ...d);
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- decoding (with name compression)

function readName(b: Uint8Array, off: number): [string, number] {
  const labels: string[] = [];
  let end = -1;
  let jumps = 0;
  for (;;) {
    if (off >= b.length) throw new Error('truncated');
    const len = b[off];
    if (len === 0) {
      off++;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (++jumps > 20) throw new Error('loop');
      if (end < 0) end = off + 2;
      off = ((len & 0x3f) << 8) | b[off + 1];
      continue;
    }
    labels.push(new TextDecoder().decode(b.subarray(off + 1, off + 1 + len)));
    off += 1 + len;
  }
  return [labels.join('.'), end >= 0 ? end : off];
}

export function decode(buf: Uint8Array): Packet {
  const b = buf;
  const dv = new DataView(b.buffer, b.byteOffset, b.length);
  if (b.length < 12) throw new Error('too short');
  const flags = dv.getUint16(2);
  const qd = dv.getUint16(4);
  const counts = dv.getUint16(6) + dv.getUint16(8) + dv.getUint16(10);
  let off = 12;
  const questions: Packet['questions'] = [];
  for (let i = 0; i < qd; i++) {
    const [name, o] = readName(b, off);
    questions.push({ name, type: dv.getUint16(o), unicast: !!(dv.getUint16(o + 2) & 0x8000) });
    off = o + 4;
  }
  const answers: Rec[] = [];
  for (let i = 0; i < counts && off < b.length; i++) {
    const [name, o] = readName(b, off);
    const type = dv.getUint16(o);
    const cls = dv.getUint16(o + 2);
    const ttl = dv.getUint32(o + 4);
    const len = dv.getUint16(o + 8);
    const start = o + 10;
    if (start + len > b.length) break;
    let data: Rec['data'] = '';
    if (type === TYPE.PTR) data = readName(b, start)[0];
    else if (type === TYPE.SRV) data = { priority: dv.getUint16(start), weight: dv.getUint16(start + 2), port: dv.getUint16(start + 4), target: readName(b, start + 6)[0] };
    else if (type === TYPE.TXT) {
      const kv: Record<string, string> = {};
      for (let p = start; p < start + len; ) {
        const l = b[p];
        const s = new TextDecoder().decode(b.subarray(p + 1, p + 1 + l));
        const eq = s.indexOf('=');
        if (s) kv[eq < 0 ? s : s.slice(0, eq)] = eq < 0 ? '' : s.slice(eq + 1);
        p += 1 + l;
      }
      data = kv;
    } else if (type === TYPE.A && len === 4) data = [...b.subarray(start, start + 4)].join('.');
    else if (type === TYPE.AAAA && len === 16) {
      const parts: string[] = [];
      for (let i2 = 0; i2 < 8; i2++) parts.push(dv.getUint16(start + i2 * 2).toString(16));
      data = parts.join(':').replace(/(^|:)0(:0)+(:|$)/, '::');
    }
    answers.push({ name, type, ttl, data, flush: !!(cls & 0x8000) });
    off = start + len;
  }
  return { id: dv.getUint16(0), response: !!(flags & 0x8000), questions, answers };
}

// ---------------------------------------------------------------- Keeper's own announcement

export interface Announce {
  /** instance label, e.g. the device id */
  id: string;
  name: string;
  port: number;
  host: string;
  addresses: string[];
  /** 1 while this device is waiting to be paired with a code */
  pairing?: boolean;
  os?: string;
}

export function announcement(a: Announce, ttl = 120): Packet {
  const inst = `${a.id}.${SERVICE}`;
  const host = `${a.host.replace(/\.local$/, '')}.local`;
  return {
    id: 0,
    response: true,
    questions: [],
    answers: [
      { name: SERVICE, type: TYPE.PTR, ttl, data: inst },
      { name: inst, type: TYPE.SRV, ttl, data: { port: a.port, target: host }, flush: true },
      { name: inst, type: TYPE.TXT, ttl, data: { v: '1', id: a.id, n: a.name.slice(0, 60), p: a.pairing ? '1' : '0', os: a.os ?? '' }, flush: true },
      ...a.addresses.map((ip) => ({ name: host, type: ip.includes(':') ? TYPE.AAAA : TYPE.A, ttl, data: ip, flush: true })),
    ],
  };
}

export function query(): Packet {
  return { id: 0, response: false, questions: [{ name: SERVICE, type: TYPE.PTR }], answers: [] };
}

export interface Found {
  id: string;
  name: string;
  port: number;
  addresses: string[];
  pairing: boolean;
  os: string;
  ttl: number;
}

/** Keeper devices described in a response packet (a goodbye has ttl 0). */
export function keeperDevices(p: Packet): Found[] {
  if (!p.response) return [];
  const out: Found[] = [];
  const addrs = new Map<string, string[]>();
  for (const r of p.answers) if ((r.type === TYPE.A || r.type === TYPE.AAAA) && typeof r.data === 'string') addrs.set(r.name.toLowerCase(), [...(addrs.get(r.name.toLowerCase()) ?? []), r.data]);
  for (const r of p.answers) {
    if (r.type !== TYPE.SRV || !r.name.toLowerCase().endsWith('.' + SERVICE)) continue;
    const srv = r.data as { port: number; target: string };
    const txt = (p.answers.find((x) => x.type === TYPE.TXT && x.name === r.name)?.data ?? {}) as Record<string, string>;
    if (txt.v !== '1') continue;
    out.push({
      id: txt.id || r.name.split('.')[0],
      name: txt.n || r.name.split('.')[0],
      port: srv.port,
      addresses: addrs.get(srv.target.toLowerCase()) ?? [],
      pairing: txt.p === '1',
      os: txt.os ?? '',
      ttl: r.ttl,
    });
  }
  return out;
}

/** Labels for other services seen on the network, for the Devices page. */
export function classifyService(type: string): string | undefined {
  const t = type.toLowerCase();
  if (t.startsWith('_smb.')) return 'File sharing (SMB)';
  if (t.startsWith('_afpovertcp.')) return 'File sharing (AFP)';
  if (t.startsWith('_sftp-ssh.') || t.startsWith('_ssh.')) return 'SSH';
  if (t.startsWith('_rfb.')) return 'Screen sharing (VNC)';
  if (t.startsWith('_airplay.') || t.startsWith('_raop.')) return 'AirPlay';
  if (t.startsWith('_googlecast.')) return 'Cast';
  if (t.startsWith('_ipp.') || t.startsWith('_printer.')) return 'Printer';
  if (t.startsWith('_keeper.')) return 'Keeper';
  return undefined;
}
