// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/drives.cjs /tmp/kd-home /tmp/kd-shots
// Drives the real Keeper app's "Open as a Drive" on a WebDAV connection, with a
// stand-in rclone (test/fixtures/fake-rclone.cjs) because the build machine has
// none: the drive is asked for in "Keeper Drives" with a WebDAV remote made on
// the spot (the password scrambled, never on disk), the page shows it as a
// drive and then "Sending 2 changes" from rclone's numbers, Close Drive lets it
// go and removes the empty folder, and an SFTP connection explains in one
// click why it stays inside Keeper. Light and dark at 1440×900.

const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const SERVER = HOME + '-server';
const BIN = HOME + '-bin';
for (const d of [SERVER, BIN]) fs.rmSync(d, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(path.join(SERVER, 'Projects'), { recursive: true });
fs.writeFileSync(path.join(SERVER, 'Projects', 'Plan.txt'), 'the plan\n');
fs.mkdirSync(BIN, { recursive: true });
fs.copyFileSync(path.join(__dirname, '../fixtures/fake-rclone.cjs'), path.join(BIN, 'rclone'));
fs.chmodSync(path.join(BIN, 'rclone'), 0o755);
const LOG = path.join(BIN, 'calls.jsonl');
const QUEUE = path.join(BIN, 'queue');
fs.writeFileSync(QUEUE, '0');

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

(async () => {
  const dav = await require('../servers/webdav-server.cjs').start(SERVER);
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', KEEPER_RCLONE: path.join(BIN, 'rclone'), KEEPER_FAKE_RCLONE_LOG: LOG, KEEPER_FAKE_RCLONE_QUEUE: QUEUE, XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const x = w.url(); return x && (!x.includes('view=') || x.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  // The sidebar as a rail: pictures show demo data only, never this computer's own place names.
  await main.keyboard.press('Control+Alt+KeyS').catch(() => undefined);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const x = w.webContents.getURL(); if (!x.includes('view=') || x.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const shot = async (name) => {
    for (const dark of [false, true]) {
      await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
      await main.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await wait(700);
      await main.screenshot({ path: path.join(SHOTS, `${name}-${dark ? 'dark' : 'light'}.png`) });
    }
    await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));
  };

  try {
    // Off in Recommended and before; this test switches it on.
    check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'driveMount')?.on === false, 'drives are off until switched on');
    await main.evaluate(() => window.keeper.features.set('driveMount', true));
    await wait(300);
    const sup = await main.evaluate(() => window.keeper.remote.driveSupport());
    check(sup.ready && sup.mountType === 'mount', `this Linux computer can make drives (${sup.title}: ${sup.detail})`);

    const saved = await main.evaluate(([port, base]) => window.keeper.remote.save({ kind: 'webdav', name: 'Studio NAS', host: '127.0.0.1', port, root: base, user: 'ana', password: 'secret', secure: false, device: 'nas' }), [dav.port, dav.base]);
    const id = saved.connection.id;
    await navigate(`remote:${id}:/`);
    await main.waitForSelector('.folder-item:has-text("Projects")', { timeout: 15000 });
    await main.locator('[data-testid="drive-open"]').click();
    await main.waitForSelector('[data-testid="drive-on"]', { timeout: 20000 });
    const place = path.join(HOME, 'Keeper Drives', 'Studio NAS');
    const mount = calls().find((c) => c.method === 'mount/mount');
    check(!!mount && mount.params.mountPoint === place && fs.existsSync(place), `rclone was asked for a drive in Keeper Drives (${mount?.params.mountPoint})`);
    check(!!mount && /^:webdav,url="http:\/\/127\.0\.0\.1:\d+\/remote\.php\/dav\/files\/ana",user=ana,pass=obsc-[0-9a-f]+,vendor=nextcloud:$/.test(mount.params.fs), `with a WebDAV remote made on the spot (${mount?.params.fs})`);
    check(!!mount && mount.params.mountType === 'mount' && mount.params.vfsOpt.CacheMode === 'full' && mount.params.vfsOpt.CacheMaxSize === '5G', 'keeping opened files, within 5 GB');
    const small = (f) => { try { const st = fs.lstatSync(path.join(HOME, f)); return st.isFile() && st.size < 1e6; } catch { return false; } };
    const onDisk = fs.readdirSync(HOME, { recursive: true }).filter((f) => !f.includes('Cache') && small(f)).some((f) => fs.readFileSync(path.join(HOME, f)).includes('secret'));
    check(!onDisk, 'the password was not written to disk');
    check(/Up to date/.test(await main.locator('[data-testid="drive-state"]').innerText()), 'the page says the drive is up to date');

    // rclone reports two changes waiting to go: the page follows (it reads the numbers every 10 s).
    fs.writeFileSync(QUEUE, '2');
    const sending = await until(async () => /Sending 2 changes/.test(await main.locator('[data-testid="drive-state"]').innerText()), 30000);
    check(!!sending, 'then “Sending 2 changes” from rclone’s numbers');
    await shot('gapsfiles-drive');
    fs.writeFileSync(QUEUE, '0');

    // Remembered, to open again at the next start.
    const conn = (await main.evaluate(() => window.keeper.remote.list())).connections.find((c) => c.id === id);
    check(conn?.driveOpen === true, 'the drive is remembered for next time');

    await main.locator('[data-testid="drive-close"]').click();
    await main.waitForSelector('[data-testid="drive-open"]', { timeout: 20000 });
    check(calls().some((c) => c.method === 'mount/unmount' && c.params.mountPoint === place), 'Close Drive lets it go');
    check(!fs.existsSync(place), 'and removes the empty folder');

    // An SFTP server: one click says why it stays inside Keeper.
    const sftp = await main.evaluate(() => window.keeper.remote.save({ kind: 'sftp', name: 'Old server', host: '127.0.0.1', port: 9, user: 'ana', password: 'x' }));
    await navigate(`remote:${sftp.connection.id}:/`);
    await main.waitForSelector('[data-testid="drive-open"]', { timeout: 15000 });
    await main.locator('[data-testid="drive-open"]').click();
    await main.waitForSelector('[data-testid="drive-why"]', { timeout: 5000 });
    check(/SFTP/.test(await main.locator('[data-testid="drive-why"]').innerText()), 'an SFTP connection explains why it is not a drive');
    await shot('gapsfiles-drive-why');
    await main.getByRole('button', { name: 'OK' }).click();
  } catch (e) {
    console.log('FAIL', e.message);
    failed++;
    await main.screenshot({ path: path.join(SHOTS, 'drives-error.png') }).catch(() => undefined);
  }
  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  await dav.close();
  for (const d of [SERVER, BIN]) fs.rmSync(d, { recursive: true, force: true });
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})();
