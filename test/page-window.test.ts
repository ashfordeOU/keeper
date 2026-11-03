// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Pages in windows of their own: which page a launcher, a link or the command line
// names (only Keeper's own pages), what the window is called, and where it opens.
import { describe, expect, it } from 'vitest';
import { cleanRoute, fitInto, openablePage, PAGE_WINDOW_DEFAULT, PAGE_WINDOWS_KEPT, pageFromArgv, pageFromUrl, pageWindowKey, pageWindowLabel, pageWindowTitle, placePageWindow, rememberPageWindow, routeOfPage, sanitizePageWindows } from '../core/page-window';
import { defaultSettings, mergeSettings } from '../core/settings';
import { bindings, SCHEMES, type SchemeId } from '../core/pim/shortcuts';
import { normalizeAccel } from '../core/shortcuts';

describe('naming a page from outside Keeper', () => {
  it('reads --keeper-open in both spellings', () => {
    expect(pageFromArgv(['/opt/Keeper/keeper', '--keeper-open=mail'])).toBe('mail');
    expect(pageFromArgv(['Keeper.exe', '--keeper-open', 'calendar'])).toBe('calendar');
    expect(pageFromArgv(['keeper', '--keeper-open=Notes'])).toBe('notes');
    expect(pageFromArgv(['keeper', '--hidden'])).toBeUndefined();
  });

  it('refuses anything that is not one of Keeper\'s pages', () => {
    for (const bad of ['--keeper-open=', '--keeper-open=../settings', '--keeper-open=mail;rm', '--keeper-open=nosuchpage', '--keeper-open=MAIL/inbox', '--keeper-open=javascript:alert(1)']) expect(pageFromArgv(['keeper', bad])).toBeUndefined();
    expect(pageFromArgv(['keeper', '--keeper-open'])).toBeUndefined();
    expect(openablePage(42)).toBeUndefined();
    expect(openablePage('x'.repeat(200))).toBeUndefined();
  });

  it('reads keeper://open/<page> and leaves every other link alone', () => {
    expect(pageFromUrl('keeper://open/mail')).toBe('mail');
    expect(pageFromUrl('keeper://open/calendar/')).toBe('calendar');
    expect(pageFromUrl('keeper:///open/notes')).toBe('notes');
    expect(pageFromUrl('keeper://open?path=/home/a/b.txt')).toBeUndefined();
    expect(pageFromUrl('keeper://open/nosuchpage')).toBeUndefined();
    expect(pageFromUrl('keeper://open/mail/extra')).toBeUndefined();
    expect(pageFromUrl('keeper://open/%2e%2e')).toBeUndefined();
    expect(pageFromUrl('https://open/mail')).toBeUndefined();
    expect(pageFromUrl('keeper://mail/abc')).toBeUndefined();
    expect(pageFromUrl('not a url')).toBeUndefined();
  });

  it('opens a page on its own route', () => {
    expect(routeOfPage('mail')).toEqual({ name: 'mail' });
    expect(routeOfPage('sync-backups')).toEqual({ name: 'sync', arg: 'backups' });
    expect(routeOfPage('nope')).toBeUndefined();
  });
});

describe('one window per page', () => {
  it('keys a window by its page, so a place inside the page reuses it', () => {
    expect(pageWindowKey({ name: 'mail' })).toBe('mail');
    expect(pageWindowKey({ name: 'mail', arg: 'message-id-1' })).toBe('mail');
    // A tab of a merged page belongs to that page's window.
    expect(pageWindowKey({ name: 'firewall' })).toBe('security');
    expect(pageWindowKey({ name: 'sync', arg: 'mirrors' })).toBe('sync-mirrors');
    // Everywhere and its type chips share one window.
    expect(pageWindowKey({ name: 'library', arg: 'image' })).toBe('library');
    expect(pageWindowKey({ name: '../x' })).toBeUndefined();
  });

  it('accepts only plain routes from a window', () => {
    expect(cleanRoute({ name: 'mail', arg: 'x', q: 'y', extra: 1 })).toEqual({ name: 'mail', arg: 'x', q: 'y' });
    expect(cleanRoute({ name: 'mail', arg: 5 })).toEqual({ name: 'mail' });
    expect(cleanRoute({ name: 'mail<script>' })).toBeUndefined();
    expect(cleanRoute(null)).toBeUndefined();
    expect(cleanRoute('mail')).toBeUndefined();
  });

  it('names the window after its page', () => {
    expect(pageWindowTitle(pageWindowLabel('mail'))).toBe('Mail — Keeper');
    expect(pageWindowLabel('security')).toBe('Privacy & Security');
    expect(pageWindowLabel('mail', 'Courrier')).toBe('Courrier');
    expect(pageWindowLabel('library')).toBe('Everywhere');
    expect(pageWindowLabel('mail', '\u0007  ')).toBe('Mail');
  });
});

describe('where a page window opens', () => {
  const left = { x: 0, y: 25, width: 1440, height: 875 };
  const right = { x: 1440, y: 0, width: 1920, height: 1080 };

  it('opens where it was when that display is still there', () => {
    expect(placePageWindow({ x: 1600, y: 100, width: 900, height: 700 }, [left, right], left)).toEqual({ x: 1600, y: 100, width: 900, height: 700 });
  });

  it('pulls a window that hangs off the edge back onto its display', () => {
    expect(placePageWindow({ x: 1200, y: 600, width: 900, height: 700 }, [left], left)).toEqual({ x: 540, y: 200, width: 900, height: 700 });
  });

  it('shrinks a window larger than the display it is on', () => {
    const r = placePageWindow({ x: 0, y: 25, width: 3000, height: 2000 }, [left], left);
    expect(r).toEqual({ x: 0, y: 25, width: 1440, height: 875 });
  });

  it('brings a window whose display was unplugged onto the display with the pointer, keeping its size', () => {
    const r = placePageWindow({ x: 1600, y: 100, width: 900, height: 700 }, [left], left);
    expect(r.width).toBe(900);
    expect(r.height).toBe(700);
    expect(r.x).toBeGreaterThanOrEqual(left.x);
    expect(r.x + r.width).toBeLessThanOrEqual(left.x + left.width);
    expect(r.y).toBeGreaterThanOrEqual(left.y);
  });

  it('does not trust a place whose title bar was off screen', () => {
    const r = placePageWindow({ x: 100, y: -600, width: 900, height: 700 }, [left], left);
    expect(r.y).toBeGreaterThanOrEqual(left.y);
  });

  it('opens new windows at the default size, centred and shifted for each one already open', () => {
    const a = placePageWindow(undefined, [left], left, 0);
    const b = placePageWindow(undefined, [left], left, 1);
    expect(a.width).toBe(PAGE_WINDOW_DEFAULT.width);
    expect(a.height).toBe(PAGE_WINDOW_DEFAULT.height);
    expect(b.x - a.x).toBe(28);
    expect(b.y - a.y).toBe(28);
    // On a small screen the default size fits it.
    expect(placePageWindow(undefined, [{ x: 0, y: 0, width: 800, height: 600 }], { x: 0, y: 0, width: 800, height: 600 })).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('never makes a window smaller than its minimum when the display has room', () => {
    expect(fitInto({ x: 10, y: 10, width: 100, height: 80 }, left)).toEqual({ x: 10, y: 25, width: 520, height: 420 });
  });
});

describe('remembering places in settings', () => {
  it('keeps well-formed places only', () => {
    const out = sanitizePageWindows({ mail: { x: 1.4, y: 2, width: 900, height: 700, maximized: true, at: 5 }, bad: { x: 'a', y: 0, width: 10, height: 10 }, 'Bad Key': { x: 0, y: 0, width: 900, height: 700 }, huge: { x: 0, y: 0, width: 99999, height: 700 }, tiny: { x: 0, y: 0, width: 10, height: 700 } });
    expect(out).toEqual({ mail: { x: 1, y: 2, width: 900, height: 700, maximized: true, at: 5 } });
    expect(sanitizePageWindows(null)).toEqual({});
    expect(sanitizePageWindows([1, 2])).toEqual({});
  });

  it('keeps the most recently used ones when there are too many', () => {
    let all = {};
    for (let i = 0; i < PAGE_WINDOWS_KEPT + 5; i++) all = rememberPageWindow(all, `page-${i}`, { x: 0, y: 0, width: 900, height: 700 }, 1000 + i);
    expect(Object.keys(all)).toHaveLength(PAGE_WINDOWS_KEPT);
    expect(all).toHaveProperty(`page-${PAGE_WINDOWS_KEPT + 4}`);
    expect(all).not.toHaveProperty('page-0');
  });

  it('survives a round trip through settings.json, dropping what does not belong', () => {
    const base = defaultSettings([], []);
    expect(base.pageWindows).toEqual({});
    const next = mergeSettings(base, { pageWindows: { mail: { x: 10, y: 20, width: 900, height: 700 }, '<x>': { x: 0, y: 0, width: 1, height: 1 } } });
    expect(next.pageWindows).toEqual({ mail: { x: 10, y: 20, width: 900, height: 700 } });
  });
});

describe('⌥⌘N / Ctrl+Alt+N', () => {
  it('is not taken by any of Mail\'s keyboard schemes', () => {
    for (const id of Object.keys(SCHEMES) as SchemeId[]) expect([...bindings(id).keys()]).not.toContain('mod+alt+n');
  });

  it('is the Island\'s default New task shortcut, which passes it on while a Keeper window is in front', () => {
    // electron/ipc/island.ts hands the keys to the window in front (open-in-window); the menu item carries the same keys.
    expect(normalizeAccel(defaultSettings([], []).island.taskShortcut ?? '', 'darwin')).toBe(normalizeAccel('CmdOrCtrl+Alt+N', 'darwin'));
    expect(normalizeAccel(defaultSettings([], []).island.taskShortcut ?? '', 'win32')).toBe('ctrl+alt+n');
  });
});
