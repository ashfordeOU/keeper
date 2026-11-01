// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The settings a vault already carries in its .obsidian folder, read so the
// same vault behaves the same in Keeper: where attachments and new notes go,
// how links are written, what goes to the trash, daily notes and templates,
// bookmarks and property types. Keeper only writes the files it shares
// (bookmarks, types); everything else of its own lives outside the vault.

import { dirOf, normPath, type LinkFormat } from './vault';
import { DEFAULT_FORMATS, type Period, type PeriodicConfig } from './templates';

export const CONFIG_DIR = '.obsidian';

export interface VaultConfig {
  /** "/" vault root, "./" next to the note, "./sub" a folder next to the note, or a folder path */
  attachmentFolderPath: string;
  newLinkFormat: LinkFormat;
  useMarkdownLinks: boolean;
  /** "root", "current" (next to the open note) or "folder" (newFileFolderPath) */
  newFileLocation: 'root' | 'current' | 'folder';
  newFileFolderPath: string;
  /** "system" trash, "local" (.trash in the vault) or "none" (delete) */
  trashOption: 'system' | 'local' | 'none';
  alwaysUpdateLinks: boolean;
  showUnsupportedFiles: boolean;
  userIgnoreFilters: string[];
  periodic: Record<Period, PeriodicConfig>;
  templates: { folder: string; dateFormat: string; timeFormat: string };
  /** property name → type ("text", "multitext", "number", "checkbox", "date", "datetime", "aliases", "tags") */
  types: Record<string, string>;
  vimMode: boolean;
  spellcheck: boolean;
  readableLineLength: boolean;
  livePreview: boolean;
  defaultViewMode: 'source' | 'preview';
  foldHeading: boolean;
  showLineNumber: boolean;
}

export const DEFAULT_CONFIG: VaultConfig = {
  attachmentFolderPath: '/',
  newLinkFormat: 'shortest',
  useMarkdownLinks: false,
  newFileLocation: 'root',
  newFileFolderPath: '',
  trashOption: 'system',
  alwaysUpdateLinks: true,
  showUnsupportedFiles: false,
  userIgnoreFilters: [],
  periodic: {
    day: { enabled: true, folder: '', format: DEFAULT_FORMATS.day, template: '' },
    week: { enabled: false, folder: '', format: DEFAULT_FORMATS.week, template: '' },
    month: { enabled: false, folder: '', format: DEFAULT_FORMATS.month, template: '' },
    quarter: { enabled: false, folder: '', format: DEFAULT_FORMATS.quarter, template: '' },
    year: { enabled: false, folder: '', format: DEFAULT_FORMATS.year, template: '' },
  },
  templates: { folder: '', dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
  types: {},
  vimMode: false,
  spellcheck: true,
  readableLineLength: true,
  livePreview: true,
  defaultViewMode: 'source',
  foldHeading: true,
  showLineNumber: false,
};

type Json = Record<string, unknown>;
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/**
 * Builds the config from the JSON files in .obsidian (any may be missing):
 * app.json, daily-notes.json, templates.json, types.json, and the community
 * periodic-notes plugin's data.json for weekly and monthly notes.
 */
export function readConfig(files: { app?: Json; dailyNotes?: Json; templates?: Json; types?: Json; periodicPlugin?: Json; corePlugins?: unknown }): VaultConfig {
  const a = files.app ?? {};
  const c: VaultConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  c.attachmentFolderPath = str(a.attachmentFolderPath, c.attachmentFolderPath);
  const lf = a.newLinkFormat;
  if (lf === 'shortest' || lf === 'relative' || lf === 'absolute') c.newLinkFormat = lf;
  c.useMarkdownLinks = bool(a.useMarkdownLinks, false);
  const nl = a.newFileLocation;
  if (nl === 'root' || nl === 'current' || nl === 'folder') c.newFileLocation = nl;
  c.newFileFolderPath = str(a.newFileFolderPath, '');
  const t = a.trashOption;
  if (t === 'system' || t === 'local' || t === 'none') c.trashOption = t;
  c.alwaysUpdateLinks = bool(a.alwaysUpdateLinks, true);
  c.showUnsupportedFiles = bool(a.showUnsupportedFiles, false);
  if (Array.isArray(a.userIgnoreFilters)) c.userIgnoreFilters = a.userIgnoreFilters.filter((x): x is string => typeof x === 'string');
  c.vimMode = bool(a.vimMode, false);
  c.spellcheck = bool(a.spellcheck, true);
  c.readableLineLength = bool(a.readableLineLength, true);
  c.livePreview = bool(a.livePreview, true);
  c.defaultViewMode = a.defaultViewMode === 'preview' ? 'preview' : 'source';
  c.foldHeading = bool(a.foldHeading, true);
  c.showLineNumber = bool(a.showLineNumber, false);
  const d = files.dailyNotes ?? {};
  c.periodic.day = { enabled: true, folder: str(d.folder, ''), format: str(d.format, '') || DEFAULT_FORMATS.day, template: str(d.template, '') };
  const p = files.periodicPlugin ?? {};
  for (const [key, period] of [['daily', 'day'], ['weekly', 'week'], ['monthly', 'month'], ['quarterly', 'quarter'], ['yearly', 'year']] as const) {
    const x = p[key] as Json | undefined;
    if (!x || typeof x !== 'object') continue;
    c.periodic[period] = { enabled: bool(x.enabled, period === 'day'), folder: str(x.folder, ''), format: str(x.format, '') || DEFAULT_FORMATS[period], template: str(x.template, '') };
  }
  const tp = files.templates ?? {};
  c.templates = { folder: str(tp.folder, ''), dateFormat: str(tp.dateFormat, '') || 'YYYY-MM-DD', timeFormat: str(tp.timeFormat, '') || 'HH:mm' };
  const ty = (files.types?.types ?? {}) as Json;
  for (const [k, v] of Object.entries(ty)) if (typeof v === 'string') c.types[k] = v;
  return c;
}

/** Where a new attachment pasted or dropped into `notePath` goes. */
export function attachmentFolder(cfg: VaultConfig, notePath: string): string {
  const a = cfg.attachmentFolderPath.trim();
  if (a === '/' || a === '') return '';
  if (a === './') return dirOf(notePath);
  if (a.startsWith('./')) return normPath(`${dirOf(notePath)}/${a.slice(2)}`);
  return normPath(a);
}

/** A free name for a new file: "Untitled.md", "Untitled 1.md", … */
export function freeName(exists: (p: string) => boolean, folder: string, base: string, ext: string): string {
  const join = (n: string) => (folder ? `${folder}/${n}` : n);
  let p = join(`${base}.${ext}`);
  for (let i = 1; exists(p); i++) p = join(`${base} ${i}.${ext}`);
  return p;
}

/** Where a new note goes for these settings (the folder of the open note when "current"). */
export function newNoteFolder(cfg: VaultConfig, activePath?: string): string {
  if (cfg.newFileLocation === 'current' && activePath) return dirOf(activePath);
  if (cfg.newFileLocation === 'folder') return normPath(cfg.newFileFolderPath);
  return '';
}

/** Files and folders the vault keeps for itself, never shown or indexed. */
export function isHidden(path: string, cfg?: VaultConfig): boolean {
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.'))) return true;
  for (const f of cfg?.userIgnoreFilters ?? []) {
    if (f.startsWith('/') && f.endsWith('/') && f.length > 2) {
      try { if (new RegExp(f.slice(1, -1)).test(path)) return true; } catch { /* bad pattern */ }
    } else if (path === f || path.startsWith(f.endsWith('/') ? f : `${f}/`)) return true;
  }
  return false;
}

export interface Bookmark {
  type: 'file' | 'folder' | 'search' | 'heading' | 'block' | 'group' | 'url' | 'graph';
  title?: string;
  path?: string;
  subpath?: string;
  query?: string;
  url?: string;
  ctime?: number;
  items?: Bookmark[];
}

/** bookmarks.json as written by vault tools (round-trips unknown fields). */
export function readBookmarks(json: unknown): Bookmark[] {
  const items = (json as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as Bookmark[]) : [];
}

export function writeBookmarks(items: Bookmark[], prev?: unknown): string {
  return JSON.stringify({ ...((prev && typeof prev === 'object') ? prev : {}), items }, null, 2);
}
