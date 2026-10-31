// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper inside the operating system. Finds out what this computer offers,
// switches integrations on and off, and keeps them fed from the brain.

import { app, shell } from 'electron';
import path from 'node:path';
import {
  listIntegrations, parseKeeperUrl, searchInFromArgv, type Integration, type IntegrationId, type PlatformFacts, type PlatformSettings, type UrlAction,
} from '../../../core/platform-integrations';
import type { FileIndex } from '../../../core/indexer';
import { settings, updateSettings } from '../../store';
import { useNativeOcr } from '../vision';
import { getBrain, useIndex } from './brain-adapter';
import { desktopName, hasSessionBus, isInstalled, serve, setLinuxSearch, stopLinuxSearch } from './linux';
import { appleProvider, clearSpotlight, macHello, macOcr, pathFromSpotlightActivity, refreshMacHello, stopHelper, syncSpotlight } from './mac';
import { findOdr, hasPackageIdentity, registerWithOdr, setExplorerMenu, setJumpList, windowsBuild, windowsOcr, windowsOcrLanguages } from './windows';
import type { ProviderDeps } from './dbus-providers';

export { appleProvider };
export type { PlatformChatProvider } from './mac';

export interface PlatformDeps {
  index: () => FileIndex | undefined;
  /** opens the main window, optionally at a route such as "search:tax" or "assistant:question" */
  showMain(route?: string): void;
  /** opens Quick Search; with text it starts in ask mode */
  ask(question?: string): void;
}

let deps: PlatformDeps | null = null;
let facts: PlatformFacts | null = null;

/** How another program can start Keeper's MCP server (the keeper command through Keeper's own runtime). */
export function mcpLaunch(): { command: string; args: string[]; env: Record<string, string> } {
  if (!app.isPackaged) return { command: 'node', args: [path.join(app.getAppPath(), 'dist-cli', 'keeper.cjs'), 'mcp'], env: {} };
  const exe = process.env.APPIMAGE || process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  return { command: exe, args: [path.join(process.resourcesPath, 'app.asar', 'dist-cli', 'keeper.cjs'), 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/** A ready-to-paste MCP client entry, in the format most AI apps and editors use. */
export function mcpConfigSnippet(): string {
  const l = mcpLaunch();
  return JSON.stringify({ mcpServers: { keeper: { command: l.command, args: l.args, ...(Object.keys(l.env).length ? { env: l.env } : {}) } } }, null, 2);
}

async function gatherFacts(): Promise<PlatformFacts> {
  const f: PlatformFacts = { platform: process.platform, mcpCommand: 'keeper mcp' };
  if (process.platform === 'darwin') {
    const h = await macHello();
    f.helper = !!h;
    f.macVersion = h?.macos;
    f.arm = h?.arm ?? process.arch === 'arm64';
    f.appleModel = h?.appleModel;
  } else if (process.platform === 'win32') {
    f.winBuild = windowsBuild();
    f.winOcr = (await windowsOcrLanguages()).length > 0;
    f.odr = !!(await findOdr());
    f.winPackaged = hasPackageIdentity();
  } else if (process.platform === 'linux') {
    f.desktop = desktopName();
    f.sessionBus = hasSessionBus();
  }
  return f;
}

export async function platformList(refresh = false): Promise<Integration[]> {
  if (refresh || !facts) {
    if (refresh && process.platform === 'darwin') await refreshMacHello();
    facts = await gatherFacts();
  }
  return listIntegrations(facts, settings().platform);
}

function providerDeps(): ProviderDeps {
  return {
    home: process.env.HOME,
    search: (q, limit) => getBrain().search({ query: q, limit }),
    open: (p) => void shell.openPath(p),
    reveal: (p) => shell.showItemInFolder(p),
    searchInKeeper: (q) => deps?.showMain(`search:${q}`),
  };
}

const SETTING: Partial<Record<IntegrationId, keyof PlatformSettings>> = {
  spotlight: 'spotlight', 'gnome-search': 'gnomeSearch', krunner: 'krunner', 'explorer-menu': 'explorerMenu', 'mac-ocr': 'nativeOcr', 'win-ocr': 'nativeOcr',
};

/** Switches an integration on or off; returns the new list and a message when something did not work. */
export async function platformSet(id: IntegrationId, on: boolean): Promise<{ list: Integration[]; message?: string }> {
  const key = SETTING[id];
  if (!key) return { list: await platformList() };
  let message: string | undefined;
  if (id === 'spotlight') {
    if (on) void spotlightSoon(0);
    else await clearSpotlight();
  } else if (id === 'gnome-search' || id === 'krunner') {
    const r = await setLinuxSearch(id === 'gnome-search' ? 'gnome' : 'krunner', on, providerDeps());
    if (!r.ok) message = r.message;
  } else if (id === 'explorer-menu') {
    if (!(await setExplorerMenu(on))) message = 'Windows did not accept the menu entry';
  }
  await updateSettings({ platform: { ...settings().platform, [key]: on } });
  return { list: await platformList(), message };
}

/** One-off actions: copy the MCP setup, register with Windows' agent registry, open Shortcuts. */
export async function platformAction(id: string): Promise<{ ok: boolean; message?: string; copy?: string }> {
  if (id === 'copy-mcp') return { ok: true, copy: mcpConfigSnippet(), message: 'Copied. Paste it into your AI app’s MCP settings.' };
  if (id === 'copy-links') {
    return { ok: true, message: 'Copied examples.', copy: ['keeper://search?q=invoices%20from%20last%20month', 'keeper://ask?q=when%20does%20my%20passport%20expire', 'keeper://open?path=/full/path/to/file.pdf', 'keeper://reveal?path=/full/path/to/file.pdf', 'keeper search "tax 2025"', 'keeper mcp'].join('\n') };
  }
  if (id === 'open-shortcuts') {
    await shell.openExternal('shortcuts://create-shortcut');
    return { ok: true };
  }
  if (id === 'register-odr') {
    const l = mcpLaunch();
    return registerWithOdr(l);
  }
  return { ok: false, message: 'Unknown action' };
}

/** The system's own text recognition when switched on and available; undefined to use the built-in reader. */
export async function nativeOcr(file: string, languages: string[]): Promise<string | undefined> {
  if (!settings().platform?.nativeOcr) return undefined;
  if (process.platform === 'darwin') return macOcr(file, languages);
  if (process.platform === 'win32') return windowsOcr(file);
  return undefined;
}

// ---------------------------------------------------------------- Spotlight upkeep

let spotTimer: NodeJS.Timeout | undefined;
function spotlightSoon(ms = 30_000) {
  if (process.platform !== 'darwin' || !settings().platform?.spotlight) return;
  clearTimeout(spotTimer);
  spotTimer = setTimeout(() => {
    const files = deps?.index()?.all() ?? [];
    void syncSpotlight(files).catch(() => undefined);
  }, ms);
}

/** Call when the library changes; integrations that mirror it catch up shortly after. */
export function platformLibraryChanged() {
  spotlightSoon();
}

// ---------------------------------------------------------------- links

/**
 * keeper://ask and keeper://reveal; false for everything else, which main.ts
 * handles (keeper://search, keeper://open shows the file in Keeper, …).
 */
export function handlePlatformUrl(url: string): boolean {
  const a: UrlAction | null = parseKeeperUrl(url);
  if (a?.action === 'ask') deps?.ask(a.q);
  else if (a?.action === 'reveal') shell.showItemInFolder(a.path);
  else return false;
  return true;
}

/** "Search with Keeper" from File Explorer passes the folder on the command line. */
export function handlePlatformArgv(argv: string[]): boolean {
  const dir = searchInFromArgv(argv);
  if (!dir) return false;
  deps?.showMain(`browse:${dir}`);
  return true;
}

/** Started by the desktop only to answer a search (D-Bus activation): stay in the background. */
export const startedForSearch = process.argv.includes('--keeper-dbus');

export async function initPlatform(d: PlatformDeps) {
  deps = d;
  useIndex(d.index);
  useNativeOcr(nativeOcr);
  const s = settings().platform;
  if (process.platform === 'win32') setJumpList();
  if (process.platform === 'darwin') {
    app.on('continue-activity', (e, type, info) => {
      const p = pathFromSpotlightActivity(type, info);
      if (!p) return;
      e.preventDefault();
      shell.showItemInFolder(p);
    });
    if (s.spotlight) spotlightSoon(60_000);
  }
  if (process.platform === 'linux') {
    for (const kind of ['gnome', 'krunner'] as const) {
      const on = kind === 'gnome' ? s.gnomeSearch : s.krunner;
      if (on && (await isInstalled(kind))) void serve(kind, providerDeps());
    }
  }
}

export function stopPlatform() {
  stopLinuxSearch();
  stopHelper();
  clearTimeout(spotTimer);
}
