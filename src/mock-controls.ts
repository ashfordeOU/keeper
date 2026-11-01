// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Quick Controls in the browser demo: a Mac on café Wi-Fi, with the same
// catalog, presets, weakening checks and undo as the app.

import type { ControlsApi, ControlsResult, ControlsView } from '../core/api-controls';
import { CONTROLS, CONTROL_BY_ID, PRESET_BY_ID, PRESETS } from '../core/controls/catalog';
import { doable, planValues, undoChanges, weakeningWarning } from '../core/controls/plan';
import type { ControlState, ControlValue, LogEntry } from '../core/controls/types';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mockControls(emit: (channel: string, ...args: unknown[]) => void): { controls: ControlsApi } {
  const values: Record<string, ControlValue | null> = {
    wifi: true, vpn: false, ipv6: true, airdrop: true, wakeOnLan: true, osFirewall: false, stealth: false, blockIncoming: false,
    keeperFwMode: 'alert', keeperEnforce: false, dnsFilter: false, blocklists: false, diagnostics: true, realtime: true, autoQuarantine: false,
    gatekeeper: true, autoUpdates: true,
  };
  const log: LogEntry[] = [];
  const bindings: Record<string, string> = {};
  const states = (): ControlState[] => CONTROLS.map((d) => ({ id: d.id, value: values[d.id] ?? null, how: d.support.darwin.how, note: d.support.darwin.note }));
  const view = (): ControlsView => ({ os: 'darwin', defs: CONTROLS, states: states(), presets: PRESETS, log, bindings, profiles: [{ id: 'home', name: 'Home', active: false }, { id: 'public', name: 'Public Wi-Fi', active: true }], dryRun: false, readAt: Date.now() });

  const apply = async (title: string, want: Record<string, ControlValue>, confirm?: boolean): Promise<ControlsResult> => {
    const plan = planValues(want, new Map(states().map((s) => [s.id, s])));
    const weak = plan.items.filter((i) => i.weakening);
    if (weak.length && !confirm) return { ok: false, message: 'Confirm first', needsConfirm: { warnings: weak.map((i) => weakeningWarning(CONTROL_BY_ID.get(i.id)!, i.to)) } };
    const todo = doable(plan.items);
    const guided = plan.items.filter((i) => i.how === 'guide');
    if (!todo.length) return { ok: !guided.length, message: guided.length ? `${guided.map((g) => g.label).join(', ')}: change in System Settings (the demo cannot open it).` : 'Already as asked.', view: view() };
    await wait(todo.some((i) => i.how === 'admin') ? 600 : 150);
    for (const i of todo) values[i.id] = i.to;
    log.unshift({ id: String(Date.now()), at: Date.now(), title, changes: todo.map((i) => ({ id: i.id, from: i.from, to: i.to })) });
    emit('controls-changed');
    return { ok: true, message: `Changed: ${todo.map((i) => i.label).join(', ')}.`, view: view() };
  };

  return {
    controls: {
      list: async () => view(),
      set: (id, value, opts) => apply(`${CONTROL_BY_ID.get(id)?.label ?? id}`, { [id]: value }, opts?.confirmWeaker),
      preview: async (id) => planValues(PRESET_BY_ID.get(id)!.values, new Map(states().map((s) => [s.id, s]))),
      applyPreset: (id, opts) => apply(`Preset: ${PRESET_BY_ID.get(id)!.name}`, PRESET_BY_ID.get(id)!.values, opts?.confirmWeaker),
      undo: async (id, opts) => {
        const e = log.find((x) => x.id === id);
        if (!e) return { ok: false, message: 'Gone' };
        const r = await apply(`Undo: ${e.title}`, Object.fromEntries(undoChanges(e).map((c) => [c.id, c.to])), opts?.confirmWeaker);
        if (r.ok) e.undone = true;
        return { ...r, view: view() };
      },
      open: async () => ({ ok: false, message: 'The demo cannot open System Settings.' }),
      bind: async (profile, preset) => { if (preset) bindings[profile] = preset; else delete bindings[profile]; return view(); },
      perApp: async () => ({ grants: [
        { app: 'zoom.us', service: 'camera', raw: 'kTCCServiceCamera', allowed: true, source: 'tcc' },
        { app: 'zoom.us', service: 'microphone', raw: 'kTCCServiceMicrophone', allowed: true, source: 'tcc' },
        { app: 'Slack', service: 'microphone', raw: 'kTCCServiceMicrophone', allowed: false, source: 'tcc' },
      ], notes: [] }),
      perAppSet: async () => ({ ok: false, message: 'The demo cannot change app permissions.' }),
      showPage: async () => undefined,
    },
  };
}
