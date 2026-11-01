// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Terminal part of the interface ↔ main-process contract.

import type { RemoteEntry, SessionInfo, ShellEvent, ShellInfo, SshHost, TerminalProfile, TerminalSettings, WebTool, Workspace } from './terminal/types';

export interface RemoteTargetSpec {
  protocol: 'sftp' | 'ftp' | 'ftps';
  target: string;
  password?: string;
  insecure?: boolean;
}

export interface CreateTerminal {
  profileId?: string;
  profile?: TerminalProfile;
  cwd?: string;
  cloneOf?: string;
  group?: string;
  title?: string;
  cols?: number;
  rows?: number;
  run?: string;
}

export interface TerminalApi {
  settings(): Promise<TerminalSettings>;
  setSettings(patch: Partial<TerminalSettings>): Promise<TerminalSettings>;
  shells(refresh?: boolean): Promise<ShellInfo[]>;
  sshHosts(): Promise<SshHost[]>;
  sessions(): Promise<SessionInfo[]>;
  create(req: CreateTerminal): Promise<SessionInfo>;
  /** start showing a terminal: what it printed so far, then live output through 'term-data' */
  attach(id: string): Promise<{ data: string; total: number; info: SessionInfo }>;
  kill(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  setGroup(id: string, group?: string): Promise<void>;
  clear(id: string): Promise<void>;
  notes(key: string): Promise<string>;
  setNotes(key: string, text: string): Promise<void>;
  saveWorkspace(ws: Workspace): Promise<TerminalSettings>;
  webTools(refresh?: boolean): Promise<WebTool[]>;
  webToolCommand(id: 'editor' | 'notebook', folder: string, token: string): Promise<string | undefined>;
  openAt(file: string, line: number, col?: number, cwd?: string): Promise<void>;
  openWith(command: string, folder: string): Promise<void>;
  openWindow(query?: Record<string, string>): Promise<void>;
  toggleQuick(): Promise<void>;
  /** how to quote a dropped path for a profile's shell */
  shellKind(profileId?: string): Promise<'posix' | 'cmd' | 'powershell'>;
  integrationScript(shell: 'bash' | 'zsh' | 'fish' | 'powershell'): Promise<string>;
  remoteList(t: RemoteTargetSpec, dir?: string): Promise<{ dir: string; entries: RemoteEntry[] }>;
  remoteDownload(t: RemoteTargetSpec, files: string[], toDir?: string): Promise<string[]>;
  remoteUpload(t: RemoteTargetSpec, files: string[], toDir: string): Promise<number>;
  remoteMkdir(t: RemoteTargetSpec, dir: string): Promise<void>;
  remoteRemove(t: RemoteTargetSpec, path: string, isDir: boolean): Promise<void>;
  remoteRename(t: RemoteTargetSpec, from: string, to: string): Promise<void>;
  remoteSavePassword(t: RemoteTargetSpec, password: string): Promise<boolean>;
  remoteDisconnect(t: RemoteTargetSpec): Promise<void>;
  hostPid(): Promise<number | undefined>;
  /** typing (no reply, so it stays fast) */
  input(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  detach(id: string): void;
}

export interface TerminalEvents {
  'term-data': (id: string, data: string, at: number) => void;
  'term-event': (id: string, ev: ShellEvent) => void;
  'term-exit': (id: string, code: number, signal?: number) => void;
  'term-sessions': (sessions: SessionInfo[]) => void;
  'term-settings': (s: TerminalSettings) => void;
  'term-trigger': (id: string, triggerId: string, line: string) => void;
  'term-notes': (key: string, text: string) => void;
  'term-open': (query: Record<string, string>) => void;
}
