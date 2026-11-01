// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's computer use: a task with a plan, a hidden browser tab,
// a saved sign-in and a recorded workflow.

import type { CuApi, CuSettingsView, CuState } from '../core/api-cu';
import { DEFAULT_ASK_BEFORE, SENSITIVE_LABEL } from '../core/cu/guard';
import { parsePlan, advance, planText } from '../core/cu/run';

export function mockCu(): { cu: CuApi } {
  const now = Date.now();
  let plan = parsePlan('Download October invoices from the shop', '1. Open the shop and sign in\n2. Go to Orders → October\n3. Download each invoice into Invoices\n4. Tell the person how many there were');
  plan = advance(advance(plan, 1, 'done'), 2, 'done');
  const settings: CuSettingsView = {
    askBefore: DEFAULT_ASK_BEFORE, showTabs: false, maxSteps: 120, maxMinutes: 20, mcpScreenshots: 'images', phoneApprovals: true, labels: SENSITIVE_LABEL,
    secrets: [{ name: 'shop-login', sites: ['shop.example.com'], source: 'keychain', note: 'Shop sign-in' }, { name: 'work-email', sites: ['mail.example.org'], source: 'op', ref: 'op://Work/Email/password' }],
  };
  const state: CuState = {
    tabs: [{ id: 'a1b2c3d4', client: 'Claude Code', url: 'https://shop.example.com/orders?month=10', title: 'Your orders — October', visible: false, takenOver: false, recording: false, steps: 14, downloads: ['/Users/demo/Downloads/invoice-4471.pdf', '/Users/demo/Downloads/invoice-4502.pdf'] }],
    desktops: [],
    desktopSupport: { ok: false, why: 'macOS does not allow apps on a hidden desktop; app tasks use the real screen with the Island showing it, web tasks use hidden browser tabs' },
    tasks: [
      { id: 'task-1', goal: plan.goal, client: 'Claude Code', plan, steps: 14, started: now - 4 * 60_000, updated: now - 10_000, urls: ['https://shop.example.com/orders?month=10'], state: 'running' },
      { id: 'task-0', goal: 'Compare three laptop prices', client: 'Keeper’s Assistant', steps: 31, started: now - 26 * 3600_000, updated: now - 25 * 3600_000, urls: [], state: 'done' },
    ],
    resumable: [],
    workflows: [{ id: 'wf-1', name: 'Monthly invoices', site: 'shop.example.com', params: [{ name: 'month', example: 'October' }, { name: 'password', example: '', secret: true }], steps: 7, created: now - 7 * 86_400_000, text: planText(plan) }],
    schedules: [{ id: 'sched-1', workflowId: 'wf-1', trigger: 'schedule', when: 'every monday at 9', label: 'every Mon at 09:00', values: { month: 'last month' }, visible: false, enabled: true, created: now - 6 * 86_400_000, lastRun: now - 2 * 86_400_000, lastResult: { ok: true, note: 'Ran 7 steps' }, next: now + 5 * 86_400_000 }],
  };
  return {
    cu: {
      state: async () => state,
      settings: async () => settings,
      setSettings: async (p) => Object.assign(settings, p),
      saveSecret: async (s) => { settings.secrets = [...settings.secrets.filter((x) => x.name !== s.name), s]; return true; },
      removeSecret: async (n) => { settings.secrets = settings.secrets.filter((x) => x.name !== n); },
      show: async (id, on) => { const t = state.tabs.find((x) => x.id === id); if (t) t.visible = on; },
      takeOver: async (id, on) => { const t = state.tabs.find((x) => x.id === id); if (t) t.takenOver = on; },
      closeTab: async (id) => { state.tabs = state.tabs.filter((x) => x.id !== id); },
      record: async () => 'rec1',
      stopRecording: async () => 'wf-2',
      runWorkflow: async () => ({ ok: true, note: 'Ran 7 steps' }),
      removeWorkflow: async (id) => { state.workflows = state.workflows.filter((w) => w.id !== id); },
      resume: async () => true,
      forgetTask: async (id) => { state.tasks = state.tasks.filter((t) => t.id !== id); },
      editPlan: async (_c, steps) => steps,
      addSchedule: async (x) => { const id = `sched-${state.schedules.length + 1}`; state.schedules.push({ ...x, values: x.values ?? {}, id, created: Date.now(), enabled: true, label: x.trigger === 'schedule' ? x.when ?? '' : x.trigger === 'launch' ? 'When Keeper starts' : 'When the computer wakes' }); return id; },
      setSchedule: async (id, on) => { const x = state.schedules.find((y) => y.id === id); if (x) x.enabled = on; },
      removeSchedule: async (id) => { state.schedules = state.schedules.filter((x) => x.id !== id); },
      runSchedule: async () => ({ ok: true, note: 'Ran 7 steps' }),
    },
  };
}
