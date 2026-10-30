// SPDX-License-Identifier: AGPL-3.0-or-later
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
    const msg = e instanceof Error ? e.message : String(e);
    const pos = Number(msg.match(/position (\d+)/)?.[1]);
    if (Number.isFinite(pos)) {
      const before = s.slice(0, pos);
      const line = before.split('\n').length;
      const col = pos - before.lastIndexOf('\n');
      return { ok: false, error: `${msg.replace(/ in JSON at position \d+.*$/, '')} at line ${line}, column ${col}` };
    }
    return { ok: false, error: msg };
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
