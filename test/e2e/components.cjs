// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI, after npm run build):
//   xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/components.cjs /tmp/kcomp /tmp/kcomp-shots
// Drives the real Keeper app as a core install would: ffmpeg is not inside, so it is
// served as a component from a local release (archive, manifest and SHA256SUMS.txt
// made by scripts/components.mjs from this checkout's ffmpeg). The Studio row in
// Settings → Features offers "Download …", the download is checked and installed,
// ffmpeg runs from the components folder, then "Free up space" removes it again.
const { _electron } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const HOME = path.resolve(process.argv[2] || '/tmp/kcomp');
const SHOTS = path.resolve(process.argv[3] || '/tmp/kcomp-shots');
const APP = path.resolve(__dirname, '../..');
const VERSION = require(path.join(APP, 'package.json')).version;
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => require('crypto').createHash('sha256').update(b).digest('hex');

(async () => {
  // ---- a release with one component, the way the release workflow makes it
  const { packComponents } = await import(pathToFileURL(path.join(APP, 'scripts', 'components.mjs')).href);
  const work = path.join(HOME, '.release');
  const staging = path.join(work, 'staging', 'ffmpeg');
  fs.mkdirSync(staging, { recursive: true });
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  fs.copyFileSync(path.join(APP, 'node_modules', 'ffmpeg-static', exe), path.join(staging, exe));
  fs.chmodSync(path.join(staging, exe), 0o755);
  const rel = path.join(work, `v${VERSION}`);
  const m = packComponents({ staging: path.join(work, 'staging'), platform: process.platform, arch: process.arch, version: VERSION, out: rel, log: () => undefined });
  fs.writeFileSync(path.join(rel, 'SHA256SUMS.txt'), fs.readdirSync(rel).map((f) => `${sha(fs.readFileSync(path.join(rel, f)))}  ${f}`).join('\n') + '\n');
  fs.rmSync(path.join(work, 'staging'), { recursive: true, force: true });
  const served = [];
  const server = http.createServer((req, res) => {
    const file = path.join(work, decodeURIComponent(req.url.split('?')[0]));
    served.push(path.basename(file));
    if (!file.startsWith(work) || !fs.existsSync(file)) return void res.writeHead(404).end();
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-length': body.length }).end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const feed = `http://127.0.0.1:${server.address().port}`;
  check(m.components.length === 1, `served ${m.components[0].file} (${(m.components[0].size / 1e6).toFixed(1)} MB) at ${feed}`);

  const env = {
    ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share',
    // A core install: no development copies, components only from the (local) release.
    KEEPER_COMPONENTS_DEV: '0', KEEPER_COMPONENTS_FEED: feed, KEEPER_COMPONENTS_DELAY_MS: '600000',
  };
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  let main;
  for (let i = 0; i < 80 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await wait(500);
  }
  check(!!main, 'Keeper opens');
  const errors = [];
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await main.getByRole('button', { name: /Skip tour/ }).click({ timeout: 3000 }).catch(() => undefined);
  await main.setViewportSize?.({ width: 1360, height: 900 }).catch(() => undefined);
  const k = (group, fn, ...a) => main.evaluate(([g, f, args]) => window.keeper[g][f](...args), [group, fn, a]);
  const ff = async () => (await k('components', 'list')).find((c) => c.id === 'ffmpeg');

  // ---- nothing downloaded at start (never during startup), and features know it
  let c = await ff();
  check(c.state === 'missing', `ffmpeg starts missing (state ${c.state})`);
  check(!served.length, 'nothing was downloaded while Keeper started');
  check((await k('convert', 'capabilities')).ffmpeg === false, 'Convert says video and audio need ffmpeg');
  const sized = (await k('components', 'sizes')).find((x) => x.id === 'ffmpeg');
  check(sized.estimate === false && sized.downloadSize === m.components[0].size, `exact size from the manifest: ${sized.downloadSize} bytes`);

  // ---- Settings → Features: the Studio row offers the download; click it
  await main.evaluate(() => { location.hash = ''; });
  await main.keyboard.press('Control+,').catch(() => undefined);
  if (!(await main.$('.features'))) await main.locator('.sidebar >> text=Settings').first().click().catch(() => undefined);
  await main.waitForSelector('.features', { timeout: 15_000 });
  const row = main.locator('.feature-row', { hasText: 'Studio' }).first();
  await row.scrollIntoViewIfNeeded();
  const btn = row.locator('[data-testid="component-ffmpeg"] button', { hasText: /Download Video and audio engine/ });
  const label = await btn.textContent({ timeout: 10_000 }).catch(() => '');
  check(/Download Video and audio engine \(ffmpeg\) \(\d+ MB\)/.test(label || ''), `Studio's row: “${(label || '').trim()}”`);
  await row.screenshot({ path: path.join(SHOTS, 'components-studio-row.png') }).catch(() => undefined);
  await btn.click();
  for (let i = 0; i < 120 && (c = await ff()).state !== 'installed'; i++) {
    if (i === 1) await row.screenshot({ path: path.join(SHOTS, 'components-downloading.png') }).catch(() => undefined);
    if (c.state === 'error') break;
    await wait(500);
  }
  check(c.state === 'installed', `downloaded, checked and installed (state ${c.state}${c.error ? `: ${c.error}` : ''})`);
  check(served.includes('SHA256SUMS.txt') && served.includes(`components-${process.platform}-${process.arch}.json`), 'the manifest was checked against SHA256SUMS.txt');
  check(c.sizeOnDisk > 10e6, `size on disk: ${(c.sizeOnDisk / 1e6).toFixed(0)} MB`);

  // ---- it is used: the feature's binary is the downloaded one, and it runs
  const ran = await k('components', 'check', 'ffmpeg');
  check(ran.ok && /ffmpeg version/.test(ran.output) && ran.source === 'installed' && ran.path.includes(path.join('components', 'ffmpeg', VERSION)), `ffmpeg -version from ${ran.path}: ${ran.output}`);
  check((await k('convert', 'capabilities')).ffmpeg === true, 'Convert now has video and audio');
  await main.waitForTimeout(500);
  const disk = await row.locator('.component-disk').textContent({ timeout: 5000 }).catch(() => '');
  check(/Downloaded: Video and audio engine \(ffmpeg\) \d+ MB/.test(disk || ''), `the row shows it on disk: “${disk}”`);
  await main.locator('[data-testid="components"]').screenshot({ path: path.join(SHOTS, 'components-section.png') }).catch(() => undefined);

  // ---- "Free up space"
  const comps = main.locator('[data-testid="components-row-ffmpeg"]');
  await comps.scrollIntoViewIfNeeded();
  await comps.getByRole('button', { name: 'Free up space' }).click();
  for (let i = 0; i < 20 && (c = await ff()).state !== 'missing'; i++) await wait(250);
  check(c.state === 'missing', 'Free up space removes it');
  check(!fs.existsSync(path.dirname(path.dirname(ran.path))) || !fs.existsSync(ran.path), 'its folder is gone');
  check((await k('convert', 'capabilities')).ffmpeg === false, 'and Convert knows');

  // ---- add-ons: Monorail is a Mac add-on, hidden here with a note
  const addons = await k('components', 'addons');
  const mono = addons.find((a) => a.id === 'monorail');
  check(process.platform === 'darwin' || (mono && mono.visible === false && /macOS/.test(mono.note)), `Monorail add-on off a Mac: ${mono?.note}`);

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  server.close();
  fs.rmSync(HOME, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
