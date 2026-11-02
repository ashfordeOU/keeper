// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/island.cjs /tmp/ki /tmp/ki-shots
// Drives the real Keeper app: where the Island sits, that a closed Island covers
// only itself, and that activities, the Live Activity card and the panel open and close;
// the open Island's sizes (the window is exactly the panel at each one, the grip snaps)
// the calendars picker (a calendar switched off leaves the Calendar tab and the pill's countdown);
// the deck (never wider than the panel, only the open view named), More, pinning and unpinning.
const { _electron } = require('playwright');
const http = require('http');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const HOME = process.argv[2];
const SHOTS = process.argv[3];
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// The whole X screen, so the transparent Island is seen over the desktop.
const screenshot = (name) => { try { execFileSync('import', ['-window', 'root', path.join(SHOTS, `${name}.png`)]); } catch { /* no ImageMagick */ } };

// Demo calendars: a "Team" file imported into Keeper's own calendar and a subscribed "Public holidays (shared)" link,
// each with an event tomorrow (tomorrow, so it never slips past midnight while the test runs).
const pad = (n) => String(n).padStart(2, '0');
const local = (d, h, m = 0) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`;
const tomorrow = new Date(Date.now() + 86_400_000);
const ics = (events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Keeper test//EN', ...events.flat(), 'END:VCALENDAR', ''].join('\r\n');
const TEAM = ics([
  ['BEGIN:VEVENT', 'UID:standup@island', `DTSTART:${local(tomorrow, 9, 30)}`, `DTEND:${local(tomorrow, 10)}`, 'SUMMARY:Team stand-up', 'END:VEVENT'],
  ['BEGIN:VEVENT', 'UID:review@island', `DTSTART:${local(tomorrow, 14)}`, `DTEND:${local(tomorrow, 15)}`, 'SUMMARY:Design review', 'LOCATION:Room 4', 'END:VEVENT'],
]);
const SHARED = ics([['BEGIN:VEVENT', 'UID:holiday@island', `DTSTART:${local(tomorrow, 11)}`, `DTEND:${local(tomorrow, 12)}`, 'SUMMARY:Shared holiday lunch', 'END:VEVENT']]);

(async () => {
  const feeds = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/calendar' }); res.end(SHARED); });
  await new Promise((r) => feeds.listen(0, '127.0.0.1', r));
  const teamFile = path.join(HOME, 'Downloads', 'team.ics');
  fs.writeFileSync(teamFile, TEAM);
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  let main;
  let isl;
  for (let i = 0; i < 60 && !(main && isl); i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    isl = app.windows().find((w) => w.url().includes('view=island'));
    if (!(main && isl)) await wait(500);
  }
  check(!!isl, 'an Island window opens');
  const errors = [];
  isl.on('pageerror', (e) => errors.push(e.message));
  // Keep the main window out of the way of the screenshots.
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('view=app')) w.minimize(); });
  await wait(2500);

  const islandBounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=island')).getBounds());
  const display = await app.evaluate(({ screen }) => { const d = screen.getPrimaryDisplay(); return { bounds: d.bounds, workArea: d.workArea }; });
  const layout = await isl.evaluate(() => window.keeper.island.layout());
  check(!!layout && layout.edge === 'top', `layout: ${layout?.anchor} — ${layout?.reason}`);

  // Idle: a small pill, top centre, and the window no bigger than the pill.
  let b = await islandBounds();
  const centre = display.bounds.x + display.bounds.width / 2;
  check(Math.abs(b.x + b.width / 2 - centre) <= 1, `centred on the screen (window centre ${b.x + b.width / 2}, screen ${centre})`);
  check(b.y === (display.workArea.y > display.bounds.y ? display.workArea.y : display.bounds.y), `at the top (y=${b.y})`);
  check(b.width <= layout.pill.width + 2 && b.height <= layout.pill.height + 2, `closed window hugs the pill (${b.width}×${b.height}, pill ${layout.pill.width}×${layout.pill.height})`);
  screenshot('1-idle');

  // A focus timer becomes the activity in the pill.
  await isl.evaluate(() => window.keeper.island.focus('start', 25));
  await wait(1800);
  const pillText = await isl.locator('.cmp').innerText();
  check(/2[45]:\d\d/.test(pillText), `timer shows in the pill ("${pillText.replace(/\s+/g, ' ').trim()}")`);
  screenshot('2-timer');

  // A long job reported by Keeper adds a second activity: the bubble.
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event:progress', { task: 'convert', phase: 'holiday.mov', done: 420, total: 1000 }); });
  await wait(900);
  check(await isl.locator('.isl-bubble').count() === 1, 'a second activity shows as a bubble beside the pill');
  b = await islandBounds();
  check(Math.abs(b.x + b.width / 2 - centre) <= 1, `pill stays centred with the bubble (window ${b.width} wide)`);
  screenshot('3-split');

  // Click: the Live Activity card for the timer, in a bigger window.
  await isl.locator('.isl-content').click();
  await wait(900);
  check(await isl.locator('.live-card').count() === 1, 'clicking opens the Live Activity card');
  b = await islandBounds();
  // The open window is the card itself (plus room for its shadow), never a frame around it.
  const hugs = async () => {
    const card = await isl.evaluate(() => { const r = document.querySelector('.isl-content').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    const w = await islandBounds();
    return { ok: w.width >= card.w && w.height >= card.h && w.width - card.w <= 56 && w.height - card.h <= 34, text: `window ${w.width}×${w.height}, Island ${card.w}×${card.h}` };
  };
  let fit = await hugs();
  check(b.width > layout.pill.width + 2 && fit.ok, `the window grows to the card and no further (${fit.text})`);
  screenshot('4-live-card');

  // More: the full panel.
  await isl.locator('.live-card button', { hasText: 'More' }).click();
  await wait(800);
  check(await isl.locator('.isl-panel .tabs').count() === 1, '“More” opens the full panel');
  fit = await hugs();
  check(fit.ok, `the window is the panel and no further (${fit.text})`);
  screenshot('5-panel');

  // ---------------------------------------------------------------- the deck and More
  // The bar is never wider than the panel, and only the open view shows its name.
  const deckFits = () => isl.evaluate(() => {
    const bar = document.querySelector('.tabs.deck');
    const panel = document.querySelector('.isl-content').getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    return { ok: bar.scrollWidth <= bar.clientWidth + 1 && r.right <= panel.right + 1 && r.left >= panel.left - 1, text: `bar ${Math.round(r.width)} (content ${bar.scrollWidth}) in a panel ${Math.round(panel.width)} wide`, labels: [...bar.querySelectorAll('.deck-label')].map((x) => x.textContent), tabs: [...bar.querySelectorAll('.deck-tab')].map((x) => x.getAttribute('title')) };
  });
  let df = await deckFits();
  check(df.ok, `the deck fits the panel (${df.text})`);
  check(df.tabs.slice(0, 4).join() === 'Home,Shelf,Week,Timer' && df.tabs[df.tabs.length - 1] === 'More tools', `the default deck is Home, Shelf, Week, Timer, then More (${df.tabs.join(', ')})`);
  check(df.labels.length === 1 && df.labels[0] === 'Home', `only the open view shows its name (${df.labels.join(', ')})`);
  // The live slot: the timer runs and Timer is pinned, so no slot; a running timer with Timer unpinned borrows one.
  check(await isl.locator('[data-testid="island-live-slot"]').count() === 0, 'no live slot while the live view is pinned');
  await isl.locator('[data-testid="island-more"]').click();
  await wait(700);
  check(await isl.locator('[data-testid="island-more-grid"]').count() === 1, 'More opens a grid of the other tools');
  const cells = await isl.$$eval('.more-open[title]', (els) => els.map((e) => e.getAttribute('title')));
  check(cells.length >= 12 && !cells.includes('Home') && cells.includes('Clipboard'), `More offers the unpinned tools (${cells.length}: ${cells.slice(0, 8).join(', ')}…)`);
  check((await deckFits()).labels.join() === 'More', 'More shows its name while open');
  screenshot('5b-more');
  await isl.screenshot({ path: path.join(SHOTS, '5b-more-island.png') }).catch(() => undefined);
  // Pinning with the deck full asks which to replace; the choice persists.
  await isl.locator('[data-testid="island-pin-notes"]').click();
  await wait(300);
  check(await isl.locator('[data-testid="island-replace"]').count() === 1, 'pinning a fifth tool asks which one to replace');
  await isl.locator('[data-testid="island-replace"] button', { hasText: 'Timer' }).click();
  await wait(900);
  const deckNow = () => isl.evaluate(async () => (await window.keeper.settings.get()).island.deck);
  check(JSON.stringify(await deckNow()) === '["home","shelf","calendar","notes"]', `Notes takes Timer's place on the deck (${JSON.stringify(await deckNow())})`);
  check(await isl.locator('[data-testid="island-live-slot"]').count() === 1, 'the running timer borrows the live slot once Timer is unpinned');
  await isl.locator('.more-slot button[aria-label="Unpin Notes"]').click();
  await wait(900);
  check(JSON.stringify(await deckNow()) === '["home","shelf","calendar"]', `unpinning Notes saves the deck (${JSON.stringify(await deckNow())})`);
  await isl.locator('[data-testid="island-pin-focus"]').click();
  await wait(900);
  check(JSON.stringify(await deckNow()) === '["home","shelf","calendar","focus"]', `pinning Timer again puts it at the end (${JSON.stringify(await deckNow())})`);
  await isl.locator('[data-testid="island-more-clipboard"]').click();
  await wait(600);
  check(await isl.locator('[data-testid="island-back-more"]').count() === 1, 'a tool opened from More offers the way back to More');
  df = await deckFits();
  check(df.ok, `the deck still fits with the way back (${df.text})`);

  // Pointer leaves: back to the pill, and the window shrinks again.
  await isl.mouse.move(5, 300);
  await isl.locator('.isl-content').dispatchEvent('mouseleave');
  await wait(1600);
  b = await islandBounds();
  check(await isl.locator('.cmp').count() === 1 && b.width < 600, `closes back to the pill (${b.width}×${b.height})`);

  // ---------------------------------------------------------------- the open Island's sizes
  // The main window is hidden for the screenshots (without a window manager, minimizing does not), and each
  // shot is also taken of the Island's own page, which shows it whatever is underneath.
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('view=app')) w.hide(); });
  const shot = async (name) => { screenshot(name); await isl.screenshot({ path: path.join(SHOTS, `${name}-island.png`) }).catch(() => undefined); };
  const setIsl = (patch) => main.evaluate(async (p) => { const s = await window.keeper.settings.get(); await window.keeper.settings.set({ island: { ...s.island, ...p } }); }, patch);
  const boxOf = () => isl.evaluate(() => { const st = getComputedStyle(document.querySelector('.isl-root')); return { w: parseFloat(st.getPropertyValue('--box-w')), h: parseFloat(st.getPropertyValue('--box-h')) }; });
  const openTab = async (tab) => { await main.evaluate((t) => window.keeper.island.openTab(t), tab); await wait(1100); };
  // The pointer goes into the open Island and out again (to the shadow's room, or off the window).
  const closeIsland = async () => {
    const r = await isl.evaluate(() => { const b = document.querySelector('.isl-content').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + 20 }; });
    await isl.mouse.move(r.x, r.y);
    await wait(150);
    await isl.mouse.move(2, 2, { steps: 4 });
    await isl.mouse.move(-50, 2000);
    await wait(1400);
  };
  // The window is exactly the panel: the panel itself plus, when a shadow is drawn, the same room for it each time.
  const exact = async () => {
    const box = await boxOf();
    const w = await islandBounds();
    const dw = w.width - box.w;
    const dh = w.height - box.h;
    const ok = (dw === 0 && dh === 0) || (dw === 56 && dh === 34);
    return { ok, box, text: `window ${w.width}×${w.height}, panel ${box.w}×${box.h} (+${dw}, +${dh})` };
  };
  const want = { compact: [560, 260], regular: [640, 300], large: [820, 440], xl: [1000, 580] };
  for (const z of ['compact', 'regular', 'large', 'xl']) {
    await setIsl({ panelSizes: { home: z } });
    await wait(500);
    await openTab('home');
    const e = await exact();
    const fits = e.box.w === Math.min(want[z][0], display.workArea.width - 56) && e.box.h <= want[z][1] + 1 && e.box.h >= Math.min(want[z][1], 200);
    check(e.ok && fits, `${z}: the window is exactly the panel (${e.text})`);
    const fitsHere = await deckFits();
    check(fitsHere.ok, `${z}: the deck fits (${fitsHere.text})`);
    const sizeBtn = (await isl.locator('[data-testid="island-size-btn"]').innerText()).trim();
    check(sizeBtn === { compact: 'S', regular: 'M', large: 'L', xl: 'XL' }[z], `${z}: the size button says ${sizeBtn}`);
    await closeIsland();
    const shut = await islandBounds();
    check(shut.width < 600 && shut.height < 120, `${z}: closes back to the pill (${shut.width}×${shut.height})`);
  }
  await setIsl({ panelSizes: {} });
  await wait(500);

  // Calendar opens Large by default; the grip snaps to the size dragged to, and the size button sets one.
  const team = await main.evaluate((p) => window.keeper.pim.importIcs(p), teamFile);
  const shared = await main.evaluate((u) => window.keeper.pim.subscribe(u, 'Public holidays (shared)'), `http://127.0.0.1:${feeds.address().port}/shared.ics`);
  check(team === 2 && !!shared, `demo calendars: ${team} events imported, “${shared?.name}” subscribed`);
  await wait(1500);
  await openTab('calendar');
  let e = await exact();
  check(e.ok && e.box.w === 820, `Calendar opens Large by default (${e.text})`);
  const agenda = () => isl.locator('[data-testid="island-agenda"]').innerText();
  let text = '';
  for (let i = 0; i < 20 && !/Shared holiday lunch/.test(text); i++) { text = await agenda(); if (!/Shared holiday lunch/.test(text)) await wait(500); }
  check(/Team stand-up/.test(text) && /Shared holiday lunch/.test(text), 'the Calendar tab shows both calendars’ events');
  await isl.mouse.move(400, 100);
  await wait(300);
  await shot('6-calendar-large');
  const grip = isl.locator('[data-testid="island-grip"]');
  const g = await grip.boundingBox();
  await isl.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await isl.mouse.down();
  await isl.mouse.move(g.x + g.width / 2, g.y + g.height / 2 - 70, { steps: 6 });
  await isl.mouse.up();
  // Made smaller, the panel ends above the pointer: it waits a moment for the pointer to come back.
  await wait(300);
  await isl.mouse.move(g.x + g.width / 2 - 100, 120);
  await wait(1200);
  e = await exact();
  check(e.ok && e.box.w === 640, `dragging the grip up snaps to Regular, and the window follows (${e.text})`);
  const saved = await main.evaluate(async () => (await window.keeper.settings.get()).island.panelSizes);
  check(saved?.calendar === 'regular', `the Calendar tab keeps its size (${JSON.stringify(saved)})`);
  await shot('7-calendar-regular');
  await isl.locator('[data-testid="island-size-btn"]').click();
  await isl.locator('.size-menu button', { hasText: 'Extra large' }).click();
  await wait(1200);
  e = await exact();
  check(e.ok && e.box.w === Math.min(1000, display.workArea.width - 56), `the size button makes it Extra large (${e.text})`);
  check(await isl.locator('[data-testid="island-cal-week"]').count() === 1, 'Extra large shows the week beside the month');
  await shot('8-calendar-xl');

  // The calendars picker: switching the shared calendar off takes its events out of the tab and the pill's countdown.
  await isl.locator('[data-testid="island-cal-pick-btn"]').click();
  await wait(400);
  const picker = isl.locator('[data-testid="island-cal-picker"]');
  check(await picker.count() === 1, 'the Calendars button opens the picker');
  const pickerText = await picker.innerText();
  check(/Public holidays \(shared\)/.test(pickerText) && /Show all/.test(pickerText), `the picker lists the calendars by source (${pickerText.replace(/\s+/g, ' ').slice(0, 160)})`);
  await shot('9-calendars-picker');
  await isl.locator('input[aria-label="Show Public holidays (shared) in the Island"]').click();
  await wait(1500);
  text = await agenda();
  check(/Team stand-up/.test(text) && !/Shared holiday lunch/.test(text), 'unticking a calendar removes its events from the Calendar tab');
  const cals = await main.evaluate(() => window.keeper.pim.calendars());
  check(cals.find((c) => c.id === shared.id)?.island === false, 'the choice is the calendar’s own Island switch (it persists)');
  const st = await isl.evaluate(() => window.keeper.island.state());
  check(!st.events.some((x) => /Shared holiday/.test(x.title)) && st.events.some((x) => /Team stand-up/.test(x.title)), `the pill's upcoming events leave it out too (${st.events.map((x) => x.title).join(', ')})`);
  await isl.locator('[data-testid="island-cal-picker"] .cal-pick-head button', { hasText: 'Show all' }).first().click();
  await wait(1500);
  text = await agenda();
  check(/Shared holiday lunch/.test(text), '“Show all” brings it back');
  await closeIsland();
  feeds.close();

  // Bigger in Settings: the layout follows.
  await main.evaluate(async () => { const s = await window.keeper.settings.get(); await window.keeper.settings.set({ island: { ...s.island, size: 'large' } }); });
  await wait(1500);
  const big = await isl.evaluate(() => window.keeper.island.layout());
  check(big.scale > 1, `size "large" scales the Island (${big.scale})`);

  // Finish the job and the timer.
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event:progress', { task: 'convert', phase: 'Done', done: 1, total: 1 }); });
  await isl.evaluate(() => window.keeper.island.focus('stop'));
  await wait(2000);
  check(await isl.locator('.isl-bubble').count() === 0, 'the bubble goes when the job is done');

  const prev = await main.evaluate(() => window.keeper.island.placementPreview());
  check(prev.displays.length >= 1 && prev.wanted.length >= 1, `Settings preview sees ${prev.displays.length} screen(s): ${prev.displays.map((d) => `${d.info.bounds.width}×${d.info.bounds.height} ${d.placement.anchor}`).join(', ')}`);
  check(errors.length === 0, `no page errors in the Island${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
