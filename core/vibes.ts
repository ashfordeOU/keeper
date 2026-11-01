// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Vibes: a wallpaper, a theme, ambient sound and a widget layout switched
// together, by hand (tray, Island, palette, shortcuts) or on a schedule (time
// of day, sunrise and sunset, battery, a focus session). Everything here is
// pure; electron/services/wallpaper/ applies it.

import { sunTimes } from './astro';
import { normalizeSound, normalizeMix, type SoundMix, type SoundSettings } from './scenes/ambient';
import { normalizeSource, sceneSource, PALETTES } from './scenes/catalog';
import { normalizeIconRecords, type FolderIconRecord } from './scenes/folder-icons';
import type { NamedPalette, WallpaperSettings, WallpaperSource } from './scenes/types';
import type { WidgetConfig } from './widgets';

export interface Vibe {
  id: string;
  name: string;
  /** a single emoji shown in menus */
  emoji: string;
  /** null leaves the wallpaper as it is */
  wallpaper: WallpaperSource | null;
  /** per display (by display id); missing displays use `wallpaper` */
  perDisplay?: Record<string, WallpaperSource>;
  /** a theme id from core/themes.ts; null leaves the theme alone */
  theme: string | null;
  appearance: 'system' | 'light' | 'dark' | null;
  /** null leaves the sound alone; playing false stops it */
  sound: { playing: boolean; mix: SoundMix; master: number } | null;
  /** the desktop widgets for this vibe; null leaves them alone */
  widgets: WidgetConfig[] | null;
  /** also start a focus session of this many minutes */
  focusMinutes: number | null;
  /** came with Keeper (can be changed, and put back) */
  starter?: boolean;
}

export type RuleWhen =
  | { kind: 'time'; from: string; to: string; days: number[] }
  | { kind: 'sun'; from: 'sunrise' | 'sunset'; offsetMin: number }
  | { kind: 'battery'; below: number | null }
  | { kind: 'focus' };

export interface VibeRule {
  id: string;
  vibe: string;
  enabled: boolean;
  when: RuleWhen;
}

export interface ScheduleSettings {
  enabled: boolean;
  /** first matching rule wins */
  rules: VibeRule[];
  /** when no rule matches, switch to this vibe (null: stay) */
  fallback: string | null;
  /** where sunrise and sunset are worked out; null uses the weather place, then the manual times */
  location: { lat: number; lon: number; name?: string } | null;
  /** used when no place is known */
  manualSun: { sunrise: string; sunset: string };
}

export type Surface = 'tray' | 'island' | 'shortcuts' | 'palette';

export interface AmbienceShortcuts {
  next: string;
  previous: string;
  surprise: string;
  pause: string;
  mixer: string;
}

export interface AmbienceSettings {
  wallpaper: WallpaperSettings;
  sound: SoundSettings;
  vibes: Vibe[];
  activeVibe: string | null;
  schedule: ScheduleSettings;
  palettes: NamedPalette[];
  folderIcons: FolderIconRecord[];
  /** where vibes and the wallpaper can be picked */
  surfaces: Record<Surface, boolean>;
  shortcuts: AmbienceShortcuts;
  /** the desktop picture before Keeper first set one, to restore */
  previousDesktop: { platform: NodeJS.Platform; value: string } | null;
}

// ---------------------------------------------------------------- defaults

export function defaultWallpaper(): WallpaperSettings {
  return {
    enabled: false,
    default: sceneSource('aurora'),
    perDisplay: {},
    fps: 30,
    quality: 'balanced',
    pauseOnBattery: false,
    saveOnBattery: true,
    pauseInFullscreen: true,
    pauseOnLowPower: true,
    matchDesktopPicture: false,
    forceStill: false,
  };
}

const vibe = (id: string, name: string, emoji: string, v: Partial<Vibe>): Vibe => ({ id, name, emoji, wallpaper: null, theme: null, appearance: null, sound: null, widgets: null, focusMinutes: null, starter: true, ...v });

/** Vibes that come with Keeper. Scenes and sounds are all made in code. */
export const STARTER_VIBES: Vibe[] = [
  vibe('morning', 'Morning', '🌅', { wallpaper: sceneSource('rays', 'gold'), theme: 'playful', appearance: 'light', sound: { playing: true, mix: { stream: 0.5, night: 0 }, master: 0.4 } }),
  vibe('deep-work', 'Deep work', '🎧', { wallpaper: sceneSource('contours', 'slate', { speed: 0.5 }), theme: 'minimal', appearance: 'dark', sound: { playing: true, mix: { brown: 0.7 }, master: 0.45 }, focusMinutes: 50 }),
  vibe('cafe', 'Café', '☕', { wallpaper: sceneSource('mesh', 'peach'), sound: { playing: true, mix: { cafe: 0.7, rain: 0.25 }, master: 0.5 } }),
  vibe('rainy', 'Rainy day', '🌧️', { wallpaper: sceneSource('rain', 'slate'), appearance: 'dark', sound: { playing: true, mix: { rain: 0.8, wind: 0.2 }, master: 0.5 } }),
  vibe('seaside', 'Seaside', '🌊', { wallpaper: sceneSource('ocean', 'lagoon'), sound: { playing: true, mix: { waves: 0.8, wind: 0.15 }, master: 0.5 } }),
  vibe('evening', 'Evening', '🌙', { wallpaper: sceneSource('fireflies', 'dusk'), appearance: 'dark', sound: { playing: true, mix: { night: 0.6, fire: 0.3 }, master: 0.4 } }),
  vibe('night', 'Night sky', '🌌', { wallpaper: sceneSource('aurora', 'polar', { speed: 0.6 }), appearance: 'dark', sound: { playing: false, mix: {}, master: 0.4 } }),
  vibe('battery', 'Battery saver', '🔋', { wallpaper: sceneSource('contours', 'mono', { speed: 0.3, grain: 0 }), sound: { playing: false, mix: {}, master: 0.4 } }),
];

export function defaultSchedule(): ScheduleSettings {
  return { enabled: false, rules: [], fallback: null, location: null, manualSun: { sunrise: '07:00', sunset: '19:00' } };
}

export function defaultShortcuts(): AmbienceShortcuts {
  return { next: 'Control+Alt+CommandOrControl+Right', previous: 'Control+Alt+CommandOrControl+Left', surprise: 'Control+Alt+CommandOrControl+R', pause: 'Control+Alt+CommandOrControl+P', mixer: 'Control+Alt+CommandOrControl+M' };
}

export function defaultAmbience(): AmbienceSettings {
  return {
    wallpaper: defaultWallpaper(),
    sound: normalizeSound(undefined),
    vibes: STARTER_VIBES.map((v) => structuredClone(v)),
    activeVibe: null,
    schedule: defaultSchedule(),
    palettes: [],
    folderIcons: [],
    surfaces: { tray: true, island: true, shortcuts: false, palette: true },
    shortcuts: defaultShortcuts(),
    previousDesktop: null,
  };
}

// ---------------------------------------------------------------- reading from disk

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeWhen(raw: unknown): RuleWhen | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.kind === 'time' && HHMM.test(String(r.from)) && HHMM.test(String(r.to))) {
    const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [0, 1, 2, 3, 4, 5, 6];
    return { kind: 'time', from: String(r.from), to: String(r.to), days: days.length ? days : [0, 1, 2, 3, 4, 5, 6] };
  }
  if (r.kind === 'sun') return { kind: 'sun', from: r.from === 'sunset' ? 'sunset' : 'sunrise', offsetMin: Math.max(-240, Math.min(240, Math.round(Number(r.offsetMin) || 0))) };
  if (r.kind === 'battery') return { kind: 'battery', below: typeof r.below === 'number' && r.below > 0 && r.below <= 100 ? Math.round(r.below) : null };
  if (r.kind === 'focus') return { kind: 'focus' };
  return null;
}

export function normalizeVibe(raw: unknown): Vibe | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  const snd = r.sound as Record<string, unknown> | null | undefined;
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : 'Vibe',
    emoji: typeof r.emoji === 'string' && r.emoji ? [...r.emoji].slice(0, 2).join('') : '✨',
    wallpaper: r.wallpaper ? normalizeSource(r.wallpaper) : null,
    perDisplay: r.perDisplay && typeof r.perDisplay === 'object' ? Object.fromEntries(Object.entries(r.perDisplay as Record<string, unknown>).map(([k, v]) => [k, normalizeSource(v)])) : undefined,
    theme: typeof r.theme === 'string' && r.theme ? r.theme : null,
    appearance: ['system', 'light', 'dark'].includes(r.appearance as string) ? r.appearance as Vibe['appearance'] : null,
    sound: snd && typeof snd === 'object' ? { playing: snd.playing !== false, mix: normalizeMix(snd.mix), master: typeof snd.master === 'number' ? Math.min(1, Math.max(0, snd.master)) : 0.5 } : null,
    widgets: Array.isArray(r.widgets) ? r.widgets as WidgetConfig[] : null,
    focusMinutes: typeof r.focusMinutes === 'number' && r.focusMinutes > 0 ? Math.min(240, Math.round(r.focusMinutes)) : null,
    starter: r.starter === true,
  };
}

export function normalizeAmbience(raw: unknown): AmbienceSettings {
  const d = defaultAmbience();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const w = (r.wallpaper ?? {}) as Partial<WallpaperSettings>;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const wallpaper: WallpaperSettings = {
    enabled: bool(w.enabled, d.wallpaper.enabled),
    default: w.default ? normalizeSource(w.default) : d.wallpaper.default,
    perDisplay: w.perDisplay && typeof w.perDisplay === 'object' ? Object.fromEntries(Object.entries(w.perDisplay).map(([k, v]) => [k, normalizeSource(v)])) : {},
    fps: ([15, 24, 30, 60] as const).includes(w.fps as 30) ? w.fps as 30 : d.wallpaper.fps,
    quality: (['efficient', 'balanced', 'full'] as const).includes(w.quality as 'full') ? w.quality as 'full' : d.wallpaper.quality,
    pauseOnBattery: bool(w.pauseOnBattery, d.wallpaper.pauseOnBattery),
    saveOnBattery: bool(w.saveOnBattery, d.wallpaper.saveOnBattery),
    pauseInFullscreen: bool(w.pauseInFullscreen, d.wallpaper.pauseInFullscreen),
    pauseOnLowPower: bool(w.pauseOnLowPower, d.wallpaper.pauseOnLowPower),
    matchDesktopPicture: bool(w.matchDesktopPicture, d.wallpaper.matchDesktopPicture),
    forceStill: bool(w.forceStill, d.wallpaper.forceStill),
  };
  const vibes = Array.isArray(r.vibes) ? r.vibes.map(normalizeVibe).filter((v): v is Vibe => !!v) : d.vibes;
  const s = (r.schedule ?? {}) as Partial<ScheduleSettings>;
  const ids = new Set(vibes.map((v) => v.id));
  const loc = s.location && typeof s.location === 'object' && Number.isFinite(s.location.lat) && Number.isFinite(s.location.lon) ? { lat: s.location.lat, lon: s.location.lon, name: s.location.name } : null;
  const schedule: ScheduleSettings = {
    enabled: s.enabled === true,
    rules: Array.isArray(s.rules) ? s.rules.map((x) => {
      const when = normalizeWhen((x as VibeRule)?.when);
      const id = typeof (x as VibeRule)?.id === 'string' ? (x as VibeRule).id : '';
      return when && id && ids.has((x as VibeRule).vibe) ? { id, vibe: (x as VibeRule).vibe, enabled: (x as VibeRule).enabled !== false, when } : null;
    }).filter((x): x is VibeRule => !!x) : [],
    fallback: typeof s.fallback === 'string' && ids.has(s.fallback) ? s.fallback : null,
    location: loc,
    manualSun: { sunrise: HHMM.test(s.manualSun?.sunrise ?? '') ? s.manualSun!.sunrise : '07:00', sunset: HHMM.test(s.manualSun?.sunset ?? '') ? s.manualSun!.sunset : '19:00' },
  };
  const surf = (r.surfaces ?? {}) as Partial<Record<Surface, boolean>>;
  const sc = (r.shortcuts ?? {}) as Partial<AmbienceShortcuts>;
  const prev = r.previousDesktop as AmbienceSettings['previousDesktop'];
  return {
    wallpaper,
    sound: normalizeSound(r.sound),
    vibes,
    activeVibe: typeof r.activeVibe === 'string' && ids.has(r.activeVibe) ? r.activeVibe : null,
    schedule,
    palettes: Array.isArray(r.palettes) ? (r.palettes as NamedPalette[]).filter((p) => p && typeof p.id === 'string' && Array.isArray(p.colors) && p.colors.length === 4 && !PALETTES.some((b) => b.id === p.id)).map((p) => ({ ...p, custom: true })) : [],
    folderIcons: normalizeIconRecords(r.folderIcons),
    surfaces: { tray: bool(surf.tray, true), island: bool(surf.island, true), shortcuts: bool(surf.shortcuts, false), palette: bool(surf.palette, true) },
    shortcuts: { ...d.shortcuts, ...Object.fromEntries(Object.entries(sc).filter(([, v]) => typeof v === 'string')) },
    previousDesktop: prev && typeof prev.value === 'string' ? prev : null,
  };
}

// ---------------------------------------------------------------- switching

/** The vibe after (or before) the active one, wrapping round. */
export function stepVibe(vibes: Vibe[], active: string | null, dir: 1 | -1): Vibe | null {
  if (!vibes.length) return null;
  const i = vibes.findIndex((v) => v.id === active);
  if (i < 0) return dir === 1 ? vibes[0] : vibes[vibes.length - 1];
  return vibes[(i + dir + vibes.length) % vibes.length];
}

/** The wallpaper a display shows: its own choice, else the default. */
export function wallpaperFor(w: Pick<WallpaperSettings, 'default' | 'perDisplay'>, displayId: string | number): WallpaperSource {
  return w.perDisplay[String(displayId)] ?? w.default;
}

/** The wallpaper settings after switching to a vibe (a vibe without a wallpaper changes nothing). */
export function applyVibeWallpaper(w: WallpaperSettings, v: Vibe): WallpaperSettings {
  if (!v.wallpaper && !v.perDisplay) return w;
  return { ...w, default: v.wallpaper ?? w.default, perDisplay: v.perDisplay ? { ...v.perDisplay } : {} };
}

/** The sound after switching to a vibe (keeps the sleep timer). */
export function applyVibeSound(s: SoundSettings, v: Vibe): SoundSettings {
  if (!v.sound) return s;
  return { ...s, playing: v.sound.playing, mix: { ...v.sound.mix }, master: v.sound.master };
}

let counter = 0;
export function newId(prefix: string, now = Date.now()): string {
  return `${prefix}${now.toString(36)}${(counter++ % 1296).toString(36).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- the schedule

export interface ScheduleContext {
  now: number;
  /** where the sun is worked out (from the settings, else the weather place) */
  place: { lat: number; lon: number } | null;
  manualSun: { sunrise: string; sunset: string };
  onBattery: boolean;
  batteryPercent: number | null;
  focusActive: boolean;
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function localAt(now: number, dayOffset: number, minutes: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, Math.floor(minutes / 60), minutes % 60).getTime();
}

/** Sunrise and sunset events around now (yesterday, today, tomorrow), from the place or the manual times. */
export function sunEvents(ctx: Pick<ScheduleContext, 'now' | 'place' | 'manualSun'>): { type: 'sunrise' | 'sunset'; t: number; polar?: 'day' | 'night' }[] {
  const out: { type: 'sunrise' | 'sunset'; t: number; polar?: 'day' | 'night' }[] = [];
  for (const off of [-1, 0, 1]) {
    if (ctx.place) {
      const st = sunTimes(ctx.now + off * 86_400_000, ctx.place.lat, ctx.place.lon);
      if (st.polar) {
        // Midnight sun or polar night: one event at the start of the day says which it is.
        out.push({ type: st.polar === 'day' ? 'sunrise' : 'sunset', t: localAt(ctx.now, off, 0), polar: st.polar });
        continue;
      }
      if (st.sunrise) out.push({ type: 'sunrise', t: st.sunrise });
      if (st.sunset) out.push({ type: 'sunset', t: st.sunset });
    } else {
      out.push({ type: 'sunrise', t: localAt(ctx.now, off, minutesOf(ctx.manualSun.sunrise)) });
      out.push({ type: 'sunset', t: localAt(ctx.now, off, minutesOf(ctx.manualSun.sunset)) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Whether a rule applies now, and a key for the stretch of time it applies in.
 * The key changes at each boundary, so a vibe chosen by hand holds until the
 * next boundary, and the schedule takes over again after it.
 */
export function ruleMatch(rule: VibeRule, ctx: ScheduleContext): { on: boolean; key: string } {
  const w = rule.when;
  if (w.kind === 'time') {
    const from = minutesOf(w.from);
    const to = minutesOf(w.to);
    for (const off of [0, -1]) {
      const start = localAt(ctx.now, off, from);
      let end = localAt(ctx.now, off, to);
      if (end <= start) end = localAt(ctx.now, off + 1, to);
      if (ctx.now >= start && ctx.now < end && w.days.includes(new Date(start).getDay())) return { on: true, key: `${rule.id}@${start}` };
    }
    return { on: false, key: '' };
  }
  if (w.kind === 'sun') {
    const ev = sunEvents(ctx).map((e) => ({ ...e, t: e.type === w.from && !e.polar ? e.t + w.offsetMin * 60_000 : e.t })).sort((a, b) => a.t - b.t);
    const last = [...ev].reverse().find((e) => e.t <= ctx.now);
    return last && last.type === w.from ? { on: true, key: `${rule.id}@${last.t}` } : { on: false, key: '' };
  }
  if (w.kind === 'battery') {
    const on = ctx.onBattery && (w.below === null || (ctx.batteryPercent !== null && ctx.batteryPercent <= w.below));
    return { on, key: on ? rule.id : '' };
  }
  return { on: ctx.focusActive, key: ctx.focusActive ? rule.id : '' };
}

/** The first enabled rule that applies now (rules are in priority order). */
export function scheduledVibe(s: Pick<ScheduleSettings, 'rules' | 'fallback'>, ctx: ScheduleContext): { vibe: string | null; key: string; rule: VibeRule | null } {
  for (const r of s.rules) {
    if (!r.enabled) continue;
    const m = ruleMatch(r, ctx);
    if (m.on) return { vibe: r.vibe, key: m.key, rule: r };
  }
  return { vibe: s.fallback, key: s.fallback ? `fallback:${s.fallback}` : 'none', rule: null };
}

/** What to do now: switch only when the stretch changed since the last look (so manual choices hold). */
export function scheduleStep(s: ScheduleSettings, ctx: ScheduleContext, lastKey: string | null): { switchTo: string | null; key: string } {
  if (!s.enabled) return { switchTo: null, key: lastKey ?? 'none' };
  const r = scheduledVibe(s, ctx);
  if (r.key === lastKey) return { switchTo: null, key: r.key };
  return { switchTo: r.vibe, key: r.key };
}

/** Ready-made schedules. */
export function presetRules(id: 'day-night' | 'work-week' | 'battery', vibes: Vibe[]): VibeRule[] {
  const has = (v: string) => vibes.some((x) => x.id === v);
  const pick = (...ids: string[]) => ids.find(has) ?? vibes[0]?.id ?? '';
  if (id === 'day-night') return [
    { id: newId('r'), vibe: pick('morning'), enabled: true, when: { kind: 'sun', from: 'sunrise', offsetMin: 0 } },
    { id: newId('r'), vibe: pick('evening', 'night'), enabled: true, when: { kind: 'sun', from: 'sunset', offsetMin: 0 } },
  ];
  if (id === 'work-week') return [
    { id: newId('r'), vibe: pick('deep-work'), enabled: true, when: { kind: 'time', from: '09:00', to: '17:30', days: [1, 2, 3, 4, 5] } },
    { id: newId('r'), vibe: pick('evening'), enabled: true, when: { kind: 'time', from: '17:30', to: '23:00', days: [0, 1, 2, 3, 4, 5, 6] } },
  ];
  return [{ id: newId('r'), vibe: pick('battery'), enabled: true, when: { kind: 'battery', below: null } }];
}

export function describeRule(r: VibeRule, vibes: Vibe[]): string {
  const name = vibes.find((v) => v.id === r.vibe)?.name ?? r.vibe;
  const w = r.when;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (w.kind === 'time') {
    const days = w.days.length === 7 ? 'every day' : w.days.join(',') === '1,2,3,4,5' ? 'weekdays' : w.days.join(',') === '0,6' ? 'weekends' : w.days.map((d) => DAYS[d]).join(' ');
    return `${name} · ${w.from}–${w.to}, ${days}`;
  }
  if (w.kind === 'sun') {
    const off = w.offsetMin ? ` ${w.offsetMin > 0 ? '+' : '−'}${Math.abs(w.offsetMin)} min` : '';
    return `${name} · from ${w.from}${off} until ${w.from === 'sunrise' ? 'sunset' : 'sunrise'}`;
  }
  if (w.kind === 'battery') return `${name} · on battery${w.below ? ` below ${w.below}%` : ''}`;
  return `${name} · during a focus session`;
}
