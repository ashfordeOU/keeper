// SPDX-License-Identifier: AGPL-3.0-or-later
// Demo data for shelves, the clipboard picker, devices and widgets (`npm run demo`).

import type { IslandState, KeeperApi } from '../core/api';
import type { AllSettings } from '../core/settings';
import * as shelves from '../core/shelves';
import type { FileEntry } from '../core/types';
import { newWidget, normalizeWidgets, type WidgetConfig } from '../core/widgets';

type IslandApi = KeeperApi['island'];

export function createMockIsland(island: IslandState, files: FileEntry[], settings: AllSettings, emit: () => void): { island: Partial<IslandApi>; widgets: KeeperApi['widgets'] } {
  const byPath = (p: string) => files.find((f) => f.path === p);
  let store = shelves.addItems(shelves.newStore(), island.shelf.map((f) => f.path));
  const trip = shelves.createShelf(store, 'Trip photos');
  store = shelves.addItems(trip.store, files.filter((f) => f.kind === 'image').slice(0, 4).map((f) => f.path), trip.shelf.id);
  store = shelves.togglePin({ ...store, active: store.shelves[0].id }, trip.shelf.id);
  store = { ...store, closed: [{ id: 'old', name: 'Tax papers', color: '#fbbf24', items: files.filter((f) => f.tags?.includes('taxes')).map((f) => f.path), createdAt: 0 }] };

  island.clips = [
    { id: 'c1', kind: 'text', text: 'blue-otter-42', at: Date.now() - 60_000, source: 'Notes' },
    { id: 'c2', kind: 'link', text: 'https://github.com/ashfordeOU/keeper', title: 'Keeper — a home for your files', at: Date.now() - 3_600_000, pinned: true, source: 'Browser' },
    { id: 'c3', kind: 'color', text: '#8b8bff', at: Date.now() - 5_400_000, source: 'Design app', collections: ['Brand'] },
    { id: 'c4', kind: 'code', text: 'const keeper = await open({ look: "playful" });', at: Date.now() - 6_000_000, source: 'Code editor' },
    { id: 'c5', kind: 'text', text: 'Meeting moved to 3pm — same room.', at: Date.now() - 7_200_000, source: 'Chat', note: 'Tell Sam' },
    { id: 'c6', kind: 'file', text: '/Users/demo/Documents/Budget 2026.xlsx', at: Date.now() - 9_000_000, source: 'Files' },
  ];
  island.devices = {
    volume: 46, muted: false,
    monitors: [{ id: 'internal', name: 'Built-in display', brightness: 70, external: false }, { id: 'ddc:0', name: 'Studio monitor', brightness: 55, external: true }],
    bluetooth: [{ name: 'Earbuds (left)', percent: 82 }, { name: 'Earbuds (right)', percent: 78 }, { name: 'Wireless mouse', percent: 34 }],
    ddc: 'DDC/CI',
  };

  const sync = () => {
    const views = store.shelves.map((s) => ({ id: s.id, name: s.name, color: s.color, pinned: s.pinned, items: s.items.map(byPath).filter((f): f is FileEntry => !!f) }));
    island.shelves = views;
    island.activeShelf = store.active;
    island.shelf = views.find((v) => v.id === store.active)?.items ?? [];
    island.closedShelves = store.closed.map((c) => ({ id: c.id, name: c.name, color: c.color, count: c.items.length }));
    emit();
  };
  sync();
  const set = (next: shelves.ShelfStore) => { store = next; sync(); };
  const clip = (id: string) => island.clips.find((c) => c.id === id);

  let widgets: WidgetConfig[] = normalizeWidgets([
    { ...newWidget('clock', { x: 40, y: 80 }), id: 'w-clock', options: { analog: true, timeZones: ['America/New_York', 'Asia/Tokyo'] } },
    { ...newWidget('weather', { x: 280, y: 80 }), id: 'w-weather' },
    { ...newWidget('countdown', { x: 40, y: 320 }), id: 'w-count', options: { title: 'Lisbon trip', target: Date.now() + 23 * 86_400_000 } },
    { ...newWidget('sun-moon', { x: 300, y: 300 }), id: 'w-sun' },
  ]);
  settings.widgets = widgets;

  return {
    island: {
      state: async () => structuredClone(island),
      addToShelf: async (paths) => set(shelves.addItems(store, paths.filter((p) => byPath(p)))),
      removeFromShelf: async (p) => set(shelves.removeItem(store, p)),
      clearShelf: async () => set(shelves.clearShelf(store)),
      createShelf: async (name) => set(shelves.createShelf(store, name).store),
      selectShelf: async (id) => set({ ...store, active: id }),
      renameShelf: async (id, name) => set(shelves.renameShelf(store, id, name)),
      setShelfColor: async (id, color) => set(shelves.setShelfColor(store, id, color)),
      pinShelf: async (id) => set(shelves.togglePin(store, id)),
      closeShelf: async (id) => set(shelves.closeShelf(store, id)),
      reopenShelf: async (id) => set(shelves.reopenShelf(store, id)),
      moveShelfItem: async (from, to) => set(shelves.moveItem(store, from, to)),
      renameShelfItem: async (p, name) => {
        const f = byPath(p);
        if (!f) return;
        const to = p.replace(/[^/]+$/, name);
        f.name = name;
        f.path = to;
        set(shelves.renamePath(store, p, to));
      },
      shelfAction: async (action) => ({ message: action === 'upload' ? 'Uploaded 2 items — link copied (demo)' : action === 'zip' ? 'Created Archive.zip (demo)' : 'Done (demo)', link: action === 'upload' ? 'https://example.com/share/abc123/file.pdf' : undefined }),
      updateClip: async (id, patch) => { const c = clip(id); if (c) c.note = patch.note; emit(); },
      toggleClipCollection: async (id, name) => {
        const c = clip(id);
        if (!c) return;
        const l = c.collections ?? [];
        c.collections = l.includes(name) ? l.filter((x) => x !== name) : [...l, name];
        emit();
      },
      pasteClip: async () => undefined,
      exportClips: async () => '/Users/demo/Documents/Keeper clipboard.json',
      importClips: async () => 0,
      openClips: async () => { window.open('?view=clips', '_blank', 'width=460,height=520'); },
      closeClips: () => undefined,
      openShelf: async () => undefined,
      hide: async (h) => { island.hidden = h; emit(); },
      setVolume: async (v) => { island.devices!.volume = v; emit(); },
      setMuted: async (m) => { island.devices!.muted = m; emit(); },
      setBrightness: async (id, v) => { island.devices!.monitors = island.devices!.monitors.map((m) => (m.id === id ? { ...m, brightness: v } : m)); emit(); },
      refreshDevices: async () => island.devices!,
      awakeStatus: async () => ({ active: settings.island.awakeTriggers.filter((t) => t.enabled && t.kind === 'display').map(() => 'An external display is connected'), snapshot: { externalDisplays: 1, onPower: true, ssid: 'Studio-5G', cpu: 23 } }),
    },
    widgets: {
      list: async () => structuredClone(widgets),
      save: async (w) => { widgets = widgets.some((x) => x.id === w.id) ? widgets.map((x) => (x.id === w.id ? w : x)) : [...widgets, w]; settings.widgets = widgets; return structuredClone(widgets); },
      remove: async (id) => { widgets = widgets.filter((w) => w.id !== id); settings.widgets = widgets; return structuredClone(widgets); },
      photos: async () => files.filter((f) => f.kind === 'image').map((f) => f.path),
      current: async () => widgets.find((w) => w.id === new URLSearchParams(location.search).get('id')) ?? null,
    },
  };
}
