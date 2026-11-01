// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every notes app Keeper can connect to, what it can honestly do, where it
// works, and what it needs from you. No Node modules: the window shows these.

import type { Capability, ConnectorDef, ConnectorKind } from '../types';

export const CAPABILITY_LABEL: Record<Capability, string> = {
  'two-way': 'Two-way',
  'import-limited-write': 'Import + limited write-back',
  'import-only': 'Import only',
};

export const CAPABILITY_HELP: Record<Capability, string> = {
  'two-way': 'Changes go both ways once you turn on write-back.',
  'import-limited-write': 'Keeper copies everything in; only some changes can be sent back.',
  'import-only': 'Keeper copies notes in. Nothing is ever written to the app.',
};

export const CONNECTORS: ConnectorDef[] = [
  {
    kind: 'folder', name: 'Markdown or text folder', how: 'Reads and writes .md and .txt files in a folder',
    capability: 'two-way', hubFolder: 'Folders',
    fields: [{ key: 'path', label: 'Folder', type: 'folder', help: 'A notes vault, an outliner’s graph folder, or a folder of .txt notes.' }],
    limits: ['Works for any app that keeps notes as files (vaults, graphs, .txt folders).'],
  },
  {
    kind: 'joplin', name: 'Joplin', how: 'Through the Web Clipper service on this computer',
    capability: 'two-way', hubFolder: 'Joplin',
    fields: [
      { key: 'url', label: 'Address', type: 'url', placeholder: 'http://127.0.0.1:41184', optional: true },
      { key: 'token', label: 'Authorisation token', type: 'secret', help: 'In Joplin: Tools → Options → Web Clipper → Advanced options.' },
    ],
    limits: ['Joplin must be running with the Web Clipper service on.', 'Encrypted notebooks are read only after Joplin unlocks them.'],
  },
  {
    kind: 'joplin-files', name: 'Joplin sync folder', how: 'Reads a Joplin file-system or WebDAV sync folder, or a JEX export',
    capability: 'import-only', hubFolder: 'Joplin',
    fields: [{ key: 'path', label: 'Sync folder or .jex file', type: 'file' }],
    limits: ['Read only: Joplin itself writes this folder.', 'End-to-end encrypted items are skipped.'],
  },
  {
    kind: 'standardnotes', name: 'Standard Notes', how: 'Imports a backup file; the keys stay on this computer',
    capability: 'import-only', hubFolder: 'Standard Notes',
    fields: [
      { key: 'path', label: 'Backup file (.txt or .json)', type: 'file', help: 'In Standard Notes: Preferences → Backups → Download backup.' },
      { key: 'password', label: 'Password (only for an encrypted backup)', type: 'secret', optional: true },
      { key: 'server', label: 'Server (self-hosted)', type: 'url', placeholder: 'https://api.standardnotes.com', optional: true },
    ],
    limits: ['Signing in to the sync server is not built yet: use a backup file for now.', 'Encrypted backups are opened on this computer; your password is never sent anywhere.'],
  },
  {
    kind: 'notesnook', name: 'Notesnook', how: 'Imports a Notesnook export or backup',
    capability: 'import-only', hubFolder: 'Notesnook',
    fields: [{ key: 'path', label: 'Export folder or backup file', type: 'file', help: 'In Notesnook: Settings → Backup & export (Markdown, HTML or an unencrypted backup).' }],
    limits: ['There is no documented way to write notes back, so this is import only.', 'Encrypted backups cannot be opened.'],
  },
  {
    kind: 'onenote', name: 'OneNote', how: 'Through Microsoft Graph with a token you give',
    capability: 'two-way', hubFolder: 'OneNote',
    fields: [
      { key: 'token', label: 'Access token', type: 'secret', help: 'A Microsoft Graph token with Notes.ReadWrite.' },
      { key: 'section', label: 'Section for new notes (id)', type: 'text', optional: true },
    ],
    limits: ['Edits replace the first block of the page; drawings and ink are not copied.', 'Formatting may be simplified.'],
  },
  {
    kind: 'notion', name: 'Notion', how: 'Through Notion’s official API with an integration token',
    capability: 'two-way', hubFolder: 'Notion',
    fields: [
      { key: 'token', label: 'Integration token', type: 'secret', help: 'Make an internal integration and share the pages with it.' },
      { key: 'parent', label: 'Page for new notes (id)', type: 'text', optional: true },
    ],
    limits: ['Only pages shared with the integration are seen.', 'Databases, embeds and columns are simplified.'],
  },
  {
    kind: 'simplenote', name: 'Simplenote', how: 'Through Simplenote’s sync service with your sign-in',
    capability: 'two-way', hubFolder: 'Simplenote',
    fields: [
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'password', label: 'Password', type: 'secret' },
    ],
    limits: ['Simplenote notes are plain text; the first line is the title.'],
  },
  {
    kind: 'evernote', name: 'Evernote', how: 'Imports .enex exports; exports .enex to import back',
    capability: 'import-limited-write', hubFolder: 'Evernote',
    fields: [{ key: 'path', label: '.enex file or folder of them', type: 'file' }],
    limits: ['Write-back is by exporting an .enex file and importing it in Evernote.', 'Formatting may be simplified.'],
  },
  {
    kind: 'applenotes', name: 'Apple Notes', how: 'Through the Notes app’s scripting on this Mac',
    capability: 'two-way', platforms: ['darwin'], hubFolder: 'Apple Notes',
    fields: [{ key: 'account', label: 'Account (optional)', type: 'text', optional: true, placeholder: 'iCloud' }],
    limits: ['Needs a Mac. On iPhone only, use the Shortcut steps in Keeper.', 'Locked notes are skipped and shown as locked.', 'Formatting may be simplified.'],
  },
  {
    kind: 'bear', name: 'Bear', how: 'Reads Bear’s database; writes through bear:// links',
    capability: 'two-way', platforms: ['darwin'], hubFolder: 'Bear',
    fields: [],
    limits: ['Needs a Mac with Bear installed.', 'Writing opens Bear briefly.', 'Encrypted notes are skipped.'],
  },
  {
    kind: 'sticky', name: 'Sticky Notes (Windows)', how: 'Reads the Sticky Notes database',
    capability: 'import-limited-write', platforms: ['win32'], hubFolder: 'Sticky Notes',
    fields: [],
    limits: ['Read only by default.', 'Writes only while Sticky Notes is closed.'],
  },
  {
    kind: 'keep', name: 'Google Keep', how: 'Imports a Google Takeout export',
    capability: 'import-only', hubFolder: 'Google Keep',
    fields: [{ key: 'path', label: 'Takeout “Keep” folder', type: 'folder', help: 'From takeout.google.com, choose Keep only.' }],
    limits: ['Import only: there is no public way to write to Keep.'],
  },
  {
    kind: 'samsung', name: 'Samsung Notes', how: 'Imports notes you exported as text, HTML or Markdown',
    capability: 'import-only', hubFolder: 'Samsung Notes',
    fields: [{ key: 'path', label: 'Folder of exported notes', type: 'folder' }],
    limits: ['Import only. Export from Samsung Notes as text or Word first; PDF and .sdocx files are not read.'],
  },
  {
    kind: 'island', name: 'Keeper quick notes', how: 'The notes you jot in the Island',
    capability: 'two-way', hubFolder: 'Quick notes',
    fields: [],
    limits: [],
  },
];

export const connectorDef = (kind: ConnectorKind): ConnectorDef => CONNECTORS.find((c) => c.kind === kind) ?? CONNECTORS[0];

/** Can this connector run on this system? */
export function availableOn(def: ConnectorDef, platform: string): boolean {
  return !def.platforms?.length || def.platforms.includes(platform);
}

/** Formats each app can be exported to, so a note can go back into its app. */
export const EXPORT_FORMATS = [
  { id: 'markdown-zip', name: 'Markdown (.zip)', for: 'Any Markdown app, notes vaults, Bear' },
  { id: 'enex', name: 'Evernote (.enex)', for: 'Evernote, and apps that import .enex' },
  { id: 'jex', name: 'Joplin (.jex)', for: 'Joplin: File → Import → JEX' },
  { id: 'sn-json', name: 'Standard Notes backup (.json)', for: 'Standard Notes: Preferences → Backups → Import' },
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number]['id'];
