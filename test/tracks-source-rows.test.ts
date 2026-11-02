// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { findMyAvailable, SOURCE_CATALOG, sourceRow, type SourceContext } from '../core/tracks/config';

const entry = (id: string) => SOURCE_CATALOG.find((e) => e.id === id)!;
const mac = (release: string, live = true): SourceContext => ({ platform: 'darwin', release, features: { live, services: false }, findMy: { state: 'off', detail: 'Not read yet' }, linkWatching: false });

describe('Places & Tracks source rows', () => {
  it('Find My works only on a Mac before macOS 14.4 (Darwin 23.4)', () => {
    expect(findMyAvailable('darwin', '23.3.0').ok).toBe(true);
    expect(findMyAvailable('darwin', '22.6.0').ok).toBe(true);
    expect(findMyAvailable('darwin', '23.4.0')).toMatchObject({ ok: false, status: 'Not available on this version of macOS' });
    expect(findMyAvailable('darwin', '25.0.0').ok).toBe(false); // macOS 26
    expect(findMyAvailable('win32', '10.0.26100')).toMatchObject({ ok: false, status: 'Only on a Mac' });
  });

  it('on macOS 26 Find My shows as not available, never as on, and offers what works instead', () => {
    const r = sourceRow(entry('findMy'), { on: true }, mac('25.0.0'));
    expect(r).toMatchObject({ on: false, available: false, tone: 'unavailable', status: 'Not available on this version of macOS', instead: ['openFindMy', 'sharePhone'] });
    expect(r.why).toMatch(/14\.4/);
    expect(r.fix).toBeUndefined();
  });

  it('a source that is on but needs a feature gets a one-click Turn on instead of "Waiting"', () => {
    const r = sourceRow(entry('ownTracks'), { on: true }, mac('23.3.0', false));
    expect(r).toMatchObject({ on: true, tone: 'warn', fix: { feature: 'tracksLive', label: 'Turn on live sharing' } });
    expect(r.status).not.toMatch(/Waiting|Features/);
    const svc = sourceRow(entry('strava'), { on: true, connected: true }, mac('23.3.0'));
    expect(svc.fix).toMatchObject({ feature: 'tracksServices', label: 'Turn on sports services' });
    for (const e of SOURCE_CATALOG) {
      const row = sourceRow(e, { on: true }, { ...mac('23.3.0', false), features: { live: false, services: false } });
      expect(row.status).not.toMatch(/Waiting: turn on/);
      if (e.needs) expect(row.fix?.feature).toBe(e.needs);
    }
  });

  it('the status always agrees with the switch', () => {
    for (const e of SOURCE_CATALOG) {
      if (e.id === 'import') continue;
      const off = sourceRow(e, { on: false }, mac('23.3.0'));
      expect([off.on, off.status, off.tone]).toEqual([false, 'Off', 'off']);
      const on = sourceRow(e, { on: true }, mac('23.3.0'));
      expect(on.on).toBe(true);
      expect(on.status).not.toBe('Off');
    }
    expect(sourceRow(entry('findMy'), { on: true }, { ...mac('23.3.0'), findMy: { state: 'ok', detail: 'Read from the cache' } })).toMatchObject({ status: 'On', tone: 'on', why: 'Read from the cache' });
    expect(sourceRow(entry('traccar'), { on: true, error: 'The server answered 401' }, mac('23.3.0'))).toMatchObject({ status: 'The server answered 401', tone: 'warn' });
    expect(sourceRow(entry('strava'), { on: false, connected: false }, mac('23.3.0')).status).toBe('Off');
  });
});
