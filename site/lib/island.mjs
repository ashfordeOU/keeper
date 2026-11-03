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
