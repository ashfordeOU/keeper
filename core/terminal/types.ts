// SPDX-License-Identifier: AGPL-3.0-or-later
// The shapes shared by Keeper's terminal: profiles, sessions, layouts and the
// events the session host sends. Pure types, used by the app, the host and tests.

export type ShellKind = 'posix' | 'cmd' | 'powershell' | 'wsl' | 'ssh' | 'custom';

/** A shell found on this computer. */
export interface ShellInfo {
  id: string;
  label: string;
  file: string;
  args: string[];
  kind: ShellKind;
  /** e.g. the WSL distribution name */
  detail?: string;
}

/** How a terminal starts: which shell, where, with what around it. */
export interface TerminalProfile {
  id: string;
  name: string;
  /** a ShellInfo id ('default' = the person's login shell), or 'custom' with `command` */
  shell: string;
  /** used when shell is 'custom': the program and its arguments */
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /**
   * Keeps this profile's sign-ins apart from every other profile: tools that
   * read their settings from a config folder (for example an AI command-line
   * assistant signed in to a different account) get one folder per profile.
   */
  isolate?: boolean;
  /** also point HOME at the profile's own folder (stronger isolation; some tools then miss your dotfiles) */
  isolateHome?: boolean;
  /** LANG / LC_ALL for programs in this terminal, e.g. 'de_DE.UTF-8' */
  locale?: string;
  /** a command typed in when the terminal opens */
  startup?: string;
  /** a colour scheme id, or 'keeper' to follow Keeper's theme */
  scheme?: string;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  ligatures?: boolean;
  cursor?: 'block' | 'bar' | 'underline';
  cursorBlink?: boolean;
  bell?: 'none' | 'sound' | 'visual' | 'island';
  scrollback?: number;
  /** an SSH host alias or user@host, for profiles that connect somewhere */
  ssh?: string;
  /** a short emoji or letter shown on tabs */
  badge?: string;
  color?: string;
}

export interface SessionSpec {
  profile: TerminalProfile;
  cols: number;
  rows: number;
  /** start here instead of the profile's folder (e.g. "Open in Terminal") */
  cwd?: string;
  /** copy another session's folder and variables */
  cloneOf?: string;
  title?: string;
  group?: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  profileId: string;
  profileName: string;
  pid?: number;
  cwd?: string;
  createdAt: number;
  lastActivity: number;
  /** set when the program inside has ended */
  exit?: { code: number; signal?: number; at: number };
  /** windows attached right now */
  clients: number;
  group?: string;
  /** restored from disk: the scrollback is there but no program is running */
  restored?: boolean;
  /** the program currently running, as told by the shell (OSC 133), when known */
  running?: string;
  cols: number;
  rows: number;
}

/** What the shell told the terminal about itself (shell integration escape codes). */
export type ShellEvent =
  | { kind: 'prompt' }
  | { kind: 'command-start'; command?: string }
  | { kind: 'command-end'; exit?: number }
  | { kind: 'cwd'; path: string; host?: string }
  | { kind: 'notify'; title?: string; body: string }
  | { kind: 'title'; title: string };

export interface CommandMark {
  /** buffer line of the prompt */
  line?: number;
  command?: string;
  startedAt: number;
  endedAt?: number;
  exit?: number;
}

export type PaneNode =
  | { type: 'leaf'; id: string; session: string; kind?: 'terminal' | 'web' | 'notes' | 'files'; url?: string }
  | { type: 'split'; id: string; dir: 'row' | 'col'; children: PaneNode[]; sizes: number[] };

export interface TerminalTab {
  id: string;
  title?: string;
  root: PaneNode;
  focus: string;
  /** one pane fills the tab while zoomed */
  zoomed?: string;
  /** typing goes to every terminal pane in the tab */
  broadcast?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  tabs: TerminalTab[];
  active: string;
  savedAt?: number;
}

export interface Trigger {
  id: string;
  /** a regular expression matched against plain output lines */
  pattern: string;
  action: 'highlight' | 'notify' | 'island' | 'sound';
  enabled: boolean;
  label?: string;
}

export interface SshHost {
  alias: string;
  host?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
  /** added in Keeper rather than read from ~/.ssh/config */
  saved?: boolean;
}

export interface RemoteEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  link?: boolean;
}

export interface WebTool {
  id: 'editor' | 'notebook' | 'url';
  label: string;
  available: boolean;
  /** what to install when it is missing */
  hint?: string;
}

export interface TerminalSettings {
  profiles: TerminalProfile[];
  defaultProfile: string;
  /** sessions keep running after the last window closes (and after Keeper quits, if set) */
  keepAlive: 'window' | 'quit' | 'never';
  scrollback: number;
  /** save scrollback to disk so it can be read after a restart */
  saveScrollback: boolean;
  confirmBroadcast: boolean;
  pasteGuard: boolean;
  copyOnSelect: boolean;
  rightClick: 'menu' | 'paste';
  quickShortcut: string;
  windowShortcut: string;
  keybindings: Record<string, string>;
  triggers: Trigger[];
  savedHosts: SshHost[];
  workspaces: Workspace[];
  /** "Open in…" commands: {path} is replaced with the folder */
  launchers: { id: string; name: string; command: string }[];
  /** the quick terminal: share of the screen height */
  quickHeight: number;
  webgl: boolean;
}
