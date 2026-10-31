// SPDX-License-Identifier: AGPL-3.0-or-later
// Usage (Linux): xvfb-run -a node test/e2e/sync.cjs <scratch dir> <screenshots dir>
// Two real Keeper apps on this computer, each with its own home folder, pair
// over Keeper Link (through the windows, with the code and the six-digit check),
// allow each other to sync, and sync a folder over Link; then one of them backs
// the folder up to a "drive", restores it, and the keeper command restores it
// again without the app.
const { _electron } = require('playwright');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SCRATCH = path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kp-sync-'));
const SHOTS = path.resolve(process.argv[3] || SCRATCH);
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 45_000, step = 500) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* keep trying */ }
    if (Date.now() > end) return null;
    await sleep(step);
  }
}
const old = (p) => { const t = new Date(Date.now() - 10_000); fs.utimesSync(p, t, t); };

function home(name) {
  const h = path.join(SCRATCH, name);
  for (const d of ['Documents', 'Downloads', 'Desktop', 'Shared']) fs.mkdirSync(path.join(h, d), { recursive: true });
  return h;
}

async function launch(name) {
  const HOME = home(name);
  const env = { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' };
  delete env.KEEPER_SYNC_LOOPBACK;
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env });
  let win;
  for (let i = 0; i < 160 && !win; i++) {
    win = app.windows().find((w) => w.url().includes('view=app'));
    if (!win) await sleep(500);
  }
  if (!win) throw new Error('no main window');
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1280, height: 860 }).catch(() => undefined);
  await win.waitForSelector('.sidebar', { timeout: 60_000 });
  // Folder sync and Link are off by default in Settings → Features.
  await win.evaluate(() => window.keeper.settings.get().then((s) => window.keeper.settings.set({ features: { ...(s.features ?? {}), link: true, sync: true } })));
  return { app, win, HOME, env, errors };
}

(async () => {
  const A = await launch('A');
  const B = await launch('B');

  // ---- pair over Keeper Link, through the windows
  const sa = await A.win.evaluate(() => window.keeper.link.state());
  const openDevices = async (w) => { await w.locator('.nav-item[title="Pair a device, phones, remote access"]').click(); await sleep(500); };
  await openDevices(A.win);
  await A.win.locator('.content').getByRole('button', { name: 'Pair a Device' }).first().click();
  const code = await until(async () => (await A.win.locator('[data-testid=link-code]').innerText()).replace(/\D/g, ''), 15_000);
  await openDevices(B.win);
  await B.win.locator('.content').getByRole('button', { name: 'Pair a Device' }).first().click();
  await B.win.locator('.modal').getByRole('button', { name: 'Enter a Code' }).click();
  const seen = await until(async () => (await B.win.locator('.link-row.pick').count()) > 0, 12_000);
  if (seen) await B.win.locator('.link-row.pick').first().click();
  else await B.win.locator('input[placeholder^="Address"]').fill(`127.0.0.1:${sa.me.port}`);
  await B.win.locator('input.link-code-input').fill(code);
  await B.win.getByRole('button', { name: 'Pair', exact: true }).click();
  await until(async () => A.win.locator('[data-testid=link-sas]').innerText(), 15_000);
  await until(async () => B.win.locator('[data-testid=link-sas]').innerText(), 15_000);
  await A.win.getByRole('button', { name: /They match/ }).click();
  await B.win.getByRole('button', { name: /They match/ }).click();
  const paired = await until(async () => (await A.win.evaluate(() => window.keeper.link.state())).devices.length === 1 && (await B.win.evaluate(() => window.keeper.link.state())).devices.length === 1, 15_000);
  check(!!paired, 'the two apps paired over Keeper Link');
  const idB = (await A.win.evaluate(() => window.keeper.link.state())).devices[0].id;
  const idA = (await B.win.evaluate(() => window.keeper.link.state())).devices[0].id;
  // Each allows the other to sync (off by default, per device).
  await A.win.evaluate(([d]) => window.keeper.link.state().then((s) => window.keeper.link.setPermissions(d, { ...s.devices[0].permissions, sync: true })), [idB]);
  await B.win.evaluate(([d]) => window.keeper.link.state().then((s) => window.keeper.link.setPermissions(d, { ...s.devices[0].permissions, sync: true })), [idA]);
  const linked = await until(() => A.win.evaluate(async () => (await window.keeper.sync.overview()).transport === 'link'), 20_000);
  check(!!linked, 'sync runs over Keeper Link');
  const aDir = path.join(A.HOME, 'Shared');
  const bDir = path.join(B.HOME, 'Shared');
  fs.writeFileSync(path.join(aDir, 'hello.txt'), 'hello from A');
  fs.mkdirSync(path.join(aDir, 'Holiday'));
  const photo = crypto.randomBytes(1_500_000);
  fs.writeFileSync(path.join(aDir, 'Holiday', 'beach.jpg'), photo);
  fs.writeFileSync(path.join(aDir, 'scratch.tmp'), 'leave me out');
  for (const f of ['hello.txt', 'Holiday/beach.jpg', 'scratch.tmp']) old(path.join(aDir, f));

  // A shares the folder with B, leaving *.tmp out.
  await A.win.evaluate(([p, d]) => window.keeper.sync.addFolder({ path: p, mode: 'two-way', devices: [d], ignore: ['*.tmp'] }), [aDir, idB]);
  const offer = await until(() => B.win.evaluate(async () => { await window.keeper.sync.rescan(); return (await window.keeper.sync.overview()).offers[0]; }));
  check(!!offer && offer.peer === idA, `B is offered A's folder (${offer?.label} from ${offer?.peerName})`);
  if (!offer) throw new Error('no offer arrived');
  await B.win.evaluate(([id, p, d]) => window.keeper.sync.addFolder({ id, path: p, mode: 'two-way', devices: [d] }), [offer.id, bDir, idA]);
  const via = await until(() => B.win.evaluate(async () => (await window.keeper.sync.overview()).folders[0]?.peers[0]?.via));
  check(!!via, `the devices reach each other (${via})`);

  const kick = () => Promise.all([A.win.evaluate(() => window.keeper.sync.rescan()), B.win.evaluate(() => window.keeper.sync.rescan())]);
  const arrived = await until(async () => { await kick(); return fs.existsSync(path.join(bDir, 'Holiday', 'beach.jpg')) && fs.readFileSync(path.join(bDir, 'hello.txt'), 'utf8') === 'hello from A'; });
  check(!!arrived, 'files from A arrive on B');
  check(arrived && fs.readFileSync(path.join(bDir, 'Holiday', 'beach.jpg')).equals(photo), 'the photo is byte for byte the same');
  check(!fs.existsSync(path.join(bDir, 'scratch.tmp')), 'ignored files stay behind');

  // An edit on B comes back to A, and A keeps the old text as a version.
  fs.writeFileSync(path.join(bDir, 'hello.txt'), 'edited on B');
  old(path.join(bDir, 'hello.txt'));
  const back = await until(async () => { await kick(); return fs.readFileSync(path.join(aDir, 'hello.txt'), 'utf8') === 'edited on B'; });
  check(!!back, 'an edit on B reaches A');
  const versions = await A.win.evaluate(async () => { const ov = await window.keeper.sync.overview(); return window.keeper.sync.versions(ov.folders[0].id, 'hello.txt'); });
  check(versions.length === 1, `A kept the replaced text as an older version (${versions.length})`);

  // A deletion on A goes to B's older versions, not into thin air.
  fs.rmSync(path.join(aDir, 'Holiday', 'beach.jpg'));
  const gone = await until(async () => { await kick(); return !fs.existsSync(path.join(bDir, 'Holiday', 'beach.jpg')); });
  check(!!gone, 'a deletion on A reaches B');
  check(fs.existsSync(path.join(bDir, '.keeper-versions')), 'B keeps the deleted photo as an older version');

  // Back up A's folder to a "drive", restore it, then restore it again with the keeper command (no app).
  fs.writeFileSync(path.join(aDir, 'Holiday', 'beach.jpg'), photo);
  const drive = path.join(A.HOME, 'Backup Drive');
  const r = await A.win.evaluate(([src, dest]) => window.keeper.sync.addBackup({ name: 'Shared to drive', sources: [{ name: 'Shared', path: src }], dest: { kind: 'folder', path: dest }, schedule: 'manual', password: 'correct horse battery', remember: false }), [aDir, drive]);
  check(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/.test(r.recovery ?? ''), 'a recovery key is shown once');
  const jobId = r.overview.backups[0].id;
  await A.win.evaluate((id) => window.keeper.sync.runBackup(id), jobId);
  const ran = await until(() => A.win.evaluate(async (id) => { const b = (await window.keeper.sync.overview()).backups.find((x) => x.id === id); return b && b.state !== 'running' && b.lastRun ? b : null; }, jobId), 60_000);
  check(ran?.lastOk === true, `the backup ran (${ran?.lastMessage})`);
  const plain = fs.readdirSync(drive, { recursive: true }).some((f) => /hello|beach|Holiday/.test(String(f)));
  const bytes = fs.readdirSync(path.join(drive, 'packs'), { recursive: true }).filter((f) => fs.statSync(path.join(drive, 'packs', String(f))).isFile()).map((f) => fs.readFileSync(path.join(drive, 'packs', String(f))));
  check(!plain && !bytes.some((b) => b.includes(Buffer.from('edited on B'))), 'nothing readable on the drive: names and contents are encrypted');
  const restoredTo = path.join(A.HOME, 'Restored here');
  const rr = await A.win.evaluate(async ([id, to]) => { const snaps = await window.keeper.sync.snapshots(id); return window.keeper.sync.restore(id, snaps[0].name, { target: to }); }, [jobId, restoredTo]);
  // Three files: the backup has no ignore list, so scratch.tmp is in it too (unlike the synced copy).
  check(rr.files === 3 && fs.readFileSync(path.join(restoredTo, 'Shared', 'hello.txt'), 'utf8') === 'edited on B' && fs.readFileSync(path.join(restoredTo, 'Shared', 'Holiday', 'beach.jpg')).equals(photo), `restore from the app (${rr.files} files)`);

  const cliTo = path.join(SCRATCH, 'cli-restore');
  let cliOut = '';
  try {
    cliOut = execFileSync(process.execPath, [path.join(ROOT, 'dist-cli/keeper.cjs'), 'backup', 'restore', `--from=${drive}`, `--to=${cliTo}`], { env: { ...A.env, KEEPER_BACKUP_PASSWORD: 'correct horse battery' }, encoding: 'utf8' });
  } catch (e) { cliOut = String(e.stdout ?? '') + String(e.stderr ?? ''); }
  check(fs.existsSync(path.join(cliTo, 'Shared', 'Holiday', 'beach.jpg')) && fs.readFileSync(path.join(cliTo, 'Shared', 'Holiday', 'beach.jpg')).equals(photo), `keeper backup restore --from works without the app: ${cliOut.trim().split('\n').pop()}`);
  let statusOut = '';
  try { statusOut = execFileSync(process.execPath, [path.join(ROOT, 'dist-cli/keeper.cjs'), 'sync', 'status'], { env: A.env, encoding: 'utf8' }); } catch (e) { statusOut = String(e.stdout ?? '') + String(e.stderr ?? ''); }
  check(/Shared/.test(statusOut) && /Shared to drive/.test(statusOut), 'keeper sync status talks to the running app');
  let wrong = '';
  try { execFileSync(process.execPath, [path.join(ROOT, 'dist-cli/keeper.cjs'), 'backup', 'list', `--from=${drive}`], { env: { ...A.env, KEEPER_BACKUP_PASSWORD: 'nope' }, encoding: 'utf8', stdio: 'pipe' }); } catch (e) { wrong = String(e.stderr ?? '') + String(e.stdout ?? ''); }
  check(/does not open/.test(wrong), 'the wrong password is refused');

  // Screenshots of the real pages.
  for (const [who, scheme] of [[B, 'light'], [A, 'dark']]) {
    await who.win.evaluate((s) => window.keeper.settings.set({ appearance: s }), scheme);
    await who.win.evaluate(() => { location.hash = ''; });
    await who.win.click('.sidebar [title="Synced folders"]');
    await sleep(1200);
    await who.win.screenshot({ path: path.join(SHOTS, `app-${scheme}-folders.png`) });
    await who.win.click('.sidebar [title="Backups"]');
    await sleep(900);
    await who.win.screenshot({ path: path.join(SHOTS, `app-${scheme}-backups.png`) });
  }
  check(!A.errors.length && !B.errors.length, `no page errors ${[...A.errors, ...B.errors].slice(0, 2).join(' | ')}`);
  await A.app.close();
  await B.app.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
