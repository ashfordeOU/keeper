// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Menu bar icons: other apps' icons in the Mac menu bar, some kept out of sight
// behind a divider of Keeper's own, shown again with one click, from a list,
// or by themselves when one changes. Pure logic: reading the system's list of
// status windows, which icons sit left of the divider (hidden), how wide the
// divider grows to push them out of sight, where a ⌘-drag moves an icon, what
// changed, and what each system allows. electron/services/menubar-items.ts
// does it on a Mac with public calls only (CGWindowList, Accessibility, an
// ordinary status item of Keeper's own and synthetic ⌘-drags).

export interface MenuBarIcon {
  /** "<pid>:<window number>": stable while the app runs */
  id: string;
  app: string;
  pid: number;
  /** left edge and width in screen points (macOS: from the left of the main screen) */
  x: number;
  width: number;
  /** the system's own icons (the clock, Control Centre): seen, never moved */
  system: boolean;
}

/** One status-window row from CGWindowListCopyWindowInfo, as the helper script prints it. */
export interface StatusWindowRow { owner: string; pid: number; number: number; layer: number; x: number; y: number; width: number; height: number }

/** The menu bar's status windows sit at this window level (kCGStatusWindowLevel). */
export const STATUS_LAYER = 25;

const SYSTEM_OWNERS = /^(control ?cent(er|re)|systemuiserver|window ?server|clock|spotlight|siri|text ?input ?menu ?agent)$/i;

/** The icons in the menu bar, left to right; Keeper's own items (its owl and divider) are left out. */
export function parseStatusWindows(rows: StatusWindowRow[], keeperPids: number[] = []): MenuBarIcon[] {
  return rows
    .filter((r) => r && r.layer === STATUS_LAYER && r.width > 0 && r.width < 600 && r.height > 0 && r.height <= 60 && !keeperPids.includes(r.pid))
    .map((r) => ({ id: `${r.pid}:${r.number}`, app: String(r.owner || 'Unknown'), pid: r.pid, x: Math.round(r.x), width: Math.round(r.width), system: SYSTEM_OWNERS.test(String(r.owner || '').trim()) }))
    .sort((a, b) => a.x - b.x);
}

/**
 * Hidden icons are those left of the divider. While the divider is wide (hiding),
 * they are pushed past the left edge of the screen, so they are left of it too.
 */
export function splitByDivider(icons: MenuBarIcon[], dividerX: number | undefined): { shown: MenuBarIcon[]; hidden: MenuBarIcon[] } {
  if (dividerX === undefined) return { shown: icons, hidden: [] };
  return { shown: icons.filter((i) => i.x + i.width / 2 > dividerX), hidden: icons.filter((i) => i.x + i.width / 2 <= dividerX) };
}

/**
 * The divider's title while hiding: a run of wide spaces as wide as the screen,
 * so every icon left of it is pushed off the left edge. An em space is about
 * 14 points in the menu bar's font; a few extra cover wider screens' scaling.
 */
export function spacerTitle(screenWidth: number): string {
  const n = Math.min(800, Math.max(20, Math.ceil(Math.max(0, screenWidth) / 12) + 8));
  return ' '.repeat(n);
}

/** The divider's title: wide while hiding, a dot when a hidden icon changed (so you know to look). */
export function dividerTitle(hiding: boolean, changed: boolean, screenWidth: number): string {
  return `${changed ? '•' : ''}${hiding ? spacerTitle(screenWidth) : ''}`;
}

export interface Point { x: number; y: number }

/**
 * A ⌘-drag that moves an icon to the other side of the divider: from the
 * icon's middle to just left of the divider (to hide it) or just right of it
 * (to show it). The menu bar's middle line is `barY`.
 */
export function dragPlan(icon: MenuBarIcon, divider: { x: number; width: number }, to: 'hide' | 'show', barY = 12): { from: Point; to: Point } {
  const from = { x: Math.round(icon.x + icon.width / 2), y: barY };
  const target = to === 'hide' ? { x: Math.round(divider.x - 6), y: barY } : { x: Math.round(divider.x + divider.width + 6), y: barY };
  return { from, to: target };
}

/** Icons that changed width since the last look (a new badge, a timer, a status): ids. */
export function changedIcons(before: MenuBarIcon[], after: MenuBarIcon[]): string[] {
  const was = new Map(before.map((i) => [i.id, i.width]));
  return after.filter((i) => was.has(i.id) && Math.abs((was.get(i.id) ?? 0) - i.width) >= 2).map((i) => i.id);
}

// ---------------------------------------------------------------- settings

export interface MenuBarItemsSettings {
  /** hide the icons left of the divider (the divider stays, so one click shows them) */
  hiding: boolean;
  /** after showing them, hide them again after this many seconds (0: stay shown) */
  autoHideSeconds: number;
  /** show the hidden icons for a moment when one of them changes */
  showOnChange: boolean;
}

export const defaultMenuBarItems = (): MenuBarItemsSettings => ({ hiding: true, autoHideSeconds: 15, showOnChange: false });

export function normalizeMenuBarItems(raw: unknown): MenuBarItemsSettings {
  const d = defaultMenuBarItems();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<MenuBarItemsSettings>;
  const s = Math.round(Number(r.autoHideSeconds));
  return { hiding: r.hiding !== false, autoHideSeconds: [0, 5, 15, 30, 60].includes(s) ? s : d.autoHideSeconds, showOnChange: r.showOnChange === true };
}

// ---------------------------------------------------------------- what this computer allows

export type MenuBarState = 'ready' | 'permission' | 'windows' | 'unsupported';

export interface MenuBarAvailability {
  state: MenuBarState;
  line: string;
  hint?: string;
}

export function menuBarAvailability(f: { platform: string; macMajor?: number; accessibility?: boolean }): MenuBarAvailability {
  if (f.platform === 'darwin') {
    const own = (f.macMajor ?? 0) >= 26 ? 'macOS 26 can also hide icons itself, in System Settings → Menu Bar.' : undefined;
    if (f.accessibility === false) return { state: 'permission', line: 'Keeper can hide and show icons. Moving them needs Accessibility.', hint: own ?? 'System Settings → Privacy & Security → Accessibility → Keeper.' };
    return { state: 'ready', line: 'Icons left of Keeper’s divider stay out of sight until you click it.', hint: own };
  }
  if (f.platform === 'win32') return { state: 'windows', line: 'Windows keeps extra icons in the taskbar’s own overflow (the ^ by the clock).', hint: 'Choose which icons show in Windows Settings → Personalisation → Taskbar → Other system tray icons.' };
  return { state: 'unsupported', line: 'Each Linux desktop runs its tray its own way, so Keeper cannot hide or move other apps’ icons here.', hint: 'Your desktop’s panel settings may let you hide or reorder them.' };
}

/**
 * The divider's picture: a short vertical bar with a small notch, drawn as a
 * template image (black with alpha; macOS tints it for light and dark menu bars).
 * Returns BGRA pixels for nativeImage.createFromBitmap.
 */
export function dividerBitmap(scale = 2): { width: number; height: number; data: Uint8Array } {
  const w = 8 * scale;
  const h = 16 * scale;
  const data = new Uint8Array(w * h * 4);
  const set = (x: number, y: number) => { const i = (y * w + x) * 4; data[i + 3] = 255; };
  const mid = Math.floor(w / 2);
  for (let y = 2 * scale; y < h - 2 * scale; y++) for (let x = mid - scale; x < mid + scale; x++) set(x, y);
  // A small chevron at the middle, pointing left: "more is over there".
  for (let k = 0; k < 2 * scale; k++) for (let t = 0; t < scale; t++) {
    const x = mid - scale - 1 - k;
    if (x >= 0) { set(x, h / 2 - k - 1 + t); set(x, h / 2 + k - t); }
  }
  return { width: w, height: h, data };
}
