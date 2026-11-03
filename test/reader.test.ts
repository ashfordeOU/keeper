// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { discoverFeeds, extractArticle, guessFeedUrls, itemKey, normalizeReaderSettings, parseFeed, parseOpml, readingMinutes, toOpml } from '../core/reader';

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Garden Notes &amp; More</title><link>https://garden.example/</link>
<item><title>Planting bulbs</title><link>/2026/bulbs</link><guid isPermaLink="false">g-1</guid><pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate>
<dc:creator>Ada</dc:creator><description>Short summary</description><content:encoded><![CDATA[<p>Plant them <b>deep</b>.</p><img src="/img/bulb.jpg">]]></content:encoded></item>
<item><title>Second</title><link>https://garden.example/2</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title type="text">Code Log</title><link href="https://code.example/"/><link rel="self" href="https://code.example/atom.xml"/>
<entry><title>Release 2.0</title><link rel="alternate" href="https://code.example/r2"/><id>tag:code.example,2026:r2</id><updated>2026-11-01T10:00:00Z</updated>
<author><name>Lin</name></author><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>New things.</p></div></content></entry></feed>`;

const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://old.example/"><title>Old Site</title><link>https://old.example/</link></channel>
<item rdf:about="https://old.example/a"><title>A</title><link>https://old.example/a</link><dc:date>2026-10-01T00:00:00Z</dc:date></item></rdf:RDF>`;

const JSONF = JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'Json Site', home_page_url: 'https://json.example/', items: [{ id: '1', url: 'https://json.example/1', title: 'Hello', content_text: 'Line one\nLine two', date_published: '2026-11-03T08:00:00Z', authors: [{ name: 'Mo' }] }] });

describe('feeds', () => {
  it('reads RSS 2.0 with full content, author and dates', () => {
    const f = parseFeed(RSS, 'https://garden.example/feed');
    expect(f).toMatchObject({ kind: 'rss', title: 'Garden Notes & More', site: 'https://garden.example/' });
    expect(f.items[0]).toMatchObject({ id: 'g-1', url: 'https://garden.example/2026/bulbs', title: 'Planting bulbs', author: 'Ada', published: Date.parse('2026-11-02T09:00:00Z'), image: 'https://garden.example/img/bulb.jpg' });
    expect(f.items[0].html).toContain('<b>deep</b>');
    expect(f.items[1].id).toBe('https://garden.example/2');
  });
  it('reads Atom, RSS 1.0 and JSON Feed', () => {
    const a = parseFeed(ATOM, 'https://code.example/atom.xml');
    expect(a).toMatchObject({ kind: 'atom', title: 'Code Log', site: 'https://code.example/' });
    expect(a.items[0]).toMatchObject({ url: 'https://code.example/r2', author: 'Lin', id: 'tag:code.example,2026:r2' });
    expect(a.items[0].html).toContain('<p>New things.</p>');
    expect(parseFeed(RDF, 'https://old.example/rss').items[0]).toMatchObject({ url: 'https://old.example/a', title: 'A' });
    const j = parseFeed(JSONF, 'https://json.example/feed.json');
    expect(j.items[0]).toMatchObject({ title: 'Hello', author: 'Mo', html: 'Line one<br>Line two' });
  });
  it('says plainly when something is not a feed', () => {
    expect(() => parseFeed('<!doctype html><html><body>hi</body></html>', 'https://x.example/')).toThrow('This is a web page, not a feed.');
    expect(() => parseFeed('{"a":1}', 'https://x.example/')).toThrow(/not a JSON Feed/);
    expect(() => parseFeed('hello', 'https://x.example/')).toThrow('This is not a feed.');
  });
  it('never takes links that are not web addresses', () => {
    const f = parseFeed('<rss><channel><title>t</title><item><title>x</title><link>javascript:alert(1)</link><description>d</description></item></channel></rss>', 'https://x.example/');
    expect(f.items[0].url).toBe('');
  });
  it('finds a site’s feeds in its page, or guesses', () => {
    const html = '<html><head><link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml"><link rel="alternate" type="application/feed+json" href="https://s.example/feed.json"><link rel="stylesheet" href="/a.css"></head></html>';
    expect(discoverFeeds(html, 'https://s.example/blog/')).toEqual([{ url: 'https://s.example/feed.xml', title: 'Posts' }, { url: 'https://s.example/feed.json' }]);
    expect(guessFeedUrls('https://s.example/blog/post')[0]).toBe('https://s.example/feed');
  });
});

describe('OPML', () => {
  it('reads folders and feeds, and writes them back', () => {
    const text = `<?xml version="1.0"?><opml version="2.0"><head><title>x</title></head><body>
      <outline text="Tech"><outline type="rss" text="Code Log" xmlUrl="https://code.example/atom.xml"/><outline text="Bad" xmlUrl="file:///etc"/></outline>
      <outline type="rss" title="Garden" xmlUrl="https://garden.example/feed"/></body></opml>`;
    const feeds = parseOpml(text);
    expect(feeds).toEqual([{ url: 'https://code.example/atom.xml', title: 'Code Log', folder: 'Tech' }, { url: 'https://garden.example/feed', title: 'Garden', folder: undefined }]);
    const out = toOpml(feeds.map((f) => ({ ...f, title: f.title ?? '' })));
    expect(parseOpml(out)).toEqual(feeds);
    expect(() => parseOpml('<html/>')).toThrow(/not an OPML/);
  });
});

describe('the clean article view', () => {
  const page = `<!doctype html><html><head><title>How to plant bulbs | Garden Notes</title>
    <meta property="og:site_name" content="Garden Notes"><meta name="author" content="Ada Gardener"><meta property="og:image" content="/hero.jpg">
    <script>track()</script><style>p{}</style></head><body>
    <header class="site-header"><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>
    <div class="layout"><aside class="sidebar"><p>Subscribe to our newsletter for more tips and tricks every week, it is free.</p></aside>
    <article class="post"><h1>How to plant bulbs</h1>
      <p>Autumn is the best time to plant spring bulbs, because the soil is still warm and roots can grow before winter comes.</p>
      <p>Dig a hole three times as deep as the bulb is tall, put the bulb in with the pointy end up, and cover it with soil.</p>
      <figure><img data-src="/img/tulips.jpg" alt="Tulips"><figcaption>Tulips in April</figcaption></figure>
      <p>Water them once, then leave them alone; rain does the rest. In spring you will see the first shoots appear, <a href="/next">read on</a>.</p>
      <div class="share-buttons"><a href="#">Share</a> <a href="#">Tweet</a></div>
      <p onclick="evil()">Mark where you planted them, so you do not dig them up by mistake when you plant something else later.</p>
    </article>
    <section class="comments"><p>Great post, thanks a lot, I will try this weekend with my kids in the garden!</p></section></div>
    <footer>© Garden Notes</footer></body></html>`;
  it('keeps the article and drops the rest', () => {
    const a = extractArticle(page, 'https://garden.example/2026/bulbs');
    expect(a).toMatchObject({ title: 'How to plant bulbs', byline: 'Ada Gardener', siteName: 'Garden Notes', image: 'https://garden.example/hero.jpg' });
    expect(a.html).toContain('Autumn is the best time');
    expect(a.html).toContain('<img src="https://garden.example/img/tulips.jpg" alt="Tulips">');
    expect(a.html).toContain('<a href="https://garden.example/next">read on</a>');
    expect(a.html).not.toMatch(/newsletter|Great post|Tweet|Home|track\(\)|onclick|<h1>/);
    expect(a.words).toBeGreaterThan(60);
    expect(readingMinutes(a.words)).toBe(1);
  });
  it('says so when a page has no article', () => {
    expect(() => extractArticle('<html><body><nav><a href="/">Home</a></nav><p>Hi</p></body></html>', 'https://x.example/')).toThrow(/No article/);
  });
});

describe('settings and ids', () => {
  it('keeps settings within limits and ids stable', () => {
    expect(normalizeReaderSettings({ refreshMinutes: 1, keepDays: 0 })).toEqual({ refreshMinutes: 15, keepDays: 30, fullText: true, images: true });
    expect(itemKey('feed1234', 'x')).toBe(itemKey('feed1234', 'x'));
    expect(itemKey('feed1234', 'x')).not.toBe(itemKey('feed1234', 'y'));
  });
});
