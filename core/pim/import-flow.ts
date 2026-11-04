// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The one Import flow of Mail, Calendar, Reminders and Contacts: the places
// you can bring things in from, the plain steps for each, and the shapes of a
// running import, its summary and its undo. The same in every part.

export type ImportArea = 'mail' | 'calendar' | 'reminders' | 'contacts';

export type ImportSourceId =
  | 'mbox' | 'eml' | 'apple-mail' | 'thunderbird' | 'olm' | 'pst'
  | 'ics'
  | 'apple-reminders' | 'google-tasks' | 'ms-todo' | 'todoist' | 'tasks-csv' | 'tasks-ics'
  | 'vcf' | 'contacts-csv';

export interface ImportSourceInfo {
  id: ImportSourceId;
  area: ImportArea;
  /** what people call it (no product names of other companies' apps unless it is the file they have) */
  label: string;
  /** one short line under the label */
  hint: string;
  icon: string;
  /** how the thing to import is chosen */
  pick: 'file' | 'folder' | 'found' | 'signin' | 'token';
  /** file types the picker offers */
  extensions?: string[];
  /** plain steps, shown before choosing (at most four short lines) */
  steps: string[];
  /** works only on these systems */
  platforms?: NodeJS.Platform[];
  /** cannot be read (yet): the reason, shown instead of the steps */
  unavailable?: string;
}

export const IMPORT_SOURCES: ImportSourceInfo[] = [
  { id: 'mbox', area: 'mail', label: 'Mailbox file (.mbox)', hint: 'Any mail app’s export or a mail download', icon: 'archive', pick: 'file', extensions: ['mbox', 'mbx', 'mbs', ''], steps: ['In your old mail app, export the folders you want as .mbox files.', 'For a whole web mail account, download your data and pick the .mbox file it gives you.', 'Choose the files here. Each one becomes a folder.'] },
  { id: 'eml', area: 'mail', label: 'Message files (.eml)', hint: 'Single messages or a folder of them', icon: 'mail', pick: 'folder', extensions: ['eml', 'emlx', 'msg'], steps: ['Drag messages out of your old mail app into a folder, or save them as .eml files.', 'Choose the folder here. Sub-folders stay as they are.'] },
  { id: 'apple-mail', area: 'mail', label: 'Apple Mail on this Mac', hint: 'Every mailbox kept on this Mac', icon: 'mail', pick: 'found', platforms: ['darwin'], steps: ['Keeper reads Mail’s own folder and changes nothing in it.', 'macOS may ask you to allow Full Disk Access for Keeper first.', 'Each mailbox becomes a folder under “Apple Mail”.'] },
  { id: 'thunderbird', area: 'mail', label: 'Thunderbird', hint: 'Profiles found on this computer', icon: 'mail', pick: 'found', steps: ['Close Thunderbird first, so its files are complete.', 'Pick a profile. Local Folders and the mail it kept from your accounts come in.', 'Each mailbox becomes a folder under “Thunderbird”.'] },
  { id: 'olm', area: 'mail', label: 'Outlook for Mac archive (.olm)', hint: 'File → Export in Outlook for Mac', icon: 'archive', pick: 'file', extensions: ['olm'], steps: ['In Outlook for Mac choose File → Export and keep “Mail” ticked.', 'Choose the .olm file here. Folders and attachments come along.'] },
  { id: 'pst', area: 'mail', label: 'Outlook for Windows (.pst)', hint: 'Not read yet', icon: 'archive', pick: 'file', extensions: ['pst'], steps: [], unavailable: 'Keeper can’t read .pst files yet. In Outlook, export to .mbox with a free converter, or add the account itself: its mail comes from the server.' },

  { id: 'ics', area: 'calendar', label: 'Calendar file (.ics)', hint: 'From any calendar app', icon: 'calendar', pick: 'file', extensions: ['ics', 'ical', 'icalendar', 'ifb'], steps: ['In your old calendar, export or share the calendar as an .ics file.', 'Choose it here. Repeats, exceptions, time zones and alerts come along.', 'It becomes a calendar of its own, so it is easy to take back.'] },

  { id: 'apple-reminders', area: 'reminders', label: 'Apple Reminders', hint: 'Every list on this Mac', icon: 'check', pick: 'found', platforms: ['darwin'], steps: ['macOS asks once whether Keeper may read Reminders.', 'Lists become tags; due dates, repeats and priorities come along.'] },
  { id: 'google-tasks', area: 'reminders', label: 'Google Tasks', hint: 'Sign in to read your lists', icon: 'globe', pick: 'signin', steps: ['Your browser opens to sign in. Keeper asks only to read your tasks.', 'Sub-tasks become steps; each list becomes a tag.', 'The sign-in is used once and not kept.'] },
  { id: 'ms-todo', area: 'reminders', label: 'Microsoft To Do', hint: 'Sign in to read your lists', icon: 'globe', pick: 'signin', steps: ['Your browser opens to sign in. Keeper asks only to read your tasks.', 'Checklist items become steps; repeats and importance come along.', 'The sign-in is used once and not kept.'] },
  { id: 'todoist', area: 'reminders', label: 'Todoist', hint: 'A CSV or backup file, or your API token', icon: 'check', pick: 'token', extensions: ['csv', 'json', 'zip'], steps: ['Choose a project’s CSV file or a backup file, or paste your API token from Todoist’s settings (Integrations).', 'Projects become tags; sub-tasks become steps.', 'A token is used once and not kept.'] },
  { id: 'tasks-csv', area: 'reminders', label: 'Spreadsheet (.csv)', hint: 'Any app’s task list as CSV', icon: 'table', pick: 'file', extensions: ['csv', 'tsv', 'txt'], steps: ['Save your list as CSV with a header row.', 'Keeper finds the title, notes, due date, priority, list and done columns by name.'] },
  { id: 'tasks-ics', area: 'reminders', label: 'Task file (.ics)', hint: 'To-dos from a calendar app', icon: 'calendar', pick: 'file', extensions: ['ics', 'ical'], steps: ['Export the task list from your calendar app as .ics.', 'Due dates, repeats, priorities and sub-tasks come along.'] },

  { id: 'vcf', area: 'contacts', label: 'Contact cards (.vcf)', hint: 'From any address book', icon: 'person', pick: 'file', extensions: ['vcf', 'vcard'], steps: ['Export your contacts as vCard (.vcf) from your address book.', 'Choose the file here. Pictures inside the cards come along.'] },
  { id: 'contacts-csv', area: 'contacts', label: 'Spreadsheet (.csv)', hint: 'A web mail’s or desktop app’s export', icon: 'table', pick: 'file', extensions: ['csv'], steps: ['Export your contacts as CSV.', 'Keeper finds names, addresses, phones and companies by column name.'] },
];

/** The sources offered in one part, on this system (others' unavailable reason kept). */
export function sourcesFor(area: ImportArea, platform: NodeJS.Platform): ImportSourceInfo[] {
  return IMPORT_SOURCES.filter((s) => s.area === area).map((s) => (s.platforms && !s.platforms.includes(platform) ? { ...s, unavailable: s.unavailable ?? 'Only on a Mac.' } : s));
}

/** Something found on this computer to import (a Thunderbird profile, Apple Mail's store). */
export interface FoundSource {
  source: ImportSourceId;
  /** where it is (a path), handed back to the import */
  ref: string;
  label: string;
  detail?: string;
}

export interface ImportRequest {
  source: ImportSourceId;
  /** files or folders chosen, or a found source's ref */
  paths?: string[];
  /** Todoist API token (used once, never kept) */
  token?: string;
  /** calendar: into this calendar instead of a new one */
  calendar?: string;
}

export interface ImportProgress {
  id: string;
  source: ImportSourceId;
  phase: 'reading' | 'adding' | 'done' | 'cancelled' | 'failed';
  done: number;
  /** unknown while still counting */
  total?: number;
  /** what is being read now (a folder or file name) */
  current?: string;
}

export interface ImportResult {
  id: string;
  area: ImportArea;
  source: ImportSourceId;
  /** "Thunderbird · default profile" */
  label: string;
  at: number;
  added: number;
  skipped: number;
  failed: number;
  folders: number;
  /** one short line ("1,204 messages in 6 folders · 3 already here") */
  summary: string;
  cancelled?: boolean;
  /** where to look: a mail folder (account:path), a calendar id */
  open?: string;
  undone?: boolean;
  /** what is needed to take it back (kept in the main process) */
  undo?: ImportUndo;
  /** notes for the person (a file that could not be read, attachments kept apart) */
  notes?: string[];
}

export type ImportUndo =
  | { kind: 'mail'; account: string; added: { folder: string; uids: number[] }[]; folders: string[] }
  | { kind: 'calendar'; calendar: string; created: boolean; uids: string[] }
  | { kind: 'reminders'; ids: string[] }
  | { kind: 'contacts'; ids: string[] };

/** The words for what an area imports. */
export const AREA_NOUN: Record<ImportArea, string> = { mail: 'message', calendar: 'event', reminders: 'task', contacts: 'contact' };

/** The steps of the flow, for the step dots (choose → steps → progress → summary). */
export const FLOW_STEPS = ['Choose', 'Get ready', 'Importing', 'Done'] as const;

/** A percentage for the bar (0–100), or undefined while the total is unknown. */
export function percent(p: Pick<ImportProgress, 'done' | 'total'>): number | undefined {
  if (!p.total) return undefined;
  return Math.max(0, Math.min(100, Math.round((p.done / p.total) * 100)));
}
