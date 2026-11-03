// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Makes the website's social preview images (1200 × 630, one per page) from Keeper's real
// screenshots: each card is a small HTML page rendered and photographed with Playwright's
// Chromium. Run by hand when a page or a screenshot changes; the pictures are committed in
// site/assets/og and the website build only copies them.
//
//   NODE_PATH=<a folder with playwright> node site/og/make.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(SITE, '..');
const OUT = path.join(SITE, 'assets/og');
const { chromium } = createRequire(import.meta.url)('playwright');

const data = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
const shot = (name) => data(path.join(ROOT, 'docs/screenshots', `${name}.webp`), 'image/webp');
const owl = data(path.join(ROOT, 'public/favicon.svg'), 'image/svg+xml');
const mono = data(path.join(SITE, 'assets/monorail/icon.webp'), 'image/webp');

/** name: [headline, line, main screenshot, the Island on top?, extra logo] */
const CARDS = {
  home: ['One install.<br><em>A whole suite.</em>', 'Free on Mac, Windows and Linux.', 'home-dark', true],
  features: ['Every part.<br><em>Your choice.</em>', 'Switch on only what you need.', 'features-dark', false],
  download: ['Get Keeper.<br><em>Free.</em>', 'macOS, Windows and Linux.', 'home-light', true],
  monorail: ['Keeper<br><em>+ Monorail</em>', 'Two Mac apps. One calm Mac.', 'home-dark', true, mono],
  privacy: ['Your files<br><em>stay yours.</em>', 'Nothing leaves unless you say so.', 'privacy-dark', false],
  support: ['Help and<br><em>security.</em>', 'Questions, reports and the license.', 'home-light', false],
  changelog: ['What’s new<br><em>in Keeper.</em>', 'Every version, newest first.', 'home-dark', false],
};

const page = ([title, line, main, island, extra]) => `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing:border-box; margin:0; }
body { width:1200px; height:630px; overflow:hidden; font-family:-apple-system, "SF Pro Display", "Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif; color:#fff;
  background:radial-gradient(circle at 12% 18%, rgba(255,180,94,.55), transparent 42%), linear-gradient(135deg, #1E1047, #4B23B8 55%, #B03274); }
.text { position:absolute; left:64px; top:70px; width:470px; }
.brand { display:flex; align-items:center; gap:14px; font-size:26px; font-weight:700; }
.brand img { width:54px; height:54px; }
.brand small { font-weight:500; opacity:.8; font-size:20px; }
h1 { margin-top:56px; font-size:68px; line-height:1.02; letter-spacing:-2px; }
h1 em { font-style:normal; color:#FFC98F; }
p { margin-top:22px; font-size:27px; opacity:.88; }
.extra { position:absolute; left:64px; bottom:60px; display:flex; gap:12px; align-items:center; }
.extra img { width:64px; height:64px; border-radius:16px; }
.laptop { position:absolute; left:560px; top:120px; width:760px; }
.lid { padding:12px 12px 0; background:#16151c; border:2px solid #4a4752; border-bottom:0; border-radius:22px 22px 0 0; box-shadow:0 30px 80px rgba(0,0,0,.45); }
.screen { aspect-ratio:16/10; overflow:hidden; border-radius:8px 8px 0 0; position:relative; }
.screen > img { width:100%; height:100%; object-fit:cover; object-position:top left; display:block; }
.base { height:18px; margin:0 -40px; background:linear-gradient(#dedde3, #a9a7b1); border-radius:0 0 50% 50% / 0 0 100% 100%; }
.isl { position:absolute; top:0; left:50%; transform:translateX(-50%); width:44%; aspect-ratio:640/338; overflow:hidden; border-radius:0 0 22px 22px; box-shadow:0 14px 26px rgba(0,0,0,.5); }
.isl img { width:140.625%; margin-left:-20.3125%; display:block; }
</style></head><body>
<div class="text"><div class="brand"><img src="${owl}" alt=""><span>Keeper <small>by Ashforde®</small></span></div><h1>${title}</h1><p>${line}</p></div>
${extra ? `<div class="extra"><img src="${owl}" alt=""><img src="${extra}" alt=""></div>` : ''}
<div class="laptop"><div class="lid"><div class="screen"><img src="${shot(main)}" alt="">${island ? `<div class="isl"><img src="${shot('island-expanded-dark')}" alt=""></div>` : ''}</div></div><div class="base"></div></div>
</body></html>`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const [name, card] of Object.entries(CARDS)) {
  await tab.setContent(page(card), { waitUntil: 'load' });
  const jpg = await tab.screenshot({ type: 'jpeg', quality: 86 });
  writeFileSync(path.join(OUT, `${name}.jpg`), jpg);
  console.log(`site/assets/og/${name}.jpg ${Math.round(jpg.length / 1024)} KB`);
}
await browser.close();
