// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's Evolution Data Server client against a stand-in EDS on a private
// dbus-daemon: finds the newest Sources/Calendar services, lists calendars
// with their account, reads events in a range, writes and removes one.
// Skipped where dbus-daemon is missing.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as dbus from 'dbus-next';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serializeEvents } from '../core/pim/ical';
import { connectEds, type EdsClient } from '../electron/services/pim/eds';

const hasDaemon = process.platform === 'linux' && spawnSync('dbus-daemon', ['--version']).status === 0;
const { Interface } = dbus.interface;
const { Variant } = dbus;

const P = 'org.gnome.evolution.dataserver.';
const SOURCES: Record<string, string> = {
  'goa-1': '[Data Source]\nDisplayName=ana@gmail.com\nEnabled=true\n[Collection]\nBackendName=google\n',
  'cal-1': '[Data Source]\nDisplayName=Ana\nEnabled=true\nParent=goa-1\n[Calendar]\nBackendName=caldav\nColor=#e66100\nSelected=true\n',
  'cal-2': '[Data Source]\nDisplayName=Personal\nEnabled=true\nParent=local-stub\n[Calendar]\nBackendName=local\nColor=#62a0ea\n',
  'broken': '[Data Source]\nDisplayName=Offline\nEnabled=true\n[Calendar]\nBackendName=caldav\n',
};

class ObjectManager extends Interface {
  constructor() { super('org.freedesktop.DBus.ObjectManager'); }
  GetManagedObjects() {
    const out: Record<string, Record<string, Record<string, InstanceType<typeof Variant>>>> = {};
    Object.entries(SOURCES).forEach(([uid, data], i) => { out[`/org/gnome/evolution/dataserver/SourceManager/Source_${i}`] = { [`${P}Source`]: { UID: new Variant('s', uid), Data: new Variant('s', data) } }; });
    return out;
  }
}
ObjectManager.configureMembers({ methods: { GetManagedObjects: { inSignature: '', outSignature: 'a{oa{sa{sv}}}' } } });

const store: Record<string, string[]> = {
  'cal-1': [
    'BEGIN:VEVENT\r\nUID:standup\r\nDTSTART:20261102T080000Z\r\nDTEND:20261102T081500Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Standup\r\nLOCATION:https://meet.google.com/abc-defg-hij\r\nEND:VEVENT',
  ],
  'cal-2': ['BEGIN:VEVENT\r\nUID:dentist\r\nDTSTART:20261104T130000Z\r\nDTEND:20261104T140000Z\r\nSUMMARY:Dentist\r\nEND:VEVENT'],
};
const calls: string[] = [];

class Calendar extends Interface {
  constructor(private uid: string) { super(`${P}Calendar`); }
  Open() { return []; }
  Close() { /* nothing */ }
  GetObjectList(q: string) { calls.push(`query ${this.uid} ${q}`); return store[this.uid] ?? []; }
  CreateObjects(objs: string[], flags: number) { calls.push(`create ${this.uid} ${flags}`); store[this.uid].push(...objs); return objs.map((o) => o.match(/UID:(.*)/)![1].trim()); }
  ModifyObjects(objs: string[], mod: string, flags: number) {
    calls.push(`modify ${this.uid} ${mod} ${flags}`);
    for (const o of objs) { const uid = o.match(/UID:(.*)/)![1].trim(); store[this.uid] = [...store[this.uid].filter((x) => !x.includes(`UID:${uid}`)), o]; }
  }
  RemoveObjects(ids: [string, string][], mod: string, flags: number) {
    calls.push(`remove ${this.uid} ${mod} ${flags}`);
    store[this.uid] = store[this.uid].filter((x) => !ids.some(([u]) => x.includes(`UID:${u}`)));
  }
}
Calendar.configureMembers({ methods: {
  Open: { inSignature: '', outSignature: 'as' }, Close: { inSignature: '', outSignature: '' },
  GetObjectList: { inSignature: 's', outSignature: 'as' }, CreateObjects: { inSignature: 'asu', outSignature: 'as' },
  ModifyObjects: { inSignature: 'assu', outSignature: '' }, RemoveObjects: { inSignature: 'a(ss)su', outSignature: '' },
} });

class Factory extends Interface {
  constructor(private bus: dbus.MessageBus) { super(`${P}CalendarFactory`); }
  OpenCalendar(uid: string) {
    if (uid === 'broken') throw new dbus.DBusError(`${P}Error`, 'Cannot reach the server');
    const path = `/org/gnome/evolution/dataserver/Calendar/${uid.replace(/\W/g, '_')}`;
    this.bus.export(path, new Calendar(uid));
    return [path, `${P}Calendar8`];
  }
}
Factory.configureMembers({ methods: { OpenCalendar: { inSignature: 's', outSignature: 'ss' } } });

describe.skipIf(!hasDaemon)('Evolution Data Server over D-Bus', () => {
  let daemon: ChildProcess;
  let service: dbus.MessageBus;
  let eds: EdsClient | null;

  beforeAll(async () => {
    daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const address = await new Promise<string>((resolve) => daemon.stdout!.once('data', (d: Buffer) => resolve(d.toString().trim())));
    service = dbus.sessionBus({ busAddress: address });
    // An older version on the bus too: the newest one is used.
    await service.requestName(`${P}Sources4`, 0);
    await service.requestName(`${P}Sources5`, 0);
    await service.requestName(`${P}Calendar8`, 0);
    service.export('/org/gnome/evolution/dataserver/SourceManager', new ObjectManager());
    service.export('/org/gnome/evolution/dataserver/CalendarFactory', new Factory(service));
    eds = await connectEds(dbus.sessionBus({ busAddress: address }));
  });

  afterAll(async () => {
    await eds?.close();
    service?.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    daemon?.kill();
  });

  it('connects and lists the calendars with their account and colour; an unreachable one is left out', async () => {
    expect(eds).not.toBeNull();
    const from = Date.UTC(2026, 10, 1);
    const snap = await eds!.snapshot(from, Date.UTC(2026, 11, 1));
    expect(snap.via).toBe('eds');
    expect(snap.calendars.map((c) => [c.ref, c.name, c.group, c.color])).toEqual([['cal-1', 'Ana', 'ana@gmail.com', '#e66100'], ['cal-2', 'Personal', 'On this computer', '#62a0ea']]);
    expect(snap.events.map((e) => e.title).sort()).toEqual(['Dentist', 'Standup']);
    expect(snap.events.find((e) => e.title === 'Standup')!.rrule).toBe('FREQ=DAILY;COUNT=3');
    expect(calls).toContain('query cal-1 (occur-in-time-range? (make-time "20261101T000000Z") (make-time "20261201T000000Z"))');
  });

  it('creates, changes and removes an event (with the newer servers’ operation flags)', async () => {
    const e = { id: '', uid: 'lunch@keeper', calendar: 'cal-2', title: 'Lunch with Sam', start: Date.UTC(2026, 10, 3, 12), end: Date.UTC(2026, 10, 3, 13), allDay: false };
    expect(await eds!.write('cal-2', serializeEvents([e]), true)).toBe('lunch@keeper');
    await eds!.write('cal-2', serializeEvents([{ ...e, title: 'Lunch with Sam and Ana' }]), false);
    let snap = await eds!.snapshot(Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 1));
    expect(snap.events.filter((x) => x.uid === 'lunch@keeper').map((x) => x.title)).toEqual(['Lunch with Sam and Ana']);
    await eds!.remove('cal-2', 'lunch@keeper');
    snap = await eds!.snapshot(Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 1));
    expect(snap.events.some((x) => x.uid === 'lunch@keeper')).toBe(false);
    expect(calls).toEqual(expect.arrayContaining(['create cal-2 0', 'modify cal-2 all 0', 'remove cal-2 all 0']));
  });

  it('answers null where Evolution is not on the bus', async () => {
    const d2 = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const address = await new Promise<string>((resolve) => d2.stdout!.once('data', (d: Buffer) => resolve(d.toString().trim())));
    try {
      expect(await connectEds(dbus.sessionBus({ busAddress: address }))).toBeNull();
    } finally {
      await new Promise((r) => setTimeout(r, 100));
      d2.kill();
    }
  });
});
