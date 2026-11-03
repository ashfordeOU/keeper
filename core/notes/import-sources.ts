// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The apps Notes can bring notes in from, and the few plain steps for each.
// No Node modules: the window shows this list.

export type ImportSourceId =
  | 'evernote' | 'joplin-jex' | 'joplin' | 'standardnotes' | 'notesnook' | 'keep' | 'simplenote'
  | 'bear' | 'bear-mac' | 'applenotes-export' | 'applenotes' | 'markdown' | 'notion' | 'onenote' | 'samsung';

export interface ImportField {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  placeholder?: string;
}

export interface ImportSource {
  id: ImportSourceId;
  /** the app, as people know it */
  name: string;
  /** what to choose: a file, a folder, either, nothing (read straight from the app) */
  pick: 'file' | 'folder' | 'either' | 'none';
  /** file endings offered in the file picker */
  accept?: string[];
  /** plain steps, one short sentence each */
  steps: string[];
  /** only on these systems */
  platforms?: string[];
  /** a sign-in or token the app needs */
  fields?: ImportField[];
  /** shown as a quiet note under the steps */
  note?: string;
}

export const IMPORT_SOURCES: ImportSource[] = [
  {
    id: 'markdown', name: 'Markdown folder or vault', pick: 'folder',
    steps: ['Choose the folder with your notes.', 'Notes, pictures and links are copied as they are.'],
    note: 'Works for vaults made by other notes apps, with their links and attachments.',
  },
  {
    id: 'evernote', name: 'Evernote', pick: 'either', accept: ['enex'],
    steps: ['In Evernote, open a notebook and choose Export notebook.', 'Pick ENEX as the format.', 'Choose the .enex file, or a folder of them.'],
  },
  {
    id: 'applenotes', name: 'Apple Notes', pick: 'none', platforms: ['darwin'],
    steps: ['Keep the Notes app open.', 'macOS asks once if Keeper may read Notes. Allow it.'],
    note: 'Locked notes stay locked and are skipped.',
  },
  {
    id: 'applenotes-export', name: 'Apple Notes export', pick: 'folder',
    steps: ['Export your notes as Markdown or HTML into a folder.', 'Choose that folder.'],
    note: 'For notes saved as files, for example from an iPhone Shortcut.',
  },
  {
    id: 'bear-mac', name: 'Bear', pick: 'none', platforms: ['darwin'],
    steps: ['Keep Bear installed on this Mac.', 'Keeper reads your notes from Bear.'],
    note: 'Encrypted notes are skipped.',
  },
  {
    id: 'bear', name: 'Bear export', pick: 'folder',
    steps: ['In Bear, select notes and choose File → Export Notes.', 'Pick Markdown or TextBundle with attachments.', 'Choose the folder you exported to.'],
  },
  {
    id: 'joplin-jex', name: 'Joplin export', pick: 'either', accept: ['jex'],
    steps: ['In Joplin, choose File → Export all → JEX.', 'Choose the .jex file, or a Joplin sync folder.'],
  },
  {
    id: 'joplin', name: 'Joplin (running)', pick: 'none',
    steps: ['In Joplin, turn on Tools → Options → Web Clipper.', 'Copy the token from Advanced options.', 'Paste it here.'],
    fields: [{ key: 'token', label: 'Token', secret: true }, { key: 'url', label: 'Address', optional: true, placeholder: 'http://127.0.0.1:41184' }],
  },
  {
    id: 'standardnotes', name: 'Standard Notes backup', pick: 'file', accept: ['txt', 'json'],
    steps: ['In Standard Notes, open Preferences → Backups.', 'Download a backup.', 'Choose the backup file.'],
    fields: [{ key: 'password', label: 'Password, only for an encrypted backup', secret: true, optional: true }],
    note: 'An encrypted backup is opened on this computer. The password is never sent.',
  },
  {
    id: 'notesnook', name: 'Notesnook', pick: 'either', accept: ['zip', 'json', 'nnbackup', 'md', 'html'],
    steps: ['In Notesnook, open Settings → Backup & export.', 'Export as Markdown, or make an unencrypted backup.', 'Choose the file or folder.'],
  },
  {
    id: 'keep', name: 'Google Keep', pick: 'either', accept: ['zip'],
    steps: ['At takeout.google.com, choose only Keep.', 'Download and unzip the export, or keep the .zip.', 'Choose the Keep folder or the .zip.'],
  },
  {
    id: 'simplenote', name: 'Simplenote', pick: 'either', accept: ['zip', 'json'],
    steps: ['In Simplenote, choose File → Export Notes.', 'Choose the .zip, or the notes.json inside it.'],
  },
  {
    id: 'notion', name: 'Notion', pick: 'none',
    steps: ['At notion.so/my-integrations, make an internal integration.', 'Share the pages you want with it.', 'Paste its token here.'],
    fields: [{ key: 'token', label: 'Integration token', secret: true }],
    note: 'Databases and columns are simplified.',
  },
  {
    id: 'onenote', name: 'OneNote', pick: 'none',
    steps: ['Get a Microsoft Graph token that can read notes.', 'Paste it here.'],
    fields: [{ key: 'token', label: 'Access token', secret: true }],
    note: 'Drawings and ink are not copied.',
  },
  {
    id: 'samsung', name: 'Samsung Notes', pick: 'folder',
    steps: ['In Samsung Notes, share notes as text or a Word-like file to a folder.', 'Choose that folder.'],
  },
];

export const importSource = (id: string): ImportSource | undefined => IMPORT_SOURCES.find((s) => s.id === id);

export const availableHere = (s: ImportSource, platform: string): boolean => !s.platforms?.length || s.platforms.includes(platform);

/** What a finished import reports (and what Undo needs). */
export interface ImportSummary {
  job: string;
  source: ImportSourceId;
  /** the vault folder the notes went into */
  folder: string;
  notes: number;
  attachments: number;
  skipped: { title: string; why: string }[];
  /** stopped part way by Cancel */
  cancelled?: boolean;
  at: number;
}

export interface ImportProgress {
  job: string;
  phase: 'reading' | 'writing' | 'done' | 'error';
  done: number;
  total: number;
  message?: string;
}

export type ExportFormat = 'markdown' | 'zip' | 'enex' | 'html' | 'pdf';

export const EXPORT_CHOICES: { id: ExportFormat; name: string; help: string; one?: boolean }[] = [
  { id: 'markdown', name: 'Markdown folder', help: 'Plain files with their pictures, for any notes app.' },
  { id: 'zip', name: 'Whole vault as .zip', help: 'Everything in one file, to keep or move.' },
  { id: 'enex', name: 'Evernote file (.enex)', help: 'For apps that import .enex.' },
  { id: 'html', name: 'Web page (.html)', help: 'One file with its pictures inside.', one: true },
  { id: 'pdf', name: 'PDF', help: 'Ready to print or send.', one: true },
];
