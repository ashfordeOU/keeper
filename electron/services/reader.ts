// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The reader: feeds the person adds, looked at on the governor's schedule
// (slower when nobody is there, never while the screen is locked), and pages
// saved for later. The only network requests are to the feeds and pages the
// person added (and, with pictures on, the pictures in those articles, which
// the window loads). Keeper's own firewall rules apply to them. Everything is
// kept in <userData>/reader/: the list in state.json, each article's clean
// HTML in articles/<key>.html, so reading works offline.

import { app, BrowserWindow, dialog } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import sanitizeHtml from 'sanitize-html';
import type { ReaderApi, ReaderArticle, ReaderFeed, ReaderItem, ReaderOverview, ReaderView } from '../../core/api-reader';
import { discoverFeeds, extractArticle, guessFeedUrls, hostName, itemKey, normalizeReaderSettings, parseFeed, parseOpml, plainText, toOpml, type ParsedFeed } from '../../core/reader';
import { settings } from '../store';
import { featureOn, onFeature } from './features';
import { ownConnectionDenied } from './fw';
import { poll, pollNow } from './governor';

const FEATURE = 'reader';
const dir = () => path.join(app.getPath('userData'), 'reader');
const stateFile = () => path.join(dir(), 'state.json');
const articleFile = (key: string) => path.join(dir(), 'articles', `${key.replace(/[^\w-]/g, '_')}.html`);
const MAX_BYTES = 8 * 1024 * 1024;

interface Feed { id: string; url: string; title: string; site?: string; folder?: string; added: number; lastFetched?: number; error?: string; etag?: string; modified?: string }
interface Item { key: string; feedId: string | null; itemId: string; url: string; title: string; author?: string; published?: number; added: number; read: boolean; starred: boolean; later: boolean; image?: string; excerpt: string; source: string; offline: boolean; from?: 'feed' | 'page'; words?: number; byline?: string }
interface State { feeds: Feed[]; items: Item[] }

let state: State = { feeds: [], items: [] };
let loaded: Promise<void> | undefined;
let broadcast: (channel: string) => void = () => undefined;
let refreshing = false;
let stopPoll: (() => void) | undefined;

const options = () => normalizeReaderSettings(settings().reader);
const load = () => (loaded ??= (async () => {
  try {
    const raw = JSON.parse(await fsp.readFile(stateFile(), 'utf8')) as Partial<State>;
    state = { feeds: Array.isArray(raw.feeds) ? raw.feeds : [], items: Array.isArray(raw.items) ? raw.items : [] };
  } catch { /* first use */ }
})());

let saving: Promise<void> = Promise.resolve();
function save() {
  const text = JSON.stringify(state);
  saving = saving.then(async () => {
    await fsp.mkdir(dir(), { recursive: true, mode: 0o700 });
    await fsp.writeFile(`${stateFile()}.tmp`, text, { mode: 0o600 });
    await fsp.rename(`${stateFile()}.tmp`, stateFile());
  }).catch(() => undefined);
  return saving;
}
const changed = () => { void save(); broadcast('reader-changed'); };

// ---------------------------------------------------------------- the network (only what the person added)

async function get(url: string, extra: Record<string, string> = {}): Promise<{ status: number; text: string; url: string; headers: Headers }> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only web addresses (http and https) can be read.');
  if (await ownConnectionDenied(u.hostname, u.protocol === 'https:' ? 443 : 80).catch(() => false)) throw new Error(`Keeper’s firewall blocks ${u.hostname}.`);
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': `Keeper/${app.getVersion()} (reader)`, accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5', ...extra } });
  if (r.status === 304) return { status: 304, text: '', url: r.url || url, headers: r.headers };
  if (!r.ok) throw new Error(r.status === 404 ? 'The address was not found (404).' : r.status === 403 || r.status === 401 ? 'The site refused (it may need a sign-in).' : `The site answered ${r.status}.`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error('That is too large to read.');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('That is too large to read.');
  const cs = /charset=([\w-]+)/i.exec(r.headers.get('content-type') ?? '')?.[1];
  let text: string;
  try { text = new TextDecoder(cs && cs.toLowerCase() !== 'utf8' ? cs : 'utf-8').decode(buf); } catch { text = buf.toString('utf8'); }
  return { status: r.status, text, url: r.url || url, headers: r.headers };
}

const friendly = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (/timeout|aborted/i.test(m)) return 'The site did not answer in time.';
  if (/ENOTFOUND|getaddrinfo|fetch failed/i.test(m)) return 'The site could not be reached (no connection, or the address is wrong).';
  return m;
};

// ---------------------------------------------------------------- clean, safe HTML

function clean(html: string, base: string): string {
  const images = options().images;
  return sanitizeHtml(html, {
    allowedTags: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 'a', 'figure', 'figcaption', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'dl', 'dt', 'dd', 'mark', 'small', 's', 'del', 'ins', 'abbr', 'cite', 'q', 'time', 'div', 'span', ...(images ? ['img'] : [])],
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], abbr: ['title'], time: ['datetime'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['https', 'http'] },
    transformTags: {
      a: (_tag, attribs) => { try { return { tagName: 'a', attribs: { ...attribs, href: new URL(attribs.href ?? '', base).href } }; } catch { return { tagName: 'span', attribs: {} }; } },
      img: (_tag, attribs) => {
        // Tracking pixels go; relative pictures become absolute.
        if (Number(attribs.width) <= 2 || Number(attribs.height) <= 2) return { tagName: 'span', attribs: {} };
        try { return { tagName: 'img', attribs: { ...attribs, src: new URL(attribs.src ?? '', base).href, loading: 'lazy' } }; } catch { return { tagName: 'span', attribs: {} }; }
      },
    },
    exclusiveFilter: (f) => f.tag === 'span' && !f.text.trim(),
  });
}

async function keepArticle(key: string, html: string) {
  await fsp.mkdir(path.dirname(articleFile(key)), { recursive: true, mode: 0o700 });
  await fsp.writeFile(articleFile(key), html, { mode: 0o600 });
}

// ---------------------------------------------------------------- feeds

const feedIdOf = (url: string) => createHash('sha1').update(url).digest('hex').slice(0, 12);

function merge(feed: Feed, parsed: ParsedFeed): number {
  const known = new Set(state.items.filter((i) => i.feedId === feed.id).map((i) => i.key));
  let added = 0;
  const now = Date.now();
  const fresh: Item[] = [];
  for (const it of parsed.items) {
    const key = itemKey(feed.id, it.id);
    if (known.has(key)) continue;
    // Items older than the keep limit on the first look are not worth listing.
    if (it.published && now - it.published > options().keepDays * 86_400_000) continue;
    const html = it.html ? clean(it.html, it.url || feed.site || feed.url) : '';
    const text = plainText(html);
    fresh.push({ key, feedId: feed.id, itemId: it.id, url: it.url, title: it.title, author: it.author, published: it.published, added: now, read: false, starred: false, later: false, image: it.image, excerpt: text.slice(0, 240), source: feed.title, offline: false, from: 'feed', words: text ? text.split(' ').length : 0 });
    if (html) void keepArticle(key, html);
    added++;
  }
  state.items.push(...fresh);
  return added;
}

async function refreshFeed(feed: Feed): Promise<number> {
  try {
    const r = await get(feed.url, { ...(feed.etag ? { 'if-none-match': feed.etag } : {}), ...(feed.modified ? { 'if-modified-since': feed.modified } : {}) });
    feed.lastFetched = Date.now();
    feed.error = undefined;
    if (r.status === 304) return 0;
    const parsed = parseFeed(r.text, r.url);
    feed.etag = r.headers.get('etag') ?? undefined;
    feed.modified = r.headers.get('last-modified') ?? undefined;
    if (!feed.site && parsed.site) feed.site = parsed.site;
    return merge(feed, parsed);
  } catch (e) {
    feed.lastFetched = Date.now();
    feed.error = friendly(e);
    return 0;
  }
}

async function refreshAll(only?: string) {
  await load();
  if (refreshing) return;
  refreshing = true;
  broadcast('reader-changed');
  try {
    const list = state.feeds.filter((f) => !only || f.id === only);
    for (let i = 0; i < list.length; i += 3) await Promise.all(list.slice(i, i + 3).map(refreshFeed));
    prune();
  } finally {
    refreshing = false;
    changed();
  }
}

/** Read items older than the keep limit go (starred and saved ones stay), and the articles kept for them. */
function prune() {
  const limit = Date.now() - options().keepDays * 86_400_000;
  const gone = state.items.filter((i) => i.feedId && i.read && !i.starred && !i.later && (i.published ?? i.added) < limit);
  if (!gone.length) return;
  const keys = new Set(gone.map((i) => i.key));
  state.items = state.items.filter((i) => !keys.has(i.key));
  for (const k of keys) void fsp.rm(articleFile(k), { force: true });
}

// ---------------------------------------------------------------- the window's calls

function feedRow(f: Feed): ReaderFeed {
  return { id: f.id, url: f.url, title: f.title, site: f.site, folder: f.folder, added: f.added, lastFetched: f.lastFetched, error: f.error, unread: state.items.filter((i) => i.feedId === f.id && !i.read).length };
}
const row = (i: Item): ReaderItem => ({ key: i.key, feedId: i.feedId, url: i.url, title: i.title, author: i.author, published: i.published, added: i.added, read: i.read, starred: i.starred, later: i.later, image: i.image, excerpt: i.excerpt, source: i.source, offline: i.offline });

async function overview(): Promise<ReaderOverview> {
  await load();
  const s = state.items;
  return {
    feeds: state.feeds.map(feedRow).sort((a, b) => (a.folder ?? '').localeCompare(b.folder ?? '') || a.title.localeCompare(b.title)),
    folders: [...new Set(state.feeds.map((f) => f.folder).filter((x): x is string => !!x))].sort(),
    counts: { all: s.filter((i) => i.feedId).length, unread: s.filter((i) => i.feedId && !i.read).length, starred: s.filter((i) => i.starred).length, later: s.filter((i) => i.later).length },
    settings: options(),
    refreshing,
  };
}

function matching(q: { view?: ReaderView; feed?: string; folder?: string }): Item[] {
  const feedsIn = q.folder ? new Set(state.feeds.filter((f) => f.folder === q.folder).map((f) => f.id)) : undefined;
  return state.items.filter((i) => {
    if (q.feed && i.feedId !== q.feed) return false;
    if (feedsIn && (!i.feedId || !feedsIn.has(i.feedId))) return false;
    if (q.view === 'unread') return !!i.feedId && !i.read;
    if (q.view === 'starred') return i.starred;
    if (q.view === 'later') return i.later;
    return q.view === 'all' || q.feed || q.folder ? !!i.feedId : true;
  });
}

async function findFeed(input: string): Promise<{ url: string; parsed: ParsedFeed }> {
  let url = input.trim();
  if (!/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
  const r = await get(url);
  try {
    return { url: r.url, parsed: parseFeed(r.text, r.url) };
  } catch {
    // A web page: the feeds it names, then the usual addresses.
    const candidates = [...discoverFeeds(r.text, r.url).map((x) => x.url), ...guessFeedUrls(r.url)];
    for (const c of candidates.slice(0, 10)) {
      try {
        const f = await get(c);
        return { url: f.url, parsed: parseFeed(f.text, f.url) };
      } catch { /* the next one */ }
    }
    throw new Error('No feed was found at that address.');
  }
}

async function addFeed(input: string, folder?: string, title?: string): Promise<ReaderFeed> {
  await load();
  const { url, parsed } = await findFeed(input);
  const id = feedIdOf(url);
  const have = state.feeds.find((f) => f.id === id);
  if (have) return feedRow(have);
  const feed: Feed = { id, url, title: (title || parsed.title).slice(0, 200), site: parsed.site, folder: folder?.trim() || undefined, added: Date.now(), lastFetched: Date.now() };
  state.feeds.push(feed);
  merge(feed, parsed);
  changed();
  return feedRow(feed);
}

async function article(key: string): Promise<ReaderArticle> {
  await load();
  const it = state.items.find((i) => i.key === key);
  if (!it) throw new Error('That article is no longer here.');
  if (!it.read) { it.read = true; changed(); }
  let html = await fsp.readFile(articleFile(key), 'utf8').catch(() => '');
  let note: string | undefined;
  // A feed that gives only a summary: the page itself, made clean, kept for offline.
  if (it.from !== 'page' && it.url && options().fullText && (it.words ?? 0) < 150) {
    try {
      const r = await get(it.url);
      const a = extractArticle(r.text, r.url);
      html = clean(a.html, r.url);
      Object.assign(it, { from: 'page', words: a.words, byline: a.byline ?? it.author, offline: true, image: it.image ?? a.image });
      await keepArticle(key, html);
      changed();
    } catch (e) {
      note = `Showing the feed’s summary: ${friendly(e)}`;
    }
  } else if (html && !it.offline) { it.offline = true; changed(); }
  return { ...row(it), html, words: it.words ?? 0, byline: it.byline ?? it.author, from: it.from ?? 'feed', note };
}

export const readerApi: ReaderApi = {
  overview,
  async items(q) {
    await load();
    return matching(q).sort((a, b) => (b.published ?? b.added) - (a.published ?? a.added)).slice(0, Math.min(2000, q.limit ?? 500)).map(row);
  },
  article,
  addFeed: (url, folder) => addFeed(url, folder),
  async removeFeed(id) {
    await load();
    const gone = state.items.filter((i) => i.feedId === id && !i.starred && !i.later);
    for (const i of gone) void fsp.rm(articleFile(i.key), { force: true });
    state.items = state.items.filter((i) => i.feedId !== id || i.starred || i.later).map((i) => (i.feedId === id ? { ...i, feedId: null } : i));
    state.feeds = state.feeds.filter((f) => f.id !== id);
    changed();
    return overview();
  },
  async editFeed(id, patch) {
    await load();
    const f = state.feeds.find((x) => x.id === id);
    if (f) {
      if (patch.title?.trim()) f.title = patch.title.trim().slice(0, 200);
      if (patch.folder !== undefined) f.folder = patch.folder.trim() || undefined;
      for (const i of state.items) if (i.feedId === id) i.source = f.title;
      changed();
    }
    return overview();
  },
  async refresh(feedId) {
    await refreshAll(feedId);
    return overview();
  },
  async setRead(keys, read) {
    await load();
    const set = new Set(keys);
    for (const i of state.items) if (set.has(i.key)) i.read = read;
    changed();
  },
  async markAllRead(q) {
    await load();
    for (const i of matching({ ...q, view: 'unread' })) i.read = true;
    changed();
    return overview();
  },
  async setStarred(key, on) {
    await load();
    const i = state.items.find((x) => x.key === key);
    if (i) { i.starred = on; changed(); }
  },
  async saveForLater(url, title) {
    await load();
    const r = await get(url);
    const a = extractArticle(r.text, r.url);
    const key = itemKey('later', r.url);
    const existing = state.items.find((i) => i.url === r.url || i.key === key);
    const html = clean(a.html, r.url);
    if (existing) {
      Object.assign(existing, { later: true, from: 'page', words: a.words, offline: true, byline: a.byline });
      await keepArticle(existing.key, html);
      changed();
      return row(existing);
    }
    const it: Item = { key, feedId: null, itemId: r.url, url: r.url, title: (title?.trim() || a.title).slice(0, 300), author: a.byline, published: a.published, added: Date.now(), read: false, starred: false, later: true, image: a.image, excerpt: a.excerpt, source: a.siteName || hostName(r.url), offline: true, from: 'page', words: a.words, byline: a.byline };
    await keepArticle(key, html);
    state.items.push(it);
    changed();
    return row(it);
  },
  async removeLater(key) {
    await load();
    const i = state.items.find((x) => x.key === key);
    if (!i) return;
    if (i.feedId) i.later = false;
    else { state.items = state.items.filter((x) => x !== i); void fsp.rm(articleFile(key), { force: true }); }
    changed();
  },
  async importOpml(text) {
    let body = text;
    if (!body) {
      const win = BrowserWindow.getFocusedWindow();
      const opts = { title: 'Import feeds (OPML)', properties: ['openFile'] as 'openFile'[], filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (r.canceled || !r.filePaths[0]) return { added: 0, skipped: 0, failed: [] };
      body = await fsp.readFile(r.filePaths[0], 'utf8');
    }
    await load();
    const list = parseOpml(body);
    let added = 0;
    let skipped = 0;
    const failed: string[] = [];
    for (const f of list.slice(0, 1000)) {
      if (state.feeds.some((x) => x.url === f.url || x.id === feedIdOf(f.url))) { skipped++; continue; }
      // Added straight away; the first look happens in the background.
      state.feeds.push({ id: feedIdOf(f.url), url: f.url, title: f.title || hostName(f.url), folder: f.folder, added: Date.now() });
      added++;
    }
    changed();
    if (added) void refreshAll().catch(() => failed.push('refresh'));
    return { added, skipped, failed };
  },
  async exportOpml() {
    await load();
    const win = BrowserWindow.getFocusedWindow();
    const defaultPath = path.join(app.getPath('documents'), 'Keeper feeds.opml');
    const out = process.env.KEEPER_READER_TEST ? path.join(app.getPath('downloads'), 'Keeper feeds.opml') : (await (win ? dialog.showSaveDialog(win, { defaultPath, filters: [{ name: 'OPML', extensions: ['opml'] }] }) : dialog.showSaveDialog({ defaultPath }))).filePath;
    if (!out) return { saved: false };
    await fsp.writeFile(out, toOpml(state.feeds.map((f) => ({ url: f.url, title: f.title, folder: f.folder, site: f.site }))));
    return { saved: true, path: out };
  },
};

/** "Save for later" from the browser extension (keeper/reader.save). */
export function saveFromBrowser(url: string, title?: string) {
  return readerApi.saveForLater(url, title);
}

export function startReader(d: { broadcast: (channel: string) => void }) {
  broadcast = d.broadcast;
  onFeature(FEATURE, (on) => {
    if (!on) { stopPoll?.(); stopPoll = undefined; return; }
    void load().then(() => {
      stopPoll = poll('reader.refresh', () => ({ baseMs: options().refreshMinutes * 60_000, pauseWhenLocked: true, idleFactor: 2, maxMs: 24 * 3600_000 }), () => (state.feeds.length ? refreshAll() : undefined), { feature: FEATURE, now: false });
      // A first look soon after start when the last one is older than the interval.
      const stale = state.feeds.some((f) => !f.lastFetched || Date.now() - f.lastFetched > options().refreshMinutes * 60_000);
      if (stale) setTimeout(() => { if (featureOn(FEATURE)) pollNow('reader.refresh'); }, 20_000).unref?.();
    });
  }, { now: true });
}
