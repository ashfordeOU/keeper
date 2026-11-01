// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a node test/e2e/notes.cjs /tmp/kn /tmp/kn-shots
// Drives the real Keeper app on a vault made the way other notes apps make
// them (with a .obsidian settings folder): open it, write a note with a
// [[link]] and see the backlink, rename a note and see links follow, make
// today's daily note from the template, make a canvas and check the file,
// check a base view and a search operator, and ask the vault with a stand-in
// AI that cites a note.
const { _electron } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const HOME = process.argv[2];
const SHOTS = process.argv[3];
const ROOT = path.resolve(__dirname, '../..');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const DATA = path.join(HOME, '.config', 'Keeper');
const VAULT = path.join(HOME, 'Documents', 'My Vault');
const w = (rel, text) => { const p = path.join(VAULT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(HOME, 'Downloads'), { recursive: true });

w('.obsidian/app.json', JSON.stringify({ newLinkFormat: 'shortest', attachmentFolderPath: 'Attachments', alwaysUpdateLinks: true, trashOption: 'local' }));
w('.obsidian/daily-notes.json', JSON.stringify({ folder: 'Daily', format: 'YYYY-MM-DD', template: 'Templates/Daily' }));
w('.obsidian/templates.json', JSON.stringify({ folder: 'Templates' }));
w('.obsidian/core-plugins.json', JSON.stringify(['file-explorer', 'daily-notes', 'templates', 'canvas', 'bases']));
w('Welcome.md', '---\ntags: [start]\n---\n# Welcome\n\nThe plan lives in [[Old name]] and [[Old name#Steps|its steps]].\n');
w('Old name.md', '# Old name\n\n## Steps\n- [ ] Plant bulbs before the first frost\n');
w('Garden plan.md', '---\ntags: [project]\n---\n# Garden plan\n\nTulip bulbs go in before the first frost, in October.\n');
w('Templates/Daily.md', '# {{date:dddd}}\n\n## Plan\n- [ ] \n');
w('Books/Dune.md', '---\ntags: [book]\nauthor: Frank Herbert\nstatus: done\n---\n');
w('Books/Emma.md', '---\ntags: [book]\nauthor: Jane Austen\nstatus: reading\n---\n');
w('Books/Hyperion.md', '---\ntags: [book]\nauthor: Dan Simmons\nstatus: done\n---\n');
w('Books.base', 'filters:\n  and:\n    - file.hasTag("book")\n    - \'status == "done"\'\nviews:\n  - type: table\n    name: Finished\n    order:\n      - file.name\n      - author\n');

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const read = (rel) => fs.readFileSync(path.join(VAULT, rel), 'utf8');
const pad = (n) => String(n).padStart(2, '0');
const today = new Date();
const DAILY = `Daily/${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.md`;
const WEEKDAY = today.toLocaleDateString('en-US', { weekday: 'long' });

// A stand-in AI: cites the first note it was given.
const seen = [];
const ai = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    seen.push(body);
    const all = body.messages.map((m) => m.content).join('\n');
    const first = (all.match(/### \[\[([^\]]+)\]\]/) || [])[1] || 'nothing';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `Plant the bulbs before the first frost [[${first}]].` }, finish_reason: 'stop' }] }));
  });
});

(async () => {
  await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const port = ai.address().port;
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({
    folders: [path.join(HOME, 'Downloads')],
    brain: { enabled: true, semantic: false, visibility: 'full', active: 'mock', pauseOnBattery: false, connections: [{ id: 'mock', kind: 'openai-compatible', label: 'Test AI', model: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1` }] },
  }));
  fs.mkdirSync(path.join(DATA, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'notes', 'settings.json'), JSON.stringify({ ai: true }));

  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) {
    main = app.windows().find((x) => x.url().includes('view=app'));
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
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

  try {
    // 1. Open the vault (made by another notes app) through the page.
    await main.locator('.sidebar').getByText('Notes', { exact: true }).first().click();
    await main.getByRole('button', { name: /Open folder as vault/ }).waitFor({ timeout: 15000 });
    await main.evaluate((p) => window.keeper.notes.addVault(p), VAULT);
    await main.locator('.sidebar').getByText('Notes Everywhere').first().click().catch(() => undefined);
    await main.locator('.sidebar').getByText('Notes', { exact: true }).first().click();
    await main.locator('.nt-vault-open', { hasText: 'My Vault' }).click();
    await main.waitForSelector('[data-testid=notes-root] .nt-tree-row[data-path="Welcome.md"]', { timeout: 15000 });
    const rows = await main.locator('.nt-tree-row').allInnerTexts();
    check(rows.some((r) => r.includes('Books')) && rows.some((r) => r.includes('Welcome')) && !rows.some((r) => r.includes('.obsidian')), `the vault opens with its files (and not its settings folder): ${rows.length} rows`);
    const shared = await main.evaluate(async () => (await window.keeper.notes.vaults())[0]);
    check(shared.shared === true, 'Keeper sees that the vault is shared with another notes app');

    // 2. A new note with a [[link]]; the backlink shows on the linked note.
    await main.getByRole('button', { name: 'New note' }).first().click();
    await main.getByRole('textbox', { name: 'Rename' }).fill('Fresh idea');
    await main.keyboard.press('Enter');
    await main.waitForSelector('.nt-tree-row[data-path="Fresh idea.md"]', { timeout: 10000 });
    await main.locator('[data-testid=note-editor] .cm-content').click();
    await main.keyboard.type('This builds on [[Welcome');
    await main.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 }).catch(() => undefined);
    check(await main.locator('.cm-tooltip-autocomplete').isVisible().catch(() => false), 'typing [[ offers matching notes');
    await main.keyboard.type(']]');
    await main.keyboard.press('Escape');
    await main.keyboard.type(' and #idea/new.');
    await main.waitForTimeout(1200);
    const fresh = read('Fresh idea.md');
    check(fresh.includes('[[Welcome]]'), `the note is saved as plain Markdown with the link: ${JSON.stringify(fresh)}`);
    await main.locator('.nt-tree-row[data-path="Welcome.md"]').click();
    await main.getByRole('tab', { name: 'Links' }).click();
    await main.waitForSelector('[data-testid=links-panel] .nt-backlink >> text=Fresh idea', { timeout: 10000 });
    check(true, 'the backlink from “Fresh idea” shows on Welcome');
    await shot('backlinks', false);

    // 3. Rename a note: links to it follow.
    await main.locator('.nt-tree-row[data-path="Old name.md"]').click({ button: 'right' });
    await main.getByText('Rename…', { exact: true }).click();
    await main.getByRole('textbox', { name: 'Rename' }).fill('Spring plan');
    await main.keyboard.press('Enter');
    await main.waitForSelector('.nt-tree-row[data-path="Spring plan.md"]', { timeout: 10000 });
    await main.waitForTimeout(500);
    const welcome = read('Welcome.md');
    check(welcome.includes('[[Spring plan]]') && welcome.includes('[[Spring plan#Steps|its steps]]') && !welcome.includes('Old name'), `links were updated on rename: ${JSON.stringify(welcome.split('\n')[5])}`);
    check(!fs.existsSync(path.join(VAULT, 'Old name.md')) && fs.existsSync(path.join(VAULT, 'Spring plan.md')), 'the file itself was renamed on disk');

    // 4. Today's daily note from the template.
    await main.getByRole('button', { name: 'Daily note' }).click();
    await main.waitForSelector(`.nt-tree-row[data-path="${DAILY}"]`, { timeout: 10000 });
    const daily = read(DAILY);
    check(daily.startsWith(`# ${WEEKDAY}`) && daily.includes('## Plan'), `the daily note ${DAILY} was made from the template: ${JSON.stringify(daily.split('\n')[0])}`);

    // 5. A canvas, saved as a valid .canvas file.
    await main.locator('.nt-ribbon').getByTitle('New canvas').click();
    await main.waitForSelector('[data-testid=canvas-board]', { timeout: 10000 });
    await main.getByRole('button', { name: 'Add card' }).click();
    await main.waitForSelector('.nt-cv-edit', { timeout: 5000 });
    await main.keyboard.type('Hello canvas');
    await main.locator('[data-testid=canvas-board]').click({ position: { x: 40, y: 40 } });
    await main.waitForTimeout(900);
    const canvasFile = fs.readdirSync(VAULT).find((f) => f.endsWith('.canvas'));
    let canvas = null;
    try { canvas = JSON.parse(read(canvasFile)); } catch { /* checked below */ }
    const node = canvas && canvas.nodes && canvas.nodes[0];
    check(!!canvas && Array.isArray(canvas.edges) && node && node.type === 'text' && node.text === 'Hello canvas' && /^[0-9a-f]{16}$/.test(node.id) && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(node[k])), `the canvas is saved as JSON Canvas (${canvasFile}): ${JSON.stringify(node)}`);
    await shot('canvas', false);

    // 6. A base view filters, and a search operator finds notes.
    await main.locator('.nt-tree-row[data-path="Books.base"]').click();
    await main.waitForSelector('[data-testid=base-view] tbody tr', { timeout: 10000 });
    const baseRows = await main.locator('[data-testid=base-view] tbody tr').allInnerTexts();
    check(baseRows.length === 2 && baseRows.some((r) => r.includes('Dune')) && baseRows.some((r) => r.includes('Hyperion')) && !baseRows.some((r) => r.includes('Emma')), `the base shows only finished books: ${baseRows.map((r) => r.split('\t')[0]).join(', ')}`);
    await shot('base', false);
    await main.getByRole('tab', { name: 'Search' }).click();
    await main.getByRole('textbox', { name: 'Search notes' }).fill('tag:#book [status:reading]');
    await main.waitForSelector('.nt-hit-title', { timeout: 10000 });
    await main.waitForTimeout(500);
    const hits = await main.locator('.nt-hit-title').allInnerTexts();
    check(hits.length === 1 && hits[0].includes('Emma'), `search with tag: and [property:value] finds Emma: ${hits.join(', ')}`);
    await main.getByRole('textbox', { name: 'Search notes' }).fill('path:Books/ -Dune');
    await main.waitForTimeout(800);
    const hits2 = await main.locator('.nt-hit-title').allInnerTexts();
    check(hits2.length === 2 && !hits2.some((h) => h.includes('Dune')), `path: with -negation: ${hits2.join(', ')}`);
    await shot('search', false);

    // 7. Ask the vault (stand-in AI); the answer cites a note.
    await main.getByRole('tab', { name: 'Files' }).click();
    await main.locator('.nt-tree-row[data-path="Garden plan.md"]').click();
    await main.getByRole('tab', { name: 'Ask AI' }).click();
    await main.getByRole('textbox', { name: 'Ask your notes' }).fill('When should the tulip bulbs go in?');
    await main.getByRole('button', { name: 'Ask', exact: true }).click();
    await main.waitForSelector('.nt-cite', { timeout: 20000 });
    const cite = await main.locator('.nt-cite').first().innerText();
    check(/Garden plan/.test(cite), `the answer cites the note: ${cite.trim()}`);
    check(seen.some((b) => b.messages.some((m) => m.content.includes('first frost'))), 'the AI was given the text of the matching note');

    // Reading view with callouts, math and a diagram; light and dark.
    w('Showcase.md', '# Showcase\n\n> [!tip] Callouts work\n> With **bold** and a [[Welcome]] link.\n\n$$e^{i\\pi}+1=0$$\n\n```mermaid\ngraph LR\n  A-->B\n```\n\n- [x] done\n- [ ] todo ==highlight==\n');
    await main.waitForSelector('.nt-tree-row[data-path="Showcase.md"]', { timeout: 10000 });
    check(true, 'a note written by another app appears in the file tree (the vault is followed while open)');
    await main.locator('.nt-tree-row[data-path="Showcase.md"]').click();
    await main.getByRole('button', { name: 'Read', exact: true }).click();
    await main.waitForSelector('.nt-reading .callout', { timeout: 10000 });
    await main.waitForSelector('.nt-reading .katex', { timeout: 10000 });
    await main.waitForSelector('.nt-reading .nt-mermaid svg', { timeout: 15000 }).catch(() => undefined);
    check(await main.locator('.nt-reading .katex').count() > 0, 'math is drawn with KaTeX');
    check(await main.locator('.nt-reading .nt-mermaid svg').count() > 0, 'the Mermaid diagram is drawn');
    await main.getByRole('tab', { name: 'Links' }).click();
    await shot('reading', false);
    await shot('reading', true);
    await main.locator('.nt-tree-row[data-path="Welcome.md"]').click();
    await main.getByRole('button', { name: 'Live', exact: true }).click();
    await main.waitForTimeout(600);
    await shot('editor', true);
    await shot('editor', false);
  } catch (e) {
    check(false, `step failed: ${e.message.split('\n')[0]}`);
    await main.screenshot({ path: `${SHOTS}/notes-failure.png` }).catch(() => undefined);
  }

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
  ai.close();
})();
