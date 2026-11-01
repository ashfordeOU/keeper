// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// keeper-helper's JSON methods, called directly. The ones that need no
// permission run by themselves; the ones that do (notifications, calls, key
// events, moving the pointer) run when the permission is there, with the
// owner doing the one thing that makes them answer.

import { fail, pass, skip, verdict, type Ctx } from '../context';

export async function runHelper(ctx: Ctx) {
  const { rec } = ctx;
  const helper = await ctx.helper();
  if (!helper) {
    await rec.check('helper.built', 'keeper-helper is built', 'auto', async () => fail('keeper-helper is not built (see setup.helper-build)'));
    return;
  }
  const plain: [string, string, Record<string, unknown>, (r: any) => string][] = [
    ['hello', 'Version and abilities', {}, (r) => `version ${r.version}, macOS ${r.macos}, arm ${r.arm}, Apple model: ${JSON.stringify(r.appleModel)}, Spotlight ${r.spotlight}`],
    ['input.status', 'Input: Accessibility state (no prompt)', {}, (r) => JSON.stringify(r)],
    ['notifications.status', 'Notifications: can the history be read', {}, (r) => JSON.stringify(r).slice(0, 200)],
    ['calls.micApps', 'Calls: apps using a microphone', {}, (r) => JSON.stringify(r).slice(0, 200)],
    ['calls.muted', 'Calls: is the microphone muted', {}, (r) => JSON.stringify(r)],
    ['hud.levels', 'Volume and brightness levels', {}, (r) => JSON.stringify(r)],
    ['desktop.getImage', 'Desktop: the current desktop picture', {}, (r) => (r.path ? 'a picture path came back' : 'no path')],
    ['voice.micState', 'Voice: microphone in use', {}, (r) => JSON.stringify(r).slice(0, 200)],
    ['voice.focus', 'Voice: is the focused field a password field', {}, (r) => JSON.stringify(r)],
    ['stage.modes', 'Stage: display modes', {}, (r) => `${r.modes?.length ?? 0} modes, current ${JSON.stringify((r.modes ?? []).find((m: any) => m.current))}`],
    ['stage.windows', 'Stage: on-screen windows (owners only)', {}, (r) => `${r.windows?.length ?? 0} windows`],
    ['stage.cursorSize', 'Stage: pointer size', {}, (r) => JSON.stringify(r)],
    ['ddc.list', 'External displays over DDC', {}, (r) => JSON.stringify(r).slice(0, 200)],
    ['language', 'On-device language detection', { text: 'Keeper keeps your files tidy and easy to find.' }, (r) => JSON.stringify(r)],
  ];
  for (const [method, title, params, show] of plain) {
    await rec.check(`helper.${method}`, `keeper-helper ${method}: ${title}`, 'auto', async (h) => {
      const r = await helper.call(method, params, { timeoutMs: 20_000 });
      h.artifact(ctx.saveData(`helper-${method}.json`, r));
      if (!r.ok) return fail(`${method} failed: ${r.error}`, r.error);
      if (method === 'hello') ctx.rec.results.system.swift = ctx.rec.results.system.swift ?? undefined;
      return pass(show(r.result ?? {}), r.result);
    });
  }

  const tcc = ctx.facts.tcc as Record<string, any>;

  await rec.check('helper.input.move', 'keeper-helper input.move: moves the pointer one point and back (Accessibility)', 'auto', async (h) => {
    if (!tcc.accessibility && !ctx.dry) return skip('Accessibility is not allowed for this terminal');
    const pos = await ctx.app().then((a) => a.main('cursor', ({ screen }: any) => screen.getCursorScreenPoint())).catch(() => null) as any;
    if (!pos) return skip('Could not read the pointer position');
    const a = await helper.call('input.move', { x: pos.x + 1, y: pos.y });
    const b = await helper.call('input.move', { x: pos.x, y: pos.y });
    h.artifact(ctx.saveData('helper-input-move.json', { a, b, pos }));
    return verdict(a.ok && b.ok, a.ok ? 'Moved and back' : `Failed: ${a.error}`);
  });

  if (!ctx.args.guided || ctx.args.quick) return;

  await rec.check('helper.notifications.watch', 'keeper-helper notifications.watch: a notification from another app', 'guided', async (h) => {
    const a = await ctx.prompt.ask({ key: 'helper-notification', title: 'A notification from another app', lines: ['After you press Enter, the helper listens for 45 seconds.', 'Make any app show a notification: for example, in Clock start a 10-second timer, or in Reminders add a reminder due in 1 minute.'], question: 'Ready?', kind: 'enter', timeoutSec: 180 });
    h.answered(a.answer, a.note);
    if (a.answer !== 'y') return skip('Skipped');
    const seen: string[] = [];
    const r = await helper.call('notifications.watch', {}, { streamMs: 45_000, timeoutMs: 10_000, onDelta: (d) => { if (seen.length < 50) seen.push(d.slice(0, 120)); } });
    h.artifact(ctx.saveData('helper-notifications-watch.json', { result: r.result, error: r.error, count: r.deltas.length, kinds: seen.map((s) => { try { const o = JSON.parse(s); return { app: o.app ?? o.bundle, keys: Object.keys(o) }; } catch { return s.slice(0, 40); } }) }));
    if (!r.ok && !r.deltas.length) return fail(`notifications.watch failed: ${r.error}`, r.error);
    return verdict(r.deltas.length > 0, `${r.deltas.length} event(s) in 45 s`);
  });

  await rec.check('helper.calls.micApps-live', 'keeper-helper calls.micApps while an app uses the microphone', 'guided', async (h) => {
    const a = await ctx.prompt.ask({ key: 'helper-call', title: 'A call (or anything using the microphone)', lines: ['Start a call in any app (FaceTime, Zoom, Teams…) or start a recording in Voice Memos or QuickTime Player.', 'Leave it running, come back here and press Enter.'], question: 'Is it running?', kind: 'enter', timeoutSec: 240 });
    h.answered(a.answer, a.note);
    if (a.answer !== 'y') return skip('Skipped');
    const r = await helper.call('calls.micApps');
    const m = await helper.call('calls.muted');
    h.artifact(ctx.saveData('helper-calls-live.json', { apps: r, muted: m }));
    const apps = r.result?.apps ?? r.result;
    const n = Array.isArray(apps) ? apps.length : 0;
    await ctx.prompt.ask({ key: 'helper-call-end', title: 'You can end the call or recording now', question: 'Done?', kind: 'enter', timeoutSec: 120 });
    return verdict(r.ok && n > 0, r.ok ? `${n} app(s) using the microphone: ${JSON.stringify(apps).slice(0, 160)}` : `Failed: ${r.error}`);
  });

  await rec.check('helper.stage.events', 'keeper-helper stage.events: key presses for the keystroke display (Input Monitoring)', 'guided', async (h) => {
    if (!tcc.inputMonitoring && !ctx.dry) return skip('Input Monitoring is not allowed for this terminal');
    const a = await ctx.prompt.ask({ key: 'helper-keys', title: 'Press some keys', lines: ['After Enter, press a few keys and click once within 8 seconds (anything harmless, e.g. the arrow keys).'], question: 'Ready?', kind: 'enter', timeoutSec: 120 });
    h.answered(a.answer, a.note);
    if (a.answer !== 'y') return skip('Skipped');
    const r = await helper.call('stage.events', {}, { streamMs: 8000, timeoutMs: 5000 });
    h.artifact(ctx.saveData('helper-stage-events.json', { error: r.error, count: r.deltas.length, sample: r.deltas.slice(0, 5) }));
    return verdict(r.deltas.length > 0, `${r.deltas.length} event(s) seen${r.error ? ` (${r.error})` : ''}`);
  });
}
