// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Settings → Ashforde apps, and where Monorail meets the rest of
// Keeper: the feature switch, the Island, the To do list, AI tools and the theme.

import { ipcMain } from 'electron';
import { ASHFORDE_APPS, offeredOn } from '../../core/ashforde/apps';
import type { AshfordeOverview } from '../../core/api-ashforde';
import type { Finding } from '../../core/guide/types';
import * as mono from '../services/ashforde/monorail';
import { requestApproval, setToolProvider } from '../services/agents';
import { featureOn, onFeature } from '../services/features';
import { open as openGuide, registerFindings } from '../services/guide';
import { setPlacementAdjust } from '../services/island-place';
import { STOP_SHORTCUT } from '../services/computer';
import { settings } from '../store';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

const LINKS = new Set(['settings', 'palette', 'welcome', 'pomodoro', 'focus-mode', 'presentation-mode', 'workspace', 'layout', 'snapshot', 'pair', 'template', 'profile', 'launch', 'focus-app', 'notify']);

export function registerAshfordeIpc(c: { broadcast: (channel: string, ...args: unknown[]) => void; alert: (title: string, detail?: string) => void }) {
  void mono.init({
    settings: () => settings() as never,
    broadcast: c.broadcast,
    alert: c.alert,
    approve: (client, action, description, destructive) => requestApproval(client, action, description, destructive),
    fixedShortcuts: { 'Stop using the computer': STOP_SHORTCUT },
  }).then(() => {
    // Off by default; on a Mac only. Off means no watch, no timers, no tools.
    onFeature('monorail', (on) => void mono.setEnabled(on), { now: true });
  });

  setToolProvider('monorail', { tools: () => mono.tools() as never, call: (name, args, client) => mono.callTool(name, args, client) });
  setPlacementAdjust((p, workArea) => mono.adjustPlacement(p, workArea));

  registerFindings('monorail', async (): Promise<Finding[]> => {
    if (!featureOn('monorail') || !mono.isMac()) return [];
    const s = await mono.status();
    const out: Finding[] = [];
    if (s.installed && s.update) {
      out.push({ id: 'monorail:update', source: 'monorail', area: 'updates', severity: 'low', title: `Monorail ${s.update.version} is available`, why: 'Updates bring fixes and new features. Keeper checks the download and its signature before installing it.', fix: { kind: 'page', route: { name: 'settings', arg: 'ashforde' }, label: 'Update Monorail' } });
    }
    for (const k of s.clashes) {
      out.push({ id: `monorail:clash:${k.keeper}`, source: 'monorail', area: 'performance', severity: 'medium', title: `Keeper and Monorail both use ${k.label}`, why: `Keeper uses it for ${k.keeper} and Monorail for ${k.monorail}. Only one of them gets it, so the other one silently stops working.`, fix: { kind: 'page', route: { name: 'settings', arg: 'ashforde' }, label: 'Change a shortcut' } });
    }
    if (s.installed && s.signature && !s.signature.ok) {
      out.push({ id: 'monorail:signature', source: 'monorail', area: 'security', severity: 'high', title: 'Monorail’s signature does not check out', why: `${s.signature.reason} Reinstall it from Settings → Ashforde apps so you have the real one.`, fix: { kind: 'page', route: { name: 'settings', arg: 'ashforde' }, label: 'Reinstall Monorail' } });
    }
    return out;
  });

  const overview = (): AshfordeOverview => ({
    platform: process.platform,
    apps: ASHFORDE_APPS.map((a) => ({ id: a.id, name: a.name, tagline: a.tagline, description: a.description, homepage: a.homepage, offered: offeredOn(a, process.platform), elsewhere: a.elsewhere, together: a.together, enabled: featureOn(a.id) })),
  });

  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (!mono.isMac()) throw new Error('Monorail runs on macOS for now.');
    return fn();
  };

  handle('ashforde.overview', () => overview());
  handle('ashforde.monorail', () => mono.status(true));
  handle('ashforde.install', () => guard(() => mono.install()));
  handle('ashforde.update', () => guard(() => mono.update()));
  handle('ashforde.checkUpdate', () => guard(() => mono.checkUpdate()));
  handle('ashforde.uninstall', (removeSettings?: boolean) => guard(() => mono.uninstall(!!removeSettings)));
  handle('ashforde.launch', () => guard(() => mono.launch()));
  handle('ashforde.quit', () => guard(() => mono.quit()));
  handle('ashforde.connect', () => guard(() => mono.connect()));
  handle('ashforde.openPermission', (topic: string) => openGuide({ topic }));
  handle('ashforde.action', async (kind: string, arg?: string | number | boolean) => {
    if (!LINKS.has(kind)) return { ok: false, message: 'Unknown Monorail action' };
    if (!featureOn('monorail')) return { ok: false, message: 'Switch Monorail on in Settings → Ashforde apps first.' };
    const link = kind === 'focus-mode' || kind === 'presentation-mode' ? { kind, on: arg !== false && arg !== 'off' }
      : kind === 'workspace' ? { kind, n: Number(arg) || 1 }
      : ['settings', 'palette', 'welcome', 'pomodoro'].includes(kind) ? { kind }
      : { kind, arg: String(arg ?? '') };
    const ok = await mono.openLink(link as never);
    return ok ? { ok } : { ok, message: 'Monorail did not open the link. Is it installed?' };
  });
  handle('ashforde.prefs', () => mono.prefs());
  handle('ashforde.setPrefs', (patch: Parameters<typeof mono.setPrefs>[0]) => mono.setPrefs(patch));
}

/** Keeper's theme changed (settings save). */
export function ashfordeThemeChanged() {
  void mono.syncTheme(settings() as never).catch(() => undefined);
}

export { focusChanged as monorailFocusChanged, presentationChanged as monorailPresentationChanged, monorailLine, onMonorailState, monorailState } from '../services/ashforde/monorail';
