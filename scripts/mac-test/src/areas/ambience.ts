// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Ambience on a real Mac: the live wallpaper window at the desktop level
// (behind every window, above the system's own picture), pictured; a folder
// icon set on a throwaway folder and taken off again; and, only with the
// owner's yes, the still picture written to the system and put back.

import fs from 'node:fs';
import path from 'node:path';
import { fail, skip, verdict, type Ctx } from '../context';
import { sleep, until } from '../sys';

const SCENE = { kind: 'scene', scene: 'aurora', palette: 'polar', params: { speed: 1, intensity: 0.7, scale: 1, grain: 0.15, vignette: 0.35, seed: 0 } };

export async function runAmbience(ctx: Ctx) {
  const { rec } = ctx;
  let state: any;

  await rec.check('ambience.caps', 'Ambience: what Keeper can do on this Mac', 'auto', async (h) => {
    const app = await ctx.app();
    state = await app.call<any>('ambience.state');
    h.artifact(ctx.saveData('ambience-state.json', { caps: state?.caps, features: state?.features }));
    return verdict(!!state?.caps, `live: ${state?.caps?.live}; folder icons: ${state?.caps?.folderIconsHow ?? '?'}; lock screen: ${state?.caps?.lockScreen ?? '?'}`);
  });

  await rec.check('ambience.live-wallpaper', 'Live wallpaper window at the desktop level', 'auto', async (h) => {
    const app = await ctx.app();
    if (!state?.caps?.live && !app.fake) return skip('Keeper says live wallpaper is not possible here');
    await app.call('features.set', 'wallpaper', true).catch(() => undefined);
    await app.call('ambience.set', { wallpaper: { ...(state?.settings?.wallpaper ?? {}), enabled: true } });
    await app.call('ambience.setWallpaper', 'all', SCENE);
    const wins = await until(async () => { const w = (await app.windows()).filter((x) => x.url.includes('view=wallpaper')); return w.length ? w : null; }, 10_000, 500) ?? [];
    await sleep(ctx.dry ? 10 : 2500);
    const level = await app.main('wallpaper-level', ({ BrowserWindow }: any) => BrowserWindow.getAllWindows().filter((w: any) => w.webContents.getURL().includes('view=wallpaper')).map((w: any) => ({ onTop: w.isAlwaysOnTop(), focusable: w.isFocusable(), visible: w.isVisible(), bounds: w.getBounds() }))).catch(() => []);
    h.artifact(ctx.saveData('ambience-wallpaper-windows.json', { wins, level }));
    const shot = await ctx.shotScreen('ambience-desktop');
    if (shot) h.artifact(shot);
    const sh = await ctx.shotWindow('ambience-wallpaper-window', 'view=wallpaper');
    if (sh) h.artifact(sh);
    let owner = '';
    if (ctx.args.guided) {
      const a = await ctx.prompt.ask({ key: 'ambience-visual', title: 'Look at your desktop', lines: ['Move a window aside or press F11 / spread four fingers to see the desktop.', 'There should be a slowly moving aurora behind all windows (and behind the desktop icons\' labels), not on top of them.'], question: 'Do you see it behind your windows?', timeoutSec: 180, note: true });
      h.answered(a.answer, a.note);
      owner = a.answer;
    }
    await app.call('ambience.setWallpaper', 'all', { kind: 'none' });
    await app.call('ambience.set', { wallpaper: { ...(state?.settings?.wallpaper ?? {}), enabled: state?.settings?.wallpaper?.enabled ?? false } });
    const gone = await until(async () => !(await app.windows()).some((x) => x.url.includes('view=wallpaper')), 8000, 500);
    if (owner === 'n') return fail('The owner does not see the live wallpaper behind the windows (if macOS draws its own picture above the desktop level, "Always use a still picture" is the fallback)', undefined, { wins: wins.length });
    return verdict(wins.length > 0 && !!gone, `${wins.length} wallpaper window(s), ${JSON.stringify(level).slice(0, 160)}; ${gone ? 'gone again after switching off' : 'still there after switching off'}${owner ? `; owner: ${owner}` : ''}`);
  });

  await rec.check('ambience.folder-icon', 'A folder icon set and restored (on a throwaway folder)', 'auto', async (h) => {
    const app = await ctx.app();
    const folder = path.join(ctx.paths.home, 'Mac test folder');
    fs.mkdirSync(folder, { recursive: true });
    const png = await app.page<string>('folder-icon-png', () => {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d')!;
      g.fillStyle = '#4f7cff';
      g.fillRect(40, 120, 432, 320);
      return c.toDataURL('image/png');
    });
    const spec = { pattern: 'dots', color: '#4f7cff', color2: '#9db4ff', symbol: '📷' };
    const res = await app.call<any>('ambience.applyFolderIcon', [folder], spec, png || 'data:image/png;base64,iVBORw0KGgo=');
    const iconFile = path.join(folder, 'Icon\r');
    const xa = await ctx.sys.run('/usr/bin/xattr', ['-l', folder]);
    const set = ctx.dry || fs.existsSync(iconFile) || /com\.apple\.FinderInfo/.test(xa.stdout);
    const back = await app.call<any>('ambience.restoreFolderIcon', [folder]);
    const xb = await ctx.sys.run('/usr/bin/xattr', ['-l', folder]);
    const cleared = ctx.dry || !fs.existsSync(iconFile);
    h.artifact(ctx.saveData('ambience-folder-icon.json', { applied: res, restored: back, xattrSet: xa.stdout.split('\n').map((l) => l.split(':')[0]), xattrAfter: xb.stdout.split('\n').map((l) => l.split(':')[0]), iconFileDuring: set, iconFileAfter: !cleared }));
    if (res?.failed?.length) return fail(`Keeper could not set it: ${JSON.stringify(res.failed)}`);
    return verdict(set && cleared && !back?.failed?.length, `${set ? 'Set' : 'NOT set'} (custom icon file / Finder info), then ${cleared ? 'removed' : 'NOT removed'}`);
  });

  if (ctx.args.quick || !ctx.args.guided) return;

  await rec.check('ambience.still', 'The still picture written to the system desktop, and put back', 'guided', async (h) => {
    const before = await ctx.probe('desktop-get');
    if (!before) return skip('mactest-probe is not built');
    const yes = await ctx.prompt.consent('ambience-still', 'Change the desktop picture for a moment (optional)', ['Keeper writes a still picture of its wallpaper as the system desktop picture on every screen.'], ['Keeper\'s own "restore" puts the previous picture back; the test then compares every screen\'s picture with the one read now and, if needed, sets it back itself.', 'A dynamic or moving (aerial) wallpaper may come back as its plain picture: choose it again in System Settings → Wallpaper if so.']);
    if (!yes) return skip('The owner said no');
    ctx.facts.before.desktop = before;
    const probe = ctx.facts.probeBin ?? '';
    ctx.undo.add({
      id: 'desktop-picture', what: 'Desktop picture on every screen', restore: 'each screen set back to the picture read before',
      cmd: (before.screens ?? []).filter((s: any) => s.path).map((s: any) => `'${probe}' desktop-set ${s.index} '${String(s.path).replace(/'/g, `'\\''`)}'`).join('\n') || 'true',
      verify: async () => { const now = await ctx.probe('desktop-get'); const same = JSON.stringify(now?.screens?.map((s: any) => s.path)) === JSON.stringify(before.screens?.map((s: any) => s.path)); return { ok: same, detail: same ? 'every screen as before' : 'a picture differs' }; },
    });
    const app = await ctx.app();
    await app.call('ambience.setWallpaper', 'all', SCENE);
    const st = await app.call<any>('ambience.setStill');
    await sleep(3000);
    const during = await ctx.probe('desktop-get');
    const r = await app.call<any>('ambience.restoreDesktop');
    await sleep(1500);
    const after = await ctx.probe('desktop-get');
    h.artifact(ctx.saveData('ambience-still.json', { setStill: st, restore: r, changed: JSON.stringify(during?.screens) !== JSON.stringify(before.screens), back: JSON.stringify(after?.screens) === JSON.stringify(before.screens) }));
    const back = JSON.stringify(after?.screens) === JSON.stringify(before.screens);
    if (back) ctx.undo.forget('desktop-picture');
    await app.call('ambience.setWallpaper', 'all', { kind: 'none' });
    return verdict(back && r?.ok !== false, `${JSON.stringify(during?.screens) !== JSON.stringify(before.screens) ? 'changed' : 'did not change'}; ${back ? 'back as before' : `NOT back (${r?.error ?? 'different picture'}); the cleanup sets it back`}`);
  });
}
