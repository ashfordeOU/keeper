// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's themes as data: every theme is a full set of design tokens for a
// light and/or dark mode, checked against WCAG contrast rules in the tests.
// The interface writes these as CSS variables (src/theme.ts); nothing here
// touches the DOM, so the gallery can preview any theme from the same data.

export type ThemeFont = 'system' | 'rounded' | 'serif' | 'mono';
export type ThemeCorners = 'rounded' | 'soft' | 'sharp';
export type ThemeMode = 'light' | 'dark';

/** Every CSS variable a theme sets. Names match src/styles/app.css without the leading "--". */
export const TOKEN_KEYS = [
  'bg', 'bg-elev', 'bg-sunk', 'bg-hover', 'bg-active', 'line', 'line-strong',
  'text', 'text-2', 'text-3', 'accent', 'accent-soft', 'accent-text',
  'danger', 'danger-soft', 'ok', 'ok-soft', 'warn', 'warn-soft', 'shadow', 'shadow-pop',
  'c-image', 'c-video', 'c-audio', 'c-document', 'c-archive', 'c-installer', 'c-app', 'c-code', 'c-other',
  'radius', 'radius-sm', 'owl-a', 'owl-b', 'owl-c', 'island-bg', 'island-text', 'island-accent', 'island-accent-text',
  'app-bg',
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];
export type Tokens = Record<TokenKey, string>;

export type ThemeCategory = 'main' | 'seasonal' | 'unique';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn' | 'festive';

export interface Theme {
  id: string;
  name: string;
  tagline: string;
  tags: string[];
  font: ThemeFont;
  corners: ThemeCorners;
  light?: Tokens;
  dark?: Tokens;
  /** which shelf of the gallery it sits on (main when not set) */
  category?: ThemeCategory;
  /** seasonal themes: the time of year they belong to */
  season?: Season;
}

// ---------------------------------------------------------------- colour maths

export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(). */
export function parseColor(c: string): Rgb | null {
  const s = c.trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** A colour with transparency, as rgba(). */
export function alpha(c: string, a: number): string {
  const p = parseColor(c);
  if (!p) return c;
  return `rgba(${p.r}, ${p.g}, ${p.b}, ${a})`;
}

/** Paints a translucent colour over an opaque one. */
export function over(top: Rgb, under: Rgb): Rgb {
  const a = top.a;
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
}

/** WCAG 2.x relative luminance. */
export function luminance(c: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** WCAG contrast ratio (1–21) of a foreground on a background; translucent colours are flattened first. */
export function contrast(fg: string, bg: string): number {
  const b = parseColor(bg);
  const f = parseColor(fg);
  if (!b || !f) return 1;
  const base = b.a < 1 ? over(b, { r: 255, g: 255, b: 255, a: 1 }) : b;
  const top = f.a < 1 ? over(f, base) : f;
  const l1 = luminance(top);
  const l2 = luminance(base);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Black or white, whichever reads better on the colour. */
export function readableOn(c: string): string {
  return contrast('#ffffff', c) >= contrast('#111111', c) ? '#ffffff' : '#111111';
}

// ---------------------------------------------------------------- building token sets

interface Spec {
  bg: string;
  elev: string;
  sunk: string;
  /** the colour hovers, lines and shadows are made from */
  ink: string;
  text: string;
  text2: string;
  text3: string;
  accent: string;
  accentText?: string;
  danger: string;
  ok: string;
  warn: string;
  shelves: [string, string, string, string, string, string, string, string, string];
  owl: [string, string, string];
  island: { bg: string; text: string; accent: string; accentText?: string };
  radius?: [number, number];
  /** a CSS background for the whole window (gradient or pattern); defaults to bg */
  appBg?: string;
  /** colour of shadows (defaults to black) */
  shadowTint?: string;
}

function tokens(mode: ThemeMode, s: Spec): Tokens {
  const dark = mode === 'dark';
  const ink = s.ink;
  const shadow = s.shadowTint ?? '#000000';
  const [r, rs] = s.radius ?? [14, 9];
  return {
    bg: s.bg,
    'bg-elev': s.elev,
    'bg-sunk': s.sunk,
    'bg-hover': alpha(ink, dark ? 0.07 : 0.05),
    'bg-active': alpha(ink, dark ? 0.12 : 0.09),
    line: alpha(ink, dark ? 0.1 : 0.1),
    'line-strong': alpha(ink, dark ? 0.18 : 0.18),
    text: s.text,
    'text-2': s.text2,
    'text-3': s.text3,
    accent: s.accent,
    'accent-soft': alpha(s.accent, dark ? 0.2 : 0.14),
    'accent-text': s.accentText ?? readableOn(s.accent),
    danger: s.danger,
    'danger-soft': alpha(s.danger, dark ? 0.18 : 0.12),
    ok: s.ok,
    'ok-soft': alpha(s.ok, dark ? 0.18 : 0.13),
    warn: s.warn,
    'warn-soft': alpha(s.warn, dark ? 0.18 : 0.14),
    shadow: dark ? `0 1px 2px ${alpha(shadow, 0.4)}, 0 6px 24px ${alpha(shadow, 0.3)}` : `0 1px 2px ${alpha(shadow, 0.05)}, 0 6px 24px ${alpha(shadow, 0.07)}`,
    'shadow-pop': dark ? `0 10px 40px ${alpha(shadow, 0.6)}, 0 2px 6px ${alpha(shadow, 0.4)}` : `0 10px 40px ${alpha(shadow, 0.18)}, 0 2px 6px ${alpha(shadow, 0.08)}`,
    'c-image': s.shelves[0],
    'c-video': s.shelves[1],
    'c-audio': s.shelves[2],
    'c-document': s.shelves[3],
    'c-archive': s.shelves[4],
    'c-installer': s.shelves[5],
    'c-app': s.shelves[6],
    'c-code': s.shelves[7],
    'c-other': s.shelves[8],
    radius: `${r}px`,
    'radius-sm': `${rs}px`,
    'owl-a': s.owl[0],
    'owl-b': s.owl[1],
    'owl-c': s.owl[2],
    'island-bg': s.island.bg,
    'island-text': s.island.text,
    'island-accent': s.island.accent,
    'island-accent-text': s.island.accentText ?? readableOn(s.island.accent),
    'app-bg': s.appBg ?? s.bg,
  };
}

const PLAYFUL_SHELVES: Spec['shelves'] = ['#f0617a', '#8b5cf6', '#f59e0b', '#3b82f6', '#a16207', '#14b8a6', '#10b981', '#64748b', '#94a3b8'];
const OWL: Spec['owl'] = ['#ffb45e', '#ff5f8f', '#6b3dff'];

// ---------------------------------------------------------------- the themes

export const THEMES: Theme[] = [
  {
    id: 'playful', name: 'Playful', tagline: 'Keeper’s own colours: warm, bright and friendly', tags: ['default', 'colourful'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#f6f5f2', elev: '#ffffff', sunk: '#eeece7', ink: '#14141e', text: '#18181b', text2: '#55555e', text3: '#63636b', accent: '#5b5bf0', danger: '#d93a40', ok: '#2a8a57', warn: '#b06f00', shelves: PLAYFUL_SHELVES, owl: OWL, island: { bg: '#0a0a0c', text: '#f4f4f5', accent: '#ffffff' } }),
    dark: tokens('dark', { bg: '#111114', elev: '#1b1b20', sunk: '#0b0b0d', ink: '#ffffff', text: '#f4f4f5', text2: '#b4b4bc', text3: '#919199', accent: '#8282ff', accentText: '#0b0b18', danger: '#ff6b70', ok: '#4ccb85', warn: '#f2b23a', shelves: PLAYFUL_SHELVES, owl: OWL, island: { bg: '#0a0a0c', text: '#f4f4f5', accent: '#ffffff' } }),
  },
  {
    id: 'minimal', name: 'Minimal', tagline: 'Black, white and grey: nothing competes with your files', tags: ['monochrome', 'calm'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#f6f6f6', elev: '#ffffff', sunk: '#ececec', ink: '#141414', text: '#141414', text2: '#4e4e4e', text3: '#646464', accent: '#141414', danger: '#c62828', ok: '#2e7d32', warn: '#8d5a00', shelves: ['#555', '#555', '#555', '#555', '#555', '#555', '#555', '#555', '#888'], owl: ['#8a8a8a', '#4a4a4a', '#141414'], island: { bg: '#0a0a0a', text: '#f4f4f4', accent: '#ffffff' } }),
    dark: tokens('dark', { bg: '#101010', elev: '#1a1a1a', sunk: '#0a0a0a', ink: '#ffffff', text: '#f2f2f2', text2: '#b5b5b5', text3: '#919191', accent: '#f2f2f2', danger: '#ff6b6b', ok: '#66bb6a', warn: '#ffb74d', shelves: ['#bbb', '#bbb', '#bbb', '#bbb', '#bbb', '#bbb', '#bbb', '#bbb', '#888'], owl: ['#bdbdbd', '#6e6e6e', '#2a2a2a'], island: { bg: '#000000', text: '#f2f2f2', accent: '#ffffff' } }),
  },
  {
    id: 'blossom', name: 'Blossom', tagline: 'Petal pink and lavender with soft, round edges', tags: ['pastel', 'cute', 'girly', 'soft'], font: 'rounded', corners: 'soft',
    light: tokens('light', { bg: '#fff5f8', elev: '#ffffff', sunk: '#fde8ef', ink: '#6b2346', text: '#3d1a2c', text2: '#7a4560', text3: '#885770', accent: '#d6337a', danger: '#c62845', ok: '#2f8a5f', warn: '#a8620a', shelves: ['#f472b6', '#c084fc', '#fb923c', '#818cf8', '#d97706', '#2dd4bf', '#34d399', '#a78bfa', '#f9a8d4'], owl: ['#ffc2d8', '#f472b6', '#a855f7'], island: { bg: '#4a1d36', text: '#ffe4ef', accent: '#ff8fc0' }, radius: [20, 14], appBg: 'radial-gradient(1200px 600px at 0% 0%, #ffe3ee 0%, transparent 60%), radial-gradient(900px 500px at 100% 100%, #efe4ff 0%, transparent 55%), #fff5f8', shadowTint: '#8a2858' }),
    dark: tokens('dark', { bg: '#1e1420', elev: '#2a1c2d', sunk: '#160e18', ink: '#ffd6e8', text: '#fdeaf3', text2: '#d9b3c8', text3: '#ae8ba1', accent: '#ff8fc0', danger: '#ff7a8a', ok: '#6fd3a0', warn: '#ffc46b', shelves: ['#f9a8d4', '#d8b4fe', '#fdba74', '#a5b4fc', '#fcd34d', '#5eead4', '#6ee7b7', '#c4b5fd', '#f5d0fe'], owl: ['#ffc2d8', '#f472b6', '#a855f7'], island: { bg: '#2a1426', text: '#ffe4ef', accent: '#ff8fc0' }, radius: [20, 14], appBg: 'radial-gradient(1000px 600px at 0% 0%, #2c1830 0%, transparent 60%), #1e1420' }),
  },
  {
    id: 'steel', name: 'Steel', tagline: 'Gunmetal and safety orange, square and solid', tags: ['bold', 'industrial', 'manly', 'dark'], font: 'system', corners: 'sharp',
    light: tokens('light', { bg: '#e9ebee', elev: '#f7f8f9', sunk: '#dde0e4', ink: '#1c232b', text: '#14191f', text2: '#3f4954', text3: '#545e6a', accent: '#c2410c', danger: '#b91c1c', ok: '#15803d', warn: '#a16207', shelves: ['#ea580c', '#475569', '#ca8a04', '#2563eb', '#78716c', '#0d9488', '#16a34a', '#334155', '#94a3b8'], owl: ['#fb923c', '#c2410c', '#1f2933'], island: { bg: '#11161b', text: '#e5e7eb', accent: '#f97316' }, radius: [4, 3] }),
    dark: tokens('dark', { bg: '#14181c', elev: '#1d2329', sunk: '#0e1114', ink: '#d6dde4', text: '#e8ecef', text2: '#aab4bd', text3: '#8e98a2', accent: '#f97316', danger: '#f87171', ok: '#4ade80', warn: '#facc15', shelves: ['#fb923c', '#94a3b8', '#facc15', '#60a5fa', '#a8a29e', '#2dd4bf', '#4ade80', '#64748b', '#9ca3af'], owl: ['#fb923c', '#c2410c', '#0e1114'], island: { bg: '#0b0e11', text: '#e5e7eb', accent: '#f97316' }, radius: [4, 3], appBg: 'repeating-linear-gradient(135deg, rgba(255,255,255,.012) 0 2px, transparent 2px 6px), #14181c' }),
  },
  {
    id: 'terminal', name: 'Terminal', tagline: 'Phosphor green on black, everything in monospace', tags: ['coder', 'hacker', 'retro', 'dark'], font: 'mono', corners: 'sharp',
    dark: tokens('dark', { bg: '#050805', elev: '#0b120b', sunk: '#020402', ink: '#5dff8a', text: '#b6ffc8', text2: '#7fd99a', text3: '#56a86f', accent: '#39ff6a', danger: '#ff5f56', ok: '#39ff6a', warn: '#ffd23f', shelves: ['#39ff6a', '#5dd4ff', '#ffd23f', '#a0ff7a', '#ffb347', '#4dffd2', '#7cff3a', '#8bd99f', '#5b8f6a'], owl: ['#39ff6a', '#14a83c', '#021a08'], island: { bg: '#000000', text: '#b6ffc8', accent: '#39ff6a' }, radius: [2, 2], appBg: 'repeating-linear-gradient(0deg, rgba(57,255,106,.025) 0 1px, transparent 1px 3px), #050805', shadowTint: '#000000' }),
  },
  {
    id: 'midnight', name: 'Midnight Code', tagline: 'Deep navy with violet and teal, built for long sessions', tags: ['coder', 'dark', 'cool'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#f3f5fb', elev: '#ffffff', sunk: '#e6eaf5', ink: '#1a2147', text: '#151a33', text2: '#454d70', text3: '#5a6283', accent: '#6d4bd8', danger: '#c8304a', ok: '#18825f', warn: '#9a6400', shelves: ['#e0567f', '#7c5ce0', '#d18b1f', '#3f7fe0', '#99653a', '#169a90', '#1f9d6c', '#5b6b94', '#8a93b3'], owl: ['#5eead4', '#7c5ce0', '#1e1b4b'], island: { bg: '#0f1430', text: '#e6e9ff', accent: '#5eead4' } }),
    dark: tokens('dark', { bg: '#0d1124', elev: '#151b35', sunk: '#090c1a', ink: '#c7d0ff', text: '#e4e8ff', text2: '#a7b0d8', text3: '#858eb4', accent: '#a78bfa', danger: '#fb7185', ok: '#5eead4', warn: '#fcd34d', shelves: ['#fb7185', '#a78bfa', '#fbbf24', '#60a5fa', '#d6a77a', '#2dd4bf', '#34d399', '#94a3b8', '#7c86ad'], owl: ['#5eead4', '#a78bfa', '#312e81'], island: { bg: '#070a18', text: '#e4e8ff', accent: '#5eead4' }, appBg: 'radial-gradient(1200px 700px at 100% 0%, #1b1f4a 0%, transparent 55%), #0d1124' }),
  },
  {
    id: 'ocean', name: 'Ocean', tagline: 'Sea glass, deep water and a fresh breeze', tags: ['blue', 'calm', 'fresh'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#f0f7fa', elev: '#ffffff', sunk: '#e0eef4', ink: '#0b3a52', text: '#0b2533', text2: '#3a5868', text3: '#4b6979', accent: '#0369a1', danger: '#c0263d', ok: '#0f7a5c', warn: '#9a5b00', shelves: ['#f472b6', '#6366f1', '#f59e0b', '#0284c7', '#a16207', '#0d9488', '#059669', '#475569', '#94a3b8'], owl: ['#7dd3fc', '#0ea5e9', '#0c4a6e'], island: { bg: '#062538', text: '#e0f2fe', accent: '#38bdf8' }, appBg: 'linear-gradient(180deg, #e8f4f9 0%, #f0f7fa 40%), #f0f7fa' }),
    dark: tokens('dark', { bg: '#071a24', elev: '#0d2532', sunk: '#04121a', ink: '#bae6fd', text: '#e0f2fe', text2: '#9ec4d8', text3: '#76a0b4', accent: '#38bdf8', danger: '#fb7185', ok: '#34d399', warn: '#fbbf24', shelves: ['#f9a8d4', '#a5b4fc', '#fcd34d', '#7dd3fc', '#d6a77a', '#5eead4', '#6ee7b7', '#94a3b8', '#64748b'], owl: ['#7dd3fc', '#0ea5e9', '#082f49'], island: { bg: '#03121b', text: '#e0f2fe', accent: '#38bdf8' }, appBg: 'radial-gradient(1200px 700px at 50% 120%, #0b3346 0%, transparent 60%), #071a24' }),
  },
  {
    id: 'forest', name: 'Forest', tagline: 'Moss, fern and bark: a walk in the woods', tags: ['green', 'nature', 'calm'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#f3f6ef', elev: '#fbfcf8', sunk: '#e6ecdf', ink: '#203321', text: '#1a2a1b', text2: '#46584a', text3: '#576859', accent: '#2f7a3d', danger: '#b4302f', ok: '#2f7a3d', warn: '#8a5d00', shelves: ['#d9668b', '#7b6bd1', '#c98a1b', '#3f7cc1', '#8b5e34', '#2a9d8f', '#4c9a2a', '#5f6f5f', '#9aa79a'], owl: ['#bef264', '#4d7c0f', '#1a2e05'], island: { bg: '#132015', text: '#e6f2df', accent: '#a3d977' }, appBg: 'radial-gradient(1000px 600px at 0% 100%, #e3ecd6 0%, transparent 60%), #f3f6ef' }),
    dark: tokens('dark', { bg: '#101a12', elev: '#18251a', sunk: '#0a120c', ink: '#d9f2c9', text: '#e6f2df', text2: '#aec3a6', text3: '#889d81', accent: '#8bd46a', danger: '#f28b82', ok: '#8bd46a', warn: '#f2c14e', shelves: ['#f4a3b8', '#b3a6f2', '#f2c14e', '#8cc2f2', '#c9a27a', '#6fd6c5', '#8bd46a', '#9fb09f', '#6f806f'], owl: ['#bef264', '#4d7c0f', '#0b1a06'], island: { bg: '#0a120b', text: '#e6f2df', accent: '#8bd46a' } }),
  },
  {
    id: 'sunset', name: 'Sunset', tagline: 'Coral, amber and plum from the golden hour', tags: ['warm', 'colourful', 'vibrant'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#fff6ef', elev: '#ffffff', sunk: '#fde9da', ink: '#5a1f1a', text: '#2e1410', text2: '#6b3c32', text3: '#88594d', accent: '#c2410c', danger: '#be123c', ok: '#15803d', warn: '#a16207', shelves: ['#f43f5e', '#a855f7', '#f59e0b', '#2563eb', '#b45309', '#0d9488', '#16a34a', '#78716c', '#a8a29e'], owl: ['#fcd34d', '#fb7185', '#7c3aed'], island: { bg: '#3b1426', text: '#ffe9dc', accent: '#fb923c' }, appBg: 'linear-gradient(160deg, #ffe7d6 0%, #fff6ef 35%, #fdeef4 100%)', shadowTint: '#7c2d12' }),
    dark: tokens('dark', { bg: '#1d1015', elev: '#2a171e', sunk: '#140a0e', ink: '#ffd9c4', text: '#ffeee4', text2: '#d9b0a3', text3: '#af887b', accent: '#fb923c', danger: '#fb7185', ok: '#4ade80', warn: '#fcd34d', shelves: ['#fb7185', '#c084fc', '#fcd34d', '#60a5fa', '#d6a77a', '#2dd4bf', '#4ade80', '#a8a29e', '#78716c'], owl: ['#fcd34d', '#fb7185', '#7c3aed'], island: { bg: '#190a12', text: '#ffeee4', accent: '#fb923c' }, appBg: 'radial-gradient(1200px 600px at 100% 0%, #3d1726 0%, transparent 55%), radial-gradient(900px 500px at 0% 100%, #3a1c10 0%, transparent 55%), #1d1015' }),
  },
  {
    id: 'paper', name: 'Paper', tagline: 'Warm sepia and serif type, easy on the eyes like an e-reader', tags: ['reading', 'calm', 'serif', 'sepia'], font: 'serif', corners: 'soft',
    light: tokens('light', { bg: '#f4ecd8', elev: '#fbf6e9', sunk: '#ebe1c8', ink: '#4a3b24', text: '#2f2416', text2: '#5c4a32', text3: '#6f5c41', accent: '#8a4b14', danger: '#a12a1b', ok: '#3d6b2a', warn: '#8a5a00', shelves: ['#b5546b', '#6b5aa8', '#b07a1f', '#3f6aa8', '#8a5a2b', '#3a8a7a', '#4a8a3a', '#6b6252', '#9a9078'], owl: ['#e8c88a', '#b07a3a', '#5c3a14'], island: { bg: '#3a2c1a', text: '#f4ecd8', accent: '#e8c88a' }, radius: [10, 7] }),
    dark: tokens('dark', { bg: '#1f1a13', elev: '#29231a', sunk: '#17130e', ink: '#f0e2c4', text: '#ece0c6', text2: '#c2b393', text3: '#a5977a', accent: '#e0a458', danger: '#e8806e', ok: '#9cc77a', warn: '#e8c060', shelves: ['#e08a9b', '#a99ad6', '#e0b45a', '#8aaee0', '#c99a6b', '#7ac2b4', '#9cc77a', '#a89d86', '#7a705c'], owl: ['#e8c88a', '#b07a3a', '#3a2510'], island: { bg: '#120f0a', text: '#ece0c6', accent: '#e0a458' }, radius: [10, 7] }),
  },
  {
    id: 'academia', name: 'Academia', tagline: 'Oak, ink and brass from an old university library', tags: ['dark academia', 'serif', 'warm', 'scholarly'], font: 'serif', corners: 'soft',
    light: tokens('light', { bg: '#efe6d6', elev: '#f8f2e6', sunk: '#e3d7c1', ink: '#3b2a1a', text: '#24180e', text2: '#54402c', text3: '#6c553e', accent: '#7a2e2e', danger: '#9b1c1c', ok: '#2f5d3a', warn: '#7a5200', shelves: ['#9b3d4a', '#5a4a8a', '#a8761f', '#2f4f7a', '#6b4423', '#2f6f63', '#3d6b2f', '#5c5245', '#8a7f6e'], owl: ['#d4b26a', '#8b5a2b', '#3b1f0f'], island: { bg: '#2a1c12', text: '#efe6d6', accent: '#d4b26a' }, radius: [8, 6] }),
    dark: tokens('dark', { bg: '#1b140f', elev: '#261c15', sunk: '#130e0a', ink: '#ead9b8', text: '#efe3cb', text2: '#c6b28f', text3: '#a28f72', accent: '#d4b26a', danger: '#e07a6e', ok: '#8fbf86', warn: '#e0b860', shelves: ['#d4808b', '#a397d1', '#d4b26a', '#7f9fd1', '#b88a5c', '#7fb8a8', '#8fbf86', '#a39684', '#756a5a'], owl: ['#d4b26a', '#8b5a2b', '#24150a'], island: { bg: '#0f0a07', text: '#efe3cb', accent: '#d4b26a' }, radius: [8, 6], appBg: 'radial-gradient(1200px 700px at 0% 0%, #2a1d14 0%, transparent 60%), #1b140f' }),
  },
  {
    id: 'neon', name: 'Neon Nights', tagline: 'Synthwave magenta and cyan with a soft glow', tags: ['synthwave', 'cyberpunk', 'retro', 'dark', 'vibrant'], font: 'system', corners: 'rounded',
    dark: tokens('dark', { bg: '#120b24', elev: '#1c1236', sunk: '#0b0618', ink: '#f0c6ff', text: '#fbeaff', text2: '#cbb3e6', text3: '#9d86bd', accent: '#ff3fbf', danger: '#ff5c7a', ok: '#3df5c4', warn: '#ffd93d', shelves: ['#ff3fbf', '#a06bff', '#ffd93d', '#3dd6ff', '#ff9f43', '#3df5c4', '#7dff6b', '#9d86bd', '#6c5a8c'], owl: ['#3dd6ff', '#ff3fbf', '#5b16c9'], island: { bg: '#0b0618', text: '#fbeaff', accent: '#3dd6ff' }, appBg: 'linear-gradient(180deg, rgba(255,63,191,.08) 0%, transparent 30%), repeating-linear-gradient(90deg, rgba(61,214,255,.035) 0 1px, transparent 1px 48px), repeating-linear-gradient(0deg, rgba(61,214,255,.035) 0 1px, transparent 1px 48px), #120b24', shadowTint: '#2a0040' }),
  },
  {
    id: 'candy', name: 'Candy', tagline: 'Bubblegum brights and big round shapes, made for fun', tags: ['kids', 'bright', 'cute', 'playful'], font: 'rounded', corners: 'soft',
    light: tokens('light', { bg: '#fffaf0', elev: '#ffffff', sunk: '#fff0d6', ink: '#3a1f5c', text: '#2a1745', text2: '#5a4280', text3: '#745d99', accent: '#7c3aed', danger: '#e11d48', ok: '#16a149', warn: '#b45309', shelves: ['#ff4f9a', '#8b5cf6', '#ffb020', '#2f8cff', '#ff7a1a', '#14c4b8', '#3ccf5a', '#7a63a0', '#c4b5fd'], owl: ['#ffd23f', '#ff4f9a', '#7c3aed'], island: { bg: '#3a1f5c', text: '#fff4d6', accent: '#ffd23f' }, radius: [22, 16], appBg: 'radial-gradient(700px 500px at 0% 0%, rgba(255,79,154,.1) 0%, transparent 70%), radial-gradient(700px 500px at 100% 10%, rgba(47,140,255,.08) 0%, transparent 70%), radial-gradient(800px 500px at 60% 100%, rgba(255,176,32,.12) 0%, transparent 70%), #fffaf0' }),
  },
  {
    id: 'luxe', name: 'Luxe', tagline: 'Black lacquer and brushed gold, quietly expensive', tags: ['luxury', 'elegant', 'dark', 'gold'], font: 'serif', corners: 'soft',
    light: tokens('light', { bg: '#f7f3ea', elev: '#fffdf8', sunk: '#ede6d6', ink: '#2a2418', text: '#1a160e', text2: '#4d4532', text3: '#6a604d', accent: '#8a6a1f', danger: '#a12a2a', ok: '#2f6b3d', warn: '#8a5a00', shelves: ['#a8566b', '#6b5aa0', '#b8901f', '#3d5f8a', '#8a6a3d', '#3d7a6e', '#4d7a3d', '#5c5546', '#9a917e'], owl: ['#f0d27a', '#b8901f', '#1a160e'], island: { bg: '#0d0b07', text: '#f7f3ea', accent: '#d4af37' }, radius: [10, 7] }),
    dark: tokens('dark', { bg: '#0b0a08', elev: '#16140f', sunk: '#060504', ink: '#f0dfa8', text: '#f3ead2', text2: '#c7b98f', text3: '#9a8d6a', accent: '#d4af37', danger: '#e0786e', ok: '#8fbf86', warn: '#e6c45c', shelves: ['#d68a9a', '#a99ad6', '#d4af37', '#8aa8d6', '#c09a6b', '#7fb8a8', '#8fbf86', '#9a8d6a', '#6e6450'], owl: ['#f0d27a', '#d4af37', '#3a2c0a'], island: { bg: '#000000', text: '#f3ead2', accent: '#d4af37' }, radius: [10, 7], appBg: 'radial-gradient(900px 500px at 100% 0%, rgba(212,175,55,.07) 0%, transparent 60%), #0b0a08' }),
  },
  {
    id: 'zen', name: 'Zen', tagline: 'Stone, rice paper and a single touch of matcha', tags: ['minimal', 'calm', 'japanese', 'warm grey'], font: 'system', corners: 'soft',
    light: tokens('light', { bg: '#f2efe9', elev: '#faf8f4', sunk: '#e8e4dc', ink: '#2e2a24', text: '#25221d', text2: '#57524a', text3: '#656059', accent: '#5a7a3a', danger: '#a33a2a', ok: '#5a7a3a', warn: '#8a6200', shelves: ['#b8737f', '#7d7399', '#b08a3e', '#5f7f99', '#8a6e52', '#5f8f86', '#6f8f4f', '#6e6a62', '#a39e94'], owl: ['#c8d6a0', '#7d8f5a', '#2e2a24'], island: { bg: '#25221d', text: '#f2efe9', accent: '#c8d6a0' }, radius: [12, 8] }),
    dark: tokens('dark', { bg: '#1b1a17', elev: '#24221e', sunk: '#141310', ink: '#e8e2d6', text: '#ece7dc', text2: '#bdb6a8', text3: '#9d9689', accent: '#a9c27a', danger: '#e08a7a', ok: '#a9c27a', warn: '#e0bf6a', shelves: ['#d6a0aa', '#aaa3c8', '#d6b36e', '#93afc8', '#bba085', '#8fc0b6', '#a9c27a', '#9a958a', '#6e6a62'], owl: ['#c8d6a0', '#7d8f5a', '#141310'], island: { bg: '#0f0e0c', text: '#ece7dc', accent: '#a9c27a' }, radius: [12, 8] }),
  },
  {
    id: 'retro', name: 'Retro 95', tagline: 'Grey bevels, teal desktop and chunky buttons from the 90s', tags: ['retro', 'nostalgic', '90s'], font: 'system', corners: 'sharp',
    light: tokens('light', { bg: '#c0c0c0', elev: '#d4d0c8', sunk: '#b0b0b0', ink: '#000000', text: '#000000', text2: '#202020', text3: '#3d3d3d', accent: '#000080', danger: '#a00000', ok: '#006000', warn: '#705000', shelves: ['#c00060', '#600080', '#a07000', '#0000c0', '#806000', '#008080', '#008000', '#404040', '#808080'], owl: ['#00a0a0', '#000080', '#000040'], island: { bg: '#000080', text: '#ffffff', accent: '#c0c0c0', accentText: '#000000' }, radius: [0, 0], appBg: '#008080' }),
  },
  {
    id: 'contrast', name: 'High Contrast', tagline: 'Maximum legibility for low vision and bright rooms', tags: ['accessibility', 'legible', 'bold'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#ffffff', elev: '#ffffff', sunk: '#f0f0f0', ink: '#000000', text: '#000000', text2: '#1a1a1a', text3: '#333333', accent: '#0033cc', danger: '#b30000', ok: '#006b1f', warn: '#7a4a00', shelves: ['#b3005c', '#5a00b3', '#8a5a00', '#0033cc', '#6b3d00', '#006b6b', '#006b1f', '#333333', '#555555'], owl: ['#ffcc00', '#0033cc', '#000000'], island: { bg: '#000000', text: '#ffffff', accent: '#ffcc00' } }),
    dark: tokens('dark', { bg: '#000000', elev: '#0a0a0a', sunk: '#000000', ink: '#ffffff', text: '#ffffff', text2: '#f0f0f0', text3: '#cccccc', accent: '#ffd400', danger: '#ff6b6b', ok: '#5cff8a', warn: '#ffd400', shelves: ['#ff7ab8', '#c49bff', '#ffd400', '#7ab8ff', '#ffb366', '#5cffe6', '#5cff8a', '#cccccc', '#aaaaaa'], owl: ['#ffd400', '#ffffff', '#000000'], island: { bg: '#000000', text: '#ffffff', accent: '#ffd400' } }),
  },
  {
    id: 'coffee', name: 'Cozy Coffee', tagline: 'Espresso, oat milk and caramel for slow mornings', tags: ['cozy', 'warm', 'brown'], font: 'rounded', corners: 'soft',
    light: tokens('light', { bg: '#f6efe6', elev: '#fffaf3', sunk: '#ece2d4', ink: '#3b2414', text: '#2b1a0f', text2: '#5e4330', text3: '#765a46', accent: '#9a4f1a', danger: '#a8322a', ok: '#3f6e35', warn: '#8a5800', shelves: ['#c0647a', '#7f67a8', '#c48a2c', '#4f78a8', '#8a5a33', '#3f8a7f', '#5a8a3f', '#6e5a4a', '#a8957e'], owl: ['#f2c38a', '#b0682a', '#3b2414'], island: { bg: '#2b1a0f', text: '#f6efe6', accent: '#f2c38a' }, radius: [16, 11] }),
    dark: tokens('dark', { bg: '#1c140e', elev: '#271c14', sunk: '#140e09', ink: '#f2dcc4', text: '#f4e6d6', text2: '#cdb59c', text3: '#a68e76', accent: '#e8a15c', danger: '#ec8b7c', ok: '#9cc786', warn: '#ecc062', shelves: ['#e597a8', '#b3a2d6', '#e8b05c', '#8fb0d6', '#c99f78', '#82c2b6', '#9cc786', '#a8957e', '#7a6855'], owl: ['#f2c38a', '#b0682a', '#1c140e'], island: { bg: '#100b07', text: '#f4e6d6', accent: '#e8a15c' }, radius: [16, 11] }),
  },

  // ------------------------------------------------------------ more of the main collection
  {
    id: 'fjord', name: 'Fjord', tagline: 'Slate, mist and cold clear water from the far north', tags: ['nordic', 'calm', 'cool', 'blue grey'], font: 'system', corners: 'rounded', category: 'main',
    light: tokens('light', { bg: '#eef1f4', elev: '#fafbfc', sunk: '#e2e7ec', ink: '#1f2a36', text: '#18212b', text2: '#46525f', text3: '#58636f', accent: '#3a6a8c', danger: '#b3364a', ok: '#2f7d5b', warn: '#8a6100', shelves: ['#c46b84', '#7d74b8', '#b88a2e', '#4f86b0', '#8c6d50', '#3f948c', '#5b9a5f', '#64707c', '#9aa5b0'], owl: ['#a9c7dc', '#5f8fb0', '#1f2a36'], island: { bg: '#18212b', text: '#e8eef3', accent: '#8fc3db' } }),
    dark: tokens('dark', { bg: '#1c232b', elev: '#242d37', sunk: '#161c22', ink: '#d8e2ec', text: '#e6edf3', text2: '#adb9c4', text3: '#99a4af', accent: '#8fc3db', danger: '#ef8a96', ok: '#8fd1a6', warn: '#ebc77a', shelves: ['#e597a8', '#aaa3dc', '#e3c07a', '#8fbcdc', '#c4a688', '#7fc4bc', '#9cce9f', '#9aa5b0', '#6c7884'], owl: ['#a9c7dc', '#5f8fb0', '#0f151b'], island: { bg: '#12181e', text: '#e6edf3', accent: '#8fc3db' } }),
  },
  {
    id: 'terracotta', name: 'Terracotta', tagline: 'Sun-baked clay, linen and a warm Mediterranean afternoon', tags: ['warm', 'earthy', 'clay'], font: 'system', corners: 'soft', category: 'main',
    light: tokens('light', { bg: '#f8f1ea', elev: '#fffaf5', sunk: '#efe3d6', ink: '#4a2a1c', text: '#2c1a11', text2: '#5f4335', text3: '#775b4d', accent: '#a8492a', danger: '#a62a2a', ok: '#4f7a3a', warn: '#8a5a00', shelves: ['#c9606f', '#8a6fb0', '#c98a2e', '#4f7aa8', '#a0603a', '#3f8a82', '#5f8f3f', '#7a6052', '#b09a88'], owl: ['#f2b48a', '#c8643a', '#5a2a16'], island: { bg: '#3a1d12', text: '#fbeee3', accent: '#f2a07a' }, radius: [16, 11], appBg: 'radial-gradient(1100px 600px at 100% 0%, #f5e1cf 0%, transparent 60%), #f8f1ea', shadowTint: '#6b2e14' }),
    dark: tokens('dark', { bg: '#21150f', elev: '#2c1d15', sunk: '#180f0a', ink: '#f3d6c4', text: '#f6e8de', text2: '#d2b5a4', text3: '#aa8f7f', accent: '#ec8a62', danger: '#f08e86', ok: '#a6cf86', warn: '#edc06a', shelves: ['#e9939f', '#b9a1d9', '#ebb768', '#8fb0d9', '#d19a72', '#7fc0b6', '#a6cf86', '#a88d7d', '#7a6052'], owl: ['#f2b48a', '#c8643a', '#2a1208'], island: { bg: '#140b07', text: '#f6e8de', accent: '#ec8a62' }, radius: [16, 11] }),
  },
  {
    id: 'sage', name: 'Sage', tagline: 'Soft botanical greens, like a greenhouse in the morning', tags: ['green', 'botanical', 'soft', 'calm'], font: 'rounded', corners: 'soft', category: 'main',
    light: tokens('light', { bg: '#f2f4ee', elev: '#fbfcf8', sunk: '#e5e9df', ink: '#26332a', text: '#1c271f', text2: '#4a574e', text3: '#58655b', accent: '#4a7556', danger: '#ac3a36', ok: '#3f7a4a', warn: '#866000', shelves: ['#c27588', '#8679b8', '#b08a36', '#5a86ad', '#8f7152', '#4f948a', '#6a9a52', '#6a756c', '#a3ad9f'], owl: ['#c9dcbf', '#7fa67f', '#26332a'], island: { bg: '#1d2a21', text: '#edf3ea', accent: '#a9d0a6' }, radius: [16, 11] }),
    dark: tokens('dark', { bg: '#171d18', elev: '#1f2721', sunk: '#121713', ink: '#dbe8d9', text: '#e8f0e5', text2: '#b2c0b0', text3: '#909e90', accent: '#9fcf9c', danger: '#ef8d86', ok: '#9fcf9c', warn: '#e3c574', shelves: ['#e0a3b2', '#b3a8dc', '#dcc077', '#93b6d6', '#c4a586', '#86c4ba', '#a6cf8f', '#9aa59a', '#6c776c'], owl: ['#c9dcbf', '#7fa67f', '#0f1410'], island: { bg: '#0f1410', text: '#e8f0e5', accent: '#9fcf9c' }, radius: [16, 11] }),
  },
  {
    id: 'deepsea', name: 'Deep Sea', tagline: 'Teal light falling into dark water, bioluminescent and still', tags: ['teal', 'dark', 'cool', 'calm'], font: 'system', corners: 'rounded', category: 'main',
    light: tokens('light', { bg: '#eef6f6', elev: '#fbfefe', sunk: '#dfeeee', ink: '#0b3236', text: '#082427', text2: '#34585b', text3: '#496a6c', accent: '#0d7272', danger: '#b8303e', ok: '#1d7a55', warn: '#8a5c00', shelves: ['#e06a8a', '#6e78d6', '#c48e28', '#2e86c1', '#8f6b46', '#119a8f', '#2f9a63', '#4f6f72', '#8fa8aa'], owl: ['#7fe0d6', '#119a8f', '#06302f'], island: { bg: '#052326', text: '#dcf5f3', accent: '#4fd6c8' } }),
    dark: tokens('dark', { bg: '#05181b', elev: '#0b2327', sunk: '#031114', ink: '#b6ecec', text: '#d9f4f2', text2: '#94c3c2', text3: '#759f9f', accent: '#3fd0c2', danger: '#ff7f93', ok: '#5be0a0', warn: '#f5c75a', shelves: ['#ff9ab4', '#a3abff', '#f5c75a', '#6cc3ff', '#d1a77e', '#3fd0c2', '#5be0a0', '#759f9f', '#4f6f72'], owl: ['#7fe0d6', '#119a8f', '#021416'], island: { bg: '#020d0f', text: '#d9f4f2', accent: '#3fd0c2' }, appBg: 'radial-gradient(1200px 700px at 50% 120%, #0a3238 0%, transparent 60%), radial-gradient(500px 300px at 85% 10%, rgba(63,208,194,.06) 0%, transparent 70%), #05181b' }),
  },
  {
    id: 'dusk', name: 'Dusk', tagline: 'Lavender sky with a last line of peach on the horizon', tags: ['lavender', 'purple', 'soft', 'evening'], font: 'system', corners: 'soft', category: 'main',
    light: tokens('light', { bg: '#f5f2fa', elev: '#fdfbff', sunk: '#ebe6f4', ink: '#2e2347', text: '#221a36', text2: '#534a6b', text3: '#675d80', accent: '#6649b5', danger: '#b8364f', ok: '#2f7d5f', warn: '#8a5a00', shelves: ['#d16b9a', '#8b6fd6', '#c08a33', '#5b7fd1', '#96705a', '#3f938f', '#5b9a62', '#6f6a80', '#aaa4bb'], owl: ['#d8c6f5', '#9a7fe0', '#2e2347'], island: { bg: '#231a38', text: '#f0eaff', accent: '#c4aaff' }, radius: [18, 12], appBg: 'radial-gradient(1100px 600px at 0% 0%, #ece3fb 0%, transparent 60%), radial-gradient(900px 400px at 100% 100%, #fbe6dc 0%, transparent 55%), #f5f2fa' }),
    dark: tokens('dark', { bg: '#19152a', elev: '#221d37', sunk: '#130f20', ink: '#e4dbff', text: '#eee9ff', text2: '#bdb3d9', text3: '#9a90b5', accent: '#b9a0ff', danger: '#ff8aa3', ok: '#79d9b0', warn: '#f2c86b', shelves: ['#ff9ac4', '#b9a0ff', '#f2c86b', '#94b0ff', '#d6aa8f', '#7fd1c8', '#94d99a', '#968cb2', '#6f6a80'], owl: ['#d8c6f5', '#9a7fe0', '#130f20'], island: { bg: '#0e0b18', text: '#eee9ff', accent: '#f0b38a' }, radius: [18, 12], appBg: 'radial-gradient(1100px 600px at 100% 100%, #2e1f3a 0%, transparent 60%), #19152a' }),
  },
  {
    id: 'dune', name: 'Dune', tagline: 'Wind-carved sand, warm light and a long horizon', tags: ['desert', 'sand', 'warm', 'neutral'], font: 'system', corners: 'soft', category: 'main',
    light: tokens('light', { bg: '#f7f0e3', elev: '#fdf9f1', sunk: '#ede2cf', ink: '#4a3820', text: '#2d2113', text2: '#5f4c33', text3: '#6f5d46', accent: '#955a26', danger: '#a8352a', ok: '#557a33', warn: '#8a5800', shelves: ['#c76f7a', '#8a74ad', '#bf912f', '#5a82a6', '#a37244', '#4a9187', '#6b9447', '#7a6a55', '#b3a48c'], owl: ['#f0cf94', '#c78a3e', '#4a3820'], island: { bg: '#2e2113', text: '#f7eedd', accent: '#f0c27a' }, appBg: 'linear-gradient(175deg, #f9eedb 0%, #f7f0e3 40%, #f1e6d2 100%)' }),
    dark: tokens('dark', { bg: '#1f1912', elev: '#2a2219', sunk: '#17120d', ink: '#f2e2c4', text: '#f5ead6', text2: '#cdbb9d', text3: '#a7957a', accent: '#e6b066', danger: '#ef8f80', ok: '#b0cf86', warn: '#f0c85e', shelves: ['#e7a0a8', '#b8a6d6', '#e6b066', '#93b2d1', '#d1a172', '#86c2b8', '#b0cf86', '#a59378', '#7a6a55'], owl: ['#f0cf94', '#c78a3e', '#17120d'], island: { bg: '#120e09', text: '#f5ead6', accent: '#e6b066' } }),
  },
  {
    id: 'editorial', name: 'Editorial', tagline: 'Black ink on white with one bold red, like a printed magazine', tags: ['monochrome', 'print', 'serif', 'bold'], font: 'serif', corners: 'sharp', category: 'main',
    light: tokens('light', { bg: '#fbfbf9', elev: '#ffffff', sunk: '#f0f0ec', ink: '#111111', text: '#111111', text2: '#444444', text3: '#666666', accent: '#cc2e1f', danger: '#b3261e', ok: '#2e7d32', warn: '#8a5a00', shelves: ['#cc2e1f', '#3a3a3a', '#5a5a5a', '#2a2a2a', '#7a7a7a', '#4a4a4a', '#6a6a6a', '#8a8a8a', '#a0a0a0'], owl: ['#e8e8e8', '#cc2e1f', '#111111'], island: { bg: '#111111', text: '#f5f5f5', accent: '#ff5a47' }, radius: [6, 4] }),
    dark: tokens('dark', { bg: '#121212', elev: '#1b1b1b', sunk: '#0c0c0c', ink: '#ffffff', text: '#f2f2f2', text2: '#b8b8b8', text3: '#929292', accent: '#ff5a47', danger: '#ff7b72', ok: '#6fcf7a', warn: '#f0c060', shelves: ['#ff5a47', '#cfcfcf', '#a8a8a8', '#e0e0e0', '#8a8a8a', '#bbbbbb', '#999999', '#777777', '#666666'], owl: ['#e8e8e8', '#ff5a47', '#000000'], island: { bg: '#000000', text: '#f2f2f2', accent: '#ff5a47' }, radius: [6, 4] }),
  },
  {
    id: 'solarpunk', name: 'Solarpunk', tagline: 'Leaf green and solar gold: a hopeful, growing future', tags: ['green', 'gold', 'optimistic', 'nature'], font: 'rounded', corners: 'rounded', category: 'main',
    light: tokens('light', { bg: '#f4f8ec', elev: '#fcfef7', sunk: '#e7efda', ink: '#1f3a1a', text: '#172b14', text2: '#445a3c', text3: '#566b4d', accent: '#3b761d', danger: '#b0362c', ok: '#2f7d1f', warn: '#8a6400', shelves: ['#e06b7a', '#7d6fd0', '#c7951b', '#3f86c8', '#9a6a2e', '#1f9a85', '#5aa02a', '#5f7056', '#a7b59a'], owl: ['#ffd84a', '#7cc23f', '#1f3a1a'], island: { bg: '#16301a', text: '#f2fbe3', accent: '#ffd84a' }, appBg: 'radial-gradient(900px 500px at 100% -10%, #fbf3c8 0%, transparent 60%), radial-gradient(900px 500px at 0% 110%, #dfeecb 0%, transparent 60%), #f4f8ec' }),
    dark: tokens('dark', { bg: '#0f1a0f', elev: '#172517', sunk: '#0a120a', ink: '#e2f5c6', text: '#ecf8dc', text2: '#b7cfa3', text3: '#90ab7e', accent: '#c7e85a', danger: '#ff8a7a', ok: '#8fe06a', warn: '#ffd84a', shelves: ['#ff9aa8', '#b3a8ff', '#ffd84a', '#7ec0ff', '#d6a872', '#5ed6c0', '#8fe06a', '#90ab7e', '#5f7056'], owl: ['#ffd84a', '#7cc23f', '#081008'], island: { bg: '#081008', text: '#ecf8dc', accent: '#ffd84a' }, appBg: 'radial-gradient(900px 500px at 100% -10%, rgba(255,216,74,.07) 0%, transparent 60%), #0f1a0f' }),
  },
  {
    id: 'circuit', name: 'Circuit', tagline: 'Graphite panels and an electric blue current for focused work', tags: ['pro', 'cool', 'tech', 'blue'], font: 'system', corners: 'rounded', category: 'main',
    light: tokens('light', { bg: '#f1f2f4', elev: '#fbfbfc', sunk: '#e4e6ea', ink: '#1a1d23', text: '#15181d', text2: '#474c55', text3: '#5c616b', accent: '#1f5bf0', danger: '#c42f3f', ok: '#1d7f4f', warn: '#8a5b00', shelves: ['#f0517a', '#7a5cf0', '#d9921a', '#1f5bf0', '#8a6a4a', '#00a0b0', '#26a65b', '#4a515c', '#9aa1ab'], owl: ['#7ab8ff', '#1f5bf0', '#15181d'], island: { bg: '#0e1014', text: '#e8ebf0', accent: '#4d8cff' }, radius: [10, 7] }),
    dark: tokens('dark', { bg: '#15171b', elev: '#1d2025', sunk: '#0f1114', ink: '#dde3ee', text: '#e8ecf2', text2: '#aab1bd', text3: '#8d95a0', accent: '#4d8cff', danger: '#ff7586', ok: '#4fd18a', warn: '#f5c45a', shelves: ['#ff7aa0', '#a68cff', '#f5c45a', '#4d8cff', '#c9a07a', '#3fd0e0', '#4fd18a', '#868e9a', '#5c636e'], owl: ['#7ab8ff', '#4d8cff', '#0a0b0e'], island: { bg: '#0a0b0e', text: '#e8ecf2', accent: '#4d8cff' }, radius: [10, 7] }),
  },
  {
    id: 'champagne', name: 'Champagne', tagline: 'Rosé, pearl and a little sparkle, soft and celebratory', tags: ['rosé', 'pink', 'elegant', 'warm'], font: 'serif', corners: 'soft', category: 'main',
    light: tokens('light', { bg: '#fbf5f1', elev: '#fffdfb', sunk: '#f3e8e1', ink: '#4a2b2b', text: '#2e1a1a', text2: '#634545', text3: '#7b5c5c', accent: '#a3425a', danger: '#a82a2a', ok: '#3f7a4f', warn: '#8a5c00', shelves: ['#d97a95', '#a07ac8', '#c99c4f', '#6f8fc8', '#b08a6a', '#5fa39a', '#7aa36a', '#8f7a72', '#c4b0a6'], owl: ['#f6d9c4', '#e0a0a8', '#7a3a48'], island: { bg: '#3a2028', text: '#fbefe8', accent: '#f2c9a8' }, radius: [18, 12], appBg: 'radial-gradient(1000px 600px at 0% 0%, #fbe7e2 0%, transparent 60%), radial-gradient(900px 500px at 100% 100%, #f8ecd8 0%, transparent 55%), #fbf5f1', shadowTint: '#7a3a48' }),
    dark: tokens('dark', { bg: '#1f1719', elev: '#2a1f22', sunk: '#171113', ink: '#f6dcd6', text: '#f8ebe7', text2: '#d4b8b2', text3: '#ac918b', accent: '#f0a8b6', danger: '#f28d86', ok: '#9fd0a6', warn: '#f0cf86', shelves: ['#f0a8b6', '#c4a8e6', '#f0cf86', '#a3b8e6', '#d6b096', '#8fcbc2', '#a8cf96', '#ac918b', '#7a6660'], owl: ['#f6d9c4', '#e0a0a8', '#130d0f'], island: { bg: '#130d0f', text: '#f8ebe7', accent: '#f2c9a8' }, radius: [18, 12] }),
  },

  // ------------------------------------------------------------ seasonal (Settings → Appearance → Follow the seasons)
  {
    id: 'frost', name: 'Frost', tagline: 'Snow light, ice blue and a quiet winter morning', tags: ['winter', 'cold', 'blue', 'seasonal'], font: 'system', corners: 'rounded', category: 'seasonal', season: 'winter',
    light: tokens('light', { bg: '#f2f7fb', elev: '#ffffff', sunk: '#e4eef6', ink: '#13314a', text: '#0f2234', text2: '#3f566b', text3: '#52687b', accent: '#2a6aa8', danger: '#b8344a', ok: '#1f7a5f', warn: '#8a5c00', shelves: ['#d9708f', '#7b7fd6', '#bf972f', '#3f8ed6', '#8a7462', '#3fa3a3', '#5aa37a', '#6a7c8c', '#a8b8c6'], owl: ['#d9ecff', '#7fb6e6', '#13314a'], island: { bg: '#0c1f30', text: '#eaf4fd', accent: '#a8d8ff' }, appBg: 'radial-gradient(1200px 600px at 50% -10%, #e2f0fb 0%, transparent 60%), #f2f7fb' }),
    dark: tokens('dark', { bg: '#0d1824', elev: '#142231', sunk: '#09121b', ink: '#d6e8f7', text: '#e6f1fb', text2: '#a8bfd3', text3: '#859db3', accent: '#8cc8ff', danger: '#ff8a9c', ok: '#6fd6b0', warn: '#f2c96a', shelves: ['#ff9ab5', '#aab0ff', '#f2c96a', '#8cc8ff', '#d1b08f', '#6fd6d0', '#8fdcaa', '#859db3', '#5a6f84'], owl: ['#d9ecff', '#7fb6e6', '#060d14'], island: { bg: '#060d14', text: '#e6f1fb', accent: '#a8d8ff' }, appBg: 'radial-gradient(1200px 600px at 50% -10%, #142c44 0%, transparent 60%), #0d1824' }),
  },
  {
    id: 'meadow', name: 'Spring Meadow', tagline: 'Fresh grass, cherry blossom and the first warm day', tags: ['spring', 'fresh', 'pink', 'green', 'seasonal'], font: 'rounded', corners: 'soft', category: 'seasonal', season: 'spring',
    light: tokens('light', { bg: '#f7faf2', elev: '#ffffff', sunk: '#ebf2e1', ink: '#22381e', text: '#1a2b17', text2: '#48593f', text3: '#5a6c51', accent: '#b83a72', danger: '#b3332f', ok: '#3f8a2f', warn: '#8a6200', shelves: ['#ef6f9f', '#9b7be0', '#d9a21e', '#4f9ae0', '#a87a4a', '#3fb3a3', '#5fb33a', '#6b7a62', '#b5c2a8'], owl: ['#ffe27a', '#f58fb8', '#3f8a2f'], island: { bg: '#1f3519', text: '#f4fbe9', accent: '#ffb3d1' }, radius: [18, 12], appBg: 'radial-gradient(800px 500px at 0% 0%, #fde6ef 0%, transparent 60%), radial-gradient(900px 500px at 100% 100%, #e8f4d6 0%, transparent 60%), #f7faf2' }),
    dark: tokens('dark', { bg: '#141c12', elev: '#1c2619', sunk: '#0f150d', ink: '#e2f2d6', text: '#eef7e6', text2: '#bccdb0', text3: '#97a98c', accent: '#ff8fbf', danger: '#ff8a80', ok: '#8fd96a', warn: '#ffd36a', shelves: ['#ff8fbf', '#c0a8ff', '#ffd36a', '#8fc4ff', '#d6aa7e', '#6fd6c4', '#8fd96a', '#97a98c', '#6b7a62'], owl: ['#ffe27a', '#f58fb8', '#0a1008'], island: { bg: '#0a1008', text: '#eef7e6', accent: '#ffb3d1' }, radius: [18, 12] }),
  },
  {
    id: 'summer', name: 'Summer Haze', tagline: 'Bright sun, warm sand and a cool turquoise sea', tags: ['summer', 'sunny', 'beach', 'seasonal'], font: 'rounded', corners: 'rounded', category: 'seasonal', season: 'summer',
    light: tokens('light', { bg: '#fff9ed', elev: '#ffffff', sunk: '#fff0d1', ink: '#3a2a0a', text: '#2a1d05', text2: '#5c4a22', text3: '#78663f', accent: '#08707f', danger: '#c2372f', ok: '#2a8a3f', warn: '#9a5f00', shelves: ['#ff6f7a', '#8a6fe0', '#e09a14', '#1f9ad6', '#c2803a', '#14a898', '#3fb35a', '#7a6a50', '#c2b08a'], owl: ['#ffd54a', '#ff8a3f', '#08707f'], island: { bg: '#0a3540', text: '#fff4dc', accent: '#ffd54a' }, appBg: 'linear-gradient(180deg, #fff1cf 0%, #fff9ed 40%), #fff9ed' }),
    dark: tokens('dark', { bg: '#10202a', elev: '#182b36', sunk: '#0b1820', ink: '#ffe9b8', text: '#fdf3df', text2: '#d6c7a6', text3: '#ac9e80', accent: '#ffc94a', danger: '#ff8a7a', ok: '#6fdc8f', warn: '#ffc94a', shelves: ['#ff9aa4', '#b9a3ff', '#ffc94a', '#6fc6ff', '#e0aa72', '#4fe0d0', '#6fdc8f', '#ac9e80', '#6a6250'], owl: ['#ffd54a', '#ff8a3f', '#071319'], island: { bg: '#071319', text: '#fdf3df', accent: '#ffc94a' }, appBg: 'radial-gradient(1000px 500px at 80% -10%, rgba(255,201,74,.10) 0%, transparent 60%), #10202a' }),
  },
  {
    id: 'autumn', name: 'Autumn Ember', tagline: 'Maple red, pumpkin and amber leaves in low sun', tags: ['autumn', 'fall', 'warm', 'seasonal'], font: 'system', corners: 'soft', category: 'seasonal', season: 'autumn',
    light: tokens('light', { bg: '#faf3ea', elev: '#fffbf5', sunk: '#f1e3d1', ink: '#4a2410', text: '#2e160a', text2: '#63412a', text3: '#7c5940', accent: '#a8431a', danger: '#a8302a', ok: '#5a7a2a', warn: '#8a5600', shelves: ['#c2443a', '#8a5a9a', '#cc8018', '#4f6f9a', '#9a5a2a', '#3f8a7a', '#7a8a2a', '#7a5f4a', '#b3987a'], owl: ['#f5b04a', '#d0602a', '#4a2410'], island: { bg: '#2e160a', text: '#fbeee0', accent: '#f5a04a' }, appBg: 'radial-gradient(1000px 600px at 0% 100%, #f6dcc0 0%, transparent 60%), #faf3ea', shadowTint: '#6b2a0a' }),
    dark: tokens('dark', { bg: '#1e130c', elev: '#2a1a10', sunk: '#160d07', ink: '#f6d6b8', text: '#f8e7d6', text2: '#d4b394', text3: '#ab8e73', accent: '#f29a4a', danger: '#f08a7a', ok: '#b8cf6a', warn: '#f2c45a', shelves: ['#f0857a', '#c09ad0', '#f2c45a', '#93acd6', '#d69a68', '#7fc2b2', '#b8cf6a', '#ab8e73', '#7a5f4a'], owl: ['#f5b04a', '#d0602a', '#120a05'], island: { bg: '#120a05', text: '#f8e7d6', accent: '#f29a4a' }, appBg: 'radial-gradient(1000px 600px at 100% 0%, #3a1f0e 0%, transparent 60%), #1e130c' }),
  },
  {
    id: 'festive', name: 'Festive Lights', tagline: 'Evergreen, gold and little lights for the end of the year', tags: ['holiday', 'festive', 'celebration', 'seasonal'], font: 'system', corners: 'rounded', category: 'seasonal', season: 'festive',
    light: tokens('light', { bg: '#fbf7f2', elev: '#ffffff', sunk: '#f2ebe1', ink: '#2a2a3a', text: '#1e1e2a', text2: '#4a4a5c', text3: '#636375', accent: '#1f7a4f', danger: '#c02a3a', ok: '#1f7a4f', warn: '#8a5c00', shelves: ['#e03a4f', '#7a5ad6', '#d69a14', '#2f7ad6', '#9a6a3a', '#1f9a8a', '#2f9a4f', '#5c5c6c', '#a8a8b8'], owl: ['#ffd34a', '#e03a4f', '#1f7a4f'], island: { bg: '#1a1a2a', text: '#fff6e6', accent: '#ffd34a' }, appBg: 'radial-gradient(circle at 8% 6%, rgba(224,58,79,.18) 0 3px, transparent 4px), radial-gradient(circle at 22% 3%, rgba(214,154,20,.22) 0 3px, transparent 4px), radial-gradient(circle at 37% 7%, rgba(47,122,214,.16) 0 3px, transparent 4px), radial-gradient(circle at 53% 3%, rgba(31,122,79,.18) 0 3px, transparent 4px), radial-gradient(circle at 69% 6%, rgba(224,58,79,.18) 0 3px, transparent 4px), radial-gradient(circle at 84% 3%, rgba(214,154,20,.22) 0 3px, transparent 4px), radial-gradient(circle at 96% 7%, rgba(47,122,214,.16) 0 3px, transparent 4px), #fbf7f2' }),
    dark: tokens('dark', { bg: '#12141f', elev: '#1a1d2b', sunk: '#0d0f17', ink: '#f2e8d6', text: '#f6eee2', text2: '#c8bfb0', text3: '#a19a8c', accent: '#ffd34a', danger: '#ff7a8a', ok: '#5fd68f', warn: '#ffd34a', shelves: ['#ff7a8a', '#b3a0ff', '#ffd34a', '#7ab3ff', '#d6a87a', '#4fd6c4', '#5fd68f', '#a19a8c', '#6a6a7c'], owl: ['#ffd34a', '#ff7a8a', '#0d0f17'], island: { bg: '#090a10', text: '#f6eee2', accent: '#ffd34a' }, appBg: 'radial-gradient(circle at 8% 6%, rgba(255,122,138,.30) 0 3px, transparent 5px), radial-gradient(circle at 22% 3%, rgba(255,211,74,.32) 0 3px, transparent 5px), radial-gradient(circle at 37% 7%, rgba(122,179,255,.28) 0 3px, transparent 5px), radial-gradient(circle at 53% 3%, rgba(95,214,143,.28) 0 3px, transparent 5px), radial-gradient(circle at 69% 6%, rgba(255,122,138,.30) 0 3px, transparent 5px), radial-gradient(circle at 84% 3%, rgba(255,211,74,.32) 0 3px, transparent 5px), radial-gradient(circle at 96% 7%, rgba(122,179,255,.28) 0 3px, transparent 5px), #12141f' }),
  },

  // ------------------------------------------------------------ showpieces
  {
    id: 'blueprint', name: 'Blueprint', tagline: 'Technical drawing: white lines on drafting blue, grid included', tags: ['technical', 'grid', 'blue', 'unique'], font: 'mono', corners: 'sharp', category: 'unique',
    light: tokens('light', { bg: '#f4f8fd', elev: '#ffffff', sunk: '#e6eff9', ink: '#0f3b6e', text: '#0b2a4f', text2: '#2f5582', text3: '#446893', accent: '#1a56b8', danger: '#b8304a', ok: '#1f7a5a', warn: '#8a5c00', shelves: ['#d65a7a', '#7a5ad6', '#bf8a1f', '#1a56b8', '#8a6a4a', '#1f8a9a', '#3f8a4f', '#4f73a0', '#9ab3d0'], owl: ['#9ad0ff', '#1a56b8', '#0b2a4f'], island: { bg: '#0b2a4f', text: '#eaf3ff', accent: '#ffe14a' }, radius: [3, 2], appBg: 'linear-gradient(rgba(26,86,184,.06) 1px, transparent 1px) 0 0/24px 24px, linear-gradient(90deg, rgba(26,86,184,.06) 1px, transparent 1px) 0 0/24px 24px, linear-gradient(rgba(26,86,184,.10) 1px, transparent 1px) 0 0/120px 120px, linear-gradient(90deg, rgba(26,86,184,.10) 1px, transparent 1px) 0 0/120px 120px, #f4f8fd' }),
    dark: tokens('dark', { bg: '#0f3b6e', elev: '#13457f', sunk: '#0b2f58', ink: '#d8ecff', text: '#f2f8ff', text2: '#c9def5', text3: '#a8c6e6', accent: '#ffe14a', danger: '#ffb0b0', ok: '#9af0c0', warn: '#ffe14a', shelves: ['#ffb3c7', '#c9b3ff', '#ffe14a', '#9ad0ff', '#e6c39a', '#8ff0e0', '#b3f0a0', '#c3d6ea', '#a8c6e6'], owl: ['#ffffff', '#9ad0ff', '#0b2f58'], island: { bg: '#08254a', text: '#f2f8ff', accent: '#ffe14a' }, radius: [3, 2], appBg: 'linear-gradient(rgba(216,236,255,.07) 1px, transparent 1px) 0 0/24px 24px, linear-gradient(90deg, rgba(216,236,255,.07) 1px, transparent 1px) 0 0/24px 24px, linear-gradient(rgba(216,236,255,.13) 1px, transparent 1px) 0 0/120px 120px, linear-gradient(90deg, rgba(216,236,255,.13) 1px, transparent 1px) 0 0/120px 120px, #0f3b6e', shadowTint: '#04152b' }),
  },
  {
    id: 'aurora', name: 'Aurora', tagline: 'Green, blue and violet light drifting over a polar night', tags: ['glow', 'night', 'gradient', 'unique', 'dark'], font: 'system', corners: 'soft', category: 'unique',
    dark: tokens('dark', { bg: '#070b14', elev: '#0f1524', sunk: '#04070d', ink: '#cfe8ff', text: '#eaf4ff', text2: '#b0c4dc', text3: '#8a9cb6', accent: '#5cf2b5', danger: '#ff7a9a', ok: '#5cf2b5', warn: '#ffd166', shelves: ['#ff7ad9', '#a98bff', '#ffd166', '#6cc8ff', '#e0a87a', '#5cf2d5', '#7dff9a', '#8a9cb6', '#5c6a80'], owl: ['#5cf2b5', '#6cc8ff', '#a98bff'], island: { bg: '#03060b', text: '#eaf4ff', accent: '#5cf2b5' }, radius: [18, 12], appBg: 'radial-gradient(900px 420px at 15% -5%, rgba(92,242,181,.20) 0%, transparent 60%), radial-gradient(800px 420px at 60% -10%, rgba(108,200,255,.16) 0%, transparent 60%), radial-gradient(700px 400px at 95% 5%, rgba(169,139,255,.18) 0%, transparent 60%), #070b14', shadowTint: '#000000' }),
  },
  {
    id: 'glass', name: 'Frosted Glass', tagline: 'Panels like frosted glass over soft colour', tags: ['glass', 'translucent', 'modern', 'unique'], font: 'system', corners: 'soft', category: 'unique',
    light: tokens('light', { bg: '#eef2f8', elev: '#ffffff', sunk: '#e2e8f1', ink: '#1b2433', text: '#121a26', text2: '#445064', text3: '#566377', accent: '#2a66d6', danger: '#c0304a', ok: '#1d7f56', warn: '#8a5c00', shelves: ['#f2648a', '#8a6ff0', '#d99a1f', '#3f8ef0', '#a37a52', '#1fb3ad', '#36b36b', '#5a6678', '#a5afbf'], owl: ['#ffffff', '#a8c4ff', '#2a66d6'], island: { bg: '#10161f', text: '#f2f6fc', accent: '#8fb6ff' }, radius: [20, 14], appBg: 'radial-gradient(600px 420px at 8% 12%, rgba(255,140,190,.32) 0%, transparent 70%), radial-gradient(700px 500px at 92% 18%, rgba(120,170,255,.32) 0%, transparent 70%), radial-gradient(800px 520px at 50% 105%, rgba(120,230,210,.28) 0%, transparent 70%), #eef2f8' }),
    dark: tokens('dark', { bg: '#0d111a', elev: '#171d2a', sunk: '#090c12', ink: '#dbe4f5', text: '#eef2fa', text2: '#b3bdd0', text3: '#8f99ae', accent: '#7fa8ff', danger: '#ff7f95', ok: '#5fd99f', warn: '#f5c860', shelves: ['#ff8fb0', '#b3a0ff', '#f5c860', '#7fa8ff', '#d6aa82', '#5fd6d0', '#5fd99f', '#8f99ae', '#5a6678'], owl: ['#dbe4f5', '#7fa8ff', '#090c12'], island: { bg: '#06080d', text: '#eef2fa', accent: '#7fa8ff' }, radius: [20, 14], appBg: 'radial-gradient(600px 420px at 8% 12%, rgba(255,110,170,.16) 0%, transparent 70%), radial-gradient(700px 500px at 92% 18%, rgba(100,150,255,.18) 0%, transparent 70%), radial-gradient(800px 520px at 50% 105%, rgba(80,210,190,.14) 0%, transparent 70%), #0d111a' }),
  },
  {
    id: 'inkwash', name: 'Ink Wash', tagline: 'Brush ink on rice paper with a single red seal', tags: ['ink', 'brush', 'calm', 'serif', 'unique'], font: 'serif', corners: 'soft', category: 'unique',
    light: tokens('light', { bg: '#f5f2ea', elev: '#fbf9f4', sunk: '#ebe6da', ink: '#1a1a1a', text: '#141414', text2: '#444240', text3: '#63605d', accent: '#b0251d', danger: '#9a1f1a', ok: '#3f6b3a', warn: '#7a5600', shelves: ['#b0251d', '#3a3a3a', '#6b5a3a', '#2a3a4a', '#5a4a3a', '#3a5a52', '#4a5a3a', '#6a6662', '#9a9690'], owl: ['#e8e2d4', '#3a3a3a', '#141414'], island: { bg: '#141414', text: '#f5f2ea', accent: '#e0574a' }, radius: [6, 4], appBg: 'radial-gradient(900px 320px at 88% 108%, rgba(20,20,20,.11) 0%, transparent 62%), radial-gradient(700px 220px at 6% -6%, rgba(20,20,20,.07) 0%, transparent 60%), radial-gradient(300px 120px at 60% 104%, rgba(20,20,20,.06) 0%, transparent 70%), #f5f2ea' }),
    dark: tokens('dark', { bg: '#151413', elev: '#1e1d1b', sunk: '#100f0e', ink: '#ece6da', text: '#efe9de', text2: '#bdb6aa', text3: '#99928a', accent: '#ff6a5c', danger: '#ff7a6c', ok: '#94c08a', warn: '#e6c26a', shelves: ['#ff6a5c', '#cfcac0', '#b8a888', '#9aaabb', '#aa9a88', '#8ab0a8', '#a0b08a', '#99928a', '#6a6662'], owl: ['#ece6da', '#6a6662', '#0a0a09'], island: { bg: '#0a0a09', text: '#efe9de', accent: '#ff6a5c' }, radius: [6, 4], appBg: 'radial-gradient(900px 320px at 88% 108%, rgba(236,230,218,.05) 0%, transparent 62%), #151413' }),
  },
  {
    id: 'amber', name: 'Amber CRT', tagline: 'A warm amber monitor from 1983, scanlines and all', tags: ['retro', 'crt', 'amber', 'mono', 'unique', 'dark'], font: 'mono', corners: 'sharp', category: 'unique',
    dark: tokens('dark', { bg: '#0d0700', elev: '#160c02', sunk: '#080400', ink: '#ffb000', text: '#ffc966', text2: '#e0a246', text3: '#b8843a', accent: '#ffb000', danger: '#ff6a3d', ok: '#d6e05a', warn: '#ffd36b', shelves: ['#ffb000', '#ff8c2a', '#ffd36b', '#e0a246', '#c47a2a', '#ffc966', '#d6e05a', '#b8843a', '#7a5520'], owl: ['#ffd36b', '#ffb000', '#3a2000'], island: { bg: '#000000', text: '#ffc966', accent: '#ffb000' }, radius: [2, 2], appBg: 'repeating-linear-gradient(0deg, rgba(255,176,0,.03) 0 1px, transparent 1px 3px), radial-gradient(1200px 800px at 50% 50%, #140a00 0%, #0d0700 70%)', shadowTint: '#000000' }),
  },
];

export const DEFAULT_THEME = 'playful';

export function themeById(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Which mode a theme shows in: its only mode, or what the person (or system) asked for. */
export function resolveMode(t: Theme, wanted: 'system' | 'light' | 'dark', systemDark: boolean): ThemeMode {
  if (!t.light) return 'dark';
  if (!t.dark) return 'light';
  const want = wanted === 'system' ? (systemDark ? 'dark' : 'light') : wanted;
  return want;
}

export interface ThemeOverrides {
  accent?: string;
  font?: ThemeFont | 'theme';
  corners?: ThemeCorners | 'theme';
}

export const FONT_STACKS: Record<ThemeFont, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', system-ui, Inter, Roboto, 'Helvetica Neue', sans-serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Segoe UI Variable Display', 'Nunito', 'Varela Round', 'Quicksand', 'Comfortaa', system-ui, sans-serif",
  serif: "ui-serif, 'New York', 'Iowan Old Style', 'Charter', 'Palatino Linotype', Palatino, Georgia, 'Noto Serif', 'DejaVu Serif', serif",
  mono: "ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
};

const CORNERS: Record<ThemeCorners, [string, string]> = { rounded: ['14px', '9px'], soft: ['18px', '12px'], sharp: ['4px', '3px'] };

/**
 * The final CSS variables for a theme in a mode, with the person's overrides
 * (custom accent, font, corners) applied on top.
 */
export function themeVariables(t: Theme, mode: ThemeMode, o: ThemeOverrides = {}): Record<string, string> {
  const base = (mode === 'dark' ? t.dark : t.light) ?? t.dark ?? t.light!;
  const vars: Record<string, string> = {};
  for (const k of TOKEN_KEYS) vars[`--${k}`] = base[k];
  if (o.accent && parseColor(o.accent)) {
    vars['--accent'] = o.accent;
    vars['--accent-soft'] = alpha(o.accent, mode === 'dark' ? 0.2 : 0.14);
    vars['--accent-text'] = readableOn(o.accent);
  }
  const font = o.font && o.font !== 'theme' ? o.font : t.font;
  vars['--font'] = FONT_STACKS[font];
  if (o.corners && o.corners !== 'theme') {
    vars['--radius'] = CORNERS[o.corners][0];
    vars['--radius-sm'] = CORNERS[o.corners][1];
  }
  return vars;
}

/** Contrast checks the tests (and the gallery's warning for custom accents) rely on. */
export function checkTheme(tokens: Tokens): { pair: string; ratio: number; min: number }[] {
  const out: { pair: string; ratio: number; min: number }[] = [];
  const add = (pair: string, fg: string, bg: string, min: number) => out.push({ pair, ratio: contrast(fg, bg), min });
  add('text on bg', tokens.text, tokens.bg, 4.5);
  add('text on bg-elev', tokens.text, tokens['bg-elev'], 4.5);
  add('text-2 on bg', tokens['text-2'], tokens.bg, 4.5);
  add('text-2 on bg-elev', tokens['text-2'], tokens['bg-elev'], 4.5);
  add('text-3 on bg-elev', tokens['text-3'], tokens['bg-elev'], 3);
  add('accent-text on accent', tokens['accent-text'], tokens.accent, 4.5);
  add('accent on bg-elev', tokens.accent, tokens['bg-elev'], 3);
  add('island text', tokens['island-text'], tokens['island-bg'], 4.5);
  add('island accent text', tokens['island-accent-text'], tokens['island-accent'], 4.5);
  return out;
}

// ---------------------------------------------------------------- gallery shelves and the seasons

export function themeCategory(t: Theme): ThemeCategory {
  return t.category ?? 'main';
}

export type Hemisphere = 'north' | 'south';

/** Time zones south of the equator (the rest of the world is north, or close enough for seasons). */
const SOUTH_ZONES = /^(Australia\/|Antarctica\/|Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Apia|Noumea|Efate|Port_Moresby|Tahiti|Rarotonga|Easter)|America\/(Argentina|Buenos_Aires|Santiago|Sao_Paulo|Montevideo|Asuncion|La_Paz|Lima|Punta_Arenas|Cuiaba|Campo_Grande|Porto_Velho|Recife|Fortaleza|Maceio|Bahia|Belem|Araguaina|Rio_Branco)|Africa\/(Johannesburg|Maputo|Harare|Lusaka|Windhoek|Gaborone|Maseru|Mbabane|Blantyre|Lubumbashi|Luanda|Dar_es_Salaam|Antananarivo)|Indian\/(Mauritius|Reunion|Antananarivo|Mayotte|Comoro))/;

/** North or south: from the weather place's latitude when known, otherwise from the time zone. */
export function hemisphereFor(lat: number | null | undefined, timeZone: string | undefined): Hemisphere {
  if (typeof lat === 'number' && Number.isFinite(lat) && lat !== 0) return lat < 0 ? 'south' : 'north';
  return timeZone && SOUTH_ZONES.test(timeZone) ? 'south' : 'north';
}

/**
 * The season for a date: the end-of-year festive stretch (15 December – 6 January, anywhere),
 * otherwise meteorological seasons, flipped south of the equator.
 */
export function seasonFor(d: Date, hemisphere: Hemisphere): Season {
  const m = d.getMonth();
  const day = d.getDate();
  if ((m === 11 && day >= 15) || (m === 0 && day <= 6)) return 'festive';
  const north: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  const s = north[m];
  if (hemisphere === 'north') return s;
  return ({ winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring', festive: 'festive' } as const)[s];
}

/** The seasonal theme for a date and hemisphere. */
export function seasonalThemeId(d: Date, hemisphere: Hemisphere): string {
  const season = seasonFor(d, hemisphere);
  return THEMES.find((t) => t.season === season)?.id ?? DEFAULT_THEME;
}


// ---------------------------------------------------------------- palettes for wallpapers and widgets

/**
 * Four colours from a theme, darkest to brightest, so a live wallpaper or a
 * "tinted" widget can follow the theme: background, raised surface, accent, text.
 */
export function themePalette(t: Theme, mode: ThemeMode, accent?: string): [string, string, string, string] {
  const tok = (mode === 'dark' ? t.dark : t.light) ?? t.dark ?? t.light!;
  const solid = (c: string, fallback: string) => {
    const p = parseColor(c);
    return p ? toHex(p.a < 1 ? over(p, parseColor(tok.bg) ?? { r: 0, g: 0, b: 0, a: 1 }) : p) : fallback;
  };
  const a = accent && parseColor(accent) ? accent : tok.accent;
  const cols = [solid(tok.bg, '#000000'), solid(tok['bg-elev'], '#222222'), solid(a, '#6d6dff'), solid(tok.text, '#ffffff')];
  return cols.sort((x, y) => luminance(parseColor(x)!) - luminance(parseColor(y)!)) as [string, string, string, string];
}
