// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// End-to-end check of Keeper's Terminal in the real app (Linux, under xvfb):
//   xvfb-run -a node test/e2e/terminal.cjs <empty home dir> [screenshot dir]
// Opens the Terminal, runs commands, checks that a theme switch recolours it with
// the theme's own palette, splits, uses a separate-sign-in profile,
// broadcasts, leaves and comes back, stops the session host and reads the
// saved scrollback, measures the host's idle CPU, and (when installed) opens
// the notebook server and an SFTP folder.

const { _electron } = require('playwright');
const { execFileSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HOME = path.resolve(process.argv[2] || fs.mkdtempSync('/tmp/keeper-term-e2e-'));
const SHOTS = process.argv[3] ? path.resolve(process.argv[3]) : null;
let failed = 0;
const ok = (cond, what, extra) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}${extra && !cond ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms = 10000, step = 150) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(step);
  }
}

(async () => {
  fs.mkdirSync(path.join(HOME, 'project'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'project', 'hello.txt'), 'hi\n');
  const env = { ...process.env, HOME, XDG_CONFIG_HOME: path.join(HOME, '.config'), SHELL: '/bin/bash', NODE_OPTIONS: '' };
  // The fake home hides Python packages installed for the real user; point Python at them for the notebook check.
  const userSite = spawnSync('python3', ['-m', 'site', '--user-site'], { encoding: 'utf8' }).stdout?.trim();
  if (userSite && fs.existsSync(userSite)) env.PYTHONPATH = [userSite, process.env.PYTHONPATH].filter(Boolean).join(':');
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox'], env });
  await app.firstWindow();
  // The Island and other small windows open too; the main window is the one without a view.
  const w = await until(async () => app.windows().find((x) => { const u = x.url(); return !u.includes('view=') || u.includes('view=app'); }), 30000, 200);
  const errors = [];
  w.on('pageerror', (e) => errors.push(e.message));
  await w.waitForSelector('.sidebar', { timeout: 60000 });
  await sleep(800);

  const text = async (id) => w.evaluate(async (sid) => {
    const r = await window.keeper.terminal.attach(sid);
    window.keeper.terminal.detach(sid);
    return r.data.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '');
  }, id);
  const sessions = () => w.evaluate(() => window.keeper.terminal.sessions());

  // 1. Open the Terminal page and run a command.
  await w.click('.sidebar [title="Terminal"]');
  await w.waitForSelector('.term-pane .xterm', { timeout: 30000 });
  await sleep(1200);
  let list = await sessions();
  ok(list.length === 1, 'the Terminal opens with one terminal', JSON.stringify(list));
  const first = list[0].id;
  await w.click('.term-host');
  await w.keyboard.type('echo hi-from-keeper && pwd\n', { delay: 15 });
  const out1 = await until(async () => {
    const t = await text(first);
    return t.includes(`hi-from-keeper`) && t.includes(HOME) ? t : null;
  });
  ok(!!out1, 'typing runs a command and the output shows (echo + pwd)', (await text(first)).slice(-300));
  if (SHOTS) await w.screenshot({ path: path.join(SHOTS, 'app-terminal.png') });

  // 1b. Switching Keeper's theme recolours the open terminal with that theme's own palette
  // (core/terminal/themePalettes.ts), in light and in dark: the text colour and ANSI red
  // the terminal draws with are read back from the page.
  const termColours = () => w.evaluate(() => {
    const rows = document.querySelector('.term-pane .xterm-rows');
    if (!rows) return null;
    const red = document.createElement('span');
    red.className = 'xterm-fg-1';
    rows.appendChild(red);
    const out = `${getComputedStyle(rows).color} ${getComputedStyle(red).color}`;
    red.remove();
    return out;
  });
  const before = await termColours();
  await w.evaluate(() => window.keeper.settings.set({ theme: 'fjord', appearance: 'dark' }));
  const fjordDark = await until(async () => ((await termColours()) === 'rgb(230, 237, 243) rgb(239, 138, 150)' ? 'ok' : null), 5000);
  ok(!!fjordDark, 'switching to Fjord (dark) recolours the open terminal with its palette', `${before} → ${await termColours()}`);
  await w.evaluate(() => window.keeper.settings.set({ theme: 'circuit', appearance: 'light' }));
  const circuitLight = await until(async () => ((await termColours()) === 'rgb(21, 24, 29) rgb(196, 47, 63)' ? 'ok' : null), 5000);
  ok(!!circuitLight, 'switching to Circuit (light) recolours it again', await termColours());
  await w.evaluate(() => window.keeper.settings.set({ theme: 'playful', appearance: 'system' }));
  await sleep(400);

  // 2. Split right: a sister terminal in the same folder.
  await w.keyboard.press('Control+Shift+D');
  await until(async () => (await w.$$('.term-pane')).length === 2, 5000);
  ok((await w.$$('.term-pane')).length === 2, 'Ctrl+Shift+D splits the pane');
  list = await sessions();
  ok(list.length === 2, 'the split started a second terminal');
  const second = list.find((s) => s.id !== first)?.id;
  ok(list.find((s) => s.id === second)?.cwd === list.find((s) => s.id === first)?.cwd, 'the sister terminal starts in the same folder');

  // 3. A profile with its own sign-ins and a variable of its own.
  await w.evaluate(async () => {
    const s = await window.keeper.terminal.settings();
    await window.keeper.terminal.setSettings({ profiles: [...s.profiles, { id: 'work', name: 'Work', shell: 'default', isolate: true, env: { KEEPER_TEST: 'work-env' } }] });
  });
  const work = await w.evaluate(() => window.keeper.terminal.create({ profileId: 'work' }));
  await w.evaluate((id) => window.keeper.terminal.attach(id), work.id);
  await sleep(800);
  await w.evaluate((id) => window.keeper.terminal.input(id, 'echo "[$KEEPER_TEST] [$CLAUDE_CONFIG_DIR] [$KEEPER_PROFILE]"\r'), work.id);
  const out3 = await until(async () => {
    const t = await text(work.id);
    return /\[work-env\] \[[^\]]*terminal\/profiles\/work\/claude\] \[work\]/.test(t) ? t : null;
  });
  ok(!!out3, 'a separate-sign-in profile gets its own config folder and variables', (await text(work.id)).slice(-300));
  ok(fs.existsSync(path.join(HOME, '.config', 'Keeper', 'terminal', 'profiles', 'work')) || fs.readdirSync(path.join(HOME, '.config')).some((d) => fs.existsSync(path.join(HOME, '.config', d, 'terminal', 'profiles', 'work'))), "the profile's own folder exists");
  const plain = await text(first);
  ok(!plain.includes('work-env'), 'the default profile does not see it');

  // 4. Broadcast: typing goes to both panes of the tab (after confirming).
  await w.click('.term-pane >> nth=0');
  await w.keyboard.press('Control+Alt+I');
  await sleep(300);
  const okBtn = await w.$('.modal button.primary');
  if (okBtn) await okBtn.click();
  await sleep(300);
  await w.click('.term-host >> nth=0');
  await w.keyboard.type('echo bc-$((40+2))\n', { delay: 15 });
  const both = await until(async () => (await text(first)).includes('bc-42') && (await text(second)).includes('bc-42'));
  ok(!!both, 'broadcast typing reaches both panes');
  if (SHOTS) await w.screenshot({ path: path.join(SHOTS, 'app-terminal-split.png') });
  await w.keyboard.press('Control+Alt+I');

  // 5. Leave the page and come back: same tabs and panes, output still there.
  await w.click('.sidebar [title="Home"]');
  await sleep(800);
  ok((await sessions()).length >= 3, 'terminals keep running with no pane showing them');
  await w.click('.sidebar [title="Terminal"]');
  await w.waitForSelector('.term-pane .xterm', { timeout: 15000 });
  await sleep(1000);
  ok((await w.$$('.term-pane')).length === 2, 'coming back shows the same split layout');

  // 6. A separate Terminal window attached to the same host.
  await w.evaluate(() => window.keeper.terminal.openWindow());
  const tw = await until(async () => app.windows().find((x) => x.url().includes('view=terminal')), 15000);
  ok(!!tw, 'the Terminal window opens');
  if (tw) {
    await tw.waitForSelector('.term-pane .xterm', { timeout: 20000 });
    await sleep(800);
    if (SHOTS) await tw.screenshot({ path: path.join(SHOTS, 'app-terminal-window.png') });
    await tw.close();
    await sleep(500);
    ok((await sessions()).length >= 4, 'closing the window leaves its terminal running in the background');
  }

  // 7. Idle cost of the session host with several quiet terminals.
  for (let i = 0; i < 2; i++) await w.evaluate(() => window.keeper.terminal.create({}));
  const pid = await w.evaluate(() => window.keeper.terminal.hostPid());
  const ticks = () => {
    const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return Number(f[11]) + Number(f[12]);
  };
  await sleep(1500);
  const t0 = ticks();
  await sleep(10000);
  const cpu = ((ticks() - t0) / 100 / 10) * 100;
  ok(cpu < 0.5, `the session host idles at ${cpu.toFixed(2)}% CPU with ${(await sessions()).length} quiet terminals (< 0.5%)`);

  // 8. Stop the host: scrollback is saved, and comes back as restored terminals.
  process.kill(pid, 'SIGTERM');
  await sleep(1500);
  const back = await until(async () => {
    try {
      const l = await sessions();
      return l.length ? l : null;
    } catch {
      return null;
    }
  }, 15000);
  const restored = (back || []).find((s) => s.id === first);
  ok(!!restored && restored.restored === true, 'after the host stops, terminals come back as restored scrollback', JSON.stringify(back && back.map((s) => [s.id, s.restored])));
  ok(restored ? (await text(first)).includes('hi-from-keeper') : false, 'the restored scrollback still has the old output');
  const newPid = await w.evaluate(() => window.keeper.terminal.hostPid());
  ok(newPid && newPid !== pid, 'a new host started on demand');

  // 9. Notebooks (if the notebook server is installed): starts in a terminal, then shows inside Keeper.
  const hasNotebook = spawnSync('/bin/sh', ['-lc', 'command -v jupyter'], { env }).status === 0;
  if (hasNotebook) {
    await w.click('.sidebar [title="Home"]');
    await sleep(300);
    await w.click('.sidebar [title="Terminal"]');
    await w.waitForSelector('.term-bar', { timeout: 15000 });
    const tools = await w.evaluate(() => window.keeper.terminal.webTools(true));
    ok(tools.find((t) => t.id === 'notebook')?.available, 'the notebook server is found');
    await w.evaluate(() => document.querySelectorAll('.term-tabs .btn')[1].click());
    await sleep(300);
    const nb = await w.$('.menu button:has-text("Notebooks")');
    if (nb) await nb.click();
    const frame = await until(async () => w.$('.tweb-pane iframe'), 60000, 500);
    if (!frame) {
      const l = await sessions();
      const nbs = l.find((x) => /Notebook/i.test(x.title));
      console.log('DEBUG menu clicked:', !!nb, 'sessions:', l.map((x) => x.title).join(', '));
      if (nbs) console.log('DEBUG notebook output:', (await text(nbs.id)).slice(-600));
    }
    ok(!!frame, 'the notebook opens in a web pane once it prints its address');
    if (frame) {
      await sleep(6000);
      const f = await frame.contentFrame();
      const title = f ? await f.title().catch(() => '') : '';
      ok(/jupyter|lab|notebook/i.test(title), `the notebook page loads inside Keeper (title: ${title || 'n/a'})`);
      if (SHOTS) await w.screenshot({ path: path.join(SHOTS, 'app-terminal-notebook.png') });
    }
  } else console.log('SKIP notebooks: the notebook server is not installed');

  // 10. SFTP side panel (if an SSH server can run here).
  const sshd = ['/usr/sbin/sshd', '/usr/bin/sshd'].find((p) => fs.existsSync(p));
  if (sshd) {
    const dir = path.join(HOME, 'sshd');
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(dir, 'host')]);
    fs.mkdirSync(path.join(HOME, '.ssh'), { recursive: true, mode: 0o700 });
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(HOME, '.ssh', 'id_ed25519')]);
    fs.copyFileSync(path.join(HOME, '.ssh', 'id_ed25519.pub'), path.join(HOME, '.ssh', 'authorized_keys'));
    fs.chmodSync(path.join(HOME, '.ssh', 'authorized_keys'), 0o600);
    const user = require('os').userInfo().username;
    fs.writeFileSync(path.join(dir, 'config'), `Port 2299\nListenAddress 127.0.0.1\nHostKey ${dir}/host\nPidFile ${dir}/pid\nAuthorizedKeysFile ${HOME}/.ssh/authorized_keys\nStrictModes no\nPasswordAuthentication no\nSubsystem sftp internal-sftp\nUsePAM no\n`);
    // sshd insists on its privilege-separation folder existing.
    try { fs.mkdirSync('/run/sshd', { recursive: true }); } catch { /* not allowed: sshd will say so */ }
    const d = spawn(sshd, ['-D', '-f', path.join(dir, 'config'), '-e'], { stdio: 'ignore' });
    await sleep(1000);
    try {
      const target = { protocol: 'sftp', target: `${user}@127.0.0.1:2299` };
      const r = await w.evaluate(([t, d]) => window.keeper.terminal.remoteList(t, d), [target, HOME]);
      ok(r.entries.some((e) => e.name === 'project' && e.isDir), 'SFTP lists a remote folder (signed in with the SSH key)', JSON.stringify(r).slice(0, 200));
      const dl = path.join(HOME, 'dl');
      fs.mkdirSync(dl, { recursive: true });
      const got = await w.evaluate(([t, f, d]) => window.keeper.terminal.remoteDownload(t, [f], d), [target, `${r.dir}/project/hello.txt`, dl]);
      ok(got.length === 1 && fs.readFileSync(got[0], 'utf8') === 'hi\n', 'SFTP downloads a file byte for byte');
      if (SHOTS) {
        await w.click('.term-tools button:has-text("Files")');
        await sleep(300);
        await w.fill('.tfiles-panel input.input', `${user}@127.0.0.1:2299`);
        await w.click('.tfiles-panel button.primary');
        await w.waitForSelector('.tremote-list .tremote-row', { timeout: 10000 }).catch(() => undefined);
        await w.screenshot({ path: path.join(SHOTS, 'app-terminal-sftp.png') });
      }
    } catch (e) {
      ok(false, 'SFTP side panel', String(e));
    }
    d.kill();
  } else console.log('SKIP SFTP: no SSH server can run in this environment');

  ok(errors.length === 0, 'no page errors', errors.join(' | '));
  await w.evaluate(() => window.keeper.terminal.setSettings({ keepAlive: 'window' }));
  await app.close();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
