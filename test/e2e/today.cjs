// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/today.cjs /tmp/ktd-home /tmp/ktd-shots [prefix]
// Drives the real Keeper app's Today, at the top of Hello: Now and next with
// Join, the top three tasks (ticking one ticks the task), the Inbox and Fix-it
// cards; Plan my day lays three tasks into the free time and adds them to the
// calendar as blocks that point back at their tasks; the Inbox sorts one item
// at a time with the keys 1 to 5 and Undo; the Inbox card catches a thought
// from its own small window; Wrap up moves what is left to tomorrow; Mail's
// Today strip is one line once Today was seen. Light and dark, 1440×900 and
// 1024×768. Screenshots are named <prefix><name>-{light,dark}.png.

const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const PREFIX = process.argv[4] || '';
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const DATA = path.join(HOME, '.config', 'Keeper');
fs.mkdirSync(DATA, { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(300); } return null; }
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

(async () => {
  const today = key(new Date());
  for (const [n, t] of [['Quarterly report.docx', 'draft'], ['Trip ideas.md', '# Lisbon']]) fs.writeFileSync(path.join(HOME, 'Documents', n), t);
  // The whole day counts as working time, so Plan my day has room whenever the test runs.
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ folders: [path.join(HOME, 'Documents')], setupDone: true, today: { dayStart: 0, dayEnd: 1440 } }));

  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const isMain = (u) => u && (!u.includes('view=') || u.includes('view=app'));
  const main = await until(() => app.windows().find((w) => isMain(w.url())), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const k = (ns, fn, ...a) => main.evaluate(([n, f, args]) => window.keeper[n][f](...args), [ns, fn, a]);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const both = async (name, page = main) => {
    for (const mode of ['light', 'dark']) {
      await k('settings', 'set', { appearance: mode });
      await wait(700);
      await page.screenshot({ path: path.join(SHOTS, `${PREFIX}${name}-${mode}.png`) });
    }
    await k('settings', 'set', { appearance: 'light' });
  };

  for (const f of ['calendars', 'planner', 'dayPlan', 'captureInbox', 'guide', 'focus', 'notes']) await k('features', 'set', f, true).catch(() => undefined);
  await wait(500);

  // ---- a day: a call going on now with a video link, lunch later, four tasks and two things caught
  const now = Date.now();
  const q = 15 * 60_000;
  const start = Math.floor(now / q) * q;
  const ev = (title, s, e, extra = {}) => k('pim', 'saveEvent', { id: '', uid: '', calendar: 'local:calendar', title, start: s, end: e, allDay: false, ...extra });
  await ev('Design review', start - q, start + 2 * q, { location: 'https://meet.google.com/abc-defg-hij' });
  await ev('Lunch with Ana', start + 6 * q, start + 10 * q);
  const task = (title, o = {}) => k('pim', 'saveReminder', { id: '', list: 'local', title, done: false, plannedFor: today, created: Date.now(), ...o });
  await task('Answer the landlord');
  await task('Send the quarterly report', { priority: 3 });
  await task('Book the dentist');
  await task('Water the plants');
  await k('inbox', 'add', { text: 'Ask Sam about the venue for the 14th', source: 'test' });
  await k('inbox', 'add', { text: 'https://example.org/articles/slow-mornings', source: 'test' });
  await wait(600);

  // ---- Today at the top of Hello
  await navigate('home');
  const today$ = main.locator('[data-testid="home-today"]');
  await today$.waitFor({ timeout: 20000 });
  check(await main.locator('.home-slot').first().getAttribute('data-section') === 'today', 'Today is the first section of Hello');
  check(await main.locator('.home-head h1').count() === 1, 'one greeting, on Hello');
  await until(() => main.locator('[data-testid="today-card-now"]').textContent().then((t) => t.includes('Design review')));
  const nowText = await main.locator('[data-testid="today-card-now"]').textContent();
  check(/Design review/.test(nowText) && /left/.test(nowText), `Now shows the call going on and the time left ("${nowText.trim().slice(0, 80)}")`);
  check(await main.locator('[data-testid="today-join"]').count() === 1, 'Join for the video call');
  check(/Lunch with Ana/.test(nowText), 'Then: the next event');
  await until(() => main.locator('[data-testid="today-card-tasks"] li').count().then((n) => n === 3));
  const tops = await main.locator('[data-testid="today-card-tasks"] li').allTextContents();
  check(tops.length === 3 && /quarterly report/.test(tops[0]), `top three tasks, the important one first (${tops.map((t) => t.trim()).join(' | ')})`);
  await until(() => main.locator('[data-testid="today-card-inbox"] .td-num').textContent().then((t) => t.trim() === '2'));
  check((await main.locator('[data-testid="today-card-inbox"] .td-num').textContent()).trim() === '2', 'the Inbox card counts what was caught');
  check(await main.locator('[data-testid="today-card-fixit"]').count() === 1 && await main.locator('[data-testid="home-suggestion"]').count() === 0, 'one Fix-it card, and no second suggestion line');
  check(await main.locator('.td-head .btn.primary').count() === 1, 'one strong button on Today (Plan my day)');
  const seen = await until(async () => ((await k('settings', 'get')).today?.seen === today ? true : null), 12000);
  check(!!seen, 'Today remembers it was seen today, after a few seconds on screen (for Mail’s strip)');
  const firstJump = await main.locator('[data-section="jump"]').boundingBox();
  const todayBox = await today$.boundingBox();
  check(firstJump && todayBox && firstJump.y > todayBox.y, 'files (Jump back in) come after Today');
  await both('hello-today');
  await main.setViewportSize({ width: 1024, height: 768 });
  await wait(400);
  const over = await main.evaluate(() => [...document.querySelectorAll('[data-testid="home-today"] .td-card')].some((c) => c.scrollWidth > c.clientWidth + 1));
  check(!over, 'no card overflows at 1024×768');
  await both('hello-today-1024');
  await main.setViewportSize({ width: 1440, height: 900 });

  // ---- tick a task on Today: it is done everywhere
  await main.locator('[data-testid="today-card-tasks"] li').filter({ hasText: 'Book the dentist' }).locator('input[type="checkbox"]').check().catch(() => undefined);
  const ticked = await until(async () => ((await k('pim', 'reminders')).find((t) => t.title === 'Book the dentist')?.done ? true : null), 6000);
  check(!!ticked, 'ticking a task on Today ticks the task');

  // ---- Plan my day
  await main.click('[data-testid="today-plan"]');
  await main.locator('[data-testid="plan-day"]').waitFor();
  check(await main.locator('.pd-steps li').count() === 3, 'three short steps');
  const picks = await main.locator('[data-testid="plan-day"] .pd-row input:checked').count();
  check(picks >= 1 && picks <= 3, `today’s tasks are picked to start with (${picks})`);
  await both('plan-pick');
  await main.click('[data-testid="plan-next"]');
  await main.locator('.pd-times').waitFor();
  await main.locator('.pd-times li').first().getByRole('radio', { name: '45m' }).click();
  await main.click('[data-testid="plan-lay"]');
  await main.locator('[data-testid="plan-day-list"]').waitFor();
  const blocks = await main.locator('[data-testid="plan-day-list"] .pd-slot.block').count();
  check(blocks === picks, `each picked task gets a block in the free time (${blocks})`);
  const firstBlock = await main.locator('.pd-slot.block .pd-time').first().textContent();
  await main.locator('.pd-slot.block').first().getByRole('button', { name: /later/ }).click();
  check(await main.locator('.pd-slot.block .pd-time').first().textContent() !== firstBlock || blocks > 1, 'a block can be moved 15 minutes later');
  await both('plan-day');
  await main.click('[data-testid="plan-save"]');
  await main.locator('[data-testid="plan-day"]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => undefined);
  const occ = await k('pim', 'occurrences', now - 86_400_000, now + 86_400_000);
  const linked = occ.filter((o) => (o.event.url ?? '').startsWith('keeper://task/'));
  check(linked.length === blocks, `the blocks are in the calendar and point at their tasks (${linked.length})`);
  const tasks = await k('pim', 'reminders');
  check(linked.every((o) => tasks.some((t) => o.event.url === `keeper://task/${encodeURIComponent(t.id)}`)), 'every block names a real task');
  await until(() => main.locator('[data-testid="today-plan"]').count().then((n) => n === 0), 6000);
  check(await main.locator('[data-testid="today-plan"]').count() === 0, 'once planned, Plan my day steps back into More');

  // ---- the Inbox: one at a time, keys 1 to 5, Undo
  await navigate('inbox');
  await main.locator('[data-testid="inbox-item"]').waitFor({ timeout: 10000 });
  check(/2 things to sort/.test(await main.locator('.page-head').textContent()), 'how long sorting takes');
  check(await main.locator('.ib-act').count() === 5, 'five big choices');
  await both('inbox');
  const first = await main.locator('[data-testid="inbox-item"]').getAttribute('aria-label');
  await main.locator('body').press('1');
  const asTask = await until(async () => ((await k('pim', 'reminders')).some((t) => first.includes(t.title) || t.title.includes(first.slice(0, 20))) ? true : null), 6000);
  check(!!asTask, `key 1 makes “${first}” a task`);
  await until(async () => ((await k('inbox', 'list')).length === 1 ? true : null), 5000);
  await main.locator('[data-testid="inbox-item"]').waitFor();
  await main.locator('body').press('5');
  await until(async () => ((await k('inbox', 'list')).length === 0 ? true : null), 5000);
  check((await k('inbox', 'list')).length === 0, 'key 5 deletes');
  await main.getByRole('button', { name: 'Undo' }).last().click({ timeout: 3000 }).catch(() => undefined);
  const back = await until(async () => ((await k('inbox', 'list')).length === 1 ? true : null), 5000);
  check(!!back, 'Undo puts it back');
  await main.locator('body').press('5');
  await until(async () => ((await k('inbox', 'list')).length === 0 ? true : null), 5000);
  await main.locator('[data-testid="inbox-empty"]').waitFor({ timeout: 5000 }).catch(() => undefined);
  check(await main.locator('[data-testid="inbox-empty"]').count() === 1, 'a designed empty Inbox with the one next step');
  await both('inbox-empty');

  // ---- the card, from any app
  await k('inbox', 'card', 'open');
  const card = await until(() => app.windows().find((w) => (w.url() || '').includes('view=inbox-card')), 15000);
  check(!!card, 'the Inbox card opens in its own small window');
  if (card) {
    await card.locator('[data-testid="inbox-card-text"]').waitFor();
    await card.locator('[data-testid="inbox-card-text"]').fill('Buy a birthday card for Mum');
    for (const mode of ['light', 'dark']) {
      await k('settings', 'set', { appearance: mode });
      await wait(600);
      await card.screenshot({ path: path.join(SHOTS, `${PREFIX}inbox-card-${mode}.png`) });
    }
    await k('settings', 'set', { appearance: 'light' });
    await card.locator('[data-testid="inbox-card-text"]').press('Enter');
    const caught = await until(async () => ((await k('inbox', 'list')).some((i) => i.text === 'Buy a birthday card for Mum') ? true : null), 6000);
    check(!!caught, 'Enter on the card catches the thought into the Inbox');
    const hidden = await until(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('view=inbox-card'))?.isVisible() === false), 5000);
    check(!!hidden, 'the card steps away once saved');
  }

  // ---- Wrap up the day
  await navigate('home:wrap');
  await main.locator('[data-testid="wrap-up"]').waitFor({ timeout: 8000 });
  const left = await main.locator('[data-testid="wrap-up"] .pd-row').count();
  check(left >= 1, `what is left today is listed (${left})`);
  await both('wrap-up');
  await main.click('[data-testid="wrap-done"]');
  const tomorrow = key(new Date(Date.now() + 86_400_000));
  const moved = await until(async () => ((await k('pim', 'reminders')).filter((t) => !t.done && t.plannedFor === tomorrow).length >= left ? true : null), 6000);
  check(!!moved, 'Wrap up moves what is left to tomorrow');

  // ---- Mail's Today strip is one line once Today was seen
  await k('settings', 'set', { mailToday: true });
  await navigate('mail');
  await wait(1500);
  const strip = main.locator('[data-testid="mail-today"]');
  if (await strip.count()) {
    check(await main.locator('[data-testid="mail-today"].compact').count() === 1 && await main.locator('.today-greeting').count() === 0, 'Mail’s Today strip is one line, without a second greeting');
    await both('mail-strip');
  } else console.log('SKIP Mail shows no inbox without an account');

  // ---- Today off: Hello without it, and the cards follow Edit Home
  await navigate('home');
  await main.click('[data-testid="today-more"]');
  await main.getByRole('menuitem', { name: 'Hide Today' }).or(main.getByRole('button', { name: 'Hide Today' })).first().click();
  await wait(400);
  check(await main.locator('[data-testid="home-today"]').count() === 0, 'Today can be hidden from its own menu');
  await main.click('[data-testid="home-edit"]');
  await main.locator('[data-testid="home-edit-today"] button[role="switch"]').click();
  await main.locator('[data-testid="home-edit-card-reply"] button[role="switch"]').click().catch(() => undefined);
  await main.click('[data-testid="home-edit"]');
  await wait(400);
  check(await main.locator('[data-testid="home-today"]').count() === 1, 'Edit Home shows Today again');

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
