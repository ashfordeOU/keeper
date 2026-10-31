// SPDX-License-Identifier: AGPL-3.0-or-later
// Where the Island sits on each screen. Pure: the Electron side measures the
// displays (bounds, the area left after menu bars, panels and taskbars, scale,
// rotation, built-in or not) and this decides where the camera is, what the
// top bar covers, and the Island's window rectangle.
//
//   Mac with a notch       the Island grows out of the notch, in the same black
//   Mac without a notch    inside the menu bar when its middle is free, else just below it
//   GNOME / KDE top bar    just below the bar (GNOME keeps its clock in the middle)
//   Windows, other Linux   flush with the top edge, under the camera in the bezel
//   tablets                follows the camera when the screen is turned

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Edge = 'top' | 'left' | 'right' | 'bottom';

export interface DisplayInfo {
  id: number;
  bounds: Rect;
  /** what is left after the menu bar, top bar, docks, panels and taskbars */
  workArea: Rect;
  scaleFactor: number;
  /** a laptop's or tablet's own screen */
  internal: boolean;
  /** degrees the picture is turned, clockwise */
  rotation: 0 | 90 | 180 | 270;
  touch: boolean;
  primary?: boolean;
}

export interface PlaceEnv {
  platform: string;
  /** Linux desktop, from XDG_CURRENT_DESKTOP */
  desktop?: 'gnome' | 'kde' | 'other';
  /** macOS model identifier, e.g. MacBookPro18,3 */
  macModel?: string;
  /** frames of menu-bar items (macOS), when the helper could read them */
  menuBarItems?: Rect[];
  /** exact notch rectangle per display id (macOS helper), in points */
  notchRects?: Record<number, Rect>;
  /** where the front app's menus end, in screen points (macOS, read through System Events when allowed) */
  appMenuRight?: number;
  /** a battery is present: a laptop or tablet even when Electron cannot tell which screen is built in */
  hasBattery?: boolean;
}

export interface PlaceOptions {
  edge: 'top' | 'left' | 'right';
  size: 'compact' | 'normal' | 'large';
  blendNotch: boolean;
  cameraEdge: 'auto' | Edge;
  followCamera: boolean;
  offsetX: number;
  offsetY: number;
}

export const APP_MENU_GUESS = 0.42;

export const DEFAULT_PLACE: PlaceOptions = { edge: 'top', size: 'normal', blendNotch: true, cameraEdge: 'auto', followCamera: true, offsetX: 0, offsetY: 0 };

export interface Cutout {
  /** notch: a real cut-out in the screen; camera: a camera in the bezel; none: an external screen */
  kind: 'notch' | 'camera' | 'none';
  edge: Edge;
  /** size of the cut-out in points (0 for a bezel camera) */
  width: number;
  height: number;
  /** centre of the cut-out along its edge, in points from the display's left (or top) */
  center: number;
}

export type Anchor = 'notch' | 'menubar' | 'below-bar' | 'edge' | 'side';

export interface Placement {
  displayId: number;
  anchor: Anchor;
  /** which edge the Island hangs from */
  edge: Edge;
  cutout: Cutout;
  /** height of the bar along the top (menu bar, top bar, top taskbar); 0 when there is none */
  topBar: number;
  /** what the top bar is */
  topBarKind: 'menubar' | 'gnome' | 'panel' | 'taskbar' | 'none';
  /** the window rectangles, in screen coordinates (points) */
  collapsed: Rect;
  expanded: Rect;
  /** the pill's own size inside the collapsed window */
  pill: { width: number; height: number };
  /** width to leave empty in the middle of the pill (the notch); 0 when nothing is in the way */
  gap: number;
  /** notch only: how wide each side of the notch may grow without covering menus or menu-bar icons */
  wing?: number;
  /** notch only: when there is no room beside it, the height of a small tab hanging below the notch instead */
  hang?: number;
  scale: number;
  /** a sentence for Settings: why the Island is where it is */
  reason: string;
}

// ---------------------------------------------------------------- Macs

/** Macs whose built-in screen has a notch, with the screen's native width in pixels. */
const NOTCHED: Record<string, { native: number; notchPx: number }> = {
  // 14-inch and 16-inch MacBook Pro (M1 Pro/Max onwards)
  'MacBookPro18,1': { native: 3456, notchPx: 372 }, 'MacBookPro18,2': { native: 3456, notchPx: 372 },
  'MacBookPro18,3': { native: 3024, notchPx: 372 }, 'MacBookPro18,4': { native: 3024, notchPx: 372 },
  'Mac14,5': { native: 3024, notchPx: 372 }, 'Mac14,9': { native: 3024, notchPx: 372 },
  'Mac14,6': { native: 3456, notchPx: 372 }, 'Mac14,10': { native: 3456, notchPx: 372 },
  'Mac15,3': { native: 3024, notchPx: 372 }, 'Mac15,6': { native: 3024, notchPx: 372 }, 'Mac15,8': { native: 3024, notchPx: 372 }, 'Mac15,10': { native: 3024, notchPx: 372 },
  'Mac15,7': { native: 3456, notchPx: 372 }, 'Mac15,9': { native: 3456, notchPx: 372 }, 'Mac15,11': { native: 3456, notchPx: 372 },
  'Mac16,1': { native: 3024, notchPx: 372 }, 'Mac16,6': { native: 3024, notchPx: 372 }, 'Mac16,8': { native: 3024, notchPx: 372 },
  'Mac16,5': { native: 3456, notchPx: 372 }, 'Mac16,7': { native: 3456, notchPx: 372 },
  // MacBook Air 13-inch and 15-inch (M2 onwards)
  'Mac14,2': { native: 2560, notchPx: 330 }, 'Mac14,15': { native: 2880, notchPx: 330 },
  'Mac15,12': { native: 2560, notchPx: 330 }, 'Mac15,13': { native: 2880, notchPx: 330 },
  'Mac16,12': { native: 2560, notchPx: 330 }, 'Mac16,13': { native: 2880, notchPx: 330 },
};

/** Macs known to have no notch (desktops, the 13-inch MacBook Pro, older laptops). */
const NO_NOTCH = /^(MacBookPro1[0-7],|MacBookAir|MacBook\d|iMac|Macmini|MacPro|Mac14,(3|7|8|12|13|14)$|Mac15,(4|5|14)$|Mac16,(2|3|9|10|11)$)/;

/** The notch on this display, or undefined. */
export function macNotch(d: DisplayInfo, env: PlaceEnv): Cutout | undefined {
  if (!d.internal) return undefined;
  const exact = env.notchRects?.[d.id];
  if (exact && exact.width > 0) return { kind: 'notch', edge: 'top', width: exact.width, height: exact.height, center: exact.x - d.bounds.x + exact.width / 2 };
  const bar = d.workArea.y - d.bounds.y;
  const model = env.macModel ?? '';
  const known = NOTCHED[model];
  // Newer models we do not know yet: the menu bar of a notched screen is as tall as the notch (≥ 32 points).
  const notched = known ? true : NO_NOTCH.test(model) ? false : bar >= 32;
  if (!notched) return undefined;
  // The notch is the same number of pixels whatever resolution is chosen; in points it shrinks as the picture gets denser.
  const native = known?.native ?? d.bounds.width * d.scaleFactor;
  const px = known?.notchPx ?? 360;
  const width = Math.round((px * d.bounds.width) / native);
  const height = bar >= 24 ? Math.min(bar, 40) : 32;
  return { kind: 'notch', edge: 'top', width, height, center: d.bounds.width / 2 };
}

// ---------------------------------------------------------------- the camera

/** Where the camera is on a screen turned by `rotation` (native landscape, camera on top). */
export function cameraEdgeFor(rotation: DisplayInfo['rotation']): Edge {
  return rotation === 90 ? 'right' : rotation === 180 ? 'bottom' : rotation === 270 ? 'left' : 'top';
}

export function cutoutFor(d: DisplayInfo, env: PlaceEnv, o: PlaceOptions): Cutout {
  if (env.platform === 'darwin') {
    const n = macNotch(d, env);
    if (n) return n;
  }
  const laptop = d.internal || (!!env.hasBattery && !!d.primary && env.platform !== 'darwin');
  if (!laptop && o.cameraEdge === 'auto') return { kind: 'none', edge: 'top', width: 0, height: 0, center: d.bounds.width / 2 };
  const edge = o.cameraEdge === 'auto' ? cameraEdgeFor(d.rotation) : o.cameraEdge;
  const along = edge === 'left' || edge === 'right' ? d.bounds.height : d.bounds.width;
  return { kind: 'camera', edge, width: 0, height: 0, center: along / 2 };
}

// ---------------------------------------------------------------- bars

export function insets(d: DisplayInfo) {
  return {
    top: Math.max(0, d.workArea.y - d.bounds.y),
    left: Math.max(0, d.workArea.x - d.bounds.x),
    right: Math.max(0, d.bounds.x + d.bounds.width - (d.workArea.x + d.workArea.width)),
    bottom: Math.max(0, d.bounds.y + d.bounds.height - (d.workArea.y + d.workArea.height)),
  };
}

function topBarKind(env: PlaceEnv, top: number): Placement['topBarKind'] {
  if (!top) return 'none';
  if (env.platform === 'darwin') return 'menubar';
  if (env.platform === 'win32') return 'taskbar';
  return env.desktop === 'gnome' ? 'gnome' : 'panel';
}

/**
 * Room in the middle of the menu bar, from the items' frames: app menus grow
 * from the left, status items from the right. Returns the half-width that is
 * free on both sides of the centre. App menus are not windows of their own, so
 * when none are given they are assumed to reach 42% of the way across.
 */
export function freeMenuBarMiddle(d: DisplayInfo, items: Rect[]): number {
  const mid = d.bounds.x + d.bounds.width / 2;
  const onScreen = items.filter((r) => r.y < d.bounds.y + 60 && r.x + r.width > d.bounds.x && r.x < d.bounds.x + d.bounds.width);
  let left = d.bounds.x;
  let right = d.bounds.x + d.bounds.width;
  for (const r of onScreen) {
    if (r.x + r.width <= mid) left = Math.max(left, r.x + r.width);
    else if (r.x >= mid) right = Math.min(right, r.x);
    else return 0; // something sits across the middle
  }
  if (!onScreen.some((r) => r.x + r.width <= mid)) left = Math.max(left, d.bounds.x + d.bounds.width * APP_MENU_GUESS);
  return Math.max(0, Math.min(mid - left, right - mid));
}

/** The same, using where the front app's menus really end when that is known. */
export function freeMenuBarMiddleWith(d: DisplayInfo, items: Rect[], appMenuRight?: number): number {
  const B = d.bounds;
  if (appMenuRight === undefined || appMenuRight <= B.x || appMenuRight >= B.x + B.width) return freeMenuBarMiddle(d, items);
  // Known menus replace the guess (a menu frame counts as an item on the left).
  return freeMenuBarMiddle(d, [...items, { x: B.x, y: B.y, width: appMenuRight - B.x, height: 1 }]);
}

/**
 * Room on each side of the notch before the menus (left) and the menu-bar
 * icons (right) begin. macOS keeps icons out from behind the notch but lets
 * them sit right next to it, and an app with many menus can reach it too.
 */
export function roomBesideNotch(d: DisplayInfo, env: PlaceEnv, notch: Cutout): { left: number; right: number; menusKnown: boolean } {
  const B = d.bounds;
  const nl = B.x + notch.center - notch.width / 2;
  const nr = nl + notch.width;
  const onScreen = (env.menuBarItems ?? []).filter((r) => r.y < B.y + 60 && r.x + r.width > B.x && r.x < B.x + B.width);
  let left = B.x;
  let right = B.x + B.width;
  for (const r of onScreen) {
    if (r.x + r.width <= nl + 1) left = Math.max(left, r.x + r.width);
    else if (r.x >= nr - 1) right = Math.min(right, r.x);
  }
  const menusKnown = env.appMenuRight !== undefined && env.appMenuRight > B.x && env.appMenuRight < B.x + B.width;
  if (menusKnown && env.appMenuRight! <= nl + 1) left = Math.max(left, env.appMenuRight!);
  // Menus that do not fit before the notch carry on after it.
  if (menusKnown && env.appMenuRight! > nl + 1) left = nl;
  return { left: Math.max(0, nl - left), right: Math.max(0, right - nr), menusKnown };
}

// ---------------------------------------------------------------- sizes

const SCALE: Record<PlaceOptions['size'], number> = { compact: 0.86, normal: 1, large: 1.2 };
/** collapsed window (holds the pill, a second bubble, and room for the shadow and the morph) */
const COLLAPSED = { width: 400, height: 72 };
const EXPANDED = { width: 700, height: 380 };
/** the pill when nothing is in the way */
const PILL = { width: 220, height: 34 };
/** room on each side of the notch for a glyph */
const WING = 64;
/** narrower than this, a side of the notch cannot hold a glyph */
const MIN_WING = 26;
/** space kept clear next to menus and icons */
const MARGIN = 8;
/** the tab that hangs below the notch when there is no room beside it */
const HANG = 24;

// ---------------------------------------------------------------- placement

export function place(d: DisplayInfo, env: PlaceEnv, opt: Partial<PlaceOptions> = {}): Placement {
  const o = { ...DEFAULT_PLACE, ...opt };
  const scale = SCALE[o.size] ?? 1;
  const ins = insets(d);
  const cutout = cutoutFor(d, env, o);
  const kind = topBarKind(env, ins.top);
  const B = d.bounds;
  const sz = (r: { width: number; height: number }) => ({ width: Math.round(r.width * scale), height: Math.round(r.height * scale) });

  // Sideways: chosen in Settings, or a turned tablet whose camera is on a long side.
  const sideEdge: 'left' | 'right' | undefined =
    o.edge === 'left' || o.edge === 'right' ? o.edge
      : o.followCamera && cutout.kind === 'camera' && (cutout.edge === 'left' || cutout.edge === 'right') ? cutout.edge
        : undefined;
  if (sideEdge) {
    const c = sz(COLLAPSED);
    const e = sz(EXPANDED);
    const x = (w: number) => (sideEdge === 'left' ? d.workArea.x : d.workArea.x + d.workArea.width - w);
    const yMid = cutout.kind === 'camera' && cutout.edge === sideEdge ? B.y + cutout.center : d.workArea.y + d.workArea.height * 0.3 + c.height / 2;
    const y = (h: number) => clamp(Math.round(yMid - h / 2), d.workArea.y, d.workArea.y + d.workArea.height - h);
    return finish({
      displayId: d.id, anchor: 'side', edge: sideEdge, cutout, topBar: ins.top, topBarKind: kind, scale, gap: 0,
      pill: sz(PILL),
      collapsed: { x: x(c.width), y: y(c.height), ...c },
      expanded: { x: x(e.width), y: y(e.height), ...e },
      reason: o.edge === sideEdge ? `On the ${sideEdge} edge, as chosen in Settings.` : `The screen is turned, so the camera is on the ${sideEdge}; the Island follows it.`,
    }, d, o);
  }

  let anchor: Anchor;
  let top: number;
  let pill = sz(PILL);
  let gap = 0;
  let reason: string;
  let wing: number | undefined;
  let hang: number | undefined;
  if (cutout.kind === 'notch' && o.blendNotch) {
    anchor = 'notch';
    top = B.y;
    gap = cutout.width;
    // Both sides grow by the same amount, as far as the tighter side allows, so nothing in the menu bar is covered.
    const room = roomBesideNotch(d, env, cutout);
    // Without the menus' position, the left side is assumed to have as much room as the right.
    const free = Math.min(room.right, room.menusKnown ? room.left : room.right) - MARGIN;
    wing = Math.max(0, Math.min(Math.round(WING * scale), Math.floor(free)));
    if (wing >= MIN_WING * scale) {
      pill = { width: Math.round(cutout.width + 2 * wing), height: Math.round(cutout.height) };
      hang = 0;
      reason = wing >= Math.round(WING * scale)
        ? 'Grows out of the notch, in the same black, with room on both sides for what is happening.'
        : 'Grows out of the notch only as far as the menus and menu-bar icons beside it allow.';
    } else {
      // No room beside the notch: show what is happening in a small tab just below it instead.
      wing = 0;
      hang = Math.round(HANG * scale);
      // Exactly the notch's width, so its top never reaches the icons beside the notch.
      pill = { width: Math.round(cutout.width), height: Math.round(cutout.height) };
      reason = 'The menus and icons reach the notch, so what is happening shows in a small tab just below it.';
    }
  } else if (env.platform === 'darwin' && kind === 'menubar') {
    const need = pill.width / 2 + 12;
    const free = env.menuBarItems ? freeMenuBarMiddleWith(d, env.menuBarItems, env.appMenuRight) : 0;
    if (free >= need) {
      anchor = 'menubar';
      top = B.y;
      pill = { width: pill.width, height: Math.max(22, ins.top) };
      reason = 'Inside the menu bar: its middle is free.';
    } else {
      anchor = 'below-bar';
      top = d.workArea.y;
      reason = env.menuBarItems ? 'Just below the menu bar: its middle is taken by menus and icons.' : 'Just below the menu bar, so it never covers menus or icons.';
    }
  } else if (ins.top > 0) {
    anchor = 'below-bar';
    top = d.workArea.y;
    reason = kind === 'gnome' ? 'Just below the top bar, so the clock in its middle stays visible.' : kind === 'taskbar' ? 'Just below the taskbar at the top of the screen.' : 'Just below the panel at the top of the screen.';
  } else {
    anchor = 'edge';
    top = B.y;
    reason = cutout.kind === 'camera' ? 'Flush with the top edge, right under the camera.' : 'Flush with the top edge, in the middle.';
  }

  // Centre on the notch or camera when it is on top; otherwise on the screen.
  const centreX = B.x + (cutout.kind !== 'none' && cutout.edge === 'top' ? cutout.center : B.width / 2);
  const c = sz(COLLAPSED);
  c.width = Math.max(c.width, pill.width + 120);
  c.height = Math.max(c.height, pill.height + 40);
  const e = sz(EXPANDED);
  e.width = Math.max(e.width, pill.width + 120);
  return finish({
    displayId: d.id, anchor, edge: 'top', cutout, topBar: ins.top, topBarKind: kind, scale, gap, pill,
    ...(wing !== undefined ? { wing, hang } : {}),
    collapsed: { x: Math.round(centreX - c.width / 2), y: top, ...c },
    expanded: { x: Math.round(centreX - e.width / 2), y: top, ...e },
    reason,
  }, d, o);
}

/** Applies the nudge from Settings and keeps both rectangles on the screen. */
function finish(p: Placement, d: DisplayInfo, o: PlaceOptions): Placement {
  const fit = (r: Rect): Rect => ({
    ...r,
    x: clamp(r.x + Math.round(o.offsetX), d.bounds.x, d.bounds.x + d.bounds.width - r.width),
    y: clamp(r.y + Math.round(o.offsetY), d.bounds.y, d.bounds.y + d.bounds.height - r.height),
  });
  // A nudge away from the notch means it no longer lines up with it.
  const moved = p.anchor === 'notch' && (Math.abs(o.offsetX) > 2 || o.offsetY > 2);
  return { ...p, collapsed: fit(p.collapsed), expanded: fit(p.expanded), ...(moved ? { anchor: 'edge' as Anchor, gap: 0, reason: 'Moved away from the notch in Settings.' } : {}) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------- which screens

export type DisplayChoice = 'primary' | 'all' | 'mouse' | 'builtin';

export function chooseDisplays<T extends { id: number; internal: boolean }>(all: T[], choice: DisplayChoice, primaryId: number, cursorId?: number): T[] {
  const primary = all.find((d) => d.id === primaryId) ?? all[0];
  if (!primary) return [];
  if (choice === 'all') return all;
  if (choice === 'mouse') return [all.find((d) => d.id === cursorId) ?? primary];
  if (choice === 'builtin') {
    const own = all.filter((d) => d.internal);
    return own.length ? own : [primary];
  }
  return [primary];
}

// ---------------------------------------------------------------- Linux sessions

/** Wayland gives ordinary windows no say over where they go or whether they stay on top; XWayland does. */
export function needsXWayland(env: Record<string, string | undefined>, platform: string): boolean {
  if (platform !== 'linux') return false;
  return env.XDG_SESSION_TYPE === 'wayland' || (!env.XDG_SESSION_TYPE && !!env.WAYLAND_DISPLAY);
}

export function desktopOf(xdg: string | undefined): PlaceEnv['desktop'] {
  const v = (xdg ?? '').toLowerCase();
  if (/gnome|ubuntu|unity|pantheon|budgie|pop/.test(v)) return 'gnome';
  if (/kde|plasma/.test(v)) return 'kde';
  return 'other';
}
