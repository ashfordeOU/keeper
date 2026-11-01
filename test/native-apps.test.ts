// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  NATIVE_KINDS, appleMapsUrl, autoChoice, bingMapsUrl, cleanParams, geoUrl, nativeCandidates, nativeChoices, planNative, type Installed, type NativeOs,
} from '../core/native-apps';

const MAC: Installed = { appleMaps: '/System/Applications/Maps.app', appleWeather: '/System/Applications/Weather.app', findMy: '/System/Applications/FindMy.app', appleCalendar: '/System/Applications/Calendar.app', faceTime: '/System/Applications/FaceTime.app', appleMessages: '/System/Applications/Messages.app' };
const first = (os: NativeOs, inst: Installed, kind: Parameters<typeof planNative>[0], params = {}, pref?: string) => planNative(kind, os, inst, pref, params).tries[0];
const lisbon = { lat: 38.7223, lon: -9.1393, label: 'Lisbon' };

describe('maps links', () => {
  it('builds Apple Maps places and directions', () => {
    expect(appleMapsUrl(lisbon)).toBe('maps://?q=Lisbon&ll=38.7223,-9.1393');
    expect(appleMapsUrl({ address: '1 Infinite Loop, Cupertino' })).toBe('maps://?q=1%20Infinite%20Loop%2C%20Cupertino');
    expect(appleMapsUrl({ ...lisbon, directions: true, travel: 'walking' })).toBe('maps://?daddr=38.7223%2C-9.1393&dirflg=w');
    expect(appleMapsUrl({})).toBeNull();
  });
  it('builds Windows Maps links', () => {
    expect(bingMapsUrl(lisbon)).toBe('bingmaps:?cp=38.7223~-9.1393&lvl=16&collection=point.38.7223_-9.1393_Lisbon');
    expect(bingMapsUrl({ ...lisbon, directions: true })).toBe('bingmaps:?rtp=~pos.38.7223_-9.1393_Lisbon&mode=d');
    expect(bingMapsUrl({ address: 'Main St' })).toBe('bingmaps:?where=Main%20St');
  });
  it('builds geo: links and has no directions there', () => {
    expect(geoUrl(lisbon)).toBe('geo:38.7223,-9.1393?q=38.7223,-9.1393(Lisbon)');
    expect(geoUrl({ ...lisbon, directions: true })).toBeNull();
    expect(geoUrl({ address: 'Main St' })).toBeNull();
  });
});

describe('choosing an app', () => {
  it('uses Apple Maps on a Mac, and Google Maps when it is installed', () => {
    expect(first('darwin', MAC, 'maps', lisbon)).toMatchObject({ id: 'appleMaps', launch: { how: 'url', url: 'maps://?q=Lisbon&ll=38.7223,-9.1393' } });
    const withGoogle = { ...MAC, googleMaps: '/Users/sam/Applications/Chrome Apps.localized/Google Maps.app' };
    const t = first('darwin', withGoogle, 'maps', lisbon);
    expect(t.id).toBe('googleMaps');
    expect(t.launch).toEqual({ how: 'exec', file: 'open', args: ['-a', withGoogle.googleMaps, 'https://www.google.com/maps/search/?api=1&query=38.7223%2C-9.1393'] });
    // The person's choice wins over Automatic.
    expect(first('darwin', withGoogle, 'maps', lisbon, 'appleMaps').id).toBe('appleMaps');
    expect(first('darwin', withGoogle, 'maps', lisbon, 'web').launch).toEqual({ how: 'url', url: 'https://www.google.com/maps/search/?api=1&query=38.7223%2C-9.1393' });
  });
  it('falls back to the web when the chosen app is not there or cannot do it', () => {
    expect(first('darwin', {}, 'maps', lisbon, 'appleMaps').id).toBe('web');
    expect(first('win32', {}, 'maps', lisbon).id).toBe('web');
    expect(first('linux', { geo: 'GNOME Maps' }, 'maps', lisbon).id).toBe('geo');
    // geo: has no directions, so Google Maps on the web gives them.
    expect(first('linux', { geo: 'GNOME Maps' }, 'maps', { ...lisbon, directions: true, travel: 'cycling' }).launch).toEqual({ how: 'url', url: 'https://www.google.com/maps/dir/?api=1&destination=38.7223%2C-9.1393&travelmode=bicycling' });
  });
  it('keeps every other way as a fallback after the first', () => {
    expect(planNative('maps', 'darwin', MAC, 'osm', lisbon).tries.map((t) => t.id)).toEqual(['osm', 'appleMaps', 'web']);
  });
  it('opens Weather in the system app with the place where it can', () => {
    expect(first('darwin', MAC, 'weather', lisbon).launch).toEqual({ how: 'exec', file: 'open', args: ['-b', 'com.apple.weather'] });
    expect(first('win32', { msnWeather: 'MSN Weather' }, 'weather', lisbon).launch).toEqual({ how: 'url', url: 'msnweather://forecast?la=38.7223&lo=-9.1393' });
    expect(first('linux', { gnomeWeather: 'org.gnome.Weather' }, 'weather', lisbon).launch).toEqual({ how: 'exec', file: 'gtk-launch', args: ['org.gnome.Weather'] });
    expect(first('linux', {}, 'weather', lisbon).launch).toEqual({ how: 'url', url: 'https://weather.com/weather/today/l/38.7223,-9.1393' });
  });
  it('opens Find My on a Mac and iCloud elsewhere', () => {
    expect(first('darwin', MAC, 'findMy').launch).toEqual({ how: 'exec', file: 'open', args: ['-b', 'com.apple.findmy'] });
    expect(first('win32', {}, 'findMy').launch).toEqual({ how: 'url', url: 'https://www.icloud.com/find' });
  });
  it('opens an event where it lives, or the day in a calendar', () => {
    expect(first('darwin', MAC, 'calendar', { eventUrl: 'ical://ekevent/ABC?method=show&options=more' }).launch).toEqual({ how: 'url', url: 'ical://ekevent/ABC?method=show&options=more' });
    expect(first('darwin', MAC, 'calendar', {}).launch).toEqual({ how: 'exec', file: 'open', args: ['-b', 'com.apple.iCal'] });
    expect(first('win32', { outlook: 'Outlook' }, 'calendar', {}).launch).toEqual({ how: 'url', url: 'outlookcal:' });
    const day = new Date(2026, 10, 3, 12).getTime();
    expect(first('linux', {}, 'calendar', { date: day }).launch).toEqual({ how: 'url', url: 'https://calendar.google.com/calendar/r/day/2026/11/3' });
  });
  it('writes mail, messages and calls', () => {
    expect(first('darwin', MAC, 'mail', { to: 'sam@example.com', subject: 'Hi there' }).launch).toEqual({ how: 'url', url: 'mailto:sam@example.com?subject=Hi%20there' });
    expect(first('darwin', MAC, 'mail', { to: 'sam@example.com' }, 'gmail').launch).toEqual({ how: 'url', url: 'https://mail.google.com/mail/?view=cm&fs=1&to=sam%40example.com' });
    // Linux opens mailto: only when something answers it.
    expect(first('linux', {}, 'mail', { to: 'sam@example.com' }).id).toBe('gmail');
    expect(first('darwin', MAC, 'messages', { to: '+1 (555) 010-2000' }).launch).toEqual({ how: 'url', url: 'sms:+15550102000' });
    expect(first('darwin', MAC, 'messages', { to: 'sam@icloud.com' }).launch).toEqual({ how: 'url', url: 'imessage:sam@icloud.com' });
    expect(first('darwin', MAC, 'call', { to: '+1 555 0102' }).launch).toEqual({ how: 'url', url: 'tel:+15550102' });
    expect(first('darwin', MAC, 'call', { to: '+1 555 0102', video: true }).launch).toEqual({ how: 'url', url: 'facetime:+15550102' });
    expect(first('win32', { system: 'Phone Link' }, 'call', { to: '555 0102' })).toMatchObject({ name: 'Phone Link', launch: { url: 'tel:5550102' } });
    // No phone app: nothing to try, so the interface copies the number.
    expect(planNative('call', 'linux', {}, undefined, { to: '555' }).tries).toEqual([]);
  });
  it('opens system settings pages', () => {
    expect(first('darwin', {}, 'settings', { page: { darwin: 'x-apple.systempreferences:com.apple.Sharing-Settings.extension' } }).launch).toEqual({ how: 'url', url: 'x-apple.systempreferences:com.apple.Sharing-Settings.extension' });
    expect(first('win32', {}, 'settings', { page: { win32: 'ms-settings:privacy-location' } }).launch).toEqual({ how: 'url', url: 'ms-settings:privacy-location' });
    expect(first('linux', { system: 'gnome-control-center' }, 'settings', { page: { linux: 'wifi' } }).launch).toEqual({ how: 'spawn', file: 'gnome-control-center', args: ['wifi'] });
  });
});

describe('choices for Settings', () => {
  it('lists only what is there, and says what Automatic opens', () => {
    expect(nativeChoices('maps', 'darwin', MAC).map((c) => c.id)).toEqual(['appleMaps', 'web', 'osm']);
    expect(autoChoice('maps', 'darwin', MAC)).toBe('Apple Maps');
    expect(autoChoice('maps', 'darwin', { ...MAC, googleMaps: '/Applications/Google Maps.app' })).toBe('Google Maps');
    expect(nativeChoices('call', 'linux', {})).toEqual([]);
    expect(nativeChoices('messages', 'linux', { system: 'KDE Connect SMS' })[0].name).toBe('KDE Connect SMS');
  });
  it('has candidates for every kind on every system, each with a working build', () => {
    for (const os of ['darwin', 'win32', 'linux'] as const) for (const k of NATIVE_KINDS) {
      const list = nativeCandidates(k, os);
      // Calls have no web equivalent; every Mac has Messages.
      if (k !== 'call' && k !== 'settings' && !(os === 'darwin' && k === 'messages')) expect(list.some((c) => c.web), `${os} ${k} has a web fallback`).toBe(true);
      for (const c of list) expect(() => c.build({ ...lisbon, to: 'a@b.c', date: 0 }, '')).not.toThrow();
    }
  });
});

describe('cleanParams', () => {
  it('keeps only well-formed input', () => {
    expect(cleanParams({ lat: 91, lon: 0 })).toEqual({});
    expect(cleanParams({ lat: 1, lon: 2, label: ' A\nB ', travel: 'boat', directions: 'yes' })).toEqual({ lat: 1, lon: 2, label: 'A B' });
    expect(cleanParams({ eventUrl: 'file:///etc/passwd' })).toEqual({});
    expect(cleanParams({ eventUrl: 'ical://ekevent/X?method=show' }).eventUrl).toBe('ical://ekevent/X?method=show');
    expect(cleanParams({ page: { darwin: 'x-apple.systempreferences:com.apple.X', win32: 'javascript:alert(1)', linux: 'wifi; rm' } }).page).toEqual({ darwin: 'x-apple.systempreferences:com.apple.X' });
    expect(cleanParams(null)).toEqual({});
  });
});
