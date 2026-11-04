// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a node test/e2e/notes-mindmap.cjs /tmp/knm /tmp/knm-shots
// Drives the real Keeper app's mind map view: a note's headings and lists as
// branches, adding with Tab, renaming with F2, moving by drag, folding,
// Undo, every change written into the Markdown; a new mind map note; saving
// as PNG and SVG; and a 500-branch map staying quick.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOME = process.argv[2];
const SHOTS = process.argv[3];
const ROOT = path.resolve(__dirname, '../..');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const DATA = path.join(HOME, '.config', 'Keeper');
const VAULT = path.join(HOME, 'Documents', 'My Vault');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(VAULT, { recursive: true });
const NOTE = path.join(VAULT, 'Garden plan.md');
fs.writeFileSync(NOTE, '---\ntags: [garden]\n---\n# Garden plan\n\nTulips go in before the first frost.\n\n## Beds\n- [ ] Dig the north bed\n- [x] Order compost\n- [ ] Plant garlic\n\n## Notes\nThe soil by the fence stays wet.\n\n## Tools\n- Spade\n- Rake\n');
const lines = ['# Big map'];
for (let a = 0; a < 10; a++) { lines.push(`## Topic ${a}`); for (let b = 0; b < 49; b++) lines.push(`- Point ${a}.${b}`); }
fs.writeFileSync(path.join(VAULT, 'Big map.md'), lines.join('\n') + '\n');
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const read = () => fs.readFileSync(NOTE, 'utf8');
const until = async (main, fn, ms = 5000) => { for (let t = 0; t < ms; t += 100) { if (fn()) return true; await main.waitForTimeout(100); } return fn(); };

(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) { main = app.windows().find((x) => x.url().includes('view=app')); if (!main) await new Promise((r) => setTimeout(r, 500)); }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForTimeout(2500);
  const skip = await main.$('.tour button:has-text("Skip tour")');
  if (skip) await skip.click();
  const shot = async (name, dark) => {
    await main.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark).catch(() => undefined);
    await main.waitForTimeout(500);
    await main.screenshot({ path: `${SHOTS}/notes-${name}-${dark ? 'dark' : 'light'}.png` });
  };
  const node = (text) => main.locator('.mm-node:visible', { hasText: text }).first();

  try {
    await main.locator('.sidebar [data-nav-key="nav:notes"]').click();
    await main.getByRole('button', { name: /Open folder as vault/ }).waitFor({ timeout: 15000 });
    await main.evaluate((p) => window.keeper.notes.addVault(p), VAULT);
    await main.locator('.sidebar [data-nav-key="nav:noteshub"]').click().catch(() => undefined);
    await main.locator('.sidebar [data-nav-key="nav:notes"]').click();
    await main.locator('.nt-vault-open', { hasText: 'My Vault' }).click();
    await main.locator('.nt-tree-row[data-path="Garden plan.md"]').click();
    await main.getByRole('button', { name: 'Map', exact: true }).click();
    await main.waitForSelector('[data-testid=mind-map] .mm-node', { timeout: 10000 });
    const texts = await main.locator('.mm-node').allInnerTexts();
    check(texts[0] === 'Garden plan' && ['Beds', 'Notes', 'Tools', 'Dig the north bed', 'Spade'].every((t) => texts.some((x) => x.includes(t))), `headings and list items are branches: ${texts.length}`);
    check(await main.locator('.mm-board [role=treeitem]').count() === texts.length, 'the map is a tree for screen readers');
    await shot('mindmap', false);
    await shot('mindmap', true);

    // Tab adds a branch under; it is written as a heading.
    await main.locator('.mm-board:visible').focus();
    await main.keyboard.press('Home');
    await main.keyboard.press('Tab');
    await main.keyboard.type('Budget');
    await main.keyboard.press('Shift+Enter');
    check(await until(main, () => /\n## Budget\n/.test(read())), 'Tab adds a branch, saved as a heading in the note');

    // F2 renames a list item.
    await node('Dig the north bed').click();
    await main.keyboard.press('F2');
    await main.keyboard.press('Control+a');
    await main.keyboard.type('Dig deep');
    await main.keyboard.press('Enter');
    check(await until(main, () => read().includes('- [ ] Dig deep\n')), 'F2 renames, keeping the checkbox');

    // Enter adds a sibling list item.
    await main.keyboard.press('Enter');
    await main.keyboard.type('Sow peas');
    await main.keyboard.press('Shift+Enter');
    check(await until(main, () => /- \[ \] Dig deep\n- \[ \] Sow peas\n/.test(read())), 'Enter adds a branch beside it');

    // Drag a branch onto another: it moves there in the Markdown.
    const from = await node('Plant garlic').boundingBox();
    const to = await node('Tools').boundingBox();
    await main.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await main.mouse.down();
    await main.mouse.move(from.x + 40, from.y + 40, { steps: 5 });
    await main.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await main.mouse.up();
    check(await until(main, () => /## Tools\n- Spade\n- Rake\n- \[ \] Plant garlic\n/.test(read()) && !/## Beds[\s\S]*Plant garlic[\s\S]*## Notes/.test(read())), 'dragging a branch onto another moves it there');
    check(read().includes('Tulips go in before the first frost.') && read().includes('The soil by the fence stays wet.') && read().startsWith('---\ntags: [garden]\n---\n'), 'text that is not a branch stays where it was');

    // Undo puts it back.
    await main.locator('.mm-board:visible').focus();
    await main.keyboard.press('Control+z');
    check(await until(main, () => /## Beds\n[\s\S]*- \[ \] Plant garlic\n[\s\S]*## Notes/.test(read())), 'Ctrl+Z undoes the move');

    // Space folds a branch.
    await node('Beds').click();
    await main.keyboard.press('Space');
    await main.waitForTimeout(200);
    check(await main.locator('.mm-fold.is-folded').innerText() === '4' && await main.locator('.mm-node', { hasText: 'Order compost' }).count() === 0, 'Space folds a branch and shows how many are inside');
    await main.keyboard.press('Space');

    // Save as PNG and SVG.
    const png = path.join(HOME, 'map.png');
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, png);
    await main.getByRole('button', { name: 'PNG' }).click();
    check(await until(main, () => fs.existsSync(png) && fs.readFileSync(png).subarray(1, 4).toString() === 'PNG'), 'the map saves as a PNG');
    const svg = path.join(HOME, 'map.svg');
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, svg);
    await main.getByRole('button', { name: 'SVG' }).click();
    check(await until(main, () => fs.existsSync(svg) && fs.readFileSync(svg, 'utf8').includes('Garden plan</text>')), 'the map saves as an SVG');

    // A new mind map note opens as a map.
    await main.getByRole('button', { name: 'More', exact: true }).click();
    await main.getByRole('menuitem', { name: 'New mind map' }).click();
    await main.waitForSelector('[data-testid=mind-map] .mm-node:has-text("Second idea")', { timeout: 10000 });
    check(fs.readFileSync(path.join(VAULT, 'Mind map.md'), 'utf8').startsWith('---\nview: mindmap\n---\n# Mind map'), 'New mind map makes a note that opens as a map');

    // 500 branches: drawn and edited quickly.
    await main.locator('.nt-tree-row[data-path="Big map.md"]').click();
    const t0 = Date.now();
    await main.getByRole('button', { name: 'Map', exact: true }).click();
    await main.waitForSelector('.mm-node:has-text("Point 9.48")', { state: 'attached', timeout: 10000 });
    const shown = Date.now() - t0;
    const n = await main.locator('.nt-tab-body:visible .mm-node').count();
    await main.locator('.mm-board:visible').focus();
    await main.keyboard.press('Home');
    const t1 = Date.now();
    await main.keyboard.press('Tab');
    await main.waitForSelector('.mm-edit');
    const edit = Date.now() - t1;
    await main.keyboard.press('Escape');
    check(n === 501 && shown < 3000 && edit < 500, `a 500-branch map shows in ${shown} ms and adds a branch in ${edit} ms`);
    await shot('mindmap-big', false);
  } catch (e) {
    check(false, `step failed: ${e.message.split('\n')[0]}`);
    await main.screenshot({ path: `${SHOTS}/notes-mindmap-failure.png` }).catch(() => undefined);
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
})();
