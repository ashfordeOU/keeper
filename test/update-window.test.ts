// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '../core/api-x';
import { isSkipped, noteBlocks, noteInline, shouldOfferUpdate, trayUpdateLabel, updateChannel, updateWindowView } from '../core/update-window';

const now = Date.parse('2026-11-01T12:00:00Z');
const ctx = { current: '0.1.0-beta.3', beta: true, now };
const st = (over: Partial<UpdateStatus>): UpdateStatus => ({ state: 'idle', current: '0.1.0-beta.3', ...over });

describe('the Software Update window', () => {
  it('shows a spinner while checking (and before the first answer)', () => {
    expect(updateWindowView(null, ctx).kind).toBe('checking');
    expect(updateWindowView(st({ state: 'idle' }), ctx).kind).toBe('checking');
    const v = updateWindowView(st({ state: 'checking' }), ctx);
    expect(v.kind).toBe('checking');
    expect(v.actions).toEqual([]);
  });

  it('says it is the newest version, with the channel and when it last looked', () => {
    const v = updateWindowView(st({ state: 'none', checkedAt: now - 5 * 60_000 }), ctx);
    expect(v.kind).toBe('current');
    expect(v.title).toBe('Keeper 0.1.0-beta.3 is the newest version');
    expect(v.detail).toBe('Beta channel · Last checked 5 minutes ago');
    expect(v.actions[0]).toMatchObject({ id: 'close', primary: true });
    expect(updateWindowView(st({ state: 'none', checkedAt: now }), { ...ctx, current: '1.0.0', beta: false }).detail).toMatch(/^Stable channel/);
  });

  it('offers a new version with its notes: Install and Relaunch, Later, Skip', () => {
    const v = updateWindowView(st({ state: 'available', version: '0.1.0-beta.4', notes: '- Faster', canInstall: true, method: 'in-place', size: 120 * 1024 * 1024, publishedAt: new Date(now - 2 * 86_400_000).toISOString() }), ctx);
    expect(v.kind).toBe('available');
    expect(v.title).toBe('Keeper 0.1.0-beta.4 is available — you have 0.1.0-beta.3');
    expect(v.notes).toBe('- Faster');
    expect(v.actions.map((a) => a.label)).toEqual(['Install and Relaunch', 'Later']);
    expect(v.actions[0].primary).toBe(true);
    expect(v.skip).toBe(true);
    expect(v.detail).toBe('Beta channel · released 2 days ago · 120 MB');
  });

  it('copies that cannot replace themselves download instead; package managers show their command', () => {
    expect(updateWindowView(st({ state: 'available', version: '2.0.0', canInstall: false, method: 'manual' }), ctx).actions[0]).toMatchObject({ id: 'download', label: 'Download…' });
    const m = updateWindowView(st({ state: 'available', version: '2.0.0', canInstall: false, method: 'manager', manager: { label: 'Homebrew', command: 'brew upgrade keeper' } }), ctx);
    expect(m.actions[0]).toMatchObject({ id: 'copy' });
    expect(m.note).toContain('brew upgrade keeper');
    expect(updateWindowView(st({ state: 'available', version: '2.0.0', canInstall: true, method: 'package' }), ctx).actions[0].label).toBe('Download and Install');
  });

  it('shows the download as a percentage, then Relaunch Now', () => {
    const d = updateWindowView(st({ state: 'downloading', version: '2.0.0', percent: 41.6 }), ctx);
    expect(d).toMatchObject({ kind: 'downloading', percent: 42, detail: '42%', title: 'Downloading Keeper 2.0.0…' });
    expect(updateWindowView(st({ state: 'downloading', percent: 140 }), ctx).percent).toBe(100);
    const r = updateWindowView(st({ state: 'ready', version: '2.0.0', method: 'in-place' }), ctx);
    expect(r.kind).toBe('ready');
    expect(r.actions[0]).toMatchObject({ id: 'relaunch', label: 'Relaunch Now', primary: true });
    expect(updateWindowView(st({ state: 'ready', version: '2.0.0', method: 'package' }), ctx).actions[0].label).toBe('Install Now');
    expect(updateWindowView(st({ state: 'installing', version: '2.0.0' }), ctx).kind).toBe('installing');
  });

  it('explains an error plainly with Try Again and the releases page', () => {
    const e = updateWindowView(st({ state: 'error', message: 'GitHub returned 502' }), ctx);
    expect(e).toMatchObject({ kind: 'error', title: 'Couldn’t check for updates', detail: 'GitHub returned 502', releases: true });
    expect(e.actions.map((a) => a.id)).toEqual(['retry', 'close']);
    expect(updateWindowView(st({ state: 'error' }), { ...ctx, last: 'install' }).title).toBe('Keeper couldn’t install the update');
    expect(updateWindowView(st({ state: 'error' }), ctx).detail).toMatch(/internet connection/);
  });

  it('names the channel', () => {
    expect(updateChannel('0.1.0-beta.3', false)).toBe('Beta');
    expect(updateChannel('0.1.0-beta.3', false, true)).toBe('Stable');
    expect(updateChannel('1.0.0', true)).toBe('Beta');
    expect(updateChannel('1.0.0', false)).toBe('Stable');
  });
});

describe('opening it after an automatic check', () => {
  const found = st({ state: 'available', version: '2.0.0' });
  it('only when the person asked to be asked, and not for a skipped version', () => {
    expect(shouldOfferUpdate(found, { updateMode: 'ask' })).toBe(true);
    expect(shouldOfferUpdate(found, { updateMode: 'auto' })).toBe(false);
    expect(shouldOfferUpdate(found, { updateMode: 'off' })).toBe(false);
    expect(shouldOfferUpdate(found, { updateMode: 'ask', updateSkip: '2.0.0' })).toBe(false);
    expect(shouldOfferUpdate(found, { updateMode: 'ask', updateSkip: '1.9.0' })).toBe(true);
    expect(shouldOfferUpdate(st({ state: 'none' }), { updateMode: 'ask' })).toBe(false);
  });
  it('a skipped version is skipped only while it is the one on offer', () => {
    expect(isSkipped(found, 'v2.0.0')).toBe(true);
    expect(isSkipped(st({ state: 'ready', version: '2.0.0' }), '2.0.0')).toBe(false);
    expect(isSkipped(found, undefined)).toBe(false);
  });
});

describe('the tray entry', () => {
  it('says what is waiting', () => {
    expect(trayUpdateLabel({ state: 'available', version: '2.0.0' })).toBe('Keeper 2.0.0 Is Available…');
    expect(trayUpdateLabel({ state: 'ready', version: '2.0.0' })).toBe('Restart to Update to 2.0.0');
    expect(trayUpdateLabel({ state: 'downloading', version: '2.0.0', percent: 12 })).toBe('Downloading Keeper 2.0.0… 12%');
    expect(trayUpdateLabel({ state: 'none' })).toBeNull();
    expect(trayUpdateLabel({ state: 'error' })).toBeNull();
  });
});

describe('release notes', () => {
  it('turns Markdown into headings, lists, paragraphs and code', () => {
    const b = noteBlocks('## What’s new\n- **Faster** search\n- New *Bubbles* view\n\nSee the [changelog](https://example.org/c).\n\n```\nnpm i\n```\n1. one\n2. two');
    expect(b.map((x) => x.t)).toEqual(['h', 'ul', 'p', 'pre', 'ol']);
    expect(b[0]).toEqual({ t: 'h', level: 2, c: [{ t: 'text', s: 'What’s new' }] });
    expect(b[1]).toEqual({ t: 'ul', items: [[{ t: 'strong', s: 'Faster' }, { t: 'text', s: ' search' }], [{ t: 'text', s: 'New ' }, { t: 'em', s: 'Bubbles' }, { t: 'text', s: ' view' }]] });
    expect(b[2]).toEqual({ t: 'p', c: [{ t: 'text', s: 'See the ' }, { t: 'link', s: 'changelog', href: 'https://example.org/c' }, { t: 'text', s: '.' }] });
    expect(b[3]).toEqual({ t: 'pre', s: 'npm i' });
  });

  it('never keeps HTML, scripts, pictures or links that are not http(s)', () => {
    const b = noteBlocks('<script>alert(1)</script><b onclick="x()">Bold</b> text <img src="https://t.example/p.png">\n\n![tracking](https://t.example/p.png) [click](javascript:alert(1))');
    const all = JSON.stringify(b);
    expect(all).not.toMatch(/script|onclick|<|javascript|t\.example/);
    expect(b[0]).toEqual({ t: 'p', c: [{ t: 'text', s: 'Bold text' }] });
    expect(b[1]).toEqual({ t: 'p', c: [{ t: 'text', s: 'tracking click' }] });
  });

  it('keeps snake_case words, decodes entities, and links bare URLs', () => {
    expect(noteInline('set file_name_here &amp; go')).toEqual([{ t: 'text', s: 'set file_name_here & go' }]);
    expect(noteInline('see https://github.com/ashfordeOU/keeper/pull/12.')).toEqual([{ t: 'text', s: 'see ' }, { t: 'link', s: 'https://github.com/ashfordeOU/keeper/pull/12', href: 'https://github.com/ashfordeOU/keeper/pull/12' }, { t: 'text', s: '.' }]);
    expect(noteInline('`a*b*c` and 2 * 3 * 4')).toEqual([{ t: 'code', s: 'a*b*c' }, { t: 'text', s: ' and 2 * 3 * 4' }]);
  });

  it('copes with nothing at all', () => {
    expect(noteBlocks('')).toEqual([]);
    expect(noteBlocks(undefined)).toEqual([]);
  });
});
