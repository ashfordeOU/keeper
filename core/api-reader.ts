// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The reader as the window sees it (core/reader.ts has the logic).

import type { ReaderSettings } from './reader';

export interface ReaderFeed {
  id: string;
  url: string;
  title: string;
  site?: string;
  folder?: string;
  added: number;
  lastFetched?: number;
  /** the last look failed: why, in plain words */
  error?: string;
  unread: number;
}

export interface ReaderItem {
  key: string;
  /** null for a page saved for later */
  feedId: string | null;
  url: string;
  title: string;
  author?: string;
  published?: number;
  added: number;
  read: boolean;
  starred: boolean;
  /** saved for later */
  later: boolean;
  image?: string;
  excerpt: string;
  /** the site's name (saved pages) or the feed's title */
  source: string;
  /** the whole article is kept on this computer */
  offline: boolean;
}

export interface ReaderArticle extends ReaderItem {
  /** sanitized HTML of the article */
  html: string;
  words: number;
  byline?: string;
  /** "feed": what the feed gave; "page": the clean view of the page itself */
  from: 'feed' | 'page';
  /** why the whole article could not be fetched (the feed's summary is shown) */
  note?: string;
}

export type ReaderView = 'all' | 'unread' | 'starred' | 'later';

export interface ReaderOverview {
  feeds: ReaderFeed[];
  folders: string[];
  counts: { all: number; unread: number; starred: number; later: number };
  settings: ReaderSettings;
  refreshing: boolean;
}

export interface ReaderApi {
  overview(): Promise<ReaderOverview>;
  items(q: { view?: ReaderView; feed?: string; folder?: string; limit?: number }): Promise<ReaderItem[]>;
  /** the article to read (fetched and kept for offline the first time, if the feed gives only a summary); marks it read */
  article(key: string): Promise<ReaderArticle>;
  /** a feed's address or a site's (its feed is found) */
  addFeed(url: string, folder?: string): Promise<ReaderFeed>;
  removeFeed(id: string): Promise<ReaderOverview>;
  editFeed(id: string, patch: { title?: string; folder?: string }): Promise<ReaderOverview>;
  /** looks at one feed, or all */
  refresh(feedId?: string): Promise<ReaderOverview>;
  setRead(keys: string[], read: boolean): Promise<void>;
  markAllRead(q: { feed?: string; folder?: string }): Promise<ReaderOverview>;
  setStarred(key: string, on: boolean): Promise<void>;
  /** saves any web page for later, as a clean article kept on this computer */
  saveForLater(url: string, title?: string): Promise<ReaderItem>;
  /** takes a page out of Read later (and deletes it if it came from nowhere else) */
  removeLater(key: string): Promise<void>;
  /** OPML: from a file (asks when no text is given) */
  importOpml(text?: string): Promise<{ added: number; skipped: number; failed: string[] }>;
  /** OPML: asks where to save */
  exportOpml(): Promise<{ saved: boolean; path?: string }>;
}
