// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The reader: feeds (RSS 2.0, RSS 1.0, Atom and JSON Feed), finding a site's
// feed, OPML in and out, and a clean article view from any web page (the main
// text found by how much plain paragraph text each part of the page holds).
// Pure logic, no network: electron/services/reader.ts fetches and stores.

import { decodeEntities, parseXml, type XNode } from './tracks/xml';

export interface FeedItem {
  /** the feed's own id (guid / id), or the link */
  id: string;
  url: string;
  title: string;
  author?: string;
  /** epoch ms */
  published?: number;
  /** HTML as the feed gives it (summary or full content) */
  html?: string;
  image?: string;
}

export interface ParsedFeed {
  title: string;
  /** the site the feed belongs to */
  site?: string;
  kind: 'rss' | 'atom' | 'json' | 'rdf';
  items: FeedItem[];
}

const MAX_ITEMS = 500;

const resolve = (u: string | undefined, base: string): string | undefined => {
  if (!u) return undefined;
  try {
    const r = new URL(u.trim(), base);
    return /^https?:$/.test(r.protocol) ? r.href : undefined;
  } catch {
    return undefined;
  }
};

const date = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : undefined;
};

const kid = (n: XNode | undefined, ...names: string[]) => n?.children.find((c) => names.includes(c.name));
const kids = (n: XNode | undefined, name: string) => n?.children.filter((c) => c.name === name) ?? [];
const txt = (n: XNode | undefined) => (n ? (n.text.trim() || serialize(n.children)).trim() || undefined : undefined);

/** Child elements back to markup (Atom's type="xhtml" content). */
function serialize(nodes: XNode[]): string {
  return nodes.map((c) => {
    const attrs = Object.entries(c.attrs).map(([k, v]) => ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
    return `<${c.name}${attrs}>${escText(c.text)}${serialize(c.children)}</${c.name}>`;
  }).join('');
}
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const plain = (s: string | undefined) => (s ? decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() : '');

function firstImage(html: string | undefined, base: string): string | undefined {
  const m = html ? /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html) : null;
  return m ? resolve(decodeEntities(m[1]), base) : undefined;
}

/** Reads a feed of any of the four kinds. Throws a plain message when the text is not a feed. */
export function parseFeed(text: string, feedUrl: string): ParsedFeed {
  const t = text.replace(/^﻿/, '').trim();
  if (t.startsWith('{')) return parseJsonFeed(t, feedUrl);
  if (!t.startsWith('<')) throw new Error('This is not a feed.');
  const root = parseXml(t);
  const top = root.children.find((c) => c.name === 'rss' || c.name === 'feed' || c.name === 'RDF');
  if (!top) throw new Error(/<html/i.test(t.slice(0, 2000)) ? 'This is a web page, not a feed.' : 'This is not a feed.');
  if (top.name === 'feed') return parseAtom(top, feedUrl);
  const channel = kid(top, 'channel');
  const items = top.name === 'RDF' ? kids(top, 'item') : kids(channel, 'item');
  const site = resolve(txt(kid(channel, 'link')) ?? kid(channel, 'link')?.attrs.href, feedUrl);
  return {
    kind: top.name === 'RDF' ? 'rdf' : 'rss',
    title: plain(txt(kid(channel, 'title'))) || hostName(site ?? feedUrl),
    site,
    items: items.slice(0, MAX_ITEMS).map((it) => {
      const link = resolve(txt(kid(it, 'link')) ?? kid(it, 'link')?.attrs.href ?? it.attrs.about, site ?? feedUrl) ?? '';
      const html = txt(kid(it, 'encoded')) ?? txt(kid(it, 'description'));
      const enclosure = kids(it, 'enclosure').find((e) => /^image\//.test(e.attrs.type ?? ''))?.attrs.url ?? kids(it, 'content').find((e) => e.attrs.medium === 'image' || /^image\//.test(e.attrs.type ?? ''))?.attrs.url ?? kid(it, 'thumbnail')?.attrs.url;
      return {
        id: txt(kid(it, 'guid')) ?? link ?? plain(txt(kid(it, 'title'))),
        url: link,
        title: plain(txt(kid(it, 'title'))) || plain(html).slice(0, 80) || 'Untitled',
        author: plain(txt(kid(it, 'creator', 'author'))) || undefined,
        published: date(txt(kid(it, 'pubDate', 'date', 'published', 'updated'))),
        html,
        image: resolve(enclosure, link || feedUrl) ?? firstImage(html, link || feedUrl),
      };
    }).filter((x) => x.url || x.html),
  };
}

function parseAtom(feed: XNode, feedUrl: string): ParsedFeed {
  const linkOf = (n: XNode) => {
    const links = kids(n, 'link');
    return (links.find((l) => !l.attrs.rel || l.attrs.rel === 'alternate') ?? links[0])?.attrs.href;
  };
  const site = resolve(linkOf(feed), feedUrl);
  return {
    kind: 'atom',
    title: plain(txt(kid(feed, 'title'))) || hostName(site ?? feedUrl),
    site,
    items: kids(feed, 'entry').slice(0, MAX_ITEMS).map((e) => {
      const url = resolve(linkOf(e), site ?? feedUrl) ?? '';
      const content = kid(e, 'content');
      const html = (content && (content.attrs.type === 'xhtml' ? serialize(content.children) : txt(content))) || txt(kid(e, 'summary'));
      const author = kid(e, 'author');
      return {
        id: txt(kid(e, 'id')) ?? url,
        url,
        title: plain(txt(kid(e, 'title'))) || 'Untitled',
        author: plain(txt(kid(author, 'name'))) || undefined,
        published: date(txt(kid(e, 'published', 'updated', 'issued'))),
        html,
        image: resolve(kid(e, 'thumbnail')?.attrs.url, url || feedUrl) ?? firstImage(html, url || feedUrl),
      };
    }).filter((x) => x.url || x.html),
  };
}

function parseJsonFeed(t: string, feedUrl: string): ParsedFeed {
  let o: Record<string, unknown>;
  try { o = JSON.parse(t) as Record<string, unknown>; } catch { throw new Error('This is not a feed.'); }
  if (typeof o.version !== 'string' || !/jsonfeed\.org\/version/.test(o.version) || !Array.isArray(o.items)) throw new Error('This is not a JSON Feed.');
  const site = resolve(typeof o.home_page_url === 'string' ? o.home_page_url : undefined, feedUrl);
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    kind: 'json',
    title: s(o.title) || hostName(site ?? feedUrl),
    site,
    items: (o.items as Record<string, unknown>[]).slice(0, MAX_ITEMS).filter((x) => x && typeof x === 'object').map((x) => {
      const url = resolve(s(x.url) ?? s(x.external_url), feedUrl) ?? '';
      const html = s(x.content_html) ?? (s(x.content_text) ? escText(s(x.content_text)!).replace(/\n/g, '<br>') : undefined) ?? s(x.summary);
      const authors = Array.isArray(x.authors) ? (x.authors as { name?: string }[]) : x.author ? [x.author as { name?: string }] : [];
      return {
        id: String(x.id ?? url),
        url,
        title: s(x.title) || plain(html).slice(0, 80) || 'Untitled',
        author: authors.map((a) => a?.name).filter(Boolean).join(', ') || undefined,
        published: date(s(x.date_published) ?? s(x.date_modified)),
        html,
        image: resolve(s(x.image) ?? s(x.banner_image), url || feedUrl) ?? firstImage(html, url || feedUrl),
      };
    }).filter((x) => x.url || x.html),
  };
}

export function hostName(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

/** The feeds a web page names in its <head> (link rel="alternate"). */
export function discoverFeeds(html: string, pageUrl: string): { url: string; title?: string }[] {
  const out: { url: string; title?: string }[] = [];
  const head = html.slice(0, 200_000);
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (k: string) => { const r = new RegExp(`\\b${k}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return r ? decodeEntities(r[2] ?? r[3] ?? r[4] ?? '') : undefined; };
    if (!/\balternate\b/i.test(attr('rel') ?? '')) continue;
    if (!/(rss|atom|feed)\+(xml|json)|application\/json|application\/feed/i.test(attr('type') ?? '')) continue;
    const url = resolve(attr('href'), pageUrl);
    if (url && !out.some((x) => x.url === url)) out.push({ url, title: attr('title') || undefined });
  }
  return out;
}

/** Common feed addresses to try when a page names none. */
export function guessFeedUrls(pageUrl: string): string[] {
  try {
    const u = new URL(pageUrl);
    return ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml', '/feed.json'].map((p) => new URL(p, u.origin).href);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- OPML

export interface OpmlFeed { url: string; title?: string; folder?: string }

export function parseOpml(text: string): OpmlFeed[] {
  const root = parseXml(text.replace(/^﻿/, ''));
  const opml = root.children.find((c) => c.name.toLowerCase() === 'opml');
  if (!opml) throw new Error('This is not an OPML file.');
  const body = opml.children.find((c) => c.name === 'body');
  const out: OpmlFeed[] = [];
  const walk = (n: XNode, folder?: string) => {
    for (const o of n.children.filter((c) => c.name === 'outline')) {
      const url = o.attrs.xmlUrl ?? o.attrs.xmlurl;
      const title = o.attrs.title ?? o.attrs.text;
      if (url && /^https?:\/\//i.test(url.trim())) { if (!out.some((x) => x.url === url.trim())) out.push({ url: url.trim(), title: title || undefined, folder }); }
      else walk(o, title || folder);
    }
  };
  if (body) walk(body);
  return out;
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toOpml(feeds: { url: string; title: string; folder?: string; site?: string }[], title = 'Feeds from Keeper'): string {
  const folders = new Map<string, typeof feeds>();
  for (const f of feeds) { const k = f.folder ?? ''; folders.set(k, [...(folders.get(k) ?? []), f]); }
  const line = (f: (typeof feeds)[number], pad: string) => `${pad}<outline type="rss" text="${attr(f.title)}" title="${attr(f.title)}" xmlUrl="${attr(f.url)}"${f.site ? ` htmlUrl="${attr(f.site)}"` : ''}/>`;
  const body: string[] = [];
  for (const [folder, list] of folders) {
    if (!folder) body.push(...list.map((f) => line(f, '    ')));
    else body.push(`    <outline text="${attr(folder)}" title="${attr(folder)}">`, ...list.map((f) => line(f, '      ')), '    </outline>');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>${attr(title)}</title>\n  </head>\n  <body>\n${body.join('\n')}\n  </body>\n</opml>\n`;
}

// ---------------------------------------------------------------- the clean article view

interface HNode { tag: string; attrs: Record<string, string>; children: (HNode | string)[]; parent?: HNode }

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'noscript', 'template', 'svg', 'textarea', 'iframe', 'object']);
const DROP = new Set([...RAW, 'nav', 'header', 'footer', 'aside', 'form', 'button', 'select', 'input', 'dialog', 'menu', 'canvas', 'video', 'audio']);
const NOISE = /(^|[\s_-])(comment|comments|share|social|sidebar|footer|header|nav|menu|related|recommend|promo|advert|ads?|sponsor|newsletter|subscribe|signup|cookie|banner|popup|modal|breadcrumb|author-bio|tags|meta-?bar|pagination)([\s_-]|$)/i;
const GOOD = /(^|[\s_-])(article|post|entry|content|story|main|body|text|prose)([\s_-]|$)/i;
// An end tag closes these when another of the same opens (p inside p, li inside li…).
const AUTOCLOSE: Record<string, string[]> = { p: ['p'], li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], tr: ['tr'], td: ['td', 'th'], th: ['td', 'th'], option: ['option'] };

function parseAttrsHtml(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([^\s=/>"']+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}

/** A forgiving HTML reader: enough structure to find the article, nothing more. */
export function parseHtml(html: string): HNode {
  const root: HNode = { tag: '#root', attrs: {}, children: [] };
  let cur = root;
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { cur.children.push(decodeEntities(html.slice(i))); break; }
    if (lt > i) cur.children.push(decodeEntities(html.slice(i, lt)));
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { const e = html.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    const close = html[lt + 1] === '/';
    const m = /^<\/?([a-zA-Z][\w:-]*)([^>]*)>/.exec(html.slice(lt, lt + 4000));
    if (!m) { cur.children.push('<'); i = lt + 1; continue; }
    i = lt + m[0].length;
    const tag = m[1].toLowerCase();
    if (close) {
      for (let p: HNode | undefined = cur; p && p !== root; p = p.parent) if (p.tag === tag) { cur = p.parent ?? root; break; }
      continue;
    }
    const auto = AUTOCLOSE[tag];
    if (auto) for (let p: HNode | undefined = cur; p && p !== root && !['div', 'section', 'article', 'ul', 'ol', 'table', 'body'].includes(p.tag); p = p.parent) if (auto.includes(p.tag)) { cur = p.parent ?? root; break; }
    const node: HNode = { tag, attrs: parseAttrsHtml(m[2]), children: [], parent: cur };
    cur.children.push(node);
    if (RAW.has(tag)) {
      // Skip to the end tag without reading what is inside.
      const e = html.toLowerCase().indexOf(`</${tag}`, i);
      i = e < 0 ? n : html.indexOf('>', e) + 1 || n;
      continue;
    }
    if (!VOID.has(tag) && !m[2].trim().endsWith('/')) cur = node;
  }
  return root;
}

const textOf = (n: HNode | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(n.tag === 'br' ? '\n' : ''));
const els = (n: HNode, out: HNode[] = []): HNode[] => { for (const c of n.children) if (typeof c !== 'string') { out.push(c); els(c, out); } return out; };
const find = (n: HNode, tag: string) => els(n).find((e) => e.tag === tag);
const meta = (root: HNode, ...keys: string[]) => {
  for (const k of keys) {
    const m = els(root).find((e) => e.tag === 'meta' && (e.attrs.property === k || e.attrs.name === k));
    if (m?.attrs.content) return m.attrs.content.trim();
  }
  return undefined;
};

function linkDensity(n: HNode): number {
  const all = textOf(n).replace(/\s+/g, ' ').length || 1;
  const links = els(n).filter((e) => e.tag === 'a').reduce((s, a) => s + textOf(a).replace(/\s+/g, ' ').length, 0);
  return links / all;
}

const isNoise = (n: HNode) => DROP.has(n.tag) || NOISE.test(`${n.attrs.class ?? ''} ${n.attrs.id ?? ''} ${n.attrs.role ?? ''}`) && !GOOD.test(`${n.attrs.class ?? ''} ${n.attrs.id ?? ''}`) || n.attrs['aria-hidden'] === 'true' || /display\s*:\s*none/i.test(n.attrs.style ?? '') || n.attrs.hidden !== undefined;

/** Removes navigation, ads, forms and other noise in place. */
function prune(n: HNode) {
  n.children = n.children.filter((c) => typeof c === 'string' || !isNoise(c));
  for (const c of n.children) if (typeof c !== 'string') prune(c);
}

/** The element holding the article: the one whose paragraphs hold the most text, with a bonus for article/main and good class names. */
function bestBlock(root: HNode): HNode | undefined {
  const scores = new Map<HNode, number>();
  for (const p of els(root).filter((e) => e.tag === 'p' || e.tag === 'pre' || e.tag === 'blockquote' || (e.tag === 'div' && !e.children.some((c) => typeof c !== 'string' && ['p', 'div', 'section', 'article', 'ul', 'ol', 'table'].includes(c.tag))))) {
    const t = textOf(p).replace(/\s+/g, ' ').trim();
    if (t.length < 25) continue;
    const s = 1 + Math.min(3, Math.floor(t.length / 100)) + (t.match(/,/g)?.length ?? 0) * 0.5;
    const parent = p.parent;
    if (!parent) continue;
    scores.set(parent, (scores.get(parent) ?? 0) + s);
    if (parent.parent) scores.set(parent.parent, (scores.get(parent.parent) ?? 0) + s / 2);
  }
  let best: HNode | undefined;
  let bestScore = 0;
  for (const [n, s0] of scores) {
    let s = s0;
    if (n.tag === 'article' || n.tag === 'main') s *= 1.4;
    if (GOOD.test(`${n.attrs.class ?? ''} ${n.attrs.id ?? ''} ${n.attrs.itemprop ?? ''}`)) s *= 1.25;
    s *= 1 - Math.min(0.9, linkDensity(n));
    if (s > bestScore) { best = n; bestScore = s; }
  }
  return best;
}

const KEEP = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 'a', 'img', 'figure', 'figcaption', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'dl', 'dt', 'dd', 'picture', 'source', 'mark', 'small', 's', 'del', 'ins', 'abbr', 'cite', 'q', 'time', 'span', 'div', 'section', 'article', 'main']);

/** Back to HTML, keeping only reading tags and absolute links and pictures. */
function toHtml(n: HNode | string, base: string): string {
  if (typeof n === 'string') return escText(n);
  const inner = n.children.map((c) => toHtml(c, base)).join('');
  if (!KEEP.has(n.tag)) return inner;
  const t = ['div', 'section', 'article', 'main', 'span'].includes(n.tag) ? (n.tag === 'span' ? '' : 'div') : n.tag;
  if (!t) return inner;
  let attrs = '';
  if (t === 'a') { const h = resolve(n.attrs.href, base); if (h) attrs = ` href="${attr(h)}"`; }
  if (t === 'img') {
    const src = resolve(n.attrs.src || n.attrs['data-src'] || n.attrs['data-lazy-src'] || (n.attrs.srcset ?? '').split(/\s+/)[0], base);
    if (!src) return '';
    return `<img src="${attr(src)}" alt="${attr(n.attrs.alt ?? '')}">`;
  }
  if (VOID.has(t)) return `<${t}>`;
  return `<${t}${attrs}>${inner}</${t}>`;
}

export interface Article {
  title: string;
  byline?: string;
  siteName?: string;
  published?: number;
  /** the article's HTML (still to be sanitized before it is shown) */
  html: string;
  /** plain text, for search and the word count */
  text: string;
  words: number;
  image?: string;
  excerpt: string;
}

/** The readable part of a web page. Throws a plain message when there is none. */
export function extractArticle(html: string, pageUrl: string): Article {
  const root = parseHtml(html);
  const title = meta(root, 'og:title', 'twitter:title') ?? plain(textOf(find(root, 'title') ?? { tag: 't', attrs: {}, children: [] })).replace(/\s+[|·–—-]\s+[^|·–—-]+$/, '') ?? hostName(pageUrl);
  const byline = meta(root, 'author', 'article:author', 'twitter:creator');
  const siteName = meta(root, 'og:site_name', 'application-name');
  const published = date(meta(root, 'article:published_time', 'date', 'dc.date', 'pubdate') ?? els(root).find((e) => e.tag === 'time' && e.attrs.datetime)?.attrs.datetime);
  const image = resolve(meta(root, 'og:image', 'twitter:image'), pageUrl);
  const body = find(root, 'body') ?? root;
  prune(body);
  const best = bestBlock(body);
  if (!best) throw new Error('No article was found on this page.');
  // The article's own heading is the title (shown once, above the text); blocks that are mostly links go.
  const heading = best.children.find((c): c is HNode => typeof c !== 'string' && textOf(c).trim() !== '');
  let headTitle: string | undefined;
  if (heading && (heading.tag === 'h1' || (heading.tag === 'header' && find(heading, 'h1')))) {
    headTitle = plain(textOf(heading.tag === 'h1' ? heading : find(heading, 'h1')!));
    best.children = best.children.filter((c) => c !== heading);
  }
  best.children = best.children.filter((c) => typeof c === 'string' || !(c.tag === 'h1' && plain(textOf(c)) === plain(title)) && !(['div', 'ul', 'section'].includes(c.tag) && linkDensity(c) > 0.6 && textOf(c).length < 400));
  const out = toHtml({ ...best, tag: 'div' }, pageUrl).replace(/(<div>\s*<\/div>)+/g, '');
  const text = plain(out);
  const words = text ? text.split(' ').length : 0;
  if (words < 30) throw new Error('No article was found on this page.');
  return { title: (meta(root, 'og:title', 'twitter:title') ? plain(title) : headTitle || plain(title)) || hostName(pageUrl), byline: byline ? plain(byline) : undefined, siteName, published, html: out, text, words, image, excerpt: text.slice(0, 220) };
}

/** Minutes to read, at an easy pace. */
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 230));

/** Plain words from HTML (for excerpts and search). */
export const plainText = plain;

// ---------------------------------------------------------------- settings

export interface ReaderSettings {
  /** minutes between looks at the feeds */
  refreshMinutes: number;
  /** read articles older than this are removed (starred and saved ones stay) */
  keepDays: number;
  /** fetch the whole article when a feed gives only a summary */
  fullText: boolean;
  /** load pictures in articles from their sites */
  images: boolean;
}

export const defaultReaderSettings = (): ReaderSettings => ({ refreshMinutes: 60, keepDays: 30, fullText: true, images: true });

export function normalizeReaderSettings(o: Partial<ReaderSettings> | undefined): ReaderSettings {
  const d = defaultReaderSettings();
  const v = { ...d, ...(o && typeof o === 'object' ? o : {}) };
  return {
    refreshMinutes: Math.min(24 * 60, Math.max(15, Math.round(Number(v.refreshMinutes) || d.refreshMinutes))),
    keepDays: Math.min(3650, Math.max(1, Math.round(Number(v.keepDays) || d.keepDays))),
    fullText: v.fullText !== false,
    images: v.images !== false,
  };
}

/** A stable short id for an item of a feed. */
export function itemKey(feedId: string, itemId: string): string {
  let h = 2166136261;
  for (const ch of `${feedId}\u0000${itemId}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `${feedId.slice(0, 8)}-${(h >>> 0).toString(36)}`;
}
