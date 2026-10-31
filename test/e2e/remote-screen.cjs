// SPDX-License-Identifier: AGPL-3.0-or-later
// Usage (Linux): xvfb-run -a -s "-screen 0 1600x900x24" node test/e2e/remote-screen.cjs /tmp/kscreen /tmp/kscreen-shots
// Two real Keeper apps on one computer (separate homes), paired over Keeper Link.
// The laptop asks to control the desk's screen; the desk is asked and allows it;
// the picture arrives (directly over WebRTC, then again as frames through Link),
// it changes when the desk's screen changes, the laptop's pointer and clicks
// drive the desk (XTest), and Stop sharing ends it on both sides. Then a phone
// (an emulated iPhone browser on the companion page) watches and taps.
const { _electron, chromium, devices } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const SHOTS = process.argv[3];
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const homes = { a: path.join(ROOT, 'desk'), b: path.join(ROOT, 'laptop') };
for (const h of Object.values(homes)) for (const d of ['Documents', 'Downloads', 'Pictures', 'Desktop', 'Videos']) fs.mkdirSync(path.join(h, d), { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() - t0 > ms) return undefined;
    await wait(200);
  }
}
const mouse = () => {
  const out = execFileSync('xdotool', ['getmouselocation', '--shell'], { encoding: 'utf8' });
  return { x: Number(out.match(/X=(\d+)/)[1]), y: Number(out.match(/Y=(\d+)/)[1]) };
};
const screenSize = () => {
  const out = execFileSync('xdotool', ['getdisplaygeometry'], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
  return { w: out[0], h: out[1] };
};

async function launch(home) {
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, HOME: home, NODE_OPTIONS: '', XDG_CONFIG_HOME: home + '/.config', XDG_DATA_HOME: home + '/.local/share' } });
  let main;
  for (let i = 0; i < 160 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await wait(500);
  }
  if (!main) throw new Error('no main window');
  const errors = [];
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.waitForTimeout(2500);
  return { app, main, errors };
}

const api = (w, fn, ...args) => w.evaluate(([f, a]) => {
  const p = f.split('.');
  let o = window.keeper;
  for (const k of p.slice(0, -1)) o = o[k];
  return o[p[p.length - 1]](...a);
}, [fn, args]);

/** Places a window of an app (by URL part) on the shared X screen. */
const place = (A, urlPart, b) => A.app.evaluate(({ BrowserWindow }, [u, bounds]) => {
  const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(u));
  if (w) { w.setBounds(bounds); w.show(); }
  return !!w;
}, [urlPart, b]);

/** Average brightness (0..255) of a part of the picture the viewer shows, in 0..1 picture coordinates. */
const brightness = (viewer, r) => viewer.evaluate((r) => {
  const v = document.querySelector('[data-testid=viewer-video]');
  const c = document.querySelector('[data-testid=viewer-canvas]');
  const src = v && v.style.display !== 'none' && v.videoWidth ? v : c;
  const w = src.videoWidth || src.width;
  const h = src.videoHeight || src.height;
  if (!w || !h) return -1;
  const k = document.createElement('canvas');
  k.width = w; k.height = h;
  const g = k.getContext('2d');
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(Math.round(r.x * w), Math.round(r.y * h), Math.max(1, Math.round(r.w * w)), Math.max(1, Math.round(r.h * h))).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return s / (d.length / 4);
}, r);

async function pair(A, B) {
  const inv = await api(A.main, 'link.invite');
  const sa = await api(A.main, 'link.state');
  const pairing = api(B.main, 'link.pair', { address: `127.0.0.1:${sa.me.port}`, code: inv.code }).catch((e) => console.log('pair error', e.message));
  const pa = await until(async () => (await api(A.main, 'link.pending')).pairs[0], 15000);
  const pb = await until(async () => (await api(B.main, 'link.pending')).pairs[0], 15000);
  if (pa) await api(A.main, 'link.confirmPair', pa.id, true);
  if (pb) await api(B.main, 'link.confirmPair', pb.id, true);
  await pairing;
  return until(async () => (await api(A.main, 'link.state')).devices.length === 1 && (await api(B.main, 'link.state')).devices.length === 1, 15000);
}

(async () => {
  const { w: SW, h: SH } = screenSize();
  const A = await launch(homes.a); // the desk: its screen is shared
  const B = await launch(homes.b); // the laptop: watches and controls
  // Room on the one X screen for both: the desk's window on the left, the viewer on the right.
  await place(A, 'view=app', { x: 0, y: 70, width: 760, height: 560 });
  await place(B, 'view=app', { x: 820, y: 70, width: 700, height: 500 });

  check(!!(await pair(A, B)), 'the two apps are paired over Keeper Link');
  const deskId = (await api(B.main, 'link.state')).devices[0].id;
  const laptopId = (await api(A.main, 'link.state')).devices[0].id;

  // ---- refused until the desk allows it
  const refusedSid = await api(B.main, 'screen.view', deskId, { control: true });
  const refusedViewer = await until(async () => B.app.windows().find((w) => w.url().includes('view=screenviewer')), 10000);
  const refusedMsg = await until(async () => refusedViewer && (await refusedViewer.locator('[data-testid=viewer-ended]').innerText()), 10000);
  check(!!refusedMsg && /does not let/.test(refusedMsg), `without “See this screen” the desk refuses (${(refusedMsg || '').replace(/\s+/g, ' ').slice(0, 90)})`);
  await refusedViewer?.close().catch(() => undefined);
  void refusedSid;

  await api(A.main, 'link.setPermissions', laptopId, { sendFiles: true, screenView: true, screenControl: true });
  const ctl = await api(A.main, 'screen.control');
  check(ctl.available, `this computer can be controlled (XTest): ${JSON.stringify(ctl)}`);

  // ---- ask, allow, picture
  const sid = await api(B.main, 'screen.view', deskId, { control: true });
  const asked = await until(async () => (await A.main.locator('[data-testid=screen-ask]').count()) > 0, 15000);
  check(!!asked, 'the desk asks “Laptop wants to control this screen”');
  await A.main.screenshot({ path: `${SHOTS}/ask-light.png` });
  if (asked) await A.main.getByRole('button', { name: 'Allow Control' }).click();
  const banner = await until(async () => A.app.windows().find((w) => w.url().includes('view=screenhost')), 10000);
  const bannerText = banner && await until(async () => { const t = await banner.locator('.screen-banner').innerText(); return /controlling this screen/.test(t) ? t : ''; }, 8000);
  check(!!bannerText, `a banner on the desk says so: “${(bannerText || '').replace(/\s+/g, ' ').trim()}”`);
  const viewer = await until(async () => B.app.windows().find((w) => w.url().includes(`sid=${sid}`)), 10000);
  check(!!viewer, 'the laptop opens a viewer window');
  const viewerErrors = [];
  viewer.on('pageerror', (e) => viewerErrors.push(e.message));
  await place(B, `sid=${sid}`, { x: 800, y: 60, width: 790, height: 560 });
  const p2p = await until(async () => viewer.evaluate(() => {
    const v = document.querySelector('[data-testid=viewer-video]');
    return v && v.style.display !== 'none' && v.videoWidth > 0 ? `${v.videoWidth}×${v.videoHeight}` : '';
  }), 20000);
  check(!!p2p, `the picture arrives over a direct WebRTC connection (${p2p})`);
  const meta = await viewer.locator('.viewer-meta').innerText().catch(() => '');
  check(/Direct/.test(meta), `the viewer shows the path: ${meta}`);
  await wait(1500);
  await viewer.screenshot({ path: `${SHOTS}/viewer-p2p.png` });

  // ---- the picture follows the desk's screen: switch the desk window light/dark and watch that region
  const region = { x: 60 / SW, y: 150 / SH, w: 600 / SW, h: 400 / SH };
  await A.main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));
  await wait(1500);
  const light = await brightness(viewer, region);
  await A.main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await wait(2000);
  const dark = await brightness(viewer, region);
  check(light > 0 && dark >= 0 && light - dark > 40, `the viewer’s picture changes with the desk’s screen (brightness ${Math.round(light)} → ${Math.round(dark)})`);
  await A.main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));

  // ---- control: the laptop's pointer moves the desk's pointer (one X server, so xdotool sees it)
  const vbox = await viewer.locator('[data-testid=viewer-video]').boundingBox();
  const vw = await viewer.evaluate(() => [document.querySelector('[data-testid=viewer-video]').videoWidth, document.querySelector('[data-testid=viewer-video]').videoHeight]);
  const toViewer = (nx, ny) => {
    const s = Math.min(vbox.width / vw[0], vbox.height / vw[1]);
    const w = vw[0] * s, h = vw[1] * s;
    return { x: vbox.x + (vbox.width - w) / 2 + nx * w, y: vbox.y + (vbox.height - h) / 2 + ny * h };
  };
  const target = toViewer(0.25, 0.4);
  await viewer.mouse.move(target.x, target.y);
  await viewer.mouse.move(target.x + 1, target.y + 1);
  const moved = await until(async () => {
    const m = mouse();
    return Math.abs(m.x - 0.25 * SW) < 12 && Math.abs(m.y - 0.4 * SH) < 12 ? m : null;
  }, 5000);
  check(!!moved, `moving over the picture moves the desk’s pointer (desk pointer at ${JSON.stringify(mouse())}, expected ≈ ${Math.round(0.25 * SW)},${Math.round(0.4 * SH)})`);

  // Click a sidebar item in the desk's window through the picture (one near the top, so it is on screen).
  const nav = await A.main.locator('.nav-item[title="Recents"]').first().boundingBox();
  const deskWin = await A.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=app')).getContentBounds());
  const nx = (deskWin.x + nav.x + nav.width / 2) / SW;
  const ny = (deskWin.y + nav.y + nav.height / 2) / SH;
  // Both apps share one X display here, and a (synthetic) press inside the viewer window makes Chromium grab
  // that display's pointer, which would swallow the injected click — so the clicks go in through the viewer's
  // own input path (the same message its pointer handlers send). As with a real mouse, the first click on the
  // desk's inactive window only brings it forward; the second one lands.
  for (let n = 0; n < 2; n++) {
    await viewer.evaluate(([sid, x, y]) => window.keeper.screen.input(sid, [{ t: 'move', x, y }, { t: 'down', x, y, button: 0 }, { t: 'up', x, y, button: 0 }]), [sid, nx, ny]);
    await wait(700);
  }
  const clicked = await until(async () => (await A.main.locator('.nav-item.active').first().getAttribute('title')) === 'Recents', 6000);
  check(!!clicked, 'a click from the viewer clicks on the desk (it opened Recents)');

  // ---- stop sharing from the desk's banner
  await banner.locator('.screen-banner-stop').click();
  const endedV = await until(async () => viewer.locator('[data-testid=viewer-ended]').innerText(), 8000);
  check(!!endedV, `Stop sharing ends the session on the laptop too (“${(endedV || '').replace(/\s+/g, ' ').slice(0, 60)}”)`);
  const logA = (await api(A.main, 'screen.state')).log;
  check(logA.some((l) => /controlled this screen/.test(l.title)), `the desk keeps a record: “${logA[0]?.title}”`);
  await viewer.close().catch(() => undefined);

  // ---- the fallback: frames through the Link channel
  await api(A.main, 'screen.setPolicy', { unattended: { [laptopId]: true } });
  const sid2 = await api(B.main, 'screen.view', deskId, { control: false, prefer: 'frames' });
  const v2 = await until(async () => B.app.windows().find((w) => w.url().includes(`sid=${sid2}`)), 10000);
  await place(B, `sid=${sid2}`, { x: 800, y: 60, width: 790, height: 560 });
  check((await A.main.locator('[data-testid=screen-ask]').count()) === 0, 'with “Let it in without asking” the desk does not ask again');
  const framesOk = await until(async () => v2.evaluate(() => {
    const c = document.querySelector('[data-testid=viewer-canvas]');
    return c && c.style.display !== 'none' && c.width > 0 ? `${c.width}×${c.height}` : '';
  }), 20000);
  check(!!framesOk, `frames through Keeper Link arrive when a direct connection is not used (${framesOk})`);
  await wait(2500);
  const fps = await v2.locator('.viewer-meta').innerText();
  check(/Keeper Link/.test(fps) && /[1-9]\d* fps/.test(fps), `the Link picture keeps coming: ${fps}`);
  await v2.screenshot({ path: `${SHOTS}/viewer-frames.png` });
  const banner2 = A.app.windows().find((w) => w.url().includes('view=screenhost'));
  if (banner2) await banner2.screenshot({ path: `${SHOTS}/banner.png` }).catch(() => undefined);
  await api(B.main, 'screen.stop', sid2);
  await wait(800);
  check(!A.app.windows().some((w) => w.url().includes('view=screenhost')), 'ending from the laptop closes the desk’s banner');
  await v2.close().catch(() => undefined);

  // ---- a phone watches and taps
  const inv = await api(A.main, 'link.companionInvite', false);
  const port = (await api(A.main, 'link.state')).me.port;
  const url = inv.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${port}`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const phone = await ctx.newPage();
  const phoneErrors = [];
  phone.on('pageerror', (e) => phoneErrors.push(e.message));
  await phone.goto(url);
  const allowPhone = await until(async () => (await A.main.getByText('Allow this phone?').count()) > 0, 10000);
  if (allowPhone) await A.main.getByRole('button', { name: 'Allow', exact: true }).click();
  const phoneOn = await until(async () => (await phone.locator('#status').innerText()).includes('Connected'), 15000);
  check(!!phoneOn, `the phone is paired and connected (${await phone.locator('#status').innerText()} / ${await phone.locator('#msg').innerText()})`);
  if (!phoneOn) await A.main.screenshot({ path: `${SHOTS}/debug-phone-allow.png` });
  await phone.locator('nav button[data-tab=screen]').click();
  await phone.locator('#screen-control').click();
  const askPhone = await until(async () => (await A.main.locator('[data-testid=screen-ask]').count()) > 0, 10000);
  check(!!askPhone, 'the desk asks before the phone may see it');
  if (askPhone) await A.main.getByRole('button', { name: 'Allow Control' }).click();
  const phonePic = await until(async () => phone.evaluate(() => {
    const i = document.getElementById('scr');
    return i && i.naturalWidth > 0 ? `${i.naturalWidth}×${i.naturalHeight}` : '';
  }), 15000);
  check(!!phonePic, `the phone shows the desk’s screen (${phonePic})`);
  const img = await phone.locator('#scr').boundingBox();
  await phone.touchscreen.tap(img.x + img.width * 0.75, img.y + img.height * 0.2);
  const tapped = await until(async () => {
    const m = mouse();
    return Math.abs(m.x - 0.75 * SW) < 20 && Math.abs(m.y - 0.2 * SH) < 20 ? m : null;
  }, 6000);
  check(!!tapped, `a tap on the phone clicks there on the desk (pointer ${JSON.stringify(mouse())})`);
  await phone.screenshot({ path: `${SHOTS}/phone-screen.png` });
  await phone.locator('#screen-stop').click();
  await wait(600);
  check(!A.app.windows().some((w) => w.url().includes('view=screenhost')), 'the phone stopping removes the desk’s banner');

  // ---- screenshots of the new parts of the main window
  for (const dark of [false, true]) {
    for (const X of [A, B]) {
      await X.main.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await X.main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
    }
    await A.main.evaluate((id) => window.keeper.settings.get().then(() => window.location.hash = id), laptopId).catch(() => undefined);
    await A.main.locator('.nav-item[title="Pair a device, phones, remote access"]').click().catch(() => undefined);
    await A.main.locator(`.nav-item.link-side`).first().click().catch(() => undefined);
    await wait(700);
    await A.main.locator('[data-testid=device-screen]').scrollIntoViewIfNeeded().catch(() => undefined);
    await A.main.screenshot({ path: `${SHOTS}/device-screen-${dark ? 'dark' : 'light'}.png` });
    await A.main.getByRole('button', { name: 'Phone', exact: true }).click().catch(() => undefined);
    await wait(500);
    await A.main.locator('[data-testid=android-card]').scrollIntoViewIfNeeded().catch(() => undefined);
    await A.main.screenshot({ path: `${SHOTS}/phones-${dark ? 'dark' : 'light'}.png` });
  }

  check(!A.errors.length && !B.errors.length && !viewerErrors.length && !phoneErrors.length, `no page errors ${JSON.stringify([...A.errors, ...B.errors, ...viewerErrors, ...phoneErrors])}`);
  await browser.close();
  await A.app.close();
  await B.app.close();
  process.exit(process.exitCode ?? 0);
})().catch((e) => {
  console.log('FAIL', e.stack || e.message);
  process.exit(1);
});
