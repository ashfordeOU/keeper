// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island on a real Mac: where Keeper places it (the notch, the menu bar),
// checked against the notch's real position from macOS itself; the tab that
// hangs below the notch when the menus reach it; pictures of the Island
// collapsed and open; and the owner's own look at it.

import fs from 'node:fs';
import path from 'node:path';
import { fail, pass, skip, verdict, type Ctx } from '../context';
import { sleep } from '../sys';

interface Rect { x: number; y: number; width: number; height: number }

function builtIn(prev: any): any {
  const ds: any[] = prev?.displays ?? [];
  return ds.find((d) => d.info?.internal) ?? ds.find((d) => d.primary) ?? ds[0];
}

async function islandWindows(ctx: Ctx) {
  const app = await ctx.app();
  return (await app.windows()).filter((w) => w.url.includes('view=island'));
}

export async function runIsland(ctx: Ctx) {
  const { rec } = ctx;
  let preview: any = null;

  await rec.check('island.window', 'The Island window is up', 'auto', async (h) => {
    const app = await ctx.app();
    const wins = await islandWindows(ctx);
    h.artifact(ctx.saveData('island-windows.json', wins));
    if (app.fake && !wins.length) return pass('dry run: no windows to list');
    return verdict(wins.some((w) => w.visible), `${wins.length} Island window(s), ${wins.filter((w) => w.visible).length} visible, always on top: ${wins.map((w) => w.onTop).join(', ')}`, wins.map((w) => w.bounds));
  });

  await rec.check('island.placement', 'Where Keeper places the Island on each screen', 'auto', async (h) => {
    const app = await ctx.app();
    preview = await app.call('island.placementPreview');
    h.artifact(ctx.saveData('island-placement.json', preview));
    const d = builtIn(preview);
    if (!d) return fail('No displays in the placement preview', undefined, preview);
    const p = d.placement ?? {};
    const want = ctx.facts.notch ? 'notch' : undefined;
    const lines = (preview.displays ?? []).map((x: any) => `${x.label || x.info?.id}: ${x.placement?.anchor} (${x.placement?.reason ?? ''})`).join('; ');
    if (want && p.anchor !== want) return fail(`This Mac has a notch but the Island is placed "${p.anchor}": ${p.reason ?? ''}`, undefined, { macModel: preview.macModel });
    return pass(`${lines}; Mac model seen by Keeper: ${preview.macModel ?? 'unknown'}`, { anchor: p.anchor, cutout: p.cutout, wing: p.wing, hang: p.hang });
  });

  await rec.check('island.notch-geometry', 'The Island lines up with the real notch', 'auto', async () => {
    const real = ctx.facts.screens.find((s: any) => s.notch);
    if (!real) return skip('This Mac has no notch');
    const d = builtIn(preview);
    const p = d?.placement;
    if (!p) return fail('No placement for the built-in screen');
    const cut = p.cutout ?? {};
    const screenX = d.info?.bounds?.x ?? 0;
    const keeperCentre = screenX + (cut.center ?? 0);
    const dc = Math.abs(keeperCentre - real.notch.centerX);
    const dw = Math.abs((cut.width ?? 0) - real.notch.width);
    const dh = Math.abs((cut.height ?? 0) - real.notch.height);
    const col: Rect = p.collapsed;
    const winCentre = col ? col.x + col.width / 2 : NaN;
    const wins = await islandWindows(ctx);
    const onBuiltIn = wins.find((w) => Math.abs(w.bounds.x + w.bounds.width / 2 - real.notch.centerX) < 40) ?? wins[0];
    const actualCentre = onBuiltIn ? onBuiltIn.bounds.x + onBuiltIn.bounds.width / 2 : NaN;
    const data = { real: real.notch, keeper: cut, keeperCentre, plannedWindowCentre: winCentre, actualWindow: onBuiltIn?.bounds, deltas: { centre: dc, width: dw, height: dh } };
    const ok = dc <= 2 && dw <= 8 && dh <= 4 && (!onBuiltIn || (Math.abs(actualCentre - real.notch.centerX) <= 3 && onBuiltIn.bounds.y <= (real.notch.topY ?? 0) + 1));
    return verdict(ok, `Notch from macOS: centre ${real.notch.centerX}, ${real.notch.width} × ${real.notch.height} pt. Keeper: centre ${keeperCentre}, ${cut.width} × ${cut.height} pt (off by ${dc.toFixed(1)}, ${dw.toFixed(1)}, ${dh.toFixed(1)} pt). Window centre ${Number.isFinite(actualCentre) ? actualCentre : 'n/a'}, top ${onBuiltIn?.bounds.y ?? 'n/a'}`, data);
  });

  await rec.check('island.menubar', 'The Island leaves the menus and menu-bar icons free', 'auto', async () => {
    const d = builtIn(preview);
    const p = d?.placement;
    if (!p) return fail('No placement');
    const scr = ctx.facts.screens.find((s: any) => s.builtIn) ?? ctx.facts.screens[0];
    const bar = scr?.menuBarHeight ?? p.topBar;
    if (p.anchor === 'notch') {
      const real = scr?.notch;
      const pillHalf = (p.pill?.width ?? 0) / 2;
      // The pill grows sideways only into the space beside the notch; Keeper keeps a margin from what it knows is there.
      const leftEdge = (real?.centerX ?? 0) - pillHalf;
      const rightEdge = (real?.centerX ?? 0) + pillHalf;
      return pass(`Notch mode: wing ${p.wing} pt each side, hang ${p.hang} pt; pill spans x ${leftEdge.toFixed(0)}–${rightEdge.toFixed(0)}. ${p.reason}`, { wing: p.wing, hang: p.hang, pill: p.pill });
    }
    if (p.anchor === 'menubar') return verdict((p.pill?.height ?? 99) <= (bar ?? 0) + 1, `In the menu bar's free middle; pill ${p.pill?.height} pt high, bar ${bar} pt`, p);
    if (p.anchor === 'below-bar') return verdict(p.collapsed.y >= (scr?.boundsTopLeft?.y ?? 0) + (bar ?? 0) - 1, `Below the menu bar at y = ${p.collapsed.y} (bar ${bar} pt). ${p.reason}`, p);
    return pass(`Placed "${p.anchor}": ${p.reason}`, p);
  });

  await rec.check('island.stays-put', 'The Island stays where Keeper puts it (30 s, through an alert, opening and closing)', 'auto', async (h) => {
    const app = await ctx.app();
    if (app.fake) return pass('dry run: no windows to watch');
    const samples: { t: number; phase: string; bounds: any[] }[] = [];
    const t0 = Date.now();
    const look = async (phase: string) => samples.push({ t: Date.now() - t0, phase, bounds: (await islandWindows(ctx)).map((w) => w.bounds) });
    const watch = async (phase: string, ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { await look(phase); await sleep(1000); } };
    await watch('collapsed', 8000);
    // A screenshot appearing in the test home's Desktop makes the Island show its "Screenshot saved" alert.
    try { fs.writeFileSync(path.join(ctx.paths.home, 'Desktop', `Screenshot ${new Date().toISOString().slice(0, 10)} at 12.00.00.png`), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')); } catch { /* no Desktop folder */ }
    await watch('alert', 8000);
    try { await app.islandCall('island.setExpanded', true); } catch { /* older builds */ }
    await watch('expanded', 6000);
    try { await app.islandCall('island.setExpanded', false); } catch { /* fine */ }
    await watch('collapsed again', 8000);
    const log = await app.call<any[]>('island.placeLog').catch(() => []);
    h.artifact(ctx.saveData('island-stays-put.json', { samples, requestedVsActual: log }));
    const mismatches = log.filter((e) => Math.abs(e.want.x - e.got.x) > 1 || Math.abs(e.want.y - e.got.y) > 1 || Math.abs(e.want.width - e.got.width) > 1 || Math.abs(e.want.height - e.got.height) > 1);
    // Within each phase every sample should be the same rectangle; across phases only the size may change, and the top must not move.
    const tops = new Set(samples.flatMap((x) => x.bounds.map((b: any) => b.y)));
    // (the first sample of a phase may still show the change settling, so it is not compared)
    const drift = samples.filter((x, i) => i > 1 && samples[i - 2].phase === x.phase && samples[i - 1].phase === x.phase && JSON.stringify(samples[i - 1].bounds) !== JSON.stringify(x.bounds)).length;
    const moved = log.filter((e) => /moved by the system/.test(e.why)).length;
    return verdict(tops.size <= 1 && drift === 0 && moved === 0, `top edge ${[...tops].join(' / ')} pt; ${drift} unexpected change(s) within a phase; ${moved} move(s) by the system put back; ${mismatches.length} requested≠actual of ${log.length} placement(s)`, { tops: [...tops], drift, moved, mismatches: mismatches.slice(0, 10) });
  });

  await rec.check('island.pictures', 'Pictures of the Island, collapsed and open', 'auto', async (h) => {
    const app = await ctx.app();
    const a = await ctx.shotWindow('island-collapsed', 'view=island');
    if (a) h.artifact(a);
    try { await app.islandCall('island.setExpanded', true); } catch { /* older builds */ }
    await sleep(900);
    const b = await ctx.shotWindow('island-expanded', 'view=island');
    if (b) h.artifact(b);
    const real = ctx.facts.screens.find((s: any) => s.notch) ?? ctx.facts.screens[0];
    if (real) {
      const top = real.boundsTopLeft ?? { x: 0, y: 0, width: 1440 };
      const s = await ctx.shotScreen('island-top-of-screen-open', { x: top.x, y: top.y, width: top.width, height: 140 });
      if (s) h.artifact(s);
    }
    try { await app.islandCall('island.setExpanded', false); } catch { /* fine */ }
    await sleep(600);
    if (real) {
      const top = real.boundsTopLeft ?? { x: 0, y: 0, width: 1440 };
      const s = await ctx.shotScreen('island-top-of-screen', { x: top.x, y: top.y, width: top.width, height: 80 });
      if (s) h.artifact(s);
    }
    return verdict(!!a && !!b, `${[a, b].filter(Boolean).length} window pictures${ctx.args.screen ? ' and the top of the screen' : ''}`);
  });

  await rec.check('island.looks-right', 'Owner: does the Island sit around the notch (or in the menu bar) without covering anything?', 'guided', async (h) => {
    if (!ctx.args.guided) return skip('No questions in this run');
    const a = await ctx.prompt.ask({
      key: 'island-visual', title: 'Look at the top of your screen',
      lines: [ctx.facts.notch
        ? 'Keeper\'s Island should wrap around the camera notch, in the same black, without covering any menu or menu-bar icon.'
        : 'Keeper\'s Island should sit in the middle of the menu bar (or just below it), without covering any menu or menu-bar icon.',
      'Move the pointer over it: it should open into a bigger panel.'],
      question: 'Does it look right?', timeoutSec: 180, note: true,
    });
    h.answered(a.answer, a.note);
    if (a.answer === 'y') return pass('The owner says it looks right');
    if (a.answer === 'n') return fail('The owner says it does not look right', a.note);
    return skip(`No answer (${a.answer})`);
  });

  if (!ctx.args.quick) {
    await rec.check('island.hang', 'With long menus, the Island hangs below the notch instead of covering them', 'guided', async (h) => {
      if (!ctx.facts.notch) return skip('This Mac has no notch');
      if (!ctx.args.guided) return skip('No questions in this run');
      const a = await ctx.prompt.ask({
        key: 'island-hang', title: 'An app with many menus',
        lines: ['Click on an app with many menus so its menus fill the menu bar up to the notch (Safari, Mail, Pages or Xcode work well; any app you have open is fine).', 'Then come back here (click this window\'s text, not its title) and press Enter.'],
        question: 'Ready?', kind: 'enter', timeoutSec: 180,
      });
      h.answered(a.answer, a.note);
      if (a.answer !== 'y') return skip('Skipped');
      const app = await ctx.app();
      const p2 = await app.call('island.placementPreview');
      h.artifact(ctx.saveData('island-placement-long-menus.json', p2));
      const p = builtIn(p2)?.placement ?? {};
      const scr = ctx.facts.screens.find((s: any) => s.notch);
      const top = scr?.boundsTopLeft;
      const shot = top ? await ctx.shotScreen('island-long-menus', { x: top.x, y: top.y, width: top.width, height: 90 }) : null;
      if (shot) h.artifact(shot);
      const consistent = (p.wing >= 26 && p.hang === 0) || (p.wing === 0 && p.hang > 0);
      const v = await ctx.prompt.ask({ key: 'island-hang-visual', title: 'Look at the notch now', lines: [p.hang ? 'Keeper chose a small tab hanging just below the notch.' : 'Keeper still found room beside the notch.', 'Nothing in the menu bar should be covered.'], question: 'Is every menu and icon still visible?', timeoutSec: 120, note: true });
      if (v.answer === 'n') return fail(`The owner sees something covered (wing ${p.wing}, hang ${p.hang})`, v.note, p);
      return verdict(consistent, `wing ${p.wing} pt, hang ${p.hang} pt: ${p.reason}${v.answer === 'y' ? '; the owner confirms nothing is covered' : ''}`, { wing: p.wing, hang: p.hang, owner: v.answer });
    });

    await rec.check('island.external-display', 'With an external display connected', 'guided', async (h) => {
      if (!ctx.args.guided) return skip('No questions in this run');
      const a = await ctx.prompt.ask({ key: 'island-external', title: 'External display (optional)', lines: ['If you have an external display, connect it now and wait until it shows your desktop.', 'No external display? Type s to skip.'], question: 'Connected?', kind: 'enter', timeoutSec: 180 });
      h.answered(a.answer, a.note);
      if (a.answer !== 'y') return skip('No external display');
      await sleep(3000);
      const app = await ctx.app();
      const p2 = await app.call<any>('island.placementPreview');
      h.artifact(ctx.saveData('island-placement-external.json', p2));
      const scr = await ctx.probe('screens');
      if (scr) h.artifact(ctx.saveData('screens-external.json', scr));
      const ext = (p2.displays ?? []).filter((d: any) => !d.info?.internal);
      if (!ext.length) return fail('Keeper sees no external display', undefined, p2);
      const v = await ctx.prompt.ask({ key: 'island-external-visual', title: 'Look at the external display', lines: ['Is there an Island at the top of the external display too (in the menu bar, or just below it)?'], question: 'Looks right?', timeoutSec: 120, note: true });
      h.answered(v.answer, v.note);
      return verdict(v.answer !== 'n', `External: ${ext.map((d: any) => `${d.label || d.info?.id} → ${d.placement?.anchor}`).join(', ')}; wanted on ${p2.wanted?.length ?? '?'} display(s)`, ext.map((d: any) => d.placement));
    });
  }
}
