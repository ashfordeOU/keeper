// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The shape of Keeper's brain as other parts see it: the built-in assistant,
// the MCP server, the local API, and the platform integrations (Spotlight,
// Shortcuts, Windows, GNOME and KDE search). Implemented in electron/services/brain.ts.

export type BrainKind = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'installer' | 'app' | 'code' | 'other';

export interface BrainSearchOptions {
  /** plain-English query; filters such as "pdfs from gmail last month" are understood */
  query: string;
  limit?: number;
  kinds?: BrainKind[];
  /** only inside these folders */
  within?: string[];
  /** ms since epoch */
  modifiedAfter?: number;
  modifiedBefore?: number;
  /** 'hybrid' (default) mixes words and meaning; 'words' is exact; 'meaning' is semantic only */
  mode?: 'hybrid' | 'words' | 'meaning';
}

export interface BrainHit {
  path: string;
  name: string;
  kind: BrainKind;
  size: number;
  mtime: number;
  /** 0..1, higher is better */
  score: number;
  /** the passage that matched, when the match was inside the file */
  snippet?: string;
  /** where the file came from (website, app, mail), if known */
  source?: string;
  tags?: string[];
  /** where in `snippet` the query words are, as [start, end) character ranges */
  highlights?: [number, number][];
  /** the heading above the matching passage */
  heading?: string;
  /** which signals found it: the words inside, the meaning, or the name and details */
  why?: ('words' | 'meaning' | 'name')[];
  /** not a file but mail, an event, a task, a contact, a meeting or a saved page; `path` is then its keeper:// link */
  item?: 'mail' | 'event' | 'task' | 'contact' | 'note' | 'meeting' | 'bookmark';
}

export interface BrainStatus {
  files: number;
  /** files whose text has been read */
  withText: number;
  /** passages with a meaning vector */
  embedded: number;
  /** passages waiting for one */
  pending: number;
  semantic: 'off' | 'downloading' | 'ready' | 'unavailable';
  semanticModel?: string;
  updatedAt?: number;
  /** files the brain has gone through (the rest are still waiting) */
  indexed?: number;
  /** passages of text across all files */
  passages?: number;
  /** model download progress, 0..1, while semantic is 'downloading' */
  download?: number;
  /** why meaning search is unavailable or stopped */
  message?: string;
}

/** What callers outside the brain module may rely on. */
export interface Brain {
  status(): BrainStatus;
  search(o: BrainSearchOptions): Promise<BrainHit[]>;
  /** text of a file, read through the same safety checks as everything else; long files come back in parts */
  read(path: string, opts?: { offset?: number; maxChars?: number }): Promise<{ text: string; total: number; truncated: boolean }>;
  /** answers a question with whichever AI the person set up, grounded in the brain; cites files */
  ask(question: string, opts?: { signal?: AbortSignal; onDelta?: (text: string) => void }): Promise<{ answer: string; sources: BrainHit[] }>;
}
