// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/lock.cjs /tmp/kl /tmp/kl-shots
// Drives the real Keeper app: shows and hides hidden files with the toolbar
// button and the shortcut, locks a folder with a password through the dialogs,
// checks the locked file holds no readable names, then unlocks it again.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const HOME = process.argv[2];
const SHOTS = process.argv[3];
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents/Taxes 2025/receipts', 'Documents/Projects', 'Downloads', 'Pictures', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const secret = crypto.randomBytes(200_000);
fs.writeFileSync(path.join(HOME, 'Documents/Taxes 2025/return.pdf'), secret);
fs.writeFileSync(path.join(HOME, 'Documents/Taxes 2025/receipts/coffee.txt'), 'flat white 4.20\n');
fs.writeFileSync(path.join(HOME, 'Documents/.secret-notes'), 'hidden by name\n');
fs.writeFileSync(path.join(HOME, 'Documents/marked-hidden.txt'), 'hidden by .hidden\n');
fs.writeFileSync(path.join(HOME, 'Documents/.hidden'), 'marked-hidden.txt\n');
fs.writeFileSync(path.join(HOME, 'Documents/plan.md'), '# plan\n');

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const PW = 'blue-otter-sings-at-dawn';

(async () => {
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1280, height: 820 }).catch(() => undefined);
  await main.waitForTimeout(2000);
  const shot = async (name, dark) => {
    await main.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
    await main.waitForTimeout(400);
    await main.screenshot({ path: `${SHOTS}/${name}-${dark ? 'dark' : 'light'}.png` });
  };

  // ---- hidden files
  const docs = path.join(HOME, 'Documents');
  await main.getByRole('button', { name: 'Documents', exact: true }).first().click();
  await main.waitForSelector('.folder-item >> text=Taxes 2025', { timeout: 10000 });
  const names = async () => main.locator('.folder-item .ellipsis:first-child, .file-list td.ellipsis, .file-card .name').allInnerTexts();
  let n = await names();
  check(!n.includes('.secret-notes') && !n.includes('marked-hidden.txt'), 'hidden files are not listed by default');
  const toggle = main.locator('.hidden-toggle').first();
  check(await toggle.isVisible(), 'the Hidden files button is in the toolbar');
  await shot('hidden-off', false);
  await toggle.click();
  await main.waitForTimeout(1200);
  n = await names();
  check(n.includes('.secret-notes') && n.includes('marked-hidden.txt'), 'the button shows dot files and names listed in .hidden');
  check((await main.locator('.is-hidden').count()) >= 2, 'hidden items are dimmed');
  await shot('hidden-on', false);
  await shot('hidden-on', true);
  await main.keyboard.press('Control+Shift+Period');
  await main.waitForTimeout(1200);
  n = await names();
  check(!n.includes('.secret-notes'), 'Ctrl+Shift+. hides them again');

  // ---- lock
  await main.locator('.folder-item', { hasText: 'Taxes 2025' }).click({ button: 'right' });
  await main.getByText('Lock Folder…').click();
  await main.waitForSelector('text=A password');
  await shot('lock-dialog', false);
  await main.locator('.lock-method', { has: main.locator('.lock-method-title', { hasText: /^A password$/ }) }).click();
  await main.getByLabel('Password', { exact: true }).fill(PW);
  await main.getByLabel('Confirm password').fill(PW);
  await shot('lock-dialog-password', false);
  await shot('lock-dialog-password', true);
  await main.getByRole('button', { name: 'Continue' }).click();
  await main.waitForSelector('.lock-key');
  const recovery = (await main.locator('.lock-key').innerText()).trim();
  check(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(recovery), 'a recovery key is shown');
  const lockBtn = main.getByRole('button', { name: 'Lock Folder' });
  check(await lockBtn.isDisabled(), 'Lock stays disabled until the recovery key is confirmed saved');
  await main.locator('.lock-confirm input').check();
  await shot('lock-recovery', false);
  await shot('lock-recovery', true);
  await lockBtn.click();
  const vault = path.join(docs, 'Taxes 2025.keeperlock');
  for (let i = 0; i < 40 && !(fs.existsSync(vault) && !fs.existsSync(path.join(docs, 'Taxes 2025'))); i++) await main.waitForTimeout(250);
  check(fs.existsSync(vault), 'Taxes 2025.keeperlock was written');
  check(!fs.existsSync(path.join(docs, 'Taxes 2025')), 'the unencrypted folder was removed');
  const raw = fs.readFileSync(vault);
  check(!raw.includes(Buffer.from('return.pdf')) && !raw.includes(Buffer.from('coffee')) && !raw.includes(secret.subarray(0, 64)), 'the locked file shows no names or contents');
  await main.waitForSelector('.folder-item.locked', { timeout: 10000 });
  await shot('browse-locked', false);
  await shot('browse-locked', true);

  // ---- wrong password, then unlock
  await main.locator('.folder-item.locked').dblclick();
  await main.waitForSelector('text=Unlock “Taxes 2025”');
  await main.getByLabel('Password', { exact: true }).fill('wrong');
  await main.getByRole('button', { name: 'Unlock', exact: true }).click();
  await main.waitForSelector('.lock-refused', { timeout: 15000 });
  check(/not right/.test(await main.locator('.lock-refused').innerText()), 'a wrong password is refused');
  await shot('unlock-dialog', false);
  await shot('unlock-dialog', true);
  await main.getByLabel('Password', { exact: true }).fill(PW);
  await main.getByRole('button', { name: 'Unlock', exact: true }).click();
  const back = path.join(docs, 'Taxes 2025', 'return.pdf');
  for (let i = 0; i < 40 && !fs.existsSync(back); i++) await main.waitForTimeout(250);
  check(fs.existsSync(back) && fs.readFileSync(back).equals(secret), 'unlocking restores the files byte for byte');
  check(fs.readFileSync(path.join(docs, 'Taxes 2025/receipts/coffee.txt'), 'utf8') === 'flat white 4.20\n', 'nested files are restored');
  check(!fs.existsSync(vault), 'the locked file is removed after unlocking');

  // ---- lock again from the menu, then the recovery key
  await main.waitForTimeout(800);
  await main.locator('.folder-item', { hasText: 'Taxes 2025' }).click({ button: 'right' });
  check(await main.getByText('Lock Again Now').isVisible(), 'an unlocked folder offers Lock Again Now');
  await main.getByText('Lock Again Now').click();
  for (let i = 0; i < 40 && !fs.existsSync(vault); i++) await main.waitForTimeout(250);
  check(fs.existsSync(vault) && !fs.existsSync(path.join(docs, 'Taxes 2025')), 'Lock Again Now locks it with no password asked');
  await main.waitForSelector('.folder-item.locked', { timeout: 10000 });
  await main.locator('.folder-item.locked').dblclick();
  await main.getByText('Use the recovery key').click();
  await main.getByLabel('Recovery key').fill(recovery.toLowerCase().replace(/-/g, ' '));
  await main.getByRole('button', { name: 'Unlock', exact: true }).click();
  for (let i = 0; i < 40 && !fs.existsSync(back); i++) await main.waitForTimeout(250);
  check(fs.existsSync(back) && fs.readFileSync(back).equals(secret), 'the recovery key (typed in lower case with spaces) unlocks it');

  // ---- Settings list and the account method
  const st = await main.evaluate(() => window.keeper.lock.status());
  console.log('INFO account method here:', JSON.stringify(st.account));
  await main.evaluate(() => { const el = [...document.querySelectorAll('button')].find((b) => /Settings/.test(b.textContent || '')); el?.click(); });
  await main.waitForTimeout(800);
  const loc = main.locator('#locked');
  if (await loc.count()) {
    await loc.scrollIntoViewIfNeeded();
    await main.waitForTimeout(400);
    await shot('settings-locked', false);
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
