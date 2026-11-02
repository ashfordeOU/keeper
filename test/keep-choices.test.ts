// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Upgrade safety: everyone's on/off choices are written down before defaults change.
import { describe, expect, it } from 'vitest';
import { FEATURES, keepChoices, wanted, type FeatureDef } from '../core/features';
import { defaultSettings, type AllSettings } from '../core/settings';

const base = (): AllSettings => defaultSettings(['/home/a/Documents'], []);
const apply = (s: AllSettings, p: Partial<AllSettings>): AllSettings => ({ ...s, ...p });

describe('keeping choices for upgrades', () => {
  it('writes every part that follows a default, and keeps what the person chose', () => {
    const s = apply(base(), { features: { mail: false, wallpaper: true } });
    const kept = apply(s, keepChoices(s, 'linux'));
    for (const f of FEATURES) {
      if (f.always || f.bridge || (f.platforms && !f.platforms.includes('linux'))) continue;
      expect(typeof kept.features[f.id], f.id).toBe('boolean');
    }
    expect(kept.features.mail).toBe(false);
    expect(kept.features.wallpaper).toBe(true);
  });

  it('after keeping, a changed default no longer changes what is on', () => {
    const s = base();
    const before = new Map(FEATURES.map((f) => [f.id, wanted(s, f.id, 'linux')]));
    const kept = apply(s, keepChoices(s, 'linux'));
    // Pretend every default flipped.
    const flipped = FEATURES.map((f) => ({ ...f, defaultOn: !f.defaultOn }));
    const saved = FEATURES.splice(0, FEATURES.length, ...flipped);
    try {
      for (const f of FEATURES) expect(wanted(kept, f.id, 'linux'), f.id).toBe(before.get(f.id));
    } finally {
      FEATURES.splice(0, FEATURES.length, ...saved);
    }
  });

  it('uses the defaults from before the change, not the new ones', () => {
    const s = base();
    const allOn = (f: FeatureDef) => !f.always && true;
    const kept = keepChoices(s, 'linux', allOn);
    expect(kept.features?.wallpaper).toBe(true);
    expect(kept.features?.login).toBe(true);
  });

  it('parts kept in older settings stay in those settings', () => {
    const s = apply(base(), { ocrEnabled: false, island: { ...base().island, clipboard: false } });
    const kept = apply(s, keepChoices(s, 'linux'));
    expect(kept.ocrEnabled).toBe(false);
    expect(kept.island.clipboard).toBe(false);
    expect(kept.features.ocr).toBeUndefined();
    expect(wanted(kept, 'ocr', 'linux')).toBe(false);
  });

  it('leaves out parts this system cannot run', () => {
    const s = base();
    const mac = FEATURES.find((f) => f.platforms?.length === 1 && f.platforms[0] === 'darwin');
    if (!mac) return;
    expect(keepChoices(s, 'linux').features?.[mac.id]).toBeUndefined();
    expect(typeof keepChoices(s, 'darwin').features?.[mac.id]).toBe('boolean');
  });

  it('running it twice changes nothing more', () => {
    const s = base();
    const once = apply(s, keepChoices(s, 'linux'));
    expect(keepChoices(once, 'linux')).toEqual({});
  });
});
