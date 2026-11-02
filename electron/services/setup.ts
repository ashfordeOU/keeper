// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// First-run setup in the main process: what this computer is like (for
// Recommended), applying the choice, and "setup is done" (which lets the
// library read every folder, not only Downloads).

import { app, ipcMain, screen } from 'electron';
import { existsSync, promises as fsp, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { choicePatch, FEATURES, featurePatch, featureStates, presetName, presetPatch, recommendedIds, type ComputerContext, type PresetId } from '../../core/features';
import { approvalsFor, type PermPlatform, type SetupApprovals } from '../../core/permissions';
import { run } from '../../core/platform';
import { settings, updateSettings } from '../store';
import { setLoginItem } from './login-item';

const HOME = os.homedir();
const PLATFORM = process.platform;

// ---------------------------------------------------------------- what this computer is like

const EXTRA_DIRS = PLATFORM === 'win32'
  ? [path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'bin'), path.join(process.env.APPDATA ?? '', 'npm')]
  : ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/snap/bin', path.join(HOME, '.local', 'bin'), path.join(HOME, '.npm-global', 'bin'), path.join(HOME, '.bun', 'bin'), path.join(HOME, '.cargo', 'bin')];

function onPath(cmd: string): boolean {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), ...EXTRA_DIRS].filter(Boolean);
  const exts = PLATFORM === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  return dirs.some((d) => exts.some((e) => existsSync(path.join(d, cmd + e))));
}

/** Coding tools a developer would have (git alone is not one: macOS and many Linux desktops ship it). */
function devTools(): string[] {
  const found: string[] = [];
  const apps = PLATFORM === 'darwin' ? ['/Applications', path.join(HOME, 'Applications')] : [];
  const macApp = (name: string) => apps.some((d) => existsSync(path.join(d, `${name}.app`)));
  if (onPath('code') || macApp('Visual Studio Code') || existsSync(path.join(process.env.LOCALAPPDATA ?? '/nonexistent', 'Programs', 'Microsoft VS Code'))) found.push('VS Code');
  if (onPath('cursor') || macApp('Cursor')) found.push('Cursor');
  if (onPath('claude') || existsSync(path.join(HOME, '.claude'))) found.push('Claude Code');
  if (onPath('codex') || existsSync(path.join(HOME, '.codex'))) found.push('Codex');
  if (onPath('copilot')) found.push('Copilot CLI');
  if (onPath('zed') || macApp('Zed')) found.push('Zed');
  if (macApp('Xcode')) found.push('Xcode');
  return found;
}

/** An Obsidian vault Obsidian knows about, or a folder of Markdown notes. */
function notesFolder(): string | undefined {
  const configs = [
    path.join(HOME, 'Library', 'Application Support', 'obsidian', 'obsidian.json'),
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(HOME, '.config'), 'obsidian', 'obsidian.json'),
    path.join(process.env.APPDATA ?? '/nonexistent', 'obsidian', 'obsidian.json'),
  ];
  for (const c of configs) {
    try {
      const vaults = Object.values((JSON.parse(readFileSync(c, 'utf8')) as { vaults?: Record<string, { path?: string }> }).vaults ?? {});
      const v = vaults.find((x) => x.path && existsSync(x.path));
      if (v?.path) return v.path;
    } catch { /* no Obsidian */ }
  }
  return undefined;
}

async function ollamaRunning(): Promise<boolean> {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

async function appleAI(): Promise<boolean> {
  if (PLATFORM !== 'darwin') return false;
  try {
    const { appleProvider } = await import('./platform');
    return (await appleProvider.available()).ok;
  } catch {
    return false;
  }
}

function hasNotch(): boolean {
  if (PLATFORM !== 'darwin') return false;
  try {
    // A built-in screen whose top inset is taller than the menu bar alone.
    return screen.getAllDisplays().some((d) => d.internal && d.workArea.y - d.bounds.y > 30);
  } catch {
    return false;
  }
}

async function musicRunning(): Promise<boolean> {
  if (PLATFORM !== 'darwin') return false;
  const r = await run('/usr/bin/pgrep', ['-x', 'Music'], 3000).catch(() => ({ ok: false }));
  return r.ok;
}

let cached: Promise<ComputerContext & { musicRunning: boolean; model: string }> | null = null;

/** What Recommended knows about this computer. Looked up once per run (in about a second). */
export function computerContext(): Promise<ComputerContext & { musicRunning: boolean; model: string }> {
  cached ??= (async () => {
    const [hw, apple, ollama, music, free] = await Promise.all([
      import('./usage-stats').then((m) => m.hardware()).catch(() => null),
      appleAI(),
      ollamaRunning(),
      musicRunning(),
      fsp.statfs(HOME).then((s) => (s.bavail * s.bsize) / 1e9).catch(() => undefined),
    ]);
    const battery = hw?.hasBattery ?? null;
    const docker = onPath('docker') || onPath('podman') || existsSync('/var/run/docker.sock');
    const monorail = PLATFORM === 'darwin' && ['/Applications/Monorail.app', path.join(HOME, 'Applications', 'Monorail.app')].some(existsSync);
    const notch = hasNotch();
    const model = PLATFORM === 'darwin'
      ? notch || battery ? 'MacBook' : 'Mac'
      : battery ? 'laptop' : PLATFORM === 'win32' ? 'PC' : 'computer';
    return {
      platform: PLATFORM,
      battery,
      notch,
      memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      cores: os.cpus().length,
      freeDiskGb: free === undefined ? undefined : Math.round(free),
      devTools: devTools(),
      docker,
      notesFound: notesFolder(),
      localAI: apple ? 'apple' : ollama ? 'ollama' : undefined,
      monorail,
      musicRunning: music,
      model,
    };
  })();
  return cached;
}

// ---------------------------------------------------------------- applying the choice

export type SetupChoice =
  | { preset: PresetId; declined?: ComputerContext['declined'] }
  | { parts: string[] };

export interface SetupExtras {
  login?: boolean;
  updates?: boolean;
  usageStats?: boolean;
}

export async function applySetup(choice: SetupChoice, extras: SetupExtras = {}): Promise<{ on: string[] }> {
  const s = settings();
  let patch;
  let pendingAI: 'apple' | 'ollama' | undefined;
  // Recommended, Light and Files only fetch only what their parts need whole; Everything and Choose may fetch parts of a component.
  let partly: boolean | undefined;
  if ('preset' in choice) {
    const id = presetName(choice.preset);
    const ctx = id === 'recommended' ? { ...(await computerContext()), declined: choice.declined } : undefined;
    patch = presetPatch(s, id, ctx);
    if (id !== 'everything') partly = false;
    // An AI on this computer, and the online one has no key yet: use the local one.
    if (ctx?.localAI && !ctx.declined?.includes('ai')) pendingAI = ctx.localAI;
  } else {
    const known = new Set(FEATURES.map((f) => f.id));
    patch = choicePatch(s, choice.parts.filter((p) => known.has(p)));
  }
  const features = { ...(patch.features ?? s.features) };
  if (extras.usageStats !== undefined) features.usageStats = extras.usageStats;
  if (extras.login !== undefined) features.login = extras.login;
  await updateSettings({ ...patch, features, ...(extras.updates !== undefined ? { updateCheck: extras.updates } : {}) });
  if (extras.login !== undefined) await setLoginItem(extras.login).catch(() => false);
  if (pendingAI && (await activeAINeedsKey())) await useLocalAI(pendingAI).catch(() => false);
  const on = [...featureStates(settings(), PLATFORM).values()].filter((f) => f.on).map((f) => f.id);
  // Downloads run on in the background (progress shows under the setup card); never blocks Next.
  void import('./components').then((m) => m.ensureComponentsFor(on, partly === false ? { partly: false } : {})).catch(() => undefined);
  return { on };
}

/**
 * Makes the AI on this computer Keeper's AI (Apple's own model, or Ollama) and turns on the
 * parts that use it. Recommended does this by itself when the AI picked now has no key.
 */
export async function useLocalAI(kind?: 'apple' | 'ollama'): Promise<boolean> {
  const which = kind ?? (await computerContext()).localAI;
  if (!which) return false;
  const s = settings();
  const brain = { ...s.brain, connections: [...s.brain.connections] };
  if (which === 'apple') {
    if (!brain.connections.some((c) => c.kind === 'platform')) brain.connections.push({ id: 'apple', kind: 'platform', label: 'Apple Intelligence (this Mac)', model: 'on-device' } as (typeof brain.connections)[number]);
    brain.active = brain.connections.find((c) => c.kind === 'platform')!.id;
  } else {
    if (!brain.connections.some((c) => c.id === 'ollama')) return false;
    brain.active = 'ollama';
  }
  let next = { ...settings(), brain };
  for (const id of ['assistant', 'writingHelp', 'islandAsk', 'brain']) next = { ...next, ...featurePatch(next, id, true) };
  await updateSettings({ brain: next.brain, features: next.features, island: next.island });
  return true;
}

/** Does the AI Keeper would use now still need a key (none saved)? */
async function activeAINeedsKey(): Promise<boolean> {
  const b = settings().brain;
  const c = b.connections.find((x) => x.id === b.active);
  if (!c || c.kind === 'platform' || c.kind === 'ollama') return false;
  try {
    const { hasSecret } = await import('../store');
    return !(await hasSecret(c.id));
  } catch {
    return true;
  }
}

/** The approvals the parts that are on need, tiered. */
export async function setupApprovals(parts?: string[]): Promise<SetupApprovals> {
  const on = parts ?? [...featureStates(settings(), PLATFORM).values()].filter((f) => f.on).map((f) => f.id);
  const ctx = await computerContext();
  let allowed = new Set<string>();
  try {
    const { listPermissions } = await import('./permissions');
    allowed = new Set((await listPermissions()).items.filter((i) => i.state === 'allowed').map((i) => i.id));
  } catch { /* not readable here */ }
  const plat = (['darwin', 'win32', 'linux'].includes(PLATFORM) ? PLATFORM : 'linux') as PermPlatform;
  return approvalsFor(plat, on, { musicRunning: ctx.musicRunning, allowed });
}

/** The first-run setup was finished or skipped. */
export async function finishSetup(): Promise<void> {
  if (!settings().setupDone) await updateSettings({ setupDone: true });
}

export function registerSetupIpc() {
  ipcMain.handle('setup.context', () => computerContext());
  ipcMain.handle('setup.recommended', async (_e, declined?: ComputerContext['declined']) => {
    return recommendedIds({ ...(await computerContext()), declined }, PLATFORM);
  });
  ipcMain.handle('setup.apply', (_e, choice: SetupChoice, extras?: SetupExtras) => applySetup(choice, extras ?? {}));
  ipcMain.handle('setup.approvals', (_e, parts?: string[]) => setupApprovals(Array.isArray(parts) ? parts.filter((p) => typeof p === 'string') : undefined));
  ipcMain.handle('setup.finish', () => finishSetup());
  ipcMain.handle('setup.useAI', (_e, kind?: 'apple' | 'ollama') => useLocalAI(kind === 'apple' || kind === 'ollama' ? kind : undefined));
  // Look the computer up early: setup's second screen needs it within seconds of opening.
  void app.whenReady().then(() => setTimeout(() => void computerContext(), 1500));
}
