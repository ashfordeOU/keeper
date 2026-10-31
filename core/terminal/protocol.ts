// SPDX-License-Identifier: AGPL-3.0-or-later
// The session host and the app talk over a local socket, one JSON message per
// line. The first message must carry the token from a file only this user can
// read, so other programs on the computer cannot type into your terminals.

import type { SessionInfo, SessionSpec, ShellEvent } from './types';

export type ClientMsg =
  | { t: 'hello'; token: string; client: string }
  | { t: 'list'; rid: number }
  | { t: 'create'; rid: number; spec: SessionSpec; launch: { file: string; args: string[]; cwd: string; env: Record<string, string>; startup?: string }; scrollback: number }
  | { t: 'attach'; rid: number; id: string }
  | { t: 'detach'; id: string }
  | { t: 'input'; id: string; data: string }
  | { t: 'resize'; id: string; cols: number; rows: number }
  | { t: 'kill'; rid: number; id: string }
  | { t: 'rename'; id: string; title: string }
  | { t: 'group'; id: string; group?: string }
  | { t: 'info'; rid: number; id: string }
  | { t: 'clear'; id: string }
  | { t: 'shutdown'; rid: number; save: boolean }
  | { t: 'keepAlive'; mode: 'window' | 'quit' | 'never' }
  | { t: 'ping'; rid: number };

export type HostMsg =
  | { t: 'welcome'; version: number; pid: number; sessions: SessionInfo[] }
  | { t: 'reply'; rid: number; ok: boolean; error?: string; data?: unknown }
  /** `at` is how many characters the terminal had printed before this chunk, so a window can line output up with its snapshot */
  | { t: 'data'; id: string; data: string; at: number }
  | { t: 'snapshot'; id: string; data: string; info: SessionInfo }
  | { t: 'exit'; id: string; code: number; signal?: number }
  | { t: 'event'; id: string; ev: ShellEvent }
  | { t: 'sessions'; sessions: SessionInfo[] };

export const PROTOCOL_VERSION = 1;

/** Splits a stream into lines and parses each; bad lines are dropped, not fatal. */
export class LineDecoder<T> {
  private buf = '';
  constructor(private onMsg: (m: T) => void, private maxLine = 64 * 1024 * 1024) {}
  push(chunk: string | Buffer) {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      try {
        this.onMsg(JSON.parse(line) as T);
      } catch {
        /* a broken line from a broken peer */
      }
    }
    if (this.buf.length > this.maxLine) this.buf = '';
  }
}

export const encode = (m: ClientMsg | HostMsg) => JSON.stringify(m) + '\n';

/** Where the socket lives: a named pipe on Windows, a socket file in Keeper's data folder elsewhere. */
export function socketPath(dataDir: string, platform: string, user = 'user'): string {
  if (platform === 'win32') return `\\\\.\\pipe\\keeper-terminal-${user.replace(/[^A-Za-z0-9_-]/g, '')}`;
  // Unix socket paths are limited to ~104 bytes; fall back to /tmp with the user's name when too long.
  const p = `${dataDir.replace(/\/+$/, '')}/terminal/host.sock`;
  return p.length < 100 ? p : `/tmp/keeper-terminal-${user.replace(/[^A-Za-z0-9_-]/g, '')}.sock`;
}
