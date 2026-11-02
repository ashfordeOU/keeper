// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/notes-hub.cjs <home> <shots dir>
// Drives the real Keeper app's Notes Everywhere: connects a Markdown folder,
// looks at the dry run, syncs it; imports a Google Keep Takeout; makes a note
// change in two places, reviews the side-by-side conflict and settles it;
// searches across apps and opens "Where does this note live?"; makes a
// snapshot. Screenshots of each step.
const { _electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.resolve(__dirname, '../..');
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(process.argv[2] ? path.resolve(process.argv[2]) : os.tmpdir(), 'knh-')));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const VAULT = path.join(HOME, 'Vault');
fs.mkdirSync(path.join(VAULT, 'Trips'), { recursive: true });
fs.writeFileSync(path.join(VAULT, 'Trips', 'Lisbon.md'), '---\ntags: [travel]\n---\nBook the flat in Alfama\nTram 28 early\nPastéis de Belém\n');
fs.writeFileSync(path.join(VAULT, 'Gift ideas.md'), '- Mum: a pottery class\n- Sam: the hiking map\n');
fs.writeFileSync(path.join(VAULT, 'Groceries.txt'), 'milk\neggs\n');
const KEEP = path.join(HOME, 'Takeout', 'Keep');
fs.mkdirSync(KEEP, { recursive: true });
for (const f of fs.readdirSync(path.join(APP, 'test/fixtures/notes-sync/keep'))) fs.copyFileSync(path.join(APP, 'test/fixtures/notes-sync/keep', f), path.join(KEEP, f));
fs.writeFileSync(path.join(KEEP, 'Gifts.json'), JSON.stringify({ title: 'Gift ideas', textContent: '- Mum: a pottery class\n- Sam: the hiking map!', labels: [{ name: 'family' }], userEditedTimestampUsec: 1730000000000000, createdTimestampUsec: 1720000000000000 }));

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15_000, step = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v || Date.now() > end) return v;
    await wait(step);
  }
}

(async () => {
  const env = { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', XDG_DOCUMENTS_DIR: HOME + '/Documents' };
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  const errors = [];
  let main;
  for (let i = 0; i < 160 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await wait(500);
  }
  check(!!main, 'Keeper opens');
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await main.getByRole('button', { name: /Skip tour/ }).click({ timeout: 5000 }).catch(() => undefined);
  await main.setViewportSize?.({ width: 1360, height: 900 }).catch(() => undefined);
  const shot = (name) => main.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const ns = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.notesync[f](...args), [fn, a]);

  // ---- the page, from the sidebar (on by default; nothing runs until an app is connected)
  const nav = main.locator('.nav-item[title="Notes Everywhere"]');
  check(await nav.count() === 1, 'Notes Everywhere is in the sidebar');
  await nav.click();
  await main.waitForSelector('.nh-page', { timeout: 15_000 });
  const ov0 = await ns('overview');
  check(ov0.connectors.length === 0 && ov0.autoSync === false, 'no apps connected and background sync off at first');
  const HUB = ov0.hubFolder;
  await main.getByTestId('nh-tab-apps').click();
  await shot('01-apps-empty');

  // ---- connect the folder, dry run, sync
  await main.getByTestId('nh-connect-folder').click();
  await main.getByTestId('nh-field-path').fill(VAULT);
  await main.getByTestId('nh-connect').click();
  const card = main.getByTestId('nh-conn-folder');
  await card.waitFor({ timeout: 10_000 });
  check(await card.getByTestId('nh-sync').isDisabled(), 'Sync is disabled until the dry run was seen');
  await card.getByTestId('nh-dryrun').click();
  const summary = await until(async () => { const t = await card.getByTestId('nh-plan-summary').innerText(); return /Would add/.test(t) ? t : null; });
  check(summary === 'Would add 3, update 0, conflicts 0', `dry run: ${summary}`);
  check(!fs.existsSync(path.join(HUB, 'Folders')), 'the dry run changed nothing');
  await shot('02-folder-dry-run');
  await card.getByTestId('nh-plan-sync').click();
  const hubLisbon = path.join(HUB, 'Folders', 'Vault', 'Trips', 'Lisbon.md');
  check(!!(await until(async () => fs.existsSync(hubLisbon))), 'the folder’s notes are in the hub');
  check(/keeper-id: k-/.test(fs.readFileSync(hubLisbon, 'utf8')) && /source: folder/.test(fs.readFileSync(hubLisbon, 'utf8')), 'hub copy has its properties');

  // ---- import a Google Keep Takeout
  await main.getByTestId('nh-connect-keep').click();
  await main.getByTestId('nh-field-path').fill(KEEP);
  await main.getByTestId('nh-connect').click();
  const keepCard = main.getByTestId('nh-conn-keep');
  await keepCard.waitFor({ timeout: 10_000 });
  check(/Import only/.test(await keepCard.innerText()), 'Keep is labelled import only');
  await keepCard.getByTestId('nh-dryrun').click();
  const ksum = await until(async () => { const t = await keepCard.getByTestId('nh-plan-summary').innerText(); return /Would add/.test(t) ? t : null; });
  check(ksum === 'Would add 3, update 0, conflicts 0', `Keep dry run: ${ksum}`);
  check(/looks like a note you have/.test(await keepCard.getByTestId('nh-plan').innerText()), 'the dry run points out the duplicate');
  await shot('03-keep-dry-run');
  await keepCard.getByTestId('nh-plan-sync').click();
  check(!!(await until(async () => fs.existsSync(path.join(HUB, 'Google Keep', 'Shopping.md')))), 'Keep notes imported');
  await shot('04-apps-connected');

  // ---- a change in two places: a conflict, reviewed side by side and settled
  const [lis] = await ns('search', 'Alfama');
  await ns('saveNote', lis.keeperId, { title: 'Lisbon', body: 'Book the flat in Alfama\nTram 28 at sunrise, from Keeper\nPastéis de Belém' });
  const t = new Date(Date.now() + 5000);
  fs.writeFileSync(path.join(VAULT, 'Trips', 'Lisbon.md'), '---\ntags: [travel]\n---\nBook the flat in Alfama\nTram 28 at sunset, from the vault\nPastéis de Belém\n');
  fs.utimesSync(path.join(VAULT, 'Trips', 'Lisbon.md'), t, t);
  await card.getByTestId('nh-sync').click();
  check(!!(await until(async () => (await ns('conflicts')).length === 1)), 'the sync found a conflict and kept both');
  check(/from the vault/.test(fs.readFileSync(path.join(VAULT, 'Trips', 'Lisbon.md'), 'utf8')), 'the app’s text was not overwritten');
  await main.getByTestId('nh-tab-review').click();
  const conflict = main.getByTestId('nh-conflict');
  await conflict.waitFor({ timeout: 10_000 });
  const ctext = await conflict.innerText();
  check(/from Keeper/.test(ctext) && /from the vault/.test(ctext), 'side-by-side compare shows both');
  check(await main.getByTestId('nh-dup').count() === 1, 'the duplicate across apps is offered');
  await shot('05-review-conflict');
  await conflict.getByTestId('nh-keep-theirs').click();
  check(!!(await until(async () => (await ns('conflicts')).length === 0)), 'conflict settled');
  const after = await ns('note', lis.keeperId);
  check(/from the vault/.test(after.body), 'kept the vault’s text as chosen');
  await main.getByTestId('nh-dup').getByRole('button', { name: 'Link as one note' }).click();
  check(!!(await until(async () => (await ns('duplicates')).length === 0)), 'duplicates linked');
  await shot('06-review-done');

  // ---- one search across apps, and where a note lives
  await main.getByTestId('nh-tab-notes').click();
  await main.getByTestId('nh-search').fill('pottery');
  await main.locator('.nh-hit').first().click();
  const where = main.getByTestId('nh-where');
  await where.waitFor({ timeout: 10_000 });
  const wtext = await where.innerText();
  check(/Markdown or text folder/.test(wtext) && /Google Keep/.test(wtext), 'the linked note lives in both apps');
  await shot('07-where-it-lives');

  // ---- backups
  await main.getByTestId('nh-tab-backups').click();
  await main.getByTestId('nh-snapshot').click();
  check(!!(await until(async () => (await ns('snapshots')).length >= 2)), 'snapshots kept (one before each sync, one by hand)');
  await shot('08-backups');

  // ---- Standard Notes: the account connection is offered as two-way, and the sign-in form asks for the right things
  await main.getByTestId('nh-tab-apps').click();
  const snBtn = main.getByTestId('nh-connect-standardnotes-sync');
  check(await snBtn.count() === 1 && /Standard Notes/.test(await snBtn.innerText()) && /Two-way/i.test(await snBtn.innerText()), 'Standard Notes (account sync) is offered as two-way');
  await snBtn.click();
  check(await main.getByTestId('nh-field-email').count() === 1 && await main.getByTestId('nh-field-server').count() === 1 && await main.getByTestId('nh-field-code').count() === 1, 'its form asks for email, password, an optional self-hosted server and a two-step code');
  await shot('09-standard-notes-form');
  await main.keyboard.press('Escape').catch(() => undefined);

  // ---- …and its sign-in and sync, in Electron's own runtime (whose crypto has no Argon2), against the stand-in server
  {
    const { buildSync } = require('esbuild');
    const out = path.join(HOME, 'sn-probe.cjs');
    // Run as plain Node inside Electron, so the Electron API is not there: a stand-in for the
    // parts a shared helper names at load time (it is never called on this path).
    const stub = path.join(HOME, 'electron-stub.cjs');
    fs.writeFileSync(stub, 'module.exports = { BrowserWindow: class {}, app: {}, shell: {} };\n');
    buildSync({
      stdin: { resolveDir: APP, loader: 'ts', contents: `
        import { argon2 } from './electron/services/notes-sync/connectors';
        import { StandardNotesApi, snSalt, SN_ARGON2 } from './core/notes-sync/connectors/standardnotes';
        const { startStandin } = require('./test/fixtures/notes-sync/sn-standin.cjs');
        const account = require('./test/fixtures/notes-sync/sn-account.json');
        (async () => {
          const vec = Buffer.from(await argon2('foobarfoo🔒', snSalt('foo', 'bar'), { ...SN_ARGON2, length: 32 })).toString('hex');
          const s = await startStandin({ account });
          const fetchFn = async (u, i) => { const r = await fetch(u, i); return { ok: r.ok, status: r.status, headers: r.headers, json: () => r.json(), text: () => r.text() }; };
          const api = new StandardNotesApi({ server: s.url, email: account.email, password: 'Lighthouse keeper 7', fetch: fetchFn, argon2 });
          const { notes } = await api.list();
          const book = notes.find((n) => n.title === 'Book ideas');
          await api.update({ ...book, body: book.body + '\\n- from Electron' });
          const sent = s.requests.map((r) => r.body).join('');
          console.log(JSON.stringify({ node: process.versions.node, vec, titles: notes.map((n) => n.title).sort(), plaintextSent: /lighthouse|from Electron/i.test(sent) }));
          await s.close();
        })().catch((e) => { console.log(JSON.stringify({ error: String(e) })); });
      ` },
      outfile: out, bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'error', alias: { electron: stub },
    });
    const r = require('child_process').spawnSync(path.join(APP, 'node_modules/.bin/electron'), [out], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 120_000 });
    let j = {};
    try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { j = { error: r.stderr || r.stdout }; }
    check(j.vec === 'bb6ec440708c271ce34decd7f997e2444d309b1105992779ccdb47f78a5fda6f', `Argon2id in Electron’s runtime (Node ${j.node}) matches Standard Notes’ published vector${j.error ? ' — ' + j.error : ''}`);
    check(JSON.stringify(j.titles) === JSON.stringify(['Book ideas', 'Diary', 'Gift ideas', 'Old draft']) && j.plaintextSent === false, `signed in to the stand-in Standard Notes server, opened the notes on this computer, wrote one back, and sent no plain text (${JSON.stringify(j.titles)})`);
  }

  // A Keeper Notes vault joins Notes Everywhere and the Island's Notes by itself, read only.
  const KV = path.join(HOME, 'Keeper Vault');
  fs.mkdirSync(KV, { recursive: true });
  fs.writeFileSync(path.join(KV, 'Packing list.md'), 'Passport\nCharger\n');
  await main.evaluate((p) => window.keeper.notes.addVault(p), KV);
  const kvConn = await until(async () => (await ns('overview')).connectors.find((c) => /\(Keeper Notes\)$/.test(c.label)));
  check(!!kvConn && kvConn.label === 'Keeper Vault (Keeper Notes)' && kvConn.writeBack === false, 'a Keeper Notes vault is linked into Notes Everywhere, read only');
  const kvHit = await until(async () => ((await ns('islandNotes', 'Passport')).hits ?? []).length > 0);
  const isl = await ns('islandNotes', '');
  check(!!kvHit && isl.sources.some((s) => s.label === 'Keeper Vault (Keeper Notes)'), 'its notes are found from the Island, under the vault’s name');
  check(fs.readFileSync(path.join(KV, 'Packing list.md'), 'utf8') === 'Passport\nCharger\n', 'the vault was only read');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
  console.log(process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
