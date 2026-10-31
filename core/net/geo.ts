// SPDX-License-Identifier: AGPL-3.0-or-later
// Which country and which network (ASN) an internet address belongs to, from a
// table kept on this computer. Nothing is looked up online. The table is built
// once from the free DB-IP Lite files (CC BY 4.0) when the person turns
// countries on, and stored compactly: sorted ranges searched by halving.

import { v4ToInt, v6ToBig } from './addr';

/** Marks a gap between ranges: addresses there belong to nobody in the table. */
const GAP = 0xffffffff;

/**
 * Address ranges with a value each, searchable in O(log n). Only range starts
 * are stored: each range runs until the next one starts, and gaps between
 * ranges are entries of their own. That keeps the whole table in about half
 * the memory of storing both ends.
 */
export class RangeTable {
  constructor(
    readonly strings: string[],
    private v4s: Uint32Array, private v4v: Uint32Array,
    private v6s: Buffer, private v6v: Uint32Array,
  ) {}

  /** ranges with a value (gaps not counted) */
  get size(): number {
    let n = 0;
    for (const v of this.v4v) if (v !== GAP) n++;
    for (const v of this.v6v) if (v !== GAP) n++;
    return n;
  }

  lookup(ip: string): string | undefined {
    const n = v4ToInt(ip);
    if (n !== null) {
      let lo = 0, hi = this.v4s.length - 1, at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (this.v4s[mid] <= n) { at = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return at >= 0 && this.v4v[at] !== GAP ? this.strings[this.v4v[at]] : undefined;
    }
    const b = v6ToBig(ip);
    if (b === null) return undefined;
    const key = bigToBuf(b);
    let lo = 0, hi = this.v6v.length - 1, at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (Buffer.compare(this.v6s.subarray(mid * 16, mid * 16 + 16), key) <= 0) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return at >= 0 && this.v6v[at] !== GAP ? this.strings[this.v6v[at]] : undefined;
  }

  /** Compact binary form: a JSON header, then the arrays. */
  serialize(meta: Record<string, unknown> = {}): Buffer {
    const head = Buffer.from(JSON.stringify({ ...meta, strings: this.strings, v4: this.v4s.length, v6: this.v6v.length }));
    const len = Buffer.alloc(4);
    len.writeUInt32LE(head.length);
    const u = (a: Uint32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
    return Buffer.concat([Buffer.from('KPGEO2'), len, head, u(this.v4s), u(this.v4v), this.v6s, u(this.v6v)]);
  }

  static deserialize(buf: Buffer): { table: RangeTable; meta: Record<string, unknown> } {
    if (buf.subarray(0, 6).toString() !== 'KPGEO2') throw new Error('Not a Keeper address table');
    const hl = buf.readUInt32LE(6);
    const meta = JSON.parse(buf.subarray(10, 10 + hl).toString()) as { strings: string[]; v4: number; v6: number } & Record<string, unknown>;
    let off = 10 + hl;
    const take32 = (n: number) => {
      // Copy so the typed array is aligned whatever the header length was.
      const a = new Uint32Array(n);
      Buffer.from(a.buffer).set(buf.subarray(off, off + n * 4));
      off += n * 4;
      return a;
    };
    const v4s = take32(meta.v4), v4v = take32(meta.v4);
    const v6s = Buffer.from(buf.subarray(off, off + meta.v6 * 16)); off += meta.v6 * 16;
    const v6v = take32(meta.v6);
    return { table: new RangeTable(meta.strings, v4s, v4v, v6s, v6v), meta };
  }
}

function bigToBuf(b: bigint): Buffer {
  const out = Buffer.alloc(16);
  for (let i = 15; i >= 0; i--) { out[i] = Number(b & 0xffn); b >>= 8n; }
  return out;
}

/** Parses one CSV line with optional quotes: 1.0.0.0,1.0.0.255,13335,"Cloudflare, Inc." */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Builds a table from DB-IP Lite CSV lines: start,end,value[,more]. `value`
 * picks the label (country code, or "AS13335 Cloudflare, Inc."). Lines can
 * arrive in any order; ranges are sorted at the end.
 */
export class RangeTableBuilder {
  private strings: string[] = [];
  private index = new Map<string, number>();
  private v4: [number, number, number][] = [];
  private v6: [bigint, bigint, number][] = [];

  constructor(private value: (f: string[]) => string | undefined) {}

  add(line: string) {
    if (!line) return;
    const f = csvFields(line);
    if (f.length < 3) return;
    const label = this.value(f);
    if (!label || label === 'ZZ') return;
    let id = this.index.get(label);
    if (id === undefined) { id = this.strings.length; this.strings.push(label); this.index.set(label, id); }
    const a4 = v4ToInt(f[0]);
    if (a4 !== null) {
      const b4 = v4ToInt(f[1]);
      if (b4 !== null) this.v4.push([a4, b4, id]);
      return;
    }
    const a6 = v6ToBig(f[0]);
    const b6 = v6ToBig(f[1]);
    if (a6 !== null && b6 !== null) this.v6.push([a6, b6, id]);
  }

  build(): RangeTable {
    this.v4.sort((a, b) => a[0] - b[0]);
    this.v6.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    // Starts only: neighbours with the same value merge, and a gap entry follows any range that isn't followed directly.
    const starts = <T extends number | bigint>(list: [T, T, number][], one: T, max: T): [T, number][] => {
      const out: [T, number][] = [];
      let lastEnd: T | null = null;
      let lastVal = -1;
      for (const [s, e, v] of list) {
        const contiguous = lastEnd !== null && ((lastEnd as number) + (one as number)) === (s as number);
        if (lastEnd !== null && !contiguous && (s as number) > (lastEnd as number)) out.push([((lastEnd as number) + (one as number)) as T, GAP]);
        if (!(contiguous && v === lastVal)) out.push([s, v]);
        lastEnd = lastEnd !== null && (lastEnd as number) > (e as number) ? lastEnd : e;
        lastVal = v;
      }
      if (lastEnd !== null && lastEnd !== max) out.push([((lastEnd as number) + (one as number)) as T, GAP]);
      return out;
    };
    const s4 = starts(this.v4, 1, 0xffffffff);
    const s6 = starts(this.v6, 1n, (1n << 128n) - 1n);
    const v4s = new Uint32Array(s4.length), v4v = new Uint32Array(s4.length);
    s4.forEach(([s, v], i) => { v4s[i] = s; v4v[i] = v; });
    const v6s = Buffer.alloc(s6.length * 16), v6v = new Uint32Array(s6.length);
    s6.forEach(([s, v], i) => { bigToBuf(s).copy(v6s, i * 16); v6v[i] = v; });
    return new RangeTable(this.strings, v4s, v4v, v6s, v6v);
  }
}

export const countryValue = (f: string[]) => f[2]?.trim().toUpperCase() || undefined;
export const asnValue = (f: string[]) => (f[2] ? `AS${f[2]}${f[3] ? ' ' + f[3] : ''}` : undefined);

/** "DE" → 🇩🇪 */
export function flag(cc?: string): string {
  if (!cc || !/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** The monthly DB-IP Lite file names to try, newest first (this month, then the last two). */
export function dbipUrls(kind: 'country' | 'asn', now = new Date()): string[] {
  const out: string[] = [];
  for (let back = 0; back < 3; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push(`https://download.db-ip.com/free/dbip-${kind}-lite-${ym}.csv.gz`);
  }
  return out;
}
