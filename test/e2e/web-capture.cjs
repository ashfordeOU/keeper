// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/web-capture.cjs /tmp/kwc-home /tmp/kwc-shots
// Drives the real Keeper app's "Capture a web page" against a page served on
// this computer: a tall page with a fixed header, a cookie banner and a picture
// that only loads when scrolled to. Desktop PNG through the sheet (the banner's
// "Reject all" is pressed, the late picture is requested, the picture is as tall
// as the page and the header is not repeated), phone (twice the pixels), the
// 1200 × 630 social image, PDF, a bad address in plain words, Capture's history.

const { _electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }
const pngSize = (f) => { const b = fs.readFileSync(f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

const PAGE = `<!doctype html><html><head><title>Garden Journal</title><meta name="viewport" content="width=device-width">
<style>body{margin:0;font:18px sans-serif} header{position:fixed;top:0;left:0;right:0;height:60px;background:#2d6a4f;color:#fff;display:flex;align-items:center;padding:0 20px;z-index:5}
main{padding:80px 20px} section{height:900px;border-bottom:4px solid #95d5b2} .cookie-banner{position:fixed;bottom:0;left:0;right:0;background:#222;color:#fff;padding:20px;z-index:10}
img{display:block;width:300px;height:200px}</style></head><body>
<header>Garden Journal</header><main>${[1, 2, 3, 4, 5].map((i) => `<section><h2>Part ${i}</h2><p>Notes about the garden, part ${i}.</p></section>`).join('')}
<img id="late" alt="Tulips" data-src="/late.png"></main>
<div class="cookie-banner" id="cookie-consent"><p>We use cookies to make this site work.</p><button onclick="fetch('/choice?accept');this.parentNode.remove()">Accept all</button> <button onclick="fetch('/choice?reject');this.parentNode.remove()">Reject all</button></div>
<script>new IntersectionObserver((es)=>{for(const e of es) if(e.isIntersecting&&!e.target.src) e.target.src=e.target.dataset.src;}).observe(document.getElementById('late'));</script>
</body></html>`;
// A 2×2 green PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNgYGD4z8DAwMAAAA4AAf8rP5wAAAAASUVORK5CYII=', 'base64');

(async () => {
  const asked = [];
  const server = http.createServer((req, res) => {
    asked.push(req.url);
    if (req.url === '/' || req.url === '/garden') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
    if (req.url === '/late.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
    if (req.url.startsWith('/choice')) { res.writeHead(204); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => { await wait(700); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const dark = (on) => main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), on);
  const cap = (o) => main.evaluate((x) => window.keeper.capture.webPage({ device: 'desktop', format: 'png', banners: true, scroll: true, sharp: false, ...x }), o);

  await navigate('capture');
  await main.waitForSelector('[data-testid="capture-webpage"]', { timeout: 15000 });
  await main.locator('[data-testid="capture-webpage"]').click();
  await main.waitForSelector('[data-testid="wc-sheet"]');
  check(await main.locator('[data-testid="wc-go"]').isDisabled(), 'Capture waits for an address');
  await main.locator('[data-testid="wc-url"]').fill(`${base}/garden`);
  await shot('webcapture-sheet-light');
  await dark(true); await shot('webcapture-sheet-dark'); await dark(false);
  await main.locator('[data-testid="wc-go"]').click();
  const done = await until(() => main.locator('[data-testid="wc-done"]').isVisible(), 60000);
  check(!!done, 'the sheet shows the finished capture');
  const facts = done ? await main.locator('[data-testid="wc-facts"]').innerText() : '';
  check(/1440 × [\d,]+ pixels/.test(facts) && /Cookie banner closed/.test(facts), `it says what was made ("${facts}")`);
  check(asked.includes('/choice?reject') && !asked.includes('/choice?accept'), 'the cookie banner’s “Reject all” was pressed, not “Accept all”');
  check(asked.includes('/late.png'), 'scrolling through loaded the picture at the bottom');
  await shot('webcapture-done-light');
  await dark(true); await shot('webcapture-done-dark'); await dark(false);
  await main.keyboard.press('Escape');

  const shotsDir = path.join(HOME, 'Pictures', 'Screenshots');
  const files = () => (fs.existsSync(shotsDir) ? fs.readdirSync(shotsDir) : []);
  const desk = files().find((f) => /^Web page 127\.0\.0\.1 .*\.png$/.test(f));
  check(!!desk, `the PNG is in Screenshots (${desk})`);
  if (desk) {
    const s = pngSize(path.join(shotsDir, desk));
    check(s.w === 1440 && s.h > 4500 && s.h < 6000, `it is the whole page, 1440 wide and as tall as the page (${s.w} × ${s.h})`);
  }

  const phone = await cap({ url: `${base}/garden`, device: 'phone' });
  const ps = pngSize(phone.path);
  check(ps.w === 780 && phone.width === 390, `the phone picture is 390 wide at twice the pixels (${ps.w} × ${ps.h})`);
  const social = await cap({ url: `${base}/garden`, device: 'social' });
  const ss = pngSize(social.path);
  check(ss.w === 1200 && ss.h === 630, `the social image is 1200 × 630 (${ss.w} × ${ss.h})`);
  const pdf = await cap({ url: `${base}/garden`, format: 'pdf' });
  check(fs.readFileSync(pdf.path).subarray(0, 5).toString() === '%PDF-' && pdf.path.endsWith('.pdf'), 'the PDF is a PDF');
  const closed = http.createServer();
  await new Promise((r) => closed.listen(0, '127.0.0.1', r));
  const closedPort = closed.address().port;
  await new Promise((r) => closed.close(r));
  const bad = await main.evaluate((p) => window.keeper.capture.webPage({ url: `http://127.0.0.1:${p}/`, device: 'desktop', format: 'png', banners: true, scroll: true, sharp: false }).then(() => '', (e) => e.message), closedPort);
  check(/did not answer|could not|did not load/i.test(bad), `an address that does not answer is said plainly (${bad.replace(/^Error invoking[^:]+: (Error: )?/, '')})`);
  const js = await main.evaluate(() => window.keeper.capture.webPage({ url: 'javascript:alert(1)', device: 'desktop', format: 'png', banners: true, scroll: true, sharp: false }).then(() => '', (e) => e.message));
  check(/Only web pages/.test(js), 'only web pages can be captured');

  const hist = await main.evaluate(() => window.keeper.capture.history());
  check(hist.filter((h) => h.kind === 'webpage').length === 4 && hist.find((h) => h.kind === 'webpage').value.includes('Garden Journal'), 'each capture is in Capture’s history as a web page with its title');
  await main.locator('.seg button', { hasText: 'Screenshots & more' }).click();
  await shot('webcapture-history-light');

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await app.close();
  server.close();
  console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
