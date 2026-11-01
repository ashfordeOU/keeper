// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Monorail present: Keeper and Monorail on the same Mac (docs/KEEPER-MONORAIL.md).
// Runs only when Monorail is installed (it is skipped otherwise, with a note).
//
//   monorail.present      installed, running, its local API answers
//   monorail.manages      Monorail tiles Keeper's main window (it lists it, not floating)
//   monorail.ignores      Keeper's overlays (the Island, Stage's overlay, Quick Search…) are not in its list
//   monorail.shortcuts    no Keeper shortcut is also one of Monorail's (its real keymap)
//   monorail.stage        Stage hides other apps and shows them again: Monorail's layout is as it was
//   monorail.focus        a Focus session in Keeper switches Monorail's focus mode, and back
//
// The last two change things on the Mac for a few seconds and ask first. Keeper
// (in its throwaway home) is then pointed at the real Monorail folder through
// KEEPER_MONORAIL_DIR; Monorail's settings.json is copied first and put back.

import fs from 'node:fs';
import path from 'node:path';
import { OVERLAY_TITLES, findClashes, keeperAccelerators, monorailShortcuts, type MonorailSettings } from '../../../../core/ashforde/monorail';
import { layoutIntact, layoutRepairs, parseWindows, type MonoWindow } from '../../../../core/ashforde/coexist';
import { fail, pass, skip, verdict, type Ctx } from '../context';
import { sleep, until } from '../sys';

const BUNDLE = 'org.ashforde.macslider';

function monorailDir(ctx: Ctx) {
  return path.join(ctx.facts.realHome, 'Library', 'Application Support', 'Monorail');
}

async function findApp(ctx: Ctx): Promise<string | undefined> {
  for (const p of ['/Applications/Monorail.app', path.join(ctx.facts.realHome, 'Applications', 'Monorail.app')]) if (ctx.dry || fs.existsSync(p)) return p;
  const r = await ctx.sys.run('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${BUNDLE}'`]);
  return r.stdout.split('\n').map((l) => l.trim()).find((l) => l.endsWith('.app') && !l.includes('/.Trash/'));
}

/** Monorail's local API, with the real home's key; undefined when it does not answer. */
async function api(ctx: Ctx, method: 'GET' | 'POST', route: string, body?: unknown): Promise<any> {
  if (ctx.dry) return undefined;
  try {
    const dir = monorailDir(ctx);
    const token = fs.readFileSync(path.join(dir, 'api-token'), 'utf8').trim();
    const port = Number(fs.readFileSync(path.join(dir, 'api-port'), 'utf8').trim());
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : undefined;
  } catch {
    return undefined;
  }
}

/** Keeper's windows as Monorail lists them (unpackaged, Keeper runs as "Electron"). */
const keeperIn = (list: MonoWindow[]) => list.filter((w) => /^(Keeper|Electron)$/i.test(w.app) || w.bundleID === 'io.github.ashfordeou.keeper' || w.bundleID === 'com.github.Electron');

export async function runMonorail(ctx: Ctx) {
  const { rec } = ctx;
  const appPath = await findApp(ctx);
  if (!appPath) {
    await rec.check('monorail.present', 'Monorail installed', 'auto', async () => skip('Monorail is not installed on this Mac, so the "Monorail present" checks do not apply'));
    return;
  }
  let apiOn = false;

  await rec.check('monorail.present', 'Monorail installed, running, its local API answers', 'auto', async (h) => {
    const running = (await ctx.sys.run('/usr/bin/pgrep', ['-x', 'Monorail'])).ok;
    const state = running ? await api(ctx, 'GET', '/state') : undefined;
    apiOn = state !== undefined;
    h.artifact(ctx.saveData('monorail-state.json', { appPath, running, state }));
    if (!running) return skip(`Installed at ${appPath} but not running; open it and run this area again (--only monorail)`);
    if (!apiOn) return skip('Running, but its local API is off (Monorail → Settings → Automation, or Connect in Keeper → Settings → Ashforde apps); the window checks need it');
    return pass(`Running at ${appPath}; the local API answers`);
  });

  await rec.check('monorail.manages', 'Monorail tiles Keeper’s main window', 'auto', async (h) => {
    if (!apiOn) return skip('Monorail’s local API is not available');
    const app = await ctx.app();
    await app.main('show main', ({ BrowserWindow }: any) => { const w = BrowserWindow.getAllWindows().find((x: any) => x.getTitle().includes('Keeper') && x.isResizable()); w?.show(); w?.focus(); return true; });
    const found = await until(async () => keeperIn(parseWindows(await api(ctx, 'GET', '/windows'))).find((w) => /Keeper/.test(w.title) && !w.floating), 8000, 500);
    const all = keeperIn(parseWindows(await api(ctx, 'GET', '/windows')));
    h.artifact(ctx.saveData('monorail-keeper-windows.json', all));
    const min = await app.main('main min size', ({ BrowserWindow }: any) => BrowserWindow.getAllWindows().map((w: any) => ({ title: w.getTitle(), min: w.getMinimumSize() })));
    return verdict(!!found, found ? `Tiled on workspace ${found.workspace}, slide ${found.slide}` : 'Monorail does not tile Keeper’s main window', { found, min });
  });

  await rec.check('monorail.ignores', 'Monorail leaves Keeper’s overlays alone', 'auto', async (h) => {
    if (!apiOn) return skip('Monorail’s local API is not available');
    const app = await ctx.app();
    // The Island is up already; add Stage's overlay for a moment.
    await app.call('stage.preview', 'spotlight').catch(() => undefined);
    await sleep(1500);
    const list = keeperIn(parseWindows(await api(ctx, 'GET', '/windows')));
    const overlays = new Set<string>(Object.values(OVERLAY_TITLES));
    const caught = list.filter((w) => overlays.has(w.title) || w.title.startsWith('Keeper Stage'));
    h.artifact(ctx.saveData('monorail-overlays.json', { list, caught }));
    return verdict(!caught.length, caught.length ? `Monorail tracks ${caught.map((w) => `${w.title}${w.floating ? ' (floating)' : ' (tiled)'}`).join(', ')}` : `None of Keeper’s ${overlays.size} overlay kinds is in Monorail’s list`);
  });

  await rec.check('monorail.shortcuts', 'No shortcut is wanted by both apps', 'auto', async (h) => {
    let ms: MonorailSettings = {};
    try { ms = JSON.parse(fs.readFileSync(path.join(monorailDir(ctx), 'settings.json'), 'utf8')); } catch { /* defaults */ }
    const app = await ctx.app();
    const s = await app.call<any>('settings.get');
    const clashes = findClashes(keeperAccelerators(s, { 'Stop using the computer': 'Control+Alt+Command+.' }), monorailShortcuts(ms));
    const status = await app.call<any>('ashforde.monorail').catch(() => null);
    h.artifact(ctx.saveData('monorail-clashes.json', { clashes, keeperSuggestions: status?.clashes }));
    return verdict(!clashes.length, clashes.length ? clashes.map((c) => `${c.label}: Keeper ${c.keeper} / Monorail ${c.monorail}`).join('; ') : `Monorail’s ${ms.keymap ? 'own' : 'default'} keymap and Keeper’s shortcuts do not overlap`);
  });

  if (!apiOn) return;
  const settingsFile = path.join(monorailDir(ctx), 'settings.json');
  const ok = await ctx.prompt.consent('monorail', 'Keeper and Monorail together (about a minute)', [
    'Keeper is pointed at your Monorail: it may add its overlay rules to Monorail’s settings and switches Monorail’s focus mode on and off.',
    'Stage hides your other apps for a few seconds and shows them again, while Monorail’s window list is compared before and after.',
  ], [
    `Monorail’s settings.json is copied now and put back afterwards (${settingsFile}).`,
    'Focus mode and Stage are switched off again; hidden apps are shown again.',
  ]);
  if (!ok) {
    await rec.check('monorail.consent', 'Stage and Focus with Monorail', 'auto', async () => skip('The owner said no'));
    return;
  }
  const backup = path.join(ctx.paths.data, 'monorail-settings.before.json');
  if (!ctx.dry && fs.existsSync(settingsFile)) fs.copyFileSync(settingsFile, backup);
  ctx.undo.add({ id: 'monorail-settings', what: 'Monorail’s settings.json (Keeper may add overlay rules)', restore: `cp ${backup} "${settingsFile}"`, cmd: fs.existsSync(backup) ? `/bin/cp '${backup}' '${settingsFile}'` : 'true' });
  ctx.appEnv.KEEPER_MONORAIL_DIR = monorailDir(ctx);
  await ctx.closeApp();

  try {
    await rec.check('monorail.stage', 'Stage on and off leaves Monorail’s layout as it was', 'auto', async (h) => {
      const app = await ctx.app();
      const settings = await app.call<any>('stage.settings');
      const base = settings?.presets?.[0]?.switches;
      if (!base) return fail('Stage has no preset to start from');
      const switches = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, typeof v === 'boolean' ? false : v]));
      (switches as any).hideOtherApps = true;
      (switches as any).hideDock = true;
      await app.call('stage.savePreset', { id: 'mactest-monorail', name: 'Mac test: Monorail', switches, countdown: 0, limitMin: 5, shortcut: '' });
      const before = parseWindows(await api(ctx, 'GET', '/windows'));
      await app.call('stage.start', 'mactest-monorail', { skipCountdown: true, reason: 'Mac test' });
      await sleep(3000);
      const during = parseWindows(await api(ctx, 'GET', '/windows'));
      const st = await app.call<any>('stage.stop');
      const after = (await until(async () => { const l = parseWindows(await api(ctx, 'GET', '/windows')); return layoutIntact(layoutRepairs(before, l)) ? l : undefined; }, 12_000, 1000)) ?? parseWindows(await api(ctx, 'GET', '/windows'));
      const r = layoutRepairs(before, after);
      const coexist = await app.call<any>('ashforde.coexist').catch(() => null);
      h.artifact(ctx.saveData('monorail-stage.json', { before, during, after, repairs: r, lastRevert: st?.lastRevert, coexist }));
      const tiled = before.filter((w) => !w.floating).length;
      return verdict(layoutIntact(r), layoutIntact(r) ? `All ${tiled} tiled windows back on their workspace and slide` : `moved ${r.moves.length}, missing ${r.missing.length}, other slide ${r.reordered.length} (of ${tiled})`, { repairs: r, keeperNote: coexist?.lastStage });
    });

    await rec.check('monorail.focus', 'Focus follows both ways', 'auto', async (h) => {
      const app = await ctx.app();
      await app.call('features.set', 'monorail', true);
      await sleep(1500);
      const on = await (async () => {
        await app.call('island.focus', 'start', 5);
        return until(async () => (await api(ctx, 'GET', '/state'))?.focusMode === true, 6000, 400);
      })();
      await app.call('island.focus', 'stop');
      const off = await until(async () => (await api(ctx, 'GET', '/state'))?.focusMode === false, 6000, 400);
      // Monorail → Keeper
      await ctx.sys.run('/usr/bin/open', ['-g', 'monorail://focus-mode/on']);
      const kOn = await until(async () => (await app.call<any>('island.state'))?.focus?.mode === 'focus', 6000, 400);
      await ctx.sys.run('/usr/bin/open', ['-g', 'monorail://focus-mode/off']);
      const kOff = await until(async () => (await app.call<any>('island.state'))?.focus?.mode !== 'focus', 6000, 400);
      const coexist = await app.call<any>('ashforde.coexist').catch(() => null);
      const data = { keeperToMonorail: { on: !!on, off: !!off }, monorailToKeeper: { on: !!kOn, off: !!kOff }, coexist };
      h.artifact(ctx.saveData('monorail-focus.json', data));
      await app.call('features.set', 'monorail', false);
      return verdict(!!(on && off && kOn && kOff), `Keeper → Monorail ${on && off ? 'ok' : 'NO'}; Monorail → Keeper ${kOn && kOff ? 'ok' : 'NO'}`, data);
    });
  } finally {
    await ctx.closeApp();
    delete ctx.appEnv.KEEPER_MONORAIL_DIR;
    await ctx.sys.run('/usr/bin/open', ['-g', 'monorail://focus-mode/off']);
    await ctx.undo.run('monorail-settings');
  }
}
