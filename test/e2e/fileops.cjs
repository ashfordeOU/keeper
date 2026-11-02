// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/fileops.cjs /tmp/kfo /tmp/kfo/shots
// Copying and moving files between folders in the real app, on a throwaway home:
//   • ⌘C/Ctrl+C then ⌘V/Ctrl+V into another folder copies; a name already
//     there asks Replace / Keep Both / Skip;
//   • ⌘X/Ctrl+X then paste moves, Replace puts the old one in the Trash, and
//     Undo in the toast puts the moved file back;
//   • "Move to…" in a folder's menu picks a recent folder;
//   • dropping onto a folder moves (⌥/Ctrl copies), onto a sidebar Favorite
//     moves there, and onto the Trash trashes;
//   • a folder into itself is refused with a plain reason; progress events come.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

if (process.argv[2]) fs.mkdirSync(process.argv[2], { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kfo-')));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });

const DOCS = path.join(HOME, 'Documents');
const SRC = path.join(DOCS, 'src');
const DEST = path.join(DOCS, 'dest');
const FAV = path.join(HOME, 'Favorite place');
const tree = {
  'src/a.txt': 'new a\n',
  'src/b.txt': 'new b\n',
  'src/c.txt': 'c\n',
  'src/d.txt': 'd\n',
  'src/e.txt': 'e\n',
  'src/Photos/p1.txt': 'p1\n',
  'dest/a.txt': 'old a\n',
  'dest/b.txt': 'old b\n',
  'dest/Inbox/keep.txt': 'k\n',
};
for (const d of ['Downloads', 'Desktop', 'Pictures', '.config/Keeper', 'Favorite place']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
for (const [rel, text] of Object.entries(tree)) {
  fs.mkdirSync(path.dirname(path.join(DOCS, rel)), { recursive: true });
  fs.writeFileSync(path.join(DOCS, rel), text);
}
fs.writeFileSync(path.join(HOME, '.config/Keeper/settings.json'), JSON.stringify({ folders: [DOCS], pinned: [FAV], features: { usageStats: false } }));

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => fs.existsSync(p);
const read = (p) => (exists(p) ? fs.readFileSync(p, 'utf8') : '');

(async () => {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, HOME, KEEPER_SKIP_TOUR: '1', NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await sleep(500);
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 60000 });
  const nav = async (r) => { await app.evaluate(({ BrowserWindow }, route) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event:navigate', route); }, r); await sleep(900); };
  const shot = (name) => main.screenshot({ path: path.join(SHOTS, `fileops-${name}.png`) });
  const card = (p) => main.locator(`.file-card[data-path="${p}"], .file-list tr[data-path="${p}"]`).first();
  const toasts = () => main.locator('.toast').allTextContents();
  const lastToast = async () => (await toasts()).at(-1) ?? '';
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  // Progress events, counted in the page.
  await main.evaluate(() => { window.__fp = 0; window.keeper.on('files-progress', () => { window.__fp++; }); });

  await nav(`browse:${SRC}`);
  await main.locator('[data-testid="view-grid"]').click().catch(() => undefined);
  await card(path.join(SRC, 'a.txt')).waitFor({ timeout: 20000 });

  // ---------------------------------------------------------------- copy, paste, Keep Both
  await card(path.join(SRC, 'a.txt')).click();
  await card(path.join(SRC, 'c.txt')).click({ modifiers: [mod] });
  await main.keyboard.press(`${mod}+c`);
  await nav(`browse:${DEST}`);
  check(await main.locator('[data-testid="paste-here"]').count() === 1, 'a Paste button shows after copying');
  await main.locator('.file-grid').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await main.keyboard.press(`${mod}+v`);
  await main.waitForSelector('.modal [data-choice="keep"]', { timeout: 5000 }).catch(() => undefined);
  const askTitle = await main.locator('.modal h2').textContent().catch(() => '');
  check(/“a\.txt” is already in “dest”/.test(askTitle), `a clashing name asks first ("${askTitle}")`);
  await shot('conflict');
  await main.locator('.modal [data-choice="keep"]').click();
  await sleep(1200);
  check(read(path.join(DEST, 'a.txt')) === 'old a\n' && read(path.join(DEST, 'a 2.txt')) === 'new a\n' && exists(path.join(DEST, 'c.txt')), 'Keep Both: the copy is "a 2.txt" and the old one stays');
  check(exists(path.join(SRC, 'a.txt')) && exists(path.join(SRC, 'c.txt')), 'a copy leaves the originals');
  check(/Copied 2 items to “dest”/.test(await lastToast()), `the toast says what was copied ("${await lastToast()}")`);
  check(await main.evaluate(() => window.__fp) >= 2, 'progress events arrive');

  // ---------------------------------------------------------------- cut, paste, Replace, Undo
  await nav(`browse:${SRC}`);
  await card(path.join(SRC, 'b.txt')).click();
  await main.keyboard.press(`${mod}+x`);
  await sleep(200);
  check(await main.locator(`.file-card.is-cut[data-path="${path.join(SRC, 'b.txt')}"]`).count() === 1, 'a cut file shows dimmed');
  await nav(`browse:${DEST}`);
  await main.locator('[data-testid="paste-here"]').click();
  await main.waitForSelector('.modal [data-choice="replace"]', { timeout: 5000 });
  await main.locator('.modal [data-choice="replace"]').click();
  await sleep(1200);
  check(!exists(path.join(SRC, 'b.txt')) && read(path.join(DEST, 'b.txt')) === 'new b\n', 'Cut and paste moves; Replace takes the place of the old one');
  const trashDir = path.join(HOME, '.local/share/Trash/files');
  check(exists(trashDir) && fs.readdirSync(trashDir).some((n) => /^b.*\.txt$/.test(n)), 'the replaced file is in the Trash');
  const moved = main.locator('.toast', { hasText: 'Moved' }).last();
  check(await moved.locator('button', { hasText: 'Undo' }).count() === 1, 'the move offers Undo');
  await moved.locator('button', { hasText: 'Undo' }).click();
  await sleep(1200);
  check(read(path.join(SRC, 'b.txt')) === 'new b\n', 'Undo puts the moved file back');
  check(await main.locator('[data-testid="paste-here"]').count() === 0, 'after a cut is pasted, nothing is left to paste');

  // ---------------------------------------------------------------- Move to… from a folder's menu
  await nav(`browse:${SRC}`);
  await card(path.join(SRC, 'Photos')).click({ button: 'right' });
  await main.locator('.menu [role="menuitem"], .menu button', { hasText: 'Move to…' }).first().click();
  await main.waitForSelector('.fileops-dest', { timeout: 5000 });
  await shot('move-to');
  await main.locator('.fileops-dest', { hasText: 'dest' }).first().click();
  await sleep(1200);
  check(exists(path.join(DEST, 'Photos', 'p1.txt')) && !exists(path.join(SRC, 'Photos')), 'Move to… moves the folder to a recent destination');

  // ---------------------------------------------------------------- drops
  const drop = (selector, paths, opts = {}) => main.evaluate(({ selector, paths, opts }) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const dt = new DataTransfer();
    dt.setData('application/x-keeper-paths', JSON.stringify(paths));
    el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...opts }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...opts }));
    return true;
  }, { selector, paths, opts });
  await nav(`browse:${DEST}`);
  const inbox = path.join(DEST, 'Inbox');
  check(await drop(`.file-card[data-path="${inbox}"]`, [path.join(SRC, 'd.txt')]), 'a folder takes a drop');
  await sleep(1200);
  check(exists(path.join(inbox, 'd.txt')) && !exists(path.join(SRC, 'd.txt')), 'dropping onto a folder moves into it');
  await drop(`.file-card[data-path="${inbox}"]`, [path.join(SRC, 'e.txt')], { altKey: true });
  await sleep(1200);
  check(exists(path.join(inbox, 'e.txt')) && exists(path.join(SRC, 'e.txt')), 'with ⌥/Ctrl, dropping copies');
  check(await drop(`.place-row:has([data-nav-key="${FAV}"])`, [path.join(SRC, 'e.txt')]), 'a sidebar Favorite takes a drop');
  await sleep(1200);
  check(exists(path.join(FAV, 'e.txt')) && !exists(path.join(SRC, 'e.txt')), 'dropping onto a sidebar Favorite moves there');
  await drop('.place-row:has([data-nav-key="trash"])', [path.join(FAV, 'e.txt')]);
  await sleep(1200);
  check(!exists(path.join(FAV, 'e.txt')), 'dropping onto the Trash trashes');

  // ---------------------------------------------------------------- refused
  await drop(`.file-card[data-path="${inbox}"]`, [DEST]);
  await sleep(1000);
  check(/Couldn’t move dest: a folder can’t go inside itself/.test(await lastToast()) && exists(DEST), `a folder into itself is refused ("${await lastToast()}")`);

  // ---------------------------------------------------------------- columns view
  await nav(`browse:${SRC}`);
  await main.locator('[data-testid="view-columns"]').click();
  await sleep(600);
  await main.locator(`.col-row[data-path="${path.join(SRC, 'c.txt')}"]`).click();
  await main.keyboard.press(`${mod}+c`);
  await nav(`browse:${FAV}`);
  await main.keyboard.press(`${mod}+v`);
  await sleep(1200);
  check(exists(path.join(FAV, 'c.txt')), 'columns view: copy and paste work too');
  await main.locator('[data-testid="view-grid"]').click();

  // ---------------------------------------------------------------- a page that does not exist (a stale keeper:// link)
  await nav('nosuchpage:x');
  check(await main.locator('[data-testid="page-not-found"]').count() === 1 && await main.getByText('This page ran into a problem').count() === 0, 'an unknown page says so and offers Home');

  // ---------------------------------------------------------------- a failure nobody caught is not lost
  await main.evaluate(() => { for (let i = 0; i < 3; i++) void Promise.reject(new Error("Error invoking remote method 'files.copy': Error: Nobody caught this")); });
  await sleep(800);
  check(await main.locator('.toast', { hasText: 'Something didn’t work: Nobody caught this' }).count() === 1 && await main.locator('.toast', { hasText: 'Nobody caught this' }).locator('button', { hasText: 'Details' }).count() === 1, 'a failure nobody caught shows one quiet toast, with Details');
  const logged = await main.evaluate(() => window.keeper.session.log()).then((l) => l.log.some((e) => e.kind === 'renderer-error' && /Nobody caught this/.test(e.detail)));
  check(logged, 'and is written to the session log');
  errors.splice(0, errors.length, ...errors.filter((m) => !/Nobody caught this/.test(m)));

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await Promise.race([app.close(), sleep(15000)]);
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
