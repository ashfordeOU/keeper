// SPDX-License-Identifier: AGPL-3.0-or-later
// Desktop widgets: small always-on-desktop windows showing the time, weather,
// your next events, a countdown, photos and more, each styled by the user.

export type WidgetKind =
  | 'clock' | 'date' | 'events' | 'weather' | 'countdown' | 'battery' | 'disk' | 'sun-moon'
  | 'photo' | 'text' | 'clipboard' | 'focus' | 'system';

export interface WidgetStyle {
  font: 'system' | 'rounded' | 'serif' | 'mono';
  size: number;
  color: string;
  background: 'glass' | 'solid' | 'gradient' | 'none';
  bgColor: string;
  bgColor2: string;
  radius: number;
  opacity: number;
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
  };
}

export const WIDGET_KINDS: { kind: WidgetKind; name: string; description: string; size: [number, number] }[] = [
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
];

export function defaultStyle(): WidgetStyle {
  return { font: 'system', size: 1, color: '#ffffff', background: 'glass', bgColor: '#1b1b20', bgColor2: '#6d6dff', radius: 22, opacity: 0.92 };
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
    options: kind === 'countdown' ? { title: 'New year', target: new Date(new Date(now).getFullYear() + 1, 0, 1).getTime() } : kind === 'text' ? { text: 'Keep what you love.' } : kind === 'clock' ? { analog: false, seconds: false, timeZones: [] } : kind === 'photo' ? { interval: 30 } : {},
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
    .map((w) => ({ ...w, style: { ...defaultStyle(), ...(w.style ?? {}) }, options: w.options ?? {} }));
}
