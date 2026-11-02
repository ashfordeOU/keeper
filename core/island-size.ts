// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// How big the open Island is: four sizes (Compact, Regular, Large, Extra large),
// chosen per tab with a default for all tabs (Calendar, Week, Notes and Mail open
// Large unless the default is bigger). A size is in points at the Island's scale and
// is never bigger than the room the placement leaves (the display's work area). The
// grip on the panel's bottom edge snaps to the size nearest the height dragged to. Pure.

export type PanelSize = 'compact' | 'regular' | 'large' | 'xl';

export const PANEL_SIZES: readonly PanelSize[] = ['compact', 'regular', 'large', 'xl'];

export const PANEL_SIZE_LABEL: Record<PanelSize, string> = { compact: 'Compact', regular: 'Regular', large: 'Large', xl: 'Extra large' };

/** the panel below the notch (or the top edge), in points at scale 1 */
export const PANEL_PX: Record<PanelSize, { w: number; h: number }> = {
  compact: { w: 560, h: 260 },
  regular: { w: 640, h: 300 },
  large: { w: 820, h: 440 },
  xl: { w: 1000, h: 580 },
};

/**
 * A tab's own default box (content w × h at scale 1, below the notch), used when the person has not
 * picked a size for it and the default for all tabs is Regular. Empty for now: each tab's own layout
 * adds its entry here (e.g. home: { w: 600, h: 176 }); without one a tab opens at defaultSizeFor().
 * Compact / Regular / Large / Extra large stay the person's overrides.
 */
export const TAB_PANEL_PX: Partial<Record<string, { w: number; h: number }>> = {
  // More: the deck's four places, a filter and a grid of 64 × 56 tools, six to a row (scrolls past four rows).
  more: { w: 600, h: 300 },
};

/** Tabs that show a lot at once (a month, a week, notes, mail) and open Large by default. */
export const BIG_TABS: readonly string[] = ['calendar', 'week', 'notes', 'mail'];

export const isPanelSize = (v: unknown): v is PanelSize => typeof v === 'string' && (PANEL_SIZES as readonly string[]).includes(v);

const bigger = (a: PanelSize, b: PanelSize): PanelSize => (PANEL_SIZES.indexOf(a) >= PANEL_SIZES.indexOf(b) ? a : b);

export interface PanelSizeSettings {
  /** the size every tab opens at unless it has its own */
  panelSize?: string;
  /** a tab's own size (chosen with the grip, the size button or Settings) */
  panelSizes?: Record<string, string>;
}

/** The size a tab opens at when it has none of its own. */
export function defaultSizeFor(tab: string, s: PanelSizeSettings = {}): PanelSize {
  const base = isPanelSize(s.panelSize) ? s.panelSize : 'regular';
  return BIG_TABS.includes(tab) ? bigger(base, 'large') : base;
}

/** The size a tab opens at: its own, or the default for it. */
export function sizeFor(tab: string, s: PanelSizeSettings = {}): PanelSize {
  const own = s.panelSizes?.[tab];
  return isPanelSize(own) ? own : defaultSizeFor(tab, s);
}

/** What a tab opens at: the person's size, the tab's own default box, or the default size. */
export function tabPanel(tab: string, s: PanelSizeSettings = {}, table: Partial<Record<string, { w: number; h: number }>> = TAB_PANEL_PX): { size: PanelSize; px: { w: number; h: number }; own: boolean } {
  const own = s.panelSizes?.[tab];
  if (isPanelSize(own)) return { size: own, px: PANEL_PX[own], own: true };
  const t = table[tab];
  const base = isPanelSize(s.panelSize) ? s.panelSize : 'regular';
  if (t && base === 'regular') return { size: nearestByHeight(t.h), px: t, own: false };
  const size = defaultSizeFor(tab, s);
  return { size, px: PANEL_PX[size], own: false };
}

const nearestByHeight = (h: number): PanelSize => PANEL_SIZES.reduce((a, b) => (Math.abs(PANEL_PX[b].h - h) < Math.abs(PANEL_PX[a].h - h) ? b : a), 'regular' as PanelSize);

/** A tab's own size set (or cleared, when it is the default anyway, or `null`): the new map. */
export function withTabSize(s: PanelSizeSettings, tab: string, size: PanelSize | null): Record<string, string> {
  const out = { ...(s.panelSizes ?? {}) };
  delete out[tab];
  // Picking what the tab opens at anyway clears its own size, unless it has its own default box (then any size is a choice).
  if (size && (size !== defaultSizeFor(tab, s) || tabPanel(tab, { ...s, panelSizes: {} }).px !== PANEL_PX[size])) out[tab] = size;
  return out;
}

/** Keeps only known tabs' valid sizes (settings written by hand or by an older Keeper). */
export function cleanPanelSizes(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (/^[a-z][\w-]{0,31}$/i.test(k) && isPanelSize(x)) out[k] = x;
  return out;
}

export interface PanelRoom {
  /** the Island's scale (Settings → Placement → size) */
  scale: number;
  /** the notch's height above the panel (0 without a notch) */
  notchH: number;
  /** the biggest panel the placement has room for (the open window less the room for the shadow) */
  max?: { w: number; h: number };
}

/** The open panel's box (width, and height including the notch) for a size or a tab's own box, kept inside the room there is. */
export function panelBox(size: PanelSize | { w: number; h: number }, r: PanelRoom): { w: number; h: number } {
  const p = typeof size === 'string' ? PANEL_PX[size] ?? PANEL_PX.regular : size;
  let w = Math.round(p.w * r.scale);
  let h = r.notchH + Math.round(p.h * r.scale);
  if (r.max) {
    w = Math.min(w, Math.max(200, Math.floor(r.max.w)));
    h = Math.min(h, Math.max(r.notchH + 120, Math.floor(r.max.h)));
  }
  return { w, h };
}

/** The biggest box any size can have here (the shape is drawn this big, so every change of size is one morph). */
export function largestBox(r: PanelRoom, table: Partial<Record<string, { w: number; h: number }>> = TAB_PANEL_PX): { w: number; h: number } {
  let w = PANEL_PX.xl.w;
  let h = PANEL_PX.xl.h;
  for (const t of Object.values(table)) if (t) { w = Math.max(w, t.w); h = Math.max(h, t.h); }
  return panelBox({ w, h }, r);
}

/**
 * The room for the panel inside the placement's open window: the window less the notch's ears
 * or the room for a shadow (`halo`) on each side, and below it.
 */
export function roomIn(expanded: { width: number; height: number }, o: { side: boolean; ears: number; halo: number }): { w: number; h: number } {
  if (o.side) return { w: expanded.width - o.halo, h: expanded.height - 2 * o.halo };
  return { w: expanded.width - 2 * Math.max(o.ears, o.halo), h: expanded.height - (o.halo ? o.halo + 6 : 0) };
}

/** The size whose height is nearest to a height dragged to with the grip (ties go to the smaller). */
export function snapSize(height: number, r: PanelRoom): PanelSize {
  let best: PanelSize = 'regular';
  let bestD = Infinity;
  const seen = new Set<number>();
  for (const s of PANEL_SIZES) {
    const h = panelBox(s, r).h;
    // Sizes clamped to the same height are one size: the smallest of them.
    if (seen.has(h)) continue;
    seen.add(h);
    const d = Math.abs(h - height);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

/** One size up or down (the size button's arrows and the keyboard). */
export function stepSize(size: PanelSize, by: number): PanelSize {
  const i = Math.max(0, Math.min(PANEL_SIZES.length - 1, PANEL_SIZES.indexOf(size) + by));
  return PANEL_SIZES[i];
}

/** How the Island's windows are made on macOS: a plain borderless window (default) or a floating panel. */
export type IslandWindowType = 'standard' | 'panel';

export const islandWindowType = (v: unknown): IslandWindowType => (v === 'panel' ? 'panel' : 'standard');

/** Whether the Island's window is a panel (NSPanel on macOS, a tool window elsewhere). Elsewhere it always is. */
export function islandUsesPanel(platform: string, type: unknown): boolean {
  return platform !== 'darwin' || islandWindowType(type) === 'panel';
}
