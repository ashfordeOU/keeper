// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): dbus-run-session -- xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/cues.cjs /tmp/cues-home /tmp/cues-shots
// Drives the real Keeper app: Cues (dashboard, Markdown files, the popup beside
// a page, the Island tool, a timed cue ringing), Island+ (more agents from a
// status file, other apps' notifications from the desktop bus, the settings),
// in light and dark.
const { _electron } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3]);
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(300); } return null; }

(async () => {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const find = (part) => app.windows().find((w) => w.url().includes(part));
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  const isl = await until(() => find('view=island'), 40000);
  check(!!main && !!isl, 'Keeper and its Island open');
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 30000 });
  await wait(2500);
  const skip = main.locator('.tour button:has-text("Skip tour")');
  if (await skip.count()) await skip.first().click().catch(() => undefined);

  // ---------------------------------------------------------------- the dashboard and its files
  check(await main.locator('.nav-item[title="Cues"]').count() === 1, 'Cues has a sidebar entry (More section)');
  await main.locator('.nav-item[title="Cues"]').click();
  await main.waitForSelector('[data-testid="cues-page"]', { timeout: 15000 });
  const ta = main.locator('[data-testid="cues-page"] [data-testid="cue-composer"] textarea');
  await ta.fill('Review the pull requests on github.com\n- oldest first\n- answer comments');
  await wait(400);
  await main.locator('[data-testid="cues-page"] [data-testid="cue-save"]').click();
  const card = await until(async () => (await main.locator('[data-testid="cue-card"]:has-text("Review the pull requests")').count()) > 0);
  check(!!card, 'a cue typed in the composer shows on the dashboard');
  const folder = path.join(HOME, 'Documents', 'Keeper Cues');
  const files = await until(() => { const f = fs.existsSync(folder) ? fs.readdirSync(folder).filter((n) => n.endsWith('.md')) : []; return f.length ? f : null; });
  const md = files ? fs.readFileSync(path.join(folder, files[0]), 'utf8') : '';
  check(/keeper: "cue"/.test(md) && /site: github\.com/.test(md) && /- \[ \] oldest first/.test(md), `the cue is a plain Markdown file in Documents/Keeper Cues (${files?.[0]})`);
  // Ticking a step is written to the file.
  // (the card may re-render while the save lands; click again until the file shows it)
  const ticked = await until(async () => {
    if (/- \[x\] oldest first/.test(fs.readFileSync(path.join(folder, files[0]), 'utf8'))) return true;
    await main.locator('[data-testid="cue-card"]:has-text("oldest first") .cue-item:not(.done) .cue-tick').first().click({ timeout: 2000 }).catch(() => undefined);
    await wait(700);
    return /- \[x\] oldest first/.test(fs.readFileSync(path.join(folder, files[0]), 'utf8'));
  });
  check(!!ticked, 'ticking a step updates the file');
  // An edit made in another editor (or arriving through Sync) is read back.
  fs.writeFileSync(path.join(folder, files[0]), fs.readFileSync(path.join(folder, files[0]), 'utf8').replace('# Review the pull requests', '# Review the open pull requests'));
  check(!!(await until(async () => (await main.locator('[data-testid="cue-card"]:has-text("Review the open pull requests")').count()) > 0)), 'changes to the file from elsewhere show in Keeper');
  await main.screenshot({ path: path.join(SHOTS, 'cues-dashboard-light.png') });

  // ---------------------------------------------------------------- the popup beside the page it belongs to
  await main.evaluate(() => window.keeper.cues.reportPage('https://github.com/ashforde/keeper/pulls', 'Pull requests'));
  const pop = await until(() => find('view=cue'), 15000);
  check(!!pop, 'arriving on the page opens the cue window beside it');
  if (pop) {
    await pop.waitForSelector('[data-testid="cue-popup"] [data-testid="cue-card"]', { timeout: 10000 }).catch(() => undefined);
    check(await pop.locator('[data-testid="cue-card"]:has-text("Review the open pull requests")').count() === 1, 'the popup shows the cue for that site');
    await pop.screenshot({ path: path.join(SHOTS, 'cues-popup.png') });
  }
  const st = await main.evaluate(() => window.keeper.island.state());
  check(st.cueHere && /Review the open/.test(st.cueHere.title), 'the Island knows a cue belongs here (pill activity)');

  // ---------------------------------------------------------------- the Island's Cues tool
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('view=island')) w.webContents.send('event:island-open', 'cues'); });
  check(!!(await until(async () => (await isl.locator('[data-testid="island-cues"]').count()) > 0)), 'the Island has a Cues tool');
  await wait(600);
  await isl.screenshot({ path: path.join(SHOTS, 'island-cues.png') });

  // ---------------------------------------------------------------- a timed cue rings
  await main.evaluate(() => window.keeper.cues.create({ title: 'Stretch', text: 'Stretch', due: Date.now() + 2500 }));
  const rang = await until(async () => (await main.evaluate(() => window.keeper.island.state())).alerts.some((a) => a.kind === 'cue' && a.title === 'Stretch'), 15000);
  check(!!rang, 'a timed cue rings in the Island when due');
  const all = await main.evaluate(() => window.keeper.cues.list({ filter: 'overdue' }));
  check(all.some((c) => c.title === 'Stretch' && c.rangFor === c.due), 'it rings once for its time and stays overdue until done');
  // Reusable checklist.
  const tpl = await main.evaluate(() => window.keeper.cues.saveTemplate({ name: 'Release', items: ['tag', 'notes', 'publish'] }));
  const run = await main.evaluate((id) => window.keeper.cues.startTemplate(id, { skip: [1] }), tpl.id);
  check(run.items.length === 3 && run.items[1].skipped === true && fs.readdirSync(path.join(folder, 'Checklists')).length === 1, 'a reusable checklist runs with a skipped step and is kept as Markdown');

  // ---------------------------------------------------------------- more agents (status file written by a hook)
  fs.mkdirSync(path.join(HOME, '.keeper', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.keeper', 'agents', 'cursor-demo.json'), JSON.stringify({ tool: 'cursor', cwd: '/work/shop', state: 'Notification', summary: 'Allow running the tests?', updatedAt: Date.now() }));
  const agent = await until(async () => (await main.evaluate(() => window.keeper.island.state())).agents.find((a) => a.tool === 'cursor'), 20000);
  if (!agent) console.log('agents seen:', JSON.stringify((await main.evaluate(() => window.keeper.island.state())).agents));
  check(agent && agent.state === 'waiting' && agent.project === 'shop', 'a Cursor-like agent’s hook status shows in the Island');

  // ---------------------------------------------------------------- other apps' notifications (Linux desktop bus)
  await main.evaluate(() => window.keeper.settings.get().then((s) => window.keeper.settings.set({ island: { ...s.island, notifyMirror: true } })));
  await wait(12000);
  try {
    execFileSync('gdbus', ['call', '--session', '--dest', 'org.freedesktop.Notifications', '--object-path', '/org/freedesktop/Notifications', '--method', 'org.freedesktop.Notifications.Notify', 'Chat', '0', '', 'Ana', 'Lunch at one?', '[]', '{}', '5000'], { timeout: 3000, stdio: 'ignore' });
  } catch { /* no notification server: the call still crosses the bus */ }
  const note = await until(async () => (await main.evaluate(() => window.keeper.island.state())).alerts.find((a) => a.kind === 'notification' && a.title === 'Ana'), 10000);
  check(!!note && note.app === 'Chat', 'another app’s notification appears in the Island (Linux bus)');
  const status = await main.evaluate(() => window.keeper.islandx.status());
  console.log('island+ status:', JSON.stringify(status.notify));
  check(status.notify.mode === 'bus' && status.hud.replaces === false, 'Island+ reports how it works here (notifications: bus; levels shown beside the system pop-up)');

  // ---------------------------------------------------------------- alerts stay inside the bar unless asked for
  const islBounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=island')).getBounds());
  // Close the Island the way the pointer leaving it does.
  await isl.evaluate(() => document.querySelector('.isl-content')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
  await until(async () => (await isl.locator('.isl-content.view-compact').count()) > 0, 5000);
  await wait(1500);
  const before = await islBounds();
  fs.writeFileSync(path.join(HOME, 'Downloads', 'report.pdf'), 'x'.repeat(2048));
  const inline = await until(async () => (await isl.locator('.isl-content .live:has-text("Download finished")').count()) > 0, 20000);
  const during = await islBounds();
  if (!inline) console.log('alerts:', JSON.stringify((await main.evaluate(() => window.keeper.island.state())).alerts.map((a) => [a.kind, a.title])), await isl.evaluate(() => document.querySelector('.isl-content')?.className));
  check(!!inline && !(await isl.locator('.isl-content.view-alert').count()) && during.height <= before.height + 2, `a download alert shows inside the pill, without dropping over windows (${before.height} → ${during.height} px)`);
  await isl.screenshot({ path: path.join(SHOTS, 'island-alert-inline.png') });
  await main.evaluate(() => window.keeper.settings.get().then((s) => window.keeper.settings.set({ island: { ...s.island, alertStyle: 'banner' } })));
  await wait(600);
  fs.writeFileSync(path.join(HOME, 'Downloads', 'notes.txt'), 'y'.repeat(2048));
  const banner = await until(async () => (await isl.locator('.isl-content.view-alert').count()) > 0, 20000);
  check(!!banner, 'with “Alerts: as a banner below it”, alerts drop down as before');
  await main.evaluate(() => window.keeper.settings.get().then((s) => window.keeper.settings.set({ island: { ...s.island, alertStyle: 'notch' } })));

  // ---------------------------------------------------------------- settings pages, light and dark
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (/view=app|^[^?]*$/.test(w.webContents.getURL()) || !w.webContents.getURL().includes('view=')) w.webContents.send('event:navigate', 'island'); });
  check(!!(await until(async () => (await main.locator('[data-testid="island-plus-settings"]').count()) > 0)), 'Settings → Island has the calls, levels, agents and looks sections');
  await main.locator('[data-testid="island-plus-settings"]').scrollIntoViewIfNeeded();
  await main.screenshot({ path: path.join(SHOTS, 'island-plus-settings-light.png') });
  await main.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await wait(800);
  await main.screenshot({ path: path.join(SHOTS, 'island-plus-settings-dark.png') });
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (/view=app|^[^?]*$/.test(w.webContents.getURL()) || !w.webContents.getURL().includes('view=')) w.webContents.send('event:navigate', 'cues'); });
  await wait(1000);
  await main.screenshot({ path: path.join(SHOTS, 'cues-dashboard-dark.png') });
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (/view=app|^[^?]*$/.test(w.webContents.getURL()) || !w.webContents.getURL().includes('view=')) w.webContents.send('event:navigate', 'cues:settings'); });
  await wait(800);
  await main.screenshot({ path: path.join(SHOTS, 'cues-settings-dark.png') });
  // A small window still reads well.
  await main.setViewportSize({ width: 820, height: 640 }).catch(() => undefined);
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (/view=app|^[^?]*$/.test(w.webContents.getURL()) || !w.webContents.getURL().includes('view=')) { w.setSize(820, 640); w.webContents.send('event:navigate', 'cues'); } });
  await wait(800);
  await main.screenshot({ path: path.join(SHOTS, 'cues-dashboard-small.png') });
  const wide = await main.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(wide, 'the Cues page has no sideways scrolling in a small window');

  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
