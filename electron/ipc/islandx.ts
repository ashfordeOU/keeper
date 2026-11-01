// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Island+ IPC: calls, levels, notifications status, agent hooks, breaks and
// the ruler, shuffle and repeat, the tool launcher button, hide for a minute.

import { ipcMain } from 'electron';
import { registerAbility } from '../../core/abilities/registry';
import { IslandPlus } from '../services/island-plus';
import type { IslandService } from '../services/island';
import { startBreak } from '../../core/island';
import { settings } from '../store';

export interface IslandXContext {
  islandSvc: IslandService;
  emit(): void;
  openLauncher?(): void;
  show(route?: string): void;
}

let plus: IslandPlus | null = null;

export function islandPlus(): IslandPlus | null {
  return plus;
}

export function registerIslandXIpc(c: IslandXContext) {
  plus = new IslandPlus(c.islandSvc, c.emit);
  plus.openLauncher = c.openLauncher;
  c.islandSvc.plus = plus;
  plus.start();
  const p = plus;
  const h = (name: string, fn: (...args: never[]) => unknown) => ipcMain.handle(`islandx.${name}`, (_e, ...args) => fn(...(args as never[])));
  h('status', () => p.status());
  h('callMute', (m: boolean) => p.callMute(m));
  h('callDismiss', () => p.callDismiss());
  h('hideFor', (min: number) => p.hideFor(Number(min) || 1));
  h('installAgentHooks', (id: string) => p.installAgentHooks(id));
  h('removeAgentHooks', (id: string) => p.removeAgentHooks(id));
  h('openNotifyPermission', () => p.openNotifyPermission());
  h('testNotification', () => c.islandSvc.alert({ kind: 'notification', app: 'Keeper', title: 'This is how notifications look', detail: 'Other apps’ notifications show here when the mirror is on.' }));
  h('startBreak', (long: boolean) => {
    const s = c.islandSvc;
    s.focus = startBreak({ ...s.focus, longBreakMin: settings().island.longBreakMin ?? 15 }, !!long);
    c.emit();
  });
  h('focusFor', (min: number) => c.islandSvc.focusAction('start', Math.max(1, Math.min(180, Math.round(Number(min) || 25)))));
  h('mediaMode', (what: 'shuffle' | 'repeat') => c.islandSvc.media(what));
  h('openLauncher', () => p.openLauncher?.());
  h('showPage', (route: string) => c.show(String(route ?? '')));

  registerAbility({
    name: 'call_mute', label: 'Mute or unmute the microphone', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Mutes or unmutes the microphone for the call in progress (or the system microphone when there is no call). Returns the call app and how long it has run.',
    parameters: { type: 'object', properties: { muted: { type: 'boolean' } }, required: ['muted'] },
    describe: (a) => (a.muted ? 'Mute the microphone' : 'Unmute the microphone'),
  }, async (a) => {
    const r = await p.callMute(!!a.muted);
    const call = p.call;
    return { content: JSON.stringify({ ...r, call: call ? { app: call.app, since: new Date(call.since).toISOString() } : null }), summary: r.muted ? 'Muted' : 'Unmuted' };
  });
  registerAbility({
    name: 'island_agents', label: 'Coding agents’ status', group: 'Work', defaultPermission: 'allow', network: 'never', readOnly: true,
    description: 'Lists the coding agents running on this computer (Claude Code, Codex, Cursor, Gemini CLI, OpenCode and any agent with Keeper’s status hook) with their project and whether they are working, waiting for permission, done or stuck.',
    parameters: { type: 'object', properties: {} },
    describe: () => 'List coding agents’ status',
  }, async () => {
    const list = c.islandSvc.agents.map((a) => ({ tool: a.tool, project: a.project, state: a.state, summary: a.summary, updated: new Date(a.updatedAt).toISOString() }));
    return { content: JSON.stringify(list), summary: `${list.length} agents` };
  });
}

export function stopIslandX() {
  plus?.stop();
}
