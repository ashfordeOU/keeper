// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { activitiesFrom, cameraUsers, parseConsentStore, present, transientsFrom, type Activity } from '../core/island-activities';
import { cameraEdgeFor, chooseDisplays, desktopOf, freeMenuBarMiddle, macNotch, needsXWayland, place, type DisplayInfo, type PlaceEnv, type Rect } from '../core/island-place';
import type { IslandState } from '../core/api';

const disp = (o: Partial<DisplayInfo> & { bounds: Rect; workArea?: Rect }): DisplayInfo => ({
  id: 1, scaleFactor: 2, internal: true, rotation: 0, touch: false, primary: true, workArea: o.workArea ?? o.bounds, ...o,
});

const inside = (r: Rect, d: DisplayInfo) => r.x >= d.bounds.x && r.y >= d.bounds.y && r.x + r.width <= d.bounds.x + d.bounds.width && r.y + r.height <= d.bounds.y + d.bounds.height;
const centreX = (r: Rect) => r.x + r.width / 2;

// ---------------------------------------------------------------- Macs

const mbp14 = disp({ bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 } });
const mbp16 = disp({ bounds: { x: 0, y: 0, width: 1728, height: 1117 }, workArea: { x: 0, y: 38, width: 1728, height: 1079 } });
const mba13 = disp({ bounds: { x: 0, y: 0, width: 1470, height: 956 }, workArea: { x: 0, y: 37, width: 1470, height: 919 } });
const mba15 = disp({ bounds: { x: 0, y: 0, width: 1710, height: 1112 }, workArea: { x: 0, y: 37, width: 1710, height: 1075 } });
const imac = disp({ internal: true, bounds: { x: 0, y: 0, width: 2240, height: 1260 }, workArea: { x: 0, y: 25, width: 2240, height: 1235 } });
const ext4k = disp({ id: 2, internal: false, primary: false, scaleFactor: 2, bounds: { x: 1512, y: 0, width: 1920, height: 1080 }, workArea: { x: 1512, y: 25, width: 1920, height: 1055 } });
const mac = (model: string, extra: Partial<PlaceEnv> = {}): PlaceEnv => ({ platform: 'darwin', macModel: model, ...extra });

describe('Island on a Mac', () => {
  it('finds the notch on 14-inch and 16-inch MacBook Pros and both Airs', () => {
    for (const [d, model] of [[mbp14, 'MacBookPro18,3'], [mbp16, 'Mac15,7'], [mba13, 'Mac14,2'], [mba15, 'Mac15,13']] as const) {
      const n = macNotch(d, mac(model));
      expect(n?.kind, model).toBe('notch');
      expect(n!.width).toBeGreaterThan(150);
      expect(n!.width).toBeLessThan(230);
      expect(n!.height).toBeGreaterThanOrEqual(32);
    }
  });

  it('the notch covers more points when the screen is set to "more space" (points get smaller)', () => {
    const more = disp({ bounds: { x: 0, y: 0, width: 1800, height: 1169 }, workArea: { x: 0, y: 38, width: 1800, height: 1131 } });
    expect(macNotch(more, mac('MacBookPro18,3'))!.width).toBeGreaterThan(macNotch(mbp14, mac('MacBookPro18,3'))!.width);
  });

  it('grows out of the notch, centred on it, with the notch width left empty', () => {
    const p = place(mbp14, mac('MacBookPro18,3', { menuBarItems: [] }));
    expect(p.anchor).toBe('notch');
    expect(p.collapsed.y).toBe(0);
    expect(centreX(p.collapsed)).toBe(756);
    expect(p.gap).toBe(p.cutout.width);
    expect(p.pill.width).toBeGreaterThan(p.gap + 100);
    expect(inside(p.collapsed, mbp14) && inside(p.expanded, mbp14)).toBe(true);
  });

  // The notch on a 14-inch MacBook Pro at its default size spans x 663–849.
  const notch14 = { 1: { x: 663, y: 0, width: 186, height: 32 } };
  const icon = (x: number, width = 26): Rect => ({ x, y: 0, width, height: 32 });

  it('when the menu-bar icons could not be measured, nothing grows beside the notch (the tab below instead)', () => {
    const p = place(mbp14, mac('MacBookPro18,3', { notchRects: notch14 }));
    expect(p.anchor).toBe('notch');
    expect(p.wing).toBe(0);
    expect(p.hang).toBeGreaterThan(0);
    expect(p.pill.width).toBe(186);
  });

  it('the owner\'s full menu bar (Mac16,6, "more space", notch 220 pt): the right side stops before the first icon', () => {
    // 1800 × 1169 points; the notch spans 790–1010; status icons from the clock leftwards up to 1036.
    const d = disp({ bounds: { x: 0, y: 0, width: 1800, height: 1169 }, workArea: { x: 0, y: 39, width: 1800, height: 1130 } });
    const items: Rect[] = [{ x: 1650, y: 0, width: 150, height: 39 }];
    for (let x = 1036; x < 1650; x += 34) items.push({ x, y: 0, width: 30, height: 39 });
    const p = place(d, mac('Mac16,6', { notchRects: { 1: { x: 790, y: 0, width: 220, height: 38 } }, appMenuRight: 560, menuBarItems: items }));
    expect(p.anchor).toBe('notch');
    const right = centreX(p.collapsed) + p.pill.width / 2;
    expect(right).toBeLessThanOrEqual(1036 - 8);
    expect(p.wing).toBe(1036 - 1010 - 8 >= 26 ? 1036 - 1010 - 8 : 0);
    // Packed right up to the notch: no wings at all, the tab below.
    const full = place(d, mac('Mac16,6', { notchRects: { 1: { x: 790, y: 0, width: 220, height: 38 } }, appMenuRight: 560, menuBarItems: [...items, { x: 1012, y: 0, width: 22, height: 39 }] }));
    expect(full.wing).toBe(0);
    expect(full.hang).toBeGreaterThan(0);
    expect(full.pill.width).toBe(220);
  });

  it('a menu bar like Safari\'s, icons from 918 pt: the sides grow only up to the first icon', () => {
    const p = place(mbp14, mac('MacBookPro18,3', { notchRects: notch14, appMenuRight: 484, menuBarItems: [icon(918), icon(948), icon(1400, 80)] }));
    expect(p.anchor).toBe('notch');
    const right = centreX(p.collapsed) + p.pill.width / 2;
    expect(right).toBeLessThanOrEqual(918 - 8);
    expect(p.wing).toBeGreaterThan(26);
    expect(p.hang).toBe(0);
  });

  it('with no icons close to the notch, the sides grow fully', () => {
    const p = place(mbp14, mac('MacBookPro18,3', { notchRects: notch14, appMenuRight: 484, menuBarItems: [icon(1300)] }));
    expect(p.wing).toBe(64);
    expect(p.pill.width).toBe(186 + 128);
  });

  it('icons right next to the notch: nothing grows sideways, a small tab hangs below the notch instead', () => {
    const p = place(mbp14, mac('MacBookPro18,3', { notchRects: notch14, appMenuRight: 484, menuBarItems: [icon(853), icon(883)] }));
    expect(p.wing).toBe(0);
    expect(p.hang).toBeGreaterThan(0);
    expect(p.gap).toBe(186);
    expect(p.pill.width).toBe(186);
  });

  it('an app whose menus reach the notch (they carry on after it) also gets the tab below', () => {
    const p = place(mbp14, mac('MacBookPro18,3', { notchRects: notch14, appMenuRight: 1050, menuBarItems: [icon(1300)] }));
    expect(p.wing).toBe(0);
    expect(p.hang).toBeGreaterThan(0);
  });

  it('menus that end just before the notch narrow both sides equally', () => {
    const p = place(mbp14, mac('MacBookPro18,3', { notchRects: notch14, appMenuRight: 620, menuBarItems: [icon(1300)] }));
    expect(p.wing).toBe(663 - 620 - 8);
    expect(centreX(p.collapsed)).toBe(756);
  });

  it('a Mac without a notch uses where the menus really end, when known', () => {
    const items = [icon(1500), icon(1530)];
    expect(place(imac, mac('iMac21,1', { menuBarItems: items, appMenuRight: 600 })).anchor).toBe('menubar');
    expect(place(imac, mac('iMac21,1', { menuBarItems: items, appMenuRight: 1050 })).anchor).toBe('below-bar');
  });

  it('uses the helper\'s exact notch rectangle when there is one', () => {
    const p = place(mbp14, mac('MacBookPro18,3', { notchRects: { 1: { x: 663, y: 0, width: 186, height: 32 } } }));
    expect(p.cutout.width).toBe(186);
    expect(p.cutout.center).toBe(756);
  });

  it('a model it does not know yet still counts as notched when its menu bar is notch-tall', () => {
    expect(place(mbp14, mac('Mac99,1')).anchor).toBe('notch');
  });

  it('does not treat an iMac or a 13-inch MacBook Pro as notched', () => {
    expect(macNotch(imac, mac('Mac15,4'))).toBeUndefined();
    const mbp13 = disp({ bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 24, width: 1440, height: 876 } });
    expect(macNotch(mbp13, mac('Mac14,7'))).toBeUndefined();
  });

  it('without a notch it sits below the menu bar unless the menu bar\'s middle is known to be free', () => {
    expect(place(imac, mac('Mac15,4')).anchor).toBe('below-bar');
    expect(place(imac, mac('Mac15,4')).collapsed.y).toBe(25);
    const items = [{ x: 0, y: 0, width: 600, height: 25 }, { x: 1700, y: 0, width: 540, height: 25 }];
    const p = place(imac, mac('Mac15,4', { menuBarItems: items }));
    expect(p.anchor).toBe('menubar');
    expect(p.collapsed.y).toBe(0);
    const crowded = [{ x: 0, y: 0, width: 1000, height: 25 }, { x: 1200, y: 0, width: 1040, height: 25 }];
    expect(place(imac, mac('Mac15,4', { menuBarItems: crowded })).anchor).toBe('below-bar');
  });

  it('an external screen next to a notched Mac has no notch and sits under its own menu bar', () => {
    const p = place(ext4k, mac('MacBookPro18,3'));
    expect(p.cutout.kind).toBe('none');
    expect(p.anchor).toBe('below-bar');
    expect(centreX(p.collapsed)).toBe(1512 + 960);
  });

  it('blending with the notch can be turned off', () => {
    expect(place(mbp14, mac('MacBookPro18,3'), { blendNotch: false }).anchor).not.toBe('notch');
  });

  it('measures the free middle of the menu bar', () => {
    expect(freeMenuBarMiddle(imac, [{ x: 0, y: 0, width: 1000, height: 25 }])).toBe(120);
    expect(freeMenuBarMiddle(imac, [{ x: 1100, y: 0, width: 100, height: 25 }])).toBe(0);
    // Only status items known: app menus are assumed to reach 42% of the width.
    expect(freeMenuBarMiddle(imac, [{ x: 1600, y: 0, width: 640, height: 25 }])).toBeCloseTo(2240 * 0.08);
    expect(place(imac, mac('Mac15,4', { menuBarItems: [{ x: 1600, y: 0, width: 640, height: 25 }] })).anchor).toBe('menubar');
    const small = disp({ bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 24, width: 1440, height: 876 } });
    expect(place(small, mac('MacBookAir10,1', { menuBarItems: [{ x: 1100, y: 0, width: 340, height: 24 }] })).anchor).toBe('below-bar');
  });
});

// ---------------------------------------------------------------- Windows

describe('Island on Windows', () => {
  const env: PlaceEnv = { platform: 'win32', hasBattery: true };
  const laptop = (workArea: Rect) => disp({ scaleFactor: 1.5, bounds: { x: 0, y: 0, width: 1707, height: 1067 }, workArea });

  it('taskbar at the bottom: flush with the top edge under the camera', () => {
    const d = laptop({ x: 0, y: 0, width: 1707, height: 1019 });
    const p = place(d, env);
    expect(p.anchor).toBe('edge');
    expect(p.cutout.kind).toBe('camera');
    expect(p.collapsed.y).toBe(0);
    expect(Math.abs(centreX(p.collapsed) - 853.5)).toBeLessThanOrEqual(1);
  });

  it('taskbar on the left: still on top, still centred on the screen (the camera does not move)', () => {
    const p = place(laptop({ x: 48, y: 0, width: 1659, height: 1067 }), env);
    expect(p.collapsed.y).toBe(0);
    expect(Math.abs(centreX(p.collapsed) - 853.5)).toBeLessThanOrEqual(1);
  });

  it('taskbar at the top: just below it', () => {
    const p = place(laptop({ x: 0, y: 48, width: 1707, height: 1019 }), env);
    expect(p.anchor).toBe('below-bar');
    expect(p.topBarKind).toBe('taskbar');
    expect(p.collapsed.y).toBe(48);
  });

  it('a Surface turned to portrait follows the camera to the side', () => {
    const portrait = disp({ rotation: 90, touch: true, scaleFactor: 2, bounds: { x: 0, y: 0, width: 960, height: 1440 }, workArea: { x: 0, y: 0, width: 960, height: 1392 } });
    const p = place(portrait, env);
    expect(p.cutout.edge).toBe('right');
    expect(p.edge).toBe('right');
    expect(p.collapsed.x + p.collapsed.width).toBe(960);
    const other = place({ ...portrait, rotation: 270 }, env);
    expect(other.edge).toBe('left');
    expect(other.collapsed.x).toBe(0);
  });

  it('turned upside down the camera is at the bottom; the Island stays on top', () => {
    const p = place(disp({ rotation: 180, bounds: { x: 0, y: 0, width: 1440, height: 960 } }), env);
    expect(p.cutout.edge).toBe('bottom');
    expect(p.edge).toBe('top');
  });

  it('following the camera can be turned off, and the camera edge can be set by hand', () => {
    const portrait = disp({ rotation: 90, bounds: { x: 0, y: 0, width: 960, height: 1440 } });
    expect(place(portrait, env, { followCamera: false }).edge).toBe('top');
    expect(place(portrait, env, { cameraEdge: 'top' }).edge).toBe('top');
  });

  it('works at 125%, 150% and 200% scaling', () => {
    for (const s of [1.25, 1.5, 2]) {
      const d = disp({ scaleFactor: s, bounds: { x: 0, y: 0, width: Math.round(2560 / s), height: Math.round(1600 / s) } });
      const p = place(d, env);
      expect(inside(p.collapsed, d) && inside(p.expanded, d)).toBe(true);
    }
  });

  it('a second monitor to the left with negative coordinates', () => {
    const left = disp({ id: 7, internal: false, primary: false, scaleFactor: 1, bounds: { x: -2560, y: -200, width: 2560, height: 1440 } });
    const p = place(left, env);
    expect(p.cutout.kind).toBe('none');
    expect(centreX(p.collapsed)).toBe(-1280);
    expect(p.collapsed.y).toBe(-200);
    expect(inside(p.expanded, left)).toBe(true);
  });
});

// ---------------------------------------------------------------- Linux

describe('Island on Linux', () => {
  it('GNOME top bar: just below it, keeping the clock visible', () => {
    const d = disp({ internal: false, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 32, width: 1920, height: 1048 } });
    const p = place(d, { platform: 'linux', desktop: 'gnome', hasBattery: true });
    expect(p.topBarKind).toBe('gnome');
    expect(p.anchor).toBe('below-bar');
    expect(p.collapsed.y).toBe(32);
    expect(p.reason).toMatch(/clock/);
  });

  it('KDE panel on top is honoured; a bottom panel is ignored', () => {
    const top = disp({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 44, width: 1920, height: 1036 } });
    expect(place(top, { platform: 'linux', desktop: 'kde' }).collapsed.y).toBe(44);
    const bottom = disp({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1036 } });
    expect(place(bottom, { platform: 'linux', desktop: 'kde' }).collapsed.y).toBe(0);
  });

  it('knows its desktops and when Wayland needs XWayland', () => {
    expect(desktopOf('ubuntu:GNOME')).toBe('gnome');
    expect(desktopOf('KDE')).toBe('kde');
    expect(desktopOf('XFCE')).toBe('other');
    expect(needsXWayland({ XDG_SESSION_TYPE: 'wayland' }, 'linux')).toBe(true);
    expect(needsXWayland({ XDG_SESSION_TYPE: 'x11' }, 'linux')).toBe(false);
    expect(needsXWayland({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBe(true);
    expect(needsXWayland({ XDG_SESSION_TYPE: 'wayland' }, 'darwin')).toBe(false);
  });
});

// ---------------------------------------------------------------- general

describe('Island placement', () => {
  it('sizes: compact < normal < large', () => {
    const env: PlaceEnv = { platform: 'win32' };
    const d = disp({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } });
    const w = (size: 'compact' | 'normal' | 'large') => place(d, env, { size }).expanded.width;
    expect(w('compact')).toBeLessThan(w('normal'));
    expect(w('normal')).toBeLessThan(w('large'));
  });

  it('a nudge moves it, but never off the screen; nudging off the notch stops blending', () => {
    const p = place(mbp14, mac('MacBookPro18,3'), { offsetX: 100, offsetY: 10 });
    expect(centreX(p.collapsed)).toBe(856);
    expect(p.anchor).toBe('edge');
    const far = place(mbp14, mac('MacBookPro18,3'), { offsetX: 99999, offsetY: -500 });
    expect(inside(far.collapsed, mbp14)).toBe(true);
  });

  it('left and right edges from Settings sit inside the work area', () => {
    const d = disp({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 60, y: 0, width: 1860, height: 1080 } });
    const p = place(d, { platform: 'win32' }, { edge: 'left' });
    expect(p.collapsed.x).toBe(60);
  });

  it('camera edges for each rotation', () => {
    expect([0, 90, 180, 270].map((r) => cameraEdgeFor(r as 0))).toEqual(['top', 'right', 'bottom', 'left']);
  });

  it('chooses screens: primary, all, under the mouse, built-in', () => {
    const ds = [{ id: 1, internal: false }, { id: 2, internal: true }, { id: 3, internal: false }];
    expect(chooseDisplays(ds, 'primary', 1).map((d) => d.id)).toEqual([1]);
    expect(chooseDisplays(ds, 'all', 1).map((d) => d.id)).toEqual([1, 2, 3]);
    expect(chooseDisplays(ds, 'mouse', 1, 3).map((d) => d.id)).toEqual([3]);
    expect(chooseDisplays(ds, 'mouse', 1, 99).map((d) => d.id)).toEqual([1]);
    expect(chooseDisplays(ds, 'builtin', 1).map((d) => d.id)).toEqual([2]);
    expect(chooseDisplays([{ id: 5, internal: false }], 'builtin', 5).map((d) => d.id)).toEqual([5]);
  });
});

// ---------------------------------------------------------------- activities

const base = (o: Partial<IslandState> = {}): IslandState => ({
  shelf: [], shelves: [], activeShelf: 'a', closedShelves: [], clips: [],
  focus: { mode: 'idle', endsAt: 0, focusMin: 25, breakMin: 5, rounds: 0 }, keepAwake: { on: false },
  agents: [], events: [], alerts: [], ...o,
});
const NOW = 1_800_000_000_000;

describe('Island activities', () => {
  it('nothing going on: nothing to show', () => {
    expect(present(activitiesFrom(base(), NOW), NOW)).toEqual({ primary: undefined, secondary: undefined, more: 0 });
  });

  it('a due reminder takes the pill over music and waits there; an update is quiet', () => {
    const s = base({
      nowPlaying: { app: 'Music', title: 'Song', artist: 'Band', playing: true, position: 0, duration: 100 },
      dueReminders: [{ id: 'local:1', title: 'Call the bank', at: NOW - 5 * 60_000 }],
    });
    const p = present(activitiesFrom(s, NOW, { updateReady: '1.2.0' }), NOW);
    expect(p.primary).toMatchObject({ kind: 'reminder', title: 'Call the bank', ref: 'local:1', trailing: '!' });
    expect(p.secondary?.kind).toBe('music');
    expect(p.more).toBe(1);
    expect(activitiesFrom(s, NOW, { off: ['reminder'] }).some((a) => a.kind === 'reminder')).toBe(false);
    expect(activitiesFrom(base(), NOW, { updateReady: '1.2.0' })[0]).toMatchObject({ kind: 'update', title: 'Keeper 1.2.0 is ready' });
  });

  it('music alone takes the pill with a waveform', () => {
    const p = present(activitiesFrom(base({ nowPlaying: { app: 'Music', title: 'Song', artist: 'Band', playing: true, position: 30_000, duration: 120_000 } }), NOW), NOW);
    expect(p.primary?.kind).toBe('music');
    expect(p.primary?.wave).toBe(true);
    expect(p.primary?.progress).toBeCloseTo(0.25);
  });

  it('two at once split: the timer takes the pill, music the bubble', () => {
    const s = base({
      nowPlaying: { app: 'Music', title: 'Song', artist: 'Band', playing: true, position: 0, duration: 100 },
      focus: { mode: 'focus', endsAt: NOW + 10 * 60_000, focusMin: 25, breakMin: 5, rounds: 0 },
    });
    const p = present(activitiesFrom(s, NOW), NOW);
    expect(p.primary?.kind).toBe('timer');
    expect(p.primary?.trailing).toBe('10:00');
    expect(p.secondary?.kind).toBe('music');
    expect(p.more).toBe(0);
  });

  it('more than two: the two most important, and a count of the rest', () => {
    const s = base({
      recording: { since: NOW - 65_000 },
      nowPlaying: { app: 'Music', title: 'Song', artist: 'Band', playing: true, position: 0, duration: 100 },
      keepAwake: { on: true },
      agents: [{ id: 'x', tool: 'codex', project: 'site', state: 'waiting', summary: '?', updatedAt: NOW, file: '' }],
    });
    const p = present(activitiesFrom(s, NOW), NOW);
    expect(p.primary?.kind).toBe('recording');
    expect(p.primary?.trailing).toBe('1:05');
    expect(p.secondary?.kind).toBe('agent-waiting');
    expect(p.more).toBe(2);
  });

  it('dictation beats everything; turned-off kinds never show', () => {
    const s = base({ recording: { since: NOW } });
    expect(present(activitiesFrom(s, NOW, { dictation: 'on' }), NOW).primary?.kind).toBe('dictation');
    expect(present(activitiesFrom(s, NOW, { off: ['recording'] }), NOW).primary).toBeUndefined();
  });

  it('a meeting within 15 minutes counts down; long jobs show a ring', () => {
    const s = base({ events: [{ uid: 'e', title: 'Stand-up', start: NOW + 5 * 60_000, end: NOW + 20 * 60_000, allDay: false }] });
    const acts = activitiesFrom(s, NOW, { jobs: [{ task: 'convert', phase: 'video.mov', fraction: 0.42 }] });
    expect(acts.find((a) => a.kind === 'meeting')?.trailing).toBe('5m');
    const job = acts.find((a) => a.kind === 'progress')!;
    expect(job.progress).toBeCloseTo(0.42);
    expect(job.trailing).toBe('42%');
  });

  it('plugging in the charger, copying and connecting headphones show briefly, then go', () => {
    const prev = base({ battery: { percent: 40, charging: false }, devices: { monitors: [], bluetooth: [] } as never });
    const next = base({
      battery: { percent: 40, charging: true },
      clips: [{ id: 'c1', kind: 'text', text: 'hello', at: NOW }],
      devices: { monitors: [], bluetooth: [{ name: 'Earbuds', percent: 80 }] } as never,
    });
    const t = transientsFrom(prev, next, NOW);
    expect(t.map((a) => a.kind).sort()).toEqual(['charging', 'copied', 'headphones']);
    expect(present(t, NOW).primary?.kind).toBe('charging');
    expect(present(t, NOW + 10_000).primary).toBeUndefined();
    expect(transientsFrom(null, next, NOW)).toEqual([]);
  });

  it('two agents waiting show once', () => {
    const a = (id: string): Activity => ({ id, kind: 'agent-waiting', priority: 88, icon: 'terminal', title: id, color: '#fff' });
    const p = present([a('one'), a('two')], NOW);
    expect(p.primary?.kind).toBe('agent-waiting');
    expect(p.secondary).toBeUndefined();
  });
});

describe('camera and microphone in use', () => {
  it('reads Windows\' consent store: apps with LastUsedTimeStop 0 are using the device', () => {
    const out = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\Microsoft.WindowsCamera_8wekyb3d8bbwe',
      '    LastUsedTimeStart    REG_QWORD    0x1db2c6f9a1b2c3d',
      '    LastUsedTimeStop    REG_QWORD    0x0',
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged',
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe',
      '    LastUsedTimeStart    REG_QWORD    0x1db2c6f9a1b2c3d',
      '    LastUsedTimeStop    REG_QWORD    0x0',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged\\C:#Tools#old.exe',
      '    LastUsedTimeStop    REG_QWORD    0x1db2c6f9a1b2c3d',
    ].join('\r\n');
    expect(parseConsentStore(out)).toEqual(['WindowsCamera', 'Zoom']);
    expect(parseConsentStore('')).toEqual([]);
  });

  it('Linux: processes holding /dev/video*', () => {
    expect(cameraUsers([{ pid: 1, name: 'cheese', target: '/dev/video0' }, { pid: 2, name: 'bash', target: '/dev/pts/1' }, { pid: 3, name: 'cheese', target: '/dev/video1' }])).toEqual(['cheese']);
  });
});
