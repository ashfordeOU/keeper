// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's terminal, main-process side: finds the shells, starts (or finds) the
// session host, opens terminals for profiles, passes typing and output between
// windows and the host, watches output for triggers, and runs the web tools.

import { app, BrowserWindow, globalShortcut, screen, session, shell, type WebContents } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, promises as fsp, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCombo } from '../../../core/terminal/keys';
import { parseDotEnv } from '../../../core/terminal/assist';
import { normalizeTerminalSettings, resolveLaunch, quotePath } from '../../../core/terminal/profiles';
import { socketPath, type HostMsg } from '../../../core/terminal/protocol';
import { parseWhere, shellKindOf, unixShells, windowsShells } from '../../../core/terminal/shells';
import { parseSshConfig } from '../../../core/terminal/sshconfig';
import { TriggerWatcher } from '../../../core/terminal/triggers';
import type { SessionInfo, SessionSpec, ShellInfo, SshHost, TerminalProfile, TerminalSettings, WebTool, Workspace } from '../../../core/terminal/types';
import { HostClient } from './client';
import { remote, type RemoteTarget } from './remote';

export interface TerminalDeps {
  preload: string;
  /** shows a short alert in the Island (and a notification when Keeper is in the background) */
  alert(title: string, detail?: string): void;
  getSecret(name: string): Promise<string | undefined>;
  setSecret(name: string, value: string): Promise<boolean>;
}

const dataDir = () => app.getPath('userData');
const termDir = () => path.join(dataDir(), 'terminal');
const settingsFile = () => path.join(termDir(), 'settings.json');
const notesFile = () => path.join(termDir(), 'notes.json');
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

let deps: TerminalDeps;
let settingsCache: TerminalSettings | null = null;
let client: HostClient | null = null;

/** The terminal session host's process, for the Processes page (it keeps terminals running when Keeper's windows close). */
export function terminalHostPid(): number | undefined {
  return client?.hostPid;
}
let connecting: Promise<HostClient> | null = null;
let shellsCache: ShellInfo[] | null = null;
/** which windows show which terminal, and in how many panes (a terminal can be mirrored) */
const subs = new Map<string, Map<WebContents, number>>();
const watchers = new Map<string, TriggerWatcher>();
const launches = new Map<string, { profileId: string; cwd: string }>();
let termWin: BrowserWindow | null = null;
let quickWin: BrowserWindow | null = null;

// ---------------------------------------------------------------- settings

export function terminalSettings(): TerminalSettings {
  if (settingsCache) return settingsCache;
  try {
    settingsCache = normalizeTerminalSettings(JSON.parse(readFileSync(settingsFile(), 'utf8')), process.platform);
  } catch {
    settingsCache = normalizeTerminalSettings(undefined, process.platform);
  }
  return settingsCache;
}

let saving: Promise<void> = Promise.resolve();
export async function setTerminalSettings(patch: Partial<TerminalSettings>): Promise<TerminalSettings> {
  const next = normalizeTerminalSettings({ ...terminalSettings(), ...patch }, process.platform);
  const prev = terminalSettings();
  settingsCache = next;
  saving = saving.then(async () => {
    await fsp.mkdir(termDir(), { recursive: true });
    const tmp = `${settingsFile()}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2));
    await fsp.rename(tmp, settingsFile());
  }).catch(() => undefined);
  await saving;
  if (JSON.stringify(prev.triggers) !== JSON.stringify(next.triggers)) for (const w of watchers.values()) w.set(next.triggers);
  if (prev.keepAlive !== next.keepAlive) client?.post({ t: 'keepAlive', mode: next.keepAlive });
  if (prev.quickShortcut !== next.quickShortcut || prev.windowShortcut !== next.windowShortcut) registerTerminalShortcuts();
  broadcastAll('term-settings', next);
  return next;
}

// ---------------------------------------------------------------- shells

export function detectShells(refresh = false): ShellInfo[] {
  if (shellsCache && !refresh) return shellsCache;
  if (process.platform === 'win32') {
    const sys = process.env.SystemRoot ?? 'C:\\Windows';
    let wsl: Buffer | undefined;
    if (existsSync(`${sys}\\System32\\wsl.exe`)) {
      const r = spawnSync(`${sys}\\System32\\wsl.exe`, ['-l', '-q'], { timeout: 4000, windowsHide: true });
      if (r.status === 0) wsl = r.stdout;
    }
    const where = spawnSync('where.exe', ['pwsh'], { timeout: 3000, windowsHide: true, encoding: 'utf8' });
    shellsCache = windowsShells({
      systemRoot: sys,
      programFiles: [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Programs`].filter((p): p is string => !!p),
      exists: existsSync,
      wsl,
      pwsh: where.status === 0 ? parseWhere(where.stdout) : undefined,
    });
  } else {
    let etc = '';
    try {
      etc = readFileSync('/etc/shells', 'utf8');
    } catch {
      /* not every system has it */
    }
    shellsCache = unixShells({
      etcShells: etc,
      path: (process.env.PATH ?? '').split(':').filter(Boolean).concat(['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.cargo', 'bin')]),
      exists: existsSync,
      loginShell: process.env.SHELL ?? os.userInfo().shell ?? undefined,
    });
  }
  return shellsCache;
}

export function sshHosts(): SshHost[] {
  const home = os.homedir();
  const fromConfig = parseSshConfig({
    home,
    read: (f) => {
      try {
        return readFileSync(f, 'utf8');
      } catch {
        return undefined;
      }
    },
    glob: (pattern) => {
      // Only "dir/*" style patterns are common in Include lines.
      const dir = path.dirname(pattern);
      const re = new RegExp(`^${path.basename(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
      try {
        return readdirSync(dir).filter((n) => re.test(n)).map((n) => path.join(dir, n));
      } catch {
        return [];
      }
    },
  });
  const saved = terminalSettings().savedHosts.map((h) => ({ ...h, saved: true }));
  return [...saved, ...fromConfig.filter((h) => !saved.some((s) => s.alias === h.alias))];
}

// ---------------------------------------------------------------- the host

function hostScript(): string {
  return path.join(__dirname, 'term-host.cjs');
}

async function connect(): Promise<HostClient> {
  if (client?.connected) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    await fsp.mkdir(termDir(), { recursive: true });
    const sock = socketPath(dataDir(), process.platform, os.userInfo().username);
    const c = new HostClient(sock, path.join(termDir(), 'host.token'), 'app');
    try {
      await c.connect(1500);
    } catch {
      // Nobody listening: start the host, detached so it can outlive Keeper when asked to.
      const child = spawn(process.execPath, [hostScript()], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', KEEPER_HOST_DATA: dataDir(), KEEPER_HOST_SOCKET: sock },
      });
      child.unref();
      let last: unknown;
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          await c.connect(1500);
          last = undefined;
          break;
        } catch (e) {
          last = e;
        }
      }
      if (last) throw new Error(`The terminal host did not start: ${last instanceof Error ? last.message : String(last)}`);
    }
    c.onMessage = onHostMessage;
    c.onClose = () => {
      client = null;
      broadcastAll('term-sessions', []);
    };
    client = c;
    c.post({ t: 'keepAlive', mode: terminalSettings().keepAlive });
    broadcastAll('term-sessions', c.sessions);
    return c;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

/** Profiles that ask for it get the starting folder's .env variables (never overriding what the profile sets). */
async function addDotEnv(profile: TerminalProfile, launch: { cwd: string; env: Record<string, string> }) {
  if (!profile.loadDotEnv) return;
  try {
    const vars = parseDotEnv(await fsp.readFile(path.join(launch.cwd, '.env'), 'utf8'), launch.env);
    for (const [k, v] of Object.entries(vars)) if (!(k in (profile.env ?? {}))) launch.env[k] = v;
  } catch {
    /* no .env here */
  }
}

// Agent terminals (services/terminal/agents.ts) see the host's messages too.
let hostTap: ((m: HostMsg) => void) | null = null;
export function setHostTap(fn: typeof hostTap) {
  hostTap = fn;
}

/** The connected session host (started if needed). */
export function hostClient(): Promise<HostClient> {
  return connect();
}

/** How an agent terminal starts: a profile (the default one unless named), its folder and the agent's variables. */
export async function agentLaunch(req: { profileId?: string; cwd?: string; env: Record<string, string>; title: string; group?: string; cols: number; rows: number }) {
  const s = terminalSettings();
  const profile = s.profiles.find((p) => p.id === (req.profileId ?? s.defaultProfile)) ?? s.profiles[0];
  const launch = resolveLaunch(profile, { platform: process.platform, env: process.env, home: os.homedir(), dataDir: dataDir(), shells: detectShells(), sessionId: 'pending' }, req.cwd);
  if (launch.configDir) await fsp.mkdir(launch.configDir, { recursive: true });
  // No start-up command for agents: their first command must find a plain prompt.
  launch.startup = undefined;
  await addDotEnv(profile, launch);
  Object.assign(launch.env, req.env);
  if (req.group) {
    launch.env.KEEPER_SHARED_DIR = await sharedDir(req.group);
    launch.env.KEEPER_GROUP = req.group;
  }
  const spec: SessionSpec = { profile, cols: req.cols, rows: req.rows, cwd: req.cwd, title: req.title, group: req.group };
  return { spec, launch, scrollback: profile.scrollback ?? s.scrollback, shellKind: shellKindOf(launch.file) };
}

function onHostMessage(m: HostMsg) {
  hostTap?.(m);
  if (m.t === 'sessions') {
    broadcastAll('term-sessions', m.sessions);
    return;
  }
  if (m.t === 'data') {
    for (const wc of subs.get(m.id)?.keys() ?? []) if (!wc.isDestroyed()) wc.send('event:term-data', m.id, m.data, m.at);
    const w = watchers.get(m.id);
    if (w?.active) {
      for (const hit of w.feed(m.data)) {
        const name = client?.sessions.find((s) => s.id === m.id)?.title ?? 'Terminal';
        if (hit.trigger.action === 'island' || hit.trigger.action === 'notify') deps.alert(`${name}: ${hit.trigger.label ?? 'Needs you'}`, hit.line);
        for (const wc of subs.get(m.id)?.keys() ?? []) if (!wc.isDestroyed()) wc.send('event:term-trigger', m.id, hit.trigger.id, hit.line);
      }
    }
    return;
  }
  if (m.t === 'event') {
    if (m.ev.kind === 'notify') deps.alert(m.ev.title || 'Terminal', m.ev.body);
    for (const wc of subs.get(m.id)?.keys() ?? []) if (!wc.isDestroyed()) wc.send('event:term-event', m.id, m.ev);
    return;
  }
  if (m.t === 'exit') {
    for (const wc of subs.get(m.id)?.keys() ?? []) if (!wc.isDestroyed()) wc.send('event:term-exit', m.id, m.code, m.signal);
  }
}

function broadcastAll(channel: string, ...args: unknown[]) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(`event:${channel}`, ...args);
}

// ---------------------------------------------------------------- sessions

export interface CreateRequest {
  profileId?: string;
  /** a profile made up on the spot (e.g. "SSH to this host", "this shell") */
  profile?: TerminalProfile;
  cwd?: string;
  cloneOf?: string;
  group?: string;
  title?: string;
  cols?: number;
  rows?: number;
  /** typed in once the shell is ready (e.g. starting a web tool) */
  run?: string;
}

async function sharedDir(group: string): Promise<string> {
  const dir = path.join(termDir(), 'shared', group.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'group');
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

export async function createSession(req: CreateRequest): Promise<SessionInfo> {
  const c = await connect();
  const s = terminalSettings();
  let profile = req.profile ?? s.profiles.find((p) => p.id === (req.profileId ?? s.defaultProfile)) ?? s.profiles[0];
  let cwd = req.cwd;
  if (req.cloneOf) {
    // A sister terminal: same profile and folder as the one it was cloned from.
    const src = c.sessions.find((x) => x.id === req.cloneOf);
    const known = launches.get(req.cloneOf);
    if (known) profile = s.profiles.find((p) => p.id === known.profileId) ?? profile;
    cwd = src?.cwd ?? known?.cwd ?? cwd;
  }
  const launch = resolveLaunch(profile, {
    platform: process.platform, env: process.env, home: os.homedir(), dataDir: dataDir(), shells: detectShells(), sessionId: 'pending',
  }, cwd);
  if (launch.configDir) await fsp.mkdir(launch.configDir, { recursive: true });
  await addDotEnv(profile, launch);
  if (req.group) {
    // Terminals in a group share a folder (and its notes file) that programs inside can read and write.
    launch.env.KEEPER_SHARED_DIR = await sharedDir(req.group);
    launch.env.KEEPER_GROUP = req.group;
  }
  if (req.run) launch.startup = launch.startup ? `${launch.startup}; ${req.run}` : req.run;
  const spec: SessionSpec = { profile, cols: req.cols ?? 100, rows: req.rows ?? 30, cwd, cloneOf: req.cloneOf, title: req.title, group: req.group };
  const info = await c.request<SessionInfo>({ t: 'create', spec, launch, scrollback: profile.scrollback ?? s.scrollback });
  launches.set(info.id, { profileId: profile.id, cwd: launch.cwd });
  watchers.set(info.id, new TriggerWatcher(s.triggers));
  return info;
}

export async function listSessions(): Promise<SessionInfo[]> {
  const c = await connect();
  return c.request<SessionInfo[]>({ t: 'list' });
}

/** A window starts showing a terminal: it gets everything remembered so far, then live output. */
export async function attach(wc: WebContents, id: string): Promise<{ data: string; total: number; info: SessionInfo }> {
  const c = await connect();
  // Subscribe first: output that arrives around the snapshot carries offsets, so the window lines it up without gaps or repeats.
  let set = subs.get(id);
  if (!set) subs.set(id, (set = new Map()));
  if (!set.has(wc)) wc.once('destroyed', () => {
    subs.get(id)?.set(wc, 1);
    detach(wc, id);
  });
  set.set(wc, (set.get(wc) ?? 0) + 1);
  const r = await c.request<{ data: string; total: number; info: SessionInfo }>({ t: 'attach', id });
  if (!watchers.has(id)) watchers.set(id, new TriggerWatcher(terminalSettings().triggers));
  return r;
}

export function detach(wc: WebContents, id: string) {
  const set = subs.get(id);
  if (!set) return;
  const n = (set.get(wc) ?? 1) - 1;
  if (n > 0) set.set(wc, n);
  else set.delete(wc);
  if (!set.size) {
    subs.delete(id);
    client?.post({ t: 'detach', id });
    // "End terminals when their window closes": nobody shows it any more, so it ends.
    if (terminalSettings().keepAlive === 'never') setTimeout(() => {
      if (!subs.has(id)) void kill(id);
    }, 3000);
  }
}

export function input(id: string, data: string) {
  client?.post({ t: 'input', id, data });
}

export function resize(id: string, cols: number, rows: number) {
  client?.post({ t: 'resize', id, cols, rows });
}

export async function kill(id: string) {
  const c = await connect();
  watchers.delete(id);
  launches.delete(id);
  await c.request({ t: 'kill', id });
}

export function rename(id: string, title: string) {
  client?.post({ t: 'rename', id, title });
}

export function setGroup(id: string, group?: string) {
  client?.post({ t: 'group', id, group });
}

export function clearScrollback(id: string) {
  client?.post({ t: 'clear', id });
}

// ---------------------------------------------------------------- notes shared between terminals

export async function notes(key: string): Promise<string> {
  try {
    const all = JSON.parse(await fsp.readFile(notesFile(), 'utf8')) as Record<string, string>;
    return all[key] ?? '';
  } catch {
    return '';
  }
}

export async function setNotes(key: string, text: string): Promise<void> {
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(await fsp.readFile(notesFile(), 'utf8'));
  } catch {
    /* first note */
  }
  all[key] = text.slice(0, 200_000);
  await fsp.mkdir(termDir(), { recursive: true });
  await fsp.writeFile(notesFile(), JSON.stringify(all));
  // Group notes are also a file in the group's shared folder, so programs in those terminals can read them.
  if (key.startsWith('group:')) await fsp.writeFile(path.join(await sharedDir(key.slice(6)), 'notes.md'), text);
  broadcastAll('term-notes', key, text);
}

// ---------------------------------------------------------------- workspaces

export async function saveWorkspace(ws: Workspace): Promise<TerminalSettings> {
  const list = terminalSettings().workspaces.filter((w) => w.id !== ws.id);
  return setTerminalSettings({ workspaces: [...list, { ...ws, savedAt: Date.now() }].slice(-30) });
}

// ---------------------------------------------------------------- web tools and launchers

function which(cmd: string): string | undefined {
  const r = process.platform === 'win32'
    ? spawnSync('where.exe', [cmd], { encoding: 'utf8', timeout: 3000, windowsHide: true })
    : spawnSync('/bin/sh', ['-lc', `command -v ${cmd}`], { encoding: 'utf8', timeout: 3000 });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || undefined : undefined;
}

let toolsCache: { at: number; tools: WebTool[]; editor?: string; notebook?: string } | null = null;

export function webTools(refresh = false): WebTool[] {
  if (toolsCache && !refresh && Date.now() - toolsCache.at < 60_000) return toolsCache.tools;
  // A code editor that can serve itself to a browser, then a standalone editor server.
  const editor = ['code', 'code-insiders', 'code-server', 'openvscode-server'].find((c) => which(c));
  const notebook = which('jupyter') ? 'jupyter' : undefined;
  const tools: WebTool[] = [
    { id: 'editor', label: 'Code editor', available: !!editor, hint: 'Install a code editor whose command line can “serve-web”, or a code editor server, and make sure its command is on your PATH.' },
    { id: 'notebook', label: 'Notebooks', available: !!notebook, hint: 'Install the notebook server with: pip install jupyterlab' },
    { id: 'url', label: 'Web page on this computer', available: true },
  ];
  toolsCache = { at: Date.now(), tools, editor, notebook };
  return tools;
}

/** The command that starts a web tool for a folder; it runs in a terminal so any question it asks can be answered. */
export function webToolCommand(id: 'editor' | 'notebook', folder: string, token: string): string | undefined {
  webTools();
  const q = (p: string) => quotePath(p, process.platform === 'win32' ? 'powershell' : 'posix');
  if (id === 'editor' && toolsCache?.editor) {
    const e = toolsCache.editor;
    if (e === 'code-server') return `code-server --bind-addr 127.0.0.1:0 --auth none ${q(folder)}`;
    if (e === 'openvscode-server') return `openvscode-server --host 127.0.0.1 --port 0 --connection-token ${token} --default-folder ${q(folder)}`;
    return `${e} serve-web --host 127.0.0.1 --port 0 --connection-token ${token}`;
  }
  if (id === 'notebook' && toolsCache?.notebook) {
    // The newer notebook interface installs its own command; looking it up is instant (asking it for its version is not).
    const lab = !!which('jupyter-lab');
    // Allow the notebook to be shown inside Keeper's window; it only listens on this computer.
    // The notebook server refuses to run as the administrator account unless told it is intended.
    const root = process.getuid?.() === 0 ? ' --allow-root' : '';
    return `jupyter ${lab ? 'lab' : 'notebook'} --no-browser --ip=127.0.0.1 --port=0 --IdentityProvider.token=${token} --notebook-dir=${q(folder)}${root}`;
  }
  return undefined;
}

/** Opens file:line from terminal output in the person's editor (Settings → editor command), or with its usual app. */
export async function openAt(file: string, line: number, col = 1, cwd?: string): Promise<void> {
  const full = path.isAbsolute(file) ? file : path.resolve(cwd ?? os.homedir(), file.replace(/^~(?=[/\\])/, os.homedir()));
  if (!existsSync(full)) throw new Error(`Not found: ${full}`);
  const tpl = terminalSettings().editorCommand?.trim();
  if (!tpl) {
    await shell.openPath(full);
    return;
  }
  const q = quotePath(full, process.platform === 'win32' ? 'cmd' : 'posix');
  const cmd = tpl.replace(/\{file\}/g, q).replace(/\{line\}/g, String(line)).replace(/\{col\}/g, String(col));
  spawn(cmd, { shell: true, detached: true, stdio: 'ignore', cwd: path.dirname(full), windowsHide: true }).unref();
}

export async function openWith(command: string, folder: string): Promise<void> {
  const cmd = command.includes('{path}') ? command.replace(/\{path\}/g, quotePath(folder, process.platform === 'win32' ? 'cmd' : 'posix')) : `${command} ${quotePath(folder, process.platform === 'win32' ? 'cmd' : 'posix')}`;
  const child = spawn(cmd, { shell: true, detached: true, stdio: 'ignore', cwd: folder, windowsHide: true });
  child.unref();
}

/** Local web servers (the notebook, the editor) send headers that forbid being shown inside another page; Keeper's own windows may. */
function allowLocalFrames() {
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['http://127.0.0.1/*', 'http://localhost/*', 'http://127.0.0.1:*/*', 'http://localhost:*/*'] }, (d, cb) => {
    const headers = { ...d.responseHeaders };
    let changed = false;
    for (const k of Object.keys(headers)) {
      const lk = k.toLowerCase();
      if (d.resourceType === 'subFrame' && lk === 'x-frame-options') {
        delete headers[k];
        changed = true;
      } else if (d.resourceType === 'subFrame' && lk === 'content-security-policy') {
        headers[k] = headers[k]!.map((v) => v.replace(/frame-ancestors[^;]*;?/gi, ''));
        changed = true;
      } else if (lk === 'set-cookie') {
        // Shown inside Keeper's window the server is a "third party", so its sign-in cookie must say it may be used there.
        headers[k] = headers[k]!.map((v) => (/samesite=none/i.test(v) ? v : `${v.replace(/;\s*samesite=[^;]*/gi, '')}; SameSite=None; Secure`));
        changed = true;
      }
    }
    cb(changed ? { responseHeaders: headers } : {});
  });
}

// ---------------------------------------------------------------- windows

function loadView(win: BrowserWindow, query: Record<string, string>) {
  if (DEV_URL) void win.loadURL(`${DEV_URL}?${new URLSearchParams(query)}`);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
}

export function openTerminalWindow(query: Record<string, string> = {}) {
  if (termWin && !termWin.isDestroyed()) {
    if (Object.keys(query).length) termWin.webContents.send('event:term-open', query);
    termWin.show();
    termWin.focus();
    return;
  }
  termWin = new BrowserWindow({
    width: 1100, height: 700, minWidth: 480, minHeight: 280, show: false, title: 'Terminal — Keeper',
    backgroundColor: '#14151b', icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true, backgroundThrottling: true },
  });
  loadView(termWin, { view: 'terminal', ...query });
  termWin.once('ready-to-show', () => termWin?.show());
  termWin.on('closed', () => (termWin = null));
}

/** The drop-down terminal: slides from the top of the screen with the mouse on it. */
export function toggleQuickTerminal() {
  const s = terminalSettings();
  if (quickWin && !quickWin.isDestroyed()) {
    if (quickWin.isVisible() && quickWin.isFocused()) quickWin.hide();
    else {
      place(quickWin, s.quickHeight);
      quickWin.show();
      quickWin.focus();
    }
    return;
  }
  quickWin = new BrowserWindow({
    show: false, frame: false, resizable: true, movable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false,
    backgroundColor: '#14151b', hasShadow: true,
    webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true, backgroundThrottling: true },
  });
  quickWin.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') quickWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadView(quickWin, { view: 'terminal', quick: '1' });
  place(quickWin, s.quickHeight);
  quickWin.once('ready-to-show', () => {
    quickWin?.show();
    quickWin?.focus();
  });
  quickWin.on('blur', () => {
    // Clicking elsewhere tucks it away again, like a drop-down terminal should.
    if (quickWin && !quickWin.webContents.isDevToolsOpened()) quickWin.hide();
  });
  quickWin.on('closed', () => (quickWin = null));
}

function place(win: BrowserWindow, share: number) {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = d.workArea;
  win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: Math.round(wa.height * share) });
}

export function registerTerminalShortcuts() {
  const s = terminalSettings();
  for (const acc of [lastQuick, lastWin]) if (acc) {
    try {
      globalShortcut.unregister(acc);
    } catch {
      /* not registered */
    }
  }
  const toAccel = (t: string) => (parseCombo(t, process.platform === 'darwin') ? t.replace(/CmdOrCtrl/gi, 'CommandOrControl') : '');
  lastQuick = toAccel(s.quickShortcut);
  lastWin = toAccel(s.windowShortcut);
  try {
    if (lastQuick) globalShortcut.register(lastQuick, toggleQuickTerminal);
  } catch {
    lastQuick = '';
  }
  try {
    if (lastWin) globalShortcut.register(lastWin, () => openTerminalWindow());
  } catch {
    lastWin = '';
  }
}
let lastQuick = '';
let lastWin = '';

// ---------------------------------------------------------------- remote files (side panel)

async function remoteTarget(t: RemoteTarget): Promise<RemoteTarget> {
  if (t.password) return t;
  const pw = await deps.getSecret(`remote:${t.protocol}://${t.target}`);
  return pw ? { ...t, password: pw } : t;
}

export const remoteFiles = {
  list: async (t: RemoteTarget, dir?: string) => remote.list(await remoteTarget(t), sshHosts(), dir),
  download: async (t: RemoteTarget, files: string[], toDir?: string) => remote.download(await remoteTarget(t), sshHosts(), files, toDir || app.getPath('downloads')),
  upload: async (t: RemoteTarget, files: string[], toDir: string) => remote.upload(await remoteTarget(t), sshHosts(), files, toDir),
  mkdir: async (t: RemoteTarget, dir: string) => remote.mkdir(await remoteTarget(t), sshHosts(), dir),
  remove: async (t: RemoteTarget, p: string, isDir: boolean) => remote.remove(await remoteTarget(t), sshHosts(), p, isDir),
  rename: async (t: RemoteTarget, from: string, to: string) => remote.rename(await remoteTarget(t), sshHosts(), from, to),
  /** Keeps a password in the system keychain (never in Keeper's files). */
  savePassword: async (t: RemoteTarget, password: string) => deps.setSecret(`remote:${t.protocol}://${t.target}`, password),
  disconnect: (t: RemoteTarget) => remote.disconnect(t),
};

// ---------------------------------------------------------------- start and stop

export function initTerminal(d: TerminalDeps) {
  deps = d;
  allowLocalFrames();
  registerTerminalShortcuts();
}

/** Keeper is quitting: keep terminals running (if asked) or end them with their scrollback saved. */
export async function stopTerminal(): Promise<void> {
  remote.closeAll();
  if (!client?.connected) return;
  if (terminalSettings().keepAlive === 'quit') {
    client.close();
    return;
  }
  try {
    await client.request({ t: 'shutdown', save: terminalSettings().saveScrollback }, 2000);
  } catch {
    /* it is going away anyway */
  }
  client.close();
}

export function revealPath(p: string) {
  shell.showItemInFolder(p);
}

export function shellKindFor(profileId?: string): 'posix' | 'cmd' | 'powershell' {
  const s = terminalSettings();
  const p = s.profiles.find((x) => x.id === (profileId ?? s.defaultProfile));
  if (!p) return process.platform === 'win32' ? 'powershell' : 'posix';
  const shellInfo = detectShells().find((x) => x.id === p.shell);
  if (shellInfo) return shellInfo.kind === 'cmd' ? 'cmd' : shellInfo.kind === 'powershell' ? 'powershell' : 'posix';
  return shellKindOf(p.command ?? (process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'));
}

/** For tests: the host's process id. */
export function hostPid(): number | undefined {
  return client?.hostPid;
}
