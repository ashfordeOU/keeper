// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's Notes tab lists Keeper's own quick notes and, from Notes
// Everywhere (the notes hub), the notes of every connected notes app: Apple
// Notes first on a Mac, then the others. This groups and searches them, and
// says which one row to show when Apple Notes is not there yet (the hub
// switched off, Apple Notes not connected, Automation not allowed, the first
// copy not made). Pure.

import type { ConnectorKind } from '../notes-sync/types';
import { searchNotes, type QuickNote } from './notes';

/** A hub note as the Island lists it (the hub's search answer). */
export interface HubNoteItem {
  keeperId: string;
  title: string;
  snippet: string;
  tags: string[];
  apps: ConnectorKind[];
  modified: number;
  locked?: boolean;
}

/** One connected notes app, as the Island needs it. */
export interface IslandNoteSource {
  id: string;
  kind: ConnectorKind;
  app: string;
  enabled: boolean;
  available: boolean;
  /** a dry run was looked at (syncing is allowed) */
  reviewed: boolean;
  state: 'idle' | 'syncing' | 'error' | 'needs-review' | 'unavailable';
  message?: string;
  notes: number;
  lastSync?: number;
}

/** What the Island asks the hub for (notesync.islandNotes). */
export interface IslandNotesView {
  /** the Notes Everywhere feature is on */
  hubOn: boolean;
  platform: string;
  sources: IslandNoteSource[];
  hits: HubNoteItem[];
}

export type NoteGroupId = 'keeper' | ConnectorKind | 'hub';

export interface NoteGroup {
  id: NoteGroupId;
  label: string;
  local?: QuickNote[];
  hub?: HubNoteItem[];
  /** the connection behind the group (to update it, or say when it was last read) */
  source?: IslandNoteSource;
}

const APP_NAMES: Partial<Record<ConnectorKind, string>> = {
  applenotes: 'Apple Notes', bear: 'Bear', joplin: 'Joplin', 'joplin-files': 'Joplin', standardnotes: 'Standard Notes', 'standardnotes-sync': 'Standard Notes',
  notesnook: 'Notesnook', onenote: 'OneNote', notion: 'Notion', simplenote: 'Simplenote', evernote: 'Evernote', sticky: 'Sticky Notes', keep: 'Google Keep', samsung: 'Samsung Notes', folder: 'Markdown folder',
};

export const appLabel = (k: ConnectorKind) => APP_NAMES[k] ?? k;

/** Every word in the title, snippet or a tag (the hub's own search also looks in the whole text). */
export function hitMatches(h: HubNoteItem, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${h.title}\n${h.snippet}\n${h.tags.join(' ')}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The app a hub note is listed under: Apple Notes first on a Mac; Keeper's own quick notes are listed as Keeper's. */
function homeOf(apps: ConnectorKind[], platform: string): NoteGroupId | null {
  const others = apps.filter((a) => a !== 'island');
  if (!others.length) return apps.includes('island') ? null : 'hub';
  if (platform === 'darwin' && others.includes('applenotes')) return 'applenotes';
  return others[0];
}

/**
 * Groups for the list: Keeper's own notes first, then Apple Notes (on a Mac),
 * then the other apps by name, then notes only in the hub folder. With a
 * search, only matching notes; groups left empty are dropped, except Keeper's
 * own (it holds Today) and the group of an app that is connected.
 */
export function groupNotes(input: {
  local: QuickNote[];
  hits: HubNoteItem[];
  sources?: IslandNoteSource[];
  platform: string;
  q?: string;
  /** the search the hits already answer (the hub looked in their whole text): they are not filtered again */
  hitsQuery?: string;
}): NoteGroup[] {
  const q = input.q ?? '';
  const groups: NoteGroup[] = [{ id: 'keeper', label: 'Keeper', local: searchNotes(input.local, q) }];
  const by = new Map<NoteGroupId, HubNoteItem[]>();
  const seen = new Set<string>();
  for (const h of input.hits) {
    if (seen.has(h.keeperId) || (input.hitsQuery?.trim().toLowerCase() !== q.trim().toLowerCase() && !hitMatches(h, q))) continue;
    seen.add(h.keeperId);
    const home = homeOf(h.apps, input.platform);
    if (!home) continue;
    by.set(home, [...(by.get(home) ?? []), h]);
  }
  const sources = (input.sources ?? []).filter((s) => s.enabled && s.kind !== 'island');
  const ids = new Set<NoteGroupId>([...by.keys(), ...sources.filter((s) => s.available).map((s) => s.kind as NoteGroupId)]);
  const order = [...ids].filter((k) => k !== 'hub').sort((a, b) => {
    if (input.platform === 'darwin') {
      if (a === 'applenotes') return -1;
      if (b === 'applenotes') return 1;
    }
    return appLabel(a as ConnectorKind).localeCompare(appLabel(b as ConnectorKind));
  });
  for (const k of order) {
    const items = (by.get(k) ?? []).sort((a, b) => b.modified - a.modified);
    const source = sources.find((s) => s.kind === k);
    if (!items.length && (q || !source)) continue;
    groups.push({ id: k, label: appLabel(k as ConnectorKind), hub: items, source });
  }
  const loose = by.get('hub');
  if (loose?.length) groups.push({ id: 'hub', label: 'Notes Everywhere', hub: loose.sort((a, b) => b.modified - a.modified) });
  return groups;
}

// ---------------------------------------------------------------- the one row about Apple Notes

export const MAC_AUTOMATION_PRIVACY = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';

export interface NotesSetupRow {
  title: string;
  detail: string;
  /**
   * enableHub: switch Notes Everywhere on; connect: add Apple Notes and look at what
   * would be copied (macOS asks whether Keeper may control Notes the first time);
   * review: look at what would be copied; settings: open Privacy & Security → Automation;
   * retry: ask Notes again
   */
  action: 'enableHub' | 'connect' | 'review' | 'settings';
  label: string;
  settingsUrl?: string;
  /** a second button: try again after changing the setting */
  retry?: boolean;
}

const automationRefused = (m?: string) => !!m && /automation|not allowed|-1743|not authori[sz]ed/i.test(m);

/** The row above the list when Apple Notes (or, off a Mac, other apps' notes) is not shown yet; null when all is well. */
export function notesSetupRow(v: Pick<IslandNotesView, 'hubOn' | 'platform' | 'sources'> | null): NotesSetupRow | null {
  if (!v) return null;
  const mac = v.platform === 'darwin';
  if (!v.hubOn) {
    return mac
      ? { title: 'Show your Apple Notes here', detail: 'Notes Everywhere is switched off. Turn it on to see Apple Notes and your other notes apps beside Keeper’s notes.', action: 'enableHub', label: 'Turn on' }
      : { title: 'Show notes from your other apps here', detail: 'Notes Everywhere is switched off. Turn it on to see the notes of your other notes apps beside Keeper’s notes.', action: 'enableHub', label: 'Turn on' };
  }
  if (!mac) return null;
  const apple = v.sources.find((s) => s.kind === 'applenotes');
  if (!apple) return { title: 'Show your Apple Notes here', detail: 'Keeper reads Apple Notes through the Notes app. macOS asks once whether Keeper may control Notes; nothing in Notes is changed.', action: 'connect', label: 'Allow' };
  if (!apple.enabled) return null;
  if (automationRefused(apple.message) && apple.state === 'error') {
    return { title: 'Keeper isn’t allowed to read Apple Notes', detail: 'Turn on Notes under Keeper in System Settings → Privacy & Security → Automation, then try again.', action: 'settings', label: 'Open Privacy Settings', settingsUrl: MAC_AUTOMATION_PRIVACY, retry: true };
  }
  if (!apple.reviewed) return { title: 'Show your Apple Notes here', detail: 'See what Keeper would copy from Apple Notes into its notes folder before anything is copied. Nothing in Notes is changed.', action: 'review', label: 'Look' };
  return null;
}
