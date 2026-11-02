// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Settings → Ashforde apps, and where Monorail meets the rest of
// Keeper: the feature switch, the Island, the To do list, AI tools and the theme.

import { ipcMain } from 'electron';
import { ASHFORDE_APPS, offeredOn } from '../../core/ashforde/apps';
import type { AshfordeOverview } from '../../core/api-ashforde';
import type { Finding } from '../../core/guide/types';
import * as mono from '../services/ashforde/monorail';
import * as coexist from '../services/ashforde/coexist';
import { poll } from '../services/governor';
import { patchAtPath } from '../../core/ashforde/coexist';
import { featurePatch } from '../../core/features';
import { setAwakePeer } from '../services/awake';
import { registerKeeperMethod } from '../services/brain';
import { requestApproval, setToolProvider } from '../services/agents';
import { featureOn, onFeature } from '../services/features';
import { open as openGuide, registerFindings } from '../services/guide';
import { setPlacementAdjust } from '../services/island-place';
import { STOP_SHORTCUT } from '../services/computer';
import { settings, updateSettings } from '../store';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

const LINKS = new Set(['settings', 'palette', 'welcome', 'pomodoro', 'focus-mode', 'presentation-mode', 'workspace', 'layout', 'snapshot', 'pair', 'template', 'profile', 'launch', 'focus-app', 'notify']);

/** What Keeper's other parts lend to Monorail's side (Focus, presentation, Keep Awake, Stage). */
export interface AshfordeCtx {
  broadcast: (channel: string, ...args: unknown[]) => void;
  alert: (title: string, detail?: string) => void;
  coexist?: coexist.CoexistDeps;
}

export function registerAshfordeIpc(c: AshfordeCtx) {
  if (c.coexist) coexist.initCoexist(c.coexist);
  // One hold on staying awake, not two (Monorail's Stay Awake): only on a Mac, where Monorail runs.
  if (mono.isMac()) setAwakePeer({ before: () => coexist.awakeBefore(), after: () => coexist.awakeAfter(), handoff: (ack) => coexist.awakeHandoffDone(ack), ready: () => void coexist.hello() });
  // The handshake: what Keeper says about itself on its own channel (`keeper hello`, and Monorail when it asks).
  registerKeeperMethod('keeper/hello', () => coexist.helloPayload());
  void mono.init({
    settings: () => settings() as never,
    broadcast: c.broadcast,
    alert: c.alert,
    approve: (client, action, description, destructive) => requestApproval(client, action, description, destructive),
    fixedShortcuts: { 'Stop using the computer': STOP_SHORTCUT },
  }).then(() => {
    // Off by default; on a Mac only. Off means no watch, no timers, no tools.
    onFeature('monorail', (on) => void mono.setEnabled(on).then(() => { if (on) void coexist.hello(); }), { now: true });
    // Monorail found for the first time: the two work together from now on (once; turning it
    // off in Features is remembered and never undone). Window coexistence never needs the switch.
    void mono.claimAutoOn().then(async (first) => {
      if (!first || featureOn('monorail')) return;
      await updateSettings(featurePatch(settings(), 'monorail', true));
      await mono.connect().catch(() => undefined);
      c.alert('Keeper and Monorail now work together', 'Focus, presentation and Keep Awake stay in step, and Monorail shows in the Island. Turn this off in Keeper → Settings → Features.');
    }).catch(() => undefined);
    // Monorail keeps Keeper's hello in memory only: say it again whenever Monorail's API
    // starts (relaunch, crash, its own update), forget Monorail when its API stops, and
    // say it every ten minutes as a safety net.
    mono.onApiRestarted((up) => (up ? void coexist.hello() : coexist.forgetPeer()));
    // Monorail is Mac-only, so other systems do not even list the check.
    if (process.platform === 'darwin') poll('monorail.rehello', { baseMs: 10 * 60_000, idleFactor: 1, pauseWhenLocked: true }, () => (mono.enabledNow() ? coexist.hello() : undefined), { feature: 'monorail', now: false });
  });

  setToolProvider('monorail', { tools: () => mono.tools() as never, call: (name, args, client) => mono.callTool(name, args, client) });
  setPlacementAdjust((p, workArea) => mono.adjustPlacement(p, workArea));

  registerFindings('monorail', async (): Promise<Finding[]> => {
    if (!featureOn('monorail') || !mono.isMac()) return [];
    const s = await mono.status();
    const out: Finding[] = [];
    // Monorail's own updater offers its updates unless it is switched off there: never both.
    if (s.installed && s.update && s.updatesBy === 'keeper') {
      out.push({ id: 'monorail:update', source: 'monorail', area: 'updates', severity: 'low', title: `Monorail ${s.update.version} is available`, why: 'Updates bring fixes and new features. Keeper checks the download and its signature before installing it.', fix: { kind: 'page', route: { name: 'settings', arg: 'ashforde' }, label: 'Update Monorail' } });
    }
    for (const k of s.clashes) {
      out.push({ id: `monorail:clash:${k.keeper}`, source: 'monorail', area: 'performance', severity: 'medium', title: `Keeper and Monorail both use ${k.label}`, why: `Keeper uses it for ${k.keeper} and Monorail for ${k.monorail}. Only one of them gets it, so the other one silently stops working.${k.suggestionLabel ? ` ${k.suggestionLabel} is free in both; Settings → Ashforde apps switches Keeper to it in one click.` : ''}`, fix: { kind: 'page', route: { name: 'settings', arg: 'ashforde' }, label: 'Change a shortcut' } });
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
  handle('ashforde.useShortcut', async (setting: string, accelerator: string) => {
    if (!/shortcut/i.test(String(setting)) || typeof accelerator !== 'string' || !accelerator.includes('+')) throw new Error('That is not one of Keeper’s shortcuts.');
    const patch = patchAtPath(settings() as never, String(setting), accelerator);
    if (!patch) throw new Error('That shortcut setting was not found.');
    await updateSettings(patch as never);
    return mono.status(true);
  });
  handle('ashforde.coexist', () => coexist.coexistStatus());
}

/** Keeper's theme changed (settings save). */
export function ashfordeThemeChanged() {
  void mono.syncTheme(settings() as never).catch(() => undefined);
}

export { keeperFocus as monorailFocusChanged, keeperPresentation as monorailPresentationChanged } from '../services/ashforde/coexist';
export { monorailLine, onMonorailState, monorailState } from '../services/ashforde/monorail';
