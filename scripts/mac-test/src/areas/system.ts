// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Mac itself (always first): system information, the screens and the
// notch, the safety checks (the throwaway home really is used; what `defaults`
// does with $HOME), the setup steps run.sh did, and the privacy permissions,
// asked for one by one with the right System Settings page opened.

import fs from 'node:fs';
import path from 'node:path';
import { checkPaths, electronEnv } from '../app';
import { fail, pass, skip, verdict, type Ctx } from '../context';
import { color } from '../prompt';
import type { Identity } from '../scrub';

const num = (s: string | undefined) => (s && Number.isFinite(Number(s.trim())) ? Number(s.trim()) : undefined);

/** Fills the scrubber's identity: user, full name, computer names, serials and hardware ids. */
export async function collectIdentity(ctx: Ctx, id: Identity) {
  const r = async (c: string, a: string[]) => (await ctx.sys.run(c, a, { timeoutMs: 10_000 })).stdout.trim();
  id.user = (await r('/usr/bin/id', ['-un'])) || process.env.USER;
  id.fullName = (await r('/usr/bin/id', ['-F'])) || undefined;
  id.home = ctx.facts.realHome;
  const hosts = [await r('/usr/sbin/scutil', ['--get', 'ComputerName']), await r('/usr/sbin/scutil', ['--get', 'LocalHostName']), await r('/usr/sbin/scutil', ['--get', 'HostName']), await r('/bin/hostname', [])];
  id.hostnames = hosts.filter((h) => h && !/not set/i.test(h));
  const io = await r('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
  const grab = (key: string) => [...io.matchAll(new RegExp(`"${key}"\\s*=\\s*"([^"]+)"`, 'g'))].map((m) => m[1]);
  id.serials = [...grab('IOPlatformSerialNumber')];
  id.ids = [...grab('IOPlatformUUID')];
  const bat = await r('/usr/sbin/ioreg', ['-rn', 'AppleSmartBattery']);
  for (const m of bat.matchAll(/"(?:Serial|BatterySerialNumber|SerialNumber)"\s*=\s*"([^"]+)"/g)) id.serials.push(m[1]);
}

export async function runSystem(ctx: Ctx) {
  const { sys, rec } = ctx;
  const S = rec.results.system;

  await rec.check('system.info', 'System information', 'auto', async (h) => {
    const sw = await sys.run('/usr/bin/sw_vers', []);
    const kv = Object.fromEntries(sw.stdout.split('\n').map((l) => l.split(':').map((x) => x.trim())).filter((p) => p.length === 2));
    S.macos = kv.ProductVersion;
    S.build = kv.BuildVersion;
    S.darwin = (await sys.run('/usr/bin/uname', ['-r'])).stdout.trim();
    S.arch = (await sys.run('/usr/bin/uname', ['-m'])).stdout.trim();
    S.model = (await sys.run('/usr/sbin/sysctl', ['-n', 'hw.model'])).stdout.trim();
    S.chip = (await sys.run('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string'])).stdout.trim();
    const mem = num((await sys.run('/usr/sbin/sysctl', ['-n', 'hw.memsize'])).stdout);
    S.ramGB = mem ? Math.round(mem / 2 ** 30) : undefined;
    S.cores = num((await sys.run('/usr/sbin/sysctl', ['-n', 'hw.ncpu'])).stdout);
    S.node = process.version;
    S.xcode = (await sys.run('/usr/bin/xcode-select', ['-p'])).stdout.trim() || undefined;
    S.swift = (await sys.run('/usr/bin/xcrun', ['swift', '--version'], { timeoutMs: 30_000 })).stdout.split('\n')[0]?.trim() || undefined;
    S.terminal = process.env.TERM_PROGRAM ? `${process.env.TERM_PROGRAM} ${process.env.TERM_PROGRAM_VERSION ?? ''}`.trim() : undefined;
    const sp = await sys.run('/usr/sbin/system_profiler', ['-json', 'SPDisplaysDataType', 'SPHardwareDataType', 'SPPowerDataType'], { timeoutMs: 60_000 });
    let prof: any = {};
    try { prof = JSON.parse(sp.stdout); } catch { /* text below */ }
    fs.writeFileSync(path.join(ctx.paths.bundle, 'system', 'system_profiler.json'), sp.stdout || sp.stderr);
    h.artifact('system/system_profiler.json');
    const hw = prof.SPHardwareDataType?.[0] ?? {};
    if (!S.chip && hw.chip_type) S.chip = hw.chip_type;
    const displays: NonNullable<typeof S.displays> = [];
    for (const gpu of prof.SPDisplaysDataType ?? []) {
      for (const d of gpu.spdisplays_ndrvs ?? []) {
        displays.push({
          name: d._name ?? 'display',
          resolution: d._spdisplays_resolution ?? d.spdisplays_resolution,
          builtIn: /internal|built-?in/i.test(`${d.spdisplays_connection_type ?? ''} ${d._name ?? ''}`),
          main: d.spdisplays_main === 'spdisplays_yes',
        });
      }
    }
    S.displays = displays;
    const power = prof.SPPowerDataType ?? [];
    const batInfo = power.find((p: any) => p._name === 'spbattery_information');
    const batt = await sys.run('/usr/bin/pmset', ['-g', 'batt']);
    fs.writeFileSync(path.join(ctx.paths.bundle, 'system', 'pmset-batt.txt'), batt.stdout);
    const pct = /(\d+)%/.exec(batt.stdout);
    S.battery = {
      present: !!batInfo || /InternalBattery/.test(batt.stdout),
      percent: pct ? Number(pct[1]) : undefined,
      charging: /;\s*charging/.test(batt.stdout),
      source: /AC Power/.test(batt.stdout) ? 'on power' : /Battery Power/.test(batt.stdout) ? 'on battery' : undefined,
      cycles: batInfo?.sppower_battery_health_info?.sppower_battery_cycle_count,
    };
    for (const [f, cmd, args] of [['sw_vers.txt', '/usr/bin/sw_vers', []], ['pmset-g.txt', '/usr/bin/pmset', ['-g']], ['pmset-custom.txt', '/usr/bin/pmset', ['-g', 'custom']]] as [string, string, string[]][]) {
      fs.writeFileSync(path.join(ctx.paths.bundle, 'system', f), (await sys.run(cmd, args)).stdout);
      h.artifact(`system/${f}`);
    }
    const major = Number((S.macos ?? '0').split('.')[0]);
    Object.assign(ctx.facts, { macos: S.macos ?? '', macosMajor: major, darwin: S.darwin ?? '', model: S.model ?? '', arm: S.arch === 'arm64', battery: !!S.battery.present });
    if (!S.macos) return fail('sw_vers gave no macOS version', sw.stderr);
    return pass(`macOS ${S.macos} (${S.build}) on ${S.model}, ${S.chip}, ${S.ramGB} GB, ${displays.length} display${displays.length === 1 ? '' : 's'}${S.battery.present ? `, battery ${S.battery.percent ?? '?'} %` : ''}`);
  });

  await rec.check('system.screens', 'Screens and the notch, as macOS reports them', 'auto', async (h) => {
    const p = await ctx.probe('screens');
    if (!p) return skip('mactest-probe is not built (see setup)');
    ctx.facts.screens = p.screens ?? [];
    h.artifact(ctx.saveData('screens.json', p));
    const notch = ctx.facts.screens.find((s: any) => s.notch);
    ctx.facts.notch = !!notch;
    S.notch = !!notch;
    for (const d of S.displays ?? []) if (d.builtIn) d.notch = !!notch;
    return pass(notch
      ? `Notch on "${notch.name}": ${notch.notch.width} × ${notch.notch.height} pt, centred at x = ${notch.notch.centerX}; menu bar ${notch.menuBarHeight} pt`
      : `${ctx.facts.screens.length} screen(s), no notch; menu bar ${ctx.facts.screens[0]?.menuBarHeight ?? '?'} pt`, { screens: ctx.facts.screens.length, notch: !!notch });
  });

  await rec.check('system.sandbox', 'Keeper is kept to a throwaway home folder', 'setup', async (h) => {
    // A tiny app with Keeper's name, started exactly the way Keeper will be, reports every folder Electron would use.
    if (ctx.dry && !ctx.args.realApp) { ctx.facts.sandboxOk = true; return pass('dry run: the stand-in app has no folders'); }
    const env = electronEnv({ home: ctx.paths.home, userData: ctx.paths.userData, sandboxPaths: path.join(ctx.paths.root, 'scripts/mac-test/sandbox-paths.cjs'), env: {} });
    let bin = '';
    try { bin = (await import('node:module')).createRequire(path.join(ctx.paths.root, 'package.json'))('electron') as string; } catch (e) { return fail('Electron is not installed (npm ci did not finish?)', String(e)); }
    const r = await ctx.sys.runReal(bin, [path.join(ctx.paths.root, 'scripts/mac-test/path-probe'), `--user-data-dir=${ctx.paths.userData}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env, timeoutMs: 60_000 });
    const line = r.stdout.split('\n').find((l) => l.startsWith('KEEPER_PATHS '));
    if (!line) return fail('The folder check app did not answer', r.stderr.slice(0, 2000));
    const paths = JSON.parse(line.slice('KEEPER_PATHS '.length));
    h.artifact(ctx.saveData('electron-paths.json', paths));
    const bad = checkPaths(paths, ctx.paths.home);
    ctx.facts.sandboxOk = bad.length === 0;
    return verdict(!bad.length, bad.length ? `Some folders would be the owner's own: ${bad.join('; ')}. Keeper will not be started.` : `All ${Object.keys(paths).length} of Electron's folders are inside the throwaway home`, paths);
  });

  await rec.check('system.defaults-home', 'Does `defaults` follow $HOME? (decides whether Stage changes reach the real settings)', 'auto', async () => {
    const real = await sys.run('/usr/bin/defaults', ['read', 'com.apple.dock', 'orientation']);
    const temp = await sys.run('/usr/bin/defaults', ['read', 'com.apple.dock', 'orientation'], { env: { ...process.env, HOME: ctx.paths.home } });
    const same = real.code === temp.code && real.stdout === temp.stdout;
    return pass(same ? '`defaults` ignores $HOME: Keeper\'s Stage changes under the throwaway home reach the real settings (as intended for this test)' : '`defaults` follows $HOME here: Stage changes made by Keeper land in the throwaway home', { same, realCode: real.code, tempCode: temp.code });
  });

  await rec.check('system.real-keeper-data', 'The owner\'s own Keeper data, before the run (to prove it is not touched)', 'setup', async () => {
    const fp = fingerprint(path.join(ctx.facts.realHome, 'Library/Application Support/Keeper'));
    ctx.saveData('real-keeper-before.json', fp);
    ctx.facts.realKeeperBefore = fp;
    return pass(fp.exists ? `Found ${fp.files} files (newest change ${fp.newest ? new Date(fp.newest).toISOString() : 'unknown'}); compared again at the end` : 'No Keeper data on this Mac; checked again at the end');
  });
}

export function fingerprint(dir: string): { exists: boolean; files: number; newest: number; bytes: number } {
  const out = { exists: fs.existsSync(dir), files: 0, newest: 0, bytes: 0 };
  const walk = (d: string, depth: number) => {
    if (depth > 6 || out.files > 50_000) return;
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else {
        try { const st = fs.lstatSync(p); out.files++; out.bytes += st.size; out.newest = Math.max(out.newest, st.mtimeMs); } catch { /* gone */ }
      }
    }
  };
  if (out.exists) walk(dir, 0);
  return out;
}

/** The setup steps run.sh did (prerequisites, npm ci, the build, the Swift builds), as checks. */
export function recordSetup(ctx: Ctx) {
  const f = path.join(ctx.paths.run, 'setup.tsv');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const [id, status, secs, title, detail, log] = line.split('\t');
    const st = status === 'pass' || status === 'fail' || status === 'skip' ? status : 'fail';
    const logRel = log ? `logs/${path.basename(log)}` : '';
    if (log && fs.existsSync(log)) fs.copyFileSync(log, path.join(ctx.paths.bundle, logRel));
    ctx.rec.results.checks.push({
      id: `setup.${id}`, area: 'setup', title: title || id, kind: 'setup', status: st, details: detail || '', startedAt: ctx.rec.results.run.startedAt,
      durationMs: Math.round(Number(secs || 0) * 1000), artifacts: logRel && fs.existsSync(path.join(ctx.paths.bundle, logRel)) ? [logRel] : [],
    });
  }
  ctx.rec.save();
}

const PANES: Record<string, string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  input: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  fda: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
};

/** Guided: the privacy permissions the tests need, given to the terminal app this runs in. */
export async function runPermissions(ctx: Ctx) {
  const term = process.env.TERM_PROGRAM === 'iTerm.app' ? 'iTerm' : process.env.TERM_PROGRAM === 'Apple_Terminal' ? 'Terminal' : (process.env.TERM_PROGRAM || 'your terminal app');
  const before = (await ctx.probe('tcc')) ?? {};
  ctx.facts.tcc = before;
  ctx.saveData('permissions-before.json', before);
  const list: { key: string; field: string; title: string; why: string; quick: boolean; request?: string }[] = [
    { key: 'screen', field: 'screenRecording', title: 'Screen & System Audio Recording', why: 'whole-screen pictures, the Island around the notch, the computer\'s sound for Voice', quick: true, request: 'screen' },
    { key: 'accessibility', field: 'accessibility', title: 'Accessibility', why: 'moving the pointer (Keep Awake), password-field checks (Voice), Stage hiding apps', quick: true, request: 'accessibility' },
    { key: 'input', field: 'inputMonitoring', title: 'Input Monitoring', why: 'the talk key for Voice and Stage\'s keystroke display', quick: false, request: 'input' },
    { key: 'microphone', field: 'microphone', title: 'Microphone', why: 'a level reading and a spoken sentence for Voice', quick: false, request: 'microphone' },
    { key: 'fda', field: 'fullDiskAccess', title: 'Full Disk Access', why: 'reading the Find My cache\'s state and notification history (read only, nothing is copied)', quick: false },
  ];
  ctx.say(color.b(`The tests ask macOS for some permissions. They are given to ${term} (the app this runs in), not to Keeper.`));
  ctx.say(color.dim('You can turn each one off again afterwards in System Settings → Privacy & Security. Every step can be skipped.'));
  for (const p of list) {
    if (ctx.args.quick && !p.quick) continue;
    const granted = (v: any) => v === true || v === 'granted';
    await ctx.rec.check(`permissions.${p.key}`, `Permission: ${p.title}`, 'guided', async (h) => {
      if (granted(before[p.field])) return pass(`Already allowed for ${term}`);
      if (!ctx.args.guided) return skip('Not allowed, and this run asks no questions (--no-guided)');
      if (p.request) await ctx.probe('request', p.request);
      if (!ctx.dry) await ctx.sys.run('/usr/bin/open', [PANES[p.key]]);
      const a = await ctx.prompt.ask({
        key: `permission-${p.key}`, title: `Allow ${p.title} for ${term}`,
        lines: [`Needed for: ${p.why}.`, `System Settings is open at Privacy & Security → ${p.title}. Turn on ${term} there${p.key === 'fda' ? ' (use + to add it if it is not listed)' : ''}.`,
          ...(p.key === 'screen' ? [color.dim('If macOS says the app must quit and reopen, choose "Later": the test notes whether it took effect.')] : [])],
        question: 'Done?', kind: 'enter', timeoutSec: 240,
      });
      h.answered(a.answer, a.note);
      if (a.answer !== 'y') return skip(`Skipped by the owner (${a.answer})`);
      const now = (await ctx.probe('tcc')) ?? {};
      ctx.facts.tcc = now;
      if (granted(now[p.field])) return pass(`Allowed for ${term}`);
      return fail(`Still not allowed for ${term} after the owner said done${p.key === 'screen' ? ' (macOS may only apply it after the terminal app restarts)' : ''}`, undefined, { now: now[p.field] });
    });
  }
  ctx.saveData('permissions-after.json', ctx.facts.tcc);
}
