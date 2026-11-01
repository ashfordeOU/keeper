// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Actions other parts of the system can ask Keeper for: Siri, Spotlight and
// Shortcuts (through the small "Keeper Intents" helper app on macOS), desktop
// assistants and launchers on Linux (D-Bus org.ashfordeou.Keeper.Actions),
// and anything else that opens keeper:// links.
//
//   keeper://go?page=health          open a page (health, cleanup, agents…)
//   keeper://focus?minutes=25        start the focus timer (minutes=0 stops it)
//   keeper://lock-all                lock every unlocked folder again
//   keeper://automation?name=…       run a saved automation by name or id
//
// Asking and searching return text, so they go through the keeper command
// instead (keeper ask --plain, keeper search --brain --json).

import { spawn } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface IntentDeps {
  showMain: (route?: string) => void;
  focus: (action: 'start' | 'stop', minutes?: number) => void;
  runRule: (idOrName: string) => Promise<unknown>;
  relockAll: () => Promise<number>;
}

/** Pages a link or an assistant may open. */
export const PAGES = ['home', 'recents', 'search', 'downloads', 'cleanup', 'duplicates', 'space', 'large', 'health', 'startup', 'apps', 'protection', 'rules', 'history', 'assistant', 'agents', 'graph', 'settings', 'weather', 'terminal', 'sync', 'devices', 'netactivity', 'vpn', 'trash', 'network', 'capture', 'tools', 'widgets', 'island'] as const;

/** Handles the links above; false when the link is not one of them. */
export function handleIntentUrl(url: string, d: IntentDeps): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'keeper:') return false;
  const action = u.hostname || u.pathname.replace(/^\/+/, '');
  const q = (k: string) => u.searchParams.get(k) ?? undefined;
  switch (action) {
    case 'go': {
      const page = (q('page') ?? 'home').toLowerCase();
      if (!(PAGES as readonly string[]).includes(page)) return false;
      d.showMain(page);
      return true;
    }
    case 'focus': {
      const m = Number(q('minutes') ?? 25);
      if (m === 0) d.focus('stop');
      else d.focus('start', Math.max(1, Math.min(240, Number.isFinite(m) ? m : 25)));
      return true;
    }
    case 'lock-all':
      void d.relockAll();
      return true;
    case 'automation': {
      const n = q('name') ?? q('id');
      if (!n) return false;
      void d.runRule(n).catch(() => undefined);
      return true;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------- macOS: registering the Siri/Shortcuts helper

/** Keeper Intents.app inside Keeper.app, when this build has it. */
export function intentsHelperPath(): string | undefined {
  if (process.platform !== 'darwin' || !app.isPackaged) return undefined;
  const p = path.join(path.dirname(app.getPath('exe')), '..', 'Library', 'Helpers', 'Keeper Intents.app');
  return existsSync(p) ? p : undefined;
}

const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

/**
 * Tells macOS about the helper (so Shortcuts, Siri and Spotlight list Keeper's
 * actions) and starts it once in the background, where it publishes its
 * phrases and quits. Done once per Keeper version.
 */
export async function registerIntentsHelper(): Promise<'registered' | 'absent' | 'current'> {
  const helper = intentsHelperPath();
  if (!helper) return 'absent';
  const mark = path.join(app.getPath('userData'), 'intents-registered');
  if ((await fsp.readFile(mark, 'utf8').catch(() => '')).trim() === app.getVersion()) return 'current';
  await new Promise<void>((resolve) => {
    const p = spawn(LSREGISTER, ['-f', helper], { stdio: 'ignore' });
    p.on('error', () => resolve());
    p.on('exit', () => resolve());
  });
  spawn('/usr/bin/open', ['-g', '-j', helper, '--args', '--register'], { stdio: 'ignore', detached: true }).unref();
  await fsp.writeFile(mark, app.getVersion()).catch(() => undefined);
  return 'registered';
}
