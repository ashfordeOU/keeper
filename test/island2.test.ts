// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { moonPhase, sunTimes } from '../core/astro';
import { activeTriggers, describeTrigger, isVpnInterface, parseLsusb, parseMacSsid, parseMacUsb, parseNetshSsid, parseNmcliSsid, triggerActive, type AwakeTrigger, type SystemSnapshot } from '../core/awake';
import { ClipHistory, detectClipKind } from '../core/island';
import { presignGet, sha256hex, signHeaders } from '../core/s3';
import { addItems, closeShelf, createShelf, fillCommand, moveItem, newStore, normalizeStore, prune, removeItem, renamePath, renameShelf, reopenShelf, shQuote } from '../core/shelves';

// Credentials and expected signatures from the AWS Signature Version 4 examples for Amazon S3.
const creds = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' };
const date = new Date(Date.UTC(2013, 4, 24));
const sig = (h: Record<string, string>) => h.authorization.match(/Signature=([0-9a-f]+)/)![1];

describe('S3 signing (SigV4 test vectors)', () => {
  it('GET object with a Range header', () => {
    const h = signHeaders({ method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), headers: { range: 'bytes=0-9' }, payloadHash: sha256hex(''), creds, date });
    expect(h.authorization).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date');
    expect(sig(h)).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  it('PUT object', () => {
    const body = 'Welcome to Amazon S3.';
    const h = signHeaders({
      method: 'PUT', url: new URL('https://examplebucket.s3.amazonaws.com/test$file.text'),
      headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' }, payloadHash: sha256hex(body), creds, date,
    });
    expect(sha256hex(body)).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
    expect(sig(h)).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('presigned GET link', () => {
    const url = presignGet(new URL('https://examplebucket.s3.amazonaws.com/test.txt'), creds, 86400, date);
    expect(url).toContain('X-Amz-Expires=86400');
    expect(url.endsWith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')).toBe(true);
  });
});

describe('shelves', () => {
  it('creates, fills, reorders and renames', () => {
    let st = newStore(0);
    st = addItems(st, ['/a', '/b', '/a', '/c']);
    expect(st.shelves[0].items).toEqual(['/a', '/b', '/c']);
    st = moveItem(st, 2, 0);
    expect(st.shelves[0].items).toEqual(['/c', '/a', '/b']);
    st = removeItem(st, '/a');
    const { store, shelf } = createShelf(st, 'Trip');
    expect(store.active).toBe(shelf.id);
    st = renameShelf(addItems(store, ['/x']), shelf.id, 'Holiday');
    expect(st.shelves.find((s) => s.id === shelf.id)).toMatchObject({ name: 'Holiday', items: ['/x'] });
    st = renamePath(st, '/x', '/y');
    expect(st.shelves[1].items).toEqual(['/y']);
  });

  it('closes into "recently closed" and reopens', () => {
    let st = addItems(newStore(0), ['/a']);
    const { store, shelf } = createShelf(st, 'Two');
    st = addItems(store, ['/b'], shelf.id);
    st = closeShelf(st, shelf.id);
    expect(st.shelves).toHaveLength(1);
    expect(st.closed[0].name).toBe('Two');
    st = reopenShelf(st, shelf.id);
    expect(st.shelves.map((s) => s.name)).toEqual(['Shelf', 'Two']);
    expect(st.closed).toHaveLength(0);
    // Closing the only shelf empties it but keeps a shelf around.
    let one = addItems(newStore(0), ['/z']);
    one = closeShelf(one, 'main');
    expect(one.shelves[0].items).toEqual([]);
    expect(one.closed[0].items).toEqual(['/z']);
  });

  it('prunes missing files, repairs bad data, fills commands', () => {
    const st = prune(addItems(newStore(0), ['/keep', '/gone']), (p) => p === '/keep');
    expect(st.shelves[0].items).toEqual(['/keep']);
    expect(normalizeStore({ shelves: 'nope' }).shelves).toHaveLength(1);
    expect(fillCommand('convert {files} -o {dir}/out', ["/d/a b.png", "/d/it's.png"], shQuote)).toBe(`convert '/d/a b.png' '/d/it'\\''s.png' -o '/d'/out`);
  });
});

describe('clipboard', () => {
  it('detects kinds', () => {
    expect(detectClipKind('https://example.com/a?b=1')).toBe('link');
    expect(detectClipKind('#ff8800')).toBe('color');
    expect(detectClipKind('rgb(1, 2, 3)')).toBe('color');
    expect(detectClipKind('const x = await fetch(url);')).toBe('code');
    expect(detectClipKind('function a() {\n  return 1;\n}')).toBe('code');
    expect(detectClipKind('/Users/ana/Documents/report.pdf')).toBe('file');
    expect(detectClipKind('Meet me at 3pm by the fountain.')).toBe('text');
  });

  it('notes, collections, search, retention and backup', () => {
    const h = new ClipHistory(3, 1);
    const a = h.add({ kind: 'text', text: 'alpha', source: 'Notes' }, 0)!;
    h.update(a.id, { note: 'greek letter' });
    h.toggleCollection(a.id, 'Work');
    h.add({ kind: 'link', text: 'https://x.y' }, 10);
    h.add({ kind: 'text', text: 'beta' }, 20);
    h.add({ kind: 'text', text: 'gamma' }, 30);
    // 'alpha' is in a collection, so it survives the 3-item limit.
    expect(h.items.map((i) => i.text)).toContain('alpha');
    expect(h.search({ q: 'greek' }).map((i) => i.text)).toEqual(['alpha']);
    expect(h.search({ collection: 'Work' })).toHaveLength(1);
    expect(h.search({ source: 'Notes' })).toHaveLength(1);
    expect(h.collections()).toEqual(['Work']);
    // Re-copying keeps the note and list.
    h.add({ kind: 'text', text: 'alpha' }, 40);
    expect(h.items[0]).toMatchObject({ text: 'alpha', note: 'greek letter', collections: ['Work'] });
    // Retention: one day; unfiled items older than that go.
    h.trim(2 * 86_400_000 + 50);
    expect(h.items.map((i) => i.text)).toEqual(['alpha']);
    const backup = h.export();
    const other = new ClipHistory(50);
    expect(other.import(backup)).toBe(1);
    expect(() => other.import('{}')).toThrow();
  });
});

describe('keep-awake triggers', () => {
  const snap: SystemSnapshot = { externalDisplays: 1, onPower: false, apps: ['Final Cut Pro', 'node'], usb: ['Logitech Receiver'], ssid: 'Office-5G', interfaces: ['en0', 'utun3'], cpu: 72, volumes: ['/Volumes/Backup'] };
  const t = (kind: AwakeTrigger['kind'], extra: Partial<AwakeTrigger> = {}): AwakeTrigger => ({ id: kind, kind, enabled: true, ...extra });

  it('evaluates every kind', () => {
    expect(triggerActive(t('display'), snap)).toBe(true);
    expect(triggerActive(t('power'), snap)).toBe(false);
    expect(triggerActive(t('app', { value: 'final cut' }), snap)).toBe(true);
    expect(triggerActive(t('usb', { value: 'logitech' }), snap)).toBe(true);
    expect(triggerActive(t('wifi', { value: 'office-5g' }), snap)).toBe(true);
    expect(triggerActive(t('wifi', { value: 'Office' }), snap)).toBe(false);
    expect(triggerActive(t('vpn'), snap)).toBe(true);
    expect(triggerActive(t('cpu', { threshold: 80 }), snap)).toBe(false);
    expect(triggerActive(t('drive', { value: 'backup' }), snap)).toBe(true);
    expect(triggerActive(t('display', { enabled: false }), snap)).toBe(false);
    expect(activeTriggers([t('power'), t('vpn')], snap).map((x) => x.kind)).toEqual(['vpn']);
    expect(describeTrigger(t('app', { value: 'Zoom' }))).toBe('Zoom is running');
    expect(isVpnInterface('en0')).toBe(false);
    expect(isVpnInterface('wg0')).toBe(true);
  });

  it('parses each OS', () => {
    expect(parseNmcliSsid('no:Other\nyes:Home\\:Net\n')).toBe('Home:Net');
    expect(parseNetshSsid('    Name                   : Wi-Fi\n    SSID                   : Cafe\n    BSSID                  : aa:bb')).toBe('Cafe');
    expect(parseMacSsid('  SSID : Studio\n')).toBe('Studio');
    expect(parseMacSsid('Current Wi-Fi Network: Studio')).toBe('Studio');
    expect(parseLsusb('Bus 001 Device 002: ID 046d:c52b Logitech, Inc. Unifying Receiver')).toEqual(['Logitech, Inc. Unifying Receiver']);
    expect(parseMacUsb(JSON.stringify({ SPUSBDataType: [{ _name: 'USB31Bus', _items: [{ _name: 'Keyboard K1' }] }] }))).toEqual(['Keyboard K1']);
  });
});

describe('sun and moon', () => {
  it('moon phases', () => {
    const full = moonPhase(Date.UTC(2024, 3, 23, 23, 49));
    expect(Math.abs(full.phase - 0.5)).toBeLessThan(0.03);
    expect(full.name).toBe('Full moon');
    const fresh = moonPhase(Date.UTC(2024, 3, 8, 18, 21));
    expect(Math.min(fresh.phase, 1 - fresh.phase)).toBeLessThan(0.03);
    expect(fresh.illumination).toBeLessThan(0.02);
  });

  it('sunrise and sunset in London at midsummer', () => {
    const s = sunTimes(Date.UTC(2024, 5, 21, 12), 51.5074, -0.1278);
    const hm = (t: number) => new Date(t).getUTCHours() * 60 + new Date(t).getUTCMinutes();
    expect(Math.abs(hm(s.sunrise!) - (3 * 60 + 43))).toBeLessThanOrEqual(5);
    expect(Math.abs(hm(s.sunset!) - (20 * 60 + 21))).toBeLessThanOrEqual(5);
    expect(sunTimes(Date.UTC(2024, 5, 21), 78.2, 15.6).polar).toBe('day');
  });
});
