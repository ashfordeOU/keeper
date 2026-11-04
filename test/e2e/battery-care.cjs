// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/battery-care.cjs /tmp/kbc-home /tmp/kbc-shots
// Drives the real Keeper app's Battery Care against a stand-in battery (a
// small /sys/class/power_supply tree, KEEPER_CHARGE_TEST_ROOT) and a stand-in
// pkexec that runs the administrator batch as the person: off until switched
// on, the page and its status, 80% applied under one prompt with the start
// threshold below it and a udev rule that keeps it, the group allowed to change
// it, a trip charging to 100% without a prompt and back on Cancel, pausing when
// the battery is warm and resuming when it cools, No limit removing the rule.
// Light and dark, 1440×900 and 1024×768.

const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

fs.mkdirSync(path.resolve(process.argv[2]), { recursive: true });
const HOME = fs.realpathSync(path.resolve(process.argv[2]));
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await wait(250); } return null; }

(async () => {
  // A ThinkPad-like battery: both thresholds and charge_behaviour; mains plugged in.
  const ROOT = path.join(HOME, 'root');
  const bat = path.join(ROOT, 'sys/class/power_supply/BAT0');
  const ac = path.join(ROOT, 'sys/class/power_supply/AC');
  fs.mkdirSync(bat, { recursive: true });
  fs.mkdirSync(ac, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'etc/udev/rules.d'), { recursive: true });
  const put = (f, v) => fs.writeFileSync(path.join(bat, f), `${v}\n`);
  const get = (f) => fs.readFileSync(path.join(bat, f), 'utf8').trim();
  put('type', 'Battery'); put('scope', 'System'); put('capacity', '64'); put('status', 'Charging'); put('temp', '310');
  put('charge_control_end_threshold', '100'); put('charge_control_start_threshold', '0'); put('charge_behaviour', '[auto] inhibit-charge force-discharge');
  fs.writeFileSync(path.join(ac, 'type'), 'Mains\n'); fs.writeFileSync(path.join(ac, 'online'), '1\n');
  // The thresholds start out root-only, as on a real system.
  for (const f of ['charge_control_end_threshold', 'charge_control_start_threshold', 'charge_behaviour']) fs.chmodSync(path.join(bat, f), 0o444);
  const bin = path.join(HOME, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const prompts = path.join(HOME, 'prompts.log');
  // A stand-in administrator prompt: counts the prompts, then runs the batch (making the files writable first, as root could).
  fs.writeFileSync(path.join(bin, 'pkexec'), `#!/bin/sh\necho "$*" >> '${prompts}'\nchmod u+w '${bat}'/charge_* 2>/dev/null\n"$@"\nst=$?\n[ -f '${bat}/allowed' ] || chmod u-w '${bat}'/charge_* 2>/dev/null\nexit $st\n`, { mode: 0o755 });
  // chgrp/chmod g+w in the batch mean "allowed": the stand-in marks it so the files stay writable for the person.
  fs.writeFileSync(path.join(bin, 'chgrp'), `#!/bin/sh\ntouch '${bat}/allowed'\n/bin/chgrp "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'chmod'), `#!/bin/sh\nif [ "$1" = "g+w" ]; then shift; /bin/chmod u+w,g+w "$@"; else /bin/chmod "$@"; fi\n`, { mode: 0o755 });

  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, KEEPER_CHARGE_TEST_ROOT: ROOT, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', KEEPER_SKIP_TOUR: '1', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' },
  });
  const errors = [];
  const main = await until(() => app.windows().find((w) => { const u = w.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 40000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await main.waitForSelector('.sidebar', { timeout: 40000 });
  await main.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => undefined);
  const navigate = (route) => app.evaluate(({ BrowserWindow }, r) => { for (const w of BrowserWindow.getAllWindows()) { const u = w.webContents.getURL(); if (!u.includes('view=') || u.includes('view=app')) w.webContents.send('event:navigate', r); } }, route);
  const tidySidebar = () => main.evaluate(() => { for (const el of document.querySelectorAll('.sidebar *')) if (el.children.length === 0 && /^(vm|claude-code|env-runner|public|examples|Claude Code)$/.test((el.textContent || '').trim())) { const row = el.closest('a, button, li, [role="treeitem"]'); if (row) row.style.display = 'none'; } });
  const shot = async (name) => { await wait(800); await tidySidebar(); await main.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const dark = (on) => main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), on);
  const bc = (fn, ...a) => main.evaluate(([f, args]) => window.keeper.batteryCare[f](...args), [fn, a]);
  const promptCount = () => (fs.existsSync(prompts) ? fs.readFileSync(prompts, 'utf8').trim().split('\n').filter(Boolean).length : 0);

  check((await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'chargeLimit')?.on === false, 'Battery Care is off until switched on');
  check(!(await main.evaluate(() => window.keeper.features.list())).find((f) => f.id === 'chargeLimit')?.on && get('charge_control_end_threshold') === '100', 'nothing is changed while it is off');

  await main.evaluate(() => window.keeper.features.set('chargeLimit', true));
  await navigate('battery');
  await main.waitForSelector('[data-testid="battery-care"]', { timeout: 15000 });
  const hero = await until(async () => { const t = await main.locator('[data-testid="bc-hero"]').innerText(); return /64%/.test(t) ? t : null; }, 15000);
  check(!!hero && /Plugged in/.test(hero) && /31°C/.test(hero), `the page shows the charge, plugged in and the temperature (${(hero || '').replace(/\n/g, ' | ')})`);
  check(/80%/.test(await main.locator('[data-testid="bc-limits"] button.on').innerText()), '80% is chosen to start with');
  // Root can write any file, so this only holds for a normal account.
  if (process.getuid && process.getuid() !== 0) check(await main.locator('[data-testid="bc-trip"]').isDisabled(), 'a trip waits until Keeper may adjust it by itself');
  await shot('battery-care-first-light');

  // Apply 80%, allowing Keeper to adjust it later: one prompt.
  await main.locator('[data-testid="bc-allow"]').check();
  await main.locator('[data-testid="bc-apply"]').click();
  check(!!(await until(() => get('charge_control_end_threshold') === '80', 20000)), 'Apply sets the end threshold to 80%');
  check(get('charge_control_start_threshold') === '75', 'and the start threshold just below it (75%)');
  check(promptCount() === 1, `under one administrator prompt (${promptCount()})`);
  const rule = path.join(ROOT, 'etc/udev/rules.d/90-keeper-battery-care.rules');
  const ruleText = (await until(() => (fs.existsSync(rule) ? fs.readFileSync(rule, 'utf8') : ''), 10000)) || '';
  check(/KERNEL=="BAT0"/.test(ruleText) && /charge_control_end_threshold\}="80"/.test(ruleText), 'a udev rule keeps the limit after a restart');
  check(/chgrp \d+ /.test(ruleText), 'the rule lets the person’s group change it without asking');
  const plan = await until(async () => { const t = await main.locator('[data-testid="bc-plan"]').innerText(); return /Stops charging at 80%/.test(t) ? t : null; }, 10000);
  check(!!plan, 'the status says it stops charging at 80%');
  check(!!(await until(async () => /Kept after a restart/.test(await main.locator('[data-testid="bc-hero"]').innerText()), 10000)), 'and that it is kept after a restart');

  await shot('battery-care-light');
  await dark(true); await shot('battery-care-dark'); await dark(false);
  await main.setViewportSize({ width: 1024, height: 768 }).catch(() => undefined);
  await shot('battery-care-1024-light');
  check(!(await main.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'nothing runs off the side at 1024×768');
  await main.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);

  // A trip: to 100% with no prompt, back to 80% on Cancel.
  const before = promptCount();
  await main.locator('[data-testid="bc-trip"]').click();
  check(!!(await until(() => get('charge_control_end_threshold') === '100', 15000)), 'Charge to 100% raises the limit for the trip');
  check(promptCount() === before, 'without another prompt');
  check(/Full charge until/.test(await main.locator('[data-testid="bc-plan"]').innerText()), 'the status says when the trip charge ends');
  await main.locator('[data-testid="bc-trip-off"]').click();
  check(!!(await until(() => get('charge_control_end_threshold') === '80', 15000)), 'Cancel goes back to 80%');

  // Warm: charging pauses; cool: it resumes.
  await main.locator('[aria-label="Pause when warm"]').click();
  put('temp', '440');
  await bc('setHeat', true);
  check(!!(await until(() => /inhibit-charge/.test(get('charge_behaviour')) && !/\[auto\]/.test(get('charge_behaviour')), 90000)), 'charging pauses while the battery is 44°C');
  put('temp', '350');
  await bc('setHeat', true);
  check(!!(await until(() => /^auto$|\[auto\]/.test(get('charge_behaviour')), 90000)), 'and resumes once it has cooled to 35°C');

  // No limit: back to 100% and the rule goes.
  await main.locator('[data-testid="bc-limits"] button', { hasText: 'No limit' }).click();
  await main.locator('[data-testid="bc-apply"]').click();
  check(!!(await until(() => get('charge_control_end_threshold') === '100' && !fs.existsSync(rule), 20000)), 'No limit charges to 100% again and removes the rule');

  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join('; ')})`);
  await app.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
