// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Notes Everywhere: the hub of notes from every notes app.

import { ipcMain } from 'electron';
import type { NoteSyncApi } from '../../core/api-notesync';
import { registerFindings } from '../services/guide';
import { notesApi, notesFindings, startNotes, type NotesDeps } from '../services/notes-sync';

export const NOTESYNC_METHODS = Object.keys(notesApi) as (keyof NoteSyncApi)[];

export async function registerNotesyncIpc(d: NotesDeps) {
  for (const m of NOTESYNC_METHODS) {
    ipcMain.handle(`notesync.${m}`, async (_e, ...args) => (notesApi[m] as (...a: unknown[]) => unknown)(...args));
  }
  registerFindings('notes', () => notesFindings());
  await startNotes(d);
}
