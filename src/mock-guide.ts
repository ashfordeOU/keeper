// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Guided fixes in the browser demo: a Mac with a full Trash, FileVault off,
// old phone backups and no backup yet — built with the same checkers as the app.

import type { GuideApi, GuideList } from '../core/api-guide';
import { mergeFindings, summarize, verifyResult } from '../core/guide/aggregate';
import { backupFindings, FLOWS, flowAsFinding, protectionFindings, searchHowTo, spaceFindings, startupFindings } from '../core/guide/builtin';
import type { Finding, FindingState } from '../core/guide/types';

const GB = 1024 ** 3;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mockGuide(emit: (channel: string, ...args: unknown[]) => void): { guide: GuideApi } {
  let trash = { bytes: 6.4 * GB, count: 212 };
  let fileVault: 'off' | 'ok' = 'off';
  let startupOff = false;
  const states: Record<string, FindingState> = {};
  const checkedAt = Date.now() - 4 * 60_000;

  const found = (): Finding[] => [
    ...spaceFindings({ platform: 'darwin', disk: { free: 21 * GB, total: 494 * GB }, trash, phoneBackups: { bytes: 38 * GB, count: 3 }, oldVideos: { bytes: 24 * GB, count: 11 } }),
    ...protectionFindings([{ id: 'filevault', name: 'FileVault', description: 'Encrypts your disk so a lost Mac does not leak your files.', status: fileVault }, { id: 'firewall', name: 'Firewall', description: 'Blocks unwanted incoming connections.', status: 'off' }], 'darwin'),
    ...startupFindings(startupOff ? [] : ['Dropbox', 'Teams', 'Adobe Creative Cloud'].map((n) => ({ id: n, name: n, enabled: true, impact: 'high', scope: 'user' }))),
    ...backupFindings({ jobs: 0 }),
  ];
  const list = (): GuideList => {
    const findings = mergeFindings(found(), states);
    return { findings, summary: summarize(findings, checkedAt), checkedAt, platform: 'darwin' };
  };
  const changed = () => emit('guide-changed', list().summary);
  const get = (id: string) => {
    if (id.startsWith('flow:')) {
      const flow = FLOWS.find((f) => `flow:${f.id}` === id);
      const f = flow && flowAsFinding(flow, 'darwin');
      return f ? { ...f, state: {}, status: 'open' as const } : null;
    }
    return list().findings.find((f) => f.id === id) ?? null;
  };

  const guide: GuideApi = {
    list: async () => list(),
    refresh: async () => { await wait(500); changed(); return list(); },
    summary: async () => list().summary,
    setState: async (id, patch) => { if (patch === null) delete states[id]; else states[id] = { ...states[id], ...patch }; changed(); return list(); },
    preview: async (id) => {
      await wait(250);
      if (id === 'space:trash') return { summary: `${trash.count} items (${(trash.bytes / GB).toFixed(1)} GB) will be deleted for good.`, items: ['Old project export.zip', 'Screen Recording 2026-03-02.mov', 'IMG_4410.HEIC', 'Invoice draft.pages'].map((label) => ({ label })), bytes: trash.bytes, undoable: false };
      return { summary: '3 apps will no longer open by themselves when you sign in. They stay installed.', items: ['Dropbox', 'Teams', 'Adobe Creative Cloud'].map((label) => ({ label })), undoable: true };
    },
    apply: async (id) => {
      await wait(700);
      if (id === 'space:trash') trash = { bytes: 0, count: 0 };
      if (id === 'performance:startup') startupOff = true;
      states[id] = { doneAt: Date.now() };
      changed();
      return { ok: true, message: id === 'space:trash' ? 'The Trash is empty.' : '3 apps will no longer start by themselves.', undoable: id === 'performance:startup' };
    },
    undo: async (id) => { if (id === 'performance:startup') startupOff = false; delete states[id]; changed(); return { ok: true, message: 'Put back.' }; },
    open: async (t) => ({ ok: true, label: t.topic ?? 'System Settings' }),
    verify: async (id) => {
      await wait(600);
      // In the demo, turning FileVault on "works" the second time it is checked.
      if (id === 'protection:filevault') fileVault = 'ok';
      const r = verifyResult(id, found());
      if (r === 'done') states[id] = { doneAt: Date.now() };
      changed();
      return r;
    },
    mini: async () => undefined,
    flows: async () => FLOWS,
    get: async (id) => get(id),
    howTo: async (q) => searchHowTo(q).slice(0, 8).map(({ flow }) => ({ id: `flow:${flow.id}`, title: flow.title, area: flow.area })),
    explain: async (_id, mode) => { await wait(500); return { ok: true, text: mode === 'explain' ? 'In the demo there is no AI connected. In Keeper, the AI you chose explains this in plain words — the steps work without it.' : '1. Open System Settings.\n2. Go to Privacy & Security.\n3. Scroll to FileVault and press Turn On…' }; },
    focus: () => undefined,
  };
  return { guide };
}
