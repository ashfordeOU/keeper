// SPDX-License-Identifier: AGPL-3.0-or-later
// The Terminal in the browser demo: a pretend shell that understands a few
// commands, so the interface can be tried without a computer behind it.

import type { TerminalApi } from '../core/api-terminal';
import { defaultTerminalSettings, normalizeTerminalSettings } from '../core/terminal/profiles';
import type { SessionInfo, ShellInfo, TerminalSettings } from '../core/terminal/types';

type Emit = (channel: string, ...args: unknown[]) => void;

export function mockTerminal(home: string, emit: Emit): { terminal: TerminalApi } {
  let settings: TerminalSettings = normalizeTerminalSettings({
    ...defaultTerminalSettings(),
    profiles: [
      { id: 'default', name: 'Default', shell: 'zsh', scheme: 'keeper', cursor: 'bar', cursorBlink: true },
      { id: 'work', name: 'Work account', shell: 'zsh', isolate: true, badge: 'W', color: '#3b82f6', scheme: 'harbor' },
      { id: 'personal', name: 'Personal account', shell: 'zsh', isolate: true, badge: 'P', color: '#e5487f', scheme: 'dusk' },
    ],
  });
  const shells: ShellInfo[] = [
    { id: 'zsh', label: 'Zsh', file: '/bin/zsh', args: ['-l'], kind: 'posix' },
    { id: 'bash', label: 'Bash', file: '/bin/bash', args: ['-l'], kind: 'posix' },
    { id: 'fish', label: 'Fish', file: '/opt/homebrew/bin/fish', args: ['-l'], kind: 'posix' },
  ];
  const sessions = new Map<string, { info: SessionInfo; buf: string; line: string; cwd: string; total: number }>();
  const notes = new Map<string, string>();
  let seq = 0;
  const prompt = (cwd: string) => `\x1b]133;A\x07\x1b[38;5;75m${cwd.replace(home, '~')}\x1b[0m \x1b[38;5;213m❯\x1b[0m `;
  const out = (id: string, data: string) => {
    const s = sessions.get(id);
    if (!s) return;
    const at = s.total;
    s.buf += data;
    s.total += data.length;
    s.info.lastActivity = Date.now();
    emit('term-data', id, data, at);
  };
  const list = () => [...sessions.values()].map((s) => s.info);
  const run = (id: string, cmd: string) => {
    const s = sessions.get(id)!;
    const [name, ...args] = cmd.trim().split(/\s+/);
    out(id, '\r\n\x1b]133;C\x07');
    let code = 0;
    if (!name) {
      /* nothing */
    } else if (name === 'echo') out(id, args.join(' ').replace(/^["']|["']$/g, '') + '\r\n');
    else if (name === 'pwd') out(id, s.cwd + '\r\n');
    else if (name === 'ls') out(id, ['Desktop', 'Documents', 'Downloads', 'Projects', 'notes.md'].map((n, i) => (i < 4 ? `\x1b[1;34m${n}\x1b[0m` : n)).join('  ') + '\r\n');
    else if (name === 'cd') {
      s.cwd = args[0] ? (args[0].startsWith('/') ? args[0] : `${s.cwd}/${args[0]}`.replace('/~', '')) : home;
      emit('term-event', id, { kind: 'cwd', path: s.cwd });
    } else if (name === 'clear') out(id, '\x1b[2J\x1b[H');
    else if (name === 'whoami') out(id, `demo (${s.info.profileName})\r\n`);
    else if (name === 'env') out(id, `KEEPER_SESSION=${id}\r\nKEEPER_PROFILE=${s.info.profileId}\r\nTERM=xterm-256color\r\n`);
    else if (name === 'help') out(id, 'This is the browser demo. Try: echo, pwd, ls, cd, whoami, env, colors, clear\r\n');
    else if (name === 'colors') {
      let line = '';
      for (let i = 0; i < 16; i++) line += `\x1b[48;5;${i}m  \x1b[0m`;
      out(id, line + '\r\n');
    } else {
      out(id, `demo: ${name}: this pretend shell only knows a few commands (type help)\r\n`);
      code = 127;
    }
    out(id, `\x1b]133;D;${code}\x07`);
    emit('term-event', id, { kind: 'command-end', exit: code });
    out(id, prompt(s.cwd));
  };
  const api: TerminalApi = {
    settings: async () => settings,
    setSettings: async (patch) => {
      settings = normalizeTerminalSettings({ ...settings, ...patch });
      emit('term-settings', settings);
      return settings;
    },
    shells: async () => shells,
    sshHosts: async () => [
      { alias: 'homeserver', host: '192.168.0.252', user: 'admin' },
      { alias: 'pi', host: 'raspberrypi.local', user: 'pi' },
    ],
    sessions: async () => list(),
    create: async (req) => {
      const id = `demo${++seq}`;
      const profile = req.profile ?? settings.profiles.find((p) => p.id === (req.profileId ?? settings.defaultProfile)) ?? settings.profiles[0];
      const cwd = req.cwd ?? (req.cloneOf ? sessions.get(req.cloneOf)?.cwd : undefined) ?? home;
      const info: SessionInfo = { id, title: req.title ?? profile.name, profileId: profile.id, profileName: profile.name, pid: 4000 + seq, cwd, createdAt: Date.now(), lastActivity: Date.now(), clients: 0, cols: req.cols ?? 100, rows: req.rows ?? 30, group: req.group };
      sessions.set(id, { info, buf: '', line: '', cwd, total: 0 });
      setTimeout(() => {
        out(id, `\x1b[2mKeeper Terminal — browser demo. Type \x1b[0mhelp\x1b[2m to see what this pretend shell can do.\x1b[0m\r\n`);
        if (profile.isolate) out(id, `\x1b[2mThis profile keeps its own sign-ins (config folder: ~/…/Keeper/terminal/profiles/${profile.id}).\x1b[0m\r\n`);
        out(id, prompt(cwd));
        if (req.run) {
          out(id, req.run);
          run(id, req.run);
        }
      }, 60);
      emit('term-sessions', list());
      return info;
    },
    attach: async (id) => {
      const s = sessions.get(id);
      if (!s) throw new Error('No such terminal');
      s.info.clients++;
      return { data: s.buf, total: s.total, info: s.info };
    },
    kill: async (id) => {
      sessions.delete(id);
      emit('term-sessions', list());
    },
    rename: async (id, title) => {
      const s = sessions.get(id);
      if (s) s.info.title = title;
      emit('term-sessions', list());
    },
    setGroup: async (id, group) => {
      const s = sessions.get(id);
      if (s) s.info.group = group;
      emit('term-sessions', list());
    },
    clear: async (id) => {
      const s = sessions.get(id);
      if (s) s.buf = '';
    },
    notes: async (key) => notes.get(key) ?? '',
    setNotes: async (key, text) => {
      notes.set(key, text);
      emit('term-notes', key, text);
    },
    saveWorkspace: async (ws) => {
      settings = { ...settings, workspaces: [...settings.workspaces.filter((w) => w.id !== ws.id), { ...ws, savedAt: Date.now() }] };
      return settings;
    },
    webTools: async () => [
      { id: 'editor', label: 'Code editor', available: false, hint: 'Install a code editor whose command line can “serve-web”, and make sure its command is on your PATH.' },
      { id: 'notebook', label: 'Notebooks', available: false, hint: 'Install the notebook server with: pip install jupyterlab' },
      { id: 'url', label: 'Web page on this computer', available: true },
    ],
    webToolCommand: async () => undefined,
    openWith: async () => undefined,
    openWindow: async () => undefined,
    toggleQuick: async () => undefined,
    shellKind: async () => 'posix',
    integrationScript: async () => '# Shell integration is set up automatically in the app.',
    remoteList: async (_t, dir) => {
      const d = dir || '/home/admin';
      return { dir: d, entries: [
        { name: 'media', path: `${d}/media`, isDir: true, size: 0, mtime: Date.now() - 86_400_000 },
        { name: 'backups', path: `${d}/backups`, isDir: true, size: 0, mtime: Date.now() - 3 * 86_400_000 },
        { name: 'docker-compose.yml', path: `${d}/docker-compose.yml`, isDir: false, size: 2140, mtime: Date.now() - 7200_000 },
        { name: 'notes.txt', path: `${d}/notes.txt`, isDir: false, size: 512, mtime: Date.now() - 600_000 },
      ] };
    },
    remoteDownload: async (_t, files) => files.map((f) => `${home}/Downloads/${f.split('/').pop()}`),
    remoteUpload: async (_t, files) => files.length,
    remoteMkdir: async () => undefined,
    remoteRemove: async () => undefined,
    remoteRename: async () => undefined,
    remoteSavePassword: async () => true,
    remoteDisconnect: async () => undefined,
    hostPid: async () => 4242,
    input: (id, data) => {
      const s = sessions.get(id);
      if (!s) return;
      for (const ch of data) {
        if (ch === '\r') {
          const cmd = s.line;
          s.line = '';
          run(id, cmd);
        } else if (ch === '\x7f') {
          if (s.line) {
            s.line = s.line.slice(0, -1);
            out(id, '\b \b');
          }
        } else if (ch === '\x03') {
          s.line = '';
          out(id, '^C\r\n' + prompt(s.cwd));
        } else if (ch >= ' ') {
          s.line += ch;
          out(id, ch);
        }
      }
    },
    resize: (id, cols, rows) => {
      const s = sessions.get(id);
      if (s) Object.assign(s.info, { cols, rows });
    },
    detach: (id) => {
      const s = sessions.get(id);
      if (s) s.info.clients = Math.max(0, s.info.clients - 1);
    },
  };
  return { terminal: api };
}
