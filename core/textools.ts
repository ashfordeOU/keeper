// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Pure helpers behind the Toolbox and clipboard: link cleaning, case
// conversion, text stats, JWT decoding, passwords, Wi-Fi QR payloads, colours.

const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|si|ref_src|ref_url|_hsenc|_hsmi|mkt_tok|yclid|vero_id|oly_anon_id|oly_enc_id|rb_clickid|s_cid|twclid|ttclid)$/i;

/** Removes tracking parameters and unwraps common redirect links. */
export function cleanLink(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return input;
  }
  if (!/^https?:$/.test(url.protocol)) return input;
  // Redirect wrappers: google.com/url?q=, l.facebook.com/l.php?u=, out.reddit.com, t.co cannot be unwrapped offline.
  const wrapped =
    (/(^|\.)google\.[a-z.]+$/.test(url.hostname) && url.pathname === '/url' && (url.searchParams.get('q') || url.searchParams.get('url'))) ||
    (/^l\.(facebook|instagram|messenger)\.com$/.test(url.hostname) && url.searchParams.get('u')) ||
    (url.hostname === 'out.reddit.com' && url.searchParams.get('url')) ||
    (/(^|\.)safelinks\.protection\.outlook\.com$/.test(url.hostname) && url.searchParams.get('url'));
  if (wrapped) return cleanLink(wrapped);
  for (const k of [...url.searchParams.keys()]) if (TRACKING.test(k)) url.searchParams.delete(k);
  const out = url.toString();
  return out.endsWith('?') ? out.slice(0, -1) : out;
}

export function isUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s.trim());
}

/** "#ff8800", "rgb(1, 2, 3)", "hsl(...)" -> CSS colour, else undefined. */
export function asColor(s: string): string | undefined {
  const t = s.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return t;
  if (/^(rgb|rgba|hsl|hsla|oklch|lab)\([^)]{3,60}\)$/i.test(t)) return t;
  return undefined;
}

export type CaseStyle = 'lower' | 'upper' | 'title' | 'sentence' | 'camel' | 'pascal' | 'snake' | 'kebab' | 'constant';

export function convertCase(s: string, to: CaseStyle): string {
  const words = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  switch (to) {
    case 'lower': return s.toLowerCase();
    case 'upper': return s.toUpperCase();
    case 'title': return s.toLowerCase().replace(/(^|[\s\-(])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
    case 'sentence': return s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
    case 'camel': return words.map((w, i) => (i ? cap(w) : w.toLowerCase())).join('');
    case 'pascal': return words.map(cap).join('');
    case 'snake': return words.map((w) => w.toLowerCase()).join('_');
    case 'kebab': return words.map((w) => w.toLowerCase()).join('-');
    case 'constant': return words.map((w) => w.toUpperCase()).join('_');
  }
}

export function textStats(s: string): { chars: number; words: number; lines: number; sentences: number; readingMin: number; top: [string, number][] } {
  const words = s.match(/[\p{L}\p{N}'’-]+/gu) ?? [];
  const freq = new Map<string, number>();
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on', 'that', 'with', 'as', 'at', 'be', 'this', 'by', 'are', 'was', 'i', 'you']);
  for (const w of words) {
    const k = w.toLowerCase();
    if (k.length > 2 && !stop.has(k)) freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  return {
    chars: [...s].length,
    words: words.length,
    lines: s ? s.split(/\r?\n/).length : 0,
    sentences: (s.match(/[.!?]+(\s|$)/g) ?? []).length,
    readingMin: Math.max(words.length ? 1 : 0, Math.round(words.length / 230)),
    top: [...freq].sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
}

function b64urlDecode(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function decodeJwt(token: string): { header: unknown; payload: unknown; expires?: number; expired?: boolean } {
  const parts = token.trim().split('.');
  if (parts.length < 2) throw new Error('A JWT has three parts separated by dots');
  const header = JSON.parse(b64urlDecode(parts[0]));
  const payload = JSON.parse(b64urlDecode(parts[1])) as { exp?: number };
  const expires = typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
  return { header, payload, expires, expired: expires ? expires < Date.now() : undefined };
}

export function base64Encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function base64Decode(s: string): string {
  return b64urlDecode(s.trim().replace(/\s+/g, ''));
}

/** Formats JSON, or explains where it is broken (line and column). */
export function formatJson(s: string, indent = 2): { ok: true; text: string } | { ok: false; error: string } {
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(s), null, indent) };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).replace(/,? ?".*$/s, '').replace(/ in JSON at position \d+.*$/s, '');
    const pos = jsonErrorAt(s);
    const before = s.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    return { ok: false, error: `${msg || 'Not valid JSON'} at line ${line}, column ${col}` };
  }
}

/** Where a JSON text first goes wrong (engines no longer say). A small strict scanner. */
export function jsonErrorAt(s: string): number {
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const fail = (): never => { throw i; };
  const lit = (w: string) => { if (s.startsWith(w, i)) i += w.length; else fail(); };
  const str = () => {
    i++;
    while (i < s.length && s[i] !== '"') {
      if (s[i] === '\\') i++;
      else if (s.charCodeAt(i) < 0x20) fail();
      i++;
    }
    if (s[i] !== '"') fail();
    i++;
  };
  const num = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(s.slice(i));
    if (!m) fail();
    i += m![0].length;
  };
  const value = (): void => {
    ws();
    const c = s[i];
    if (c === '{') {
      i++; ws();
      if (s[i] === '}') { i++; return; }
      for (;;) {
        ws(); if (s[i] !== '"') fail(); str(); ws();
        if (s[i] !== ':') fail(); i++; value(); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return; }
        fail();
      }
    }
    if (c === '[') {
      i++; ws();
      if (s[i] === ']') { i++; return; }
      for (;;) {
        value(); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return; }
        fail();
      }
    }
    if (c === '"') return str();
    if (c === 't') return lit('true');
    if (c === 'f') return lit('false');
    if (c === 'n') return lit('null');
    return num();
  };
  try {
    value();
    ws();
    return i < s.length ? i : s.length;
  } catch (at) {
    return typeof at === 'number' ? at : 0;
  }
}

export function generatePassword(length = 20, opts: { symbols?: boolean; words?: boolean } = {}, random: (n: number) => number = cryptoRandom): string {
  if (opts.words) {
    const list = ['otter', 'maple', 'harbor', 'violet', 'ember', 'cobalt', 'meadow', 'pixel', 'quartz', 'lantern', 'willow', 'saffron', 'glacier', 'tango', 'nimbus', 'orbit', 'pepper', 'falcon', 'canyon', 'juniper', 'mosaic', 'velvet', 'zephyr', 'cedar', 'atlas', 'comet', 'delta', 'fjord', 'garnet', 'hazel'];
    const n = Math.max(3, Math.round(length / 5));
    return Array.from({ length: n }, () => list[random(list.length)]).join('-') + '-' + random(100);
  }
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', ...(opts.symbols === false ? [] : ['!@#$%^&*-_=+?'])];
  const all = sets.join('');
  const chars = sets.map((set) => set[random(set.length)]);
  while (chars.length < length) chars.push(all[random(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function cryptoRandom(n: number): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] % n;
}

/** The text a phone camera reads to join a Wi-Fi network. */
export function wifiQrPayload(ssid: string, password: string, security: 'WPA' | 'WEP' | 'nopass' = 'WPA', hidden = false): string {
  const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');
  return `WIFI:T:${security};S:${esc(ssid)};${security === 'nopass' ? '' : `P:${esc(password)};`}${hidden ? 'H:true;' : ''};`;
}

/** Unix seconds / ms / ISO text -> a date, with the other forms. */
export function convertTimestamp(input: string): { ms: number; iso: string; unix: number; local: string } | undefined {
  const t = input.trim();
  let ms: number;
  if (/^-?\d{1,11}$/.test(t)) ms = Number(t) * 1000;
  else if (/^-?\d{12,14}$/.test(t)) ms = Number(t);
  else ms = Date.parse(t);
  if (!Number.isFinite(ms)) return undefined;
  const d = new Date(ms);
  return { ms, iso: d.toISOString(), unix: Math.floor(ms / 1000), local: d.toLocaleString() };
}

/** Characters that look normal but are not: zero-width, bidi controls, look-alikes. */
export function inspectUnicode(s: string): { char: string; code: string; name: string; suspicious: boolean }[] {
  const names: Record<number, string> = {
    0x200b: 'ZERO WIDTH SPACE', 0x200c: 'ZERO WIDTH NON-JOINER', 0x200d: 'ZERO WIDTH JOINER', 0xfeff: 'BYTE ORDER MARK', 0x00a0: 'NO-BREAK SPACE',
    0x202e: 'RIGHT-TO-LEFT OVERRIDE', 0x202d: 'LEFT-TO-RIGHT OVERRIDE', 0x2066: 'LEFT-TO-RIGHT ISOLATE', 0x2067: 'RIGHT-TO-LEFT ISOLATE', 0x00ad: 'SOFT HYPHEN',
    0x0430: 'CYRILLIC SMALL A (looks like a)', 0x0435: 'CYRILLIC SMALL IE (looks like e)', 0x043e: 'CYRILLIC SMALL O (looks like o)', 0x0440: 'CYRILLIC SMALL ER (looks like p)',
    0x0441: 'CYRILLIC SMALL ES (looks like c)', 0x0445: 'CYRILLIC SMALL HA (looks like x)', 0x2013: 'EN DASH', 0x2014: 'EM DASH', 0x201c: 'LEFT DOUBLE QUOTE', 0x201d: 'RIGHT DOUBLE QUOTE',
  };
  return [...s].map((ch) => {
    const cp = ch.codePointAt(0)!;
    const suspicious = cp in names && cp !== 0x2013 && cp !== 0x2014 && cp !== 0x201c && cp !== 0x201d;
    return { char: ch, code: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), name: names[cp] ?? (cp < 128 ? 'ASCII' : ''), suspicious };
  });
}

/** Masks e-mails, phone numbers, card numbers, IBANs and keys before text is pasted into an AI tool. */
export function redactPersonal(s: string): { text: string; count: number } {
  let count = 0;
  const sub = (re: RegExp, label: string) => (t: string) => t.replace(re, () => { count++; return `[${label}]`; });
  const steps = [
    sub(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, 'email'),
    sub(/\b(?:\d[ -]?){13,19}\b/g, 'card'),
    sub(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/g, 'iban'),
    sub(/\b(sk|pk|rk|ghp|gho|github_pat|xox[abpr]|AKIA|AIza)[-_A-Za-z0-9]{16,}\b/g, 'key'),
    sub(/(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g, 'phone'),
    sub(/\b\d{3}-\d{2}-\d{4}\b/g, 'id'),
  ];
  const text = steps.reduce((t, f) => f(t), s);
  return { text, count };
}

// ---------------------------------------------------------------- more developer helpers

/** MD5 (for comparing with old download pages and checksums; not for security). */
export function md5(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const len = bytes.length;
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const bits = len * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padded.length; off += 64) {
    const M = Array.from({ length: 16 }, (_, i) => view.getUint32(off + i * 4, true));
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map((w) => [0, 8, 16, 24].map((s) => ((w >>> s) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
}

/** Checks an HS256/384/512 token's signature with a shared secret (Web Crypto, works in the app and the CLI). */
export async function verifyJwtHmac(token: string, secret: string): Promise<{ ok: boolean; alg: string; reason?: string }> {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return { ok: false, alg: '?', reason: 'A signed JWT has three parts' };
  const header = JSON.parse(b64urlDecode(parts[0])) as { alg?: string };
  const alg = header.alg ?? '?';
  const hash = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' }[alg];
  if (!hash) return { ok: false, alg, reason: `${alg} tokens are checked with a public key, not a shared secret` };
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts[0]}.${parts[1]}`)));
  let bin = '';
  sig.forEach((b) => (bin += String.fromCharCode(b)));
  const expected = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return expected === parts[2] ? { ok: true, alg } : { ok: false, alg, reason: 'The signature does not match this secret' };
}

/** Base64 with the URL-safe alphabet and/or wrapped lines (MIME wraps at 76). */
export function base64Options(b64: string, o: { urlSafe?: boolean; wrap?: number }): string {
  let s = o.urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
  if (o.wrap && o.wrap > 0) s = s.replace(new RegExp(`(.{${o.wrap}})`, 'g'), '$1\n').trimEnd();
  return s;
}

/** What a UUID is: its version, variant, and for v1/v6/v7 the time inside it. */
export function inspectUuid(s: string): { version: number; variant: string; time?: number } | undefined {
  const m = s.trim().toLowerCase().match(/^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/);
  if (!m) return undefined;
  const hex = m.slice(1).join('');
  const version = parseInt(hex[12], 16);
  const v = parseInt(hex[16], 16);
  const variant = v >= 0xe ? 'reserved' : v >= 0xc ? 'Microsoft' : v >= 0x8 ? 'RFC 9562' : 'NCS';
  let time: number | undefined;
  if (version === 7) time = parseInt(hex.slice(0, 12), 16);
  else if (version === 1 || version === 6) {
    const ts = version === 1 ? hex.slice(13, 16) + hex.slice(8, 12) + hex.slice(0, 8) : hex.slice(0, 12) + hex.slice(13, 16);
    time = Number((BigInt('0x' + ts) - 122192928000000000n) / 10000n);
  }
  return { version, variant, time };
}

/** Seconds, milliseconds or microseconds (guessed from the length), or a date, shown in any time zone. */
export function timestampIn(input: string, timeZone?: string): { ms: number; unit: 's' | 'ms' | 'µs' | 'date'; zoned: string; iso: string; seconds: number; millis: number; micros: string } | undefined {
  const t = input.trim();
  let ms: number;
  let unit: 's' | 'ms' | 'µs' | 'date';
  if (/^-?\d{1,11}(\.\d+)?$/.test(t)) { ms = Number(t) * 1000; unit = 's'; }
  else if (/^-?\d{12,14}$/.test(t)) { ms = Number(t); unit = 'ms'; }
  else if (/^-?\d{15,17}$/.test(t)) { ms = Number(t) / 1000; unit = 'µs'; }
  else { ms = Date.parse(t); unit = 'date'; }
  if (!Number.isFinite(ms)) return undefined;
  const d = new Date(ms);
  let zoned: string;
  try {
    zoned = d.toLocaleString(undefined, { timeZone, dateStyle: 'full', timeStyle: 'long' });
  } catch {
    zoned = d.toLocaleString();
  }
  return { ms, unit, zoned, iso: d.toISOString(), seconds: Math.floor(ms / 1000), millis: Math.floor(ms), micros: `${Math.floor(ms)}000` };
}

/** Placeholder text as plain paragraphs, HTML paragraphs or Markdown (with a heading and a list). */
export function loremAs(text: string, format: 'text' | 'html' | 'markdown'): string {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (format === 'html') return paras.map((p) => `<p>${p}</p>`).join('\n');
  if (format === 'markdown') {
    const words = (paras[0] ?? '').split(/\s+/).slice(0, 3).join(' ').replace(/[.,]$/, '');
    const items = (paras[1] ?? paras[0] ?? '').split(/(?<=\.)\s+/).slice(0, 3).map((s) => `- ${s}`);
    return [`## ${words}`, '', ...paras.slice(0, 1), '', ...items, '', ...paras.slice(2).flatMap((p) => [p, ''])].join('\n').trim();
  }
  return paras.join('\n\n');
}

export interface SideRow { left: string | null; right: string | null; type: 'same' | 'add' | 'del' | 'change' }

/** Pairs a line diff into two columns: removed and added lines that sit together become one "change" row. */
export function sideBySide(lines: { type: 'same' | 'add' | 'del'; text: string }[]): SideRow[] {
  const out: SideRow[] = [];
  for (let i = 0; i < lines.length; ) {
    const l = lines[i];
    if (l.type === 'same') { out.push({ left: l.text, right: l.text, type: 'same' }); i++; continue; }
    const dels: string[] = [];
    const adds: string[] = [];
    // A run of changes may list added lines before removed ones; pair them in order either way.
    while (i < lines.length && lines[i].type !== 'same') (lines[i].type === 'del' ? dels : adds).push(lines[i++].text);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      const left = dels[k] ?? null;
      const right = adds[k] ?? null;
      out.push({ left, right, type: left !== null && right !== null ? 'change' : left !== null ? 'del' : 'add' });
    }
  }
  return out;
}
