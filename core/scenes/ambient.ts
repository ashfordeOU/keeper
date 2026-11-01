// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Ambient sounds: which exist, a mix of them, and the sleep timer. The sounds
// themselves are made on the spot with Web Audio (src/lib/ambient-audio.ts);
// there are no recordings.

export type SoundId = 'rain' | 'cafe' | 'waves' | 'stream' | 'wind' | 'fire' | 'night' | 'white' | 'pink' | 'brown';

export const SOUNDS: { id: SoundId; name: string; icon: string; description: string }[] = [
  { id: 'rain', name: 'Rain', icon: 'drop', description: 'Steady rain with soft drops close by' },
  { id: 'cafe', name: 'Café', icon: 'coffee', description: 'A murmuring room, cups and spoons' },
  { id: 'waves', name: 'Waves', icon: 'refresh', description: 'Surf rolling in and drawing back' },
  { id: 'stream', name: 'Stream', icon: 'drop', description: 'Water running over stones' },
  { id: 'wind', name: 'Wind', icon: 'cloud', description: 'Gusts that rise and fall' },
  { id: 'fire', name: 'Fire', icon: 'bolt', description: 'A low roar with crackles' },
  { id: 'night', name: 'Night', icon: 'moon', description: 'Crickets on a warm evening' },
  { id: 'white', name: 'White noise', icon: 'sparkle', description: 'Even across all pitches' },
  { id: 'pink', name: 'Pink noise', icon: 'sparkle', description: 'Softer highs, like steady rainfall' },
  { id: 'brown', name: 'Brown noise', icon: 'sparkle', description: 'Deep and rumbly' },
];

export const SOUND_IDS = SOUNDS.map((s) => s.id);

/** Levels 0..1 for each sound; missing means silent. */
export type SoundMix = Partial<Record<SoundId, number>>;

export interface SoundSettings {
  playing: boolean;
  mix: SoundMix;
  /** overall volume 0..1 */
  master: number;
  /** when the sleep timer stops the sound (ms since epoch), or null */
  sleepAt: number | null;
  /** seconds to fade in and out when starting, stopping or switching vibes */
  fadeSec: number;
}

export function defaultSound(): SoundSettings {
  return { playing: false, mix: { rain: 0.6 }, master: 0.5, sleepAt: null, fadeSec: 3 };
}

const clamp01 = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

export function normalizeMix(raw: unknown): SoundMix {
  const out: SoundMix = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of SOUND_IDS) {
    const v = clamp01((raw as Record<string, unknown>)[id]);
    if (v > 0) out[id] = Math.round(v * 100) / 100;
  }
  return out;
}

export function normalizeSound(raw: unknown): SoundSettings {
  const d = defaultSound();
  const r = (raw ?? {}) as Partial<SoundSettings>;
  return {
    playing: r.playing === true,
    mix: r.mix ? normalizeMix(r.mix) : d.mix,
    master: clamp01(r.master, d.master),
    sleepAt: typeof r.sleepAt === 'number' && r.sleepAt > 0 ? r.sleepAt : null,
    fadeSec: Math.min(30, Math.max(0, typeof r.fadeSec === 'number' ? r.fadeSec : d.fadeSec)),
  };
}

/** Is anything audible in this mix? */
export function audible(s: Pick<SoundSettings, 'playing' | 'mix' | 'master'>): boolean {
  return s.playing && s.master > 0 && Object.values(s.mix).some((v) => (v ?? 0) > 0);
}

/** Gain for one sound: its level times the master, on a perceptual (squared) curve. */
export function gainFor(level: number, master: number): number {
  const l = clamp01(level);
  const m = clamp01(master);
  return l * l * m * m;
}

/** The sleep timer: ms left, or null when none is set. During the last fade the volume goes down. */
export function sleepLeft(sleepAt: number | null, now = Date.now()): number | null {
  return sleepAt === null ? null : Math.max(0, sleepAt - now);
}

/** Volume factor 0..1 near the end of a sleep timer: a gentle fade over the last `fadeMs`. */
export function sleepFade(sleepAt: number | null, now = Date.now(), fadeMs = 60_000): number {
  const left = sleepLeft(sleepAt, now);
  if (left === null) return 1;
  if (left <= 0) return 0;
  return Math.min(1, left / fadeMs);
}

export const SLEEP_CHOICES = [15, 30, 45, 60, 90, 120];

/** A short label for the mix ("Rain + Café"). */
export function describeMix(mix: SoundMix): string {
  const on = SOUNDS.filter((s) => (mix[s.id] ?? 0) > 0).sort((a, b) => (mix[b.id] ?? 0) - (mix[a.id] ?? 0));
  if (!on.length) return 'Silence';
  return on.slice(0, 3).map((s) => s.name).join(' + ') + (on.length > 3 ? ` +${on.length - 3}` : '');
}
