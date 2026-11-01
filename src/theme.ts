// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Puts the chosen theme on the page: its tokens as CSS variables on <html>,
// plus data attributes the stylesheets key off. Every window (main, Quick
// Search, Island, widgets) runs this from the store, so they all follow along.

import { hemisphereFor, resolveMode, seasonalThemeId, themeById, themeVariables, type ThemeMode } from '../core/themes';
import type { Settings } from '../core/types';
import './styles/themes.css';

type ThemeSettings = Pick<Settings, 'theme' | 'look' | 'appearance' | 'accent' | 'font' | 'corners' | 'density' | 'themeSeasons' | 'hemisphere'> & { resourceMode?: string; island?: { place?: { lat?: number } | null } };

const dark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** The theme id to use, honouring settings saved before themes existed. */
export function currentThemeId(s: Pick<Settings, 'theme' | 'look'>): string {
  return s.theme || (s.look === 'minimal' ? 'minimal' : 'playful');
}

/** North or south for the seasons: chosen in Settings, else from the weather place, else the time zone. */
export function hemisphereOf(s: Pick<ThemeSettings, 'hemisphere' | 'island'>): 'north' | 'south' {
  if (s.hemisphere === 'north' || s.hemisphere === 'south') return s.hemisphere;
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* no time zone information */
  }
  return hemisphereFor(s.island?.place?.lat, tz);
}

/** The theme on screen: the seasonal one when "Follow the seasons" is on, else the chosen one. */
export function activeThemeId(s: Pick<ThemeSettings, 'theme' | 'look' | 'themeSeasons' | 'hemisphere' | 'island'>, now = new Date()): string {
  return s.themeSeasons ? seasonalThemeId(now, hemisphereOf(s)) : currentThemeId(s);
}

/** Calls back once just after midnight, so "Follow the seasons" changes on the right day (one timer a day, no polling). */
export function onNewDay(fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    const n = new Date();
    const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 30);
    timer = setTimeout(() => { fn(); arm(); }, next.getTime() - n.getTime());
  };
  arm();
  return () => clearTimeout(timer);
}

export function applyTheme(s: ThemeSettings, root: HTMLElement = document.documentElement): ThemeMode {
  const t = themeById(activeThemeId(s));
  const mode = resolveMode(t, s.appearance, dark());
  const vars = themeVariables(t, mode, { accent: s.accent || undefined, font: s.font, corners: s.corners });
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = mode;
  root.dataset.theme = mode;
  root.dataset.themeId = t.id;
  // The Minimal look's extra rules (monochrome toggles, code) follow the theme.
  root.dataset.look = t.id === 'minimal' ? 'minimal' : 'playful';
  root.dataset.density = s.density ?? 'comfortable';
  // Minimal resource mode drops decorative backgrounds (src/styles/themes.css).
  root.dataset.resource = s.resourceMode ?? 'balanced';
  root.dataset.corners = s.corners && s.corners !== 'theme' ? s.corners : t.corners;
  return mode;
}

/** Calls back when the system switches between light and dark. */
export function onSystemAppearance(fn: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}

const PREV = 'theme.prev';

/** The settings change that switches to a theme, remembering the one before for ⌘⇧T. */
export function themePatch(s: Pick<Settings, 'theme' | 'look'>, id: string): Partial<Settings> {
  const cur = currentThemeId(s);
  if (cur !== id) {
    try {
      localStorage.setItem(PREV, cur);
    } catch {
      /* storage unavailable */
    }
  }
  const look = id === 'minimal' ? 'minimal' : 'playful';
  // Choosing a theme by hand (gallery, palette, ⌘⇧T) stops following the seasons.
  return { theme: themeById(id).id, look, themeSeasons: false };
}

/** ⌘⇧T: back and forth between the last two themes used (Playful and Minimal to begin with). */
export function toggleThemePatch(s: Pick<Settings, 'theme' | 'look'>): Partial<Settings> {
  const cur = currentThemeId(s);
  let prev: string | null = null;
  try {
    prev = localStorage.getItem(PREV);
  } catch {
    /* storage unavailable */
  }
  const next = prev && prev !== cur && themeById(prev).id === prev ? prev : cur === 'playful' ? 'minimal' : 'playful';
  return themePatch(s, next);
}

/** Colours for charts: Playful and Minimal keep their own sets, other themes use their shelf colours. */
export function chartPalette(s: (Pick<Settings, 'theme' | 'look' | 'appearance' | 'accent'> & Partial<Pick<ThemeSettings, 'themeSeasons' | 'hemisphere' | 'island'>>) | null | undefined, playful: string[], minimal: string[]): string[] {
  if (!s) return playful;
  const t = themeById(activeThemeId(s));
  if (t.id === 'playful') return playful;
  if (t.id === 'minimal') return minimal;
  const tok = (resolveMode(t, s.appearance, dark()) === 'dark' ? t.dark : t.light) ?? t.dark ?? t.light!;
  return [s.accent || tok.accent, tok['c-image'], tok['c-video'], tok['c-audio'], tok['c-document'], tok['c-installer'], tok['c-app'], tok['c-archive'], tok['c-code']];
}
