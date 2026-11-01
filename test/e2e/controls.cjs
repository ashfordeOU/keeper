// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/controls.cjs /tmp/kqc /tmp/kqc-shots
// Drives the real Keeper app's Quick Controls on Linux. System changes run in
// test mode (KEEPER_CONTROLS_DRYRUN): they are written to a file instead of
// changing this machine, while the real readers run, against stand-ins for
// nmcli and bluetoothctl. Keeper's own firewall mode changes for real.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const ROOT = path.resolve(__dirname, '../..');
const DRY = path.join(HOME, 'controls-dryrun.log');
let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) { failed++; process.exitCode = 1; } };
const until = async (fn, ms = 20000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, step)); } return null; };

fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Downloads', 'Desktop', 'Documents', 'bin']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

// Stand-ins: a laptop on home Wi-Fi with Bluetooth on and discoverable.
fs.writeFileSync(path.join(HOME, 'bin/nmcli'), `#!/bin/sh
case "$*" in
  "radio wifi") echo enabled ;;
  "-t -f NAME,TYPE,DEVICE connection show --active") printf 'Home:802-11-wireless:wlan0\\nlo:loopback:lo\\n' ;;
  "-g connection.dns-over-tls,ipv4.dns connection show Home") printf -- '-1\\n\\n' ;;
  "-g ipv6.method connection show Home") echo auto ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
fs.writeFileSync(path.join(HOME, 'bin/bluetoothctl'), `#!/bin/sh
[ "$1" = show ] && printf 'Controller 00:11:22:33:44:55 (public)\\n\\tPowered: yes\\n\\tDiscoverable: yes\\n'
exit 0
`, { mode: 0o755 });

(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: path.join(HOME, '.config'), XDG_DATA_HOME: path.join(HOME, '.local/share'), PATH: `${path.join(HOME, 'bin')}:${process.env.PATH}`, KEEPER_CONTROLS_DRYRUN: DRY, KEEPER_GUIDE_OPEN_STUB: path.join(HOME, 'guide-open.log') } });
  await app.firstWindow();
  const w = await until(async () => app.windows().find((x) => { const u = x.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 30000, 200);
  const errors = [];
  w.on('pageerror', (e) => errors.push(e.message));
  await w.waitForSelector('.sidebar', { timeout: 60000 });
  await w.waitForTimeout(2500);
  const skip = await w.$('.tour button:has-text("Skip tour")');
  if (skip) await skip.click();
  const qc = (fn, ...a) => w.evaluate(([f, args]) => window.keeper.controls[f](...args), [fn, a]);
  const fwMode = () => w.evaluate(() => window.keeper.fw.status().then((s) => s.state.mode));
  const row = (id) => w.locator(`[data-testid="qc-row-${id}"]`);
  const val = (id) => row(id).getAttribute('data-value');

  // ---- the page, with this machine's real states
  await w.click('.sidebar [title="Quick Controls"]');
  check(!!(await until(() => w.$('[data-testid="qc-group-network"] [data-testid="qc-row-wifi"]'), 30000)), 'Quick Controls opens in System with grouped controls');
  const v = await qc('list');
  check(v.os === 'linux' && v.dryRun === true, 'it reports Linux, in test mode');
  const st = Object.fromEntries(v.states.map((s) => [s.id, s]));
  check(st.wifi.how === 'direct' && st.wifi.value === true, 'Wi-Fi read from nmcli: on, switched directly');
  check(st.bluetooth.value === true && st.bluetoothDiscoverable.value === true, 'Bluetooth and discoverable read from bluetoothctl');
  check(st.ipv6.value === true && st.encryptedDns.value === 'off', 'IPv6 and encrypted DNS read for the active connection');
  check(st.keeperFwMode.value === 'alert' && st.dnsFilter.value === false, 'Keeper’s firewall mode and DNS filter read');
  check(['airdrop', 'gatekeeper', 'defenderRealtime', 'stealth'].every((id) => st[id].how === 'none'), 'controls this system lacks say so (AirDrop, Gatekeeper, Defender, stealth)');
  const unknown = v.states.filter((s) => s.value === null && s.how !== 'none');
  check(unknown.every((s) => s.how === 'guide' || s.note || ['camera', 'diagnostics', 'autoUpdates', 'osFirewall', 'microphone', 'lockOnSleep', 'wakeOnLan', 'airplane', 'activityHistory', 'proxy', 'hotspot', 'vpn'].includes(s.id)), `unreadable controls are explained (${unknown.map((s) => s.id).join(', ')})`);
  check(await w.locator('[data-testid="qc-row-gatekeeper"] >> text=Not on this system').count() === 1, 'the page shows “Not on this system” badges');
  await w.screenshot({ path: path.join(SHOTS, 'page-light.png'), fullPage: true });

  // ---- search
  await w.fill('[data-testid="qc-search"]', 'bluetooth');
  check(await w.locator('[data-testid^="qc-row-"]').count() === 2 && await w.locator('[data-testid="qc-row-wifi"]').count() === 0, 'search narrows to Bluetooth controls');
  await w.fill('[data-testid="qc-search"]', '');

  // ---- a direct system toggle (test mode) and Keeper's own firewall mode for real
  await w.click('[data-testid="qc-wifi"] button[role="switch"]');
  check(!!(await until(async () => (await val('wifi')) === 'false')), 'switching Wi-Fi off updates the page');
  check(/cmd nmcli radio wifi off/.test(fs.readFileSync(DRY, 'utf8')), 'and would run “nmcli radio wifi off”');
  await w.selectOption('[data-testid="qc-keeperFwMode"]', 'silent-deny');
  check(!!(await until(async () => (await fwMode()) === 'silent-deny')), 'Keeper firewall mode switched to quiet deny for real');

  // ---- a weakening change asks first; cancelling leaves it alone
  await w.selectOption('[data-testid="qc-keeperFwMode"]', 'silent-allow');
  check(!!(await until(() => w.$('[data-testid="qc-warn"]'), 8000)), 'quiet allow (less protection) asks first');
  check(await w.locator('[data-testid="qc-warn"] >> text=New connections will be allowed without asking you').count() === 1, 'and says why');
  await w.screenshot({ path: path.join(SHOTS, 'warn-light.png') });
  await w.click('button:has-text("Keep it as it is")');
  await w.waitForTimeout(400);
  check((await fwMode()) === 'silent-deny', 'cancelled: the mode stays quiet deny');
  const direct = await qc('set', 'keeperFwMode', 'silent-allow');
  check(!direct.ok && direct.needsConfirm?.warnings.length === 1, 'the API refuses a weakening change without confirmation');

  // ---- undo
  await qc('set', 'keeperFwMode', 'alert');
  let log = (await qc('list')).log;
  const wifiEntry = log.find((e) => e.title === 'Wi-Fi off');
  check(!!wifiEntry && wifiEntry.changes[0].from === true && wifiEntry.changes[0].to === false, 'the change list has “Wi-Fi off” with before and after');
  const u = await qc('undo', wifiEntry.id);
  check(u.ok && (await qc('list')).states.find((s) => s.id === 'wifi').value === true, 'undo puts Wi-Fi back on');

  // ---- preset: review, apply (one batch), then revert
  await w.click('[data-testid="qc-preset-lockdown"]');
  check(!!(await until(() => w.$('[data-testid="qc-plan"]'), 8000)), 'Lockdown shows what it will change first');
  const planText = await w.locator('[data-testid="qc-plan"]').innerText();
  check(/Keeper firewall: alert → silent-deny/.test(planText) && /Bluetooth: on → off/.test(planText), 'the plan lists the firewall mode and Bluetooth');
  check(/Not on this system:.*AirDrop/.test(planText), 'and what this system does not have');
  await w.screenshot({ path: path.join(SHOTS, 'preset-light.png') });
  await w.click('[data-testid="qc-apply"]');
  check(!!(await until(async () => (await fwMode()) === 'silent-deny' && (await val('bluetooth')) === 'false' && (await val('dnsFilter')) === 'true', 15000)), 'Lockdown applied: quiet deny, Bluetooth off, DNS filter on');
  log = (await qc('list')).log;
  const lock = log.find((e) => e.title === 'Preset: Lockdown');
  check(!!lock && lock.changes.length >= 4, `the preset is one entry in the change list (${lock?.changes.map((c) => c.id).join(', ')})`);
  // Reverting the preset turns protection down (DNS filter off), so it is confirmed.
  await w.locator('.qc-log-row', { hasText: 'Preset: Lockdown' }).locator('[data-testid="qc-undo"]').click();
  check(!!(await until(() => w.$('[data-testid="qc-warn"]'), 8000)), 'undoing the preset warns: it lowers protection');
  await w.click('[data-testid="qc-confirm"]');
  check(!!(await until(async () => (await fwMode()) === 'alert' && (await val('bluetooth')) === 'true' && (await val('dnsFilter')) === 'false', 15000)), 'reverted: asking again, Bluetooth on, DNS filter off');
  check(await w.locator('.qc-log-row.undone', { hasText: 'Preset: Lockdown' }).count() === 1, 'the preset entry shows as undone');
  await w.locator('[data-testid="qc-group-firewall"]').scrollIntoViewIfNeeded();
  await w.screenshot({ path: path.join(SHOTS, 'firewall-light.png') });
  await w.locator('[data-testid="qc-log"]').scrollIntoViewIfNeeded();
  await w.waitForTimeout(300);
  await w.screenshot({ path: path.join(SHOTS, 'log-light.png') });

  // ---- binding a preset to a firewall profile
  await qc('bind', 'public', 'public-wifi');
  check((await qc('list')).bindings.public === 'public-wifi', 'Public Wi-Fi preset bound to the Public Wi-Fi firewall profile');
  await w.evaluate(() => window.keeper.fw.setProfile('public'));
  check(!!(await until(async () => (await qc('list')).log.some((e) => /Public Wi-Fi \(for the/.test(e.title)), 10000)), 'switching profile applies the bound preset’s direct, strengthening changes');
  const after = await qc('list');
  check(after.states.find((s) => s.id === 'bluetoothDiscoverable').value === false, 'Bluetooth discovery turned off by it');
  await w.evaluate(() => window.keeper.fw.setProfile('home'));

  // ---- features: one group can be switched off
  await w.evaluate(() => window.keeper.features.set('quickControlsPrivacy', false));
  await w.click('button:has-text("Read again")');
  check(!!(await until(async () => (await w.locator('[data-testid="qc-group-privacy"]').count()) === 0, 8000)), 'switching off Quick Controls: privacy hides that group');
  await w.evaluate(() => window.keeper.features.set('quickControlsPrivacy', true));
  await w.click('button:has-text("Read again")');
  await until(() => w.$('[data-testid="qc-group-privacy"]'), 8000);

  // ---- dark
  await w.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await w.waitForTimeout(800);
  await w.screenshot({ path: path.join(SHOTS, 'page-dark.png'), fullPage: true });
  await w.locator('[data-testid="qc-group-privacy"]').scrollIntoViewIfNeeded();
  await w.screenshot({ path: path.join(SHOTS, 'privacy-dark.png') });
  await w.locator('[data-testid="qc-presets"]').scrollIntoViewIfNeeded();
  await w.click('[data-testid="qc-preset-public-wifi"]');
  await until(() => w.$('[data-testid="qc-plan"]'), 8000);
  await w.screenshot({ path: path.join(SHOTS, 'preset-dark.png') });
  await w.keyboard.press('Escape');
  await w.selectOption('[data-testid="qc-keeperFwMode"]', 'silent-allow');
  await until(() => w.$('[data-testid="qc-warn"]'), 8000);
  await w.screenshot({ path: path.join(SHOTS, 'warn-dark.png') });
  await w.click('button:has-text("Keep it as it is")');
  await w.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  console.log(failed ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
