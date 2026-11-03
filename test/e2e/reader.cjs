// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/reader.cjs /tmp/krd-home /tmp/krd-shots
// Drives the real Keeper app's reader against a small web server on this
// computer: following a site finds its feed; unread counts; a summary-only
// item opens as the whole article from its page; the article is kept and
// reads again with the server gone (offline); a page saved for later; OPML
// export and import; only the added addresses are requested. Light and dark.

const { _electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }

const para = (s) => `<p>${s}</p>`;
const longText = [
  'Autumn is the best time to plant spring bulbs, because the soil is still warm and the roots have time to grow before the ground freezes.',
  'Dig a hole about three times as deep as the bulb is tall, set it in with the pointed end facing up, and cover it with loose soil.',
  'Water once after planting and then leave them alone; winter rain and snow give them everything they need until the first shoots appear.',
  'Mark where you planted each group, so that you do not dig them up by mistake when you plant something else in the same bed next summer.',
].map(para).join('');

(async () => {
  const asked = [];
  let up = true;
  const server = http.createServer((req, res) => {
    asked.push(req.url);
    if (!up) { res.destroy(); return; }
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (type, body) => { res.writeHead(200, { 'content-type': `${type}; charset=utf-8` }); res.end(body); };
    if (req.url === '/') return send('text/html', `<html><head><title>Garden Notes</title><link rel="alternate" type="application/rss+xml" title="Garden Notes" href="/feed.xml"></head><body><p>Welcome</p></body></html>`);
    if (req.url === '/feed.xml') return send('application/rss+xml', `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Garden Notes</title><link>${base}/</link>
      <item><title>How to plant bulbs before the frost</title><link>${base}/bulbs</link><guid>bulbs</guid><pubDate>${new Date(Date.now() - 3600_000).toUTCString()}</pubDate><description>A short note on bulbs.</description></item>
      <item><title>The compost heap, a year on</title><link>${base}/compost</link><guid>compost</guid><pubDate>${new Date(Date.now() - 86_400_000).toUTCString()}</pubDate><content:encoded><![CDATA[${longText.replace(/bulbs/g, 'kitchen scraps')}<p>Keep it moist, turn it now and then, and it will be ready by spring.</p>]]></content:encoded></item>
      </channel></rss>`);
    if (req.url === '/bulbs') return send('text/html', `<html><head><title>How to plant bulbs | Garden Notes</title><meta name="author" content="Ada Gardener"></head><body><nav><a href="/">Home</a></nav><article class="post"><h1>How to plant bulbs before the frost</h1>${longText}<figure><img src="/tulips.svg" alt="Tulips" width="600" height="300"><figcaption>Tulips in April</figcaption></figure></article><aside class="sidebar"><p>Subscribe to the newsletter for weekly tips, it is completely free of charge.</p></aside></body></html>`);
    if (req.url === '/tulips.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#7ab36b"/><circle cx="200" cy="140" r="50" fill="#e0457b"/><circle cx="380" cy="150" r="50" fill="#f2b45c"/></svg>'); }
    if (req.url === '/essay') return send('text/html', `<html><head><title>Designing calm software</title><meta property="og:site_name" content="Essays"></head><body><main><article><h1>Designing calm software</h1>${[1, 2, 3, 4].map((i) => para(`Calm software does less and says so plainly, part ${i}: it respects your attention, keeps your data where you put it, and stays out of the way until you need it again.`)).join('')}</article></main></body></html>`);
    if (req.url === '/atom.xml') return send('application/atom+xml', `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Code Log</title><link href="${base}/code"/><entry><title>Release 2.0</title><link href="${base}/code/r2"/><id>r2</id><updated>${new Date().toISOString()}</updated><content type="html">&lt;p&gt;Faster builds and a cache that survives restarts. ${'More words here. '.repeat(40)}&lt;/p&gt;</content></entry></feed>`);
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', KEEPER_READER_TEST: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const k = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.reader[f](...args), [fn, a]);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(700); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

  check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'reader')?.on === false, 'the reader is off until switched on');
  await main.evaluate(() => window.keeper.features.set('reader', true));
  await wait(400);
  check(asked.length === 0, 'switching it on fetches nothing');
  await navigate('reader');
  await main.waitForSelector('[data-testid="reader-page"]', { timeout: 15000 });

  // Following a site: its feed is found.
  await main.locator('[data-testid="rd-add-input"]').fill(`${base}/`);
  await main.locator('[data-testid="rd-add-input"]').press('Enter');
  check(!!(await until(async () => (await main.locator('[data-testid="rd-items"] .rd-item').count()) === 2)), 'following the site lists its two articles');
  let ov = await k('overview');
  check(ov.feeds.length === 1 && ov.feeds[0].url === `${base}/feed.xml` && ov.feeds[0].title === 'Garden Notes' && ov.counts.unread === 2, 'its feed was found in the page, with 2 unread');

  // A summary-only item opens as the whole article from its page.
  await main.locator('.rd-item:has-text("How to plant bulbs")').click();
  check(!!(await until(async () => /three times as deep/.test(await main.locator('[data-testid="rd-body"]').innerText()))), 'a summary-only article opens whole, from its page');
  const body = await main.locator('[data-testid="rd-body"]').innerText();
  check(!/newsletter|Home/.test(body) && /Ada Gardener/.test(body) && /min read/.test(body), 'the clean view leaves out the page’s menus and sidebar and names the author');
  check(await main.locator('.rd-content img').count() === 1, 'the article’s picture is shown');
  ov = await k('overview');
  check(ov.counts.unread === 1, 'opening it marks it read');
  await shot('reader-light');

  // Read later.
  const later = await k('saveForLater', `${base}/essay`);
  check(later.later && later.title === 'Designing calm software' && later.source === 'Essays', 'a page saved for later is kept as a clean article');

  // OPML out and in.
  const ex = await k('exportOpml');
  const opml = ex.saved ? fs.readFileSync(ex.path, 'utf8') : '';
  check(opml.includes(`xmlUrl="${base}/feed.xml"`), 'OPML export lists the feed');
  const im = await k('importOpml', `<?xml version="1.0"?><opml version="2.0"><body><outline text="Work"><outline type="rss" text="Code Log" xmlUrl="${base}/atom.xml"/></outline><outline type="rss" text="Garden" xmlUrl="${base}/feed.xml"/></body></opml>`);
  check(im.added === 1 && im.skipped === 1, 'OPML import adds new feeds and skips ones already there');
  check(!!(await until(async () => (await k('items', { view: 'all' })).some((i) => i.title === 'Release 2.0'))), 'an imported feed is read (Atom)');
  check((await k('overview')).folders.includes('Work'), 'its folder comes along');

  // Offline: the server goes away; articles still read.
  up = false;
  const offline = await k('article', (await k('items', { view: 'all' })).find((i) => /bulbs/.test(i.title)).key);
  check(/three times as deep/.test(offline.html), 'with the site gone, the kept article still reads (offline)');
  const savedLater = await k('article', later.key);
  check(/Calm software does less/.test(savedLater.html), 'the page saved for later reads offline too');

  const paths = [...new Set(asked)].sort();
  check(paths.every((p) => ['/', '/feed.xml', '/bulbs', '/tulips.svg', '/essay', '/atom.xml', '/compost'].includes(p)), `only the added addresses (and the article’s picture) were requested: ${paths.join(' ')}`);

  // Read later view and dark.
  await main.locator('.rd-src:has-text("Read later")').click();
  await main.locator('.rd-item:has-text("Designing calm software")').click();
  await wait(600);
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await shot('reader-dark');

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  server.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
