// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/guide.cjs /tmp/kg /tmp/kg-shots
// Drives the real Keeper app: a space finding with an automatic fix (emptying a
// test Trash: preview → do it → done, badge goes down), "How do I free up space"
// from the command palette, and a privacy guide that opens the (stubbed)
// settings page and keeps its steps on top in the small guide window.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/kg-'));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop', '.config']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
// A Trash with two files in it (freedesktop layout).
const TRASH = path.join(HOME, '.local/share/Trash');
fs.mkdirSync(path.join(TRASH, 'files'), { recursive: true });
fs.mkdirSync(path.join(TRASH, 'info'), { recursive: true });
for (const [n, size] of [['old-export.zip', 300_000], ['notes-draft.txt', 2000]]) {
  fs.writeFileSync(path.join(TRASH, 'files', n), Buffer.alloc(size, 7));
  fs.writeFileSync(path.join(TRASH, 'info', `${n}.trashinfo`), `[Trash Info]\nPath=${path.join(HOME, 'Documents', n)}\nDeletionDate=2026-10-01T10:00:00\n`);
}
const STUB = path.join(HOME, 'opened.jsonl');

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };

(async () => {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', XDG_CURRENT_DESKTOP: 'GNOME', KEEPER_GUIDE_OPEN_STUB: STUB, KEEPER_GUIDE_TRASH_MIN: '1' },
  });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); });
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1280, height: 820 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 60000 });
  await main.waitForTimeout(1500);
  const shot = async (name, dark) => {
    await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
    await main.waitForTimeout(500);
    await main.screenshot({ path: path.join(SHOTS, `${name}-${dark ? 'dark' : 'light'}.png`) });
  };

  // The first-run tour.
  check(await main.getByText('Welcome to Keeper').count() > 0, 'the first-run tour opens');
  await main.screenshot({ path: path.join(SHOTS, 'tour-light.png') });
  await main.getByText('Skip tour').click();

  // To do: check now.
  await main.click('.sidebar [title="To do"]');
  await main.getByRole('button', { name: /Check again/ }).click();
  await main.waitForSelector('text=/The Trash holds/', { timeout: 60000 });
  check(true, 'To do lists the Trash finding after checking');
  const badge = async () => Number((await main.locator('.sidebar [title="To do"] .count').textContent().catch(() => '0')) || '0');
  const before = await badge();
  check(before >= 1, `the sidebar badge counts open items (${before})`);
  await shot('todo', false);
  await shot('todo', true);

  // The automatic fix: preview → do it → done.
  await main.locator('.finding', { hasText: 'The Trash holds' }).getByRole('button', { name: /Empty the Trash/ }).click();
  await main.waitForSelector('.guide-panel >> text=/will be deleted for good/', { timeout: 30000 });
  check(await main.locator('.guide-panel').getByText('old-export.zip').count() > 0, 'the preview lists what will be deleted');
  check(await main.locator('.guide-panel').getByText('This cannot be undone.').count() > 0, 'the preview says it cannot be undone');
  await shot('panel-auto', false);
  await main.locator('.guide-panel').getByRole('button', { name: /Empty the Trash/ }).click();
  await main.waitForSelector('.guide-panel >> text=/The Trash is empty/', { timeout: 30000 });
  check(fs.readdirSync(path.join(TRASH, 'files')).length === 0, 'the Trash is really empty');
  await main.waitForTimeout(800);
  const after = await badge();
  check(after < before, `the badge goes down (${before} → ${after})`);
  await main.keyboard.press('Escape');

  // "How do I free up space" from the command palette.
  await main.keyboard.press('Control+k');
  await main.keyboard.type('how do i free up space');
  await main.waitForTimeout(400);
  await main.locator('.q-row', { hasText: 'How do I… free up space' }).first().click();
  await main.waitForSelector('.guide-panel >> text=Free up space', { timeout: 10000 });
  check(true, '“How do I free up space” from the palette starts the guide');
  check(await main.locator('.guide-panel .guide-step').count() >= 3, 'the guide shows numbered steps');
  await main.locator('.guide-panel').getByRole('button', { name: 'Next' }).click();
  check(await main.locator('.guide-panel').getByText('Step 2 of 3').count() > 0, 'Next moves to step 2');
  await shot('panel-steps', true);
  await main.keyboard.press('Escape');

  // A privacy guide: opens the settings page (stubbed) and keeps the steps on top.
  await main.click('.sidebar [title="To do"]');
  await main.getByLabel('How do I').fill('camera');
  await main.locator('.howto-results .chip', { hasText: 'camera' }).first().click();
  await main.waitForSelector('.guide-panel >> text=Stop apps using my camera');
  await main.locator('.guide-panel').getByRole('button', { name: /Open Camera settings/ }).click();
  await main.waitForTimeout(1200);
  const opened = fs.existsSync(STUB) ? fs.readFileSync(STUB, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  check(opened.some((o) => o.topic === 'camera' && o.cmd?.join(' ') === 'gnome-control-center camera'), `the camera settings page was asked for: ${JSON.stringify(opened)}`);
  let mini;
  for (let i = 0; i < 20 && !mini; i++) {
    mini = app.windows().find((w) => w.url().includes('view=guide-mini'));
    if (!mini) await new Promise((r) => setTimeout(r, 300));
  }
  check(!!mini, 'the small guide window opens');
  if (mini) {
    await mini.waitForSelector('text=Stop apps using my camera', { timeout: 10000 });
    check(true, 'the small window shows the same steps');
    const onTop = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('view=guide-mini') && w.isAlwaysOnTop()));
    check(onTop, 'the small window stays on top');
    await mini.screenshot({ path: path.join(SHOTS, 'mini-light.png') });
  }
  await shot('panel-open', false);

  // A coach mark on a complex page (shown once).
  await main.keyboard.press('Escape');
  await main.click('.sidebar [title="Clean Up"]');
  await main.waitForTimeout(500);
  check(await main.getByText('Two ways to clean').count() > 0, 'Clean Up shows its one-time tip');
  await main.getByRole('button', { name: 'Got it' }).click();
  check(await main.getByText('Two ways to clean').count() === 0, 'the tip goes away for good');

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
