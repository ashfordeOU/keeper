// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Try the Island": the clock and battery maths behind the mock Island on the home page.
// Pure: used by site.js in the browser and by test/site.test.ts.

/** 0:42, 3:34, 1:02:05 */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** The battery glyph's fill (0–1) and colour for a percentage. */
export function battery(percent, charging = false) {
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  return { percent: p, fill: p / 100, tone: charging ? 'charging' : p <= 10 ? 'low' : p <= 20 ? 'warn' : 'ok' };
}

/** "in 12 min", "now", "in 1 h 5 min" for a meeting `minutes` away. */
export function startsIn(minutes) {
  const m = Math.round(minutes);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `in ${h} h ${m % 60} min` : `in ${h} h`;
}

/** One tick of the mock: the song moves on (and wraps), a running timer counts down. */
export function tick(state, dt = 1) {
  const next = { ...state };
  if (state.playing) next.song = (state.song + dt) % state.length;
  if (state.timerOn) {
    next.timer = Math.max(0, state.timer - dt);
    if (next.timer === 0) next.timerOn = false;
  }
  return next;
}

/** The desk clock's hands for a time, in degrees from twelve o'clock. */
export function handAngles(date) {
  const s = date.getSeconds();
  const m = date.getMinutes() + s / 60;
  const h = (date.getHours() % 12) + m / 60;
  return { h: h * 30, m: m * 6, s: s * 6 };
}

/** What drops out of the Island now and then on the desktop: a download landing, a message, a meeting. */
export const DESK_EVENTS = [
  { kind: 'download', title: 'Downloaded', detail: 'Lisbon guide.pdf' },
  { kind: 'message', title: 'Ana Lopez', detail: 'Lunch at 1?' },
  { kind: 'meeting', title: 'Design review', detail: 'In 5 min · Room 4' },
];

/** The n-th notice, round and round. */
export const deskEvent = (n) => DESK_EVENTS[((n % DESK_EVENTS.length) + DESK_EVENTS.length) % DESK_EVENTS.length];

/** The Island's colours on the site's desktop, as in Settings → Island → Look. */
export const LOOKS = ['playful', 'ocean', 'sunset', 'berry', 'dark'];
export const lookOf = (id) => (LOOKS.includes(id) ? id : LOOKS[0]);
