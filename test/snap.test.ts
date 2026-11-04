// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  captureLayout, defaultSnapSettings, insideFrame, parseFrameExtents, displayIndexFor, displaySetKey, displaySetName, fromRelative, layoutForScreens, nextDisplayRect, normalizeLayouts,
  normalizeSnapSettings, planRestore, SNAP_ACTIONS, snapAvailability, snapRect, snapShortcutsActive, targetRect, toRelative, type SnapLayout,
} from '../core/snap';
import { findClashes, keeperAccelerators, monorailShortcuts } from '../core/ashforde/monorail';
import { defaultSettings } from '../core/settings';

const work = { x: 0, y: 25, width: 1440, height: 875 };
const win = { x: 100, y: 100, width: 600, height: 400 };

describe('snap: where each action puts a window', () => {
  it('halves, thirds and quarters fill their part of the usable area', () => {
    expect(snapRect('left', work, win)).toEqual({ x: 0, y: 25, width: 720, height: 875 });
    expect(snapRect('right', work, win)).toEqual({ x: 720, y: 25, width: 720, height: 875 });
    expect(snapRect('bottom', work, win)).toEqual({ x: 0, y: 463, width: 1440, height: 438 });
    expect(snapRect('centreThird', work, win)).toEqual({ x: 480, y: 25, width: 480, height: 875 });
    expect(snapRect('rightTwoThirds', work, win)).toEqual({ x: 480, y: 25, width: 960, height: 875 });
    expect(snapRect('bottomRight', work, win)).toEqual({ x: 720, y: 463, width: 720, height: 438 });
    expect(snapRect('maximise', work, win)).toEqual({ x: 0, y: 25, width: 1440, height: 875 });
  });
  it('a gap leaves room at the edges and one shared gap between neighbours', () => {
    const l = snapRect('left', work, win, 8);
    const r = snapRect('right', work, win, 8);
    expect(l.x).toBe(8);
    expect(l.y).toBe(33);
    expect(r.x - (l.x + l.width)).toBe(8);
    expect(r.x + r.width).toBe(1440 - 8);
  });
  it('middle keeps the size and centres it; a window bigger than the screen shrinks to fit', () => {
    expect(snapRect('centre', work, win)).toEqual({ x: 420, y: 263, width: 600, height: 400 });
    expect(snapRect('centre', work, { ...win, width: 3000 })).toMatchObject({ x: 0, width: 1440 });
  });
  it('every action has a label and a place inside the screen', () => {
    for (const a of SNAP_ACTIONS) {
      expect(a.label.length).toBeGreaterThan(2);
      expect(a.area[0] + a.area[2]).toBeLessThanOrEqual(1.0001);
      expect(a.area[1] + a.area[3]).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe('snap: screens', () => {
  const left = { x: 0, y: 0, width: 1440, height: 900 };
  const right = { x: 1440, y: -200, width: 2560, height: 1440 };
  it('finds the screen holding a window’s centre, else the one it overlaps most', () => {
    expect(displayIndexFor({ x: 1500, y: 0, width: 400, height: 300 }, [left, right])).toBe(1);
    expect(displayIndexFor({ x: -500, y: 0, width: 600, height: 300 }, [left, right])).toBe(0);
  });
  it('next screen keeps the window’s place and size relative to the screen, and wraps round', () => {
    const on = nextDisplayRect({ x: 0, y: 0, width: 720, height: 450 }, [left, right]);
    expect(on).toEqual({ x: 1440, y: -200, width: 1280, height: 720 });
    const back = nextDisplayRect(on, [left, right]);
    expect(back).toEqual({ x: 0, y: 0, width: 720, height: 450 });
    expect(targetRect('nextDisplay', win, [left])).toEqual(win);
  });
  it('relative places come back inside the screen', () => {
    const r = toRelative({ x: 1300, y: 800, width: 400, height: 300 }, left);
    const b = fromRelative(r, left);
    expect(b.x + b.width).toBeLessThanOrEqual(1440);
    expect(b.y + b.height).toBeLessThanOrEqual(900);
  });
  it('a set of screens has one key whatever the order, and a plain name', () => {
    expect(displaySetKey([right, left])).toBe(displaySetKey([left, right]));
    expect(displaySetName([left])).toBe('Laptop');
    expect(displaySetName([left, right])).toBe('Docked');
    expect(displaySetName([left, right, left])).toBe('Docked, 3 screens');
  });
});

describe('snap: window frames on X11', () => {
  it('reads the frame and keeps the whole framed window inside the target', () => {
    const f = parseFrameExtents('_NET_FRAME_EXTENTS(CARDINAL) = 1, 1, 27, 1');
    expect(f).toEqual({ left: 1, right: 1, top: 27, bottom: 1 });
    expect(insideFrame({ x: 0, y: 0, width: 720, height: 900 }, f)).toEqual({ x: 0, y: 0, width: 718, height: 872 });
    expect(parseFrameExtents('_NET_FRAME_EXTENTS:  not found.')).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});

describe('snap: saved layouts', () => {
  const screens = [{ x: 0, y: 0, width: 1440, height: 900 }, { x: 1440, y: 0, width: 1920, height: 1080 }];
  const live = [
    { id: 'a', app: 'Mail', title: 'Inbox', bounds: { x: 0, y: 0, width: 720, height: 900 } },
    { id: 'b', app: 'Notes', title: 'Plans', bounds: { x: 720, y: 0, width: 720, height: 900 } },
    { id: 'c', app: 'Browser', title: 'Docs', bounds: { x: 1440, y: 0, width: 1920, height: 1080 } },
    { id: 'd', app: 'Dock', title: '', bounds: { x: 0, y: 860, width: 1440, height: 40 } },
    { id: 'e', app: 'Tiny', title: 'x', bounds: { x: 0, y: 0, width: 30, height: 30 } },
  ];
  it('keeps each window’s app, title, screen and place, and leaves out the dock and tiny windows', () => {
    const l = captureLayout(live, screens, '', screens, 1000);
    expect(l.name).toBe('Docked');
    expect(l.windows.map((w) => w.app)).toEqual(['Mail', 'Notes', 'Browser']);
    expect(l.windows[2]).toMatchObject({ screen: 1, rel: { x: 0, y: 0, width: 1, height: 1 } });
  });
  it('restores by app and title first, then any window of that app, and leaves others alone', () => {
    const l = captureLayout(live, screens, 'Work', screens, 1000);
    const now = [
      { id: 'x', app: 'notes', title: 'Other', bounds: { x: 10, y: 10, width: 300, height: 300 } },
      { id: 'y', app: 'Mail', title: 'Inbox', bounds: { x: 1500, y: 10, width: 300, height: 300 } },
      { id: 'z', app: 'Music', title: '', bounds: { x: 10, y: 10, width: 300, height: 300 } },
    ];
    const plan = planRestore(l, now, screens);
    expect(plan.map((p) => p.id)).toEqual(['y', 'x']);
    expect(plan[0].to).toEqual({ x: 0, y: 0, width: 720, height: 900 });
    expect(plan[1].to).toEqual({ x: 720, y: 0, width: 720, height: 900 });
  });
  it('a layout saved on two screens still restores on one (the second screen’s windows go to the last one there is)', () => {
    const l = captureLayout(live, screens, 'Work', screens, 1000);
    const plan = planRestore(l, live, [screens[0]]);
    expect(plan.find((p) => p.id === 'c')?.to).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
  });
  it('the newest layout for a set of screens wins; broken saved layouts are repaired or dropped', () => {
    const a: SnapLayout = { id: '1', name: 'A', screens: 'k', windows: [], savedAt: 1 };
    const b: SnapLayout = { ...a, id: '2', savedAt: 2 };
    expect(layoutForScreens([a, b], 'k')?.id).toBe('2');
    expect(layoutForScreens([a, b], 'other')).toBeUndefined();
    expect(normalizeLayouts([null, { id: 'x', windows: [{ app: 'A', rel: { x: 0, y: 0 } }, { nope: 1 }] }, 'bad'])).toEqual([
      { id: 'x', name: 'Layout', screens: '', savedAt: 0, windows: [{ app: 'A', title: '', screen: 0, rel: { x: 0, y: 0, width: 0.5, height: 0.5 } }] },
    ]);
  });
});

describe('snap: settings and what the computer allows', () => {
  it('defaults: halves, fill, middle and next screen have keys; thirds and quarters start empty', () => {
    const d = defaultSnapSettings();
    expect(d.shortcuts.left).toBe('CommandOrControl+Alt+Shift+Left');
    expect(d.shortcuts.leftThird).toBe('');
    expect(normalizeSnapSettings({ gap: 99, shortcuts: { left: ' Alt+L ', nope: 'x' } })).toMatchObject({ gap: 24, restoreOnChange: false, shortcuts: { left: 'Alt+L', right: d.shortcuts.right } });
    expect(normalizeSnapSettings(undefined)).toEqual(d);
  });
  it('the snap keys are among Keeper’s shortcuts for the clash check, and the defaults never clash with Monorail’s', () => {
    const acc = keeperAccelerators(defaultSettings([], []));
    expect(acc['snap.shortcuts.left']).toBe('CommandOrControl+Alt+Shift+Left');
    const snapOnly = Object.fromEntries(Object.entries(acc).filter(([k]) => k.startsWith('snap.')));
    expect(Object.keys(snapOnly).length).toBe(7);
    expect(findClashes(snapOnly, monorailShortcuts({}))).toEqual([]);
    // A key Monorail does use is caught.
    expect(findClashes({ 'snap.shortcuts.left': 'Control+Alt+Shift+Left' }, monorailShortcuts({})).map((c) => c.monorail)).toEqual(['moveLeft']);
  });
  it('says plainly where Keeper cannot move windows, and hands over to Monorail on a Mac', () => {
    expect(snapAvailability({ platform: 'darwin', accessibility: true }).state).toBe('ready');
    expect(snapAvailability({ platform: 'darwin', accessibility: false }).state).toBe('permission');
    const m = snapAvailability({ platform: 'darwin', accessibility: true, monorail: true });
    expect(m.state).toBe('monorail');
    expect(snapShortcutsActive(m)).toBe(false);
    expect(snapAvailability({ platform: 'win32' }).state).toBe('ready');
    const w = snapAvailability({ platform: 'linux', wayland: true, desktop: 'GNOME' });
    expect(w.state).toBe('wayland');
    expect(w.hint).toMatch(/Super/);
    expect(snapShortcutsActive(w)).toBe(false);
    expect(snapAvailability({ platform: 'linux', tools: false }).state).toBe('missing');
    expect(snapAvailability({ platform: 'linux', tools: true }).state).toBe('ready');
  });
});
