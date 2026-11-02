// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The computer's own calendars, read live, one driver per system:
//   macOS    EventKit through keeper-helper (calendar.access / events / watch / save / delete)
//   Windows  the AppointmentStore (Windows Calendar, Outlook accounts) through a
//            PowerShell helper; Outlook's own calendar while Outlook is open as the fallback
//   Linux    Evolution Data Server over D-Bus (GNOME Online Accounts: Google,
//            Microsoft); calendar files (Evolution's local ones, KOrganizer and
//            Akonadi iCal resources) when it is not there
// Every driver answers a snapshot of calendars and events; index.ts keeps it
// cached on disk so the views work offline.

import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { powershell } from '../../../core/platform';
import { parseEvents, serializeEvents } from '../../../core/pim/ical';
import { akonadiIcalPath, mapEventKit, mapWindows, type EventKitAnswer, type SystemAccess, type SystemCalendar, type SystemSnapshot, type WindowsAnswer } from '../../../core/pim/syscal';
import type { CalendarInfo, CalEvent } from '../../../core/pim/types';

export interface SaveOptions {
  isNew: boolean;
  scope?: 'this' | 'all';
  instance?: number;
}

export interface SystemDriver {
  kind: 'mac' | 'windows' | 'linux' | 'none';
  access(request?: boolean): Promise<SystemAccess>;
  snapshot(from: number, to: number): Promise<SystemSnapshot>;
  /** tells when the system's calendars change; returns a stop function */
  watch?(onChange: () => void): () => void;
  /** writes one event family to a system calendar; answers the system's id for it */
  save?(cal: CalendarInfo, list: CalEvent[], o: SaveOptions): Promise<string | undefined>;
  remove?(cal: CalendarInfo, e: CalEvent, o: { scope?: 'this' | 'all'; instance?: number }): Promise<void>;
  close?(): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------- macOS

function macDriver(): SystemDriver {
  const call = async <T>(method: string, params?: unknown, timeoutMs = 30_000) => (await import('../platform/mac')).macHelperCall<T>(method, params, timeoutMs);
  let legacy = false;
  const toAccess = (status: string): SystemAccess => ({ ...eventKitAccess(status), raw: status });
  const eventKitAccess = (status: string): SystemAccess => {
    switch (status) {
      case 'granted': return { state: 'granted', via: 'eventkit', canRequest: false, live: true, message: 'Keeper reads the calendars of the Calendar app: iCloud, Google, Exchange and every other account added there.' };
      case 'notDetermined': return { state: 'notDetermined', via: 'eventkit', canRequest: true, message: 'Allow calendar access to see the calendars of the Calendar app here (iCloud, Google, Exchange and others).' };
      case 'writeOnly': return { state: 'denied', via: 'eventkit', canRequest: false, message: 'Keeper may only add events. To see your events, choose “Full Access” for Keeper in System Settings → Privacy & Security → Calendars.' };
      case 'restricted': return { state: 'restricted', via: 'eventkit', canRequest: false, message: 'Calendar access is turned off on this Mac by its administrator.' };
      default: return { state: 'denied', via: 'eventkit', canRequest: false, message: 'Calendar access was not allowed. Turn on Keeper in System Settings → Privacy & Security → Calendars.' };
    }
  };
  // Keeper's helper runs for hours; access given since it started (on the Permissions screen,
  // or in System Settings) may not reach it. A fresh helper sees the current answer.
  let freshAt = 0;
  const freshStatus = async (): Promise<string | undefined> => {
    // At most every half hour (the poll that calls this runs every few minutes); Allow and the Permissions screen act at once.
    if (Date.now() - freshAt < 30 * 60_000) return undefined;
    freshAt = Date.now();
    const { helperPath } = await import('../platform/mac');
    const { HelperClient } = await import('../platform/helper-client');
    const p = helperPath();
    if (!p) return undefined;
    const c = new HelperClient(p, [], 0);
    try {
      return (await c.call<{ status: string }>('calendar.status', {}, { timeoutMs: 8000 })).status;
    } catch {
      return undefined;
    } finally {
      c.stop();
    }
  };
  return {
    kind: 'mac',
    async access(request) {
      try {
        let r = await call<{ status: string }>('calendar.access', { request: !!request }, request ? 5 * 60_000 : 15_000);
        legacy = false;
        if (!request && r.status === 'notDetermined' && (await freshStatus()) === 'granted') {
          // Already allowed: asking from this helper too answers at once, without a prompt, and resets its store.
          r = await call<{ status: string }>('calendar.access', { request: true }, 30_000);
        }
        return toAccess(r.status);
      } catch (e) {
        if (/Unknown method/i.test(message(e))) {
          // An older helper: it can still read events (and asks for access on the first read).
          legacy = true;
          try {
            await call('eventkit.events', { from: Date.now(), to: Date.now() + 60_000 }, request ? 5 * 60_000 : 20_000);
            return { ...toAccess('granted'), live: false };
          } catch (e2) {
            return { ...toAccess('denied'), message: message(e2) };
          }
        }
        return { state: 'unavailable', via: 'eventkit', canRequest: false, message: 'The Mac’s calendars are read by Keeper’s helper program, which is not in this copy of Keeper.' };
      }
    },
    async snapshot(from, to) {
      if (legacy) {
        // The older helper names calendars only by their title.
        const list = await call<EventKitAnswer['events']>('eventkit.events', { from, to });
        const titles = [...new Set((list ?? []).map((e) => e.calendar ?? ''))];
        return mapEventKit({ calendars: titles.map((t) => ({ id: t, title: t || 'Calendar', writable: false })), events: list ?? [] });
      }
      return mapEventKit(await call<EventKitAnswer>('calendar.events', { from, to }, 60_000));
    },
    watch(onChange) {
      let stopped = false;
      let ac: AbortController | undefined;
      let retry: NodeJS.Timeout | undefined;
      let delay = 5000;
      const start = async () => {
        if (stopped || legacy) return;
        ac = new AbortController();
        try {
          const { macHelperStream } = await import('../platform/mac');
          await macHelperStream('calendar.watch', {}, (t) => { if (t === 'changed') onChange(); else delay = 5000; }, ac.signal);
        } catch {
          /* helper stopped or missing: try again later */
        }
        if (!stopped) {
          retry = setTimeout(() => void start(), delay);
          retry.unref?.();
          delay = Math.min(delay * 2, 10 * 60_000);
        }
      };
      void start();
      return () => { stopped = true; clearTimeout(retry); ac?.abort(); };
    },
    async save(cal, list, o) {
      const e = list.find((x) => x.recurrenceId === undefined) ?? list[0];
      const r = await call<{ id: string }>('calendar.save', {
        calendar: cal.ref, id: o.isNew ? undefined : e.href, occurrence: !o.isNew && e.etag ? Number(e.etag) : undefined, all: o.scope === 'all',
        title: e.title, start: e.start, end: e.end, allDay: e.allDay, timeZone: e.tz, location: e.location ?? '', notes: e.description ?? '', url: e.url,
        alarms: (e.alarms ?? []).map((a) => a.minutesBefore), rrule: o.isNew ? e.rrule : undefined,
      });
      return r.id;
    },
    async remove(_cal, e, o) {
      await call('calendar.delete', { id: e.href, occurrence: e.etag ? Number(e.etag) : undefined, all: o.scope === 'all' || !e.etag });
    },
  };
}

// ---------------------------------------------------------------- Windows

/** The PowerShell helper: the AppointmentStore first, then a running Outlook. Prints one JSON object. */
export function windowsScript(from: number, to: number): string {
  return String.raw`
$ErrorActionPreference = 'Stop'
$from = [DateTimeOffset]::FromUnixTimeMilliseconds(${Math.round(from)})
$to = [DateTimeOffset]::FromUnixTimeMilliseconds(${Math.round(to)})
function Emit($o) { [Console]::Out.Write(($o | ConvertTo-Json -Depth 6 -Compress)) }
$why = ''
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' } | Select-Object -First 1
  function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(-1); $task.Result }
  $null = [Windows.ApplicationModel.Appointments.AppointmentManager, Windows.ApplicationModel.Appointments, ContentType = WindowsRuntime]
  $store = Await ([Windows.ApplicationModel.Appointments.AppointmentManager]::RequestStoreAsync([Windows.ApplicationModel.Appointments.AppointmentStoreAccessType]::AllCalendarsReadOnly)) ([Windows.ApplicationModel.Appointments.AppointmentStore])
  if ($store -eq $null) { throw 'Windows did not hand out the calendar store' }
  $cals = Await ($store.FindAppointmentCalendarsAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.ApplicationModel.Appointments.AppointmentCalendar]])
  $opts = New-Object Windows.ApplicationModel.Appointments.FindAppointmentsOptions
  $opts.MaxCount = 3000
  $P = [Windows.ApplicationModel.Appointments.AppointmentProperties]
  foreach ($n in @($P::Subject, $P::Location, $P::StartTime, $P::Duration, $P::AllDay, $P::Details, $P::OnlineMeetingLink, $P::Reminder, $P::Recurrence)) { $opts.FetchProperties.Add($n) }
  $apps = Await ($store.FindAppointmentsAsync($from, ($to - $from), $opts)) ([System.Collections.Generic.IReadOnlyList[Windows.ApplicationModel.Appointments.Appointment]])
  $calOut = @(); foreach ($c in $cals) { $col = $c.DisplayColor; $calOut += @{ id = $c.LocalId; name = $c.DisplayName; account = $c.SourceDisplayName; color = ('#{0:x2}{1:x2}{2:x2}' -f $col.R, $col.G, $col.B) } }
  $evOut = @(); foreach ($a in $apps) {
    $rem = -1; if ($a.Reminder -ne $null) { $rem = [int]$a.Reminder.TotalMinutes }
    $evOut += @{ id = $a.LocalId; calendar = $a.CalendarId; title = $a.Subject; start = $a.StartTime.ToUnixTimeMilliseconds(); minutes = [int]$a.Duration.TotalMinutes; allDay = $a.AllDay; location = $a.Location; details = $a.Details; url = $a.OnlineMeetingLink; recurring = ($a.Recurrence -ne $null); reminder = $rem }
  }
  Emit @{ via = 'appointments'; calendars = @($calOut); events = @($evOut) }
  exit 0
} catch { $why = $_.Exception.Message }
try {
  $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
  $ns = $ol.GetNamespace('MAPI')
  $calOut = @(); $evOut = @()
  $f0 = $from.LocalDateTime.ToString('g'); $t0 = $to.LocalDateTime.ToString('g')
  foreach ($st in $ns.Stores) {
    try { $f = $st.GetDefaultFolder(9) } catch { continue }
    $cid = 'outlook:' + $f.EntryID
    $calOut += @{ id = $cid; name = $f.Name; account = $st.DisplayName }
    $items = $f.Items; $items.IncludeRecurrences = $true; $items.Sort('[Start]')
    $n = 0
    foreach ($i in $items.Restrict("[Start] <= '$t0' AND [End] >= '$f0'")) {
      if ($n++ -ge 3000) { break }
      $rem = -1; if ($i.ReminderSet) { $rem = [int]$i.ReminderMinutesBeforeStart }
      $evOut += @{ id = $i.EntryID; calendar = $cid; title = $i.Subject; start = ([DateTimeOffset]$i.Start).ToUnixTimeMilliseconds(); end = ([DateTimeOffset]$i.End).ToUnixTimeMilliseconds(); allDay = [bool]$i.AllDayEvent; location = $i.Location; recurring = [bool]$i.IsRecurring; reminder = $rem }
    }
  }
  Emit @{ via = 'outlook'; calendars = @($calOut); events = @($evOut) }
} catch { Emit @{ error = $why } }
`;
}

function windowsDriver(): SystemDriver {
  let last: SystemAccess | undefined;
  let lastSnap: SystemSnapshot | undefined;
  const fetchSnap = async (from: number, to: number): Promise<SystemSnapshot> => {
    const r = await powershell(windowsScript(from, to), 90_000);
    let parsed: WindowsAnswer;
    try {
      parsed = JSON.parse(r.stdout.trim() || '{}') as WindowsAnswer;
    } catch {
      parsed = { error: r.stderr.trim().split('\n')[0] || 'PowerShell gave no answer' };
    }
    if (parsed.error !== undefined || !parsed.calendars) {
      last = {
        state: 'unavailable', canRequest: true,
        message: `Windows does not let Keeper read its calendars directly${parsed.error ? ` (${parsed.error.trim()})` : ''}: that needs an app installed from a package. Outlook’s calendar is read while Outlook is open; or connect your Microsoft 365, Outlook.com or Google account in Keeper.`,
      };
      throw new Error(last.message);
    }
    last = parsed.via === 'outlook'
      ? { state: 'granted', via: 'outlook', canRequest: false, message: 'Keeper reads Outlook’s calendars while Outlook is open. Windows Calendar itself cannot be read by apps that are not installed from a package.' }
      : { state: 'granted', via: 'appointments', canRequest: false, message: 'Keeper reads the calendars of Windows Calendar and Outlook.' };
    lastSnap = mapWindows(parsed);
    return lastSnap;
  };
  return {
    kind: 'windows',
    async access(request) {
      if (request || !last) await fetchSnap(Date.now(), Date.now() + 86_400_000).catch(() => undefined);
      return last!;
    },
    snapshot: fetchSnap,
  };
}

// ---------------------------------------------------------------- Linux

/** Calendar files on this computer: Evolution's local calendars, KOrganizer's, Akonadi iCal resources. */
export async function calendarFiles(home = os.homedir()): Promise<{ ref: string; name: string; group: string; file: string }[]> {
  const out: { ref: string; name: string; group: string; file: string }[] = [];
  const data = process.env.XDG_DATA_HOME || path.join(home, '.local/share');
  const config = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const evo = path.join(data, 'evolution/calendar');
  for (const d of await fsp.readdir(evo).catch(() => [] as string[])) {
    const f = path.join(evo, d, 'calendar.ics');
    if (existsSync(f)) out.push({ ref: `file:${f}`, name: d === 'system' ? 'Personal' : d, group: 'Evolution', file: f });
  }
  const ko = path.join(data, 'korganizer');
  for (const f of await fsp.readdir(ko).catch(() => [] as string[])) if (f.endsWith('.ics')) out.push({ ref: `file:${path.join(ko, f)}`, name: f.replace(/\.ics$/, ''), group: 'KOrganizer', file: path.join(ko, f) });
  for (const f of await fsp.readdir(config).catch(() => [] as string[])) {
    if (!/^akonadi_ical_resource_\d+rc$/.test(f)) continue;
    const p = akonadiIcalPath(await fsp.readFile(path.join(config, f), 'utf8').catch(() => ''));
    if (p && existsSync(p) && !out.some((x) => x.file === p)) out.push({ ref: `file:${p}`, name: path.basename(p).replace(/\.ics$/, ''), group: 'KDE', file: p });
  }
  return out;
}

function linuxDriver(): SystemDriver {
  let eds: import('./eds').EdsClient | null = null;
  let tried = 0;
  const client = async () => {
    if (eds) return eds;
    // Look again for Evolution now and then (it may be installed or started later).
    if (Date.now() - tried < 10 * 60_000) return null;
    tried = Date.now();
    eds = await import('./eds').then((m) => m.connectEds()).catch(() => null);
    return eds;
  };
  const files = async (from: number, to: number): Promise<SystemSnapshot> => {
    const list = await calendarFiles();
    const calendars: SystemCalendar[] = [];
    const events: CalEvent[] = [];
    for (const f of list) {
      const text = await fsp.readFile(f.file, 'utf8').catch(() => '');
      calendars.push({ ref: f.ref, name: f.name, group: f.group, writable: false });
      events.push(...parseEvents(text, f.ref).filter((e) => e.rrule || (e.end > from && e.start < to)));
    }
    return { via: 'files', calendars, events };
  };
  return {
    kind: 'linux',
    async access() {
      if (await client()) return { state: 'granted', via: 'eds', canRequest: false, message: 'Keeper reads the desktop’s calendars (GNOME Calendar, Evolution, and Google or Microsoft accounts added in Online Accounts).' };
      const n = (await calendarFiles()).length;
      return n
        ? { state: 'granted', via: 'files', canRequest: false, message: `Keeper reads ${n} calendar file${n === 1 ? '' : 's'} on this computer (Evolution’s local calendars, KOrganizer). Evolution Data Server is not running, so online accounts are not read.` }
        : { state: 'unavailable', via: 'files', canRequest: false, message: 'No desktop calendars were found. GNOME (Evolution Data Server) calendars and KOrganizer files are read when present; or connect an account below.' };
    },
    async snapshot(from, to) {
      const c = await client();
      if (c) {
        try {
          return await c.snapshot(from, to);
        } catch {
          void c.close();
          eds = null;
          tried = 0;
        }
      }
      return files(from, to);
    },
    async save(cal, list, o) {
      const c = await client();
      if (!c || !cal.ref || cal.ref.startsWith('file:')) throw new Error('This calendar cannot be changed from Keeper');
      return c.write(cal.ref, serializeEvents(list), o.isNew);
    },
    async remove(cal, e) {
      const c = await client();
      if (!c || !cal.ref) throw new Error('This calendar cannot be changed from Keeper');
      await c.remove(cal.ref, e.uid);
    },
    close() {
      void eds?.close();
      eds = null;
    },
  };
}

// ---------------------------------------------------------------- choosing

const off: SystemDriver = {
  kind: 'none',
  access: async () => ({ state: 'unavailable', canRequest: false, message: 'Reading this computer’s calendars is off.' }),
  snapshot: async () => ({ via: 'files', calendars: [], events: [] }),
};

export function systemDriver(): SystemDriver {
  if (process.env.KEEPER_SYSCAL === 'off') return off;
  if (process.platform === 'darwin') return macDriver();
  if (process.platform === 'win32') return windowsDriver();
  if (process.platform === 'linux') return linuxDriver();
  return off;
}
