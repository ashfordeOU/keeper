// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's colours: a palette built from the active theme (or a dark or
// colourful look), tinted by what is going on (the music's artwork, a meeting's
// calendar, a timer, the battery), with every text colour checked for WCAG AA on
// every part of its background. Pure data in, CSS variables out; the Island
// (src/island/Island.tsx) writes them on its root and src/styles/island.css
// reads them.

import { contrast, luminance, over, parseColor, toHex, type ThemeMode, type Tokens } from './themes';

/** Settings → Island → Look. */
export type IslandLook = 'theme' | 'dark' | 'colorful';
export type IslandIntensity = 'subtle' | 'bold';

export const ISLAND_LOOKS: { id: IslandLook; label: string }[] = [
  { id: 'theme', label: 'Match theme' },
  { id: 'dark', label: 'Dark' },
  { id: 'colorful', label: 'Colourful' },
];
export const ISLAND_INTENSITIES: { id: IslandIntensity; label: string }[] = [
  { id: 'subtle', label: 'Subtle' },
  { id: 'bold', label: 'Bold' },
];

/** Vivid gradients for the Colourful look: deep enough that white text reads on every part. */
export const ISLAND_PRESETS: { id: string; name: string; stops: [string, string, string] }[] = [
  { id: 'coral', name: 'Coral', stops: ['#be123c', '#c2410c', '#7e22ce'] },
  { id: 'lagoon', name: 'Lagoon', stops: ['#0f766e', '#0369a1', '#4338ca'] },
  { id: 'berry', name: 'Berry', stops: ['#a21caf', '#6d28d9', '#be185d'] },
  { id: 'fern', name: 'Fern', stops: ['#15803d', '#0f766e', '#a16207'] },
  { id: 'starlight', name: 'Starlight', stops: ['#1e1b4b', '#4338ca', '#0e7490'] },
  { id: 'ember', name: 'Ember', stops: ['#9a3412', '#b91c1c', '#a16207'] },
];
export const DEFAULT_PRESET = 'coral';

export const DEFAULT_LOOK: IslandLook = 'theme';
export const DEFAULT_INTENSITY: IslandIntensity = 'bold';

/** What the Island's look reads from its settings (all optional; old settings files have none). */
export interface IslandLookSettings {
  look?: IslandLook;
  lookIntensity?: IslandIntensity;
  lookPreset?: string;
  /** '' or missing: the theme's own accent */
  lookAccent?: string;
}

/** Settings read from disk: anything unknown falls back to the defaults. */
export function cleanLook(s: IslandLookSettings | undefined): Required<IslandLookSettings> {
  const look = ISLAND_LOOKS.some((l) => l.id === s?.look) ? s!.look! : DEFAULT_LOOK;
  const lookIntensity = s?.lookIntensity === 'subtle' || s?.lookIntensity === 'bold' ? s.lookIntensity : DEFAULT_INTENSITY;
  const lookPreset = ISLAND_PRESETS.some((p) => p.id === s?.lookPreset) ? s!.lookPreset! : DEFAULT_PRESET;
  const lookAccent = typeof s?.lookAccent === 'string' && /^#[0-9a-f]{6}$/i.test(s.lookAccent) ? s.lookAccent.toLowerCase() : '';
  return { look, lookIntensity, lookPreset, lookAccent };
}

// ---------------------------------------------------------------- colour helpers

const solid = (c: string, fallback = '#000000'): string => {
  const p = parseColor(c);
  return p ? toHex(p.a < 1 ? over(p, { r: 0, g: 0, b: 0, a: 1 }) : p) : fallback;
};

/** a + (b − a) × t, in sRGB. */
export function mix(a: string, b: string, t: number): string {
  const x = parseColor(solid(a))!;
  const y = parseColor(solid(b))!;
  const k = Math.max(0, Math.min(1, t));
  return toHex({ r: x.r + (y.r - x.r) * k, g: x.g + (y.g - x.g) * k, b: x.b + (y.b - x.b) * k, a: 1 });
}

function hsl(c: string): { h: number; s: number; l: number } {
  const { r, g, b } = parseColor(solid(c))!;
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s, l };
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a: 1 });
}

/** The same colour with its hue turned by `deg`. */
export function turnHue(c: string, deg: number): string {
  const { h, s, l } = hsl(c);
  return fromHsl((h + deg + 360) % 360, s, l);
}

/** How colourful a colour is (0 grey … 1 pure). */
export const saturation = (c: string): number => (parseColor(c) ? hsl(c).s : 0);

const hueGap = (a: string, b: string) => { const d = Math.abs(hsl(a).h - hsl(b).h) % 360; return d > 180 ? 360 - d : d; };

/** The lowest contrast of `fg` on any of the backgrounds. */
export function worstContrast(fg: string, bgs: string[]): number {
  return Math.min(...bgs.map((b) => contrast(fg, b)));
}

/**
 * The colour itself when it reads on every background, else the nearest one that does: moved toward white on
 * dark backgrounds or toward black on light ones, in small steps (pure white or black at the end).
 */
export function readableTint(color: string, bgs: string[], min = 4.5): string {
  const c = solid(color, '#808080');
  if (worstContrast(c, bgs) >= min) return c;
  const darkBg = bgs.reduce((n, b) => n + luminance(parseColor(solid(b))!), 0) / bgs.length < 0.18;
  const to = darkBg ? '#ffffff' : '#000000';
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const next = mix(c, to, t);
    if (worstContrast(next, bgs) >= min) return next;
  }
  return to;
}

// ---------------------------------------------------------------- the palette

export interface IslandPalette {
  scheme: ThemeMode;
  /** the three gradient stops, top-left to bottom-right */
  stops: [string, string, string];
  /** a solid colour close to the gradient, for menus and fallbacks */
  base: string;
  /** a soft light in the top-left corner (decoration; dropped with reduced transparency) */
  sheen: string;
  /** the colour hovers, cards and lines are mixed from */
  ink: string;
  fg: string;
  fg2: string;
  fg3: string;
  accent: string;
  accentText: string;
  ok: string;
  warn: string;
  danger: string;
  info: string;
  /** the glow around a floating Island and the edge of the pill on a notch */
  glow: string;
  edge: string;
  /** the colour of what is going on, when it tints the Island */
  live?: string;
}

export interface IslandLookInput extends IslandLookSettings {
  /** the active theme's tokens in the mode on screen */
  tokens: Tokens;
  mode: ThemeMode;
  /** the colour of the main live activity (artwork, calendar, timer, charge) */
  live?: string;
  /** Keeper's own custom accent (Settings → Appearance), used when the Island has none of its own */
  appAccent?: string;
}

/** How much of each colour goes into the background, by scheme and intensity. */
const AMOUNT = {
  dark: { subtle: { hue: 0.16, live: 0.14 }, bold: { hue: 0.32, live: 0.26 } },
  light: { subtle: { hue: 0.1, live: 0.1 }, bold: { hue: 0.2, live: 0.18 } },
} as const;

/** Card and hover fills the text has to read on too, as a share of the ink. */
const FILL_MAX = 0.22;

/**
 * Every colour text can sit on: the stops, points between them (a gradient can dip below both ends), the
 * sheen over the first stop, and the strongest card fill over each.
 */
export function surfaceSamples(p: Pick<IslandPalette, 'stops' | 'sheen' | 'ink'>): string[] {
  const [a, b, c] = p.stops;
  const line = [a, mix(a, b, 0.25), mix(a, b, 0.5), mix(a, b, 0.75), b, mix(b, c, 0.25), mix(b, c, 0.5), mix(b, c, 0.75), c];
  const sheen = parseColor(p.sheen);
  const ink = parseColor(p.ink)!;
  const out = [...line];
  if (sheen) out.push(toHex(over(sheen, parseColor(a)!)));
  for (const s of line) out.push(toHex(over({ ...ink, a: FILL_MAX }, parseColor(s)!)));
  return out;
}

/** A colour worth tinting the Island with (greys and near-whites are not). */
export function liveTint(color: string | undefined): string | undefined {
  if (!color || !parseColor(color)) return undefined;
  const c = solid(color);
  const { s, l } = hsl(c);
  return s >= 0.25 && l > 0.12 && l < 0.92 ? c : undefined;
}

/** The theme's accent for the Island: on a dark Island its own accent, unless that is a grey and the theme's is not. */
function themeAccent(t: Tokens, scheme: ThemeMode): string {
  if (scheme === 'light') return solid(t.accent);
  const own = solid(t['island-accent']);
  return saturation(own) < 0.2 && saturation(solid(t.accent)) >= 0.2 ? solid(t.accent) : own;
}

/** The theme's two hues for the gradient: its accent and a neighbour from its own colours. */
function themeHues(t: Tokens, scheme: ThemeMode, custom?: string): [string, string] {
  const first = solid(custom ?? themeAccent(t, scheme));
  if (custom) return [first, turnHue(first, 38)];
  const pool = [t['c-image'], t['c-video'], t['c-audio'], t['c-app'], t.accent, t['island-accent']].map((c) => solid(c));
  const second = pool.find((c) => saturation(c) > 0.2 && hueGap(c, first) >= 25 && hueGap(c, first) <= 120);
  return [first, second ?? (saturation(first) > 0.15 ? turnHue(first, 38) : first)];
}

/**
 * The Island's palette for the theme and look on screen. Every text colour (fg, fg2, fg3, the status colours
 * and the accent's own text) is at least 4.5 : 1 on every part of the background, including cards; the accent
 * is at least 3 : 1 as a shape. When nothing passes, the background itself is darkened (or lightened) a little.
 */
export function islandPalette(i: IslandLookInput): IslandPalette {
  const o = cleanLook(i);
  const t = i.tokens;
  const live = o.look === 'dark' ? undefined : liveTint(i.live);
  const custom = o.lookAccent || (i.appAccent && parseColor(i.appAccent) ? solid(i.appAccent) : undefined);
  const scheme: ThemeMode = o.look === 'theme' && i.mode === 'light' ? 'light' : 'dark';
  const amt = AMOUNT[scheme][o.lookIntensity];

  let stops: [string, string, string];
  if (o.look === 'colorful') {
    const preset = (ISLAND_PRESETS.find((p) => p.id === o.lookPreset) ?? ISLAND_PRESETS[0]).stops;
    const base = solid(t['island-bg'], '#0a0a0c');
    stops = o.lookIntensity === 'bold' ? [...preset] : [mix(preset[0], base, 0.42), mix(preset[1], base, 0.48), mix(preset[2], base, 0.42)];
  } else if (o.look === 'dark') {
    const base = solid(t['island-bg'], '#0a0a0c');
    stops = [base, base, base];
  } else {
    const base = scheme === 'dark' ? solid(t['island-bg'], '#0a0a0c') : solid(t['bg-elev'], '#ffffff');
    const [h1, h2] = themeHues(t, scheme, o.lookAccent || undefined);
    stops = [mix(base, h1, amt.hue), mix(base, h2, amt.hue * 0.75), mix(base, h1, amt.hue * 0.45)];
  }
  if (live) {
    const k = amt.live;
    stops = [mix(stops[0], live, k), mix(stops[1], live, k * 0.7), mix(stops[2], live, k * 0.4)];
  }

  const ink = scheme === 'dark' ? '#ffffff' : solid(t.text, '#18181b');
  const sheen = scheme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.45)';
  // Pure white (or black) must clear AA with some room to spare; otherwise the background moves toward black (or white).
  const extreme = scheme === 'dark' ? '#ffffff' : '#000000';
  for (let n = 0; n < 20 && worstContrast(extreme, surfaceSamples({ stops, sheen, ink })) < 5.2; n++) {
    const to = scheme === 'dark' ? '#000000' : '#ffffff';
    stops = [mix(stops[0], to, 0.08), mix(stops[1], to, 0.08), mix(stops[2], to, 0.08)];
  }
  const bgs = surfaceSamples({ stops, sheen, ink });
  const base = mix(stops[0], stops[2], 0.5);

  const fgWanted = scheme === 'light' ? t.text : o.look === 'colorful' ? '#ffffff' : t['island-text'];
  const fg = readableTint(fgWanted, bgs);
  const fg2 = readableTint(mix(fg, base, 0.3), bgs);
  const fg3 = readableTint(mix(fg, base, 0.42), bgs);

  const accentWanted = custom ?? (o.look === 'colorful' ? '#ffffff' : themeAccent(t, scheme));
  const accent = readableTint(accentWanted, bgs, 3);
  const accentText = readableTint(contrast('#ffffff', accent) >= contrast('#111111', accent) ? '#ffffff' : '#111111', [accent]);

  const status = scheme === 'dark'
    ? { ok: '#30d158', warn: '#ffd60a', danger: '#ff6961', info: '#64d2ff' }
    : { ok: t.ok, warn: t.warn, danger: t.danger, info: '#1d6fd1' };
  const glowFrom = live ?? (saturation(accent) > 0.2 ? accent : themeHues(t, scheme, custom)[0]);
  const g = parseColor(solid(glowFrom))!;
  return {
    scheme,
    stops,
    base,
    sheen,
    ink,
    fg,
    fg2,
    fg3,
    accent,
    accentText,
    ok: readableTint(status.ok, bgs),
    warn: readableTint(status.warn, bgs),
    danger: readableTint(status.danger, bgs),
    info: readableTint(status.info, bgs),
    glow: `rgba(${g.r}, ${g.g}, ${g.b}, 0.55)`,
    // On the notch the pill is black: the edge must show on black.
    edge: readableTint(solid(glowFrom), ['#000000'], 3),
    live,
  };
}

/** The palette as the CSS variables island.css reads. */
export function islandVars(p: IslandPalette): Record<string, string> {
  return {
    '--isl-s0': p.stops[0],
    '--isl-s1': p.stops[1],
    '--isl-s2': p.stops[2],
    '--isl-base': p.base,
    '--isl-sheen': p.sheen,
    '--isl-ink': p.ink,
    '--isl-fg': p.fg,
    '--isl-fg-2': p.fg2,
    '--isl-fg-3': p.fg3,
    '--isl-accent': p.accent,
    '--isl-accent-text': p.accentText,
    '--isl-ok': p.ok,
    '--isl-warn': p.warn,
    '--isl-danger': p.danger,
    '--isl-info': p.info,
    '--isl-glow': p.glow,
    '--isl-edge': p.edge,
  };
}

/** Every text pair of a palette with its contrast and the minimum it needs (for the tests and the Settings warning). */
export function islandContrast(p: IslandPalette): { pair: string; ratio: number; min: number }[] {
  const bgs = surfaceSamples(p);
  const out: { pair: string; ratio: number; min: number }[] = [];
  for (const k of ['fg', 'fg2', 'fg3', 'ok', 'warn', 'danger', 'info'] as const) out.push({ pair: `${k} on the Island`, ratio: worstContrast(p[k], bgs), min: 4.5 });
  out.push({ pair: 'accent on the Island', ratio: worstContrast(p.accent, bgs), min: 3 });
  out.push({ pair: 'text on the accent', ratio: contrast(p.accentText, p.accent), min: 4.5 });
  out.push({ pair: 'notch edge on black', ratio: contrast(p.edge, '#000000'), min: 3 });
  return out;
}
