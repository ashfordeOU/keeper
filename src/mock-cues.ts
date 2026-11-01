// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's Cues and Island+: realistic sample cues kept in memory,
// using the same pure logic as the app (nothing touches the disk).

import { defaultCueSettings, normalizeCueSettings, type CueInput, type CuesApi, type CueSettings, type CueState } from '../core/cues/api';
import { buildPhraseModel, filterCues, suggest } from '../core/cues/dashboard';
import { anchorsFor, complete, cueFromDraft, dedupeAnchors, newId, parseCueInput, reopen, restore, skipItem, snooze, softDelete, startRun, toggleItem, type Cue, type CueTemplate, type FrontContext } from '../core/cues/model';
import type { IslandPlusApi } from '../core/island-plus';

export function mockCues(emit: (channel: string) => void): { cues: CuesApi; islandx: IslandPlusApi } {
  const now = Date.now();
  const day = 86_400_000;
  const at = (d: number, h: number, m = 0) => { const t = new Date(now + d * day); t.setHours(h, m, 0, 0); return t.getTime(); };
  let settings: CueSettings = defaultCueSettings();
  const front: FrontContext = { app: 'Google Chrome', title: 'Pull requests · ashforde/keeper', url: 'https://github.com/ashforde/keeper/pulls' };
  let cues: Cue[] = [
    cueFromDraft({ title: 'Review the open pull requests before stand-up', body: 'Start with the ones waiting longest.', type: 'note', anchors: [{ kind: 'site', value: 'github.com', label: 'github.com' }] }, now - 3 * day, { id: 'c1', shownAt: now - 60_000 }),
    cueFromDraft({ title: 'Release checklist', body: '', type: 'checklist', items: ['Bump the version', 'Update the changelog', 'Tag and push', 'Check the download page'], anchors: [{ kind: 'app', value: 'Terminal', label: 'Terminal' }], due: at(0, 16), repeat: 'weekly' }, now - 9 * day, { id: 'c2' }),
    cueFromDraft({ title: 'Reply to the comments on the homepage frame', body: 'Sam asked about the hero spacing.', type: 'note', anchors: [{ kind: 'app', value: 'Figma', label: 'Figma' }, { kind: 'title', value: 'Website redesign', label: 'Website redesign' }] }, now - day, { id: 'c3' }),
    cueFromDraft({ title: 'Pay the electricity bill', body: '', type: 'note', anchors: [], due: at(-1, 9) }, now - 5 * day, { id: 'c4' }),
    cueFromDraft({ title: 'Read later: designing calm software', body: '', type: 'link', url: 'https://example.com/calm-software', anchors: [] , due: at(2, 19) }, now - 2 * day, { id: 'c5' }),
    cueFromDraft({ title: 'Send the quarterly invoice', body: 'Attach the timesheet.', type: 'note', anchors: [{ kind: 'site', value: 'mail.google.com', label: 'mail.google.com' }], due: at(1, 9) }, now - 4 * day, { id: 'c6' }),
  ];
  cues[1] = toggleItem(cues[1], cues[1].items![0].id, now - 3600_000);
  cues.push({ ...cueFromDraft({ title: 'Book the dentist', body: '', type: 'note', anchors: [] }, now - 20 * day, { id: 'c7' }), done: true, doneAt: now - 2 * day });
  let templates: CueTemplate[] = [
    { id: 't1', name: 'Morning start', items: ['Check the calendar', 'Clear the inbox to zero', 'Pick the three things for today'], createdAt: now - 30 * day, usedAt: now - day },
    { id: 't2', name: 'Publish a post', items: ['Proofread', 'Add the cover image', 'Schedule', 'Share the link'], createdAt: now - 12 * day },
  ];
  const changed = () => emit('cues-changed');
  const put = (c: Cue) => { cues = [c, ...cues.filter((x) => x.id !== c.id)]; changed(); return c; };
  const get = (id: string) => { const c = cues.find((x) => x.id === id); if (!c) throw new Error('That cue is gone'); return c; };
  const state = (): CueState => ({ cues, templates, settings, folder: '/Users/demo/Documents/Keeper Cues', front, offered: anchorsFor(front), showing: ['c1'], watcher: 'Keeper asks the system which app is in front every 2 seconds while a cue is tied to a place.', browserLinked: true });
  const create = (i: CueInput): Cue => {
    const d = parseCueInput(i.text ?? i.title ?? '');
    const offered = anchorsFor(front);
    const attached = (i.attach ?? []).map((k) => offered.find((a) => a.kind === k)).filter((a): a is NonNullable<typeof a> => !!a);
    return put(cueFromDraft({ ...d, items: i.items ?? d.items, anchors: dedupeAnchors([...(i.anchors ?? []), ...d.anchors, ...attached]) }, Date.now()));
  };
  const cuesApi: CuesApi = {
    state: async () => state(),
    list: async (o) => filterCues(cues, o ?? {}),
    create: async (i) => create(i),
    update: async (id, p) => put({ ...get(id), title: p.title ?? get(id).title, body: p.body ?? get(id).body, updatedAt: Date.now() }),
    toggleItem: async (id, item) => put(toggleItem(get(id), item)),
    skipItem: async (id, item) => put(skipItem(get(id), item)),
    complete: async (id) => put(complete(get(id))),
    reopen: async (id) => put(reopen(get(id))),
    snooze: async (id, ch) => put(snooze(get(id), ch)),
    remove: async (id) => { put(softDelete(get(id))); },
    restore: async (id) => put(restore(get(id))),
    purge: async (id) => { cues = cues.filter((c) => c.id !== id); changed(); },
    dismiss: async () => undefined,
    templates: async () => templates,
    saveTemplate: async (t) => { const tpl: CueTemplate = { id: t.id ?? newId(), name: t.name, items: t.items, anchors: t.anchors, createdAt: t.createdAt ?? Date.now() }; templates = [tpl, ...templates.filter((x) => x.id !== tpl.id)]; changed(); return tpl; },
    removeTemplate: async (id) => { templates = templates.filter((t) => t.id !== id); changed(); },
    startTemplate: async (id, o) => put(startRun(templates.find((t) => t.id === id)!, Date.now(), { skip: o?.skip })),
    parse: async (t) => parseCueInput(t),
    suggest: async (t) => (settings.suggestions ? suggest(buildPhraseModel(cues), t) : ''),
    settings: async () => settings,
    setSettings: async (p) => { settings = normalizeCueSettings({ ...settings, ...p }); changed(); return settings; },
    compose: async () => undefined,
    openFolder: async () => undefined,
    exportMarkdown: async () => null,
    syncWithDevices: async () => ({ ok: true, message: 'The Cues folder now syncs with your devices (demo).' }),
    popup: async () => ({ cues: cues.filter((c) => c.id === 'c1'), front }),
    closePopup: async () => undefined,
    openPage: async () => undefined,
    reportPage: async () => undefined,
  };
  const islandx: IslandPlusApi = {
    status: async () => ({
      platform: 'darwin',
      notify: { mode: 'off', how: 'Reads Notification Centre banners through Accessibility (needs the Accessibility permission). It reads what macOS draws, so a macOS update can break it until Keeper is updated.', fragile: true, canDismiss: true },
      hud: { on: false, how: 'Starts when switched on.', replaces: false, why: 'macOS draws its own volume and brightness pop-up; only private APIs can hide it, so Keeper shows its level beside it.' },
      calls: { on: true, perApp: true, how: 'Core Audio says which app uses the microphone (macOS 14.2 and later).' },
      agents: { statusDir: '/Users/demo/.keeper/agents', hooks: [{ id: 'cursor', name: 'Cursor', installed: false, available: true, file: '/Users/demo/.cursor/hooks.json' }] },
      ocr: { system: true, engines: ['system', 'builtin'] },
    }),
    callMute: async (m) => ({ muted: m, how: 'system' }),
    callDismiss: async () => undefined,
    hideFor: async () => undefined,
    installAgentHooks: async () => ({ ok: true, message: 'Cursor now tells the Island when its agent works, waits or finishes (demo).' }),
    removeAgentHooks: async () => ({ ok: true, message: 'Removed (demo).' }),
    openNotifyPermission: async () => undefined,
    testNotification: async () => undefined,
    startBreak: async () => undefined,
    focusFor: async () => undefined,
    mediaMode: async () => undefined,
    openLauncher: async () => undefined,
    showPage: async () => undefined,
  };
  return { cues: cuesApi, islandx };
}
