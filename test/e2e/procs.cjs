// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux CI): xvfb-run -a node test/e2e/procs.cjs /tmp/kp /tmp/kp-shots [app folder]
// Drives the real Keeper app: finds a `sleep` started by this script in Health →
// Processes, suspends, resumes, restarts and quits it through the interface,
// and measures what the live list costs in processor time.
const { _electron } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOME = process.argv[2];
const SHOTS = process.argv[3];
const APP = path.resolve(process.argv[4] ?? path.resolve(__dirname, '../..'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const stat = (pid) => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch { return null; } };
const state = (pid) => stat(pid)?.slice(stat(pid).lastIndexOf(')') + 2).split(' ')[0];
const ticks = (pid) => { const s = stat(pid); if (!s) return 0; const f = s.slice(s.lastIndexOf(')') + 2).split(' '); return Number(f[11]) + Number(f[12]); };
const sleeps = () => fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).map(Number).filter((p) => { try { return fs.readFileSync(`/proc/${p}/cmdline`, 'utf8') === 'sleep\u00004242\u0000'; } catch { return false; } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(150); } return fn(); }
/** Every process of the app: Electron's main process and everything below it. */
function tree(root) {
  const kids = new Map();
  for (const n of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    const s = stat(n); if (!s) continue;
    const pp = Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]);
    kids.set(pp, [...(kids.get(pp) ?? []), Number(n)]);
  }
  const out = [root];
  for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) ?? []));
  return out;
}

(async () => {
  const victim = spawn('sleep', ['4242'], { detached: true, stdio: 'ignore' });
  victim.unref();
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [APP, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await wait(500);
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForTimeout(2500);
  const electronPid = await app.evaluate(() => process.pid);

  // ---- the API on its own
  const s = await main.evaluate(() => window.keeper.procs.sample());
  check(s.procs.length > 5 && s.procs.some((p) => p.pid === victim.pid), `sample lists ${s.procs.length} processes including the test's sleep (${victim.pid})`);
  const me = s.procs.find((p) => p.pid === victim.pid);
  check(me && me.mine && me.name === 'sleep' && me.command === 'sleep 4242' && me.memory > 0 && me.started > 0, 'the sleep row has its name, command, owner, memory and start time');
  check(s.system.memTotal > 0 && s.system.perCore.length === os.cpus().length, 'system totals and per-core CPU are there');
  const refused = await main.evaluate(() => window.keeper.procs.act('forceQuit', [1]));
  check(!refused.ok && /operating system/.test(refused.failed[0]?.reason ?? ''), 'force quitting pid 1 is refused with a reason');
  const selfRefused = await main.evaluate((pid) => window.keeper.procs.act('quit', [pid]), electronPid);
  check(!selfRefused.ok && /Keeper itself/.test(selfRefused.failed[0]?.reason ?? ''), 'Keeper will not quit itself from the list');

  // ---- through the interface
  await main.evaluate(() => { try { localStorage.setItem('procs.mode', '"list"'); localStorage.setItem('procs.interval', '1000'); } catch {} });
  await main.locator('.sidebar [title="Health"]').click();
  await main.waitForTimeout(800);
  await main.locator('button[role=tab]', { hasText: 'Processes' }).click();
  await main.locator('.procs-row').first().waitFor({ timeout: 10_000 });
  await main.screenshot({ path: `${SHOTS}/linux-processes.png` });
  await main.fill('.procs-bar input', '4242');
  const row = () => main.locator('.procs-row', { hasText: 'sleep' }).first();
  await row().waitFor({ timeout: 5000 });
  await row().click();
  await main.locator('.procs-actions button', { hasText: 'Suspend' }).click();
  check(await until(() => state(victim.pid) === 'T'), `Suspend stops it (state ${state(victim.pid)})`);
  await until(async () => (await main.locator('.procs-row .badge', { hasText: 'Suspended' }).count()) > 0, 4000);
  check((await main.locator('.procs-row .badge', { hasText: 'Suspended' }).count()) > 0, 'the row shows Suspended');
  await main.screenshot({ path: `${SHOTS}/linux-suspended.png` });
  await main.locator('.procs-actions button', { hasText: 'Resume' }).click();
  check(await until(() => state(victim.pid) === 'S'), `Resume lets it run again (state ${state(victim.pid)})`);

  // Restart: quits it and starts the same command again.
  await row().click({ button: 'right' });
  await main.locator('.menu button', { hasText: 'Restart' }).first().click();
  await main.locator('.modal .btn', { hasText: /^Restart$/ }).click();
  const restarted = await until(() => { const l = sleeps().filter((p) => p !== victim.pid); return !stat(victim.pid) || state(victim.pid) === 'Z' ? l[0] : undefined; }, 15_000);
  check(!!restarted, `Restart quits it and starts "sleep 4242" again (new pid ${restarted})`);

  // Quit the restarted one from the list.
  await main.waitForTimeout(1500);
  const r2 = main.locator('.procs-row', { hasText: String(restarted) }).first();
  await r2.waitFor({ timeout: 5000 }).catch(() => undefined);
  await r2.click();
  await main.keyboard.press('Delete');
  check(await until(() => !stat(restarted) || state(restarted) === 'Z'), 'Delete quits the selected process');

  // Inspect a process of ours: Keeper's own main process.
  await main.fill('.procs-bar input', String(electronPid));
  await main.locator('.procs-row').first().dblclick();
  await main.locator('.inspect').waitFor({ timeout: 5000 });
  // Environment, ports and the parent chain arrive a moment later (their own section, loaded on first use).
  await main.locator('.inspect h4', { hasText: 'Environment' }).waitFor({ timeout: 10_000 }).catch(() => undefined);
  const insp = await main.locator('.inspect').innerText();
  check(/Open files/i.test(insp) && /Memory/i.test(insp) && /Environment/i.test(insp), 'Inspect shows memory, environment and open files');
  await main.screenshot({ path: `${SHOTS}/linux-inspect.png` });
  await main.keyboard.press('Escape');

  // Services (systemd may be missing in a container; then the page says so).
  await main.locator('button[role=tab]', { hasText: 'Services' }).click();
  await main.waitForTimeout(1500);
  const svc = await main.locator('.content').innerText();
  check(/Services are not available here|Running|Stopped|Failed/.test(svc), 'Services page loads');
  await main.screenshot({ path: `${SHOTS}/linux-services.png` });

  // ---- cost: processor time while the list updates, against the same app on another page
  const measure = async (ms) => {
    const pids = tree(electronPid);
    const a = pids.map(ticks);
    const t = Date.now();
    await main.waitForTimeout(ms);
    const b = pids.map(ticks);
    const pct = (i) => ((b[i] - a[i]) / 100) / ((Date.now() - t) / 1000) * 100;
    return { main: pct(0), all: pids.reduce((x, _, i) => x + pct(i), 0) };
  };
  const at = async (interval) => {
    await main.evaluate((v) => localStorage.setItem('procs.interval', String(v)), interval);
    await main.locator('.sidebar [title="Hello"]').click();
    await main.locator('.sidebar [title="Health"]').click();
    await main.locator('button[role=tab]', { hasText: 'Processes' }).click();
    await main.waitForTimeout(3000);
    return measure(20_000);
  };
  const one = await at(1000);
  const two = await at(2000);
  await main.locator('.sidebar [title="Hello"]').click();
  await main.waitForTimeout(3000);
  const idle = await measure(20_000);
  const n = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).length;
  const f = (x) => x.toFixed(2);
  console.log(`INFO ${n} processes, ${os.cpus().length} cores, software drawing (no GPU)`);
  console.log(`INFO reading processes (main process, above idle): ${f(one.main - idle.main)}% of one core at 1 s, ${f(two.main - idle.main)}% at 2 s`);
  console.log(`INFO whole app incl. drawing the page, above idle: ${f(one.all - idle.all)}% of one core at 1 s, ${f(two.all - idle.all)}% at 2 s (the default)`);
  check(one.main - idle.main < 2, 'reading every process each second costs under 2% of one core');
  check((two.all - idle.all) / os.cpus().length < 2, 'the open page, at its default speed, costs under 2% of the machine');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  for (const p of sleeps()) try { process.kill(p, 'SIGKILL'); } catch {}
  await app.close();
})().catch(async (e) => { console.error(e); for (const p of sleeps()) try { process.kill(p, 'SIGKILL'); } catch {} process.exit(1); });
