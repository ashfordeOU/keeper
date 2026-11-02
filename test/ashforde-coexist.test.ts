// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  HANDOFF_KEEP_MS, IGNORED_TITLES, MODE_OFF, TILE_MIN, TugGuard, handoffAck, handoffOutcome, liveHandoff, awakeAfterNote, awakeHandOver, comboAccelerator, desktopOverlap, fitsTiling, keeperHello, keeperModeChanged,
  keeperWindowKind, layoutIntact, layoutRepairs, monorailModeChanged, parseHello, parseWindows, patchAtPath, selfUpdating, shouldPushTheme, suggestShortcut,
  updatesBy, withSuggestions, type ModeSync,
} from '../core/ashforde/coexist';
import { KEEPER_BUNDLE_ID, MOD, OVERLAY_TITLES, acceleratorCombo, findClashes, keeperAccelerators, monorailShortcuts, monorailUrl, parseState } from '../core/ashforde/monorail';
import { ALWAYS_KEEP } from '../core/stage/presets';
import { staysOnScreen } from '../core/stage/plan';
import { defaultSettings } from '../core/settings';

describe('Keeper windows under Monorail', () => {
  it('tiles the main and tool windows, ignores every overlay, floats the small helpers', () => {
    expect(keeperWindowKind('Keeper by Ashforde®')).toBe('tile');
    expect(keeperWindowKind('Terminal — Keeper')).toBe('tile');
    expect(keeperWindowKind('Disk Usage — Keeper')).toBe('tile');
    for (const t of Object.values(OVERLAY_TITLES)) expect(keeperWindowKind(t)).toBe('ignore');
    expect(IGNORED_TITLES).toContain('Keeper Island');
    expect(keeperWindowKind('Quick Search')).toBe('float');
  });

  it('a tiled window can be a half-width column and half of a two-high slide', () => {
    // a 13-inch MacBook Air (1280 × 800) and the common 1440 × 900 work areas
    expect(fitsTiling(TILE_MIN, { width: 1280, height: 775 })).toBe(true);
    expect(fitsTiling(TILE_MIN, { width: 1440, height: 875 })).toBe(true);
    // the old minimum did not fit a half-width column
    expect(fitsTiling({ width: 760, height: 520 }, { width: 1440, height: 875 })).toBe(false);
  });
});

describe('shortcut clashes', () => {
  const monorail = monorailShortcuts({});

  it('Keeper’s defaults do not clash with Monorail’s', () => {
    const k = keeperAccelerators(defaultSettings([], []));
    expect(Object.keys(k).length).toBeGreaterThan(5);
    expect(findClashes(k, monorail)).toEqual([]);
  });

  it('collects grouped shortcuts too (the vibes’ next and previous keys)', () => {
    const k = keeperAccelerators({ ambience: { shortcuts: { next: 'Control+Alt+Right', previous: 'Control+Alt+Left' } }, island: { captureShortcut: 'CommandOrControl+Shift+2' } });
    expect(k['ambience.shortcuts.next']).toBe('Control+Alt+Right');
    expect(findClashes(k, monorail).map((c) => c.monorail)).toEqual(expect.arrayContaining(['focusRight', 'focusLeft']));
  });

  it('suggests a key free in both apps and in macOS, never ⌃⌥', () => {
    const keeper = { 'island.captureShortcut': 'Control+Alt+H' };
    const clashes = findClashes(keeper, monorail);
    expect(clashes.length).toBe(1);
    const [c] = withSuggestions(clashes, keeper, monorail);
    expect(c.suggestion).toBe('CommandOrControl+Shift+H');
    expect(c.suggestionLabel).toBe('⇧⌘H');
    const combo = acceleratorCombo(c.suggestion!)!;
    expect(combo.mods & MOD.control && combo.mods & MOD.option).toBeFalsy();
    expect(findClashes({ x: c.suggestion! }, monorail)).toEqual([]);
  });

  it('skips keys Keeper or macOS already use', () => {
    const taken = [acceleratorCombo('CommandOrControl+Shift+H')!, acceleratorCombo('CommandOrControl+Alt+H')!];
    expect(suggestShortcut('Control+Alt+H', taken)).toBe('CommandOrControl+Alt+Shift+H');
    expect(suggestShortcut('Control+Alt+3', [])).not.toBe('CommandOrControl+Shift+3');
    expect(comboAccelerator({ mods: MOD.command | MOD.shift, key: 'Space' })).toBe('CommandOrControl+Shift+Space');
  });

  it('patches one dotted setting and keeps its neighbours', () => {
    const s = { island: { captureShortcut: 'A+B', pasteShortcut: 'C+D' }, theme: 'x' };
    expect(patchAtPath(s, 'island.captureShortcut', 'E+F')).toEqual({ island: { captureShortcut: 'E+F', pasteShortcut: 'C+D' } });
    expect(patchAtPath(s, 'island.nope', 'E+F')).toBeNull();
    expect(patchAtPath(s, '__proto__.x', 'E+F')).toBeNull();
  });
});

describe('Focus and presentation both ways', () => {
  it('Keeper starts: Monorail is told once, the echo changes nothing', () => {
    let r = keeperModeChanged(MODE_OFF, true);
    expect(r.tellMonorail).toBe(true);
    const echo = monorailModeChanged(r.next, true);
    expect(echo.tellKeeper).toBeUndefined();
    r = keeperModeChanged(echo.next, false);
    expect(r.tellMonorail).toBe(false);
    expect(monorailModeChanged(r.next, false).tellKeeper).toBeUndefined();
  });

  it('Monorail starts: Keeper follows, and ends when Monorail ends', () => {
    const on = monorailModeChanged(MODE_OFF, true);
    expect(on.tellKeeper).toBe(true);
    expect(on.next.owner).toBe('monorail');
    // Keeper's own start (from following) sends nothing back
    expect(keeperModeChanged(on.next, true).tellMonorail).toBeUndefined();
    const off = monorailModeChanged(on.next, false);
    expect(off.tellKeeper).toBe(false);
  });

  it('Monorail’s own timer ending a session Keeper started does not end Keeper’s, and nothing loops', () => {
    const k = keeperModeChanged(MODE_OFF, true).next;
    const off = monorailModeChanged(k, false);
    expect(off.tellKeeper).toBeUndefined();
    expect(off.next.keeper).toBe(true);
    // repeated identical states do nothing
    let s: ModeSync = off.next;
    for (let i = 0; i < 5; i++) { const r = monorailModeChanged(s, false); expect(r.tellKeeper).toBeUndefined(); s = r.next; }
  });
});

describe('Keep Awake: one hold', () => {
  it('takes over a session Monorail started by hand, notes a triggered one', () => {
    expect(awakeHandOver(null).action).toBe('none');
    expect(awakeHandOver({ on: false }).action).toBe('none');
    expect(awakeHandOver({ on: true, status: 'On for 30 min' }).action).toBe('end-monorail');
    const t = awakeHandOver({ on: true, status: 'On · while an app runs' });
    expect(t.action).toBe('note');
    expect(t.note).toContain('while an app runs');
    expect(awakeAfterNote({ on: true, status: 'On indefinitely' })).toContain('still on');
    expect(awakeAfterNote({ on: false })).toBeUndefined();
  });
});

describe('Stage and Monorail’s layout', () => {
  const before = parseWindows([
    { id: 1, app: 'Safari', title: 'a', floating: false, workspace: 1, slide: 1 },
    { id: 2, app: 'Mail', title: 'b', floating: false, workspace: 2, slide: 1 },
    { id: 3, app: 'Notes', title: 'c', floating: false, workspace: 1, slide: 2 },
    { id: 4, app: 'Finder', title: 'd', floating: true },
    { nope: true },
  ]);

  it('reads the window list leniently', () => {
    expect(before.length).toBe(4);
    expect(parseWindows(null)).toEqual([]);
  });

  it('finds windows back on another workspace, missing ones and reordered slides', () => {
    expect(layoutIntact(layoutRepairs(before, before))).toBe(true);
    const r = layoutRepairs(before, [
      { id: 1, app: 'Safari', title: 'a', workspace: 1, slide: 2 },
      { id: 2, app: 'Mail', title: 'b', workspace: 1, slide: 1 },
    ]);
    expect(r.moves).toEqual([{ id: 2, workspace: 2 }]);
    expect(r.missing).toEqual([3]);
    expect(r.reordered).toEqual([1]);
  });

  it('never hides Monorail itself', () => {
    expect(staysOnScreen('Monorail', [], ALWAYS_KEEP)).toBe(true);
    expect(staysOnScreen('MacSlider', [], ALWAYS_KEEP)).toBe(true);
  });
});

describe('loops', () => {
  it('stops a tug of war and lets it go after a pause', () => {
    const g = new TugGuard(4, 10_000, 60_000);
    let t = 1_000;
    const ok = [0, 1, 2, 3, 4, 5].map(() => g.allow('w', (t += 100)));
    expect(ok).toEqual([true, true, true, true, false, false]);
    expect(g.trips).toBe(1);
    expect(g.stopped('w', t)).toBe(true);
    expect(g.allow('other', t)).toBe(true);
    expect(g.allow('w', t + 61_000)).toBe(true);
  });
});

describe('updates, themes, the desktop, the handshake', () => {
  it('Monorail updates itself unless its own check is off', () => {
    expect(updatesBy({})).toBe('monorail');
    expect(updatesBy({ checkForUpdates: true })).toBe('monorail');
    expect(updatesBy({ checkForUpdates: false })).toBe('keeper');
    expect(selfUpdating({ previousExists: false, scriptRunning: false })).toBe(false);
    expect(selfUpdating({ previousExists: true, scriptRunning: false })).toBe(true);
  });

  it('never overwrites a theme picked in Monorail unless Keeper’s own changed', () => {
    expect(shouldPushTheme('nord', 'nord', 'dracula')).toBe(false);
    expect(shouldPushTheme('ocean', 'nord', 'dracula')).toBe(true);
    expect(shouldPushTheme('nord', undefined, 'vivid')).toBe(true);
    expect(shouldPushTheme('nord', 'nord', 'dracula', true)).toBe(true);
    expect(shouldPushTheme('nord', undefined, 'nord')).toBe(false);
  });

  it('says when both apps want the desktop picture', () => {
    expect(desktopOverlap({})).toBeUndefined();
    expect(desktopOverlap({ workspaceWallpapers: { '0': '/a.jpg', '1': '' } })).toContain('1 workspace');
    expect(desktopOverlap({ driftWallpaper: '/b.jpg' })).toContain('drifting');
  });

  it('hello carries Keeper’s identity, its overlays and its links', () => {
    const h = keeperHello({ version: '1.2.3', pid: 42, focus: true, awake: false, stage: false });
    expect(h.bundleID).toBe(KEEPER_BUNDLE_ID);
    expect(h.overlays).toContain('Keeper Island');
    expect(h.links.some((l) => l.startsWith('keeper://awake'))).toBe(true);
    expect(parseHello({ app: 'Monorail', version: '2.0', presenting: true })).toEqual({ app: 'Monorail', version: '2.0', presenting: true, awake: undefined, focusMode: undefined, paused: undefined });
    expect(parseHello('x')).toBeNull();
  });

  it('marks the mode links Keeper sends (older Monorail versions ignore the query)', () => {
    expect(monorailUrl({ kind: 'focus-mode', on: true, from: 'keeper' })).toBe('monorail://focus-mode/on?from=keeper');
    expect(monorailUrl({ kind: 'presentation-mode', on: false })).toBe('monorail://presentation-mode/off');
  });

  it('reads the newer state fields when Monorail publishes them, and works without', () => {
    expect(parseState(JSON.stringify({ workspace: 1, slides: 2, focusMode: true, presenting: true, awake: false }))).toMatchObject({ presenting: true, awake: false });
    expect(parseState(JSON.stringify({ workspace: 1, slides: 2 }))!.presenting).toBeUndefined();
  });
});

describe('closed lid: Monorail hands its session to Keeper', () => {
  const base = { version: '1.2.3', pid: 42, focus: false, awake: true, stage: false };
  it('hello says Keeper can do the closed lid, and whether it is ready without a prompt (macOS only)', () => {
    expect(keeperHello({ ...base, platform: 'darwin', closedLidReady: true }).caps).toEqual({ closedLid: true, closedLidReady: true });
    expect(keeperHello({ ...base, platform: 'darwin', closedLidReady: false }).caps).toEqual({ closedLid: true, closedLidReady: false });
    expect(keeperHello({ ...base, platform: 'linux', closedLidReady: true }).caps.closedLidReady).toBe(false);
    expect(keeperHello(base).caps).toEqual({ closedLid: true, closedLidReady: false });
    expect(keeperHello(base).owns.awake).toBe(true);
  });

  it('builds the answers Monorail matches on', () => {
    expect(handoffAck('1a2b3c4d', { ok: true }, 1000)).toEqual({ id: '1a2b3c4d', ok: true, closedLid: true, at: 1000 });
    expect(handoffAck('1a2b3c4d', { ok: false, reason: 'denied' }, 1000)).toEqual({ id: '1a2b3c4d', ok: false, closedLid: false, at: 1000, reason: 'denied' });
  });

  it('every hello carries the last answer for 60 s, then drops it', () => {
    const ack = handoffAck('deadbeef', { ok: true }, 10_000);
    const at = (now: number) => keeperHello({ ...base, platform: 'darwin', closedLidReady: true, awakeHandoff: ack, now }).state;
    expect(at(10_000).awakeHandoff).toEqual(ack);
    expect(at(10_000 + HANDOFF_KEEP_MS - 1).awakeHandoff).toEqual(ack);
    expect(at(10_000 + HANDOFF_KEEP_MS).awakeHandoff).toBeUndefined();
    expect('awakeHandoff' in at(10_000 + HANDOFF_KEEP_MS)).toBe(false);
    expect(liveHandoff(undefined, 1)).toBeUndefined();
    expect(liveHandoff(ack, 9_000)).toBeUndefined(); // a clock that went back
    expect(JSON.parse(JSON.stringify(at(10_500))).awakeHandoff).toEqual({ id: 'deadbeef', ok: true, closedLid: true, at: 10_000 });
  });

  it('answers ok only when closed-lid mode really is on, and says why not otherwise', () => {
    const mac = { platform: 'darwin', ready: true };
    expect(handoffOutcome({ ...mac, lid: 'on' })).toEqual({ ok: true });
    // Sleep already off (someone else's setting): used, never switched off by Keeper.
    expect(handoffOutcome({ ...mac, lid: 'someone-else' })).toEqual({ ok: true });
    expect(handoffOutcome({ platform: 'darwin', ready: false, lid: 'on' })).toEqual({ ok: false, reason: 'not-ready' });
    expect(handoffOutcome({ platform: 'win32', ready: true, lid: 'on' })).toEqual({ ok: false, reason: 'not-ready' });
    expect(handoffOutcome({ ...mac, lid: 'not-ready' })).toEqual({ ok: false, reason: 'not-ready' });
    expect(handoffOutcome({ ...mac, lid: 'denied' })).toEqual({ ok: false, reason: 'denied' });
    expect(handoffOutcome({ ...mac, lid: 'unsafe' })).toEqual({ ok: false, reason: 'failed' });
    expect(handoffOutcome({ ...mac, lid: 'failed' })).toEqual({ ok: false, reason: 'failed' });
    expect(handoffOutcome({ ...mac, error: true })).toEqual({ ok: false, reason: 'failed' });
    expect(handoffOutcome(mac)).toEqual({ ok: false, reason: 'failed' });
  });
});
