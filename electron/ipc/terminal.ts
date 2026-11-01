// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the Terminal: the calls the window makes, and the fast one-way
// messages for typing and resizing.

import { ipcMain } from 'electron';
import type { CreateTerminal, RemoteTargetSpec } from '../../core/api-terminal';
import { INTEGRATION_SCRIPTS } from '../../core/terminal/osc';
import type { TerminalSettings, Workspace } from '../../core/terminal/types';
import * as t from '../services/terminal';

export function registerTerminalIpc(deps: t.TerminalDeps) {
  t.initTerminal(deps);
  const handle = (name: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown) => ipcMain.handle(`terminal.${name}`, (e, ...a) => fn(e, ...(a as never[])));
  handle('settings', () => t.terminalSettings());
  handle('setSettings', (_e, patch: Partial<TerminalSettings>) => t.setTerminalSettings(patch));
  handle('shells', (_e, refresh: boolean) => t.detectShells(!!refresh));
  handle('sshHosts', () => t.sshHosts());
  handle('sessions', () => t.listSessions());
  handle('create', (_e, req: CreateTerminal) => t.createSession(req));
  handle('attach', (e, id: string) => t.attach(e.sender, id));
  handle('kill', (_e, id: string) => t.kill(id));
  handle('rename', (_e, id: string, title: string) => t.rename(id, title));
  handle('setGroup', (_e, id: string, group?: string) => t.setGroup(id, group));
  handle('clear', (_e, id: string) => t.clearScrollback(id));
  handle('notes', (_e, key: string) => t.notes(key));
  handle('setNotes', (_e, key: string, text: string) => t.setNotes(key, text));
  handle('saveWorkspace', (_e, ws: Workspace) => t.saveWorkspace(ws));
  handle('webTools', (_e, refresh: boolean) => t.webTools(!!refresh));
  handle('webToolCommand', (_e, id: 'editor' | 'notebook', folder: string, token: string) => t.webToolCommand(id, folder, token));
  handle('openWith', (_e, command: string, folder: string) => t.openWith(command, folder));
  handle('openAt', (_e, file: string, line: number, col?: number, cwd?: string) => t.openAt(file, line, col, cwd));
  handle('openWindow', (_e, query?: Record<string, string>) => t.openTerminalWindow(query));
  handle('toggleQuick', () => t.toggleQuickTerminal());
  handle('shellKind', (_e, profileId?: string) => t.shellKindFor(profileId));
  handle('integrationScript', (_e, shell: keyof typeof INTEGRATION_SCRIPTS) => INTEGRATION_SCRIPTS[shell] ?? '');
  handle('remoteList', (_e, target: RemoteTargetSpec, dir?: string) => t.remoteFiles.list(target, dir));
  handle('remoteDownload', (_e, target: RemoteTargetSpec, files: string[], toDir?: string) => t.remoteFiles.download(target, files, toDir));
  handle('remoteUpload', (_e, target: RemoteTargetSpec, files: string[], toDir: string) => t.remoteFiles.upload(target, files, toDir));
  handle('remoteMkdir', (_e, target: RemoteTargetSpec, dir: string) => t.remoteFiles.mkdir(target, dir));
  handle('remoteRemove', (_e, target: RemoteTargetSpec, p: string, isDir: boolean) => t.remoteFiles.remove(target, p, isDir));
  handle('remoteRename', (_e, target: RemoteTargetSpec, from: string, to: string) => t.remoteFiles.rename(target, from, to));
  handle('remoteSavePassword', (_e, target: RemoteTargetSpec, pw: string) => t.remoteFiles.savePassword(target, pw));
  handle('remoteDisconnect', (_e, target: RemoteTargetSpec) => t.remoteFiles.disconnect(target));
  handle('hostPid', () => t.hostPid());
  ipcMain.on('terminal.input', (_e, id: string, data: string) => typeof data === 'string' && t.input(id, data));
  ipcMain.on('terminal.resize', (_e, id: string, cols: number, rows: number) => t.resize(id, cols, rows));
  ipcMain.on('terminal.detach', (e, id: string) => t.detach(e.sender, id));
}

export { openTerminalWindow, stopTerminal, toggleQuickTerminal } from '../services/terminal';
