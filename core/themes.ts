// SPDX-License-Identifier: AGPL-3.0-or-later
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

export interface Theme {
  id: string;
  name: string;
  tagline: string;
  tags: string[];
  font: ThemeFont;
  corners: ThemeCorners;
  light?: Tokens;
  dark?: Tokens;
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
    light: tokens('light', { bg: '#f6f5f2', elev: '#ffffff', sunk: '#eeece7', ink: '#14141e', text: '#18181b', text2: '#55555e', text3: '#7a7a83', accent: '#5b5bf0', danger: '#d93a40', ok: '#2a8a57', warn: '#b06f00', shelves: PLAYFUL_SHELVES, owl: OWL, island: { bg: '#0a0a0c', text: '#f4f4f5', accent: '#ffffff' } }),
    dark: tokens('dark', { bg: '#111114', elev: '#1b1b20', sunk: '#0b0b0d', ink: '#ffffff', text: '#f4f4f5', text2: '#b4b4bc', text3: '#86868f', accent: '#8282ff', accentText: '#0b0b18', danger: '#ff6b70', ok: '#4ccb85', warn: '#f2b23a', shelves: PLAYFUL_SHELVES, owl: OWL, island: { bg: '#0a0a0c', text: '#f4f4f5', accent: '#ffffff' } }),
  },
  {
    id: 'minimal', name: 'Minimal', tagline: 'Black, white and grey: nothing competes with your files', tags: ['monochrome', 'calm'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#f6f6f6', elev: '#ffffff', sunk: '#ececec', ink: '#141414', text: '#141414', text2: '#4e4e4e', text3: '#767676', accent: '#141414', danger: '#c62828', ok: '#2e7d32', warn: '#8d5a00', shelves: ['#555', '#555', '#555', '#555', '#555', '#555', '#555', '#555', '#888'], owl: ['#8a8a8a', '#4a4a4a', '#141414'], island: { bg: '#0a0a0a', text: '#f4f4f4', accent: '#ffffff' } }),
    dark: tokens('dark', { bg: '#101010', elev: '#1a1a1a', sunk: '#0a0a0a', ink: '#ffffff', text: '#f2f2f2', text2: '#b5b5b5', text3: '#8a8a8a', accent: '#f2f2f2', danger: '#ff6b6b', ok: '#66bb6a', warn: '#ffb74d', shelves: ['#bbb', '#bbb', '#bbb', '#bbb', '#bbb', '#bbb', '#bbb', '#bbb', '#888'], owl: ['#bdbdbd', '#6e6e6e', '#2a2a2a'], island: { bg: '#000000', text: '#f2f2f2', accent: '#ffffff' } }),
  },
  {
    id: 'blossom', name: 'Blossom', tagline: 'Petal pink and lavender with soft, round edges', tags: ['pastel', 'cute', 'girly', 'soft'], font: 'rounded', corners: 'soft',
    light: tokens('light', { bg: '#fff5f8', elev: '#ffffff', sunk: '#fde8ef', ink: '#6b2346', text: '#3d1a2c', text2: '#7a4560', text3: '#9a6680', accent: '#d6337a', danger: '#c62845', ok: '#2f8a5f', warn: '#a8620a', shelves: ['#f472b6', '#c084fc', '#fb923c', '#818cf8', '#d97706', '#2dd4bf', '#34d399', '#a78bfa', '#f9a8d4'], owl: ['#ffc2d8', '#f472b6', '#a855f7'], island: { bg: '#4a1d36', text: '#ffe4ef', accent: '#ff8fc0' }, radius: [20, 14], appBg: 'radial-gradient(1200px 600px at 0% 0%, #ffe3ee 0%, transparent 60%), radial-gradient(900px 500px at 100% 100%, #efe4ff 0%, transparent 55%), #fff5f8', shadowTint: '#8a2858' }),
    dark: tokens('dark', { bg: '#1e1420', elev: '#2a1c2d', sunk: '#160e18', ink: '#ffd6e8', text: '#fdeaf3', text2: '#d9b3c8', text3: '#ad8aa0', accent: '#ff8fc0', danger: '#ff7a8a', ok: '#6fd3a0', warn: '#ffc46b', shelves: ['#f9a8d4', '#d8b4fe', '#fdba74', '#a5b4fc', '#fcd34d', '#5eead4', '#6ee7b7', '#c4b5fd', '#f5d0fe'], owl: ['#ffc2d8', '#f472b6', '#a855f7'], island: { bg: '#2a1426', text: '#ffe4ef', accent: '#ff8fc0' }, radius: [20, 14], appBg: 'radial-gradient(1000px 600px at 0% 0%, #2c1830 0%, transparent 60%), #1e1420' }),
  },
  {
    id: 'steel', name: 'Steel', tagline: 'Gunmetal and safety orange, square and solid', tags: ['bold', 'industrial', 'manly', 'dark'], font: 'system', corners: 'sharp',
    light: tokens('light', { bg: '#e9ebee', elev: '#f7f8f9', sunk: '#dde0e4', ink: '#1c232b', text: '#14191f', text2: '#3f4954', text3: '#5f6a76', accent: '#c2410c', danger: '#b91c1c', ok: '#15803d', warn: '#a16207', shelves: ['#ea580c', '#475569', '#ca8a04', '#2563eb', '#78716c', '#0d9488', '#16a34a', '#334155', '#94a3b8'], owl: ['#fb923c', '#c2410c', '#1f2933'], island: { bg: '#11161b', text: '#e5e7eb', accent: '#f97316' }, radius: [4, 3] }),
    dark: tokens('dark', { bg: '#14181c', elev: '#1d2329', sunk: '#0e1114', ink: '#d6dde4', text: '#e8ecef', text2: '#aab4bd', text3: '#808b96', accent: '#f97316', danger: '#f87171', ok: '#4ade80', warn: '#facc15', shelves: ['#fb923c', '#94a3b8', '#facc15', '#60a5fa', '#a8a29e', '#2dd4bf', '#4ade80', '#64748b', '#9ca3af'], owl: ['#fb923c', '#c2410c', '#0e1114'], island: { bg: '#0b0e11', text: '#e5e7eb', accent: '#f97316' }, radius: [4, 3], appBg: 'repeating-linear-gradient(135deg, rgba(255,255,255,.012) 0 2px, transparent 2px 6px), #14181c' }),
  },
  {
    id: 'terminal', name: 'Terminal', tagline: 'Phosphor green on black, everything in monospace', tags: ['coder', 'hacker', 'retro', 'dark'], font: 'mono', corners: 'sharp',
    dark: tokens('dark', { bg: '#050805', elev: '#0b120b', sunk: '#020402', ink: '#5dff8a', text: '#b6ffc8', text2: '#7fd99a', text3: '#56a86f', accent: '#39ff6a', danger: '#ff5f56', ok: '#39ff6a', warn: '#ffd23f', shelves: ['#39ff6a', '#5dd4ff', '#ffd23f', '#a0ff7a', '#ffb347', '#4dffd2', '#7cff3a', '#8bd99f', '#5b8f6a'], owl: ['#39ff6a', '#14a83c', '#021a08'], island: { bg: '#000000', text: '#b6ffc8', accent: '#39ff6a' }, radius: [2, 2], appBg: 'repeating-linear-gradient(0deg, rgba(57,255,106,.025) 0 1px, transparent 1px 3px), #050805', shadowTint: '#000000' }),
  },
  {
    id: 'midnight', name: 'Midnight Code', tagline: 'Deep navy with violet and teal, built for long sessions', tags: ['coder', 'dark', 'cool'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#f3f5fb', elev: '#ffffff', sunk: '#e6eaf5', ink: '#1a2147', text: '#151a33', text2: '#454d70', text3: '#676f92', accent: '#6d4bd8', danger: '#c8304a', ok: '#18825f', warn: '#9a6400', shelves: ['#e0567f', '#7c5ce0', '#d18b1f', '#3f7fe0', '#99653a', '#169a90', '#1f9d6c', '#5b6b94', '#8a93b3'], owl: ['#5eead4', '#7c5ce0', '#1e1b4b'], island: { bg: '#0f1430', text: '#e6e9ff', accent: '#5eead4' } }),
    dark: tokens('dark', { bg: '#0d1124', elev: '#151b35', sunk: '#090c1a', ink: '#c7d0ff', text: '#e4e8ff', text2: '#a7b0d8', text3: '#7d86ad', accent: '#a78bfa', danger: '#fb7185', ok: '#5eead4', warn: '#fcd34d', shelves: ['#fb7185', '#a78bfa', '#fbbf24', '#60a5fa', '#d6a77a', '#2dd4bf', '#34d399', '#94a3b8', '#7c86ad'], owl: ['#5eead4', '#a78bfa', '#312e81'], island: { bg: '#070a18', text: '#e4e8ff', accent: '#5eead4' }, appBg: 'radial-gradient(1200px 700px at 100% 0%, #1b1f4a 0%, transparent 55%), #0d1124' }),
  },
  {
    id: 'ocean', name: 'Ocean', tagline: 'Sea glass, deep water and a fresh breeze', tags: ['blue', 'calm', 'fresh'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#f0f7fa', elev: '#ffffff', sunk: '#e0eef4', ink: '#0b3a52', text: '#0b2533', text2: '#3a5868', text3: '#5c7a8a', accent: '#0369a1', danger: '#c0263d', ok: '#0f7a5c', warn: '#9a5b00', shelves: ['#f472b6', '#6366f1', '#f59e0b', '#0284c7', '#a16207', '#0d9488', '#059669', '#475569', '#94a3b8'], owl: ['#7dd3fc', '#0ea5e9', '#0c4a6e'], island: { bg: '#062538', text: '#e0f2fe', accent: '#38bdf8' }, appBg: 'linear-gradient(180deg, #e8f4f9 0%, #f0f7fa 40%), #f0f7fa' }),
    dark: tokens('dark', { bg: '#071a24', elev: '#0d2532', sunk: '#04121a', ink: '#bae6fd', text: '#e0f2fe', text2: '#9ec4d8', text3: '#76a0b4', accent: '#38bdf8', danger: '#fb7185', ok: '#34d399', warn: '#fbbf24', shelves: ['#f9a8d4', '#a5b4fc', '#fcd34d', '#7dd3fc', '#d6a77a', '#5eead4', '#6ee7b7', '#94a3b8', '#64748b'], owl: ['#7dd3fc', '#0ea5e9', '#082f49'], island: { bg: '#03121b', text: '#e0f2fe', accent: '#38bdf8' }, appBg: 'radial-gradient(1200px 700px at 50% 120%, #0b3346 0%, transparent 60%), #071a24' }),
  },
  {
    id: 'forest', name: 'Forest', tagline: 'Moss, fern and bark: a walk in the woods', tags: ['green', 'nature', 'calm'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#f3f6ef', elev: '#fbfcf8', sunk: '#e6ecdf', ink: '#203321', text: '#1a2a1b', text2: '#46584a', text3: '#647566', accent: '#2f7a3d', danger: '#b4302f', ok: '#2f7a3d', warn: '#8a5d00', shelves: ['#d9668b', '#7b6bd1', '#c98a1b', '#3f7cc1', '#8b5e34', '#2a9d8f', '#4c9a2a', '#5f6f5f', '#9aa79a'], owl: ['#bef264', '#4d7c0f', '#1a2e05'], island: { bg: '#132015', text: '#e6f2df', accent: '#a3d977' }, appBg: 'radial-gradient(1000px 600px at 0% 100%, #e3ecd6 0%, transparent 60%), #f3f6ef' }),
    dark: tokens('dark', { bg: '#101a12', elev: '#18251a', sunk: '#0a120c', ink: '#d9f2c9', text: '#e6f2df', text2: '#aec3a6', text3: '#879c80', accent: '#8bd46a', danger: '#f28b82', ok: '#8bd46a', warn: '#f2c14e', shelves: ['#f4a3b8', '#b3a6f2', '#f2c14e', '#8cc2f2', '#c9a27a', '#6fd6c5', '#8bd46a', '#9fb09f', '#6f806f'], owl: ['#bef264', '#4d7c0f', '#0b1a06'], island: { bg: '#0a120b', text: '#e6f2df', accent: '#8bd46a' } }),
  },
  {
    id: 'sunset', name: 'Sunset', tagline: 'Coral, amber and plum from the golden hour', tags: ['warm', 'colourful', 'vibrant'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#fff6ef', elev: '#ffffff', sunk: '#fde9da', ink: '#5a1f1a', text: '#2e1410', text2: '#6b3c32', text3: '#8c5c50', accent: '#c2410c', danger: '#be123c', ok: '#15803d', warn: '#a16207', shelves: ['#f43f5e', '#a855f7', '#f59e0b', '#2563eb', '#b45309', '#0d9488', '#16a34a', '#78716c', '#a8a29e'], owl: ['#fcd34d', '#fb7185', '#7c3aed'], island: { bg: '#3b1426', text: '#ffe9dc', accent: '#fb923c' }, appBg: 'linear-gradient(160deg, #ffe7d6 0%, #fff6ef 35%, #fdeef4 100%)', shadowTint: '#7c2d12' }),
    dark: tokens('dark', { bg: '#1d1015', elev: '#2a171e', sunk: '#140a0e', ink: '#ffd9c4', text: '#ffeee4', text2: '#d9b0a3', text3: '#ad8679', accent: '#fb923c', danger: '#fb7185', ok: '#4ade80', warn: '#fcd34d', shelves: ['#fb7185', '#c084fc', '#fcd34d', '#60a5fa', '#d6a77a', '#2dd4bf', '#4ade80', '#a8a29e', '#78716c'], owl: ['#fcd34d', '#fb7185', '#7c3aed'], island: { bg: '#190a12', text: '#ffeee4', accent: '#fb923c' }, appBg: 'radial-gradient(1200px 600px at 100% 0%, #3d1726 0%, transparent 55%), radial-gradient(900px 500px at 0% 100%, #3a1c10 0%, transparent 55%), #1d1015' }),
  },
  {
    id: 'paper', name: 'Paper', tagline: 'Warm sepia and serif type, easy on the eyes like an e-reader', tags: ['reading', 'calm', 'serif', 'sepia'], font: 'serif', corners: 'soft',
    light: tokens('light', { bg: '#f4ecd8', elev: '#fbf6e9', sunk: '#ebe1c8', ink: '#4a3b24', text: '#2f2416', text2: '#5c4a32', text3: '#7a6649', accent: '#8a4b14', danger: '#a12a1b', ok: '#3d6b2a', warn: '#8a5a00', shelves: ['#b5546b', '#6b5aa8', '#b07a1f', '#3f6aa8', '#8a5a2b', '#3a8a7a', '#4a8a3a', '#6b6252', '#9a9078'], owl: ['#e8c88a', '#b07a3a', '#5c3a14'], island: { bg: '#3a2c1a', text: '#f4ecd8', accent: '#e8c88a' }, radius: [10, 7] }),
    dark: tokens('dark', { bg: '#1f1a13', elev: '#29231a', sunk: '#17130e', ink: '#f0e2c4', text: '#ece0c6', text2: '#c2b393', text3: '#998a6c', accent: '#e0a458', danger: '#e8806e', ok: '#9cc77a', warn: '#e8c060', shelves: ['#e08a9b', '#a99ad6', '#e0b45a', '#8aaee0', '#c99a6b', '#7ac2b4', '#9cc77a', '#a89d86', '#7a705c'], owl: ['#e8c88a', '#b07a3a', '#3a2510'], island: { bg: '#120f0a', text: '#ece0c6', accent: '#e0a458' }, radius: [10, 7] }),
  },
  {
    id: 'academia', name: 'Academia', tagline: 'Oak, ink and brass from an old university library', tags: ['dark academia', 'serif', 'warm', 'scholarly'], font: 'serif', corners: 'soft',
    light: tokens('light', { bg: '#efe6d6', elev: '#f8f2e6', sunk: '#e3d7c1', ink: '#3b2a1a', text: '#24180e', text2: '#54402c', text3: '#735c44', accent: '#7a2e2e', danger: '#9b1c1c', ok: '#2f5d3a', warn: '#7a5200', shelves: ['#9b3d4a', '#5a4a8a', '#a8761f', '#2f4f7a', '#6b4423', '#2f6f63', '#3d6b2f', '#5c5245', '#8a7f6e'], owl: ['#d4b26a', '#8b5a2b', '#3b1f0f'], island: { bg: '#2a1c12', text: '#efe6d6', accent: '#d4b26a' }, radius: [8, 6] }),
    dark: tokens('dark', { bg: '#1b140f', elev: '#261c15', sunk: '#130e0a', ink: '#ead9b8', text: '#efe3cb', text2: '#c6b28f', text3: '#9c896b', accent: '#d4b26a', danger: '#e07a6e', ok: '#8fbf86', warn: '#e0b860', shelves: ['#d4808b', '#a397d1', '#d4b26a', '#7f9fd1', '#b88a5c', '#7fb8a8', '#8fbf86', '#a39684', '#756a5a'], owl: ['#d4b26a', '#8b5a2b', '#24150a'], island: { bg: '#0f0a07', text: '#efe3cb', accent: '#d4b26a' }, radius: [8, 6], appBg: 'radial-gradient(1200px 700px at 0% 0%, #2a1d14 0%, transparent 60%), #1b140f' }),
  },
  {
    id: 'neon', name: 'Neon Nights', tagline: 'Synthwave magenta and cyan with a soft glow', tags: ['synthwave', 'cyberpunk', 'retro', 'dark', 'vibrant'], font: 'system', corners: 'rounded',
    dark: tokens('dark', { bg: '#120b24', elev: '#1c1236', sunk: '#0b0618', ink: '#f0c6ff', text: '#fbeaff', text2: '#cbb3e6', text3: '#9d86bd', accent: '#ff3fbf', danger: '#ff5c7a', ok: '#3df5c4', warn: '#ffd93d', shelves: ['#ff3fbf', '#a06bff', '#ffd93d', '#3dd6ff', '#ff9f43', '#3df5c4', '#7dff6b', '#9d86bd', '#6c5a8c'], owl: ['#3dd6ff', '#ff3fbf', '#5b16c9'], island: { bg: '#0b0618', text: '#fbeaff', accent: '#3dd6ff' }, appBg: 'linear-gradient(180deg, rgba(255,63,191,.08) 0%, transparent 30%), repeating-linear-gradient(90deg, rgba(61,214,255,.035) 0 1px, transparent 1px 48px), repeating-linear-gradient(0deg, rgba(61,214,255,.035) 0 1px, transparent 1px 48px), #120b24', shadowTint: '#2a0040' }),
  },
  {
    id: 'candy', name: 'Candy', tagline: 'Bubblegum brights and big round shapes, made for fun', tags: ['kids', 'bright', 'cute', 'playful'], font: 'rounded', corners: 'soft',
    light: tokens('light', { bg: '#fffaf0', elev: '#ffffff', sunk: '#fff0d6', ink: '#3a1f5c', text: '#2a1745', text2: '#5a4280', text3: '#7a63a0', accent: '#7c3aed', danger: '#e11d48', ok: '#16a34a', warn: '#b45309', shelves: ['#ff4f9a', '#8b5cf6', '#ffb020', '#2f8cff', '#ff7a1a', '#14c4b8', '#3ccf5a', '#7a63a0', '#c4b5fd'], owl: ['#ffd23f', '#ff4f9a', '#7c3aed'], island: { bg: '#3a1f5c', text: '#fff4d6', accent: '#ffd23f' }, radius: [22, 16], appBg: 'radial-gradient(700px 500px at 0% 0%, rgba(255,79,154,.1) 0%, transparent 70%), radial-gradient(700px 500px at 100% 10%, rgba(47,140,255,.08) 0%, transparent 70%), radial-gradient(800px 500px at 60% 100%, rgba(255,176,32,.12) 0%, transparent 70%), #fffaf0' }),
  },
  {
    id: 'luxe', name: 'Luxe', tagline: 'Black lacquer and brushed gold, quietly expensive', tags: ['luxury', 'elegant', 'dark', 'gold'], font: 'serif', corners: 'soft',
    light: tokens('light', { bg: '#f7f3ea', elev: '#fffdf8', sunk: '#ede6d6', ink: '#2a2418', text: '#1a160e', text2: '#4d4532', text3: '#6e6450', accent: '#8a6a1f', danger: '#a12a2a', ok: '#2f6b3d', warn: '#8a5a00', shelves: ['#a8566b', '#6b5aa0', '#b8901f', '#3d5f8a', '#8a6a3d', '#3d7a6e', '#4d7a3d', '#5c5546', '#9a917e'], owl: ['#f0d27a', '#b8901f', '#1a160e'], island: { bg: '#0d0b07', text: '#f7f3ea', accent: '#d4af37' }, radius: [10, 7] }),
    dark: tokens('dark', { bg: '#0b0a08', elev: '#16140f', sunk: '#060504', ink: '#f0dfa8', text: '#f3ead2', text2: '#c7b98f', text3: '#9a8d6a', accent: '#d4af37', danger: '#e0786e', ok: '#8fbf86', warn: '#e6c45c', shelves: ['#d68a9a', '#a99ad6', '#d4af37', '#8aa8d6', '#c09a6b', '#7fb8a8', '#8fbf86', '#9a8d6a', '#6e6450'], owl: ['#f0d27a', '#d4af37', '#3a2c0a'], island: { bg: '#000000', text: '#f3ead2', accent: '#d4af37' }, radius: [10, 7], appBg: 'radial-gradient(900px 500px at 100% 0%, rgba(212,175,55,.07) 0%, transparent 60%), #0b0a08' }),
  },
  {
    id: 'zen', name: 'Zen', tagline: 'Stone, rice paper and a single touch of matcha', tags: ['minimal', 'calm', 'japanese', 'warm grey'], font: 'system', corners: 'soft',
    light: tokens('light', { bg: '#f2efe9', elev: '#faf8f4', sunk: '#e8e4dc', ink: '#2e2a24', text: '#25221d', text2: '#57524a', text3: '#77716a', accent: '#5a7a3a', danger: '#a33a2a', ok: '#5a7a3a', warn: '#8a6200', shelves: ['#b8737f', '#7d7399', '#b08a3e', '#5f7f99', '#8a6e52', '#5f8f86', '#6f8f4f', '#6e6a62', '#a39e94'], owl: ['#c8d6a0', '#7d8f5a', '#2e2a24'], island: { bg: '#25221d', text: '#f2efe9', accent: '#c8d6a0' }, radius: [12, 8] }),
    dark: tokens('dark', { bg: '#1b1a17', elev: '#24221e', sunk: '#141310', ink: '#e8e2d6', text: '#ece7dc', text2: '#bdb6a8', text3: '#948d80', accent: '#a9c27a', danger: '#e08a7a', ok: '#a9c27a', warn: '#e0bf6a', shelves: ['#d6a0aa', '#aaa3c8', '#d6b36e', '#93afc8', '#bba085', '#8fc0b6', '#a9c27a', '#9a958a', '#6e6a62'], owl: ['#c8d6a0', '#7d8f5a', '#141310'], island: { bg: '#0f0e0c', text: '#ece7dc', accent: '#a9c27a' }, radius: [12, 8] }),
  },
  {
    id: 'retro', name: 'Retro 95', tagline: 'Grey bevels, teal desktop and chunky buttons from the 90s', tags: ['retro', 'nostalgic', '90s'], font: 'system', corners: 'sharp',
    light: tokens('light', { bg: '#c0c0c0', elev: '#d4d0c8', sunk: '#b0b0b0', ink: '#000000', text: '#000000', text2: '#202020', text3: '#404040', accent: '#000080', danger: '#a00000', ok: '#006000', warn: '#705000', shelves: ['#c00060', '#600080', '#a07000', '#0000c0', '#806000', '#008080', '#008000', '#404040', '#808080'], owl: ['#00a0a0', '#000080', '#000040'], island: { bg: '#000080', text: '#ffffff', accent: '#c0c0c0', accentText: '#000000' }, radius: [0, 0], appBg: '#008080' }),
  },
  {
    id: 'contrast', name: 'High Contrast', tagline: 'Maximum legibility for low vision and bright rooms', tags: ['accessibility', 'legible', 'bold'], font: 'system', corners: 'rounded',
    light: tokens('light', { bg: '#ffffff', elev: '#ffffff', sunk: '#f0f0f0', ink: '#000000', text: '#000000', text2: '#1a1a1a', text3: '#333333', accent: '#0033cc', danger: '#b30000', ok: '#006b1f', warn: '#7a4a00', shelves: ['#b3005c', '#5a00b3', '#8a5a00', '#0033cc', '#6b3d00', '#006b6b', '#006b1f', '#333333', '#555555'], owl: ['#ffcc00', '#0033cc', '#000000'], island: { bg: '#000000', text: '#ffffff', accent: '#ffcc00' } }),
    dark: tokens('dark', { bg: '#000000', elev: '#0a0a0a', sunk: '#000000', ink: '#ffffff', text: '#ffffff', text2: '#f0f0f0', text3: '#cccccc', accent: '#ffd400', danger: '#ff6b6b', ok: '#5cff8a', warn: '#ffd400', shelves: ['#ff7ab8', '#c49bff', '#ffd400', '#7ab8ff', '#ffb366', '#5cffe6', '#5cff8a', '#cccccc', '#aaaaaa'], owl: ['#ffd400', '#ffffff', '#000000'], island: { bg: '#000000', text: '#ffffff', accent: '#ffd400' } }),
  },
  {
    id: 'coffee', name: 'Cozy Coffee', tagline: 'Espresso, oat milk and caramel for slow mornings', tags: ['cozy', 'warm', 'brown'], font: 'rounded', corners: 'soft',
    light: tokens('light', { bg: '#f6efe6', elev: '#fffaf3', sunk: '#ece2d4', ink: '#3b2414', text: '#2b1a0f', text2: '#5e4330', text3: '#7d604b', accent: '#9a4f1a', danger: '#a8322a', ok: '#3f6e35', warn: '#8a5800', shelves: ['#c0647a', '#7f67a8', '#c48a2c', '#4f78a8', '#8a5a33', '#3f8a7f', '#5a8a3f', '#6e5a4a', '#a8957e'], owl: ['#f2c38a', '#b0682a', '#3b2414'], island: { bg: '#2b1a0f', text: '#f6efe6', accent: '#f2c38a' }, radius: [16, 11] }),
    dark: tokens('dark', { bg: '#1c140e', elev: '#271c14', sunk: '#140e09', ink: '#f2dcc4', text: '#f4e6d6', text2: '#cdb59c', text3: '#a38a72', accent: '#e8a15c', danger: '#ec8b7c', ok: '#9cc786', warn: '#ecc062', shelves: ['#e597a8', '#b3a2d6', '#e8b05c', '#8fb0d6', '#c99f78', '#82c2b6', '#9cc786', '#a8957e', '#7a6855'], owl: ['#f2c38a', '#b0682a', '#1c140e'], island: { bg: '#100b07', text: '#f4e6d6', accent: '#e8a15c' }, radius: [16, 11] }),
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
