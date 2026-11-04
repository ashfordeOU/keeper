// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Offline check (core/offline.ts): every way Keeper could reach the internet, and Turn all off.
import { describe, expect, it } from 'vitest';
import { FEATURES } from '../core/features';
import { allOff, offlineLine, ONLINE_PARTS, ONLINE_SETTINGS, onlineThings } from '../core/offline';
import { getAt, setAt } from '../core/modes';
import { defaultSettings } from '../core/settings';
import { jargonIn } from '../core/settings-schema';

describe('Offline check', () => {
  it('names real parts and settings, in plain words', () => {
    const s = defaultSettings([], []);
    for (const p of ONLINE_PARTS) expect(FEATURES.some((f) => f.id === p.id), p.id).toBe(true);
    for (const x of ONLINE_SETTINGS) expect(typeof getAt(s, x.path), x.path).toBe('boolean');
    for (const t of [...ONLINE_PARTS.map((p) => p.why), ...ONLINE_SETTINGS.map((x) => x.label)]) expect(jargonIn(t)).toEqual([]);
  });

  it('lists what is on, and turning it all off leaves nothing on', () => {
    let s = defaultSettings([], []);
    s = { ...s, features: { ...s.features, weather: true, mail: true, usageStats: false } };
    const things = onlineThings(s, 'linux');
    expect(things.find((t) => t.id === 'weather')?.on).toBe(true);
    expect(things.find((t) => t.id === 'usageStats')?.on).toBe(false);
    const off = allOff(things);
    expect(off.parts).toContain('weather');
    expect(off.parts).not.toContain('usageStats');
    for (const id of off.parts) s = { ...s, features: { ...s.features, [id]: false } };
    s = { ...s, updateMode: 'off' };
    for (const p of off.settings) s = setAt(s, p, false);
    const after = onlineThings(s, 'linux');
    expect(after.filter((t) => t.on).map((t) => t.id)).toEqual([]);
    expect(offlineLine(after)).toBe('Offline: nothing reaches the internet');
    expect(offlineLine(things)).toMatch(/^\d+ ways on$/);
  });
});
