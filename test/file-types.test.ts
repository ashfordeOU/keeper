// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { asTypeFilter, chipQuery, chipRoute, frontDoorFolders, isUnder, matchesType, migrateFilesRoute, migrateSidebarLists, routeChip, shortCount, TYPE_CHIPS, typeCounts, typeLabel, visibleChips, type TypedFile } from '../core/file-types';
import { navPage, pageOf, resolveRoute, titleOf } from '../core/nav';
import { favoriteFolders } from '../core/places';
import { defaultSettings, mergeSettings } from '../core/settings';
import { resolveView, viewScope, viewsFor } from '../core/folder-view';

const f = (path: string, kind: TypedFile['kind'], size = 10, extra: Partial<TypedFile> = {}): TypedFile => ({ path, kind, size, ...extra });
const FILES: TypedFile[] = [
  f('/u/Documents/plan.md', 'document', 100),
  f('/u/Documents/Taxes/receipt.pdf', 'document', 200, { source: { id: 'gmail' } }),
  f('/u/Downloads/setup.dmg', 'installer', 5000, { source: { id: 'web:example.com' } }),
  f('/u/Downloads/photos.zip', 'archive', 300, { source: { id: 'web:example.com' } }),
  f('/u/Desktop/Screenshot 2026-10-01.png', 'image', 50, { screenshot: true }),
  f('/u/Pictures/beach.jpg', 'image', 70),
  f('/u/Documents-old/x.txt', 'document', 1),
];

describe('the type chips', () => {
  it('are the nine types in plain words, Documents first and From the web last', () => {
    expect(TYPE_CHIPS.map((c) => c.label)).toEqual(['Documents', 'Pictures', 'Videos', 'Music', 'Archives', 'Installers', 'Apps', 'Screenshots', 'From the web']);
    expect(typeLabel('all')).toBe('Everything');
    expect(typeLabel('code')).toBe('Code');
    expect(asTypeFilter('nonsense')).toBe('all');
    expect(asTypeFilter(undefined)).toBe('all');
    expect(asTypeFilter('screenshot')).toBe('screenshot');
  });

  it('turn into library queries (a chip → what is asked for)', () => {
    expect(chipQuery('document')).toEqual({ kind: 'document' });
    expect(chipQuery('image', { under: '/u/Downloads' })).toEqual({ kind: 'image', under: '/u/Downloads' });
    expect(chipQuery('screenshot')).toEqual({ screenshot: true });
    expect(chipQuery('web')).toEqual({ fromWeb: true });
    expect(chipQuery('web', { source: 'gmail' })).toEqual({ fromWeb: true, source: 'gmail' });
    // A source only means something under From the web.
    expect(chipQuery('document', { source: 'gmail' })).toEqual({ kind: 'document' });
    expect(chipQuery('all', { under: '/u' })).toEqual({ under: '/u' });
    expect(chipQuery('all')).toEqual({});
  });

  it('filter files the way the queries say', () => {
    const pick = (q: ReturnType<typeof chipQuery>) => FILES.filter((x) => matchesType(x, q)).map((x) => x.path.split('/').pop());
    expect(pick(chipQuery('document', { under: '/u/Documents' }))).toEqual(['plan.md', 'receipt.pdf']);
    expect(pick(chipQuery('web'))).toEqual(['receipt.pdf', 'setup.dmg', 'photos.zip']);
    expect(pick(chipQuery('web', { source: 'web:example.com' }))).toEqual(['setup.dmg', 'photos.zip']);
    expect(pick(chipQuery('screenshot'))).toEqual(['Screenshot 2026-10-01.png']);
    expect(pick(chipQuery('image'))).toEqual(['Screenshot 2026-10-01.png', 'beach.jpg']);
    expect(matchesType({ path: '/u/Documents/Taxes', kind: 'other', size: 0, dir: true }, chipQuery('all'))).toBe(false);
  });

  it('count each chip, everywhere or in one folder and inside it', () => {
    const all = typeCounts(FILES);
    expect(all.all).toEqual({ count: 7, size: 5721 });
    expect(all.document.count).toBe(3);
    expect(all.image.count).toBe(2);
    expect(all.screenshot.count).toBe(1);
    expect(all.web).toEqual({ count: 3, size: 5500 });
    expect(all.video.count).toBe(0);
    const docs = typeCounts(FILES, '/u/Documents');
    expect(docs.all.count).toBe(2);
    expect(docs.web.count).toBe(1);
    // Chips with nothing in them stay out, except the one chosen.
    expect(visibleChips(docs, 'video').map((c) => c.id)).toEqual(['document', 'video', 'web']);
    expect(visibleChips(undefined, 'all')).toHaveLength(9);
  });

  it('know what is inside a folder, on every system', () => {
    expect(isUnder('/u/Documents/a.txt', '/u/Documents')).toBe(true);
    expect(isUnder('/u/Documents', '/u/Documents/')).toBe(true);
    expect(isUnder('/u/Documents-old/x.txt', '/u/Documents')).toBe(false);
    expect(isUnder('/anything', '/')).toBe(true);
    expect(isUnder('C:\\Users\\Ana\\Documents\\a.txt', 'c:\\users\\ana\\documents')).toBe(true);
    expect(isUnder('C:\\Users\\Ana\\Docs2\\a.txt', 'C:\\Users\\Ana\\Docs')).toBe(false);
    expect(isUnder('\\\\nas\\share\\x', '\\\\nas\\share')).toBe(true);
  });

  it('short counts: 312, 1.2k, 25k', () => {
    expect(shortCount(312)).toBe('312');
    expect(shortCount(1234)).toBe('1.2k');
    expect(shortCount(2000)).toBe('2k');
    expect(shortCount(25_412)).toBe('25k');
  });
});

describe('routes: the Library becomes Everywhere + a chip', () => {
  it('moves the old pages over', () => {
    expect(migrateFilesRoute({ name: 'screenshots' })).toEqual({ name: 'library', arg: 'screenshot', q: undefined });
    expect(migrateFilesRoute({ name: 'downloads' })).toEqual({ name: 'library', arg: 'web', q: undefined });
    expect(migrateFilesRoute({ name: 'source', arg: 'gmail' })).toEqual({ name: 'library', arg: 'web', q: 'gmail' });
    // "All Documents" was already Everywhere + Documents.
    expect(migrateFilesRoute({ name: 'library', arg: 'document' })).toEqual({ name: 'library', arg: 'document' });
    expect(migrateFilesRoute({ name: 'library', arg: 'code' })).toEqual({ name: 'library', arg: 'code' });
    expect(migrateFilesRoute({ name: 'library', arg: 'bogus' })).toEqual({ name: 'library', arg: undefined, q: undefined });
    const same = { name: 'browse', arg: '/u/Documents' };
    expect(migrateFilesRoute(same)).toBe(same);
  });

  it('old links, the palette and keeper:// links resolve through resolveRoute', () => {
    expect(resolveRoute({ name: 'screenshots' })).toMatchObject({ name: 'library', arg: 'screenshot' });
    expect(resolveRoute({ name: 'downloads' })).toMatchObject({ name: 'library', arg: 'web' });
    expect(resolveRoute({ name: 'source', arg: 'web:example.com' })).toMatchObject({ name: 'library', arg: 'web', q: 'web:example.com' });
    expect(resolveRoute({ name: 'library', arg: 'image' })).toEqual({ name: 'library', arg: 'image' });
    // The other moves still work.
    expect(resolveRoute({ name: 'browsers' })).toMatchObject({ name: 'health', arg: 'apps' });
  });

  it('names the pages plainly, and none of them sits in the sidebar', () => {
    expect(titleOf({ name: 'library' })).toBe('Everywhere');
    expect(titleOf({ name: 'library', arg: 'document' })).toBe('Everywhere');
    expect(titleOf({ name: 'library', arg: 'web' })).toBe('From the Web');
    expect(navPage('downloads')?.kbd).toBe('J');
    expect(navPage('browse')?.group).toBe('none');
    expect(navPage('library')?.group).toBe('none');
    expect(pageOf({ name: 'recents' })?.group).toBe('top');
  });

  it('a chip and a scope make the route; the chip comes back out of it', () => {
    expect(chipRoute({}, 'document')).toEqual({ name: 'library', arg: 'document' });
    expect(chipRoute({}, 'all')).toEqual({ name: 'library' });
    expect(chipRoute({}, 'web', 'gmail')).toEqual({ name: 'library', arg: 'web', q: 'gmail' });
    expect(chipRoute({}, 'image', 'gmail')).toEqual({ name: 'library', arg: 'image' });
    expect(chipRoute({ folder: '/u/Downloads' }, 'image')).toEqual({ name: 'browse', arg: '/u/Downloads', q: 'image' });
    expect(chipRoute({ folder: '/u/Downloads' }, 'all')).toEqual({ name: 'browse', arg: '/u/Downloads' });
    expect(routeChip({ name: 'browse', arg: '/u', q: 'archive' })).toBe('archive');
    expect(routeChip({ name: 'library', arg: 'screenshot' })).toBe('screenshot');
    expect(routeChip({ name: 'library' })).toBe('all');
    expect(routeChip({ name: 'recents' })).toBe('all');
  });

  it('a type in a folder remembers its own view, without columns', () => {
    expect(viewScope({ name: 'browse', arg: '/u', q: 'image' })).toBe('library:image');
    expect(viewScope({ name: 'browse', arg: '/u' })).toBe('browse');
    expect(viewsFor(viewScope({ name: 'browse', arg: '/u', q: 'document' }))).not.toContain('columns');
    expect(resolveView('library:web', {})).toBe('list');
    expect(resolveView('library:', {})).toBe('list');
    expect(resolveView('library:image', {})).toBe('grid');
  });
});

describe('Home’s front door and old sidebar settings', () => {
  const favs = favoriteFolders('darwin', '/Users/ana', () => true);

  it('Home’s front door is Desktop, Documents and Downloads, those that exist', () => {
    expect(frontDoorFolders(favs, '/Users/ana').map((p) => p.name)).toEqual(['Desktop', 'Documents', 'Downloads']);
    const win = favoriteFolders('win32', 'C:\\Users\\Ana', (p) => !p.endsWith('Desktop'));
    expect(frontDoorFolders(win, 'C:\\Users\\Ana').map((p) => p.path)).toEqual(['C:\\Users\\Ana\\Documents', 'C:\\Users\\Ana\\Downloads']);
  });

  it('drops the Library and Cloud & Servers sections from a person’s order and hidden list, keeping the rest', () => {
    expect(migrateSidebarLists({ sidebarOrder: ['library', 'cloud', 'favorites', 'tidy', 'locations'], sidebarHidden: ['section:library', 'section:cloud', 'section:tidy', 'nav:health'] }))
      .toEqual({ sidebarOrder: ['favorites', 'tidy', 'locations'], sidebarHidden: ['section:tidy', 'nav:health'] });
    const s = mergeSettings(defaultSettings([], []), { sidebarOrder: ['library', 'ai'], sidebarHidden: ['section:cloud'], pinned: ['/Users/ana/Work'], hiddenPlaces: ['fav:/Users/ana/Music'] });
    expect(s.sidebarOrder).toEqual(['ai']);
    expect(s.sidebarHidden).toEqual([]);
    // Pinned folders and places the person removed are kept as they were.
    expect(s.pinned).toEqual(['/Users/ana/Work']);
    expect(s.hiddenPlaces).toEqual(['fav:/Users/ana/Music']);
    expect(s.sidebarTypes).toBe(false);
  });
});
