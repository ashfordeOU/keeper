// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { compareNames, countFolders, flattenTree, groupByFolder, isPlainText, kindIntro, parentOf, prettyFolder, resolveView, sortFoldersFirst, viewScope, viewsFor } from '../core/folder-view';

const f = (name: string, o: { dir?: boolean; size?: number; mtime?: number; ext?: string } = {}) => ({ name, path: `/h/${name}`, size: o.size ?? 0, mtime: o.mtime ?? 0, ext: o.ext ?? (name.includes('.') ? name.split('.').pop()! : ''), dir: o.dir });

describe('folders first', () => {
  const items = [f('b.txt', { size: 5, mtime: 3 }), f('Zebra', { dir: true, mtime: 9 }), f('a.md', { size: 50, mtime: 1 }), f('apples', { dir: true, mtime: 1 }), f('note 10.md', { size: 1, mtime: 2 }), f('note 2.md', { size: 1, mtime: 2 })];
  const names = (x: { name: string }[]) => x.map((i) => i.name);

  it('sorts folders before files, both by name, naturally and ignoring case', () => {
    expect(names(sortFoldersFirst(items))).toEqual(['apples', 'Zebra', 'a.md', 'b.txt', 'note 2.md', 'note 10.md']);
  });
  it('keeps folders first when sorted by name Z–A', () => {
    expect(names(sortFoldersFirst(items, { key: 'name', desc: true }))).toEqual(['Zebra', 'apples', 'note 10.md', 'note 2.md', 'b.txt', 'a.md']);
  });
  it('sorts by date within folders and files', () => {
    expect(names(sortFoldersFirst(items, { key: 'date', desc: true }))).toEqual(['Zebra', 'apples', 'b.txt', 'note 2.md', 'note 10.md', 'a.md']);
  });
  it('keeps folders by name when sorted by size (they have no size here)', () => {
    expect(names(sortFoldersFirst(items, { key: 'size', desc: true }))).toEqual(['apples', 'Zebra', 'a.md', 'b.txt', 'note 2.md', 'note 10.md']);
  });
  it('sorts by kind, then name', () => {
    expect(names(sortFoldersFirst(items, { key: 'kind', desc: false }))).toEqual(['apples', 'Zebra', 'a.md', 'note 2.md', 'note 10.md', 'b.txt']);
  });
  it('does not change the list it was given', () => {
    const copy = [...items];
    sortFoldersFirst(items);
    expect(items).toEqual(copy);
  });
  it('compares names naturally', () => {
    expect(compareNames('file 9', 'file 10')).toBeLessThan(0);
    expect(compareNames('Apple', 'apple')).toBe(0);
  });
});

describe('group by folder', () => {
  const files = [
    { path: '/h/Docs/Notes/b.md' }, { path: '/h/Docs/a.md' }, { path: '/h/Docs/Notes/a.md' },
    { path: '/h/Docs b/x.md' }, { path: '/h/Docs/Notes 10/c.md' }, { path: '/h/Docs/Notes 2/c.md' },
  ];
  it('puts files under their folders, in path order, keeping the files’ own order', () => {
    const g = groupByFolder(files);
    expect(g.map((x) => x.dir)).toEqual(['/h/Docs', '/h/Docs/Notes', '/h/Docs/Notes 2', '/h/Docs/Notes 10', '/h/Docs b']);
    expect(g[1].files.map((x) => x.path)).toEqual(['/h/Docs/Notes/b.md', '/h/Docs/Notes/a.md']);
  });
  it('handles Windows paths', () => {
    const g = groupByFolder([{ path: 'C:\\Users\\a\\x.txt' }, { path: 'C:\\y.txt' }]);
    expect(g.map((x) => x.dir)).toEqual(['C:\\', 'C:\\Users\\a']);
  });
  it('counts folders', () => {
    expect(countFolders(files)).toBe(5);
    expect(countFolders([])).toBe(0);
  });
  it('finds a parent folder', () => {
    expect(parentOf('/a/b/c.txt')).toBe('/a/b');
    expect(parentOf('/c.txt')).toBe('/');
    expect(parentOf('C:\\c.txt')).toBe('C:\\');
    expect(parentOf('C:\\a\\c.txt')).toBe('C:\\a');
    expect(parentOf('c.txt')).toBe('');
  });
  it('says a home folder the short way', () => {
    expect(prettyFolder('/Users/ana/Documents/Notes', '/Users/ana')).toBe('~/Documents/Notes');
    expect(prettyFolder('/Users/anabel/x', '/Users/ana')).toBe('/Users/anabel/x');
    expect(prettyFolder('C:\\Users\\ana\\Docs', 'C:\\Users\\ana')).toBe('~\\Docs');
  });
});

describe('list view tree', () => {
  const top = [{ path: '/d/A', dir: true }, { path: '/d/B', dir: true }, { path: '/d/x.txt' }];
  const kids: Record<string, { path: string; dir?: boolean }[]> = { '/d/A': [{ path: '/d/A/Deep', dir: true }, { path: '/d/A/y.txt' }], '/d/A/Deep': [{ path: '/d/A/Deep/z.txt' }] };
  it('shows a folder’s contents under it only when open', () => {
    expect(flattenTree(top, new Set(), (d) => kids[d]).map((r) => r.depth)).toEqual([0, 0, 0]);
    const rows = flattenTree(top, new Set(['/d/A', '/d/A/Deep']), (d) => kids[d]);
    expect(rows.map((r) => `${r.depth}:${r.item.path}`)).toEqual(['0:/d/A', '1:/d/A/Deep', '2:/d/A/Deep/z.txt', '1:/d/A/y.txt', '0:/d/B', '0:/d/x.txt']);
    expect(rows[0].expanded).toBe(true);
  });
  it('marks an open folder still loading', () => {
    const rows = flattenTree(top, new Set(['/d/B']), (d) => kids[d]);
    expect(rows[1]).toMatchObject({ expanded: true, loading: true });
  });
  it('ignores files marked open', () => {
    expect(flattenTree(top, new Set(['/d/x.txt']), () => []).length).toBe(3);
  });
});

describe('views', () => {
  it('remembers a view per kind of page', () => {
    expect(viewScope({ name: 'browse', arg: '/x' })).toBe('browse');
    expect(viewScope({ name: 'library', arg: 'document' })).toBe('library:document');
    expect(viewScope({ name: 'screenshots' })).toBe('library:screenshot');
    expect(viewScope({ name: 'search' })).toBe('files');
  });
  it('opens text-heavy collections as a list and pictures as icons', () => {
    expect(resolveView('library:document', {})).toBe('list');
    expect(resolveView('library:archive', {})).toBe('list');
    expect(resolveView('library:image', {})).toBe('grid');
    expect(resolveView('library:screenshot', {})).toBe('grid');
    expect(resolveView('library:document', { 'library:document': 'gallery' })).toBe('gallery');
  });
  it('offers columns only for real folders', () => {
    expect(viewsFor('browse')).toContain('columns');
    expect(viewsFor('library:document')).not.toContain('columns');
    expect(resolveView('files', { files: 'columns' })).toBe('list');
    expect(resolveView('browse', { browse: 'columns' })).toBe('columns');
    expect(resolveView('browse', {}, 'list')).toBe('list');
  });
  it('knows plain text', () => {
    expect(isPlainText('md')).toBe(true);
    expect(isPlainText('TXT')).toBe(true);
    expect(isPlainText('pdf')).toBe(false);
  });
  it('says what a collection is', () => {
    expect(kindIntro('document', 24407, 1203, 'darwin')).toBe('Every document on this Mac, wherever it is. 24,407 in 1,203 folders.');
    expect(kindIntro('screenshot', 1, 1, 'win32')).toBe('Every screenshot on this PC, wherever it is. 1 in 1 folder.');
    expect(kindIntro('archive', 0, 0, 'linux')).toBe('Every archive on this computer, wherever it is. No archives found yet.');
  });
});
