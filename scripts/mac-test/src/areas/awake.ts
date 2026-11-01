// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keep Awake on a real Mac: the caffeinate hold (seen in `pmset -g
// assertions`), letting go again, the stats, the menu-bar icon, and (only with
// the owner's yes) closed-lid mode: its one-time setup, a real closed lid, and
// the watchdog that turns sleep back on when Keeper's process is gone.

import fs from 'node:fs';
import { fail, pass, skip, verdict, type Ctx } from '../context';
import { until } from '../sys';

const SUDOERS = '/etc/sudoers.d/keeper-awake';

async function assertions(ctx: Ctx) {
  return (await ctx.sys.run('/usr/bin/pmset', ['-g', 'assertions'], { timeoutMs: 10_000 })).stdout;
}

const HOLD = /Prevent(User)?Idle(System|Display)Sleep|PreventSystemSleep|NoIdleSleep|NoDisplaySleep/;

/**
 * Keeper's own processes: Keeper, everything under it (its caffeinate,
 * keeper-helper, Electron's helpers), and any caffeinate started with
 * `-w <Keeper's pid>` (the way Keeper starts it), from `ps -A -o pid=,ppid=,command=`.
 */
export function keeperPids(psText: string, keeperPid: number | undefined): Set<number> {
  const out = new Set<number>();
  if (!keeperPid) return out;
  const rows = psText.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ pid: +m[1], ppid: +m[2], cmd: m[3] }));
  out.add(keeperPid);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) if (!out.has(r.pid) && out.has(r.ppid)) { out.add(r.pid); grew = true; }
  }
  for (const r of rows) if (/(^|\/)caffeinate\b/.test(r.cmd) && new RegExp(`\\s-w\\s+${keeperPid}(\\s|$)`).test(r.cmd)) out.add(r.pid);
  return out;
}

/**
 * Lines of `pmset -g assertions` held by Keeper's own processes. A caffeinate
 * or another app's hold that has nothing to do with Keeper (one started 40
 * hours ago in a terminal, say) is not counted.
 */
export function keeperHolds(text: string, pids: Set<number>): string[] {
  return text.split('\n').filter((l) => {
    const m = /pid (\d+)\(([^)]*)\)/.exec(l);
    return !!m && pids.has(Number(m[1])) && HOLD.test(l);
  });
}

/** Keeper's holds right now (reads ps and pmset). */
export async function currentKeeperHolds(ctx: Ctx, keeperPid: number | undefined): Promise<{ text: string; holds: string[] }> {
  const text = await assertions(ctx);
  const ps = await ctx.sys.run('/bin/ps', ['-A', '-o', 'pid=,ppid=,command=']);
  return { text, holds: keeperHolds(text, keeperPids(ps.stdout, keeperPid)) };
}

async function sleepDisabled(ctx: Ctx): Promise<boolean | null> {
  const r = await ctx.sys.run('/usr/bin/pmset', ['-g']);
  const m = /SleepDisabled\s+(\d)/.exec(r.stdout);
  return m ? m[1] === '1' : null;
}

export async function runAwake(ctx: Ctx) {
  const { rec } = ctx;

  await rec.check('awake.hold', 'Keep Awake holds the Mac awake (pmset assertions)', 'auto', async (h) => {
    const app = await ctx.app();
    const before = await assertions(ctx);
    const st = await app.call<any>('awake.start', { minutes: 30, reason: 'Mac test' });
    const pid = await app.pid();
    const now = (await until(async () => { const c = await currentKeeperHolds(ctx, pid); return c.holds.length ? c : null; }, 8000, 500)) ?? (await currentKeeperHolds(ctx, pid));
    h.artifact(ctx.saveData('awake-assertions-before.txt', before));
    h.artifact(ctx.saveData('awake-assertions-during.txt', now.text));
    h.artifact(ctx.saveData('awake-status.json', st));
    const holds = now.holds;
    const caf = await ctx.sys.run('/usr/bin/pgrep', ['-fl', 'caffeinate']);
    return verdict(holds.length > 0, holds.length ? `Held: ${holds.map((l) => l.trim().replace(/\s+/g, ' ')).join(' | ').slice(0, 300)}` : 'No hold by Keeper or its caffeinate in pmset -g assertions', { holds, caffeinate: caf.stdout.trim() });
  });

  await rec.check('awake.menubar-icon', 'Menu-bar icon and time left (owner looks)', 'guided', async (h) => {
    const scr = ctx.facts.screens.find((s: any) => s.main) ?? ctx.facts.screens[0];
    if (scr) {
      const b = scr.boundsTopLeft;
      const shot = await ctx.shotScreen('awake-menubar-right', { x: b.x + b.width * 0.55, y: b.y, width: b.width * 0.45, height: Math.max(30, scr.menuBarHeight ?? 30) });
      if (shot) h.artifact(shot);
    }
    if (!ctx.args.guided) return skip('No questions in this run');
    const a = await ctx.prompt.ask({ key: 'awake-icon', title: 'Keep Awake in the menu bar', lines: ['A 30-minute Keep Awake session is running.', 'Look at the right side of the menu bar: Keeper\'s owl icon (eyes open while awake) should be there, with the time left (about 30 min) next to it.', 'Click it: the menu should show the session.'], question: 'Do you see the owl and the time left?', timeoutSec: 180, note: true });
    h.answered(a.answer, a.note);
    return a.answer === 'y' ? pass('The owner sees the icon and time') : a.answer === 'n' ? fail('The owner does not see it', a.note) : skip('No answer');
  });

  await rec.check('awake.release', 'Stopping lets the Mac sleep again', 'auto', async (h) => {
    const app = await ctx.app();
    await app.call('awake.stop');
    const pid = await app.pid();
    const after = (await until(async () => { const c = await currentKeeperHolds(ctx, pid); return c.holds.length ? null : c; }, 8000, 500)) ?? (await currentKeeperHolds(ctx, pid));
    h.artifact(ctx.saveData('awake-assertions-after.txt', after.text));
    const left = after.holds;
    // Other programs' holds (a caffeinate started by hand, a video call) are listed for the report but do not count.
    const others = after.text.split('\n').filter((l) => /pid \d+\(/.test(l) && HOLD.test(l) && !left.includes(l)).length;
    return verdict(!left.length, left.length ? `Still held by Keeper: ${left.join(' | ')}` : `No hold left by Keeper${others ? ` (${others} hold(s) by other programs, not Keeper's)` : ''}`);
  });

  await rec.check('awake.stats', 'Keep Awake statistics and blockers', 'auto', async (h) => {
    const app = await ctx.app();
    const stats = await app.call<any>('awake.stats');
    const blockers = await app.call<any>('awake.blockers');
    h.artifact(ctx.saveData('awake-stats.json', { stats, blockers }));
    const sessions = stats?.sessions ?? stats?.count ?? stats?.total?.sessions;
    return verdict(!!stats && !!blockers && !blockers.error, `stats: ${JSON.stringify(stats).slice(0, 160)}; blockers from "${blockers?.source}": ${blockers?.list?.length ?? 0}`, { sessions, blockers: blockers?.list?.length });
  });

  if (ctx.args.quick) return;

  await rec.check('awake.closed-lid', 'Closed-lid mode: setup, a real closed lid, and the crash watchdog', 'guided', async (h) => {
    if (!ctx.facts.battery) return skip('Not a laptop (no lid)');
    if (!ctx.args.guided) return skip('Needs the owner (setup password and closing the lid)');
    const existed = ctx.dry ? false : fs.existsSync(SUDOERS);
    const wasDisabled = await sleepDisabled(ctx);
    ctx.facts.before.sleepDisabled = wasDisabled;
    ctx.facts.before.awakeSudoers = existed;
    if (wasDisabled) return skip('Sleep is already turned off on this Mac (pmset disablesleep 1); not touching it');
    const ok = await ctx.prompt.consent('awake-closed-lid', 'Closed-lid mode (optional, needs your password)', [
      `Keeper's one-time setup adds ${SUDOERS}: it lets Keeper run only "pmset -a disablesleep 0" and "pmset -a disablesleep 1" without a password. macOS asks for your password once.`,
      'During the test, sleep is turned off ("pmset -a disablesleep 1") so the Mac stays awake with the lid closed.',
      'Then Keeper is stopped hard, to check its watchdog turns sleep back on by itself.',
    ], [
      'Sleep is turned back on ("pmset -a disablesleep 0"), checked with "pmset -g".',
      `${SUDOERS} is removed again with "sudo rm" (macOS asks for your password in this window)${existed ? ' — it was already there before, so it is left as it was' : ''}.`,
    ]);
    if (!ok) return skip('The owner said no');
    ctx.undo.add({
      id: 'awake-closed-lid', admin: true,
      what: `Closed-lid setup (${SUDOERS}) and sleep turned off`,
      restore: `pmset -a disablesleep 0${existed ? '' : `; rm ${SUDOERS}`}`,
      cmd: `/usr/bin/pmset -a disablesleep 0${existed ? '' : `; /bin/rm -f ${SUDOERS}`}`,
      verify: async () => {
        const off = await sleepDisabled(ctx);
        const gone = existed || ctx.dry || !fs.existsSync(SUDOERS);
        return { ok: off === false && gone, detail: `SleepDisabled ${off === null ? '?' : off ? 1 : 0}; ${SUDOERS} ${gone ? (existed ? 'kept (was there before)' : 'removed') : 'still there'}` };
      },
    });
    const app = await ctx.app();
    ctx.say('  macOS will ask for your password (Keeper\'s own setup dialog)…');
    const setup = await app.call<any>('awake.setupClosedDisplay');
    h.artifact(ctx.saveData('awake-closed-setup.json', setup));
    if (!setup?.ok) return fail(`The setup did not finish: ${setup?.message ?? 'no answer'}`);
    await app.call('awake.start', { minutes: 15, reason: 'Mac test: closed lid', options: { closedDisplay: true } });
    const on = await until(() => sleepDisabled(ctx), 10_000, 500);
    if (!on) return fail('Sleep was not turned off (pmset -g shows SleepDisabled 0)', undefined, await app.call('awake.status'));
    const sleptBefore = (await ctx.sys.run('/usr/sbin/sysctl', ['-n', 'kern.sleeptime'])).stdout.trim();
    const lid = await ctx.prompt.ask({ key: 'awake-close-lid', title: 'Close the lid', lines: ['Plug in the power adapter if you can (macOS likes that for closed-lid use).', 'Close the lid, wait 20 seconds, then open it again.'], question: 'Done?', kind: 'enter', timeoutSec: 300 });
    h.answered(lid.answer, lid.note);
    const sleptAfter = (await ctx.sys.run('/usr/sbin/sysctl', ['-n', 'kern.sleeptime'])).stdout.trim();
    const stayedAwake = lid.answer === 'y' ? sleptAfter === sleptBefore : undefined;
    // the watchdog: Keeper's process disappears, and sleep must come back on by itself
    await ctx.closeApp('kill');
    const back = await until(async () => (await sleepDisabled(ctx)) === false, 20_000, 1000);
    const data = { stayedAwake, sleptBefore, sleptAfter, watchdogRestored: !!back };
    if (lid.answer === 'y' && !stayedAwake) return fail('The Mac went to sleep with the lid closed (kern.sleeptime changed)', undefined, data);
    if (!back) return fail('After Keeper was stopped hard, sleep stayed off: the watchdog did not turn it back on (the cleanup will)', undefined, data);
    return pass(`${lid.answer === 'y' ? 'Stayed awake with the lid closed; ' : ''}the watchdog turned sleep back on ${back ? 'within 20 s' : ''} after Keeper was killed`, data);
  });
  if (ctx.undo.pending.some((i) => i.id === 'awake-closed-lid')) await ctx.undo.run('awake-closed-lid');
}
