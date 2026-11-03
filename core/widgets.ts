// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Desktop widgets: small always-on-desktop windows showing the time, weather,
// your next events, a countdown, photos and more, each styled by the user.

import { cleanMinutes } from './widget-timer';
import { cleanWork, zoneLabel, type WorkHours } from './widget-world';

export type WidgetKind =
  | 'clock' | 'date' | 'events' | 'weather' | 'countdown' | 'battery' | 'disk' | 'sun-moon'
  | 'photo' | 'text' | 'clipboard' | 'focus' | 'system'
  | 'day' | 'year' | 'season' | 'world' | 'quote'
  | 'week' | 'timer' | 'forecast'
  | 'mail-unread' | 'mail-inbox' | 'mail-accounts';

export type WidgetShape = 'card' | 'circle' | 'pill' | 'none';
export type WidgetSizePreset = 'S' | 'M' | 'L';

export interface WidgetStyle {
  font: 'system' | 'rounded' | 'serif' | 'mono';
  size: number;
  color: string;
  /** tinted: a glass card coloured by the wallpaper's palette or the theme's accent */
  background: 'glass' | 'solid' | 'gradient' | 'tinted' | 'none';
  bgColor: string;
  bgColor2: string;
  radius: number;
  opacity: number;
  /** card (rounded corners from `radius`), circle, pill or no shape at all */
  shape?: WidgetShape;
}

export interface WidgetConfig {
  id: string;
  kind: WidgetKind;
  /** position and size on screen, remembered between launches */
  bounds: { x: number; y: number; width: number; height: number };
  locked: boolean;
  allWorkspaces: boolean;
  style: WidgetStyle;
  options: {
    /** clock: analog or digital, seconds, extra time zones */
    analog?: boolean;
    seconds?: boolean;
    timeZones?: string[];
    /** countdown */
    title?: string;
    target?: number;
    /** photo widget folder and how often to change (seconds) */
    folder?: string;
    interval?: number;
    /** text widget */
    text?: string;
    /** disk widget mount point */
    mount?: string;
    /** quote widget: the person's own lines (one per entry); empty uses the built-in ones */
    quotes?: string[];
    /** world clock: up to six places, each with its working hours (minutes after midnight there; 9:00–18:00 when absent) */
    places?: WorldPlace[];
    /** timer: the chosen minutes, and the running countdown timer it started */
    minutes?: number;
    timerId?: string;
  };
}

export interface WorldPlace { label: string; zone: string; work?: WorkHours }

export const WIDGET_KINDS: { kind: WidgetKind; name: string; description: string; size: [number, number]; presets?: Record<WidgetSizePreset, [number, number]> }[] = [
  { kind: 'clock', name: 'Clock', description: 'Analog or digital, with other time zones', size: [220, 220] },
  { kind: 'date', name: 'Calendar', description: 'Today and the month at a glance', size: [240, 240] },
  { kind: 'events', name: 'Up next', description: 'Your next events from the calendar link', size: [280, 200] },
  { kind: 'weather', name: 'Weather', description: 'Now, today and the next hours', size: [300, 180] },
  { kind: 'countdown', name: 'Countdown', description: 'Days until something that matters', size: [240, 150] },
  { kind: 'sun-moon', name: 'Sun & moon', description: 'Sunrise, sunset and the moon’s phase', size: [260, 160] },
  { kind: 'photo', name: 'Photo', description: 'Rotating photos from a folder', size: [300, 220] },
  { kind: 'text', name: 'Note', description: 'A quote, reminder or anything you like', size: [260, 140] },
  { kind: 'battery', name: 'Battery', description: 'Charge and devices', size: [200, 140] },
  { kind: 'disk', name: 'Disk space', description: 'Free space on a drive', size: [220, 140] },
  { kind: 'system', name: 'System', description: 'Processor and memory', size: [240, 150] },
  { kind: 'focus', name: 'Focus', description: 'Focus timer at a glance', size: [200, 160] },
  { kind: 'clipboard', name: 'Last copied', description: 'What you copied most recently', size: [280, 140] },
  { kind: 'day', name: 'Day', description: 'The weekday, big and bold', size: [260, 130] },
  { kind: 'year', name: 'Year progress', description: 'How much of the year, month and day has gone', size: [260, 150] },
  { kind: 'season', name: 'Season', description: 'The season, and days until the next one', size: [240, 150] },
  { kind: 'world', name: 'World clock', description: 'Cities, their working hours and when they overlap', size: [540, 280], presets: { S: [320, 210], M: [540, 280], L: [680, 350] } },
  { kind: 'quote', name: 'Quote', description: 'A new line to think about every day', size: [300, 150] },
  { kind: 'week', name: 'Week', description: 'Seven days of events and tasks; add one in a click', size: [780, 320], presets: { S: [620, 260], M: [780, 320], L: [980, 420] } },
  { kind: 'timer', name: 'Timer', description: 'A countdown ring with 5, 10, 15 and 25 minutes', size: [230, 280], presets: { S: [190, 240], M: [230, 280], L: [290, 350] } },
  { kind: 'mail-unread', name: 'Unread mail', description: 'How much unread mail is waiting', size: [170, 150] },
  { kind: 'mail-inbox', name: 'Inbox', description: 'Your newest Important mail; click one to read it', size: [340, 230], presets: { S: [300, 200], M: [340, 230], L: [380, 380] } },
  { kind: 'mail-accounts', name: 'Mail accounts', description: 'Each account and its unread mail', size: [280, 190], presets: { S: [200, 170], M: [280, 190], L: [320, 260] } },
  { kind: 'forecast', name: '7-day forecast', description: 'Highs, lows and rain by part of the day', size: [780, 300], presets: { S: [620, 270], M: [780, 300], L: [960, 370] } },
];

/** S, M and L as a multiple of a kind's natural size. */
export const SIZE_PRESETS: Record<WidgetSizePreset, number> = { S: 0.75, M: 1, L: 1.4 };

/** Bounds for a size preset; circles are square. */
export function presetBounds(kind: WidgetKind, preset: WidgetSizePreset, at: { x: number; y: number }, shape: WidgetShape = 'card') {
  const def = WIDGET_KINDS.find((k) => k.kind === kind) ?? WIDGET_KINDS[0];
  const f = SIZE_PRESETS[preset];
  let w = def.presets ? def.presets[preset][0] : Math.round(def.size[0] * f);
  let h = def.presets ? def.presets[preset][1] : Math.round(def.size[1] * f);
  if (shape === 'circle') w = h = Math.max(w, h);
  if (shape === 'pill') h = Math.min(h, Math.round(w / 2.2));
  return { x: Math.round(at.x), y: Math.round(at.y), width: w, height: h };
}

/** CSS border radius for a shape. */
export function shapeRadius(style: Pick<WidgetStyle, 'shape' | 'radius'>, bounds: { width: number; height: number }): number | string {
  switch (style.shape) {
    case 'circle': return '50%';
    case 'pill': return Math.round(Math.min(bounds.width, bounds.height) / 2);
    case 'none': return 0;
    default: return style.radius;
  }
}

// Lines written for Keeper, plus sayings long out of copyright.
export const QUOTES: string[] = [
  'Small steps, every day.',
  'Do the next right thing.',
  'Rest is part of the work.',
  'Make it simple, then make it good.',
  'Well begun is half done.',
  'The best time to start was earlier. The next best time is now.',
  'Attention is the rarest gift.',
  'Slow is smooth, smooth is fast.',
  'Leave it better than you found it.',
  'Finish what matters; let the rest wait.',
  'Curiosity first, conclusions later.',
  'A clear desk, a clear head.',
  'Little by little, a little becomes a lot.',
  'Measure twice, cut once.',
];

/** The day's quote: the same all day, a different one tomorrow. */
export function quoteOfDay(now: number, own?: string[]): string {
  const list = own?.filter((q) => q.trim()) ?? [];
  const pool = list.length ? list : QUOTES;
  const d = new Date(now);
  const day = Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
  return pool[((day % pool.length) + pool.length) % pool.length];
}

/** How far through the year, month and day we are (0..1). */
export function yearProgress(now: number): { year: number; month: number; day: number; dayOfYear: number; daysInYear: number } {
  const d = new Date(now);
  const y0 = new Date(d.getFullYear(), 0, 1).getTime();
  const y1 = new Date(d.getFullYear() + 1, 0, 1).getTime();
  const m0 = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const m1 = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysInYear = Math.round((y1 - y0) / 86_400_000);
  return { year: (now - y0) / (y1 - y0), month: (now - m0) / (m1 - m0), day: (now - d0) / 86_400_000, dayOfYear: Math.floor((d0 - y0) / 86_400_000) + 1, daysInYear };
}

export type AstroSeason = 'spring' | 'summer' | 'autumn' | 'winter';

/** The astronomical season (equinoxes and solstices, approximate dates) and days until the next. */
export function seasonInfo(now: number, hemisphere: 'north' | 'south' = 'north'): { season: AstroSeason; next: AstroSeason; daysLeft: number; progress: number } {
  const d = new Date(now);
  const y = d.getFullYear();
  const marks = (yr: number) => [
    { t: new Date(yr, 2, 20).getTime(), n: 'spring' as const },
    { t: new Date(yr, 5, 21).getTime(), n: 'summer' as const },
    { t: new Date(yr, 8, 22).getTime(), n: 'autumn' as const },
    { t: new Date(yr, 11, 21).getTime(), n: 'winter' as const },
  ];
  const all = [...marks(y - 1), ...marks(y), ...marks(y + 1)];
  let i = all.length - 1;
  while (i > 0 && all[i].t > now) i--;
  const cur = all[i];
  const nxt = all[i + 1];
  const flip: Record<AstroSeason, AstroSeason> = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' };
  const f = (s: AstroSeason) => (hemisphere === 'south' ? flip[s] : s);
  return { season: f(cur.n), next: f(nxt.n), daysLeft: Math.ceil((nxt.t - now) / 86_400_000), progress: (now - cur.t) / (nxt.t - cur.t) };
}

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Arrange mode: a dragged widget snaps to the screen's edges (with a margin),
 * its centre lines, and the edges of other widgets when within `threshold` px,
 * with a gap between neighbours.
 */
export function snapBounds(b: Rect, others: Rect[], area: Rect, threshold = 14, gap = 12, margin = 16): Rect {
  const xs: number[] = [area.x + margin, area.x + area.width - margin - b.width, Math.round(area.x + (area.width - b.width) / 2)];
  const ys: number[] = [area.y + margin, area.y + area.height - margin - b.height, Math.round(area.y + (area.height - b.height) / 2)];
  for (const o of others) {
    xs.push(o.x, o.x + o.width - b.width, o.x + o.width + gap, o.x - gap - b.width);
    ys.push(o.y, o.y + o.height - b.height, o.y + o.height + gap, o.y - gap - b.height);
  }
  const near = (v: number, list: number[]) => {
    let best = v;
    let bd = threshold + 1;
    for (const c of list) { const d = Math.abs(c - v); if (d < bd) { bd = d; best = c; } }
    return bd <= threshold ? best : v;
  };
  const x = Math.min(Math.max(near(b.x, xs), area.x), area.x + area.width - b.width);
  const y = Math.min(Math.max(near(b.y, ys), area.y), area.y + area.height - b.height);
  return { ...b, x: Math.round(x), y: Math.round(y) };
}

export const DEFAULT_WORLD: WorldPlace[] = [
  { label: 'San Francisco', zone: 'America/Los_Angeles' }, { label: 'New York', zone: 'America/New_York' }, { label: 'London', zone: 'Europe/London' }, { label: 'Tokyo', zone: 'Asia/Tokyo' },
];

export function defaultStyle(): WidgetStyle {
  return { font: 'system', size: 1, color: '#ffffff', background: 'glass', bgColor: '#1b1b20', bgColor2: '#6d6dff', radius: 22, opacity: 0.92, shape: 'card' };
}

export function newWidget(kind: WidgetKind, at: { x: number; y: number }, now = Date.now()): WidgetConfig {
  const def = WIDGET_KINDS.find((k) => k.kind === kind) ?? WIDGET_KINDS[0];
  return {
    id: `w${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    kind,
    bounds: { x: Math.round(at.x), y: Math.round(at.y), width: def.size[0], height: def.size[1] },
    locked: false,
    allWorkspaces: true,
    style: defaultStyle(),
    options: kind === 'countdown' ? { title: 'New year', target: new Date(new Date(now).getFullYear() + 1, 0, 1).getTime() } : kind === 'text' ? { text: 'Keep what you love.' } : kind === 'clock' ? { analog: false, seconds: false, timeZones: [] } : kind === 'photo' ? { interval: 30 } : kind === 'world' ? { places: DEFAULT_WORLD } : kind === 'timer' ? { minutes: 25 } : {},
  };
}

/** Whole days, hours and minutes left until a moment (zero when it has passed). */
export function countdownParts(target: number, now = Date.now()): { days: number; hours: number; minutes: number; past: boolean } {
  const ms = target - now;
  const abs = Math.max(0, ms);
  return { days: Math.floor(abs / 86_400_000), hours: Math.floor((abs % 86_400_000) / 3_600_000), minutes: Math.floor((abs % 3_600_000) / 60_000), past: ms <= 0 };
}

/** Repairs widgets read from settings. */
export function normalizeWidgets(raw: unknown): WidgetConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is WidgetConfig => !!w && typeof w.id === 'string' && WIDGET_KINDS.some((k) => k.kind === w.kind) && !!w.bounds)
    .map((w) => ({ ...w, style: { ...defaultStyle(), ...(w.style ?? {}) }, options: cleanOptions(w.kind, w.options ?? {}) }));
}

/** Options read from settings: world places with a label and clean working hours, timers whole minutes. */
function cleanOptions(kind: WidgetKind, o: WidgetConfig['options']): WidgetConfig['options'] {
  if (kind === 'world' && Array.isArray(o.places)) {
    return { ...o, places: o.places.filter((p) => p && typeof p.zone === 'string').map((p) => ({ label: String(p.label ?? zoneLabel(p.zone)), zone: p.zone, ...(p.work ? { work: cleanWork(p.work) } : {}) })) };
  }
  if (kind === 'timer') return { ...o, minutes: cleanMinutes(o.minutes) };
  return o;
}

/** A dark text colour (a light card): parts drawn in colour switch to their darker shades. */
export function inkIsDark(color: string): boolean {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return false;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}
