// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Linux desktop's calendars through Evolution Data Server, over the
// session D-Bus: every calendar GNOME Calendar and Evolution show, including
// Google and Microsoft accounts added in GNOME Online Accounts. No Electron
// imports, so tests run it against a stand-in service on a private bus.

import * as dbus from 'dbus-next';
import { edsCalendars, edsRangeQuery, mapEdsObjects, parseEdsSource, veventBlocks, type EdsSource, type SystemSnapshot } from '../../../core/pim/syscal';

const PREFIX = 'org.gnome.evolution.dataserver.';
const SOURCE_MANAGER = '/org/gnome/evolution/dataserver/SourceManager';
const CALENDAR_FACTORY = '/org/gnome/evolution/dataserver/CalendarFactory';

type Proxy = dbus.ClientInterface & { $methods?: { name: string; inSignature: string }[] };

/** The newest version of a service on the bus ("Sources5", "Calendar8"); running or startable. */
async function newest(bus: dbus.MessageBus, base: string): Promise<string | undefined> {
  const obj = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
  const d = obj.getInterface('org.freedesktop.DBus');
  const names = [...((await d.ListNames()) as string[]), ...((await d.ListActivatableNames().catch(() => [])) as string[])];
  const re = new RegExp(`^${(PREFIX + base).replace(/\./g, '\\.')}(\\d+)$`);
  return names.filter((n) => re.test(n)).sort((a, b) => Number(b.match(re)![1]) - Number(a.match(re)![1]))[0];
}

const value = (v: unknown) => (v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v);

export interface EdsClient {
  sources(): Promise<EdsSource[]>;
  snapshot(from: number, to: number): Promise<SystemSnapshot>;
  /** writes events (one iCalendar text with a VEVENT per occurrence changed); creates them when new */
  write(ref: string, ics: string, isNew: boolean): Promise<string | undefined>;
  remove(ref: string, uid: string, rid?: string): Promise<void>;
  close(): Promise<void>;
}

/** Connects to Evolution Data Server; null when it is not on this desktop. */
export async function connectEds(bus: dbus.MessageBus = dbus.sessionBus()): Promise<EdsClient | null> {
  let sourcesName: string | undefined;
  let calendarName: string | undefined;
  try {
    [sourcesName, calendarName] = await Promise.all([newest(bus, 'Sources'), newest(bus, 'Calendar')]);
  } catch {
    bus.disconnect();
    return null;
  }
  if (!sourcesName || !calendarName) {
    bus.disconnect();
    return null;
  }
  const opened = new Map<string, Proxy>();

  const sources = async (): Promise<EdsSource[]> => {
    const obj = await bus.getProxyObject(sourcesName!, SOURCE_MANAGER);
    const om = obj.getInterface('org.freedesktop.DBus.ObjectManager');
    const all = (await om.GetManagedObjects()) as Record<string, Record<string, Record<string, unknown>>>;
    const out: EdsSource[] = [];
    for (const ifaces of Object.values(all)) {
      const s = ifaces[`${PREFIX}Source`];
      if (!s) continue;
      const uid = String(value(s.UID) ?? '');
      if (uid) out.push(parseEdsSource(uid, String(value(s.Data) ?? '')));
    }
    return out;
  };

  const calendar = async (uid: string): Promise<Proxy> => {
    const had = opened.get(uid);
    if (had) return had;
    const factory = (await bus.getProxyObject(calendarName!, CALENDAR_FACTORY)).getInterface(`${PREFIX}CalendarFactory`);
    const [path, name] = (await factory.OpenCalendar(uid)) as [string, string];
    const cal = (await bus.getProxyObject(name || calendarName!, path)).getInterface(`${PREFIX}Calendar`) as Proxy;
    await cal.Open().catch(() => undefined);
    opened.set(uid, cal);
    return cal;
  };

  /** Newer servers take extra "operation flags"; older ones do not. */
  const args = (cal: Proxy, method: string, base: unknown[]) => {
    const sig = cal.$methods?.find((m) => m.name === method)?.inSignature;
    return sig !== undefined && sig.length > base.length ? [...base, 0] : base;
  };

  return {
    sources,
    async snapshot(from, to) {
      const list = edsCalendars(await sources());
      const events = [];
      const calendars = [];
      for (const c of list) {
        try {
          const cal = await calendar(c.ref);
          const objects = (await cal.GetObjectList(edsRangeQuery(from, to))) as string[];
          events.push(...mapEdsObjects(c.ref, objects));
          calendars.push(c);
        } catch {
          // An account that cannot be reached right now (offline, signed out): left out this time.
        }
      }
      return { via: 'eds' as const, calendars, events };
    },
    async write(ref, ics, isNew) {
      const cal = await calendar(ref);
      const blocks = veventBlocks(ics);
      if (isNew) {
        const uids = (await cal.CreateObjects(...args(cal, 'CreateObjects', [blocks]))) as string[];
        return uids?.[0];
      }
      // The second argument is how much of a repeating event changes: "all" of it here, since
      // Keeper sends the series with its changed occurrences.
      const sig = cal.$methods?.find((m) => m.name === 'ModifyObjects')?.inSignature ?? 'assu';
      const mod = sig[2] === 'u' ? 8 : 'all';
      await cal.ModifyObjects(...args(cal, 'ModifyObjects', [blocks, mod]));
      return undefined;
    },
    async remove(ref, uid, rid = '') {
      const cal = await calendar(ref);
      const sig = cal.$methods?.find((m) => m.name === 'RemoveObjects')?.inSignature ?? 'a(ss)su';
      const mod = sig.slice(5, 6) === 'u' ? 8 : 'all';
      await cal.RemoveObjects(...args(cal, 'RemoveObjects', [[[uid, rid]], mod]));
    },
    async close() {
      const open = [...opened.values()];
      opened.clear();
      // Tell the server first (briefly), then hang up.
      await Promise.race([Promise.allSettled(open.map((c) => c.Close?.())), new Promise((r) => setTimeout(r, 1000))]);
      bus.disconnect();
    },
  };
}
