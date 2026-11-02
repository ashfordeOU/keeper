// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/calendar.cjs /tmp/kp-cal /tmp/kp-cal-shots
// Drives the real Keeper app: an imported .ics file and a subscribed link
// (served here) show in the Island's Calendar tab; the Island's old
// "calendar link" setting becomes a subscription; quick add writes to a local
// CalDAV server; the next meeting counts down in the Island with Join; the
// Calendar page and its sources render in light and dark.
const { _electron } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { startCalDav } = require('../servers/caldav.cjs');

const HOME = path.resolve(process.argv[2] || '/tmp/kp-cal');
const SHOTS = path.resolve(process.argv[3] || '/tmp/kp-cal-shots');
fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const root = (name) => { try { execFileSync('import', ['-window', 'root', path.join(SHOTS, `${name}.png`)]); } catch { /* no ImageMagick */ } };

const pad = (n) => String(n).padStart(2, '0');
const local = (d, h, m = 0) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`;
const date = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const today = new Date();
const tomorrow = new Date(Date.now() + 86_400_000);
const dayAfter = new Date(Date.now() + 2 * 86_400_000);
const ics = (events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Keeper test//EN', ...events.flat(), 'END:VCALENDAR', ''].join('\r\n');

// The meeting starts in 8 minutes so the Island counts down to it.
const soon = new Date(Date.now() + 8 * 60_000);
const soonEnd = new Date(soon.getTime() + 30 * 60_000);
const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const IMPORT = ics([
  ['BEGIN:VEVENT', 'UID:design@import', `DTSTART:${utc(soon)}`, `DTEND:${utc(soonEnd)}`, 'SUMMARY:Design review', 'LOCATION:https://us02web.zoom.us/j/85012345678', 'END:VEVENT'],
  ['BEGIN:VEVENT', 'UID:offsite@import', `DTSTART;VALUE=DATE:${date(today)}`, `DTEND;VALUE=DATE:${date(dayAfter)}`, 'SUMMARY:Team offsite', 'END:VEVENT'],
  // Repeats daily in New York time; one occurrence is today or tomorrow either way.
  ['BEGIN:VEVENT', 'UID:daily@import', `DTSTART;TZID=America/New_York:${local(new Date(Date.now() - 3 * 86_400_000), 23, 30)}`, 'DURATION:PT15M', 'RRULE:FREQ=DAILY;COUNT=10', 'SUMMARY:Night check', 'END:VEVENT'],
]);
const SUBSCRIBED = ics([['BEGIN:VEVENT', 'UID:yoga@sub', `DTSTART:${local(tomorrow, 7, 30)}`, `DTEND:${local(tomorrow, 8, 30)}`, 'SUMMARY:Yoga class', 'END:VEVENT']]);
const ISLAND_LINK = ics([['BEGIN:VEVENT', 'UID:dentist@old', `DTSTART:${local(tomorrow, 16)}`, `DTEND:${local(tomorrow, 17)}`, 'SUMMARY:Dentist (old Island link)', 'END:VEVENT']]);

(async () => {
  const feeds = http.createServer((req, res) => {
    const body = req.url.startsWith('/yoga.ics') ? SUBSCRIBED : req.url.startsWith('/island.ics') ? ISLAND_LINK : null;
    if (!body) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/calendar' });
    res.end(body);
  });
  await new Promise((r) => feeds.listen(0, '127.0.0.1', r));
  const feedBase = `http://127.0.0.1:${feeds.address().port}`;
  const dav = await startCalDav();
  const icsFile = path.join(HOME, 'Downloads', 'team.ics');
  fs.writeFileSync(icsFile, IMPORT);

  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  let main;
  let isl;
  for (let i = 0; i < 60 && !(main && isl); i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    isl = app.windows().find((w) => w.url().includes('view=island'));
    if (!(main && isl)) await wait(500);
  }
  const errors = [];
  main.on('pageerror', (e) => errors.push(`main: ${e.message}`));
  isl.on('pageerror', (e) => errors.push(`island: ${e.message}`));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await wait(1500);
  const k = (fn, arg) => main.evaluate(fn, arg);

  // ---------------------------------------------------------------- import and subscribe
  const n = await k((p) => window.keeper.pim.importIcs(p), icsFile);
  check(n === 3, `the .ics file was imported (${n} events)`);
  const sub = await k((u) => window.keeper.pim.subscribe(u, 'Yoga studio'), `webcal://127.0.0.1:${new URL(feedBase).port}/yoga.ics`.replace('webcal://', 'http://'));
  check(sub && sub.readOnly && sub.name === 'Yoga studio', 'a calendar link is subscribed to (read only)');
  // The Island's old single calendar link becomes one of the subscriptions.
  await k(async (u) => { const s = await window.keeper.settings.get(); await window.keeper.settings.set({ island: { ...s.island, calendarUrl: u } }); }, `${feedBase}/island.ics`);
  let cals = [];
  for (let i = 0; i < 30; i++) {
    cals = await k(() => window.keeper.pim.calendars());
    if (cals.some((c) => c.name === 'Calendar link')) break;
    await wait(300);
  }
  check(cals.some((c) => c.name === 'Calendar link' && c.readOnly), 'the Island’s old calendar link is now a subscription in the list');
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const occ = await k(([a, b]) => window.keeper.pim.occurrences(a, b), [from.getTime(), from.getTime() + 2 * 86_400_000]);
  const titles = occ.map((o) => o.event.title);
  check(['Design review', 'Team offsite', 'Yoga class', 'Dentist (old Island link)'].every((t) => titles.includes(t)) && titles.filter((t) => t === 'Night check').length >= 1, `occurrences include imported, repeating and subscribed events (${[...new Set(titles)].join(', ')})`);
  const offsite = occ.find((o) => o.event.title === 'Team offsite');
  check(offsite?.event.allDay && offsite.end - offsite.start >= 47 * 3_600_000, 'the two-day all-day event spans two days');

  // ---------------------------------------------------------------- quick add to CalDAV
  await k((u) => window.keeper.pim.addAccount({ kind: 'caldav', caldav: u, davUser: 'ana', password: 'secret', label: 'Home server' }), dav.url);
  let work;
  for (let i = 0; i < 30 && !work; i++) {
    work = (await k(() => window.keeper.pim.calendars())).find((c) => c.name === 'Work');
    if (!work) await wait(400);
  }
  check(!!work, 'the CalDAV calendars were found');
  const added = await k(([t, c]) => window.keeper.pim.quickAdd(t, c), ['Lunch with Sam tomorrow 1pm', work?.id]);
  const onServer = [...dav.cals['/dav/cal/ana/work/'].items.values()].map((x) => x.data);
  const t1 = new Date(added?.start ?? 0);
  check(onServer.some((d) => /SUMMARY:Lunch with Sam/.test(d)) && t1.getHours() === 13 && t1.getDate() === tomorrow.getDate(), 'quick add “Lunch with Sam tomorrow 1pm” was written to the CalDAV server at 13:00 tomorrow');

  // ---------------------------------------------------------------- the Island: countdown and agenda
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('view=app')) w.minimize(); });
  let st;
  for (let i = 0; i < 20; i++) {
    st = await isl.evaluate(() => window.keeper.island.state());
    if (st.events.some((e) => e.title === 'Design review')) break;
    await wait(500);
  }
  const next = st.events.find((e) => e.title === 'Design review');
  check(!!next && /zoom\.us\/j\/85012345678/.test(next.url ?? ''), 'the next meeting reaches the Island with its Zoom link');
  await wait(1500);
  const pill = await isl.locator('.cmp').innerText().catch(() => '');
  check(/Design review|[78]m/.test(pill), `the meeting counts down in the Island (“${pill.replace(/\s+/g, ' ').trim()}”)`);
  root('1-island-countdown');
  await isl.locator('.isl-content').click().catch(() => {});
  await wait(900);
  const card = isl.locator('.live-card');
  check(await card.locator('button', { hasText: 'Join' }).count() === 1, 'the meeting card offers Join');
  root('2-island-meeting-card');
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('view=island')) w.webContents.send('event:island-open', 'calendar'); });
  await isl.waitForSelector('[data-testid="island-agenda"]', { timeout: 10_000 }).catch(() => {});
  await wait(1200);
  const agenda = await isl.locator('[data-testid="island-agenda"]').innerText().catch(() => '');
  check(/Today[\s\S]*Team offsite[\s\S]*Design review[\s\S]*Tomorrow[\s\S]*Yoga class/.test(agenda), 'the Island’s Calendar tab shows today (imported) and tomorrow (subscribed)');
  check(/Lunch with Sam/.test(agenda) && /Dentist \(old Island link\)/.test(agenda), 'the quick-added event and the old Island link are in tomorrow’s agenda');
  check(await isl.locator('[data-testid="island-agenda-item"]', { hasText: 'Design review' }).locator('button', { hasText: 'Join' }).count() === 1, 'the agenda offers Join for the Zoom meeting');
  root('3-island-calendar-tab');
  // Quick add from the Island into a chosen calendar.
  await isl.fill('[aria-label="Quick add an event"]', 'Call the bank tomorrow 10am');
  const sel = isl.locator('[aria-label="Calendar for new events"]');
  if (await sel.count()) await sel.selectOption(work.id);
  await isl.press('[aria-label="Quick add an event"]', 'Enter');
  await wait(1500);
  const onServer2 = [...dav.cals['/dav/cal/ana/work/'].items.values()].map((x) => x.data);
  check(onServer2.some((d) => /SUMMARY:Call the bank/.test(d)), 'quick add in the Island wrote to the chosen CalDAV calendar');
  check(/Call the bank/.test(await isl.locator('[data-testid="island-agenda"]').innerText()), 'and it shows in the agenda');
  // Hiding a calendar from the Island takes its events out of the tab.
  await k((id) => window.keeper.pim.setCalendar(id, { island: false }), sub.id);
  await wait(1200);
  check(!/Yoga class/.test(await isl.locator('[data-testid="island-agenda"]').innerText()), '“Show in Island” off hides that calendar’s events from the Island');
  await k((id) => window.keeper.pim.setCalendar(id, { island: true }), sub.id);

  // ---------------------------------------------------------------- the Calendar page and Settings, light and dark
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes('view=app')) { w.restore(); w.show(); } });
  for (const mode of ['light', 'dark']) {
    await k(async (m) => { await window.keeper.settings.set({ appearance: m }); }, mode);
    await wait(700);
    await main.click('.sidebar [title="Calendar"]');
    await wait(900);
    await main.locator('.seg button', { hasText: 'Agenda' }).click();
    await wait(700);
    const txt = await main.locator('.cal-main').innerText();
    check(/Design review/.test(txt) && /Yoga class/.test(txt), `the Calendar page agenda shows the events (${mode})`);
    const bg = await main.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const dark = (() => { const m = bg.match(/\d+/g).map(Number); return (m[0] + m[1] + m[2]) / 3 < 100; })();
    check(dark === (mode === 'dark'), `the page is drawn ${mode} (${bg})`);
    await main.screenshot({ path: path.join(SHOTS, `4-calendar-agenda-${mode}.png`) });
    await main.locator('.cal-side button', { hasText: 'Add or connect calendars' }).click();
    await main.waitForSelector('[data-testid="calendar-sources"]', { timeout: 5000 }).catch(() => {});
    check(await main.locator('[data-testid="calendar-sources"]').count() === 1, `the calendar sources open (${mode})`);
    await main.screenshot({ path: path.join(SHOTS, `5-calendar-sources-${mode}.png`) });
    await main.keyboard.press('Escape');
    await wait(300);
  }
  // Holidays: a country chosen in the sources becomes a calendar.
  await k(() => window.keeper.pim.setPrefs({ holidayCountry: 'GB' }));
  const withHolidays = await k(() => window.keeper.pim.calendars());
  check(withHolidays.some((c) => c.id === 'holidays:GB' && c.readOnly), 'choosing holidays adds a read-only holidays calendar');
  const access = await k(() => window.keeper.pim.systemAccess());
  check(!!access && typeof access.message === 'string', `this computer’s calendars: ${access?.state} (${access?.via ?? '-'})`);

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await app.close();
  feeds.close();
  await dav.stop();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
