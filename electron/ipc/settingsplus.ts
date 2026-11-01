// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC, the keeper command and AI abilities for the settings catalogue, per-app
// controls and browser tab controls.

import { ipcMain } from 'electron';
import { registerAbility } from '../../core/abilities/registry';
import { settingById } from '../../core/settings-catalog';
import { featureOn } from '../services/features';
import { registerKeeperMethod, registerKeeperStream } from '../services/brain';
import { apply, catalogApi, onCatalogChanged, preview, readValues, reset } from '../services/settings-catalog';
import { appctlApi, startAppctl } from '../services/appctl';
import { allTabs, attach, browserTabsApi, detach, onBrowsersChanged, ping, reply, tabsReport } from '../services/browser-tabs';

type Fns = Record<string, (...a: never[]) => unknown>;
const handle = (prefix: string, api: object, feature: string) => {
  for (const [k, fn] of Object.entries(api as Fns)) {
    ipcMain.handle(`${prefix}.${k}`, async (_e, ...args) => {
      if (!featureOn(feature)) throw new Error('This is switched off in Settings → Features');
      return (fn as (...a: unknown[]) => unknown)(...args);
    });
  }
};

const str = (v: unknown) => String(v ?? '').slice(0, 200);

export function registerSettingsPlusIpc(deps: { broadcast: (ch: string, ...a: unknown[]) => void }) {
  handle('catalog', catalogApi, 'settingsCatalog');
  handle('appctl', appctlApi, 'appControls');
  handle('browserTabs', browserTabsApi, 'browserTabs');
  onCatalogChanged(() => deps.broadcast('catalog-changed'));
  onBrowsersChanged(() => deps.broadcast('browsers-changed'));

  // keeper settings search|get|preview|set|reset — the command line goes through the same checks.
  registerKeeperMethod('keeper/settings', async (p) => {
    if (!featureOn('settingsCatalog')) throw new Error('The settings catalogue is switched off in Settings → Features');
    const cmd = str(p.cmd || 'search');
    const args = (p.args as string[] | undefined) ?? [];
    if (cmd === 'search') return (await catalogApi.search(args.join(' '))).slice(0, 50).map((e) => ({ id: e.id, title: e.title, category: e.category }));
    if (cmd === 'get') return readValues(args);
    if (cmd === 'preview') return preview(args[0], args[1]);
    if (cmd === 'set') return apply(args[0], args[1], 'person');
    if (cmd === 'reset') return reset(args[0], 'person');
    if (cmd === 'log') return (await catalogApi.log()).slice(0, 50);
    throw new Error('Commands: search <words>, get <id…>, preview <id> <value>, set <id> <value>, reset <id>, log');
  });

  // The browser extension's link (through `keeper browser-host`).
  registerKeeperStream('keeper/browser.attach', (p, notify) => {
    if (!featureOn('browserTabs')) return { ended: true, reason: 'off' };
    return attach(p, notify);
  });
  registerKeeperMethod('keeper/browser.tabs', (p) => tabsReport(p));
  registerKeeperMethod('keeper/browser.reply', (p) => reply(p));
  registerKeeperMethod('keeper/browser.ping', (p) => ping(p));
  registerKeeperMethod('keeper/browser.detach', (p) => detach(p));

  // ---------------------------------------------------------------- abilities for any AI (permissions in Settings → Abilities)
  const os = process.platform;
  registerAbility({
    name: 'system_settings_search', label: 'Find system settings', group: 'System', defaultPermission: 'allow', network: 'never', readOnly: true,
    description: 'Searches Keeper\'s catalogue of system settings for this computer (Finder/Explorer, Dock/taskbar, keyboard, power, privacy, security, network, kernel, services…) and returns ids, titles and current values. Use before changing a setting.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    describe: (a) => `Search system settings for “${str(a.query)}”`,
  }, async (a) => {
    if (!featureOn('settingsCatalog')) return { content: 'The settings catalogue is switched off.', summary: 'off', isError: true };
    const hits = (await catalogApi.search(str(a.query))).slice(0, 15);
    const vals = new Map((await readValues(hits.map((h) => h.id))).map((v) => [v.id, v]));
    return { content: JSON.stringify(hits.map((h) => ({ id: h.id, title: h.title, description: h.description, kind: h.kind, on: h.on, off: h.off, choices: h.choices, min: h.min, max: h.max, current: vals.get(h.id)?.value, admin: h.admin, risk: h.risk, after: h.afterText }))), summary: `${hits.length} settings` };
  });
  registerAbility({
    name: 'system_settings_change', label: 'Change a system setting', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Changes one setting from Keeper\'s catalogue (ids from system_settings_search) to a value the entry allows. Keeper validates the value, backs up the area first, and logs the change so the person can undo it. Pass value "<reset>" to put the system default back.',
    parameters: { type: 'object', properties: { id: { type: 'string' }, value: { type: 'string' } }, required: ['id', 'value'] },
    describe: (a) => {
      const s = settingById(str(a.id));
      return s ? `Change “${s.title}” to ${str(a.value)}${s.admin ? ' (administrator password)' : ''}` : `Change setting ${str(a.id)}`;
    },
  }, async (a) => {
    if (!featureOn('settingsCatalog')) return { content: 'The settings catalogue is switched off.', summary: 'off', isError: true };
    const id = str(a.id);
    const s = settingById(id);
    if (!s || s.os !== os) return { content: 'No such setting on this computer', summary: 'unknown', isError: true };
    const r = str(a.value) === '<reset>' ? await reset(id, 'agent') : await apply(id, str(a.value), 'agent');
    return { content: r.ok ? `Done. ${r.message}. The person can undo it in System Settings+ → Changes.` : r.message, summary: r.ok ? `changed ${s.title}` : 'failed', isError: !r.ok };
  });
  registerAbility({
    name: 'browser_tabs', label: 'See browser tabs', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: true,
    description: 'Lists the tabs open in browsers linked to Keeper (title, address, whether it plays sound, data used, third parties it talks to).',
    parameters: { type: 'object', properties: {} },
    describe: () => 'See your open browser tabs',
  }, async () => {
    const t = allTabs().filter((x) => !x.incognito).slice(0, 200);
    return { content: JSON.stringify(t.map((x) => ({ session: x.session, id: x.id, browser: x.browser, title: x.title, url: x.url, audible: x.audible, muted: x.muted, asleep: x.discarded, bytes: x.bytes, parties: x.parties?.slice(0, 5).map((p) => p.host) }))), summary: `${t.length} tabs` };
  });
  registerAbility({
    name: 'browser_tab_action', label: 'Control a browser tab', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Mutes, unmutes, puts to sleep (frees memory), reloads, focuses or closes one tab from browser_tabs.',
    parameters: { type: 'object', properties: { session: { type: 'string' }, id: { type: 'number' }, action: { type: 'string', enum: ['mute', 'unmute', 'discard', 'reload', 'focus', 'close'] } }, required: ['session', 'id', 'action'] },
    describe: (a) => `${str(a.action)} a browser tab`,
  }, async (a) => {
    const r = await browserTabsApi.tab(str(a.session), Number(a.id), str(a.action) as never);
    return { content: r.ok ? 'Done' : r.message ?? 'Failed', summary: str(a.action), isError: !r.ok };
  });
  registerAbility({
    name: 'app_control', label: 'Limit or tune an app', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Per-app controls for a running app (from its name): network allow/deny, upload limit (kbps), CPU priority (low|below|normal|above|high), CPU limit (percent), memory limit (MB), pause/resume, start at login, keep the computer awake while it runs.',
    parameters: { type: 'object', properties: { app: { type: 'string' }, network: { type: 'string', enum: ['allow', 'deny'] }, bandwidthKbps: { type: 'number' }, priority: { type: 'string' }, cpuPercent: { type: 'number' }, memMB: { type: 'number' }, paused: { type: 'boolean' }, startAtLogin: { type: 'boolean' }, keepAwake: { type: 'boolean' } }, required: ['app'] },
    describe: (a) => `Change how ${str(a.app)} runs: ${Object.entries(a).filter(([k]) => k !== 'app').map(([k, v]) => `${k}=${String(v)}`).join(', ')}`,
  }, async (a) => {
    const name = str(a.app).toLowerCase();
    const target = (await appctlApi.running()).find((x) => x.name.toLowerCase() === name) ?? (await appctlApi.running()).find((x) => x.name.toLowerCase().includes(name));
    if (!target) return { content: `${str(a.app)} is not running`, summary: 'not running', isError: true };
    const { app: _a, ...patch } = a;
    const r = await appctlApi.set(target, patch as never);
    return { content: r.message, summary: r.ok ? `tuned ${target.name}` : 'failed', isError: !r.ok };
  });

  if (featureOn('appControls')) void startAppctl().catch(() => undefined);
}
