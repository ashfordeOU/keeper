// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stage on a real Mac, one switch at a time: each is turned on and off, and
// the real settings are read with the system's own tools (defaults,
// osascript, pmset) before, during and after, to prove every value comes back.
// Then a crash (Keeper killed while Stage is on: the watchdog must put things
// back) and, if the owner agrees, a resolution switch through keeper-helper.

import { fail, pass, skip, verdict, type Ctx } from '../context';
import { sleep, until } from '../sys';
import { keeperHolds } from './awake';

export type Snapshot = Record<string, string>;

const OSA = '/usr/bin/osascript';
const READERS: Record<string, [string, string[]]> = {
  desktopIcons: ['/usr/bin/defaults', ['read', 'com.apple.finder', 'CreateDesktop']],
  dockAutohide: [OSA, ['-e', 'tell application "System Events" to get autohide of dock preferences']],
  menubarAutohide: [OSA, ['-e', 'tell application "System Events" to get autohide menu bar of dock preferences']],
  alertVolume: [OSA, ['-e', 'alert volume of (get volume settings)']],
  cursorSize: ['/usr/bin/defaults', ['read', 'com.apple.universalaccess', 'mouseDriverCursorSize']],
  visibleApps: [OSA, ['-e', 'tell application "System Events" to get name of every application process whose visible is true']],
};

/** Reads every setting Stage can change on macOS, with the owner's real environment. */
export async function readSnapshot(ctx: Ctx): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const [k, [cmd, args]] of Object.entries(READERS)) {
    const r = await ctx.sys.run(cmd, args, { timeoutMs: 20_000 });
    out[k] = r.ok ? normalise(k, r.stdout.trim()) : '<unset>';
  }
  return out;
}

export function normalise(k: string, v: string): string {
  if (k === 'desktopIcons') return /^(1|true|yes)$/i.test(v) ? 'true' : /^(0|false|no)$/i.test(v) ? 'false' : v;
  if (k === 'cursorSize') return Number.isFinite(Number(v)) ? String(Number(v)) : v;
  if (k === 'visibleApps') return v.split(/,\s*/).filter(Boolean).sort().join(', ');
  return v;
}

/** Shell commands that put the snapshot back (for the undo journal; run as the owner, not root). */
export function restoreScript(s: Snapshot): string {
  const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
  const lines: string[] = [];
  if (s.desktopIcons === '<unset>') lines.push('/usr/bin/defaults delete com.apple.finder CreateDesktop 2>/dev/null; /usr/bin/killall Finder 2>/dev/null');
  else if (s.desktopIcons === 'true' || s.desktopIcons === 'false') lines.push(`/usr/bin/defaults write com.apple.finder CreateDesktop -bool ${s.desktopIcons}; /usr/bin/killall Finder 2>/dev/null`);
  if (s.dockAutohide === 'true' || s.dockAutohide === 'false') lines.push(`${OSA} -e ${q(`tell application "System Events" to set autohide of dock preferences to ${s.dockAutohide}`)}`);
  if (s.menubarAutohide === 'true' || s.menubarAutohide === 'false') lines.push(`${OSA} -e ${q(`tell application "System Events" to set autohide menu bar of dock preferences to ${s.menubarAutohide}`)}`);
  if (/^\d+$/.test(s.alertVolume ?? '')) lines.push(`${OSA} -e ${q(`set volume alert volume ${s.alertVolume}`)}`);
  if (s.cursorSize && s.cursorSize !== '<unset>' && Number.isFinite(Number(s.cursorSize))) lines.push(`/usr/bin/defaults write com.apple.universalaccess mouseDriverCursorSize -float ${Number(s.cursorSize)} 2>/dev/null`);
  // apps Stage hid come back: show every app that was visible before
  for (const app of (s.visibleApps ?? '').split(', ').filter((a) => a && a !== '<unset>')) lines.push(`${OSA} -e ${q(`tell application "System Events" to set visible of application process "${app.replace(/["\\]/g, '')}" to true`)} 2>/dev/null`);
  return lines.join('\n') || 'true';
}

/** Which snapshot keys differ (visibleApps compares as sets). */
export function diff(a: Snapshot, b: Snapshot, keys = Object.keys(a)): string[] {
  return keys.filter((k) => (a[k] ?? '') !== (b[k] ?? ''));
}

type Expect = (before: Snapshot, during: Snapshot, extra: { holds: number; overlays: number; status: any }) => boolean | null;
const SWITCHES: { id: string; label: string; quick?: boolean; set: (s: any) => void; expect: Expect }[] = [
  { id: 'hideDock', label: 'Hide the Dock', quick: true, set: (s) => { s.hideDock = true; }, expect: (_b, d) => d.dockAutohide === 'true' },
  { id: 'muteAlerts', label: 'Mute alert sounds', quick: true, set: (s) => { s.muteAlerts = true; }, expect: (_b, d) => d.alertVolume === '0' },
  { id: 'hideMenuBar', label: 'Hide the menu bar', set: (s) => { s.hideMenuBar = true; }, expect: (_b, d) => d.menubarAutohide === 'true' },
  { id: 'hideDesktopIcons', label: 'Hide desktop icons (Finder restarts)', set: (s) => { s.hideDesktopIcons = true; }, expect: (_b, d) => d.desktopIcons === 'false' },
  { id: 'hideOtherApps', label: 'Hide other apps', set: (s) => { s.hideOtherApps = true; }, expect: (b, d) => d.visibleApps.split(', ').length < b.visibleApps.split(', ').length || null },
  { id: 'neutralCursor', label: 'Normal pointer size', set: (s) => { s.neutralCursor = true; }, expect: (b, d) => (Number(b.cursorSize) > 1 ? Number(d.cursorSize) <= 1 : null) },
  { id: 'keepAwake', label: 'Keep the Mac awake', set: (s) => { s.keepAwake = true; }, expect: (_b, _d, x) => x.holds > 0 },
  { id: 'backdrop', label: 'Backdrop', set: (s) => { s.backdrop = { ...s.backdrop, kind: 'solid' }; }, expect: (_b, _d, x) => x.overlays > 0 },
  { id: 'spotlight', label: 'Pointer spotlight', set: (s) => { s.spotlight = { ...s.spotlight, mode: 'spotlight' }; }, expect: (_b, _d, x) => x.overlays > 0 },
  { id: 'clicks', label: 'Show clicks', set: (s) => { s.clicks = true; }, expect: (_b, _d, x) => x.status?.on === true },
  { id: 'keystrokes', label: 'Show keystrokes', set: (s) => { s.keystrokes = 'shortcuts'; }, expect: (_b, _d, x) => x.status?.on === true },
  { id: 'cleanClipboard', label: 'Clean clipboard history', set: (s) => { s.cleanClipboard = true; }, expect: (_b, _d, x) => x.status?.on === true },
  { id: 'hidePrivate', label: 'Hide private things in the Island', set: (s) => { s.hidePrivate = true; }, expect: (_b, _d, x) => x.status?.on === true },
  { id: 'keepKeeperOut', label: 'Keep Keeper out of recordings', set: (s) => { s.keepKeeperOut = true; }, expect: (_b, _d, x) => x.status?.on === true },
];

/** Every switch off, from a preset's switches. */
export function allOff(sw: any): any {
  const s = structuredClone(sw ?? {});
  for (const k of Object.keys(s)) if (typeof s[k] === 'boolean') s[k] = false;
  s.apps = [];
  s.keystrokes = 'off';
  s.backdrop = { ...(s.backdrop ?? { color: '#000000', color2: '#000000' }), kind: 'off' };
  s.spotlight = { ...(s.spotlight ?? { size: 'm', dim: 0.5 }), mode: 'off' };
  s.resolution = { ...(s.resolution ?? { width: 0, height: 0 }), mode: 'keep' };
  return s;
}

const STAGE_KEYS = ['desktopIcons', 'dockAutohide', 'menubarAutohide', 'alertVolume', 'cursorSize', 'visibleApps'];

export async function runStage(ctx: Ctx) {
  const { rec } = ctx;
  const ok = await ctx.prompt.consent('stage', 'Stage: real settings are changed for a few seconds each', [
    'One at a time: the Dock and the menu bar hide; alert sounds are muted; desktop icons hide (Finder restarts); other apps hide; the pointer size goes to normal (if you enlarged it).',
    'Keeper is then stopped hard while Stage is on, to check its watchdog puts everything back by itself.',
  ], [
    'Stage puts each value back when it stops; the test reads every value with defaults/osascript before and after.',
    'Whatever is not back is put back from the values read now (written to the undo list first, so even Ctrl-C restores it).',
  ]);
  if (!ok) {
    await rec.check('stage.consent', 'Stage tests', 'auto', async () => skip('The owner said no'));
    return;
  }
  const before = await readSnapshot(ctx);
  ctx.facts.before.stage = before;
  ctx.saveData('stage-before.json', before);
  ctx.undo.add({
    id: 'stage-values', what: 'Stage: Dock, menu bar, desktop icons, alert volume, pointer size, hidden apps',
    restore: 'each value written back as read before the test (defaults / osascript)', cmd: restoreScript(before),
    verify: async () => { const now = await readSnapshot(ctx); const d = diff(before, now, STAGE_KEYS); return { ok: !d.length, detail: d.length ? `different: ${d.map((k) => `${k} ${before[k]} → ${now[k]}`).join('; ')}` : 'all as before' }; },
  });

  let base: any;
  await rec.check('stage.support', 'What Stage can do on this Mac', 'auto', async (h) => {
    const app = await ctx.app();
    const support = await app.call<any>('stage.support');
    const settings = await app.call<any>('stage.settings');
    base = settings?.presets?.[0]?.switches;
    h.artifact(ctx.saveData('stage-support.json', { support, settings }));
    const no = (support ?? []).filter((s: any) => s.support === 'no' || s.supported === false);
    return verdict(!!base, `${(support ?? []).length} switches; not possible here: ${no.map((s: any) => s.id).join(', ') || 'none'}`, support);
  });
  if (!base) return;

  const runSwitch = async (sw: (typeof SWITCHES)[number]) => rec.check(`stage.${sw.id}`, `Stage switch: ${sw.label}, on and off`, 'auto', async (h) => {
    const app = await ctx.app();
    const switches = allOff(base);
    sw.set(switches);
    // lower case: Stage's findPreset lowercases the id it is asked for (see the report)
    const id = `mactest-${sw.id.toLowerCase()}`;
    await app.call('stage.savePreset', { id, name: `Mac test: ${sw.label}`, switches, countdown: 0, limitMin: 5, shortcut: '' });
    const b = await readSnapshot(ctx);
    const st = await app.call<any>('stage.start', id, { skipCountdown: true, reason: 'Mac test' });
    await sleep(2500);
    const during = await readSnapshot(ctx);
    const status = await app.call<any>('stage.status');
    const journal = await app.call<any>('stage.journal');
    const overlays = await app.call<any[]>('stage.overlays').catch(() => []);
    const holds = keeperHolds((await ctx.sys.run('/usr/bin/pmset', ['-g', 'assertions'])).stdout, await app.pid()).length;
    await app.call('stage.stop');
    const after = (await until(async () => { const s = await readSnapshot(ctx); return diff(b, s, STAGE_KEYS).length ? null : s; }, 8000, 1000)) ?? (await readSnapshot(ctx));
    const rest = diff(b, after, STAGE_KEYS);
    const changed = diff(b, during, STAGE_KEYS);
    const expected = sw.expect(b, during, { holds, overlays: (overlays ?? []).length, status });
    h.artifact(ctx.saveData(`stage-${sw.id}.json`, { before: b, during, after, start: st, status, journal, overlays }));
    const data = { changed, notRestored: rest, expected };
    if (rest.length) return fail(`Not put back after Stop: ${rest.map((k) => `${k} ${b[k]} → ${after[k]}`).join('; ')}`, undefined, data);
    if (expected === false) return fail(`On, but the setting did not change as expected (changed: ${changed.join(', ') || 'nothing'}); notes: ${JSON.stringify(status?.notes ?? status?.skipped ?? '').slice(0, 200)}`, undefined, data);
    return pass(`${expected === null ? 'Nothing to change here (already as wanted)' : `Changed ${changed.join(', ') || '(Keeper state only)'}`}; everything back after Stop`, data);
  });

  for (const sw of SWITCHES) {
    if (ctx.args.quick && !sw.quick) continue;
    await runSwitch(sw);
  }

  await rec.check('stage.crash', 'Crash while Stage is on: the watchdog puts things back', 'auto', async (h) => {
    const app = await ctx.app();
    const switches = allOff(base);
    switches.hideDock = true;
    switches.muteAlerts = true;
    await app.call('stage.savePreset', { id: 'mactest-crash', name: 'Mac test: crash', switches, countdown: 0, limitMin: 5, shortcut: '' });
    const b = await readSnapshot(ctx);
    await app.call('stage.start', 'mactest-crash', { skipCountdown: true });
    const during = (await until(async () => { const s = await readSnapshot(ctx); return s.dockAutohide === 'true' ? s : null; }, 6000, 500)) ?? (await readSnapshot(ctx));
    const watch = await ctx.sys.run('/usr/bin/pgrep', ['-fl', 'stage-restore']);
    await ctx.closeApp('kill');
    const after = (await until(async () => { const s = await readSnapshot(ctx); return diff(b, s, STAGE_KEYS).length ? null : s; }, 20_000, 1000)) ?? (await readSnapshot(ctx));
    const left = diff(b, after, STAGE_KEYS);
    const watchAfter = await ctx.sys.run('/usr/bin/pgrep', ['-fl', 'stage-restore']);
    h.artifact(ctx.saveData('stage-crash.json', { before: b, during, after, watchdog: watch.stdout, watchdogAfter: watchAfter.stdout }));
    if (during.dockAutohide !== 'true' && b.dockAutohide !== 'true') return fail('Stage did not hide the Dock before the crash test', undefined, { during });
    return verdict(!left.length, left.length ? `Not put back 20 s after the crash: ${left.join(', ')}` : `Put back by the watchdog within 20 s (watchdog was ${watch.stdout.trim() ? 'running' : 'not seen'})`, { notRestored: left });
  });

  await rec.check('stage.next-start', 'After the crash, the next start is clean', 'auto', async (h) => {
    const app = await ctx.app();
    const st = await app.call<any>('stage.status');
    const j = await app.call<any>('stage.journal');
    h.artifact(ctx.saveData('stage-after-restart.json', { status: st, journal: j }));
    return verdict(!st?.on, `Stage is ${st?.on ? 'still on' : 'off'}; journal: ${JSON.stringify(j).slice(0, 120)}`);
  });

  if (!ctx.args.quick) {
    await rec.check('stage.resolution', 'Stage switches the screen resolution through keeper-helper (and back)', 'auto', async (h) => {
      const helper = await ctx.helper();
      if (!helper) return skip('keeper-helper is not built');
      const modes = await helper.call('stage.modes', {});
      h.artifact(ctx.saveData('stage-modes.json', modes));
      if (!modes.ok) return fail('stage.modes failed', modes.error);
      const list: any[] = modes.result?.modes ?? [];
      const cur = list.find((m) => m.current);
      const other = list.filter((m) => !m.current && m.hidpi === cur?.hidpi && m.width < (cur?.width ?? 0)).sort((a, b) => b.width - a.width)[0];
      if (!cur || !other) return skip(`No other mode to switch to (${list.length} modes)`);
      const yes = await ctx.prompt.consent('stage-resolution', 'Switch the screen resolution for about 5 seconds', [`The main screen switches from ${cur.width} × ${cur.height} to ${other.width} × ${other.height} (windows may move a little).`], [`Stage switches it back when it stops; if not, keeper-helper sets mode ${cur.id} again (in the undo list).`]);
      if (!yes) return skip('The owner said no');
      const helperBin = ctx.facts.helperBin ?? '';
      const display = modes.result?.display ?? 0;
      ctx.undo.add({
        id: 'stage-resolution', what: `Screen resolution (${cur.width} × ${cur.height})`, restore: `keeper-helper stage.setMode back to ${cur.width} × ${cur.height}`,
        cmd: `printf '%s\\n' '${JSON.stringify({ id: 1, method: 'stage.setMode', params: { display, modeId: cur.id, width: cur.width, hidpi: cur.hidpi } })}' | '${helperBin.replace(/'/g, `'\\''`)}'`,
        verify: async () => { const m = await helper.call('stage.modes', {}); const now = (m.result?.modes ?? []).find((x: any) => x.current); return { ok: now?.id === cur.id && now?.width === cur.width, detail: now ? `${now.width} × ${now.height}` : 'unknown' }; },
      });
      const app = await ctx.app();
      const sw = allOff(base);
      sw.resolution = { mode: 'set', width: other.width, height: other.height };
      await app.call('stage.savePreset', { id: 'mactest-resolution', name: 'Mac test: resolution', switches: sw, countdown: 0, limitMin: 5, shortcut: '' });
      await app.call('stage.start', 'mactest-resolution', { skipCountdown: true });
      const switched = await until(async () => { const m = await helper.call('stage.modes', {}); const c = (m.result?.modes ?? []).find((x: any) => x.current); return c && c.width === other.width ? c : null; }, 8000, 700);
      await sleep(2000);
      await app.call('stage.stop');
      const back = await until(async () => { const m = await helper.call('stage.modes', {}); const c = (m.result?.modes ?? []).find((x: any) => x.current); return c && c.width === cur.width ? c : null; }, 8000, 700);
      if (back) ctx.undo.forget('stage-resolution');
      return verdict(!!switched && !!back, `${switched ? 'switched' : 'did NOT switch'} to ${other.width} × ${other.height}; ${back ? 'back' : 'NOT back'} to ${cur.width} × ${cur.height}`, { from: cur, to: other });
    });
  }

  await ctx.undo.run('stage-values');
}
