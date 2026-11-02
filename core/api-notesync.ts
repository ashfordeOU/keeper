// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notes Everywhere, as the window sees it: one hub of notes copied from every
// notes app, connectors with honest abilities, a dry run before the first
// sync, conflicts and duplicates to review, backups and exports.

import type { ExportFormat } from './notes-sync/connectors/registry';
import type { Capability, ConnectorKind, HistoryEntry, PlanAction, PlanCounts } from './notes-sync/types';
import type { IslandNotesView } from './island-tools/note-sources';

export type { Capability, ConnectorKind, ExportFormat, HistoryEntry, PlanAction, PlanCounts };

export interface ConnectorView {
  id: string;
  kind: ConnectorKind;
  label: string;
  /** the app's name */
  app: string;
  capability: Capability;
  enabled: boolean;
  /** send Keeper's changes back to the app */
  writeBack: boolean;
  /** also copy hub notes that are not in this app yet */
  pushNew: boolean;
  /** settings you gave (secrets are never shown, only whether they are set) */
  fields: Record<string, string>;
  secretsSet: string[];
  /** can run on this computer */
  available: boolean;
  state: 'idle' | 'syncing' | 'error' | 'needs-review' | 'unavailable';
  message?: string;
  notes: number;
  locked: number;
  lastSync?: number;
  /** a dry run was reviewed: syncing is allowed */
  reviewed: boolean;
  /** minutes between automatic syncs (0: only when you press Sync) */
  everyMin: number;
}

export interface NotesOverview {
  hubFolder: string;
  notes: number;
  apps: number;
  conflicts: number;
  duplicates: number;
  trash: number;
  lastSnapshot?: number;
  snapshots: number;
  connectors: ConnectorView[];
  /** the hub folder is shared with your other devices through Sync */
  devices: { on: boolean; folderId?: string; peers: number; message?: string };
  /** automatic syncing is switched on in Settings → Features */
  autoSync: boolean;
  platform: string;
}

export interface PlanItemView {
  action: PlanAction;
  keeperId?: string;
  sourceId?: string;
  title: string;
  why: string;
  duplicateOf?: string;
  needsConfirm?: boolean;
}

export interface SyncPlanView {
  connector: string;
  made: number;
  summary: string;
  counts: PlanCounts;
  items: PlanItemView[];
  /** e.g. an encrypted backup that needs its password */
  needs?: 'password' | 'path' | 'token';
  message?: string;
}

export interface SyncResultView {
  connector: string;
  summary: string;
  done: Partial<PlanCounts>;
  errors: string[];
}

export interface NoteHit {
  keeperId: string;
  title: string;
  snippet: string;
  tags: string[];
  apps: ConnectorKind[];
  modified: number;
  locked?: boolean;
  path: string;
}

export interface NoteLocation {
  connector: string;
  app: ConnectorKind;
  appName: string;
  label: string;
  id: string;
  folder?: string;
  synced?: number;
  /** the app has text Keeper has not merged yet, or the other way round */
  inStep: boolean;
}

export interface NoteDetail {
  keeperId: string;
  title: string;
  body: string;
  tags: string[];
  created: number;
  modified: number;
  locked?: boolean;
  path: string;
  where: NoteLocation[];
  history: HistoryEntry[];
  attachments: { name: string; path: string }[];
}

export interface ConflictView {
  id: string;
  keeperId: string;
  copyId: string;
  connector: string;
  app: ConnectorKind;
  appName: string;
  title: string;
  at: number;
  base: string;
  mine: string;
  theirs: string;
  rows: { l?: string; r?: string; kind: 'same' | 'changed' | 'left' | 'right' }[];
}

export interface DuplicateView {
  id: string;
  score: number;
  notes: { keeperId: string; title: string; apps: ConnectorKind[]; snippet: string; modified: number }[];
}

export interface TrashedNoteView {
  id: string;
  keeperId: string;
  title: string;
  at: number;
  why: string;
  apps: ConnectorKind[];
}

export interface SnapshotView {
  id: string;
  time: number;
  files: number;
  label?: string;
  added: number;
  changed: number;
  removed: number;
}

export interface NoteSyncApi {
  overview(): Promise<NotesOverview>;
  setOptions(patch: { hubFolder?: string }): Promise<NotesOverview>;
  addConnector(input: { kind: ConnectorKind; label?: string; fields?: Record<string, string>; secrets?: Record<string, string> }): Promise<NotesOverview>;
  updateConnector(id: string, patch: { enabled?: boolean; writeBack?: boolean; pushNew?: boolean; label?: string; fields?: Record<string, string>; secrets?: Record<string, string>; everyMin?: number }): Promise<NotesOverview>;
  removeConnector(id: string): Promise<NotesOverview>;
  test(id: string): Promise<{ ok: boolean; message: string }>;
  /** the dry run: what a sync would do, changing nothing */
  plan(id: string): Promise<SyncPlanView>;
  /** carries out a fresh plan; the first sync of a connector needs a reviewed dry run */
  sync(id: string, opts?: { confirmDeletes?: string[] }): Promise<SyncResultView>;
  search(q: string, opts?: { tag?: string; app?: ConnectorKind; limit?: number }): Promise<NoteHit[]>;
  tags(): Promise<{ tag: string; count: number; apps: ConnectorKind[] }[]>;
  note(keeperId: string): Promise<NoteDetail | null>;
  /** a new note (keeperId null) or an edit, saved in the hub */
  saveNote(keeperId: string | null, note: { title: string; body: string; tags?: string[] }): Promise<NoteDetail>;
  /** copy (or move) notes into another app */
  copyTo(keeperIds: string[], connectorId: string, move?: boolean): Promise<{ done: number; skipped: number; message: string }>;
  /** every note of one app into another */
  migrate(fromConnector: string, toConnector: string): Promise<{ done: number; skipped: number; message: string }>;
  conflicts(): Promise<ConflictView[]>;
  resolveConflict(id: string, keep: 'mine' | 'theirs' | 'both' | 'merged', merged?: string): Promise<void>;
  duplicates(): Promise<DuplicateView[]>;
  resolveDuplicate(id: string, action: 'link' | 'merge' | 'ignore', keepId?: string): Promise<void>;
  trash(): Promise<TrashedNoteView[]>;
  restore(trashId: string): Promise<void>;
  snapshots(): Promise<SnapshotView[]>;
  snapshotNow(label?: string): Promise<SnapshotView | null>;
  restoreSnapshot(id: string, paths?: string[]): Promise<{ restored: number }>;
  exportAs(format: ExportFormat, opts?: { keeperIds?: string[]; target?: string }): Promise<{ path: string; notes: number }>;
  history(keeperId?: string): Promise<HistoryEntry[]>;
  /** share the hub folder with your other devices through Sync */
  shareWithDevices(on: boolean, devices?: string[]): Promise<NotesOverview>;
  /** steps for copying iPhone notes without a Mac */
  shortcutGuide(): Promise<{ title: string; steps: string[]; note: string }>;
  /**
   * For the Island's Notes tab, light (no app is asked, only the notes folder is
   * read): whether the hub is on, the connected apps, and the hub's notes matching `q`.
   */
  islandNotes(q?: string, limit?: number): Promise<IslandNotesView>;
}
