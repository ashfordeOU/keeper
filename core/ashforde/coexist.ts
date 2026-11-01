// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper and Monorail on the same Mac: the rules that keep the two from
// getting in each other's way (docs/KEEPER-MONORAIL.md has the full table).
//
//   windows     which of Keeper's windows Monorail tiles, and the smallest size
//               a tiled window may have so a half-width column or a two-high
//               slide never has to be squeezed past it
//   shortcuts   a free key for a shortcut both apps want
//   modes       Focus and presentation follow each other both ways, with one
//               owner at a time and no echo loops
//   awake       one keeper of the "stay awake" hold, never two
//   Stage       Monorail's layout before and after "hide other apps"
//   loops       a guard that stops any put-it-back tug of war
//   updates     who updates Monorail (Monorail's own updater, unless it is off)
//   handshake   what Keeper says about itself to Monorail, and reads back
//
// Pure: no Node or Electron here (electron/services/ashforde/coexist.ts acts on it).

import { BRAND } from '../brand';
import { KEEPER_BUNDLE_ID, MOD, OVERLAY_TITLES, acceleratorCombo, comboLabel, type KeyCombo, type MonorailSettings, type ShortcutClash } from './monorail';

// ---------------------------------------------------------------- Keeper's windows

/**
 * Ordinary windows Monorail should tile like any other app's: they have a
 * title bar, can be resized, and keep a small minimum size.
 */
export const TILED_WINDOWS: { name: string; title: RegExp }[] = [
  { name: 'Main window', title: new RegExp(`^${BRAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$|^Keeper$`) },
  { name: 'Tool windows', title: / — Keeper$/ },
  { name: 'Terminal', title: /^Terminal — Keeper$/ },
  { name: 'Keeper Browser (AI tasks)', title: /^Keeper Browser$/ },
  { name: 'Remote screen viewer', title: / — Keeper$/ },
];

/** Overlays and pop-overs Monorail must leave alone (they are panels with fixed titles). */
export const IGNORED_TITLES: string[] = Object.values(OVERLAY_TITLES);

/** Floating helpers that are ordinary windows but should float, not tile (Keeper's float rules). */
export const FLOATING_TITLES = ['Quick Search', 'Quick Terminal', 'Capture'];

/** How Monorail should treat a Keeper window with this title. */
export function keeperWindowKind(title: string): 'tile' | 'float' | 'ignore' {
  if (IGNORED_TITLES.some((t) => title === t || (t === OVERLAY_TITLES.stage && title.startsWith('Keeper Stage')))) return 'ignore';
  if (FLOATING_TITLES.some((t) => title.includes(t))) return 'float';
  return 'tile';
}

/**
 * The smallest a tiled Keeper window may be. Monorail's columns start at half
 * the screen (708 points on a 1440-point screen), and a slide of two stacked
 * windows on a 900-point screen gives each about 400 points; a larger minimum
 * makes macOS refuse the size Monorail asks for, and Monorail then retries.
 */
export const TILE_MIN = { width: 480, height: 360 } as const;

/** Whether a minimum size fits a half-width column and a two-high slide on a work area (Monorail's 8-point gaps). */
export function fitsTiling(min: { width: number; height: number }, work: { width: number; height: number }, gap = 8): boolean {
  const half = (work.width - 2 * gap - gap) / 2;
  const stacked = (work.height - 2 * gap - gap) / 2;
  return min.width <= half && min.height <= stacked;
}

// ---------------------------------------------------------------- shortcuts

/** Keys macOS keeps for itself (screenshots, Spotlight, force quit…): never suggested. */
const SYSTEM_KEYS = ['Command+Shift+3', 'Command+Shift+4', 'Command+Shift+5', 'Command+Shift+6', 'Command+Space', 'Control+Space', 'Command+Alt+Escape', 'Command+Shift+Q', 'Command+Alt+D', 'Control+Command+Q', 'Control+Command+F', 'Command+Shift+/']
  .map((a) => acceleratorCombo(a)!);

/** The modifier sets tried in turn for a free key: never ⌃⌥ (Monorail's family) and never ⌘ alone (app menus). */
const TRY_MODS = [MOD.command | MOD.shift, MOD.command | MOD.option, MOD.command | MOD.option | MOD.shift, MOD.command | MOD.control, MOD.command | MOD.control | MOD.shift, MOD.control | MOD.shift];

/** An Electron accelerator for a combo, the way Keeper's settings spell them. */
export function comboAccelerator(c: KeyCombo): string {
  const parts: string[] = [];
  if (c.mods & MOD.command) parts.push('CommandOrControl');
  if (c.mods & MOD.control) parts.push('Control');
  if (c.mods & MOD.option) parts.push('Alt');
  if (c.mods & MOD.shift) parts.push('Shift');
  return [...parts, c.key].join('+');
}

const same = (a: KeyCombo, b: KeyCombo) => a.mods === b.mods && a.key.toUpperCase() === b.key.toUpperCase();

/** A free key for Keeper's shortcut: the same letter with other modifiers, free in both apps and in macOS. */
export function suggestShortcut(acc: string, taken: KeyCombo[]): string | null {
  const c = acceleratorCombo(acc);
  if (!c) return null;
  const busy = [...taken, ...SYSTEM_KEYS];
  for (const mods of TRY_MODS) {
    const cand = { mods, key: c.key };
    if (mods === c.mods || busy.some((b) => same(b, cand))) continue;
    return comboAccelerator(cand);
  }
  return null;
}

/** Each clash with a free key to use instead (Keeper's shortcut changes; Monorail's keymap is left alone). */
export function withSuggestions(clashes: ShortcutClash[], keeper: Record<string, string>, monorail: KeyCombo[]): (ShortcutClash & { suggestion?: string; suggestionLabel?: string })[] {
  const taken: KeyCombo[] = [...monorail, ...Object.values(keeper).map((a) => acceleratorCombo(a)).filter((c): c is KeyCombo => !!c)];
  return clashes.map((k) => {
    const s = suggestShortcut(k.accelerator, taken);
    if (!s) return k;
    const c = acceleratorCombo(s)!;
    taken.push(c);
    return { ...k, suggestion: s, suggestionLabel: comboLabel(c) };
  });
}

/** A settings patch that sets one dotted path ("island.captureShortcut"), keeping its neighbours. */
export function patchAtPath(settings: Record<string, unknown>, dotted: string, value: unknown): Record<string, unknown> | null {
  const keys = dotted.split('.');
  if (!keys.length || keys.some((k) => !k || k === '__proto__' || k === 'constructor' || k === 'prototype')) return null;
  const build = (obj: unknown, i: number): unknown => {
    if (i === keys.length) return value;
    const base = obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
    if (!base || !(keys[i] in base)) return undefined;
    const inner = build(base[keys[i]], i + 1);
    return inner === undefined ? undefined : { ...base, [keys[i]]: inner };
  };
  const top = build(settings, 0) as Record<string, unknown> | undefined;
  return top ? { [keys[0]]: top[keys[0]] } : null;
}

// ---------------------------------------------------------------- Focus and presentation, both ways

export interface ModeSync {
  /** who switched it on (and so who switches it off) */
  owner: 'keeper' | 'monorail' | null;
  keeper: boolean;
  monorail: boolean;
}

export const MODE_OFF: ModeSync = { owner: null, keeper: false, monorail: false };

/** Keeper's side changed: whether Monorail should be told. */
export function keeperModeChanged(s: ModeSync, on: boolean): { next: ModeSync; tellMonorail?: boolean } {
  if (on === s.keeper) return { next: s };
  if (on) {
    // Monorail already on: Keeper followed it (or it was an echo), nothing to send.
    if (s.monorail) return { next: { ...s, keeper: true, owner: s.owner ?? 'monorail' } };
    return { next: { owner: 'keeper', keeper: true, monorail: true }, tellMonorail: true };
  }
  // Keeper ended it: Monorail ends too, whoever started it.
  return { next: { owner: null, keeper: false, monorail: false }, tellMonorail: s.monorail ? false : undefined };
}

/** Monorail's side changed (state.json): whether Keeper should follow. */
export function monorailModeChanged(s: ModeSync, on: boolean): { next: ModeSync; tellKeeper?: boolean } {
  if (on === s.monorail) return { next: s };
  if (on) {
    if (s.keeper) return { next: { ...s, monorail: true } };
    return { next: { owner: 'monorail', keeper: true, monorail: true }, tellKeeper: true };
  }
  // Monorail's own timer ended a mode Keeper started: Keeper's session goes on, and Keeper does not switch it back on.
  if (s.owner === 'keeper') return { next: { ...s, monorail: false } };
  if (s.keeper) return { next: { owner: null, keeper: false, monorail: false }, tellKeeper: false };
  return { next: { ...s, monorail: false } };
}

// ---------------------------------------------------------------- staying awake: one owner

export interface MonorailAwake { on: boolean; status?: string }

/**
 * Keeper is starting a Keep Awake session while Monorail's Stay Awake may be on.
 * One hold is enough: a session Monorail started by hand is handed over to
 * Keeper (which has the battery, heat and closed-lid rules); one started by a
 * Monorail trigger cannot be ended from outside and is only mentioned.
 */
export function awakeHandOver(m: MonorailAwake | null | undefined): { action: 'none' | 'end-monorail' | 'note'; note?: string } {
  if (!m?.on) return { action: 'none' };
  if (/^On\s*·/.test(m.status ?? '')) return { action: 'note', note: `Monorail’s Stay Awake is also on (${m.status!.replace(/^On\s*·\s*/, '')}); it ends by itself when its trigger does.` };
  return { action: 'end-monorail', note: 'Keeper took over keeping your Mac awake from Monorail’s Stay Awake, so there is one hold, not two.' };
}

/** After Keeper's session ends: say so if Monorail still keeps the Mac awake (otherwise the person wonders why it does not sleep). */
export function awakeAfterNote(m: MonorailAwake | null | undefined): string | undefined {
  return m?.on ? `Monorail’s Stay Awake is still on${m.status ? ` (${m.status.replace(/^On\s*/, '').replace(/^·\s*/, '')})` : ''}, so your Mac stays awake until it ends.` : undefined;
}

// ---------------------------------------------------------------- Stage and Monorail's layout

export interface MonoWindow { id: number; app: string; title: string; floating?: boolean; workspace?: number; slide?: number; bundleID?: string; visible?: boolean }

/** Monorail's window list (GET /windows), leniently. */
export function parseWindows(v: unknown): MonoWindow[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((w) => {
    if (!w || typeof w !== 'object') return [];
    const o = w as Record<string, unknown>;
    if (typeof o.id !== 'number') return [];
    const num = (x: unknown) => (typeof x === 'number' ? x : undefined);
    return [{ id: o.id, app: String(o.app ?? ''), title: String(o.title ?? ''), floating: o.floating === true, workspace: num(o.workspace), slide: num(o.slide), bundleID: typeof o.bundleID === 'string' ? o.bundleID : undefined, visible: o.visible === true }];
  });
}

export interface LayoutRepair {
  /** windows that came back on another workspace, and where they belong */
  moves: { id: number; workspace: number }[];
  /** tiled before, not tiled now (still hidden, closed, or not back yet) */
  missing: number[];
  /** back on the right workspace but in another slide */
  reordered: number[];
}

/** What changed in Monorail's layout between two window lists (tiled windows only). */
export function layoutRepairs(before: MonoWindow[], after: MonoWindow[]): LayoutRepair {
  const now = new Map(after.map((w) => [w.id, w]));
  const out: LayoutRepair = { moves: [], missing: [], reordered: [] };
  for (const b of before) {
    if (b.floating || b.workspace === undefined) continue;
    const a = now.get(b.id);
    if (!a || a.floating || a.workspace === undefined) out.missing.push(b.id);
    else if (a.workspace !== b.workspace) out.moves.push({ id: b.id, workspace: b.workspace });
    else if (b.slide !== undefined && a.slide !== b.slide) out.reordered.push(b.id);
  }
  return out;
}

export const layoutIntact = (r: LayoutRepair) => !r.moves.length && !r.missing.length && !r.reordered.length;

/** Monorail is the window manager: hiding it would only hide its own overlays, so Stage leaves it on screen (presentation mode hides them). */
export const MONORAIL_PROCESS_NAMES = ['Monorail', 'MacSlider'];

// ---------------------------------------------------------------- loops

/**
 * Stops a tug of war: each time something is put back (a window snapped back,
 * a file re-read), call allow(); after `limit` times in `windowMs` it says no
 * for `coolMs`, and `trips` counts how often that happened.
 */
export class TugGuard {
  private hits = new Map<string, number[]>();
  private until = new Map<string, number>();
  trips = 0;
  constructor(private limit = 6, private windowMs = 10_000, private coolMs = 60_000) {}

  allow(key = '', now = Date.now()): boolean {
    if ((this.until.get(key) ?? 0) > now) return false;
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.hits.set(key, recent);
    if (recent.length > this.limit) {
      this.until.set(key, now + this.coolMs);
      this.hits.set(key, []);
      this.trips++;
      return false;
    }
    return true;
  }

  stopped(key = '', now = Date.now()) {
    return (this.until.get(key) ?? 0) > now;
  }
}

// ---------------------------------------------------------------- updates

/** Monorail updates itself unless its own check is off; then Keeper offers its updates. Never both. */
export function updatesBy(s: MonorailSettings): 'monorail' | 'keeper' {
  return s.checkForUpdates === false ? 'keeper' : 'monorail';
}

/** Monorail's own updater is swapping the app now (its relaunch script leaves "Monorail.app.previous" while it works). */
export function selfUpdating(o: { previousExists: boolean; scriptRunning: boolean }): boolean {
  return o.previousExists || o.scriptRunning;
}

// ---------------------------------------------------------------- themes

/**
 * Whether Keeper should write its matching theme into Monorail: only when
 * Keeper's own theme changed (or the person just asked), so a theme picked in
 * Monorail is never overwritten by an unrelated Keeper change.
 */
export function shouldPushTheme(want: string, last: string | undefined, current: string | undefined, force = false): boolean {
  if (current === want) return false;
  return force || last !== want;
}

// ---------------------------------------------------------------- desktop pictures

/** Monorail settings that also change the desktop, which Keeper's wallpaper would fight with. */
export function desktopOverlap(s: MonorailSettings & { workspaceWallpapers?: Record<string, string>; driftWallpaper?: string }): string | undefined {
  const per = Object.values(s.workspaceWallpapers ?? {}).filter(Boolean).length;
  if (per) return `Monorail sets a desktop picture for ${per} workspace${per === 1 ? '' : 's'}; it replaces Keeper’s wallpaper when you switch workspace. Use one of them for the desktop.`;
  if (s.driftWallpaper) return 'Monorail’s drifting wallpaper sits above the desktop, so Keeper’s live wallpaper is hidden behind it. Use one of them for the desktop.';
  return undefined;
}

// ---------------------------------------------------------------- the handshake

export interface PeerHello {
  app: string;
  bundleID: string;
  version: string;
  pid: number;
  /** what this app keeps for itself while both run */
  owns: { awake: boolean; focus: boolean; stage: boolean };
  /** its windows another arranger must leave alone (fixed titles) */
  overlays: string[];
  /** where to reach it: Keeper's links (keeper://awake, keeper://focus, keeper://stage) */
  links: string[];
  state: { focus: boolean; awake: boolean; stage: boolean };
}

/** What Keeper tells Monorail about itself (POST /peer, and `keeper/hello` on Keeper's own channel). */
export function keeperHello(o: { version: string; pid: number; focus: boolean; awake: boolean; stage: boolean }): PeerHello {
  return {
    app: 'Keeper', bundleID: KEEPER_BUNDLE_ID, version: o.version, pid: o.pid,
    owns: { awake: true, focus: false, stage: true },
    overlays: IGNORED_TITLES,
    links: ['keeper://awake?for=30m', 'keeper://awake/off', 'keeper://focus?minutes=25', 'keeper://focus?minutes=0', 'keeper://stage/on', 'keeper://stage/off'],
    state: { focus: o.focus, awake: o.awake, stage: o.stage },
  };
}

/** Monorail's answer to GET /hello, when its version has one (null otherwise). */
export function parseHello(v: unknown): { app: string; version?: string; presenting?: boolean; awake?: boolean; focusMode?: boolean; paused?: boolean } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.app !== 'string') return null;
  const b = (x: unknown) => (typeof x === 'boolean' ? x : undefined);
  return { app: o.app, version: typeof o.version === 'string' ? o.version : undefined, presenting: b(o.presenting), awake: b(o.awake), focusMode: b(o.focusMode), paused: b(o.paused) };
}
