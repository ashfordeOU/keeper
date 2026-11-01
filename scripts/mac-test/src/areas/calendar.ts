// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Mac's calendars through keeper-helper (EventKit) and in Keeper: access
// (asked once, with the owner), the calendar list and events (counts only:
// no titles, places or people are recorded), the "Calendar changed"
// notification when the owner edits an event in Calendar, and, only with the
// owner's yes, writing and removing one test event.

import { fail, pass, skip, verdict, type Ctx } from '../context';

/** Counts only, never titles: how many calendars per account, how many events, how many writable. */
export function calendarSummary(r: any): { calendars: number; writable: number; accounts: number; events: number; allDay: number; recurring: number; withLink: number; colours: number } {
  const cals: any[] = Array.isArray(r?.calendars) ? r.calendars : [];
  const evs: any[] = Array.isArray(r?.events) ? r.events : [];
  return {
    calendars: cals.length,
    writable: cals.filter((c) => c.writable).length,
    accounts: new Set(cals.map((c) => c.source ?? '')).size,
    events: evs.length,
    allDay: evs.filter((e) => e.allDay).length,
    recurring: evs.filter((e) => e.recurring).length,
    withLink: evs.filter((e) => /zoom\.us|meet\.google\.com|teams\.(microsoft|live)\.com|webex\.com/i.test(`${e.location ?? ''} ${e.url ?? ''} ${e.notes ?? ''}`)).length,
    colours: cals.filter((c) => /^#[0-9a-f]{6}$/i.test(c.color ?? '')).length,
  };
}

export async function runCalendar(ctx: Ctx) {
  const { rec } = ctx;
  const helper = await ctx.helper();
  if (!helper) {
    await rec.check('calendar.helper', 'keeper-helper is built', 'auto', async () => fail('keeper-helper is not built (see setup.helper-build)'));
    return;
  }
  let status = '';

  await rec.check('calendar.access', 'Calendar access as macOS reports it (no prompt)', 'auto', async (h) => {
    const r = await helper.call('calendar.access', {}, { timeoutMs: 15_000 });
    h.artifact(ctx.saveData('calendar-access.json', r));
    if (!r.ok) return fail(/Unknown method/.test(r.error ?? '') ? 'This keeper-helper is older than the calendar methods: rebuild it' : `calendar.access failed: ${r.error}`, r.error);
    status = r.result?.status ?? '';
    return pass(`status: ${status}`, r.result);
  });

  await rec.check('calendar.request', 'Calendar access: macOS asks once, the owner allows', 'guided', async (h) => {
    if (status === 'granted') return skip('Already allowed');
    if (!ctx.args.guided) return skip('Asks macOS for permission: needs the owner');
    if (status !== 'notDetermined') return skip(`macOS will not ask again (status ${status}): allow it in System Settings → Privacy & Security → Calendars`);
    const a = await ctx.prompt.ask({ key: 'calendar-allow', title: 'Calendar access', lines: ['After Enter, macOS asks whether this terminal may access your calendars. Choose “Allow Full Access”.', 'Only counts are recorded (how many calendars and events); no titles, places or people.'], question: 'Ready?', kind: 'enter', timeoutSec: 180 });
    h.answered(a.answer, a.note);
    if (a.answer !== 'y') return skip('Skipped');
    const r = await helper.call('calendar.access', { request: true }, { timeoutMs: 240_000 });
    status = r.result?.status ?? status;
    h.artifact(ctx.saveData('calendar-request.json', r));
    return verdict(status === 'granted', `status after asking: ${status}${r.error ? ` (${r.error})` : ''}`);
  });

  await rec.check('calendar.events', 'calendar.events: calendars with colours and accounts, events for two weeks (counts only)', 'auto', async (h) => {
    if (status !== 'granted' && !ctx.dry) return skip(`Calendar access is ${status || 'unknown'}`);
    const now = Date.now();
    const r = await helper.call('calendar.events', { from: now - 86_400_000, to: now + 14 * 86_400_000 }, { timeoutMs: 60_000 });
    if (!r.ok) return fail(`calendar.events failed: ${r.error}`, r.error);
    const s = { ...calendarSummary(r.result), truncated: !!r.result?.truncated, ms: r.ms };
    h.artifact(ctx.saveData('calendar-events.json', s));
    return verdict(s.calendars > 0 && s.colours === s.calendars, `${s.calendars} calendars (${s.writable} writable) in ${s.accounts} accounts, ${s.colours} with colours; ${s.events} events (${s.allDay} all-day, ${s.recurring} repeating, ${s.withLink} with a meeting link) in ${s.ms} ms`, s);
  });

  await rec.check('calendar.keeper', 'Keeper shows the Mac’s calendars (Calendar → sources)', 'auto', async (h) => {
    const app = await ctx.app();
    const access = await app.call<any>('pim.systemAccess').catch((e: Error) => ({ error: e.message }));
    await app.call('pim.syncCalendars').catch(() => undefined);
    const cals = (await app.call<any[]>('pim.calendars').catch(() => [])) ?? [];
    const sys = cals.filter((c) => c.source === 'system');
    const info = { access: { state: access?.state, via: access?.via, live: access?.live }, systemCalendars: sys.length, groups: new Set(sys.map((c) => c.group ?? '')).size };
    h.artifact(ctx.saveData('calendar-keeper.json', info));
    if (access?.state !== 'granted') return skip(`Keeper reports calendar access as ${access?.state ?? access?.error}`);
    return verdict(sys.length > 0, `${sys.length} of the Mac’s calendars in Keeper (${info.groups} accounts); live changes: ${!!access.live}`, info);
  });

  if (!ctx.args.guided || ctx.args.quick) return;

  await rec.check('calendar.watch', 'calendar.watch: Keeper hears when an event changes in Calendar', 'guided', async (h) => {
    if (status !== 'granted' && !ctx.dry) return skip(`Calendar access is ${status || 'unknown'}`);
    const a = await ctx.prompt.ask({ key: 'calendar-change', title: 'Change something in Calendar', lines: ['After Enter, the helper listens for 60 seconds.', 'Open the Calendar app and add, move or delete any event (you can delete it again afterwards).'], question: 'Ready?', kind: 'enter', timeoutSec: 180 });
    h.answered(a.answer, a.note);
    if (a.answer !== 'y') return skip('Skipped');
    const r = await helper.call('calendar.watch', {}, { streamMs: 60_000, timeoutMs: 10_000 });
    const changed = r.deltas.filter((d) => d === 'changed').length;
    h.artifact(ctx.saveData('calendar-watch.json', { deltas: r.deltas.slice(0, 20), error: r.error }));
    return verdict(changed > 0, `${r.deltas.includes('ready') ? 'listening; ' : ''}${changed} change notice(s) in 60 s${r.error ? ` (${r.error})` : ''}`);
  });

  await rec.check('calendar.write', 'calendar.save and calendar.delete: one test event, added and removed', 'guided', async (h) => {
    if (status !== 'granted' && !ctx.dry) return skip(`Calendar access is ${status || 'unknown'}`);
    const yes = await ctx.prompt.consent('calendar-write', 'Add one test event to your default calendar, then remove it', ['An event “Keeper test event” is added for tomorrow at 06:00 for 15 minutes (it may sync to your other devices for a moment).'], ['It is removed again a few seconds later.']);
    if (!yes) return skip('The owner said no');
    const t = new Date(Date.now() + 86_400_000);
    t.setHours(6, 0, 0, 0);
    const s = await helper.call('calendar.save', { title: 'Keeper test event', start: t.getTime(), end: t.getTime() + 15 * 60_000, allDay: false, alarms: [] }, { timeoutMs: 30_000 });
    if (!s.ok) return fail(`calendar.save failed: ${s.error}`, s.error);
    const id = s.result?.id;
    const ev = await helper.call('calendar.events', { from: t.getTime() - 60_000, to: t.getTime() + 3_600_000 }, { timeoutMs: 30_000 });
    const found = (ev.result?.events ?? []).some((e: any) => e.id === id);
    const d = await helper.call('calendar.delete', { id, all: true }, { timeoutMs: 30_000 });
    const ev2 = await helper.call('calendar.events', { from: t.getTime() - 60_000, to: t.getTime() + 3_600_000 }, { timeoutMs: 30_000 });
    const gone = !(ev2.result?.events ?? []).some((e: any) => e.id === id);
    h.artifact(ctx.saveData('calendar-write.json', { saved: !!id, found, deleted: d.ok, gone, error: d.error }));
    return verdict(!!id && found && d.ok && gone, `saved ${!!id}, read back ${found}, deleted ${d.ok}, gone ${gone}`);
  });
}
