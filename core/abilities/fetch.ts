// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading web pages for an AI: only public http(s) addresses (never this
// computer or the home network unless allowed), a size cap, and the main text
// pulled out of the page so the AI gets the article, not the menus.

import { lookup } from 'node:dns/promises';
import net from 'node:net';

/** Loopback, private, link-local, CGNAT, multicast and other addresses that are not "the internet". */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return true;
    if (x.startsWith('::ffff:')) return isPrivateAddress(x.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true;
}

export interface UrlCheck {
  ok: boolean;
  url?: URL;
  reason?: string;
}

/** Is this address one an AI may make Keeper fetch? */
export async function checkUrl(raw: string, opts: { allowLocal?: boolean; resolve?: (host: string) => Promise<string[]> } = {}): Promise<UrlCheck> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: 'Not a web address' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'Only http and https addresses can be read' };
  if (u.username || u.password) return { ok: false, reason: 'Addresses with a user name or password are not read' };
  if (opts.allowLocal) return { ok: true, url: u };
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.localhost|.*\.internal|.*\.lan|.*\.home\.arpa)$/i.test(host)) return { ok: false, reason: 'Addresses on this computer or the home network are not read' };
  const ips = net.isIP(host) ? [host] : await (opts.resolve ?? (async (h) => (await lookup(h, { all: true })).map((r) => r.address)))(host).catch(() => [] as string[]);
  if (!ips.length) return { ok: false, reason: 'That address could not be found' };
  if (ips.some(isPrivateAddress)) return { ok: false, reason: 'That address points into a private network' };
  return { ok: true, url: u };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export interface PageText {
  title: string;
  text: string;
  links: { text: string; href: string }[];
  /** published date, when the page says */
  date?: string;
}

/** The readable part of a page: the article or main section when there is one, without scripts, menus and footers. */
export function extractPage(html: string, base?: string): PageText {
  let h = html.replace(/<!--[\s\S]*?-->/g, '');
  const title = decodeEntities((h.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)/i)?.[1] ?? h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim());
  const date = h.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|date|pubdate)["'][^>]*content=["']([^"']+)/i)?.[1] ?? h.match(/<time[^>]+datetime=["']([^"']+)/i)?.[1];
  h = h.replace(/<(script|style|noscript|svg|canvas|iframe|template|form|button|select)\b[\s\S]*?<\/\1>/gi, ' ');
  const pick = (tag: string) => {
    const all = [...h.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map((m) => m[1]);
    return all.sort((a, b) => b.length - a.length)[0];
  };
  let body = pick('article') ?? pick('main') ?? h.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? h;
  body = body.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const links: PageText['links'] = [];
  body = body.replace(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    let abs = href;
    try {
      abs = base ? new URL(href, base).toString() : href;
    } catch {
      /* keep as written */
    }
    if (text && /^https?:/i.test(abs) && links.length < 60) links.push({ text, href: abs });
    return text;
  });
  const text = decodeEntities(
    body
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${'#'.repeat(Number(n))} `)
      .replace(/<\/(p|div|section|h[1-6]|li|tr|blockquote|pre|table|ul|ol|dd|dt|figure)>/gi, '\n')
      .replace(/<td\b[^>]*>/gi, ' | ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text, links, date };
}

export interface Fetched {
  url: string;
  status: number;
  type: string;
  title: string;
  text: string;
  links: PageText['links'];
  date?: string;
  truncated: boolean;
}

/** Fetches a page within limits: 5 redirects, 3 MB, 20 seconds, public addresses only. */
export async function fetchReadable(raw: string, opts: { fetch?: typeof fetch; maxBytes?: number; timeoutMs?: number; allowLocal?: boolean; resolve?: (h: string) => Promise<string[]>; userAgent?: string } = {}): Promise<Fetched> {
  const f = opts.fetch ?? fetch;
  let url = raw;
  for (let hop = 0; hop < 6; hop++) {
    const c = await checkUrl(url, { allowLocal: opts.allowLocal, resolve: opts.resolve });
    if (!c.ok) throw new Error(c.reason);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
    try {
      const res = await f(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': opts.userAgent ?? 'Keeper (+https://github.com/ashfordeOU/keeper)', accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url).toString();
        continue;
      }
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      const max = opts.maxBytes ?? 3_000_000;
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > max) { chunks.push(value.slice(0, value.length - (size - max))); truncated = true; await reader.cancel().catch(() => undefined); break; }
          chunks.push(value);
        }
      }
      const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
      if (/html|xml/.test(type) || /^\s*</.test(body)) {
        const p = extractPage(body, url);
        return { url, status: res.status, type, title: p.title, text: p.text, links: p.links, date: p.date, truncated };
      }
      if (/^text\/|json/.test(type) || !type) return { url, status: res.status, type, title: '', text: body, links: [], truncated };
      throw new Error(`That address is a ${type} file, not a page Keeper can read`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Too many redirects');
}
