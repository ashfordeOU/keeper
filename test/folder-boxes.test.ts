// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { baseName, BOX_GROUPS, boxItems, boxPositions, boxRule, boxTitle, groupOf, planTidy, ruleForBox, shortName, type BoxEntry } from '../core/folder-boxes';
import { ruleMatches } from '../core/rules';
import { newWidget, normalizeWidgets, WIDGET_KINDS } from '../core/widgets';
import type { FileEntry } from '../core/types';

const e = (name: string, extra: Partial<BoxEntry> = {}): BoxEntry => ({ name, path: `/home/sam/Desktop/${name}`, isDir: false, size: 10, mtime: 0, ...extra });

describe('folder boxes: what a box shows', () => {
  const entries = [e('b.png', { size: 50, mtime: 3 }), e('a.pdf', { size: 90, mtime: 1 }), e('Projects', { isDir: true }), e('.DS_Store'), e('desktop.ini'), e('z.mp3', { mtime: 9 }), e('Notes 10.txt'), e('Notes 9.txt')];
  it('folders first, hidden files left out, names in natural order', () => {
    expect(boxItems(entries).map((i) => i.name)).toEqual(['Projects', 'a.pdf', 'b.png', 'Notes 9.txt', 'Notes 10.txt', 'z.mp3']);
  });
  it('by kind, newest and largest', () => {
    expect(boxItems(entries, { sort: 'kind' }).map((i) => i.name)).toEqual(['Projects', 'b.png', 'a.pdf', 'Notes 9.txt', 'Notes 10.txt', 'z.mp3']);
    expect(boxItems(entries, { sort: 'date' }).map((i) => i.name).slice(1, 3)).toEqual(['z.mp3', 'b.png']);
    expect(boxItems(entries, { sort: 'size' })[1].name).toBe('a.pdf');
  });
  it('only one kind, without folders', () => {
    expect(boxItems(entries, { show: 'pictures' }).map((i) => i.name)).toEqual(['b.png']);
    expect(boxItems(entries, { show: 'all' }).length).toBe(6);
  });
  it('links and apps go with the apps; the title is the folder’s name unless the box has its own', () => {
    expect(groupOf('Site.url')).toBe('apps');
    expect(groupOf('Editor.desktop')).toBe('apps');
    expect(groupOf('Mail.app', true)).toBe('apps');
    expect(groupOf('photo.HEIC')).toBe('pictures');
    expect(boxTitle('/home/sam/Desktop/Pictures/')).toBe('Pictures');
    expect(boxTitle('C:\\Users\\sam\\Desktop\\Work')).toBe('Work');
    expect(boxTitle('/x', '  Mine ')).toBe('Mine');
    expect(boxTitle(undefined)).toBe('Folder box');
    expect(baseName('C:\\a\\b')).toBe('b');
  });
  it('long names are cut in the middle, keeping the type', () => {
    expect(shortName('A very long holiday picture name.jpeg', 18)).toBe('A very long….jpeg');
    expect(shortName('short.txt')).toBe('short.txt');
  });
});

describe('folder boxes: tidy my desktop into boxes', () => {
  const desk = '/home/sam/Desktop';
  const entries = [e('a.png'), e('b.jpg'), e('Plan.pdf'), e('Pictures', { isDir: true }), e('.hidden'), e('Site.url'), e('song.flac'), e('weird.xyz')];
  it('one folder per kind inside the desktop, reusing a folder already there; folders and hidden files stay', () => {
    const p = planTidy(desk, entries, () => false, '/');
    expect(p.kept).toBe(2);
    expect(p.moves).toContainEqual({ from: `${desk}/a.png`, to: `${desk}/Pictures/a.png`, group: 'pictures' });
    expect(p.boxes.map((b) => [b.name, b.count, b.create])).toEqual([['Pictures', 2, false], ['Documents', 1, true], ['Music', 1, true], ['Apps and links', 1, true], ['Other', 1, true]]);
  });
  it('never replaces a file already in the box: the newcomer gets a number', () => {
    const p = planTidy(desk, [e('a.png'), e('a.png', { path: `${desk}/x/a.png` })], (q) => q === `${desk}/Pictures/a.png`, '/');
    expect(p.moves.map((m) => m.to)).toEqual([`${desk}/Pictures/a 2.png`, `${desk}/Pictures/a 3.png`]);
  });
  it('Windows paths keep their separator', () => {
    const p = planTidy('C:\\Users\\sam\\Desktop', [{ ...e('a.png'), path: 'C:\\Users\\sam\\Desktop\\a.png' }], () => false);
    expect(p.moves[0].to).toBe('C:\\Users\\sam\\Desktop\\Pictures\\a.png');
  });
  it('boxes go in rows from the top left of the screen', () => {
    expect(boxPositions(5, { x: 0, y: 25, width: 1000, height: 800 })).toEqual([{ x: 16, y: 41 }, { x: 332, y: 41 }, { x: 648, y: 41 }, { x: 16, y: 297 }, { x: 332, y: 297 }]);
  });
});

describe('folder boxes: sorting new files in with Automations', () => {
  it('a box’s rule moves new desktop files of its kind into its folder, and is found again by folder', () => {
    const r = boxRule('pictures', '/home/sam/Desktop/Pictures', '/home/sam/Desktop', 1);
    expect(r).toMatchObject({ enabled: true, action: { type: 'move', to: '/home/sam/Desktop/Pictures' }, scope: ['/home/sam/Desktop'] });
    expect(r.name).toBe('Pictures on the desktop go to the “Pictures” box');
    const f = { path: '/home/sam/Desktop/x.png', name: 'x.png', ext: 'png', kind: 'image', size: 1, mtime: 0, ctime: 0, dir: '/home/sam/Desktop' } as unknown as FileEntry;
    expect(ruleMatches(f, r)).toBe(true);
    expect(ruleMatches({ ...f, name: 'x.pdf', ext: 'pdf', kind: 'document' } as FileEntry, r)).toBe(false);
    expect(ruleForBox([r], '/home/sam/Desktop/Pictures/')?.id).toBe(r.id);
    expect(ruleForBox([r], '/elsewhere')).toBeUndefined();
    expect(boxRule('apps', '/d/Apps', '/d').conditions[0]).toMatchObject({ type: 'ext' });
  });
  it('every kind of file has exactly one box group', () => {
    const kinds = BOX_GROUPS.flatMap((g) => g.kinds);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe('folder boxes: the widget', () => {
  it('is a widget kind of its own, sorted by kind and showing everything at first, and survives a reload', () => {
    expect(WIDGET_KINDS.some((k) => k.kind === 'folder')).toBe(true);
    const w = newWidget('folder', { x: 0, y: 0 }, 1);
    expect(w.options).toEqual({ sort: 'kind', show: 'all' });
    const back = normalizeWidgets([{ ...w, options: { ...w.options, folder: '/d', rolled: true, fullHeight: 260 } }]);
    expect(back[0].options).toMatchObject({ folder: '/d', rolled: true, fullHeight: 260 });
  });
});
