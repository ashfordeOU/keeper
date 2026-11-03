// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's reader: two feeds and a page saved for later, in memory.

import type { ReaderApi, ReaderItem, ReaderOverview } from '../core/api-reader';
import { defaultReaderSettings } from '../core/reader';

export function mockReader(): { reader: ReaderApi } {
  const now = Date.now();
  const feeds = [
    { id: 'f1', url: 'https://garden.example/feed', title: 'Garden Notes', site: 'https://garden.example/', folder: 'Home', added: now - 9e8 },
    { id: 'f2', url: 'https://code.example/atom.xml', title: 'Code Log', site: 'https://code.example/', folder: 'Work', added: now - 9e8 },
  ];
  const items: ReaderItem[] = [
    { key: 'a1', feedId: 'f1', url: 'https://garden.example/bulbs', title: 'How to plant bulbs before the frost', author: 'Ada', published: now - 3.6e6, added: now, read: false, starred: false, later: false, excerpt: 'Autumn is the best time to plant spring bulbs, because the soil is still warm.', source: 'Garden Notes', offline: true },
    { key: 'a2', feedId: 'f2', url: 'https://code.example/r2', title: 'Release 2.0: faster builds', author: 'Lin', published: now - 8.6e7, added: now, read: true, starred: true, later: false, excerpt: 'Builds are twice as fast and the cache survives restarts.', source: 'Code Log', offline: true },
    { key: 'l1', feedId: null, url: 'https://essays.example/calm', title: 'Designing calm software', published: now - 2e8, added: now, read: false, starred: false, later: true, excerpt: 'Software that respects attention does less, and says so.', source: 'essays.example', offline: true },
  ];
  const overview = async (): Promise<ReaderOverview> => ({ feeds: feeds.map((f) => ({ ...f, unread: items.filter((i) => i.feedId === f.id && !i.read).length })), folders: ['Home', 'Work'], counts: { all: 2, unread: items.filter((i) => i.feedId && !i.read).length, starred: 1, later: 1 }, settings: defaultReaderSettings(), refreshing: false });
  return {
    reader: {
      overview,
      items: async (q) => items.filter((i) => (q.view === 'later' ? i.later : q.view === 'starred' ? i.starred : q.view === 'unread' ? i.feedId && !i.read : q.feed ? i.feedId === q.feed : !!i.feedId)),
      article: async (key) => { const i = items.find((x) => x.key === key)!; i.read = true; return { ...i, html: `<p>${i.excerpt}</p><p>The rest of the article, kept on this computer to read offline.</p>`, words: 420, from: 'page' }; },
      addFeed: async (url) => ({ id: 'f3', url, title: url, added: Date.now(), unread: 0 }),
      removeFeed: () => overview(),
      editFeed: () => overview(),
      refresh: () => overview(),
      setRead: async (keys, read) => { for (const i of items) if (keys.includes(i.key)) i.read = read; },
      markAllRead: async () => { for (const i of items) i.read = true; return overview(); },
      setStarred: async (key, on) => { const i = items.find((x) => x.key === key); if (i) i.starred = on; },
      saveForLater: async (url) => ({ ...items[2], key: 'l2', url, title: url }),
      removeLater: async () => undefined,
      importOpml: async () => ({ added: 0, skipped: 0, failed: [] }),
      exportOpml: async () => ({ saved: false }),
    },
  };
}
