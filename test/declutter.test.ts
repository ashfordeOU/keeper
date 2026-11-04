// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { DAY, JUDGED, declutterFindings, declutterPatch, emptyUse, featureOfFinding, idleWords, judged, normalizeUse, noteUse, unusedParts } from '../core/declutter';
import { FEATURES, featureStates, wanted } from '../core/features';
import { defaultSettings, mergeSettings } from '../core/settings';

const NOW = Date.UTC(2026, 10, 4);
const base = () => { const d = defaultSettings([], []); return mergeSettings(d, { features: { weather: true, journal: true, reader: true }, island: { ...d.island, weather: false } }); };

describe('counting page use, on this computer only', () => {
  it('notes each opening and reads old files leniently', () => {
    let u = emptyUse(NOW - 40 * DAY);
    u = noteUse(u, 'weather', NOW - 35 * DAY);
    u = noteUse(u, 'weather', NOW - 34 * DAY);
    expect(u.parts.weather).toEqual({ last: NOW - 34 * DAY, n: 2 });
    expect(normalizeUse({ since: NOW + DAY, parts: { a: { last: 1, n: 2 }, b: 'x' } }, NOW)).toEqual({ since: NOW, parts: { a: { last: 1, n: 2 } } });
    expect(normalizeUse(null, NOW)).toEqual({ since: NOW, parts: {} });
  });
});

describe('parts not opened for 30 days', () => {
  it('nothing is offered until Keeper has counted for 30 days', () => {
    expect(unusedParts(featureStates(base(), 'linux'), emptyUse(NOW - 10 * DAY), NOW)).toEqual([]);
  });
  it('offers a part that is on, has pages and was not opened for 30 days', () => {
    let u = emptyUse(NOW - 60 * DAY);
    u = noteUse(u, 'journal', NOW - 2 * DAY);
    u = noteUse(u, 'weather', NOW - 45 * DAY);
    const ids = unusedParts(featureStates(base(), 'linux'), u, NOW).map((x) => x.feature.id);
    expect(ids).toContain('weather');
    expect(ids).not.toContain('journal');
    expect(ids).not.toContain('library');
    expect(ids).not.toContain('guide');
    // The oldest first.
    const first = unusedParts(featureStates(base(), 'linux'), u, NOW)[0];
    expect(first.days).toBeGreaterThanOrEqual(45);
  });
  it('leaves alone a part another part still needs without a page of its own', () => {
    const s = mergeSettings(defaultSettings([], []), { features: { weather: true } });
    expect(featureStates(s, 'linux').get('islandWeather')?.on).toBe(true);
    const ids = unusedParts(featureStates(s, 'linux'), emptyUse(NOW - 60 * DAY), NOW).map((x) => x.feature.id);
    expect(ids).not.toContain('weather');
  });
  it('never offers parts that are off, have no page, or are the person’s own choice', () => {
    const states = featureStates(base(), 'linux');
    for (const x of unusedParts(states, emptyUse(NOW - 90 * DAY), NOW)) {
      expect(states.get(x.feature.id)?.on).toBe(true);
      expect(judged(x.feature)).toBe(true);
      expect(x.feature.ownChoice).toBeFalsy();
      expect(x.feature.routes?.length).toBeGreaterThan(0);
    }
    expect(FEATURES.filter(judged).every((f) => !f.always)).toBe(true);
    // Parts that work without their page being opened are never offered.
    for (const id of ['rules', 'places', 'mail', 'calendars', 'sync', 'monitors', 'island', 'library', 'guide', 'notices', 'textSnippets', 'dictation']) expect(judged(FEATURES.find((f) => f.id === id)!), id).toBe(false);
    for (const id of JUDGED) expect(FEATURES.some((f) => f.id === id && f.routes?.length), id).toBe(true);
  });
});

describe('the Fix-it rows', () => {
  it('are calm, say what the part costs, and turn it off with Undo', () => {
    const u = emptyUse(NOW - 40 * DAY);
    const list = unusedParts(featureStates(base(), 'linux'), u, NOW);
    const rows = declutterFindings(list);
    const w = rows.find((r) => r.id === 'declutter:weather')!;
    expect(w).toMatchObject({ severity: 'low', area: 'performance', fix: { kind: 'auto', action: 'declutter.off', label: 'Turn it off' } });
    expect(w.title).toBe('You haven’t opened Weather in 40 days');
    expect(w.detail).toBe('Weather');
    expect(w.why).toMatch(/keep Keeper light/);
    expect(w.why).toMatch(/turn it on again/i);
    expect(featureOfFinding(w.id)).toBe('weather');
    expect(featureOfFinding('space:low')).toBeUndefined();
    expect(rows.every((r) => r.group?.key === 'declutter')).toBe(true);
  });
  it('turning off and back on is the ordinary feature switch', () => {
    const s = base();
    const off = { ...s, ...declutterPatch(s, 'weather', false) };
    expect(wanted(off, 'weather', 'linux')).toBe(false);
    const on = { ...off, ...declutterPatch(off, 'weather', true) };
    expect(wanted(on, 'weather', 'linux')).toBe(true);
  });
  it('says long waits in plain words', () => {
    expect(idleWords(30)).toBe('30 days');
    expect(idleWords(95)).toBe('about 3 months');
  });
  it('is on by default and can be switched off', () => {
    expect(defaultSettings([], []).declutter).toBe(true);
    expect(mergeSettings(defaultSettings([], []), { declutter: false }).declutter).toBe(false);
  });
});
