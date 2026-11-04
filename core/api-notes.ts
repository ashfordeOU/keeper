// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notes: vaults of Markdown files between the main process and the window.

import type { BaseResult } from './notes/bases';
import type { Bookmark, VaultConfig } from './notes/config';
import type { NoteLink } from './notes/parse';
import type { SearchHit } from './notes/search';
import type { Period } from './notes/templates';
import type { VaultFile } from './notes/vault';
import type { PluginManifest, PluginPermission } from './notes/plugins';
import type { ExportFormat, ImportSourceId, ImportSummary } from './notes/import-sources';

export interface VaultInfo {
  id: string;
  name: string;
  /** the folder on disk */
  path: string;
  /** made by another notes app (has a .obsidian settings folder) */
  shared: boolean;
  openedAt?: number;
  /** the folder is missing (a disk not plugged in, a locked folder) */
  missing?: boolean;
}

export interface OpenVault extends VaultInfo {
  config: VaultConfig;
  files: VaultFile[];
  folders: string[];
  /** ms it took to read (and how many files came from the cache) */
  took: number;
}

export interface NotesSettings {
  /** AI features (ask, summarize, write, link and tag suggestions) */
  ai: boolean;
  /** AI agents may change notes (each change is kept in file recovery) */
  agentsCanEdit: boolean;
  /** minutes between recovery snapshots of a note being edited */
  snapshotMinutes: number;
  snapshotDays: number;
  vim?: boolean;
  spellcheck?: boolean;
  /** last workspace (open tabs and panes) per vault */
  workspaces?: Record<string, unknown>;
  /** granted permissions per Keeper notes plugin */
  plugins?: Record<string, { enabled: boolean; granted: PluginPermission[] }>;
}

export interface NoteSnapshot { id: string; at: number; size: number; by?: string }

export interface NotesAnswer { text: string; cites: string[]; provider?: string; error?: string }

export interface NotesApi {
  vaults(): Promise<VaultInfo[]>;
  /** adds a folder as a vault (asks for one when no path is given) */
  addVault(path?: string): Promise<VaultInfo | null>;
  /** makes a new empty vault folder */
  createVault(name: string, parent?: string): Promise<VaultInfo | null>;
  removeVault(id: string): Promise<VaultInfo[]>;
  open(id: string): Promise<OpenVault>;
  /** stops watching the vault (the Notes page closed) */
  close(id: string): Promise<void>;
  /** the folder on disk for a vault (for other parts of Keeper) */
  vaultPath(id: string): Promise<string | null>;

  read(id: string, path: string): Promise<string>;
  write(id: string, path: string, text: string): Promise<VaultFile>;
  create(id: string, path: string, text?: string): Promise<VaultFile>;
  createFolder(id: string, path: string): Promise<void>;
  /** a new note named and placed by the vault's settings */
  newNote(id: string, opts?: { folder?: string; title?: string; activePath?: string; text?: string }): Promise<string>;
  /** moves to the trash the vault chose (system, the vault's .trash, or none) */
  remove(id: string, path: string): Promise<void>;
  /** renames or moves a file or folder and updates links to it; returns the notes that changed */
  rename(id: string, from: string, to: string): Promise<{ changed: string[]; to: string }>;
  saveAttachment(id: string, notePath: string, name: string, data: Uint8Array): Promise<string>;
  /** a keeper-file:// URL for a vault file */
  fileUrl(id: string, path: string): Promise<string>;
  reveal(id: string, path: string): Promise<void>;

  backlinks(id: string, path: string): Promise<{ source: string; links: (NoteLink & { context: string })[] }[]>;
  outgoing(id: string, path: string): Promise<{ link: NoteLink; resolved: string | null }[]>;
  unlinked(id: string, path: string): Promise<{ source: string; line: number; text: string; from: number; to: number }[]>;
  /** turns an unlinked mention into a link */
  linkMention(id: string, source: string, from: number, to: number, target: string): Promise<void>;
  tags(id: string): Promise<{ tag: string; count: number }[]>;
  search(id: string, query: string, opts?: { limit?: number; caseSensitive?: boolean }): Promise<SearchHit[]>;
  suggest(id: string, query: string): Promise<{ path: string; display: string; alias?: string; link: string }[]>;
  resolve(id: string, target: string, from: string): Promise<string | null>;
  unresolved(id: string): Promise<{ target: string; sources: string[] }[]>;
  graph(id: string, opts?: { center?: string; depth?: number; attachments?: boolean; unresolved?: boolean; folder?: string }): Promise<{ nodes: { id: string; label: string; kind: 'note' | 'file' | 'missing'; tags: string[]; degree: number }[]; edges: { from: string; to: string }[] }>;
  random(id: string): Promise<string | null>;

  /** opens (making from the template if needed) the note for a day, week, month… */
  periodic(id: string, period: Period, date?: number, offset?: number): Promise<{ path: string; created: boolean }>;
  templates(id: string): Promise<string[]>;
  fillTemplate(id: string, template: string, notePath: string): Promise<string>;
  base(id: string, opts: { path?: string; text?: string; view?: number; thisFile?: string }): Promise<BaseResult & { views: { name: string; type: string }[]; display: Record<string, string>[] }>;
  merge(id: string, from: string, into: string): Promise<void>;
  extract(id: string, path: string, from: number, to: number, title: string, mode?: 'link' | 'embed' | 'none'): Promise<string>;
  /** writes chosen notes as a website into a folder (asks when not given) */
  publish(id: string, paths: string[], opts?: { out?: string; title?: string }): Promise<{ out: string; files: number } | null>;

  /** a note as HTML for the reading view (text given: the unsaved text) */
  render(id: string, path: string, opts?: { text?: string }): Promise<string>;
  /** what a link points at, as HTML (hover previews) */
  preview(id: string, target: string, from: string): Promise<{ path: string; html: string } | null>;
  snapshots(id: string, path: string): Promise<NoteSnapshot[]>;
  snapshot(id: string, path: string, snap: string): Promise<string>;
  bookmarks(id: string): Promise<Bookmark[]>;
  setBookmarks(id: string, items: Bookmark[]): Promise<void>;
  /** adds a line to today's daily note (Island quick capture) */
  capture(text: string, vaultId?: string): Promise<{ path: string } | null>;

  settings(): Promise<NotesSettings>;
  setSettings(patch: Partial<NotesSettings>): Promise<NotesSettings>;

  ask(id: string, question: string, opts?: { path?: string }): Promise<NotesAnswer>;
  /** summarize, write (continue), suggest links or tags for one note */
  assist(id: string, path: string, task: 'summarize' | 'continue' | 'links' | 'tags', extra?: string): Promise<NotesAnswer>;

  plugins(id: string): Promise<{ keeper: (PluginManifest & { enabled: boolean; granted: PluginPermission[] })[]; foreign: { id: string; name: string }[] }>;
  pluginCode(pluginId: string): Promise<string>;
  setPlugin(pluginId: string, enabled: boolean, granted: PluginPermission[]): Promise<void>;

  /** asks for the export to import (a file or folder, as the app makes it) */
  importPick(source: ImportSourceId, want?: 'file' | 'folder'): Promise<string | null>;
  /** reads the source and says what would come in; nothing is written yet */
  importPreview(id: string, source: ImportSourceId, input: { path?: string; fields?: Record<string, string>; folder?: string }): Promise<{ job: string; folder: string; notes: number; attachments: number; skipped: ImportSummary['skipped']; needsPassword?: boolean; sample: string[] }>;
  /** writes it; progress arrives as 'notes-import' events */
  importRun(job: string, opts?: { folder?: string }): Promise<ImportSummary>;
  importCancel(job: string): Promise<void>;
  /** earlier imports into this vault, newest first */
  imports(id: string): Promise<ImportSummary[]>;
  /** removes what an import wrote (files changed since are kept) */
  importUndo(id: string, job: string): Promise<{ removed: number; kept: string[] }>;
  /** exports notes (all when paths is empty); asks where unless out is given */
  /** asks where to save a picture (a mind map as PNG or SVG) and writes it */
  saveImage(name: string, data: Uint8Array): Promise<string | null>;
  exportNotes(id: string, format: ExportFormat, opts?: { paths?: string[]; out?: string; plain?: boolean }): Promise<{ out: string; files: number } | null>;
}
