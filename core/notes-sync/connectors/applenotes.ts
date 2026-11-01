// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Apple Notes on a Mac, through the Notes app's own scripting (JavaScript for
// Automation run by osascript): list folders and notes, read each body as
// HTML, create and update. Locked notes are never read: they are listed as
// locked. Formatting is converted to Markdown and may be simplified.
// On an iPhone without a Mac, a Shortcut can export notes to a folder Keeper
// reads (see shortcutSteps).

import { htmlToMarkdown, markdownToHtml } from '../markdown';
import type { RemoteNote } from '../types';

export interface AppleNoteRow {
  id: string;
  name: string;
  body: string | null;
  created: number;
  modified: number;
  folder: string;
  account: string;
  locked: boolean;
}

/** JXA that prints every note as JSON (bodies of locked notes are not read). */
export function listScript(account?: string): string {
  return `
const Notes = Application('Notes');
const out = [];
const want = ${JSON.stringify(account ?? '')};
for (const acc of Notes.accounts()) {
  const an = acc.name();
  if (want && an !== want) continue;
  for (const f of acc.folders()) {
    const fn = f.name();
    if (fn === 'Recently Deleted') continue;
    const notes = f.notes;
    const ids = notes.id(), names = notes.name(), cr = notes.creationDate(), md = notes.modificationDate(), locked = notes.passwordProtected();
    for (let i = 0; i < ids.length; i++) {
      out.push({ id: ids[i], name: names[i], created: cr[i].getTime(), modified: md[i].getTime(), folder: fn, account: an, locked: !!locked[i], body: locked[i] ? null : notes[i].body() });
    }
  }
}
JSON.stringify(out);`;
}

/** JXA that creates a note in a folder (made if missing) and prints its id. */
export function createScript(folder: string, html: string, account?: string): string {
  return `
const Notes = Application('Notes');
const accs = Notes.accounts().filter((a) => !${JSON.stringify(account ?? '')} || a.name() === ${JSON.stringify(account ?? '')});
const acc = accs[0] || Notes.defaultAccount();
const want = ${JSON.stringify(folder || 'Notes')};
let f = acc.folders().find((x) => x.name() === want);
if (!f) { f = Notes.Folder({ name: want }); acc.folders.push(f); }
const n = Notes.Note({ body: ${JSON.stringify(html)} });
f.notes.push(n);
JSON.stringify({ id: n.id(), modified: n.modificationDate().getTime() });`;
}

/** JXA that replaces a note's body (refuses locked notes) and prints its new time. */
export function updateScript(id: string, html: string): string {
  return `
const Notes = Application('Notes');
const n = Notes.notes.byId(${JSON.stringify(id)});
if (n.passwordProtected()) throw new Error('locked');
n.body = ${JSON.stringify(html)};
JSON.stringify({ modified: n.modificationDate().getTime() });`;
}

/** JXA that moves a note to Recently Deleted. */
export function deleteScript(id: string): string {
  return `Application('Notes').notes.byId(${JSON.stringify(id)}).delete(); 'ok';`;
}

/** A Notes body: the first line is the title, shown big. */
export function appleBodyFor(title: string, md: string): string {
  return `<div><h1>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h1></div>${markdownToHtml(md, { flavour: 'apple' })}`;
}

/** Notes app rows → notes. The title line is taken off the body. */
export function fromAppleRows(rows: AppleNoteRow[]): RemoteNote[] {
  return rows.map((r) => {
    const folder = `${r.account}/${r.folder}`;
    if (r.locked || r.body === null) return { sourceId: r.id, title: r.name || 'Locked note', body: '', tags: [], created: r.created, modified: r.modified, folder, locked: true, version: String(r.modified) };
    let md = htmlToMarkdown(r.body);
    const first = md.split('\n')[0].replace(/^#+\s*/, '').trim();
    if (first && first === (r.name ?? '').trim()) md = md.slice(md.indexOf('\n') + 1).replace(/^\n+/, '');
    else if (md.split('\n')[0] === first && first) md = md.slice(md.indexOf('\n') + 1).replace(/^\n+/, '');
    return { sourceId: r.id, title: r.name || first || 'Untitled', body: md, tags: [], created: r.created, modified: r.modified, folder, version: String(r.modified) };
  });
}

/** For an iPhone without a Mac: a Shortcut that saves every note as a file Keeper reads. */
export function shortcutSteps(folderHint: string): { title: string; steps: string[]; note: string } {
  return {
    title: 'Copy your iPhone notes into Keeper',
    steps: [
      'Open the Shortcuts app and make a new shortcut.',
      'Add “Find Notes” (leave it on “All Notes”).',
      'Add “Repeat with Each” for the notes.',
      'Inside it, add “Get Name” and “Make Rich Text from…”, then “Make Markdown from Rich Text”.',
      'Add “Save File”, turn off “Ask Where to Save”, and choose a folder in iCloud Drive (for example “Keeper Notes Inbox”). Name the file with the note’s name and “.md”.',
      `On your computer, connect that folder in Keeper as a Markdown folder (${folderHint}).`,
      'Run the shortcut whenever you want a fresh copy, or add it to an automation.',
    ],
    note: 'This copies notes one way, from the iPhone. Locked notes are not included.',
  };
}
