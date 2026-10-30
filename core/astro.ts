// SPDX-License-Identifier: AGPL-3.0-or-later
// Sun and moon for widgets: sunrise and sunset (NOAA's simplified solar
// position) and the moon's phase, computed locally from the date.

const RAD = Math.PI / 180;
const SYNODIC = 29.530588853;
/** A known new moon: 2000-01-06 18:14 UTC. */
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

export interface MoonPhase {
  /** 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter */
  phase: number;
  /** 0..1 lit fraction */
  illumination: number;
  name: string;
  /** days since the last new moon */
  age: number;
}

const PHASE_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];

export function moonPhase(t: number): MoonPhase {
  const days = (t - NEW_MOON) / 86_400_000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const phase = age / SYNODIC;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const name = PHASE_NAMES[Math.round(phase * 8) % 8];
  return { phase, illumination, name, age };
}

export interface SunTimes {
  sunrise?: number;
  sunset?: number;
  noon: number;
  /** 'day' / 'night' when the sun never sets or never rises that day */
  polar?: 'day' | 'night';
}

/** Sunrise, solar noon and sunset (UTC ms) for the calendar day of `t` at a place. */
export function sunTimes(t: number, lat: number, lon: number): SunTimes {
  const d = new Date(t);
  const day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const doy = Math.floor((day0 - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
  const g = ((2 * Math.PI) / 365) * (doy - 1);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const noonMin = 720 - 4 * lon - eqtime;
  const cosH = (Math.cos(90.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) / (Math.cos(lat * RAD) * Math.cos(decl));
  const noon = day0 + noonMin * 60_000;
  if (cosH > 1) return { noon, polar: 'night' };
  if (cosH < -1) return { noon, polar: 'day' };
  const ha = Math.acos(cosH) / RAD;
  return { sunrise: day0 + (noonMin - 4 * ha) * 60_000, sunset: day0 + (noonMin + 4 * ha) * 60_000, noon };
}

/** A moon drawn as an SVG path for a given phase (lit part on the right while waxing). */
export function moonPath(phase: number, r = 10, cx = 12, cy = 12): string {
  const k = Math.cos(2 * Math.PI * phase); // 1 new … -1 full
  const sweepOuter = phase < 0.5 ? 1 : 0;
  const rx = Math.abs(k) * r;
  const sweepInner = (phase < 0.5) === k > 0 ? 0 : 1;
  return `M${cx} ${cy - r} A${r} ${r} 0 0 ${sweepOuter} ${cx} ${cy + r} A${rx} ${r} 0 0 ${sweepInner} ${cx} ${cy - r}Z`;
}
