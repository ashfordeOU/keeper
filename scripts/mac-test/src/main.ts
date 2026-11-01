// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Mac test run's driver (run.sh builds it with esbuild and starts it).
// Order: the setup results, the Mac and its permissions, each test area, then
// the cleanup (every change put back and checked), the logs, and the packing
// (scrubbed, reviewed by the owner, zipped). Ctrl-C stops safely: the changes
// are put back and what was done so far is packed.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fakeKeeper, launchKeeper, SafetyError, type KeeperApp } from './app';
import { parseArgs, USAGE, type Args } from './args';
import { AREAS, AREA_TITLES, chooseAreas } from './areas';
import { collectIdentity, fingerprint, recordSetup, runPermissions, runSystem } from './areas/system';
import { readSnapshot, diff } from './areas/stage';
import { areaHeader, fail, Recorder, skip, Undo, type Ctx, type Facts, type Paths } from './context';
import { fakeHelper, startHelper, type Helper } from './helper';
import { human, reviewBundle, scrubTree, sendBackText, zipBundle } from './pack';
import { color, Prompter } from './prompt';
import { renderReport } from './report';
import { RESULTS_SCHEMA, SCHEMA_VERSION, validateResults, type Results } from './schema';
import type { Identity } from './scrub';
import { Sys, sleep, type Fixture } from './sys';

const VERSION = '1.0.0';
const say = (s = '') => process.stdout.write(s + '\n');
const ONE_PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function stampNow(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function readJson<T>(f: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) as T; } catch { return fallback; }
}

/** A stand-in for the usage-stats server, on this computer only. */
function startStub(file: string): Promise<{ url: string; hits: () => number; close: () => void }> {
  let hits = 0;
  const bodies: unknown[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { if (body.length < 1 << 20) body += d; });
    req.on('end', () => {
      hits++;
      try { bodies.push(JSON.parse(body)); } catch { bodies.push(body.slice(0, 2000)); }
      try { fs.writeFileSync(file, JSON.stringify(bodies, null, 2)); } catch { /* best effort */ }
      res.writeHead(204).end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const a = server.address() as { port: number };
    resolve({ url: `http://127.0.0.1:${a.port}`, hits: () => hits, close: () => server.close() });
  }));
}

async function main() {
  let args: Args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { say(String((e as Error).message)); say(USAGE); process.exit(2); }
  if (args.help) { say(USAGE); return; }
  if (args.list) {
    say('Areas (in order; * = in --quick):');
    for (const a of AREAS) say(`  ${a.quick ? '*' : ' '} ${a.id.padEnd(9)} ${a.title} (about ${a.minutes[0]} min)`);
    return;
  }
  if (args.packOnly) { await packOnly(args.packOnly, args); return; }

  const root = path.resolve(process.env.KEEPER_MACTEST_ROOT ?? process.cwd());
  const runDir = path.resolve(args.runDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-mac-test.')));
  const started = new Date();
  const name = `keeper-mac-test-${args.dryRun ? 'dryrun-' : ''}${stampNow(started)}`;
  const bundle = path.join(runDir, 'bundle', name);
  const home = path.join(runDir, 'home');
  const paths: Paths = {
    root, run: runDir, bundle, home, userData: path.join(home, 'Library/Application Support/Keeper'),
    shots: path.join(bundle, 'shots'), logs: path.join(bundle, 'logs'), data: path.join(bundle, 'data'), bin: path.join(runDir, 'bin'),
  };
  for (const d of [bundle, paths.shots, paths.logs, paths.data, path.join(bundle, 'screen'), path.join(bundle, 'system'), paths.userData, path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'Downloads')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'bundle-dir'), bundle);
  const driverLog = path.join(paths.logs, 'driver.log');
  const log = (s: string) => { try { fs.appendFileSync(driverLog, `[${new Date().toISOString()}] ${s}\n`); } catch { /* best effort */ } };

  const fxDir = path.join(root, 'scripts/mac-test/fixtures');
  const fx = args.dryRun ? {
    commands: readJson<Fixture[]>(path.join(fxDir, 'commands.json'), []),
    app: readJson<Record<string, unknown>>(path.join(fxDir, 'app.json'), {}),
    helper: readJson<Record<string, unknown>>(path.join(fxDir, 'helper.json'), {}),
    probe: readJson<Record<string, unknown>>(path.join(fxDir, 'probe.json'), {}),
  } : null;
  const sys = new Sys({ dryRun: args.dryRun, logFile: path.join(paths.logs, 'commands.log'), fixtures: fx?.commands, fixtureDir: fxDir });

  let stopping = false;
  let hardStop = false;
  const answers = args.answers ? readJson<Record<string, string>>(path.resolve(args.answers), {}) : args.dryRun ? { '*': 'y' } : undefined;
  const prompt = new Prompter({ interactive: true, answers, log, onInterrupt: () => onInterrupt() });
  sys.beforeInherit = () => prompt.close();

  const { areas, unknown } = chooseAreas(args);
  if (unknown.length) { say(color.red(`Unknown area(s): ${unknown.join(', ')}. Try --list.`)); process.exit(2); }

  const rec = new Recorder(bundle, {
    schemaVersion: SCHEMA_VERSION, tool: { name: 'keeper-mac-test', version: VERSION },
    run: { id: name, startedAt: started.toISOString(), mode: args.quick ? 'quick' : 'full', areas: areas.map((a) => a.id), dryRun: args.dryRun, interrupted: false, guided: args.guided, record: args.record, args: args.raw },
    keeper: {}, system: {},
  }, log);
  rec.stopping = () => stopping;
  const undo = new Undo(path.join(runDir, 'undo.tsv'), path.join(runDir, 'undo.done'), sys, rec, say);

  const pkg = readJson<{ version?: string }>(path.join(root, 'package.json'), {});
  rec.results.keeper.version = pkg.version;
  const git = await sys.runReal('git', ['-C', root, 'rev-parse', '--short', 'HEAD']);
  if (git.ok) rec.results.keeper.commit = git.stdout.trim();
  const dirty = await sys.runReal('git', ['-C', root, 'status', '--porcelain']);
  if (dirty.ok) rec.results.keeper.dirty = dirty.stdout.trim().length > 0;

  const facts: Facts = { macosMajor: 0, macos: '', darwin: '', model: '', notch: false, arm: false, battery: false, user: os.userInfo().username, realHome: os.homedir(), tcc: {}, screens: [], sandboxOk: false, before: {} };
  const helperCandidates = [path.join(root, 'native/macos/KeeperHelper/.build/release/keeper-helper'), path.join(root, 'native/macos/KeeperHelper/.build/apple/Products/Release/keeper-helper')];
  facts.helperBin = helperCandidates.find((p) => fs.existsSync(p));
  facts.probeBin = fs.existsSync(path.join(paths.bin, 'mactest-probe')) ? path.join(paths.bin, 'mactest-probe') : undefined;

  const stub = await startStub(path.join(paths.data, 'usage-stub-received.json'));
  const identity: Identity = {};

  // ---------------------------------------------------------------- the context
  let current: KeeperApp | null = null;
  let launching: Promise<KeeperApp> | null = null;
  let launches = 0;
  let appError: string | null = null;
  const pids = new Set<number>();
  let helper: Helper | null = null;
  let sudoAnswer: boolean | null = null;

  const ctx: Ctx = {
    args, sys, prompt, rec, undo, paths, facts, dry: args.dryRun,
    async app() {
      if (current) return current;
      if (launching) return launching;
      if (appError) throw new Error(appError);
      launching = (async () => {
        if (args.dryRun && !args.realApp) return fakeKeeper(fx?.app ?? {});
        if (!facts.sandboxOk) throw new Error('Keeper is not started: the folder safety check did not pass (see system.sandbox)');
        const entry = readJson<{ main?: string }>(path.join(root, 'package.json'), {}).main ?? 'dist-electron/main.cjs';
        if (!fs.existsSync(path.join(root, entry))) throw new Error(`Keeper is not built: ${entry} is missing (see setup.build)`);
        launches++;
        say(color.dim(`  (starting Keeper${launches > 1 ? ' again' : ''}…)`));
        return launchKeeper({
          root, home, userData: paths.userData, sandboxPaths: path.join(root, 'scripts/mac-test/sandbox-paths.cjs'), logDir: paths.logs, n: launches,
          // KEEPER_ISLAND_LOG: requested vs actual Island rectangles, for island.stays-put.
          env: { KEEPER_TELEMETRY_URL: stub.url, KEEPER_TELEMETRY_INTERVAL_MS: '86400000', KEEPER_ISLAND_LOG: '1' },
        });
      })();
      try {
        current = await launching;
        const pid = await current.pid();
        if (pid) pids.add(pid);
        return current;
      } catch (e) {
        if (e instanceof SafetyError || !current) appError = (e as Error).message;
        throw e;
      } finally {
        launching = null;
      }
    },
    running: () => current,
    async closeApp(how = 'quit') {
      const a = current;
      current = null;
      if (!a) return;
      if (how === 'kill') await a.kill();
      else await a.close();
    },
    async helper() {
      if (helper) return helper;
      if (args.dryRun) return (helper = fakeHelper(fx?.helper ?? {}));
      if (!facts.helperBin) return null;
      helper = startHelper(facts.helperBin, path.join(paths.logs, 'helper-stderr.log'), process.env);
      return helper;
    },
    async probe(...a: string[]) {
      if (args.dryRun) {
        const v = (fx?.probe ?? {})[a.join(' ')] ?? (fx?.probe ?? {})[a[0]];
        return v === undefined ? null : structuredClone(v);
      }
      if (!facts.probeBin) return null;
      const r = await sys.run(facts.probeBin, a, { timeoutMs: a[0] === 'request' ? 180_000 : 60_000 });
      try { return JSON.parse(r.stdout.trim().split('\n').pop() ?? ''); } catch { return null; }
    },
    saveData(nameIn, v) {
      const rel = path.join('data', nameIn);
      const f = path.join(bundle, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
      return rel;
    },
    async shotScreen(nameIn, region) {
      if (!args.screen) return null;
      const rel = path.join('screen', `${nameIn}.png`);
      const f = path.join(bundle, rel);
      if (args.dryRun) { fs.writeFileSync(f, ONE_PX); return rel; }
      const a = ['-x', '-t', 'png'];
      if (region) a.push('-R', [region.x, region.y, region.width, region.height].map((n) => Math.round(n)).join(','));
      const r = await sys.run('/usr/sbin/screencapture', [...a, f], { timeoutMs: 20_000 });
      return r.ok && fs.existsSync(f) ? rel : null;
    },
    async shotWindow(nameIn, match) {
      const rel = path.join('shots', `${nameIn}.png`);
      const f = path.join(bundle, rel);
      const app = await ctx.app();
      const ok = match ? await app.capture(match, f) : await app.screenshot(f);
      return ok ? rel : null;
    },
    async cue(text) {
      if (args.dryRun) return;
      await sys.run('/usr/bin/say', ['-r', '185', text], { timeoutMs: 15_000 });
    },
    stopping: () => stopping,
    async sudoOk(why) {
      if (sudoAnswer !== null) return sudoAnswer;
      if (args.dryRun) return (sudoAnswer = true);
      const yes = await prompt.consent('sudo', 'Administrator rights (sudo) for read-only checks', [`Nothing changes: ${why}.`], ['Nothing to put back.']);
      if (!yes) return (sudoAnswer = false);
      const r = await sys.run('/usr/bin/sudo', ['-v'], { inherit: true, timeoutMs: 120_000 });
      return (sudoAnswer = r.ok);
    },
    say,
  };

  // ---------------------------------------------------------------- stopping safely
  let cleaning: Promise<void> | null = null;
  function onInterrupt() {
    if (!stopping) {
      stopping = true;
      rec.results.run.interrupted = true;
      prompt.abortAll();
      say(color.yel('\n\nStopping safely: putting everything back and packing what was done so far… (Ctrl-C again to skip packing)'));
      return;
    }
    if (!hardStop) {
      hardStop = true;
      say(color.red('\nStopping now. run.sh puts back what is left.'));
      void (async () => {
        try { await current?.kill(); } catch { /* gone */ }
        process.exit(130);
      })();
    }
  }
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onInterrupt);
  process.on('SIGHUP', onInterrupt);
  process.on('unhandledRejection', (e) => log(`unhandled rejection: ${(e as Error)?.stack ?? String(e)}`));

  // ---------------------------------------------------------------- the run
  let video: { stop(): Promise<void> } | null = null;
  try {
    await collectIdentity(ctx, identity);
    fs.writeFileSync(path.join(runDir, 'identity.json'), JSON.stringify(identity), { mode: 0o600 });
    const mins = areas.reduce((s, a) => s + a.minutes[args.quick ? 1 : 0], 0) + (args.quick ? 2 : 5);
    say('');
    say(color.b(color.cyan(`Keeper on macOS — ${args.quick ? 'quick' : 'full'} test run${args.dryRun ? ' (DRY RUN: stand-in macOS output)' : ''}`)));
    say(`About ${mins} more minutes. Areas: ${areas.map((a) => a.id).join(', ')}.`);
    say('Keeper runs with a throwaway home folder: your own files, notes, settings and accounts are not used.');
    say('Anything that changes your Mac or needs your password is asked first, and put back at the end (also after Ctrl-C).');
    if (args.guided) say(`Some steps need you (${color.b('y')}es / ${color.b('n')}o / ${color.b('s')}kip; each waits a few minutes, then moves on).`);
    if (args.guided) {
      const go = await prompt.ask({ key: 'start', title: 'Ready?', lines: ['Close anything private on screen if you allow screen pictures (you can still leave them out at the end).', 'Plug in the power adapter if this is a laptop.'], question: 'Start?', kind: 'enter', timeoutSec: 600 });
      if (go.answer !== 'y') { stopping = true; rec.results.run.interrupted = true; }
    }

    if (args.record && !stopping) video = await startVideo(ctx);

    recordSetup(ctx);
    areaHeader(ctx, 'The Mac');
    await runSystem(ctx);
    if (!facts.sandboxOk) appError = 'the folder safety check did not pass (see system.sandbox), so Keeper is not started';
    areaHeader(ctx, 'Privacy permissions');
    await runPermissions(ctx);

    for (const a of areas) {
      if (stopping) break;
      areaHeader(ctx, a.title);
      if (a.app && appError) {
        await rec.check(`${a.id}.not-run`, `${a.title}: not run`, 'auto', async () => skip(`Keeper could not start: ${appError}`));
        continue;
      }
      try {
        await a.run(ctx, { stub });
      } catch (e) {
        await rec.check(`${a.id}.stopped`, `${a.title}: stopped by an error`, 'auto', async () => fail(String((e as Error).message), (e as Error).stack));
      }
    }
  } catch (e) {
    log(`run error: ${(e as Error).stack ?? String(e)}`);
    say(color.red(`The run stopped with an error: ${(e as Error).message}`));
  } finally {
    stopping = true;
    cleaning ??= cleanup(ctx, { pids, stub, helperRef: () => helper, video });
    await cleaning;
  }

  await finish(ctx, identity, started, stub);
}

async function startVideo(ctx: Ctx): Promise<{ stop(): Promise<void> }> {
  const dir = path.join(ctx.paths.bundle, 'video');
  fs.mkdirSync(dir, { recursive: true });
  if (ctx.dry) { fs.writeFileSync(path.join(dir, 'screen.mov'), ''); return { stop: async () => undefined }; }
  let bg;
  let how = '';
  const ff = await ctx.sys.sh('command -v ffmpeg');
  if (ff.ok) {
    const list = await ctx.sys.run(ff.stdout.trim(), ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { timeoutMs: 15_000 });
    const m = /\[(\d+)\] Capture screen 0/.exec(list.stderr);
    if (m) {
      bg = ctx.sys.background(ff.stdout.trim(), ['-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-capture_cursor', '1', '-framerate', '10', '-i', `${m[1]}:none`, '-c:v', 'h264_videotoolbox', '-b:v', '2500k', path.join(dir, 'screen.mp4')]);
      how = 'ffmpeg';
    }
  }
  if (!bg) { bg = ctx.sys.background('/usr/sbin/screencapture', ['-v', '-C', '-k', '-x', path.join(dir, 'screen.mov')]); how = 'screencapture'; }
  fs.writeFileSync(path.join(ctx.paths.run, 'video.pid'), String(bg.child?.pid ?? ''));
  ctx.say(color.dim(`  Recording the screen with ${how}…`));
  return {
    stop: async () => {
      try { bg.child?.stdin?.write(how === 'ffmpeg' ? 'q' : '\n'); } catch { /* closed */ }
      const t = setTimeout(() => { try { bg.child?.kill('SIGINT'); } catch { /* gone */ } }, 8000);
      await bg.stop('SIGINT');
      clearTimeout(t);
      fs.rmSync(path.join(ctx.paths.run, 'video.pid'), { force: true });
    },
  };
}

async function cleanup(ctx: Ctx, o: { pids: Set<number>; stub: { close(): void }; helperRef: () => Helper | null; video: { stop(): Promise<void> } | null }) {
  const items = ctx.rec.results.cleanup.items;
  const item = (what: string, ok: boolean, detail?: string) => { items.push({ what, ok, ...(detail ? { detail } : {}) }); ctx.say(`  ${ok ? color.grn('ok') : color.red('NOT OK')} ${what}${detail ? color.dim(` (${detail})`) : ''}`); };
  ctx.say('');
  ctx.say(color.b(color.cyan('━━ Cleaning up ━━')));
  if (o.video) { await o.video.stop().catch(() => undefined); item('Screen recording stopped', true); }
  const app = ctx.running();
  if (app) {
    const pid = await app.pid();
    if (pid) o.pids.add(pid);
    await ctx.closeApp('quit').catch(() => undefined);
  }
  o.helperRef()?.stop();
  o.stub.close();
  await ctx.undo.runAll();
  const { sys, facts, paths } = ctx;

  if (!ctx.dry) {
    await sleep(1500);
    const leftKeeper = await sys.run('/usr/bin/pgrep', ['-f', path.join(paths.root, 'node_modules/electron')]);
    if (leftKeeper.ok) await sys.run('/usr/bin/pkill', ['-9', '-f', path.join(paths.root, 'node_modules/electron')]);
    const stillKeeper = await sys.run('/usr/bin/pgrep', ['-f', path.join(paths.root, 'node_modules/electron')]);
    item('Keeper (the test copy) is closed', !stillKeeper.ok, leftKeeper.ok ? 'some processes had to be stopped' : undefined);
    const leftHelper = await sys.run('/usr/bin/pgrep', ['-f', 'KeeperHelper/.build']);
    if (leftHelper.ok) await sys.run('/usr/bin/pkill', ['-f', 'KeeperHelper/.build']);
    item('keeper-helper is stopped', !(await sys.run('/usr/bin/pgrep', ['-f', 'KeeperHelper/.build'])).ok);
    const caf = await sys.run('/usr/bin/pgrep', ['-fl', 'caffeinate']);
    const ours = caf.stdout.split('\n').filter((l) => [...o.pids].some((p) => new RegExp(`-w ${p}\\b`).test(l)));
    for (const l of ours) { const pid = Number(l.trim().split(/\s+/)[0]); if (pid) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
    item('No caffeinate hold left from Keeper', true, ours.length ? `${ours.length} stopped` : undefined);
    const wd = await sys.run('/usr/bin/pgrep', ['-fl', 'stage-restore']);
    const ourWd = wd.stdout.split('\n').filter((l) => l.includes(paths.home));
    if (ourWd.length) await sleep(5000);
    const wd2 = (await sys.run('/usr/bin/pgrep', ['-fl', 'stage-restore'])).stdout.split('\n').filter((l) => l.includes(paths.home));
    for (const l of wd2) { const pid = Number(l.trim().split(/\s+/)[0]); if (pid) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
    item('No Stage watchdog left running', true, wd2.length ? `${wd2.length} stopped` : undefined);
    if (typeof facts.before.sleepDisabled === 'boolean') {
      const m = /SleepDisabled\s+(\d)/.exec((await sys.run('/usr/bin/pmset', ['-g'])).stdout);
      const now = m ? m[1] === '1' : null;
      item('Sleep setting as before (pmset SleepDisabled)', now === facts.before.sleepDisabled, `now ${now === null ? '?' : now ? 1 : 0}, before ${facts.before.sleepDisabled ? 1 : 0}`);
    }
    if (facts.before.awakeSudoers === false) item('No sudoers rule left (/etc/sudoers.d/keeper-awake)', !fs.existsSync('/etc/sudoers.d/keeper-awake'));
    if (facts.before.meshDaemon === false) {
      const loaded = (await sys.run('/bin/launchctl', ['print', 'system/org.ashforde.keeper.meshd'])).ok;
      item('No mesh LaunchDaemon left', !loaded && !fs.existsSync('/Library/LaunchDaemons/org.ashforde.keeper.meshd.plist'));
    }
    if (facts.before.stage) {
      const now = await readSnapshot(ctx);
      const d = diff(facts.before.stage as Record<string, string>, now, ['desktopIcons', 'dockAutohide', 'menubarAutohide', 'alertVolume', 'cursorSize']);
      item('Dock, menu bar, desktop icons, alert volume and pointer size as before', !d.length, d.length ? d.join(', ') : undefined);
    }
    if (facts.before.desktop) {
      const now = await ctx.probe('desktop-get');
      const same = JSON.stringify(now?.screens?.map((s: { path?: string }) => s.path)) === JSON.stringify((facts.before.desktop as { screens?: { path?: string }[] }).screens?.map((s) => s.path));
      item('Desktop pictures as before', same);
    }
    // The dev copy of Electron registered itself for keeper:// links; take it out of Launch Services.
    const lsreg = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
    const electronApp = path.join(paths.root, 'node_modules/electron/dist/Electron.app');
    if (fs.existsSync(lsreg) && fs.existsSync(electronApp)) {
      const r = await sys.run(lsreg, ['-u', electronApp], { timeoutMs: 30_000 });
      item('The test copy of Keeper no longer handles keeper:// links', r.ok);
    }
  }
  if (facts.realKeeperBefore) {
    const now = fingerprint(path.join(facts.realHome, 'Library/Application Support/Keeper'));
    const b = facts.realKeeperBefore;
    const same = now.exists === b.exists && now.files === b.files && now.newest === b.newest;
    item('Your own Keeper data was not touched', same || ctx.dry, same ? undefined : `files ${b.files} → ${now.files}; newest change ${new Date(b.newest).toISOString()} → ${new Date(now.newest).toISOString()} (a Keeper of your own running at the same time also changes it)`);
  }
  const changes = ctx.rec.results.changes;
  if (changes.length) item(`Every change put back and checked (${changes.length})`, changes.every((c) => c.restored && c.verified), changes.filter((c) => !c.restored || !c.verified).map((c) => c.what).join('; ') || undefined);
  ctx.rec.results.cleanup.ok = items.every((i) => i.ok);
  ctx.rec.save();
}

/** Logs and crash reports into the bundle, then the report, the scrubbing, the review and the zip. */
async function finish(ctx: Ctx, identity: Identity, started: Date, stub: { hits(): number }) {
  const { paths, rec, sys } = ctx;
  void stub;
  // Keeper's own logs and crash dumps, from the throwaway data folder
  const copyMatching = (from: string, to: string, re: RegExp, depth = 4, since = 0) => {
    let n = 0;
    const walk = (d: string, k: number) => {
      if (k > depth) return;
      let ents: fs.Dirent[] = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p, k + 1); continue; }
        if (!re.test(e.name)) continue;
        try {
          if (since && fs.statSync(p).mtimeMs < since) continue;
          const dst = path.join(to, path.relative(from, p));
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(p, dst);
          n++;
        } catch { /* unreadable */ }
      }
    };
    walk(from, 0);
    return n;
  };
  const nLogs = copyMatching(paths.userData, path.join(paths.logs, 'keeper-data'), /\.(log|txt)$|journal\.json$/i);
  const nDumps = copyMatching(path.join(paths.userData, 'Crashpad'), path.join(paths.logs, 'crash-dumps'), /\.dmp$/i);
  let nReports = 0;
  if (!ctx.dry) {
    for (const d of [path.join(ctx.facts.realHome, 'Library/Logs/DiagnosticReports'), '/Library/Logs/DiagnosticReports']) {
      nReports += copyMatching(d, path.join(paths.logs, 'diagnostic-reports'), /(Keeper|Electron|keeper-helper|mactest-probe).*\.(ips|crash|diag|spin|hang)$/i, 2, started.getTime() - 60_000);
    }
  }
  for (const f of ['run.log', 'setup.tsv', 'undo.tsv', 'undo.done']) {
    const p = path.join(paths.run, f);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(paths.logs, f === 'run.log' ? 'run-sh.log' : f));
  }
  ctx.say(color.dim(`  Collected ${nLogs} Keeper log(s), ${nDumps} crash dump(s), ${nReports} macOS crash report(s).`));

  // the results, final
  const r = rec.results;
  r.run.finishedAt = new Date().toISOString();
  r.run.durationSec = Math.round((Date.now() - started.getTime()) / 1000);
  rec.save();
  rec.frozen = true;
  writeOutputs(paths.bundle, r);
  if (!ctx.args.keepTemp) fs.rmSync(paths.home, { recursive: true, force: true });

  // scrub, review, zip
  const n = scrubTree(paths.bundle, identity);
  ctx.say(color.dim(`  Took your identity out of ${n} file(s).`));
  const problems = validateResults(readJson(path.join(paths.bundle, 'results.json'), {}));
  if (problems.length) fs.appendFileSync(path.join(paths.bundle, 'README.txt'), `\nresults.json problems found while packing:\n- ${problems.join('\n- ')}\n`);
  await reviewBundle(paths.bundle, ctx.prompt);
  ctx.prompt.close();
  const outDir = ctx.args.out ? path.resolve(ctx.args.out) : fs.existsSync(path.join(ctx.facts.realHome, 'Desktop')) ? path.join(ctx.facts.realHome, 'Desktop') : ctx.facts.realHome;
  const zip = path.join(outDir, `${path.basename(paths.bundle)}.zip`);
  const z = await zipBundle(sys, paths.bundle, zip);
  say('');
  if (!z.ok) {
    say(color.red(`Could not make the .zip: ${z.error}. The scrubbed folder is here: ${paths.bundle}`));
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(path.join(paths.run, 'zip-path'), zip);
  const s = r.summary;
  say(color.b(`Results: ${s.pass} passed, ${s.fail} failed, ${s.skip} skipped${r.run.interrupted ? ' (stopped early)' : ''}. Cleanup: ${r.cleanup.ok ? 'all put back' : color.red('something was not put back, see report.md')}.`));
  for (const l of sendBackText(zip, fs.statSync(zip).size)) say(l);
  if (!r.cleanup.ok) process.exitCode = 3;
}

function writeOutputs(bundle: string, r: Results) {
  fs.writeFileSync(path.join(bundle, 'results.schema.json'), JSON.stringify(RESULTS_SCHEMA, null, 2));
  fs.writeFileSync(path.join(bundle, 'report.md'), renderReport(r, AREA_TITLES));
  fs.writeFileSync(path.join(bundle, 'README.txt'), [
    'Keeper on macOS: test results',
    '',
    'report.md            the summary: pass, fail or skip for every check, failures in full, what was changed and put back',
    'results.json         the same, for machines (schema: results.schema.json)',
    'system/              the Mac: macOS version, model, displays, power (identity removed)',
    'shots/               pictures of Keeper\'s own windows',
    'screen/              pictures of the whole screen or part of it (if allowed)',
    'video/               the screen recording (only with --record)',
    'data/                raw output per check',
    'logs/                the run\'s commands, Keeper\'s logs, keeper-helper\'s errors, crash reports',
    '',
    'User name, full name, home folder, computer names, serial numbers, hardware ids, MAC and email addresses were replaced in every text file.',
    '',
  ].join('\n'));
}

/** run.sh calls this when the driver itself stopped before packing: pack what is there. */
async function packOnly(runDir: string, args: Args) {
  const dir = fs.readFileSync(path.join(runDir, 'bundle-dir'), 'utf8').trim();
  const identity = readJson<Identity>(path.join(runDir, 'identity.json'), { home: os.homedir(), user: os.userInfo().username });
  const r = readJson<Results | null>(path.join(dir, 'results.json'), null);
  if (!r) { say(`Nothing to pack in ${dir}`); process.exit(1); }
  r.run.interrupted = true;
  r.run.finishedAt = new Date().toISOString();
  r.cleanup.items.push({ what: 'The test driver stopped before its own cleanup; run.sh put back the changes in its undo list', ok: true });
  r.summary = { total: r.checks.length, pass: r.checks.filter((c) => c.status === 'pass').length, fail: r.checks.filter((c) => c.status === 'fail').length, skip: r.checks.filter((c) => c.status === 'skip').length };
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(r, null, 2));
  for (const f of ['run.log', 'undo.tsv', 'undo.done']) if (fs.existsSync(path.join(runDir, f))) fs.copyFileSync(path.join(runDir, f), path.join(dir, 'logs', f === 'run.log' ? 'run-sh.log' : f));
  writeOutputs(dir, r);
  scrubTree(dir, identity);
  const sys = new Sys({ dryRun: false, logFile: path.join(runDir, 'pack.log') });
  const outDir = args.out ? path.resolve(args.out) : fs.existsSync(path.join(os.homedir(), 'Desktop')) ? path.join(os.homedir(), 'Desktop') : os.homedir();
  const zip = path.join(outDir, `${path.basename(dir)}-partial.zip`);
  const z = await zipBundle(sys, dir, zip);
  if (!z.ok) { say(`Could not make the .zip: ${z.error}`); process.exit(1); }
  fs.writeFileSync(path.join(runDir, 'zip-path'), zip);
  say(`Packed the partial results: ${zip} (${human(fs.statSync(zip).size)})`);
}

main().catch((e) => {
  say(color.red(`The test run failed: ${(e as Error).stack ?? String(e)}`));
  process.exit(1);
});
