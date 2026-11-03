// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The closed Island's power states (a 3-second notice on plug-in and unplug, the battery glyph only when
// asked for or low), the rest of the closed-state activities (artwork, paused music, the shelf count),
// and what opening shows (always the full Island; "Open into" only picks the view).
import { describe, expect, it } from 'vitest';
import type { IslandState } from '../core/api';
import { BATTERY_LOW, PAUSED_MUSIC_LEAVES_MS, POWER_NOTICE_MS, activitiesFrom, batteryColor, kindOff, present, transientsFrom } from '../core/island-activities';
import { LAST_VIEW_KEEP_MS, showBanner, viewToOpen } from '../core/island-open';
import { liveSlot, toolForActivity } from '../core/island-tools/tools';
import { defaultSettings } from '../core/settings';

const base = (o: Partial<IslandState> = {}): IslandState => ({
  shelf: [], shelves: [], activeShelf: 'a', closedShelves: [], clips: [],
  focus: { mode: 'idle', endsAt: 0, focusMin: 25, breakMin: 5, rounds: 0 }, keepAwake: { on: false },
  agents: [], events: [], alerts: [], ...o,
});
const NOW = 1_800_000_000_000;

describe('power in the closed Island', () => {
  it('unplugging shows "On battery" with the percentage for 3 seconds, then nothing', () => {
    const t = transientsFrom(base({ battery: { percent: 100, charging: true } }), base({ battery: { percent: 100, charging: false } }), NOW);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: 'unplugged', title: 'On battery', trailing: '100%', until: NOW + POWER_NOTICE_MS, battery: { percent: 100, charging: false } });
    expect(POWER_NOTICE_MS).toBe(3000);
    const steady = activitiesFrom(base({ battery: { percent: 100, charging: false } }), NOW);
    expect(present([...steady, ...t], NOW + 1000).primary?.kind).toBe('unplugged');
    // After the notice: on battery by itself shows nothing.
    expect(present([...steady, ...t], NOW + POWER_NOTICE_MS + 1).primary).toBeUndefined();
  });

  it('plugging in shows "Charging" in green for 3 seconds', () => {
    const t = transientsFrom(base({ battery: { percent: 84, charging: false } }), base({ battery: { percent: 84, charging: true } }), NOW);
    expect(t[0]).toMatchObject({ kind: 'charging', title: 'Charging', trailing: '84%', color: '#30d158', until: NOW + 3000 });
    expect(transientsFrom(base({ battery: { percent: 84, charging: true } }), base({ battery: { percent: 85, charging: true } }), NOW)).toEqual([]);
  });

  it('"Always show battery" keeps the glyph and its percentage, only when nothing else is going on', () => {
    const s = base({ battery: { percent: 64, charging: false } });
    expect(activitiesFrom(s, NOW)).toEqual([]);
    const on = activitiesFrom(s, NOW, { alwaysBattery: true });
    expect(on[0]).toMatchObject({ kind: 'battery', trailing: '64%', battery: { percent: 64, charging: false } });
    expect(present(on, NOW).primary?.kind).toBe('battery');
    // A timer takes the Island; the battery is not a bubble beside it, nor counted.
    const busy = activitiesFrom({ ...s, focus: { mode: 'focus', endsAt: NOW + 60_000, focusMin: 25, breakMin: 5, rounds: 0 } }, NOW, { alwaysBattery: true });
    const p = present(busy, NOW);
    expect(p.primary?.kind).toBe('timer');
    expect(p.secondary).toBeUndefined();
    expect(p.more).toBe(0);
  });

  it('low (20% or less) stays in red until charging; charging from low stays green', () => {
    const low = activitiesFrom(base({ battery: { percent: BATTERY_LOW, charging: false } }), NOW);
    expect(low[0]).toMatchObject({ kind: 'battery-low', trailing: '20%', color: '#ff453a' });
    expect(activitiesFrom(base({ battery: { percent: 21, charging: false } }), NOW)).toEqual([]);
    expect(activitiesFrom(base({ battery: { percent: 12, charging: true } }), NOW)[0]).toMatchObject({ kind: 'battery', color: '#30d158' });
    expect(activitiesFrom(base({ battery: { percent: 40, charging: true } }), NOW)).toEqual([]);
  });

  it('colours: green charging, red low, yellow in Low Power Mode, else white', () => {
    expect(batteryColor({ percent: 10, charging: true })).toBe('#30d158');
    expect(batteryColor({ percent: 10, charging: false, lowPower: true })).toBe('#ff453a');
    expect(batteryColor({ percent: 60, charging: false, lowPower: true })).toBe('#ffd60a');
    expect(batteryColor({ percent: 60, charging: false })).toBe('#f5f5f7');
  });

  it('turning "Charging" off covers unplugging too; power never takes the deck\'s live slot', () => {
    expect(kindOff('unplugged', ['charging'])).toBe(true);
    expect(kindOff('charging', ['charging'])).toBe(true);
    expect(kindOff('unplugged', [])).toBe(false);
    const t = transientsFrom(base({ battery: { percent: 50, charging: true } }), base({ battery: { percent: 50, charging: false } }), NOW);
    expect(liveSlot(t, ['home'])).toBeNull();
    expect(toolForActivity('unplugged')).toBeNull();
  });
});

describe('other closed-state activities', () => {
  const np = { app: 'Music', title: 'Song', artist: 'Band', position: 0, duration: 100, artwork: 'data:image/png;base64,AA' };

  it('music carries its artwork; paused music leaves after two minutes', () => {
    expect(activitiesFrom(base({ nowPlaying: { ...np, playing: true } }), NOW)[0]).toMatchObject({ kind: 'music', art: np.artwork });
    const paused = base({ nowPlaying: { ...np, playing: false } });
    expect(activitiesFrom(paused, NOW, { musicPausedSince: NOW - 60_000 })[0]?.kind).toBe('paused-music');
    expect(activitiesFrom(paused, NOW, { musicPausedSince: NOW - PAUSED_MUSIC_LEAVES_MS })).toEqual([]);
  });

  it('files on the shelf show a count only when nothing else is going on', () => {
    const s = base({ shelf: [{ path: '/a' }, { path: '/b' }] as never });
    expect(present(activitiesFrom(s, NOW), NOW).primary).toMatchObject({ kind: 'shelf-idle', trailing: '2' });
    const busy = present(activitiesFrom({ ...s, keepAwake: { on: true } }, NOW), NOW);
    expect(busy.primary?.kind).toBe('awake');
    expect(busy.secondary).toBeUndefined();
  });

  it('a countdown knows the time left, for the last ten seconds', () => {
    const s = base({ countdowns: [{ id: 't', label: 'Tea', endsAt: NOW + 8000, durationMs: 60_000 }] });
    expect(activitiesFrom(s, NOW)[0]).toMatchObject({ kind: 'timer', left: 8000 });
  });
});

describe('what opening shows', () => {
  it('"Open into" defaults to the live activity\'s own view, else Home; never a card without the deck', () => {
    expect(defaultSettings([], []).island.openTo).toBe('activity');
    expect(defaultSettings([], []).island.alwaysBattery).toBe(false);
    expect(viewToOpen({ activityTool: toolForActivity('timer'), now: NOW })).toBe('focus');
    expect(viewToOpen({ activityTool: toolForActivity('music'), now: NOW })).toBe('home');
    // Power, keep-awake, a recording: Home, with the banner.
    for (const k of ['charging', 'unplugged', 'awake', 'recording', 'alert']) expect(viewToOpen({ activityTool: toolForActivity(k), now: NOW })).toBe('home');
    // A tool that is off is not opened into.
    expect(viewToOpen({ activityTool: 'focus', now: NOW, available: (v) => v !== 'focus' })).toBe('home');
  });

  it('Home and Last used (back to Home after 10 minutes)', () => {
    expect(viewToOpen({ openTo: 'home', activityTool: 'focus', now: NOW })).toBe('home');
    expect(viewToOpen({ openTo: 'last', last: { view: 'shelf', at: NOW - 60_000 }, now: NOW })).toBe('shelf');
    expect(viewToOpen({ openTo: 'last', last: { view: 'shelf', at: NOW - LAST_VIEW_KEEP_MS }, now: NOW })).toBe('home');
  });

  it('the banner shows what is going on unless the view already is its own', () => {
    expect(showBanner({ kind: 'unplugged' }, 'home', toolForActivity)).toBe(true);
    expect(showBanner({ kind: 'awake' }, 'shelf', toolForActivity)).toBe(true);
    expect(showBanner({ kind: 'timer' }, 'focus', toolForActivity)).toBe(false);
    expect(showBanner({ kind: 'music' }, 'home', toolForActivity)).toBe(false);
    expect(showBanner({ kind: 'recording' }, 'live', toolForActivity)).toBe(false);
    expect(showBanner(undefined, 'home', toolForActivity)).toBe(false);
  });
});
