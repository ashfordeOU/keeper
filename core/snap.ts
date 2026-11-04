// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Snap windows: put the window in front into a half, a third, a quarter, the
// whole screen, the middle or the next screen with a shortcut, and save how
// windows sit on a set of screens ("Docked", "Laptop") to bring them back in
// one click. Pure logic: where each action puts a window, which screen set this
// is, what a saved layout holds and how it is restored, and what this computer
// allows. electron/services/snap.ts moves the windows with the same system calls
// the computer-use tools use (System Events, user32, xdotool/wmctrl).

export interface Rect { x: number; y: number; width: number; height: number }

export type SnapAction =
  | 'left' | 'right' | 'top' | 'bottom'
  | 'leftThird' | 'centreThird' | 'rightThird' | 'leftTwoThirds' | 'rightTwoThirds'
  | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
  | 'maximise' | 'centre' | 'nextDisplay';

export type SnapGroup = 'Halves' | 'Thirds' | 'Quarters' | 'Whole screen';

/** Every action, its plain name and where it sits on screen (fractions, for the small pictures on the page). */
export const SNAP_ACTIONS: { id: SnapAction; label: string; group: SnapGroup; area: [number, number, number, number] }[] = [
  { id: 'left', label: 'Left half', group: 'Halves', area: [0, 0, 0.5, 1] },
  { id: 'right', label: 'Right half', group: 'Halves', area: [0.5, 0, 0.5, 1] },
  { id: 'top', label: 'Top half', group: 'Halves', area: [0, 0, 1, 0.5] },
  { id: 'bottom', label: 'Bottom half', group: 'Halves', area: [0, 0.5, 1, 0.5] },
  { id: 'leftThird', label: 'Left third', group: 'Thirds', area: [0, 0, 1 / 3, 1] },
  { id: 'centreThird', label: 'Middle third', group: 'Thirds', area: [1 / 3, 0, 1 / 3, 1] },
  { id: 'rightThird', label: 'Right third', group: 'Thirds', area: [2 / 3, 0, 1 / 3, 1] },
  { id: 'leftTwoThirds', label: 'Left two thirds', group: 'Thirds', area: [0, 0, 2 / 3, 1] },
  { id: 'rightTwoThirds', label: 'Right two thirds', group: 'Thirds', area: [1 / 3, 0, 2 / 3, 1] },
  { id: 'topLeft', label: 'Top left', group: 'Quarters', area: [0, 0, 0.5, 0.5] },
  { id: 'topRight', label: 'Top right', group: 'Quarters', area: [0.5, 0, 0.5, 0.5] },
  { id: 'bottomLeft', label: 'Bottom left', group: 'Quarters', area: [0, 0.5, 0.5, 0.5] },
  { id: 'bottomRight', label: 'Bottom right', group: 'Quarters', area: [0.5, 0.5, 0.5, 0.5] },
  { id: 'maximise', label: 'Fill the screen', group: 'Whole screen', area: [0, 0, 1, 1] },
  { id: 'centre', label: 'Middle', group: 'Whole screen', area: [0.2, 0.15, 0.6, 0.7] },
  { id: 'nextDisplay', label: 'Next screen', group: 'Whole screen', area: [0, 0, 1, 1] },
];

export const SNAP_GROUPS: SnapGroup[] = ['Halves', 'Whole screen', 'Thirds', 'Quarters'];

export const isSnapAction = (v: unknown): v is SnapAction => SNAP_ACTIONS.some((a) => a.id === v);

export interface SnapSettings {
  /** a key combination per action (Electron accelerators); empty means none */
  shortcuts: Record<SnapAction, string>;
  /** space left between a snapped window and the screen's edges, in points (0–24) */
  gap: number;
  /** bring back the saved layout for a set of screens when that set is plugged in */
  restoreOnChange: boolean;
}

/**
 * Keeper's own defaults: ⌘⌥⇧ on a Mac (Ctrl+Alt+Shift elsewhere) with the
 * arrows for the halves, Return to fill the screen, C for the middle and N for
 * the next screen; none of them is one of Monorail's keys. The thirds and
 * quarters start empty, for people to choose.
 */
export function defaultSnapSettings(): SnapSettings {
  const k = 'CommandOrControl+Alt+Shift+';
  return {
    shortcuts: {
      left: `${k}Left`, right: `${k}Right`, top: `${k}Up`, bottom: `${k}Down`,
      leftThird: '', centreThird: '', rightThird: '', leftTwoThirds: '', rightTwoThirds: '',
      topLeft: '', topRight: '', bottomLeft: '', bottomRight: '',
      maximise: `${k}Return`, centre: `${k}C`, nextDisplay: `${k}N`,
    },
    gap: 0,
    restoreOnChange: false,
  };
}

export function normalizeSnapSettings(raw: unknown): SnapSettings {
  const d = defaultSnapSettings();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SnapSettings>;
  const sc = (r.shortcuts && typeof r.shortcuts === 'object' ? r.shortcuts : {}) as Partial<Record<SnapAction, unknown>>;
  const shortcuts = { ...d.shortcuts };
  for (const a of SNAP_ACTIONS) if (typeof sc[a.id] === 'string') shortcuts[a.id] = (sc[a.id] as string).trim();
  const gap = Math.round(Number(r.gap));
  return { shortcuts, gap: Number.isFinite(gap) ? Math.min(24, Math.max(0, gap)) : d.gap, restoreOnChange: r.restoreOnChange === true };
}

const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) });

/** Where an action puts a window on a screen's usable area (`work`), with `gap` points around it. */
export function snapRect(action: Exclude<SnapAction, 'nextDisplay'>, work: Rect, win: Rect, gap = 0): Rect {
  if (action === 'centre') {
    // The window keeps its size (no bigger than the screen) and moves to the middle.
    const width = Math.min(win.width, work.width - 2 * gap);
    const height = Math.min(win.height, work.height - 2 * gap);
    return round({ x: work.x + (work.width - width) / 2, y: work.y + (work.height - height) / 2, width, height });
  }
  const a = SNAP_ACTIONS.find((s) => s.id === action)!.area;
  // Neighbouring windows share one gap between them, not two.
  const x0 = work.x + a[0] * work.width;
  const y0 = work.y + a[1] * work.height;
  const x1 = x0 + a[2] * work.width;
  const y1 = y0 + a[3] * work.height;
  const left = a[0] === 0 ? gap : gap / 2;
  const top = a[1] === 0 ? gap : gap / 2;
  const right = a[0] + a[2] >= 0.999 ? gap : gap / 2;
  const bottom = a[1] + a[3] >= 0.999 ? gap : gap / 2;
  return round({ x: x0 + left, y: y0 + top, width: x1 - x0 - left - right, height: y1 - y0 - top - bottom });
}

/** The screen a window is on: the one holding its centre, or the one it overlaps most. */
export function displayIndexFor(win: Rect, displays: Rect[]): number {
  const cx = win.x + win.width / 2;
  const cy = win.y + win.height / 2;
  const inside = displays.findIndex((d) => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height);
  if (inside >= 0) return inside;
  let best = 0;
  let most = -1;
  displays.forEach((d, i) => {
    const w = Math.min(win.x + win.width, d.x + d.width) - Math.max(win.x, d.x);
    const h = Math.min(win.y + win.height, d.y + d.height) - Math.max(win.y, d.y);
    const a = Math.max(0, w) * Math.max(0, h);
    if (a > most) { most = a; best = i; }
  });
  return best;
}

/** Screens in reading order: left to right, then top to bottom (the order "next screen" walks). */
export function screenOrder(displays: Rect[]): number[] {
  return displays.map((_, i) => i).sort((a, b) => displays[a].x - displays[b].x || displays[a].y - displays[b].y);
}

/** The same place and size, relative to the screen, on the next screen (wrapping round). */
export function nextDisplayRect(win: Rect, works: Rect[]): Rect {
  if (works.length < 2) return round(win);
  const order = screenOrder(works);
  const from = displayIndexFor(win, works);
  const to = order[(order.indexOf(from) + 1) % order.length];
  return fromRelative(toRelative(win, works[from]), works[to]);
}

/** A window's place as fractions of a screen's usable area. */
export function toRelative(win: Rect, work: Rect): Rect {
  return { x: (win.x - work.x) / work.width, y: (win.y - work.y) / work.height, width: win.width / work.width, height: win.height / work.height };
}

/** Fractions back into points, kept inside the screen. */
export function fromRelative(rel: Rect, work: Rect): Rect {
  const width = Math.min(work.width, Math.max(80, rel.width * work.width));
  const height = Math.min(work.height, Math.max(60, rel.height * work.height));
  const x = Math.min(work.x + work.width - width, Math.max(work.x, work.x + rel.x * work.width));
  const y = Math.min(work.y + work.height - height, Math.max(work.y, work.y + rel.y * work.height));
  return round({ x, y, width, height });
}

/** Where a snap action sends a window, given every screen's usable area. */
export function targetRect(action: SnapAction, win: Rect, works: Rect[], gap = 0): Rect {
  if (!works.length) return round(win);
  if (action === 'nextDisplay') return nextDisplayRect(win, works);
  return snapRect(action, works[displayIndexFor(win, works)], win, gap);
}

/** X11: the window manager's frame around a window (xprop's _NET_FRAME_EXTENTS line: left, right, top, bottom). */
export function parseFrameExtents(text: string): { left: number; right: number; top: number; bottom: number } {
  const m = /=\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/.exec(text ?? '');
  return m ? { left: +m[1], right: +m[2], top: +m[3], bottom: +m[4] } : { left: 0, right: 0, top: 0, bottom: 0 };
}

/** The window's own size inside its frame, so the frame (title bar and all) fills the target. */
export function insideFrame(r: Rect, f: { left: number; right: number; top: number; bottom: number }): Rect {
  return round({ x: r.x, y: r.y, width: r.width - f.left - f.right, height: r.height - f.top - f.bottom });
}

// ---------------------------------------------------------------- saved layouts

/** One set of screens, the same whichever order the system lists them in: "1440x900+2560x1440". */
export function displaySetKey(screens: { width: number; height: number }[]): string {
  return screens.map((s) => `${Math.round(s.width)}x${Math.round(s.height)}`).sort().join('+');
}

/** A name for a set of screens people recognise: one screen is the laptop on its own; more is docked. */
export function displaySetName(screens: { width: number; height: number }[]): string {
  return screens.length <= 1 ? 'Laptop' : screens.length === 2 ? 'Docked' : `Docked, ${screens.length} screens`;
}

export interface SavedWindow {
  /** the app's name as the system reports it */
  app: string;
  title: string;
  /** which screen, in reading order */
  screen: number;
  /** fractions of that screen's usable area */
  rel: Rect;
}

export interface SnapLayout {
  id: string;
  name: string;
  /** displaySetKey of the screens it was saved on */
  screens: string;
  windows: SavedWindow[];
  savedAt: number;
}

export interface LiveWindow { id: string; app: string; title: string; bounds: Rect }

/** Apps whose windows are not worth saving: the desktop itself, docks and panels. */
const SKIP_APPS = /^(finder desktop|dock|window ?server|control ?center|systemuiserver|notification ?center|explorer desktop|progman|gnome-shell|plasmashell|xfdesktop|xfce4-panel|nautilus-desktop)$/i;

/** How windows sit now, as a layout to keep (tiny and nameless windows are left out). */
export function captureLayout(windows: LiveWindow[], works: Rect[], name: string, screens: { width: number; height: number }[], now = Date.now()): SnapLayout {
  const order = screenOrder(works);
  const kept = windows
    .filter((w) => w.app && !SKIP_APPS.test(w.app.trim()) && w.bounds.width >= 80 && w.bounds.height >= 60)
    .map((w): SavedWindow => {
      const i = displayIndexFor(w.bounds, works);
      return { app: w.app, title: w.title, screen: Math.max(0, order.indexOf(i)), rel: roundRel(toRelative(w.bounds, works[i])) };
    });
  return { id: `l${now.toString(36)}`, name: name.trim() || displaySetName(screens), screens: displaySetKey(screens), windows: kept.slice(0, 60), savedAt: now };
}

const roundRel = (r: Rect): Rect => ({ x: +r.x.toFixed(4), y: +r.y.toFixed(4), width: +r.width.toFixed(4), height: +r.height.toFixed(4) });

/**
 * Which open window goes where. A saved window is matched to an open one of the
 * same app with the same title first, then to any unused window of that app
 * (titles change as documents do). Windows of apps not in the layout stay put.
 */
export function planRestore(layout: SnapLayout, windows: LiveWindow[], works: Rect[]): { id: string; app: string; to: Rect }[] {
  if (!works.length) return [];
  const order = screenOrder(works);
  const used = new Set<string>();
  const out: { id: string; app: string; to: Rect }[] = [];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const pick = (s: SavedWindow) =>
    windows.find((w) => !used.has(w.id) && same(w.app, s.app) && w.title === s.title) ??
    windows.find((w) => !used.has(w.id) && same(w.app, s.app));
  for (const s of layout.windows) {
    const w = pick(s);
    if (!w) continue;
    used.add(w.id);
    const screen = works[order[Math.min(s.screen, order.length - 1)]];
    out.push({ id: w.id, app: w.app, to: fromRelative(s.rel, screen) });
  }
  return out;
}

/** The layout saved for this set of screens, the newest when there are several. */
export function layoutForScreens(layouts: SnapLayout[], key: string): SnapLayout | undefined {
  return layouts.filter((l) => l.screens === key).sort((a, b) => b.savedAt - a.savedAt)[0];
}

export function normalizeLayouts(raw: unknown): SnapLayout[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return raw
    .filter((l): l is SnapLayout => !!l && typeof l === 'object' && typeof (l as SnapLayout).id === 'string' && Array.isArray((l as SnapLayout).windows))
    .map((l) => ({
      id: l.id,
      name: String(l.name ?? 'Layout').slice(0, 60),
      screens: String(l.screens ?? ''),
      savedAt: num(l.savedAt),
      windows: l.windows.filter((w) => w && typeof w.app === 'string' && w.rel).map((w) => ({ app: w.app, title: String(w.title ?? ''), screen: Math.max(0, Math.round(num(w.screen))), rel: { x: num(w.rel.x), y: num(w.rel.y), width: num(w.rel.width) || 0.5, height: num(w.rel.height) || 0.5 } })),
    }))
    .slice(0, 30);
}

// ---------------------------------------------------------------- what this computer allows

export type SnapState = 'ready' | 'permission' | 'missing' | 'monorail' | 'wayland' | 'unsupported';

export interface SnapFacts {
  platform: string;
  /** a Wayland session without X11 for the window in front */
  wayland?: boolean;
  /** Linux: xdotool or wmctrl can be run */
  tools?: boolean;
  /** macOS: Keeper may use Accessibility */
  accessibility?: boolean;
  /** macOS: Monorail runs and Keeper works with it */
  monorail?: boolean;
  /** Linux: the desktop, for the right hint (GNOME, KDE…) */
  desktop?: string;
}

export interface SnapAvailability {
  state: SnapState;
  /** one short line for the page */
  line: string;
  /** what the person can do instead or next */
  hint?: string;
}

/** What snapping can do on this computer, in plain words. */
export function snapAvailability(f: SnapFacts): SnapAvailability {
  if (f.platform === 'darwin') {
    if (f.monorail) return { state: 'monorail', line: 'Monorail arranges your windows, so Keeper’s snap shortcuts stay off.', hint: 'Change how windows sit in Monorail. Saved layouts here still work.' };
    if (f.accessibility === false) return { state: 'permission', line: 'Keeper needs Accessibility to move other apps’ windows.', hint: 'System Settings → Privacy & Security → Accessibility → Keeper.' };
    return { state: 'ready', line: 'Works with every app on this Mac.' };
  }
  if (f.platform === 'win32') return { state: 'ready', line: 'Works with every app on this PC.', hint: 'Dragging a window to an edge still uses Windows’ own snapping.' };
  if (f.platform === 'linux') {
    const de = (f.desktop ?? '').toLowerCase();
    if (f.wayland) {
      return {
        state: 'wayland',
        line: 'Wayland does not let apps move other apps’ windows, so Keeper cannot snap them here.',
        hint: de.includes('kde') ? 'KDE’s own shortcuts do it: Meta with the arrow keys, and Quick Tile in System Settings → Shortcuts.'
          : de.includes('gnome') ? 'GNOME’s own shortcuts do it: Super with the left and right arrows. Saved layouts need an X11 session.'
          : 'Your desktop’s own shortcuts may do it. Saved layouts need an X11 session.',
      };
    }
    if (f.tools === false) return { state: 'missing', line: 'Snapping needs wmctrl or xdotool.', hint: 'Install one of them (for example sudo apt install wmctrl), then check again.' };
    return { state: 'ready', line: 'Works with apps on this desktop.' };
  }
  return { state: 'unsupported', line: 'Snapping is not available on this system.' };
}

/** Shortcuts registered only when Keeper may actually move windows. */
export const snapShortcutsActive = (a: SnapAvailability) => a.state === 'ready' || a.state === 'permission';
