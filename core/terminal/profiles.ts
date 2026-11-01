// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Turning a profile into a program to start: the shell, its folder and the
// variables around it, including a separate config folder per profile so
// tools signed in under one profile never see another's sign-in.

import type { ShellInfo, TerminalProfile, TerminalSettings } from './types';

export const DEFAULT_SCROLLBACK = 10_000;

export function defaultProfiles(): TerminalProfile[] {
  return [
    { id: 'default', name: 'Default', shell: 'default', scheme: 'keeper', cursor: 'bar', cursorBlink: true, bell: 'visual' },
  ];
}

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  'tab.new': 'CmdOrCtrl+T',
  'tab.close': 'CmdOrCtrl+W',
  'tab.next': 'Ctrl+Tab',
  'tab.prev': 'Ctrl+Shift+Tab',
  'pane.splitRight': 'CmdOrCtrl+D',
  'pane.splitDown': 'CmdOrCtrl+Shift+D',
  'pane.close': 'CmdOrCtrl+Shift+W',
  'pane.zoom': 'CmdOrCtrl+Shift+Enter',
  'pane.next': 'CmdOrCtrl+]',
  'pane.prev': 'CmdOrCtrl+[',
  'pane.left': 'CmdOrCtrl+Alt+Left',
  'pane.right': 'CmdOrCtrl+Alt+Right',
  'pane.up': 'CmdOrCtrl+Alt+Up',
  'pane.down': 'CmdOrCtrl+Alt+Down',
  'broadcast.toggle': 'CmdOrCtrl+Alt+I',
  'search.open': 'CmdOrCtrl+F',
  'prompt.prev': 'CmdOrCtrl+Up',
  'prompt.next': 'CmdOrCtrl+Down',
  'font.bigger': 'CmdOrCtrl+=',
  'font.smaller': 'CmdOrCtrl+-',
  'font.reset': 'CmdOrCtrl+0',
  'clear': 'CmdOrCtrl+K',
  'palette': 'CmdOrCtrl+Shift+P',
  'copyMode': 'CmdOrCtrl+Shift+X',
};

/**
 * Off the Mac, Ctrl+letter belongs to the shell (Ctrl+D ends input, Ctrl+W
 * deletes a word, Ctrl+K cuts a line…), so Keeper's own shortcuts add Shift
 * there, as other terminals on those systems do.
 */
const OTHER_KEYBINDINGS: Record<string, string> = {
  'tab.new': 'Ctrl+Shift+T',
  'tab.close': 'Ctrl+Shift+W',
  'tab.next': 'Ctrl+Tab',
  'tab.prev': 'Ctrl+Shift+Tab',
  'pane.splitRight': 'Ctrl+Shift+D',
  'pane.splitDown': 'Ctrl+Shift+E',
  'pane.close': 'Ctrl+Alt+W',
  'pane.zoom': 'Ctrl+Shift+Enter',
  'pane.next': 'Ctrl+Shift+]',
  'pane.prev': 'Ctrl+Shift+[',
  'pane.left': 'Ctrl+Alt+Left',
  'pane.right': 'Ctrl+Alt+Right',
  'pane.up': 'Ctrl+Alt+Up',
  'pane.down': 'Ctrl+Alt+Down',
  'broadcast.toggle': 'Ctrl+Alt+I',
  'search.open': 'Ctrl+Shift+F',
  'prompt.prev': 'Ctrl+Shift+Up',
  'prompt.next': 'Ctrl+Shift+Down',
  'font.bigger': 'Ctrl+=',
  'font.smaller': 'Ctrl+-',
  'font.reset': 'Ctrl+0',
  'clear': 'Ctrl+Shift+K',
  'palette': 'Ctrl+Shift+P',
  'copyMode': 'Ctrl+Shift+Space',
};

export function defaultKeybindings(platform: string): Record<string, string> {
  return { ...(platform === 'darwin' ? DEFAULT_KEYBINDINGS : OTHER_KEYBINDINGS) };
}

export function defaultTerminalSettings(platform = 'darwin'): TerminalSettings {
  return {
    profiles: defaultProfiles(),
    defaultProfile: 'default',
    keepAlive: 'window',
    scrollback: DEFAULT_SCROLLBACK,
    saveScrollback: true,
    confirmBroadcast: true,
    pasteGuard: true,
    copyOnSelect: false,
    rightClick: 'menu',
    quickShortcut: 'Ctrl+`',
    windowShortcut: 'CommandOrControl+Alt+T',
    keybindings: defaultKeybindings(platform),
    triggers: [
      { id: 'waiting', pattern: '(waiting for (your )?input|Do you want to proceed\\?|\\(y/n\\)|\\[Y/n\\])', action: 'island', enabled: true, label: 'A program is waiting for an answer' },
      { id: 'errors', pattern: '\\b(error|failed|exception)\\b', action: 'highlight', enabled: false, label: 'Errors' },
    ],
    savedHosts: [],
    workspaces: [],
    launchers: [],
    quickHeight: 0.45,
    webgl: true,
  };
}

/** Fills in missing fields after an update added new ones. */
export function normalizeTerminalSettings(s: Partial<TerminalSettings> | undefined, platform = 'darwin'): TerminalSettings {
  const d = defaultTerminalSettings(platform);
  const out = { ...d, ...(s ?? {}) } as TerminalSettings;
  out.profiles = Array.isArray(out.profiles) && out.profiles.length ? out.profiles : d.profiles;
  if (!out.profiles.some((p) => p.id === out.defaultProfile)) out.defaultProfile = out.profiles[0].id;
  out.keybindings = { ...d.keybindings, ...(s?.keybindings ?? {}) };
  out.triggers = Array.isArray(out.triggers) ? out.triggers : d.triggers;
  out.savedHosts = Array.isArray(out.savedHosts) ? out.savedHosts : [];
  out.workspaces = Array.isArray(out.workspaces) ? out.workspaces : [];
  out.launchers = Array.isArray(out.launchers) ? out.launchers : [];
  out.scrollback = clamp(out.scrollback, 500, 200_000);
  out.quickHeight = Math.min(0.9, Math.max(0.2, Number(out.quickHeight) || d.quickHeight));
  return out;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)));

/** A folder-safe name for a profile id. */
export function profileSlug(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'profile';
}

export interface Launch {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** typed in once the shell is ready */
  startup?: string;
  /** folder holding this profile's own config, when isolated */
  configDir?: string;
}

export interface ResolveContext {
  platform: string;
  /** the environment Keeper itself runs with */
  env: Record<string, string | undefined>;
  home: string;
  /** Keeper's data folder; isolated profiles live under it */
  dataDir: string;
  shells: ShellInfo[];
  sessionId: string;
  /** the folder to start in when the profile names none */
  fallbackCwd?: string;
}

/** The shell a profile means, falling back to the person's login shell. */
export function pickShell(p: TerminalProfile, ctx: Pick<ResolveContext, 'platform' | 'env' | 'shells'>): { file: string; args: string[] } {
  if (p.shell === 'custom' && p.command) return { file: p.command, args: p.args ?? [] };
  const found = ctx.shells.find((s) => s.id === p.shell);
  if (found) return { file: found.file, args: [...found.args, ...(p.args ?? [])] };
  return { ...defaultShell(ctx.platform, ctx.env), args: [...defaultShell(ctx.platform, ctx.env).args, ...(p.args ?? [])] };
}

export function defaultShell(platform: string, env: Record<string, string | undefined>): { file: string; args: string[] } {
  if (platform === 'win32') {
    // PowerShell is on every supported Windows; COMSPEC (cmd) is the fallback.
    const sys = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
    return { file: `${sys}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, args: ['-NoLogo'] };
  }
  const sh = env.SHELL && env.SHELL.startsWith('/') ? env.SHELL : platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  // A login shell, so the person's profile files (PATH and so on) are read as in their usual terminal.
  return { file: sh, args: ['-l'] };
}

export function resolveLaunch(p: TerminalProfile, ctx: ResolveContext, cwdOverride?: string): Launch {
  const { file, args } = pickShell(p, ctx);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx.env)) if (typeof v === 'string') env[k] = v;
  // Keeper's own variables would confuse programs run inside (and Electron's would break Node tools).
  for (const k of Object.keys(env)) if (/^(ELECTRON_|CHROME_|VITE_|KEEPER_HOST_)/.test(k) || k === 'NODE_OPTIONS') delete env[k];
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'Keeper';
  env.KEEPER_SESSION = ctx.sessionId;
  env.KEEPER_PROFILE = p.id;
  if (p.locale) {
    env.LANG = p.locale;
    env.LC_ALL = p.locale;
  } else if (ctx.platform !== 'win32' && !env.LANG) env.LANG = 'en_US.UTF-8';
  let configDir: string | undefined;
  if (p.isolate) {
    // No node:path here: the terminal's settings window imports this file too.
    const sep = { join: (...parts: string[]) => { const d = ctx.platform === 'win32' ? '\\' : '/'; return parts.map((x, i) => (i === 0 ? x.replace(/[\\/]+$/, '') : x.replace(/^[\\/]+|[\\/]+$/g, ''))).filter(Boolean).join(d); } };
    configDir = sep.join(ctx.dataDir, 'terminal', 'profiles', profileSlug(p.id));
    // Command-line tools that keep sign-ins in a config folder read these.
    env.KEEPER_PROFILE_HOME = configDir;
    env.CLAUDE_CONFIG_DIR = sep.join(configDir, 'claude');
    env.XDG_CONFIG_HOME = sep.join(configDir, 'config');
    env.XDG_DATA_HOME = sep.join(configDir, 'data');
    env.XDG_STATE_HOME = sep.join(configDir, 'state');
    env.XDG_CACHE_HOME = sep.join(configDir, 'cache');
    if (p.isolateHome) {
      env.HOME = configDir;
      if (ctx.platform === 'win32') env.USERPROFILE = configDir;
    }
  }
  for (const [k, v] of Object.entries(p.env ?? {})) {
    // ${VAR} in values refers to the environment so far.
    env[k] = v.replace(/\$\{(\w+)\}/g, (_, n: string) => env[n] ?? '');
  }
  const cwd = expandHome(cwdOverride || p.cwd || ctx.fallbackCwd || ctx.home, ctx.home);
  let finalFile = file;
  let finalArgs = args;
  if (p.ssh) {
    finalFile = ctx.platform === 'win32' ? 'ssh.exe' : 'ssh';
    finalArgs = [p.ssh];
  }
  return { file: finalFile, args: finalArgs, cwd, env, startup: p.startup, configDir };
}

export function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return home + p.slice(1);
  return p;
}

/** Quotes a path for pasting into a shell of this kind. */
export function quotePath(p: string, kind: 'posix' | 'cmd' | 'powershell' | string): string {
  if (kind === 'cmd') return /[\s&()^|<>%!"]/.test(p) ? `"${p.replace(/"/g, '')}"` : p;
  if (kind === 'powershell') return /[\s'‘’‚‛`$&(){}@#;,|<>"]/.test(p) ? `'${p.replace(/['‘’‚‛]/g, '$&$&')}'` : p;
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}
