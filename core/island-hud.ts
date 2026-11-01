// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Volume and brightness feedback in the Island. Keeper shows its own small
// level beside the system's pop-up whenever the level changes (from the
// keys, a slider or another app). It does not replace the system pop-up: on
// macOS that needs private APIs, and Windows' and Linux desktops own theirs.
// Pure: decides when a change is worth showing and what it looks like.

export type HudKind = 'volume' | 'brightness' | 'mic';

export interface HudLevel {
  kind: HudKind;
  /** 0–100 */
  value: number;
  muted?: boolean;
  /** which output or display */
  device?: string;
}

export interface HudEvent extends HudLevel {
  at: number;
  /** -1 down, 0 mute/unmute or unknown, 1 up */
  direction: -1 | 0 | 1;
}

/**
 * A change from the last reading, or nothing. The first reading only sets the
 * baseline (no pop-up when Keeper starts), and tiny jitter is ignored.
 */
export function hudChange(prev: HudLevel | undefined, next: HudLevel, now = Date.now()): HudEvent | undefined {
  if (!Number.isFinite(next.value)) return undefined;
  const value = Math.max(0, Math.min(100, Math.round(next.value)));
  if (!prev) return undefined;
  const dv = value - Math.round(prev.value);
  const dm = !!next.muted !== !!prev.muted;
  if (Math.abs(dv) < 1 && !dm) return undefined;
  return { ...next, value, at: now, direction: dm ? 0 : dv > 0 ? 1 : -1 };
}

/**
 * Where readings come from, cheapest first: system events where the OS has
 * them, otherwise a short burst of readings only after a volume or brightness
 * key (or a change) was seen — never a steady poll.
 */
export function burstSchedule(sinceLastChangeMs: number): number | null {
  if (sinceLastChangeMs < 1500) return 150;
  if (sinceLastChangeMs < 4000) return 500;
  return null;
}

/** The icon for a level: speaker with waves, or a sun. */
export function hudIcon(e: Pick<HudLevel, 'kind' | 'value' | 'muted'>): string {
  if (e.kind === 'brightness') return 'sun';
  if (e.kind === 'mic') return 'mic';
  // Muted shows as the speaker struck through by the Island's styling (icons are shared with the app).
  return 'audio';
}

export function hudTitle(e: Pick<HudLevel, 'kind' | 'value' | 'muted' | 'device'>): string {
  const what = e.kind === 'brightness' ? 'Brightness' : e.kind === 'mic' ? 'Microphone' : 'Volume';
  if (e.muted) return `${what} muted`;
  return e.device ? `${what} · ${e.device}` : what;
}

/** Linux `pactl subscribe` lines about the speakers (sink) or microphones (source). */
export function pactlEventKind(line: string): 'sink' | 'source' | 'server' | null {
  const m = line.match(/Event '(change|new)' on (sink|source|server)\b(?!-)/);
  return m ? (m[2] as 'sink' | 'source' | 'server') : null;
}

/** `pactl get-sink-volume @DEFAULT_SINK@` → 0–100 (average of channels). */
export function parsePactlVolume(text: string): number | undefined {
  const all = [...text.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
  if (!all.length) return undefined;
  return Math.round(all.reduce((a, b) => a + b, 0) / all.length);
}

/** `udevadm monitor --udev --subsystem-match=backlight` lines that mean a brightness change. */
export function isBacklightEvent(line: string): boolean {
  return /\bchange\b.*\(backlight\)|\bchange\b.*\/backlight\//.test(line);
}

/** sysfs brightness and max_brightness → 0–100. */
export function backlightPercent(cur: string, max: string): number | undefined {
  const c = Number(cur.trim());
  const m = Number(max.trim());
  if (!Number.isFinite(c) || !Number.isFinite(m) || m <= 0) return undefined;
  return Math.round((c / m) * 100);
}
