// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo data for shelves, the clipboard picker, devices and widgets (`npm run demo`).

import type { IslandState, KeeperApi } from '../core/api';
import type { AllSettings } from '../core/settings';
import * as shelves from '../core/shelves';
import type { FileEntry } from '../core/types';
import { newWidget, normalizeWidgets, type WidgetConfig } from '../core/widgets';
import { place, type DisplayInfo, type PlaceEnv } from '../core/island-place';

/** Screens to try the Island on in the demo: ?screen=notch|notch-safari|notch-tight|mac|windows|gnome|tablet|external */
const SCREENS: Record<string, { d: DisplayInfo; env: PlaceEnv; label: string }> = {
  notch: { label: 'Built-in Retina display', env: { platform: 'darwin', macModel: 'MacBookPro18,3' }, d: { id: 1, primary: true, internal: true, rotation: 0, touch: false, scaleFactor: 2, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 } } },
  'notch-safari': { label: 'Built-in Retina display (Safari, icons from 918 pt)', env: { platform: 'darwin', macModel: 'MacBookPro18,3', notchRects: { 1: { x: 663, y: 0, width: 186, height: 32 } }, appMenuRight: 484, menuBarItems: [{ x: 918, y: 0, width: 26, height: 32 }, { x: 948, y: 0, width: 26, height: 32 }] }, d: { id: 1, primary: true, internal: true, rotation: 0, touch: false, scaleFactor: 2, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 } } },
  'notch-tight': { label: 'Built-in Retina display (icons up to the notch)', env: { platform: 'darwin', macModel: 'MacBookPro18,3', notchRects: { 1: { x: 663, y: 0, width: 186, height: 32 } }, appMenuRight: 484, menuBarItems: [{ x: 853, y: 0, width: 26, height: 32 }, { x: 883, y: 0, width: 26, height: 32 }] }, d: { id: 1, primary: true, internal: true, rotation: 0, touch: false, scaleFactor: 2, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 } } },
  mac: { label: 'iMac', env: { platform: 'darwin', macModel: 'Mac15,4', menuBarItems: [{ x: 1700, y: 0, width: 540, height: 25 }] }, d: { id: 1, primary: true, internal: true, rotation: 0, touch: false, scaleFactor: 2, bounds: { x: 0, y: 0, width: 2240, height: 1260 }, workArea: { x: 0, y: 25, width: 2240, height: 1235 } } },
  windows: { label: 'Laptop screen', env: { platform: 'win32', hasBattery: true }, d: { id: 1, primary: true, internal: true, rotation: 0, touch: true, scaleFactor: 1.5, bounds: { x: 0, y: 0, width: 1707, height: 1067 }, workArea: { x: 0, y: 0, width: 1707, height: 1019 } } },
  gnome: { label: 'Built-in display', env: { platform: 'linux', desktop: 'gnome', hasBattery: true }, d: { id: 1, primary: true, internal: false, rotation: 0, touch: false, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 32, width: 1920, height: 1048 } } },
  tablet: { label: 'Tablet, portrait', env: { platform: 'win32', hasBattery: true }, d: { id: 1, primary: true, internal: true, rotation: 90, touch: true, scaleFactor: 2, bounds: { x: 0, y: 0, width: 960, height: 1440 }, workArea: { x: 0, y: 0, width: 960, height: 1392 } } },
  external: { label: 'Studio monitor', env: { platform: 'darwin', macModel: 'MacBookPro18,3' }, d: { id: 2, primary: false, internal: false, rotation: 0, touch: false, scaleFactor: 2, bounds: { x: 1512, y: 0, width: 2560, height: 1440 }, workArea: { x: 1512, y: 25, width: 2560, height: 1415 } } },
};
const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
const demoScreen = () => SCREENS[params.get('screen') ?? 'notch'] ?? SCREENS.notch;

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
  // ?island=idle|music|timer|split|many|charging|recording|privacy shapes what is going on in the demo.
  const scene = params.get('island');
  if (scene) {
    const now = Date.now();
    island.agents = scene === 'many' ? island.agents : [];
    island.events = scene === 'many' ? [{ uid: 'm', title: 'Design review', start: now + 4 * 60_000, end: now + 34 * 60_000, allDay: false, location: 'Room 4', url: 'https://meet.example.com/abc' }] : [];
    island.weather = scene === 'many' ? island.weather : island.weather && { ...island.weather, nowcast: undefined };
    if (scene === 'idle' || scene === 'timer' || scene === 'recording' || scene === 'charging' || scene === 'privacy') island.nowPlaying = undefined;
    if (scene === 'timer' || scene === 'split' || scene === 'many') island.focus = { ...island.focus, mode: 'focus', endsAt: now + 18 * 60_000 + 24_000 };
    if (scene === 'recording' || scene === 'many') island.recording = { since: now - 83_000 };
    if (scene === 'many') island.keepAwake = { on: true, until: now + 45 * 60_000 };
    if (scene === 'charging') {
      island.battery = { percent: 64, charging: false };
      // The charger goes in a moment after the page opens.
      setTimeout(() => { island.battery = { percent: 64, charging: true }; emit(); }, 1200);
    }
    if (scene === 'many' || scene === 'privacy') island.camInUse = ['Video call'];
    if (scene === 'many' || scene === 'privacy') island.micInUse = ['Video call'];
  }
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
      layout: async () => { const s = demoScreen(); return place(s.d, s.env, { size: settings.island.size ?? 'normal', blendNotch: settings.island.blendNotch ?? true }); },
      placeLog: async () => [],
      placementPreview: async () => {
        const list = Object.entries(SCREENS).filter(([k]) => k === (params.get('screen') ?? 'notch') || (k === 'external' && (params.get('screen') ?? 'notch') === 'notch'));
        const o = { edge: settings.island.edge, size: settings.island.size ?? 'normal', blendNotch: settings.island.blendNotch ?? true, cameraEdge: settings.island.cameraEdge ?? 'auto', followCamera: settings.island.followCamera ?? true, offsetX: settings.island.offsetX ?? 0, offsetY: settings.island.offsetY ?? 0 } as const;
        const first = list[0][1];
        return {
          platform: first.env.platform, desktop: first.env.desktop, macModel: first.env.macModel, wayland: false, xwayland: false,
          displays: list.map(([, s]) => ({ info: s.d, placement: place(s.d, s.env, o), primary: !!s.d.primary, label: s.label })),
          wanted: list.filter(([, s]) => settings.island.displays === 'all' || s.d.primary).map(([, s]) => s.d.id),
        };
      },
      setSize: () => undefined,
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
