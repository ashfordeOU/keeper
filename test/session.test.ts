// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { decodeCheckpoint, encodeCheckpoint, pickCheckpoint, recentCrashes } from '../core/checkpoint';
import {
  activeTab, closeOthers, closeTab, closeToRight, detachTab, duplicateTab, emptyWindow, goBack, goForward, moveTab, navigate, openTab, pinTab,
  reopenClosed, sanitizeWindow, selectTab, sleepingTabs, type SessionSnapshot,
} from '../core/session';

const r = (name: string, arg?: string) => ({ name, arg });

describe('tabs', () => {
  it('each tab keeps its own page and Back/Forward', () => {
    let w = emptyWindow();
    w = navigate(w, r('library', 'image'));
    w = navigate(w, r('browse', '/home/a'));
    w = openTab(w, r('settings'));
    expect(activeTab(w).route.name).toBe('settings');
    expect(activeTab(w).back).toEqual([]);
    w = selectTab(w, w.tabs[0].id);
    expect(activeTab(w).route).toEqual(r('browse', '/home/a'));
    w = goBack(w);
    expect(activeTab(w).route).toEqual(r('library', 'image'));
    w = goForward(w);
    expect(activeTab(w).route).toEqual(r('browse', '/home/a'));
    // A new page after going back drops Forward.
    w = goBack(w);
    w = navigate(w, r('space'));
    expect(activeTab(w).fwd).toEqual([]);
  });

  it('opens next to the current tab, in the background when asked', () => {
    let w = emptyWindow();
    w = openTab(w, r('a'));
    w = selectTab(w, w.tabs[0].id);
    w = openTab(w, r('b'), { background: true });
    expect(w.tabs.map((t) => t.route.name)).toEqual(['home', 'b', 'a']);
    expect(activeTab(w).route.name).toBe('home');
  });

  it('closing keeps a sensible tab in front, never leaves a window empty, and can be undone', () => {
    let w = openTab(openTab(emptyWindow(), r('a')), r('b'));
    const b = activeTab(w).id;
    w = closeTab(w, b);
    expect(activeTab(w).route.name).toBe('a');
    w = closeTab(closeTab(w, w.tabs[1].id), w.tabs[0].id);
    expect(w.tabs).toHaveLength(1);
    expect(activeTab(w).route.name).toBe('home');
    w = reopenClosed(w);
    expect(activeTab(w).route.name).toBe('home');
    w = reopenClosed(reopenClosed(w));
    expect(w.tabs.map((t) => t.route.name)).toContain('b');
  });

  it('pins stay first; reordering respects them', () => {
    let w = openTab(openTab(openTab(emptyWindow(), r('a')), r('b')), r('c'));
    const c = activeTab(w).id;
    w = pinTab(w, c, true);
    expect(w.tabs[0].id).toBe(c);
    w = moveTab(w, c, 3);
    expect(w.tabs[0].id).toBe(c);
    const a = w.tabs.find((t) => t.route.name === 'a')!.id;
    w = moveTab(w, a, 0);
    expect(w.tabs[0].id).toBe(c);
    expect(w.tabs[1].id).toBe(a);
  });

  it('close others / to the right keep pinned tabs and can be reopened', () => {
    let w = openTab(openTab(openTab(emptyWindow(), r('a')), r('b')), r('c'));
    w = pinTab(w, w.tabs[0].id, true);
    const a = w.tabs.find((t) => t.route.name === 'a')!.id;
    expect(closeToRight(w, a).tabs.map((t) => t.route.name)).toEqual(['home', 'a']);
    const o = closeOthers(w, a);
    expect(o.tabs.map((t) => t.route.name)).toEqual(['home', 'a']);
    expect(o.closed.map((t) => t.route.name)).toEqual(['b', 'c']);
  });

  it('duplicating copies history and drafts; detaching moves drafts with the tab', () => {
    let w = navigate(emptyWindow(), r('assistant'));
    const id = w.active;
    w = { ...w, drafts: { [`${id}:assistant`]: 'half a question' } };
    const d = duplicateTab(w, id);
    expect(activeTab(d).back).toEqual(activeTab(w).back);
    expect(d.drafts[`${d.active}:assistant`]).toBe('half a question');
    const { rest, tab, drafts } = detachTab(d, id);
    expect(tab?.id).toBe(id);
    expect(drafts[`${id}:assistant`]).toBe('half a question');
    expect(rest.tabs.some((t) => t.id === id)).toBe(false);
    expect(rest.closed.some((t) => t.id === id)).toBe(false);
  });

  it('tabs left in the back for a while are put to sleep', () => {
    let w = openTab(emptyWindow(), r('a'), { now: 1000 });
    w = { ...w, tabs: w.tabs.map((t) => ({ ...t, lastActive: 1000 })) };
    expect(sleepingTabs(w, 1000 + 10 * 60_000, 5 * 60_000)).toEqual([w.tabs[0].id]);
  });

  it('a damaged saved window never stops Keeper from opening', () => {
    expect(sanitizeWindow(null).tabs).toHaveLength(1);
    const w = sanitizeWindow({ tabs: [{ id: 'x', route: { name: 'home' }, back: [7, { name: 'library' }], fwd: 'no' }, { id: 3 }], active: 'gone', scroll: { a: 1, b: 'x' }, drafts: { k: 'v', n: 2 } });
    expect(w.tabs).toHaveLength(1);
    expect(w.active).toBe('x');
    expect(w.tabs[0].back).toEqual([{ name: 'library' }]);
    expect(w.scroll).toEqual({ a: 1 });
    expect(w.drafts).toEqual({ k: 'v' });
  });
});

describe('checkpoint', () => {
  const snap = (name: string): SessionSnapshot => ({ version: 1, savedAt: 1, windows: [navigate(emptyWindow(), r(name))] });

  it('round-trips and picks the newest whole generation', () => {
    const a = encodeCheckpoint(snap('library'), 4);
    const b = encodeCheckpoint(snap('settings'), 5);
    expect(pickCheckpoint([a, b])?.snapshot.windows[0].tabs[0].route.name).toBe('settings');
    expect(pickCheckpoint([b, a])?.gen).toBe(5);
  });

  it('a file cut short or changed falls back to the previous generation', () => {
    const a = encodeCheckpoint(snap('library'), 4);
    const b = encodeCheckpoint(snap('settings'), 5);
    expect(pickCheckpoint([a, b.slice(0, b.length / 2)])?.snapshot.windows[0].tabs[0].route.name).toBe('library');
    const tampered = b.replace('settings', 'settingz');
    expect(decodeCheckpoint(tampered)).toBeNull();
    expect(pickCheckpoint([a, tampered])?.gen).toBe(4);
    expect(pickCheckpoint(['garbage', null])).toBeNull();
  });

  it('counts crashes in the last five minutes for the crash-loop guard', () => {
    expect(recentCrashes([0, 100_000, 290_000, 400_000], 400_000)).toBe(3);
  });
});
