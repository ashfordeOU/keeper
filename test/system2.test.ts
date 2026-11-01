// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { DICTIONARIES, TRANSLATION_KEYS, resolveLanguage, translate } from '../src/i18n-strings';
import { applyTranslation, buildSubtitles, cleanSuggestedName, parseReceipt, parseSubtitles } from '../core/ai-actions';
import { bubbleAt, packBubbles, stepBubbles } from '../core/bubbles';
import { colorFormats, contrast, convertBase, csvToJson, diffLines, explainCron, htmlDecode, htmlEncode, lorem, markdownToHtml, parseCsv, toCsv } from '../core/devtools';
import { addPlace, aqiAdvice, compass, dayForecast, geocodeQuery, inUnitedStates, monthlyAverages, moonPhase, movePlace, parseNwsAlerts, parseRadarIndex, radarTileUrl, tileGrid, tileOf, tripStops, uvAdvice } from '../core/forecast';
import { bucketize, evaluateAlerts, mbps, processTree, pushSample, topConsumers, type HealthSample } from '../core/monitor';
import { planTidy, summarizeTidy } from '../core/tidy';
import type { Weather } from '../core/weather';

const sample = (t: number, top: HealthSample['top'], charging?: boolean): HealthSample => ({ t, cpu: 10, memUsed: 1, memTotal: 2, top, charging });

describe('health history', () => {
  it('keeps a day of samples', () => {
    let h: HealthSample[] = [];
    for (let i = 0; i < 30; i++) h = pushSample(h, sample(i * 3600_000, []));
    expect(h[0].t).toBe(5 * 3600_000);
    expect(h).toHaveLength(25);
  });
  it('ranks what used the most, and on battery', () => {
    const h = [sample(1, [{ name: 'Chrome Helper (Renderer)', cpu: 50, memory: 10 }, { name: 'node', cpu: 10, memory: 5 }], false), sample(2, [{ name: 'Chrome', cpu: 30, memory: 20 }], true)];
    const top = topConsumers(h);
    expect(top[0]).toMatchObject({ name: 'Chrome', minutes: 2, peakMemory: 20 });
    expect(top[0].batteryShare).toBeCloseTo(50 / 60);
  });
  it('alerts only when sustained', () => {
    const now = 10 * 60_000;
    const hog = (t: number, cpu: number) => sample(t, [{ name: 'miner', cpu, memory: 1 }]);
    const steady = [0, 1, 2, 3, 4, 5].map((m) => hog(now - (5 - m) * 60_000, 150));
    expect(evaluateAlerts(steady, [{ id: 'c', enabled: true, kind: 'cpu', threshold: 90, minutes: 5 }], now)).toHaveLength(1);
    const blip = steady.map((s, i) => (i === 2 ? hog(s.t, 5) : s));
    expect(evaluateAlerts(blip, [{ id: 'c', enabled: true, kind: 'cpu', threshold: 90, minutes: 5 }], now)).toHaveLength(0);
  });
  it('buckets, trees and speeds', () => {
    const h = [sample(0, []), sample(5, []), sample(15, [])].map((s, i) => ({ ...s, cpu: [10, 30, 50][i] }));
    expect(bucketize(h, (s) => s.cpu, 0, 20, 2)).toEqual([20, 50]);
    expect(bucketize(h, (s) => s.cpu, 0, 40, 4)).toEqual([20, 50, null, null]);
    expect(processTree(1, [{ pid: 2, ppid: 1 }, { pid: 3, ppid: 2 }, { pid: 4, ppid: 9 }])).toEqual([3, 2, 1]);
    expect(mbps(12_500_000, 1000)).toBe(100);
  });
});

describe('tidy', () => {
  const items = [
    { path: '/d/a.pdf', name: 'a.pdf', isDir: false, mtime: new Date(2026, 0, 5).getTime() },
    { path: '/d/b.jpg', name: 'b.jpg', isDir: false, mtime: new Date(2026, 1, 5).getTime() },
    { path: '/d/Images', name: 'Images', isDir: true, mtime: 0 },
    { path: '/d/.hidden', name: '.hidden', isDir: false, mtime: 0 },
  ];
  it('by kind, month and extension', () => {
    expect(planTidy('/d', items, 'kind').map((m) => m.dir)).toEqual(['/d/Documents', '/d/Images']);
    expect(planTidy('/d', items, 'month').map((m) => m.group)).toEqual(['2026-01 January', '2026-02 February']);
    expect(planTidy('C:\\d', [{ path: 'C:\\d\\x.zip', name: 'x.zip', isDir: false, mtime: 0 }], 'ext')[0].dir).toBe('C:\\d\\ZIP');
    expect(summarizeTidy(planTidy('/d', items, 'kind'))).toHaveLength(2);
  });
});

describe('bubbles', () => {
  it('packs without overlap inside the box and settles', () => {
    const items = [100, 60, 40, 20, 10, 5, 2].map((size, i) => ({ size, item: i }));
    const bs = packBubbles(items, 600, 400);
    expect(bs).toHaveLength(7);
    for (const b of bs) {
      expect(b.x - b.r).toBeGreaterThanOrEqual(-0.01);
      expect(b.x + b.r).toBeLessThanOrEqual(600.01);
    }
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) expect(Math.hypot(bs[i].x - bs[j].x, bs[i].y - bs[j].y)).toBeGreaterThan(bs[i].r + bs[j].r - 1);
    bs[0].vx = 30;
    let moving = true;
    for (let k = 0; k < 2000 && moving; k++) moving = stepBubbles(bs, 600, 400);
    expect(moving).toBe(false);
    expect(bubbleAt(bs, bs[3].x, bs[3].y)?.item).toBe(3);
  });
});

describe('developer tools', () => {
  it('diffs lines', () => {
    const d = diffLines('a\nb\nc\nd', 'a\nc\nd\ne');
    expect(d.map((x) => `${x.type[0]}${x.text}`)).toEqual(['sa', 'db', 'sc', 'sd', 'ae']);
  });
  it('explains cron', () => {
    expect(explainCron('30 9 * * 1-5')).toBe('At 09:30, Monday through Friday');
    expect(explainCron('*/15 * * * *')).toBe('Every 15 minutes');
    expect(explainCron('@daily')).toBe('At 00:00');
    expect(explainCron('0 12 1 1,7 *')).toBe('At 12:00, on day 1 of the month, in January and July');
    expect(() => explainCron('1 2 3')).toThrow();
  });
  it('lorem, bases, colours', () => {
    expect(lorem(2, 2).split('\n\n')).toHaveLength(2);
    expect(lorem(1, 1)).toMatch(/^Lorem ipsum dolor sit amet/);
    expect(convertBase('ff', 16)).toEqual({ bin: '11111111', oct: '377', dec: '255', hex: 'FF' });
    expect(convertBase('0b101', 2)?.dec).toBe('5');
    expect(convertBase('9', 8)).toBeUndefined();
    const c = colorFormats('#ff0000')!;
    expect(c.rgb).toBe('rgb(255 0 0)');
    expect(c.hsl).toBe('hsl(0 100% 50%)');
    expect(c.oklch).toMatch(/^oklch\(62\.8% 0\.25\d* 29/);
    expect(colorFormats('hsl(120, 100%, 25%)')?.hex).toBe('#008000');
    expect(contrast({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })).toBe(21);
  });
  it('html, csv, markdown', () => {
    expect(htmlEncode('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    expect(htmlDecode('&lt;b&gt; &#169; &#x1F600; &hellip;')).toBe('<b> © 😀 …');
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(csvToJson('name;age;ok\nAna;34;true\nBo;;false')).toEqual([{ name: 'Ana', age: 34, ok: true }, { name: 'Bo', age: null, ok: false }]);
    expect(toCsv([{ a: 1, b: 'x,y' }])).toBe('a,b\n1,"x,y"');
    const html = markdownToHtml('# Title\n\nHello **bold** <script>\n\n- one\n- two\n\n```\ncode <x>\n```');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong> &lt;script&gt;');
    expect(html).toContain('<ul>\n<li>one</li>');
    expect(html).toContain('<pre><code>code &lt;x&gt;</code></pre>');
    expect(markdownToHtml('[x](javascript:alert(1))')).not.toContain('href');
  });
});

describe('forecast helpers', () => {
  it('advice and compass', () => {
    expect(aqiAdvice(40)?.level).toBe('Good');
    expect(aqiAdvice(160)?.tone).toBe('danger');
    expect(uvAdvice(7)?.level).toBe('High');
    expect(compass(45)).toBe('NE');
    expect(compass(-90)).toBe('W');
  });
  it('places', () => {
    const a = { name: 'A', lat: 1, lon: 1 };
    const b = { name: 'B', lat: 2, lon: 2 };
    expect(addPlace([a], { ...a, name: 'A again' })).toHaveLength(1);
    expect(movePlace([a, b], 1, 0).map((p) => p.name)).toEqual(['B', 'A']);
    expect(inUnitedStates({ name: 'Denver', lat: 39.7, lon: -105 })).toBe(true);
    expect(inUnitedStates({ name: 'Lisbon', lat: 38.7, lon: -9.1 })).toBe(false);
  });
  it('alerts, radar, tiles', () => {
    const al = parseNwsAlerts({ features: [{ id: 'x', properties: { event: 'Heat Advisory', severity: 'Moderate', headline: 'Hot', description: ' Very hot ', onset: '2026-07-01T12:00:00Z' } }] });
    expect(al[0]).toMatchObject({ title: 'Heat Advisory', severity: 'moderate', description: 'Very hot' });
    const r = parseRadarIndex({ host: 'https://h', radar: { past: [{ time: 10, path: '/v2/radar/10' }], nowcast: [] } })!;
    expect(r.frames[0].time).toBe(10_000);
    expect(radarTileUrl(r.host, r.frames[0], 5, 1, 2)).toBe('https://h/v2/radar/10/256/5/1/2/2/1_1.png');
    expect(tileOf(0, 0, 1)).toMatchObject({ x: 1, y: 1 });
    expect(tileGrid(0, 0, 0, 3, 3).length).toBe(3);
  });
  it('monthly averages', () => {
    const m = monthlyAverages({ time: ['2024-01-01', '2024-01-02', '2025-01-01', '2024-07-01'], temperature_2m_max: [10, 12, 14, 30], temperature_2m_min: [0, 2, 4, 20], precipitation_sum: [5, 0, 3, 0] });
    expect(m[0]).toMatchObject({ avgMax: 12, avgMin: 2, rainMm: 4, rainyDays: 1 });
    expect(m[6].avgMax).toBe(30);
    expect(Number.isNaN(m[3].avgMax)).toBe(true);
  });
  it('trips from calendar events', () => {
    const now = new Date(2026, 9, 30).getTime();
    const ev = (title: string, loc: string | undefined, days: number) => ({ uid: title, title, start: now + days * 86_400_000, end: now + days * 86_400_000 + 3600_000, allDay: false, location: loc });
    const stops = tripStops([ev('Design', 'Room 4', 1), ev('Call', 'https://zoom.us/j/1', 1), ev('Summit', 'Web Summit, Altice Arena, Lisbon, Portugal', 3), ev('Far', 'Paris', 40), ev('Summit day 2', 'Web Summit, Altice Arena, Lisbon, Portugal', 3)], now);
    expect(stops.map((s) => s.event.title)).toEqual(['Summit']);
    expect(geocodeQuery('Hotel X, 12 Rua Y, 1100 Lisbon, Portugal')[0]).toBe('Lisbon');
    const w = { daily: [{ t: new Date(2026, 10, 2).getTime(), min: 1, max: 2, code: 0, rainChance: 0, sunrise: 0, sunset: 0, uvMax: 0 }] } as unknown as Weather;
    expect(dayForecast(w, new Date(2026, 10, 2).getTime())?.max).toBe(2);
  });
  it('moon', () => {
    expect(moonPhase(Date.UTC(2000, 0, 6, 18, 14)).name).toBe('New moon');
    expect(moonPhase(Date.UTC(2000, 0, 21, 4, 40)).illumination).toBeGreaterThan(95);
  });
});


describe('AI action helpers', () => {
  it('cleans suggested names', () => {
    expect(cleanSuggestedName('"Acme invoice March 2025.pdf"\nbecause…', 'pdf')).toBe('Acme invoice March 2025.pdf');
    expect(cleanSuggestedName('File name: a/b: c', 'txt')).toBe('a-b- c.txt');
    expect(cleanSuggestedName('   ', 'txt')).toBe('');
  });
  it('parses receipts', () => {
    const r = parseReceipt('Here: {"date":"2026-03-04T10:00","merchant":"Café Sol","total":"€12,50","currency":"EUR","tax":null,"category":"food","payment":"card"}', '/r.jpg');
    expect(r).toEqual({ file: '/r.jpg', date: '2026-03-04', merchant: 'Café Sol', total: 12.5, currency: 'EUR', tax: null, category: 'food', payment: 'card' });
    expect(parseReceipt('nonsense', '/x').total).toBeNull();
  });
  it('round-trips and translates subtitles keeping timings', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nHello\nthere\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n';
    const { header, cues } = parseSubtitles(srt);
    expect(cues).toHaveLength(2);
    const t = applyTranslation(cues, '1: Hola / ahí\n2: Adiós');
    expect(buildSubtitles(header, t, false)).toBe('1\n00:00:01,000 --> 00:00:02,000\nHola\nahí\n\n2\n00:00:03,000 --> 00:00:04,000\nAdiós\n');
    const vtt = parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n');
    expect(buildSubtitles(vtt.header, applyTranslation(vtt.cues, '1: Hallo'), true)).toBe('WEBVTT\n\n00:01.000 --> 00:02.000\nHallo\n');
  });
});


describe('translations', () => {
  it('every language has every key', () => {
    for (const [code, dict] of Object.entries(DICTIONARIES)) {
      const missing = TRANSLATION_KEYS.filter((k) => !dict[k]);
      expect(missing, code).toEqual([]);
    }
  });
  it('resolves system and regional languages', () => {
    expect(resolveLanguage('system', 'es-MX')).toBe('es');
    expect(resolveLanguage('system', 'pt-PT')).toBe('pt-BR');
    expect(resolveLanguage('system', 'zh-TW')).toBe('zh-CN');
    expect(resolveLanguage('system', 'sw-KE')).toBe('en');
    expect(resolveLanguage('de')).toBe('de');
    expect(translate('es', 'nav.home')).toBe('Inicio');
    expect(translate('ja', 'no.such.key')).toBe('no.such.key');
  });
});
