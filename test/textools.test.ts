// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { cameraName, readExif } from '../core/exif';
import { asColor, cleanLink, convertCase, convertTimestamp, decodeJwt, formatJson, generatePassword, inspectUnicode, redactPersonal, textStats, wifiQrPayload } from '../core/textools';
import { describeCode, nowcast } from '../core/weather';

describe('toolbox helpers', () => {
  it('cleans links and unwraps redirects', () => {
    expect(cleanLink('https://example.com/a?utm_source=x&id=7&fbclid=abc')).toBe('https://example.com/a?id=7');
    expect(cleanLink('https://www.google.com/url?q=https%3A%2F%2Fsite.org%2Fp%3Futm_medium%3Dm')).toBe('https://site.org/p');
    expect(cleanLink('not a link')).toBe('not a link');
  });
  it('cases, stats, colours', () => {
    expect(convertCase('Hello big World', 'snake')).toBe('hello_big_world');
    expect(convertCase('hello big world', 'camel')).toBe('helloBigWorld');
    expect(convertCase('helloBigWorld', 'kebab')).toBe('hello-big-world');
    expect(textStats('One two. Three four five!').words).toBe(5);
    expect(asColor('#ff8800')).toBe('#ff8800');
    expect(asColor('orange')).toBeUndefined();
  });
  it('json errors point at the line', () => {
    const r = formatJson('{\n  "a": 1,\n  "b": \n}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/line 4/);
    expect(formatJson('{"a":1}')).toEqual({ ok: true, text: '{\n  "a": 1\n}' });
  });
  it('jwt, timestamps, unicode, redaction, passwords, wifi', () => {
    const tok = 'eyJhbGciOiJIUzI1NiJ9.' + btoa(JSON.stringify({ sub: 'ana', exp: 1 })).replace(/=+$/, '') + '.sig';
    expect(decodeJwt(tok)).toMatchObject({ header: { alg: 'HS256' }, payload: { sub: 'ana' }, expired: true });
    expect(convertTimestamp('1700000000')?.iso).toBe('2023-11-14T22:13:20.000Z');
    expect(inspectUnicode('a​b').some((c) => c.suspicious)).toBe(true);
    const red = redactPersonal('Mail ana@example.com or call +1 415 555 0100, card 4111 1111 1111 1111');
    expect(red.text).not.toMatch(/ana@|4111|555/);
    expect(red.count).toBe(3);
    let n = 0;
    const pw = generatePassword(16, {}, (max) => n++ % max);
    expect(pw).toHaveLength(16);
    expect(wifiQrPayload('My;Net', 'p:ss')).toBe(String.raw`WIFI:T:WPA;S:My\;Net;P:p\:ss;;`);
  });
});

describe('weather', () => {
  it('describes codes and nowcasts rain', () => {
    expect(describeCode(0).label).toBe('Clear');
    expect(describeCode(63).icon).toBe('rain');
    const now = 1_000_000_000_000;
    const t = (m: number) => (now + m * 60_000) / 1000;
    expect(nowcast({ time: [t(0), t(15), t(30)], precipitation: [0, 0, 0.6] }, 0, now)).toBe('Rain starting in about 30 minutes');
    expect(nowcast({ time: [t(0), t(15)], precipitation: [0, 0] }, 0, now)).toBeUndefined();
  });
});

describe('exif', () => {
  it('reads make and model from a minimal JPEG', () => {
    // SOI, APP1 "Exif\0\0", little-endian TIFF with IFD0 holding Make and Model.
    const make = 'Apple\0';
    const model = 'iPhone 15 Pro\0';
    const tiff: number[] = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x02, 0x00];
    const dataStart = 8 + 2 + 2 * 12 + 4;
    const entry = (tag: number, count: number, off: number) => [tag & 255, tag >> 8, 2, 0, count, 0, 0, 0, off & 255, off >> 8, 0, 0];
    tiff.push(...entry(0x010f, make.length, dataStart), ...entry(0x0110, model.length, dataStart + make.length), 0, 0, 0, 0);
    tiff.push(...[...make, ...model].map((c) => c.charCodeAt(0)));
    const app1 = [...'Exif'].map((c) => c.charCodeAt(0)).concat([0, 0], tiff);
    const len = app1.length + 2;
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda]);
    const ex = readExif(jpeg);
    expect(ex).toMatchObject({ make: 'Apple', model: 'iPhone 15 Pro' });
    expect(cameraName(ex!)).toBe('Apple iPhone 15 Pro');
  });
});
