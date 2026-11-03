// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for typed snippets (electron/services/snippets.ts) and the selection
// bar (electron/services/selection-bar.ts).

import { BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fsp } from 'node:fs';
import { renderSnippet, snippetsFromCsv, snippetsToCsv } from '../../core/typing/expand';
import type { SelectionActionId } from '../../core/selection';
import { readText } from '../services/clip';
import { restartSnippets, snippetsStatus } from '../services/snippets';
import { selectionClose, selectionCopy, selectionCurrent, selectionReplace, selectionResize, selectionRun, showSelectionBar } from '../services/selection-bar';
import { saveVoiceSettings, voiceSettings } from '../services/voice/store';

const newId = () => Math.random().toString(36).slice(2, 10);

export function registerTypingIpc() {
  const h = (name: string, fn: (...args: never[]) => unknown) => ipcMain.handle(name, (_e, ...args) => fn(...(args as never[])));

  h('snippets.status', () => snippetsStatus());
  h('snippets.restart', () => restartSnippets());
  h('snippets.preview', async (text: string) => renderSnippet(String(text ?? ''), { now: new Date(), clipboard: await readText(), snippets: voiceSettings().snippets }).text);
  h('snippets.importCsv', async () => {
    const opts = { properties: ['openFile' as const], filters: [{ name: 'Snippets (CSV)', extensions: ['csv', 'txt'] }] };
    const w = BrowserWindow.getFocusedWindow();
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    const text = await fsp.readFile(r.filePaths[0], 'utf8');
    const cur = voiceSettings().snippets;
    const { added, skipped } = snippetsFromCsv(text, cur, newId);
    if (added.length) await saveVoiceSettings({ snippets: [...cur, ...added] });
    return { added: added.length, skipped };
  });
  h('snippets.exportCsv', async () => {
    const list = voiceSettings().snippets.filter((s) => s.abbr);
    if (!list.length) return null;
    const opts = { defaultPath: 'snippets.csv', filters: [{ name: 'Snippets (CSV)', extensions: ['csv'] }] };
    const w = BrowserWindow.getFocusedWindow();
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, snippetsToCsv(list), 'utf8');
    return { saved: list.length, path: r.filePath };
  });

  h('selection.show', () => showSelectionBar());
  h('selection.current', () => selectionCurrent());
  h('selection.run', (action: SelectionActionId) => selectionRun(action));
  h('selection.replace', (text: string) => selectionReplace(String(text ?? '')));
  h('selection.copy', (text: string) => selectionCopy(String(text ?? '')));
  h('selection.close', () => selectionClose());
  h('selection.resize', (height: number) => selectionResize(Number(height)));
}
