// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/limits.cjs
// Keeper's own ceilings, with tiny limits set through KEEPER_LIMITS so each step
// happens within a minute:
//   1. Keeper above its processor ceiling (set below zero) holds background
//      work, stops service processes, says so in the Island, and lists it on
//      Keeper's processes;
//   2. a service process past its memory ceiling is restarted, and still answers;
//   3. Resume lifts the hold.
const { _electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.resolve(__dirname, '../..');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'klim-'));
const HOME = path.join(ROOT, 'home');
for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, step = 250) => { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } if (Date.now() - t > ms) return null; await sleep(step); } };

(async () => {
  const env = {
    ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share',
    // 1 byte for service processes; processor ceiling below zero, reached at once; a 2-minute hold.
    KEEPER_LIMITS: JSON.stringify({ hostMemory: 1, cpuCeiling: -1, cpuSustainMs: 0, cpuHoldMs: 120_000 }),
  };
  const app = await _electron.launch({ executablePath: path.join(APP, 'node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env });
  const errors = [];
  try {
    const w = await until(() => app.windows().find((x) => /view=app/.test(x.url())), 30000);
    w.on('pageerror', (e) => errors.push(e.message));
    await w.waitForSelector('.sidebar', { timeout: 60000 });
    await w.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
    // Nobody is "using" Keeper in this test: no window has the focus.
    await app.evaluate(({ BrowserWindow }) => { for (const b of BrowserWindow.getAllWindows()) b.blur(); });

    await w.evaluate(() => window.keeper.net.sample().catch(() => null));
    // 1. processor ceiling
    const held = await until(() => w.evaluate(() => window.keeper.svc.held()), 45000, 1000);
    check(held > Date.now(), 'Keeper above its processor ceiling holds background work');
    const st = await w.evaluate(() => window.keeper.svc.limits());
    check(st.events.some((e) => /processor/.test(e.what) && /Paused for 2 min/.test(e.what)), 'the step back is listed with what was paused');
    check(!!st.lastAlert && /Paused for 2 min/.test(st.lastAlert.detail), `the Island is told what was paused (${st.lastAlert?.title}: ${st.lastAlert?.detail})`);

    // 2. memory ceiling for a service process
    await w.evaluate(() => window.keeper.net.sample().catch(() => null));
    const first = await until(() => w.evaluate(() => window.keeper.svc.list().then((l) => l.find((p) => p.id === 'svc:net' && p.pid)?.pid)), 30000, 500);
    check(!!first, 'the Network Activity process starts');
    const ev = await until(() => w.evaluate(() => window.keeper.svc.limits().then((s) => s.events.find((e) => /Network Activity grew/.test(e.what))?.what)), 45000, 1000);
    check(!!ev, `a service process past its memory ceiling is restarted (${ev ?? 'no event'})`);
    const answers = await w.evaluate(() => window.keeper.net.sample().then((s) => Array.isArray(s.flows)).catch((e) => `error: ${e.message}`));
    check(answers === true, `the restarted service still answers (${answers})`);

    // The processes page shows the limits section
    await w.evaluate(() => window.keeper.svc.limits());
    await w.click('.sidebar [title="Health"]').then(() => w.click('[data-tab-id="keeper"]')).catch(() => undefined);
    const panel = await until(() => w.locator('[data-testid="kproc-limits"]').textContent(), 20000, 500);
    check(!!panel && /Keeper’s own limits/.test(panel) && /restarted it/.test(panel), 'Keeper’s processes lists the limits and what Keeper did');
    fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
    await w.screenshot({ path: path.join(ROOT, 'shots', 'limits.png') }).catch(() => undefined);

    // 3. resume
    await w.evaluate(() => window.keeper.svc.stopAllWork(true));
    check((await w.evaluate(() => window.keeper.svc.held())) === 0, 'Resume lifts the hold');
    check(errors.length === 0, `no page errors (${errors.slice(0, 2).join('; ')})`);
  } finally {
    await app.close().catch(() => undefined);
  }
  console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} · screenshots in ${path.join(ROOT, 'shots')}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
