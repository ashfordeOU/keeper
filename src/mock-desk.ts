// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's window and desktop parts: snap windows with two saved
// layouts made from sample apps, kept in memory.

import type { BoxesApi } from '../core/api-boxes';
import type { MenuBarApi, MenuBarStatus } from '../core/api-menubar';
import type { SnapApi, SnapStatus } from '../core/api-snap';
import { boxItems, planTidy, type BoxEntry } from '../core/folder-boxes';
import type { SnapLayout } from '../core/snap';

const DAY = 86_400_000;
const SAMPLE: BoxEntry[] = ['Holiday 1.jpg', 'Holiday 2.jpg', 'Plans.pdf', 'Budget.xlsx', 'Notes.txt', 'Talk.mp4', 'Setup.dmg', 'Old photos'].map((name, i) => ({ name, path: `/Users/sam/Desktop/${name}`, isDir: !name.includes('.'), size: 1000 * (i + 1), mtime: Date.now() - i * DAY }));

const ICON = (id: number, app: string, x: number, system = false) => ({ id: `${id}:1`, app, pid: id, x, width: 28, system });

export function mockDesk(): { snap: SnapApi; boxes: BoxesApi; menuBar: MenuBarApi } {
  let hiding = true;
  const menuStatus = async (): Promise<MenuBarStatus> => ({
    availability: { state: 'ready', line: 'Icons left of Keeper’s divider stay out of sight until you click it.' },
    hidden: [ICON(301, 'Cloud Drive', 900), ICON(302, 'Password Safe', 930), ICON(303, 'VPN', 960)],
    shown: [ICON(304, 'Music', 1100), ICON(305, 'Battery', 1180, true), ICON(306, 'Control Centre', 1220, true)],
    hiding, peeking: false, divider: true,
  });
  let layouts: SnapLayout[] = [
    { id: 'l1', name: 'Docked', screens: '1920x1080+2560x1440', savedAt: Date.now() - 2 * 86_400_000, windows: [
      { app: 'Mail', title: 'Inbox', screen: 0, rel: { x: 0, y: 0, width: 0.5, height: 1 } },
      { app: 'Notes', title: 'Plans', screen: 0, rel: { x: 0.5, y: 0, width: 0.5, height: 1 } },
      { app: 'Browser', title: 'Docs', screen: 1, rel: { x: 0, y: 0, width: 1, height: 1 } },
    ] },
    { id: 'l2', name: 'Laptop', screens: '1440x900', savedAt: Date.now() - 6 * 86_400_000, windows: [
      { app: 'Notes', title: 'Plans', screen: 0, rel: { x: 0, y: 0, width: 0.6667, height: 1 } },
      { app: 'Calendar', title: 'Week', screen: 0, rel: { x: 0.6667, y: 0, width: 0.3333, height: 1 } },
    ] },
  ];
  const status = async (): Promise<SnapStatus> => ({ availability: { state: 'ready', line: 'Works with every app on this computer.' }, layouts, screens: { key: '1440x900', name: 'Laptop', count: 1 }, taken: {} });
  return {
    snap: {
      status,
      run: async () => ({ ok: true }),
      saveLayout: async (name) => { layouts = [{ id: `l${Date.now()}`, name: name || 'Laptop', screens: '1440x900', savedAt: Date.now(), windows: [] }, ...layouts]; return status(); },
      restoreLayout: async (id) => ({ moved: layouts.find((l) => l.id === id)?.windows.length ?? 0, missing: [] }),
      renameLayout: async (id, name) => { layouts = layouts.map((l) => (l.id === id ? { ...l, name } : l)); return status(); },
      removeLayout: async (id) => { layouts = layouts.filter((l) => l.id !== id); return status(); },
      openPermission: async () => undefined,
    },
    boxes: {
      status: async () => ({ desktop: '/Users/sam/Desktop', floats: false, tidyOffered: true }),
      list: async (_folder, sort, show) => boxItems(SAMPLE, { sort, show }),
      open: async () => true,
      reveal: async () => undefined,
      planTidy: async () => planTidy('/Users/sam/Desktop', SAMPLE, () => false, '/'),
      tidy: async () => ({ moved: 7, boxes: 5 }),
    },
    menuBar: {
      status: menuStatus,
      setHiding: async (on) => { hiding = on; return menuStatus(); },
      peek: menuStatus,
      press: async () => true,
      move: async () => ({ ok: true }),
      openSettings: async () => undefined,
    },
  };
}
