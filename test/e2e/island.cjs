// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/island.cjs /tmp/ki /tmp/ki-shots
// Drives the real Keeper app: where the Island sits, that a closed Island covers
// only itself, and that activities, the Live Activity card and the panel open and close;
// the open Island's sizes (the window is exactly the panel at each one, the grip snaps)
// the calendars picker (a calendar switched off leaves the Calendar tab and the pill's countdown);
// the deck (never wider than the panel, only the open view named), More, pinning and unpinning;
// the open model (the breath at once, the window grown while it waits, open after the rest, content out
// before the shape shrinks) and no animation frames at rest; power (a 3-second notice on unplug and plug-in,
// one battery glyph with its percentage, no cut-off words) and that opening always gives the full Island with
// its deck, also from a notice, an activity or a notice that dropped down by itself.
// The Island's window runs in Keeper's own process here (KEEPER_SUITE=shared), where this test
// reaches it; test/e2e/suite.cjs checks the Island in a process of its own.
const { _electron } = require('playwright');
const http = require('http');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const HOME = process.argv[2];
const SHOTS = process.argv[3];
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

// Under xvfb the real pointer starts in the middle of the screen. On a smaller screen (1440 × 900) a Large
// panel grows over it, and the page sees the pointer leave the Island. Park it in a corner (needs xdotool).
try { require('child_process').execFileSync('xdotool', ['mousemove', '0', '0'], { stdio: 'ignore' }); } catch { /* no xdotool or no X */ }
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
  // The battery the Island reads (KEEPER_TEST_BATTERY, never in official builds): plugged in at first.
  const battFile = path.join(HOME, 'battery.json');
  const setBattery = (b) => fs.writeFileSync(battFile, JSON.stringify(b));
  setBattery({ percent: 100, charging: true });
  fs.writeFileSync(teamFile, TEAM);
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_TEST_BATTERY: battFile, XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
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

  // Click: the full Island with its deck, opened into the timer's own view (Open into: the live activity).
  await isl.locator('.isl-content').click();
  await wait(900);
  check(await isl.locator('.isl-panel .tabs.deck').count() === 1 && await isl.locator('[data-testid="island-more"]').count() === 1, 'clicking opens the full Island with its deck and More');
  check(await isl.locator('[data-testid="island-tab-focus"][aria-selected="true"], .deck-live.on').count() === 1, 'it opens into the timer’s own view');
  b = await islandBounds();
  // The open window is the card itself (plus room for its shadow), never a frame around it.
  const hugs = async () => {
    const card = await isl.evaluate(() => { const r = document.querySelector('.isl-content').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    const w = await islandBounds();
    return { ok: w.width >= card.w && w.height >= card.h && w.width - card.w <= 56 && w.height - card.h <= 34, text: `window ${w.width}×${w.height}, Island ${card.w}×${card.h}` };
  };
  let fit = await hugs();
  check(b.width > layout.pill.width + 2 && fit.ok, `the window grows to the panel and no further (${fit.text})`);
  screenshot('4-open-from-activity');
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
  check(df.labels.length === 1 && df.labels[0] === 'Timer', `only the open view shows its name (${df.labels.join(', ')})`);
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
  // (Just after the panel changed size a leave waits longer, 1.5 s, for the pointer to come back.)
  await wait(2600);
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

  // ---------------------------------------------------------------- the open model and the springs
  // Nothing runs on animation frames once the Island is closed and still (the springs stop at rest).
  await isl.evaluate(() => {
    if (window.__rafWrapped) return;
    window.__rafWrapped = true;
    window.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__raf++; return raf(cb); };
  });
  const rafs = () => isl.evaluate(() => window.__raf);
  // Hovering uses the real (X) pointer: the window grows as the pointer arrives, and Playwright's own pointer
  // would stay at the same place in the page (off the Island once it is wider), where a real one stays on the screen.
  const realPointer = async (x, y) => {
    const wb = await islandBounds();
    try { execFileSync('xdotool', ['mousemove', String(Math.round(wb.x + x)), String(Math.round(wb.y + y))]); } catch { await isl.mouse.move(x, y); }
  };
  const parkPointer = () => { try { execFileSync('xdotool', ['mousemove', '0', '0']); } catch { /* no xdotool */ } };
  await setIsl({ hoverOpen: true, hoverDelayMs: 450 });
  await wait(1500);
  await isl.evaluate(() => { window.__raf = 0; });
  await wait(2000);
  let idleFrames = await rafs();
  check(idleFrames === 0, `no animation frames while the Island is closed and idle (${idleFrames} in 2 s)`);
  // The pointer arrives: the shape grows a little at once and the window grows to the open size; it opens after the rest.
  const shapeW = () => isl.evaluate(() => { const el = document.querySelector('.isl-shape'); const m = /inset\(\S+ ([\d.]+)px/.exec(el.style.clipPath || ''); return m ? el.getBoundingClientRect().width - 2 * parseFloat(m[1]) : 0; });
  const w0 = await shapeW();
  const bw0 = (await islandBounds()).width;
  const pill = await isl.evaluate(() => { const r = document.querySelector('.isl-content').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const t0 = Date.now();
  await realPointer(pill.x, pill.y);
  await wait(150);
  const breathing = await isl.evaluate(() => document.querySelector('.isl-root').classList.contains('breath') && !document.querySelector('.live-card, .isl-panel'));
  const w1 = await shapeW();
  const bw1 = (await islandBounds()).width;
  check(breathing && w1 > w0, `the pointer arriving grows the shape at once, before it opens (${Math.round(w0)} → ${Math.round(w1)} px)`);
  check(bw1 > bw0, `the window grows to the open size while it waits (${bw0} → ${bw1})`);
  for (let i = 0; i < 60 && !(await isl.locator('.live-card, .isl-panel').count()); i++) await wait(25);
  const opened = Date.now() - t0;
  check(await isl.locator('.live-card, .isl-panel').count() === 1 && opened >= 400, `then it opens after the rest (${opened} ms after arriving, delay 450)`);
  check(await rafs() > 0, 'the motion runs on animation frames');
  await wait(900);
  const opacity = () => isl.evaluate(() => getComputedStyle(document.querySelector('.isl-in')).opacity);
  check(await opacity() === '1', 'the content shows once the shape is open');
  // Leaving: the content fades out before the shape starts to shrink.
  parkPointer();
  await isl.mouse.move(-50, 2000);
  await isl.locator('.isl-content').dispatchEvent('mouseleave');
  await wait(260);
  const fading = await isl.evaluate(() => ({ o: getComputedStyle(document.querySelector('.isl-in')).opacity, open: !!document.querySelector('.live-card, .isl-panel') }));
  check(fading.open && Number(fading.o) < 1, `the content fades before the shape shrinks (opacity ${fading.o}, still open)`);
  await wait(1600);
  check(await isl.locator('.cmp').count() === 1, 'then it closes to the pill');
  await isl.evaluate(() => { window.__raf = 0; });
  await wait(2000);
  idleFrames = await rafs();
  check(idleFrames === 0, `and no animation frames run after the close has settled (${idleFrames} in 2 s)`);
  // A quick sweep across does not open it (the breath shows, the panel does not).
  await isl.mouse.move(0, pill.y);
  await isl.mouse.move(pill.x * 2, pill.y, { steps: 6 });
  await isl.mouse.move(-50, 2000);
  await isl.locator('.isl-content').dispatchEvent('mouseleave');
  await wait(900);
  check(await isl.locator('.live-card, .isl-panel').count() === 0, 'a pointer passing straight across does not open it');
  await setIsl({ hoverDelayMs: 140 });
  await wait(800);

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

  // ---------------------------------------------------------------- power, and opening from a notice
  await closeIsland();
  const pillState = () => isl.evaluate(() => {
    const cmp = document.querySelector('.cmp');
    if (!cmp) return null;
    const batt = cmp.querySelector('[data-testid="island-battery"]');
    const word = cmp.querySelector('[data-testid="island-wing-power"]');
    // Nothing in the closed Island is cut off: no "…", and no element (but a label hidden whole) wider than its box.
    const cut = [...cmp.querySelectorAll('*')].filter((el) => !el.classList.contains('nofit') && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow === 'hidden' && el.textContent.trim()).map((el) => el.className);
    return {
      text: cmp.innerText.replace(/\s+/g, ' ').trim(),
      batt: batt ? { label: batt.getAttribute('aria-label'), pct: batt.innerText.replace(/\s+/g, ''), color: batt.style.getPropertyValue('--batt') } : null,
      word: word ? { text: word.textContent, fits: word.dataset.fits, visible: getComputedStyle(word).visibility !== 'hidden' } : null,
      ellipsis: /…/.test(cmp.innerText), cut,
    };
  });
  const powerEvent = (ev) => app.evaluate(({ powerMonitor }, e) => powerMonitor.emit(e), ev);
  // Unplugged: "On battery" and one battery glyph with 100%, for about 3 s.
  setBattery({ percent: 100, charging: false });
  await powerEvent('on-battery');
  let ps = null;
  const tUnplug = Date.now();
  for (let i = 0; i < 40 && !(ps = await pillState())?.batt; i++) await wait(50);
  check(!!ps?.batt && /100/.test(ps.batt.pct) && /Battery 100%/.test(ps.batt.label), `unplugging shows the battery glyph with its percentage (${JSON.stringify(ps?.batt)})`);
  check(!!ps?.word && ps.word.text === 'On battery' && (ps.word.fits === 'yes') === ps.word.visible, `the notice names itself only when the words fit whole (${JSON.stringify(ps?.word)})`);
  check(ps && !ps.ellipsis && ps.cut.length === 0, `nothing in the closed Island is cut off (“${ps?.text}”${ps?.cut.length ? `; cut: ${ps.cut.join(', ')}` : ''})`);
  check(ps && (ps.text.match(/battery/gi) || []).length <= 1, `no glyph and words saying the same thing twice (“${ps?.text}”)`);
  await shot('power-1-unplug-notice');
  for (let i = 0; i < 80 && (await pillState())?.batt; i++) await wait(100);
  const gone = Date.now() - tUnplug;
  ps = await pillState();
  check(!ps?.batt && gone >= 2500 && gone <= 4500, `the notice goes after about 3 s (${gone} ms) and on battery shows nothing (“${ps?.text}”)`);
  await shot('power-2-closed-on-battery');
  // "Always show battery": the glyph stays (only when nothing else is going on).
  await setIsl({ alwaysBattery: true });
  await wait(900);
  ps = await pillState();
  check(!!ps?.batt && /100%/.test(ps.batt.pct) && !ps.word && !ps.ellipsis, `“Always show battery” keeps just the glyph and 100% (${JSON.stringify(ps?.batt)})`);
  await shot('power-3-always-battery');
  await setIsl({ alwaysBattery: false });
  // Low: red, and it stays.
  setBattery({ percent: 15, charging: false });
  await powerEvent('on-battery');
  await wait(900);
  ps = await pillState();
  check(!!ps?.batt && /15/.test(ps.batt.pct) && ps.batt.color.trim() === '#ff453a', `a low battery stays, in red (${JSON.stringify(ps?.batt)})`);
  // Plugged in: "Charging" in green; opening while the notice shows gives the full Island, the notice a banner.
  setBattery({ percent: 84, charging: true });
  await powerEvent('on-ac');
  for (let i = 0; i < 40 && (ps = await pillState())?.word?.text !== 'Charging'; i++) await wait(50);
  check(ps?.word?.text === 'Charging' && ps.batt?.color.trim() === '#30d158' && /84/.test(ps.batt.pct), `plugging in shows Charging and 84% in green (${JSON.stringify(ps)})`);
  await shot('power-4-plug-in-notice');
  await isl.locator('.isl-content').click();
  await wait(700);
  check(await isl.locator('.isl-panel .tabs.deck').count() === 1 && await isl.locator('[data-testid="island-more"]').count() === 1, 'opening while the notice shows gives the full Island with its deck and More');
  check(await isl.locator('[data-testid="island-live-banner"][data-kind="charging"]').count() === 1, 'the notice shows as a banner above the view');
  await shot('power-5-open-with-notice');
  await closeIsland();
  setBattery({ percent: 84, charging: true });

  // Keep Awake (an activity with its own buttons): hovering opens the full Island, the activity a banner with them.
  await isl.evaluate(() => window.keeper.island.keepAwake(true));
  await wait(1200);
  const awakeShown = /awake/i.test((await isl.locator('.isl-content').getAttribute('aria-label')) || '');
  const pc = await isl.evaluate(() => { const r = document.querySelector('.isl-content').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await realPointer(pc.x, pc.y);
  for (let i = 0; i < 40 && !(await isl.locator('.isl-panel').count()); i++) await wait(50);
  await wait(600);
  check(await isl.locator('.isl-panel .tabs.deck').count() === 1 && await isl.locator('[data-testid="island-more"]').count() === 1, 'hovering while an activity shows opens the full Island with its deck');
  if (awakeShown) {
    const banner = isl.locator('[data-testid="island-live-banner"][data-kind="awake"]');
    check(await banner.count() === 1 && await banner.locator('button', { hasText: 'Stop keeping awake' }).count() === 1, 'Keep Awake shows as a banner with its buttons');
    await shot('open-with-activity');
    // Clicking the banner shows the activity in full, still with the deck.
    await banner.locator('.live-banner-main').click();
    await wait(500);
    check(await isl.locator('[data-testid="island-live-card"]').count() === 1 && await isl.locator('.isl-panel .tabs.deck').count() === 1, 'the banner opens the activity in full inside the Island, deck and all');
  } else console.log('NOTE Keep Awake is not available here; its banner was not checked');
  parkPointer();
  await closeIsland();
  await isl.evaluate(() => window.keeper.island.keepAwake(false));
  await wait(800);

  // A notice in the pill: hovering opens the full Island, the notice a banner above the view.
  await main.evaluate(() => window.keeper.islandx.testNotification());
  await wait(900);
  check(await isl.locator('.cmp').count() === 1 && /notifications look/.test(await isl.locator('.cmp').innerText()), 'a notification shows in the closed Island');
  await isl.locator('.isl-content').click();
  await wait(700);
  check(await isl.locator('.isl-panel .tabs.deck').count() === 1 && await isl.locator('[data-testid="island-live-banner"][data-kind="alert"]').count() === 1, 'opening from a notification gives the full Island, the notification a banner');
  await closeIsland();
  // A notice that drops down by itself (Alerts: as a banner) is the small card; a click on it opens the full Island.
  await setIsl({ alertStyle: 'banner' });
  await wait(600);
  await main.evaluate(() => window.keeper.islandx.testNotification());
  for (let i = 0; i < 40 && !(await isl.locator('[data-testid="island-alert-card"]').count()); i++) await wait(50);
  check(await isl.locator('[data-testid="island-alert-card"]').count() === 1 && await isl.locator('.isl-panel').count() === 0, 'a notice drops down by itself as the small card');
  await shot('drop-down-notice');
  await isl.locator('[data-testid="island-alert-card"] b').first().click();
  await wait(800);
  check(await isl.locator('.isl-panel .tabs.deck').count() === 1 && await isl.locator('[data-testid="island-more"]').count() === 1 && await isl.locator('[data-testid="island-live-banner"][data-kind="alert"]').count() === 1, 'a click on the dropped-down notice opens the full Island');
  await shot('open-from-drop-down');
  await closeIsland();
  await setIsl({ alertStyle: 'notch' });
  await wait(6500);

  const prev = await main.evaluate(() => window.keeper.island.placementPreview());
  check(prev.displays.length >= 1 && prev.wanted.length >= 1, `Settings preview sees ${prev.displays.length} screen(s): ${prev.displays.map((d) => `${d.info.bounds.width}×${d.info.bounds.height} ${d.placement.anchor}`).join(', ')}`);
  check(errors.length === 0, `no page errors in the Island${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
