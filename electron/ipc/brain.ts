// SPDX-License-Identifier: AGPL-3.0-or-later
// IPC for Keeper's brain: status, search, asking the AI, meaning search,
// AI connections and the AI apps Keeper serves.

import { ipcMain } from 'electron';
import type { ChatMessage } from '../../core/brain/providers';
import {
  ask, cancelAsk, connections, MODEL_DOWNLOAD_BYTES, mcpApps, rebuild, removeModel, search, serverInfo, setAppConnected, setSemantic, status, testConnection,
} from '../services/brain';
import { brainSettings } from '../services/brain';
import { updateSettings } from '../store';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

export function registerBrainIpc() {
  handle('brain.status', () => status());
  handle('brain.search', (q: string, o?: { limit?: number; mode?: 'hybrid' }) => search(q, o));
  ipcMain.handle('brain.ask', async (e, reqId: string, question: string, history?: ChatMessage[]) => {
    const send = (channel: string, ...args: unknown[]) => { if (!e.sender.isDestroyed()) e.sender.send(`event:${channel}`, ...args); };
    return ask(reqId, question, history, send);
  });
  handle('brain.cancel', (reqId: string) => cancelAsk(reqId));
  handle('brain.setSemantic', async (on: boolean) => {
    // Saved for next time, then applied (changes run one at a time).
    await updateSettings({ brain: { ...brainSettings(), semantic: on } });
    return setSemantic(on);
  });
  handle('brain.removeModel', () => removeModel());
  handle('brain.rebuild', () => rebuild());
  handle('brain.connections', () => connections());
  handle('brain.testConnection', (id: string) => testConnection(id));
  handle('brain.apps', () => mcpApps());
  handle('brain.setAppConnected', (id: string, on: boolean) => setAppConnected(id, on));
  handle('brain.server', () => serverInfo());
  handle('brain.modelSize', () => MODEL_DOWNLOAD_BYTES);
}
