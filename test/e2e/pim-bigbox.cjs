// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux, Dovecot installed): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/pim-bigbox.cjs /tmp/kp-big /tmp/kp-big-shots [count]
// Drives the real Keeper app against a Dovecot mailbox of 50,000 messages (or
// [count]): the account's folders, nested ones included, show with the right
// unread numbers; the inbox opens quickly and draws a page at a time;
// scrolling to the bottom draws more and then fetches older mail from the
// server by itself; the frame rate stays smooth while scrolling; search finds
// old mail on the server. The mailbox is removed afterwards.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const { startDovecot, fillMaildir } = require('../servers/dovecot.cjs');

const HOME = path.resolve(process.argv[2] || '/tmp/kp-big');
const SHOTS = path.resolve(process.argv[3] || '/tmp/kp-big-shots');
const COUNT = Number(process.argv[4]) || 50_000;
fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dovecot = await startDovecot();
  if (!dovecot) { console.log('SKIP Dovecot is not installed'); process.exit(0); }
  try {
    let t0 = Date.now();
    fillMaildir(dovecot, COUNT);
    console.log(`wrote ${COUNT} messages in ${Date.now() - t0} ms`);
    const root = path.resolve(__dirname, '../..');
    const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/.bin/electron'), args: [root, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SKIP_TOUR: '1', KEEPER_SUITE: 'shared', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
    let main;
    for (let i = 0; i < 60 && !main; i++) {
      main = app.windows().find((w) => { const u = w.url(); return !u.includes('view=') || u.includes('view=app'); });
      if (!main) await wait(500);
    }
    const errors = [];
    main.on('pageerror', (e) => errors.push(e.message));
    await main.waitForSelector('.sidebar', { timeout: 60_000 });
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().includes('view=') || w.webContents.getURL().includes('view=app')) { w.setSize(1440, 900); w.center(); w.show(); } });
    const k = (fn, arg) => main.evaluate(fn, arg);
    await k(() => window.keeper.pim.setPrefs({ splitInbox: false }));
    await k((port) => window.keeper.pim.addAccount({ kind: 'imap', email: 'ana@example.org', name: 'Ana', password: 'secret', imap: { host: '127.0.0.1', port, security: 'none', user: 'ana' } }), dovecot.port);
    await main.click('.sidebar [title="Mail"]');
    t0 = Date.now();
    await main.waitForSelector('.mail-row', { timeout: 120_000 });
    const firstMs = Date.now() - t0;
    check(firstMs < 30_000, `the inbox shows within ${firstMs} ms`);
    const acct = (await k(() => window.keeper.pim.accounts()))[0];
    // The account's own inbox, as a list of messages.
    await k(() => { const b = [...document.querySelectorAll('.mail-folder')].find((x) => x.title === 'INBOX'); b?.click(); });
    await wait(1500);
    const folders = await k(() => window.keeper.pim.folders());
    const inbox = folders.find((f) => f.account === acct.id && f.path === 'INBOX');
    check(inbox && inbox.total === COUNT && inbox.unread === Math.ceil(COUNT / 3), `the inbox counts ${inbox?.total} messages, ${inbox?.unread} unread`);
    check(folders.some((f) => f.account === acct.id && /Projects.2026$/.test(f.path) && f.unread === 40), 'the nested folder is listed with its unread number');
    const unreadShown = await main.locator('[data-testid="mail-account-unread"]').first().innerText().catch(() => '');
    check(unreadShown.replace(/\D/g, '') === String(Math.ceil(COUNT / 3)), `the account shows its unread number (${unreadShown})`);
    const drawn = await main.locator('.mail-row').count();
    check(drawn > 0 && drawn <= 150, `only the first page is drawn (${drawn} rows)`);
    await main.screenshot({ path: path.join(SHOTS, 'big-inbox.png') });

    // Scroll to the bottom again and again: more rows, then older mail from the server, smoothly.
    const before = (await k((a) => window.keeper.pim.messages({ account: a, folder: 'INBOX' }), acct.id)).messages.length;
    await k(() => { window.__frames = []; let last = performance.now(); const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < 100000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    for (let i = 0; i < 40; i++) {
      await k(() => { const el = document.querySelector('.mail-rows'); const sc = el && (el.closest('.mail-list') ?? el); for (const x of [el, sc, el?.parentElement]) if (x) x.scrollTop = x.scrollHeight; });
      await wait(250);
    }
    await wait(2500);
    const after = (await k((a) => window.keeper.pim.messages({ account: a, folder: 'INBOX' }), acct.id)).messages.length;
    const drawnAfter = await main.locator('.mail-row').count();
    check(drawnAfter > drawn, `scrolling draws more rows (${drawn} → ${drawnAfter})`);
    check(after > before, `reaching the bottom fetches older mail from the server (${before} → ${after})`);
    const frames = await k(() => window.__frames.slice(1));
    const sorted = [...frames].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    console.log(`frames: ${frames.length}, median ${sorted[Math.floor(sorted.length / 2)]?.toFixed(1)} ms, 95th ${p95.toFixed(1)} ms`);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    // Scrolling itself runs at the screen's rate; the frames that take longer are the moments older mail arrives.
    check(median <= 20 && p95 < 250, `scrolling stays smooth (median frame ${median.toFixed(0)} ms, 95% within ${p95.toFixed(0)} ms)`);

    // The servers' own search finds mail far older than the list holds.
    const kept = new Set((await k((a) => window.keeper.pim.messages({ account: a, folder: 'INBOX' }), acct.id)).messages.map((m) => m.id));
    const found = await k(() => window.keeper.pim.searchServer('Message number 12'));
    const bad = found.filter((m) => !/12/.test(`${m.subject} ${m.from?.name ?? ''} ${m.from?.address ?? ''}`));
    check(found.length > 0 && !bad.length && found.some((m) => !kept.has(m.id)), `the server’s search finds old mail not kept here (${found.length}${bad.length ? `; not matching: ${bad.slice(0, 3).map((m) => m.subject).join(', ')}` : ''})`);

    await k(async () => { await window.keeper.settings.set({ appearance: 'dark' }); });
    await k(() => { const el = document.querySelector('.mail-rows'); for (const x of [el, el?.closest('.mail-list'), el?.parentElement]) if (x) x.scrollTop = 0; });
    await wait(800);
    await main.screenshot({ path: path.join(SHOTS, 'big-inbox-dark.png') });
    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await app.close();
  } finally {
    // The big mailbox goes with Dovecot's folder.
    dovecot.stop();
  }
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
