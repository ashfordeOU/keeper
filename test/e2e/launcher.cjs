// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/launcher.cjs /tmp/kl-home /tmp/kl-shots
// Drives the real Keeper app: Quick Search as a launcher (a sum copied, an app
// from a .desktop file opened and ranked by use, a saved link, a Keeper action,
// your own command run with its output copied), clipboard sets and pasting one
// by one (lined up in the picker, collected while copying, the Island's count),
// Typed Snippets (a snippet saved with placeholders, its preview, the listener's
// status in plain words) and the selection bar (translated by a stand-in AI),
// in light and dark.
const { _electron } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const HOME = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3]);
const ROOT = path.resolve(__dirname, '../..');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const DATA = path.join(HOME, '.config', 'Keeper');
fs.mkdirSync(DATA, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

// An app the launcher finds: a .desktop file whose program leaves a mark.
const MARK = path.join(HOME, 'lighthouse-opened');
const APPS = path.join(HOME, '.local', 'share', 'applications');
fs.mkdirSync(APPS, { recursive: true });
fs.writeFileSync(path.join(APPS, 'lighthouse-notes.desktop'), `[Desktop Entry]\nType=Application\nName=Lighthouse Notes\nGenericName=Notebook\nKeywords=journal;writing;\nExec=sh -c "touch ${MARK}" %U\nTerminal=false\n`);
fs.writeFileSync(path.join(APPS, 'hidden-helper.desktop'), '[Desktop Entry]\nType=Application\nName=Hidden Helper\nExec=true\nNoDisplay=true\n');

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }

// A stand-in AI that translates by rule.
const asked = [];
const ai = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const all = (body.messages ?? []).map((m) => m.content).join('\n');
    asked.push(all);
    const content = /Translate this/.test(all) ? 'Good morning, everyone. The meeting starts at nine.' : /Explain what this means/.test(all) ? 'morning (noun): the early part of the day.' : 'Morning, all: we start at nine.';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
  });
});

(async () => {
  await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const port = ai.address().port;
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({
    folders: [path.join(HOME, 'Downloads')],
    setupDone: true,
    features: { textSnippets: true, selectionBar: true },
    brain: { enabled: false, semantic: false, active: 'mock', pauseOnBattery: false, connections: [{ id: 'mock', kind: 'openai-compatible', label: 'Test AI', model: 'mock-1', baseUrl: `http://127.0.0.1:${port}/v1` }] },
    launcher: { calc: true, currency: false, links: [{ id: 'map', keyword: 'map', name: 'Map', url: 'https://www.openstreetmap.org/search?query={query}' }], commands: [{ id: 'hi', name: 'Say hello', keyword: 'hi', command: 'echo hello {query}', confirm: false, output: 'copy' }] },
  }));

  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/.bin/electron'),
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share', KEEPER_TEST_SELECTION: 'Guten Morgen zusammen. Das Treffen beginnt um neun.' },
  });
  const errors = [];
  const find = (part) => app.windows().find((w) => w.url().includes(part));
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  check(!!main, 'Keeper opens');
  main.on('pageerror', (e) => errors.push('main: ' + e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 30000 });
  await wait(2000);
  const skip = main.locator('.tour button:has-text("Skip tour")');
  if (await skip.count()) await skip.first().click().catch(() => undefined);
  const clip = () => app.evaluate(({ clipboard }) => clipboard.readText());
  const setClip = (t) => app.evaluate(({ clipboard }, x) => clipboard.writeText(x), t);
  const theme = async (dark) => { await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark); await wait(500); };

  // A small window, shown over the app at full size (1440×900), as it floats over the desktop.
  async function composite(png, name, dark, where = 'center') {
    await main.evaluate(([b64, w]) => {
      const o = document.createElement('div');
      o.id = 'e2e-float';
      o.style.cssText = `position:fixed;inset:0;z-index:99999;display:flex;justify-content:center;align-items:${w === 'top' ? 'flex-start' : 'center'};padding-top:${w === 'top' ? '150px' : '0'};background:rgba(0,0,0,.18)`;
      const img = document.createElement('img');
      img.src = `data:image/png;base64,${b64}`;
      img.style.cssText = 'filter:drop-shadow(0 18px 40px rgba(0,0,0,.35))';
      o.appendChild(img);
      document.body.appendChild(o);
    }, [png.toString('base64'), where]);
    await wait(300);
    await main.screenshot({ path: path.join(SHOTS, `${name}-${dark ? 'dark' : 'light'}.png`) });
    await main.evaluate(() => document.getElementById('e2e-float')?.remove());
  }

  try {
    // ---------------------------------------------------------------- Quick Search as a launcher
    // Quick Search's window closes when a result is opened; the shortcut makes it again.
    let quick;
    let box;
    const openQuick = async () => {
      await app.evaluate(({ app: a }) => a.emit('open-url', { preventDefault() {} }, 'keeper://quick'));
      quick = await until(() => app.windows().find((w) => w.url().includes('view=quick') && !w.isClosed()), 15000);
      if (!quick) return;
      quick.on('pageerror', (e) => errors.push('quick: ' + e.message));
      box = quick.locator('input[role="combobox"]');
      await box.waitFor({ timeout: 15000 });
    };
    await openQuick();
    check(!!quick, 'Quick Search opens');
    const type = async (t) => { await box.fill(''); await box.fill(t); };
    const enter = () => box.press('Enter').catch(() => undefined);

    await type('12*(3+4)');
    const answer = await until(async () => (await quick.locator('[data-testid="quick-launch-answer"]').first().textContent()) ?? '');
    check(/= 84/.test(answer ?? ''), `a sum is answered first (${answer?.slice(0, 30)})`);
    check((await quick.locator('[data-testid="quick-launch"] [role="option"]').first().getAttribute('aria-selected')) === 'true', 'the answer is the chosen row, so Enter takes it');
    await enter();
    check(!!(await until(async () => (await clip()) === '84')), 'Enter copies the answer');

    await openQuick();
    await type('5 ft in cm');
    check(!!(await until(async () => /152\.4 cm/.test((await quick.locator('[data-testid="quick-launch-answer"]').first().textContent()) ?? ''))), 'conversions come from the same converter as the Island');
    await type('20 usd in eur');
    check(!!(await until(async () => /Converting currencies is off/.test((await quick.locator('[data-testid="quick-launch"]').textContent()) ?? ''))), 'currency says it is off until turned on (nothing downloaded)');

    await type('lighthouse');
    const appRow = await until(async () => (await quick.locator('[data-testid="quick-launch-app"]:has-text("Lighthouse Notes")').count()) > 0, 20000);
    check(!!appRow, 'an app from a .desktop file is found');
    await type('hidden helper');
    await wait(800);
    check((await quick.locator('[data-testid="quick-launch-app"]').count()) === 0, 'apps marked hidden are left out');
    await type('journal');
    check(!!(await until(async () => (await quick.locator('[data-testid="quick-launch-app"]:has-text("Lighthouse Notes")').count()) > 0)), 'apps are found by their keywords too');
    await type('note');
    await until(async () => (await quick.locator('[data-testid="quick-launch-app"]').count()) > 0);
    await wait(600);
    await quick.screenshot({ path: path.join(SHOTS, 'quick-launcher.png') });
    const quickPng = await quick.screenshot({ omitBackground: true });
    await type('lighthouse');
    await until(async () => (await quick.locator('[data-testid="quick-launch-app"]').count()) > 0);
    await enter();
    check(!!(await until(() => fs.existsSync(MARK), 10000)), 'Enter opens the app');
    const uses = await until(() => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'launcher-uses.json'), 'utf8')); } catch { return null; } }, 8000);
    check(!!uses && Object.keys(uses).some((k) => k.startsWith('app:desktop:lighthouse-notes')), 'what was opened is remembered on this computer, to rank it higher');

    await openQuick();
    await type('map berlin');
    check(!!(await until(async () => /Map: berlin/.test((await quick.locator('[data-testid="quick-launch-link"]').first().textContent()) ?? ''))), 'a saved link fills in what follows its word');
    await type('screenshot');
    check(!!(await until(async () => (await quick.locator('[data-testid="quick-launch-action"]:has-text("Take a screenshot")').count()) > 0)), 'Keeper’s own actions are commands too');
    await type('hi world');
    check(!!(await until(async () => (await quick.locator('[data-testid="quick-launch-command"]:has-text("Say hello: world")').count()) > 0)), 'your own command is found by its word');
    await enter();
    check(!!(await until(async () => (await clip()) === 'hello world')), 'the command ran with the typed words (quoted) and what it printed was copied');

    await theme(false);
    await composite(quickPng, 'launcher-launcher', false, 'top');
    await openQuick();
    await type('note');
    await until(async () => (await quick.locator('[data-testid="quick-launch-app"]').count()) > 0);
    await theme(true);
    await wait(400);
    const quickDark = await quick.screenshot({ omitBackground: true });
    await composite(quickDark, 'launcher-launcher', true, 'top');
    await quick.keyboard.press('Escape').catch(() => undefined);
    await quick.keyboard.press('Escape').catch(() => undefined);
    await theme(false);

    // ---------------------------------------------------------------- clipboard sets and pasting one by one
    for (const t of ['12 High Street, London', 'Thanks for your message!', 'ana@example.com']) { await setClip(t); await wait(1300); }
    const st0 = await main.evaluate(() => window.keeper.island.state());
    check(st0.clips.length >= 3, `copies are kept (${st0.clips.length})`);
    await main.evaluate(() => window.keeper.island.openClips());
    const picker = await until(() => find('view=clips'), 10000);
    check(!!picker, 'the clipboard picker opens');
    picker.on('pageerror', (e) => errors.push('clips: ' + e.message));
    await picker.waitForSelector('[data-testid="clip-row"]', { timeout: 10000 });
    // File the newest clip in a new set.
    await picker.keyboard.press('Control+s');
    await picker.waitForSelector('[data-testid="clip-menu"]', { timeout: 5000 });
    await picker.locator('[data-testid="clip-menu"] button:has-text("New set")').click();
    await picker.locator('[data-testid="clip-menu"] input').fill('Addresses');
    await picker.locator('[data-testid="clip-menu"] input').press('Enter');
    check(!!(await until(async () => (await picker.locator('[data-testid="clip-sets"] button:has-text("Addresses")').count()) > 0)), 'a set made from the picker shows as a chip');
    const st1 = await main.evaluate(() => window.keeper.island.state());
    check(st1.clips.some((c) => (c.collections ?? []).includes('Addresses')), 'the clip is filed in it');
    await picker.keyboard.press('Escape');
    // Line two up with Space, in the order chosen.
    await picker.locator('input').first().click();
    await picker.keyboard.press('ArrowDown');
    await picker.keyboard.press(' ');
    await picker.keyboard.press('ArrowUp');
    await picker.keyboard.press(' ');
    check(!!(await until(async () => (await picker.locator('[data-testid="clip-queue-bar"]').count()) > 0)), 'lined-up clips show a bar to paste them one by one');
    await picker.screenshot({ path: path.join(SHOTS, 'clips-lined-up.png') });
    const pickPng = await picker.screenshot({ omitBackground: true });
    await composite(pickPng, 'launcher-clipboard', false);
    await theme(true);
    await wait(500);
    await composite(await picker.screenshot({ omitBackground: true }), 'launcher-clipboard', true);
    await theme(false);
    await picker.locator('[data-testid="clip-queue-bar"] button:has-text("Paste one by one")').click();
    const q1 = await until(async () => (await main.evaluate(() => window.keeper.island.state())).pasteQueue);
    check(q1 && q1.left === 2 && !q1.collecting, `the queue holds the two, ready (${JSON.stringify(q1)})`);
    check((await clip()) === 'Thanks for your message!', 'the first one chosen is on the clipboard, so the next paste takes it');
    const isl = find('view=island');
    if (isl) {
      const acts = await main.evaluate(() => window.keeper.island.state());
      check(!!acts.pasteQueue, 'the Island knows how many are left');
    }
    await main.evaluate(() => window.keeper.island.queueNext());
    const q2 = await until(async () => { const s = await main.evaluate(() => window.keeper.island.state()); return s.pasteQueue && s.pasteQueue.left === 1 ? s.pasteQueue : null; });
    check(!!q2, '“Paste next” pastes one and moves on: 1 left');
    check(!!(await until(async () => (await clip()) === 'ana@example.com')), 'the next one chosen is on the clipboard now');
    await main.evaluate(() => window.keeper.island.queueNext());
    check(!!(await until(async () => !(await main.evaluate(() => window.keeper.island.state())).pasteQueue)), 'after the last one the queue ends');
    // Collect while copying: the first copy stays ready on the clipboard.
    await main.evaluate(() => window.keeper.island.queueStart());
    await setClip('first line'); await wait(1300);
    await setClip('second line'); await wait(1300);
    const q3 = (await main.evaluate(() => window.keeper.island.state())).pasteQueue;
    check(q3 && q3.collecting && q3.left === 2, `copies made while collecting join the queue (${JSON.stringify(q3)})`);
    check((await clip()) === 'first line', 'the first copy stays ready on the clipboard');
    await main.evaluate(() => window.keeper.island.queueStop());
    check(!(await main.evaluate(() => window.keeper.island.state())).pasteQueue, 'Stop ends the queue');
    // Never keep copies from an app.
    const gone = await main.evaluate(() => window.keeper.island.neverKeepFrom('Secret App'));
    const s2 = await main.evaluate(() => window.keeper.settings.get());
    check(s2.island.clipIgnoreApps.includes('Secret App') && typeof gone === 'number', 'an app can be left out of clipboard history');

    // ---------------------------------------------------------------- Typed Snippets
    await main.locator('.nav-item[title="Typed Snippets"]').first().click().catch(async () => main.evaluate(() => window.dispatchEvent(new Event('noop'))));
    if (!(await main.locator('[data-testid="snippets-page"]').count())) await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().includes('view=') || w.webContents.getURL().includes('view=app')) w.webContents.send('event:navigate', 'snippets'); });
    await main.waitForSelector('[data-testid="snippets-page"]', { timeout: 15000 });
    await main.locator('[data-testid="snippet-abbr"]').fill(';sig');
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await main.locator('[data-testid="snippet-text"]').fill('Best wishes,\nAna\n{date iso}');
    check(!!(await until(async () => ((await main.locator('[data-testid="snippet-preview"]').textContent()) ?? '').includes(`Ana\n${iso}`))), 'the preview fills in the placeholders (today’s date)');
    await main.locator('[data-testid="snippet-save"]').click();
    check(!!(await until(async () => (await main.locator('[data-testid="snippets-table"] code:has-text(";sig")').count()) > 0)), 'the snippet is listed');
    const vs = await main.evaluate(() => window.keeper.voice.settings());
    check(vs.snippets.some((s) => s.abbr === ';sig' && /Ana/.test(s.text)), 'it is kept in the same list as Dictation’s snippets');
    const status = await until(async () => { const t = (await main.locator('[data-testid="snippets-status"]').textContent()) ?? ''; return /Ready in every app|Not listening yet/.test(t) ? t : null; });
    check(!!status, `the page says plainly whether it can listen here (${status?.slice(0, 120)})`);
    await wait(3500); // the toast goes
    await theme(false);
    await main.screenshot({ path: path.join(SHOTS, 'launcher-snippets-light.png') });
    await theme(true);
    await main.screenshot({ path: path.join(SHOTS, 'launcher-snippets-dark.png') });
    await theme(false);
    // A smaller window, too.
    await main.setViewportSize({ width: 1024, height: 768 }).catch(() => undefined);
    await wait(400);
    await main.screenshot({ path: path.join(SHOTS, 'snippets-1024.png') });
    await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
    await wait(300);

    // ---------------------------------------------------------------- the selection bar
    const view = await main.evaluate(() => window.keeper.selection.show());
    check(/Guten Morgen/.test(view.text) && view.actions.includes('translate'), `the selection bar reads the selected text (${view.how})`);
    const bar = await until(() => find('view=selection'), 10000);
    check(!!bar, 'the bar opens beside the pointer');
    bar.on('pageerror', (e) => errors.push('selection: ' + e.message));
    await bar.waitForSelector('[data-testid="sel-translate"]', { timeout: 10000 });
    await bar.locator('[data-testid="sel-translate"]').click();
    check(!!(await until(async () => /Good morning, everyone/.test((await bar.locator('[data-testid="sel-result"]').textContent()) ?? ''), 15000)), 'Translate shows the chosen AI’s answer with Replace and Copy');
    check(asked.some((a) => /Guten Morgen/.test(a) && /Translate this into/.test(a)), 'only the selected text was sent, after the button was pressed');
    await wait(400);
    await composite(await bar.screenshot({ omitBackground: true }), 'launcher-selection', false);
    await theme(true);
    await wait(500);
    await composite(await bar.screenshot({ omitBackground: true }), 'launcher-selection', true);
    await theme(false);
    await bar.locator('button:has-text("Copy")').last().click();
    check(!!(await until(async () => /Good morning/.test(await clip()))), 'Copy puts the answer on the clipboard');

    check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  } catch (e) {
    check(false, `script: ${e.stack || e}`);
  } finally {
    await app.close().catch(() => undefined);
    ai.close();
  }
})();
