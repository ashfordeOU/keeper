// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Your own combined mailboxes: "All inboxes" is every account's inbox; a
// combined mailbox is any set of accounts' inboxes or folders you pick ("Work
// inboxes", "Every Sent"), listed with the folders and opened as one list.

import type { MailFolder, MessageSummary } from './types';

export interface UnifiedSource {
  account: string;
  /** a folder path, or 'inbox' / 'sent' / 'archive' for that account's special folder */
  folder: string;
}

export interface UnifiedView {
  id: string;
  name: string;
  sources: UnifiedSource[];
}

const SPECIALS = new Set(['inbox', 'sent', 'archive', 'drafts', 'junk', 'trash']);

/** The real folders a combined mailbox reads ('inbox' and friends looked up per account; missing ones left out). */
export function resolveSources(v: Pick<UnifiedView, 'sources'>, folders: MailFolder[]): { account: string; folder: string }[] {
  const out: { account: string; folder: string }[] = [];
  const seen = new Set<string>();
  for (const s of v.sources) {
    let path: string | undefined = s.folder;
    if (SPECIALS.has(s.folder)) {
      path = s.folder === 'inbox' ? folders.find((f) => f.account === s.account && f.special === 'inbox')?.path ?? 'INBOX' : folders.find((f) => f.account === s.account && f.special === s.folder)?.path;
    } else if (!folders.some((f) => f.account === s.account && f.path === s.folder)) path = undefined;
    if (!path) continue;
    const k = `${s.account}\n${path}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ account: s.account, folder: path });
  }
  return out;
}

/** Only inboxes: it gets the inbox's tabs, Important and Other, and leaves out blocked and muted mail. */
export function inboxOnly(v: Pick<UnifiedView, 'sources'>): boolean {
  return v.sources.length > 0 && v.sources.every((s) => s.folder === 'inbox' || s.folder.toUpperCase() === 'INBOX');
}

/** Unread mail in a combined mailbox, from the folders' own counts. */
export function unifiedUnread(v: Pick<UnifiedView, 'sources'>, folders: MailFolder[]): number {
  const want = new Set(resolveSources(v, folders).map((s) => `${s.account}\n${s.folder}`));
  return folders.filter((f) => want.has(`${f.account}\n${f.path}`)).reduce((n, f) => n + f.unread, 0);
}

/** The newest first across folders, each message once (the same Message-ID in two accounts counts once). */
export function mergeFolders(lists: MessageSummary[][]): MessageSummary[] {
  const seen = new Set<string>();
  const out: MessageSummary[] = [];
  for (const m of lists.flat().sort((a, b) => b.date - a.date)) {
    const k = m.messageId ? `mid:${m.messageId}` : m.id;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

/** A short name for a new combined mailbox from what was picked ("Work + Home inboxes"). */
export function suggestName(sources: UnifiedSource[], label: (account: string) => string): string {
  if (!sources.length) return 'Combined';
  const kinds = new Set(sources.map((s) => (SPECIALS.has(s.folder) ? s.folder : 'folders')));
  const names = [...new Set(sources.map((s) => label(s.account)))];
  const what = kinds.size === 1 ? ({ inbox: 'inboxes', sent: 'sent', archive: 'archives', drafts: 'drafts', junk: 'junk', trash: 'trash', folders: 'folders' } as Record<string, string>)[[...kinds][0]] : 'mail';
  return names.length <= 2 ? `${names.join(' + ')} ${what}` : `${names.length} accounts’ ${what}`;
}
