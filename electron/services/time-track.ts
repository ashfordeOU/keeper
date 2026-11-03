// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Automatic time tracking, only on this computer. While the feature is on and
// not paused, the front-window helper (fg-watch.ts, the one Cues use) reports
// each change of app and window; the browser extension says which page is in
// front. A check every 15 seconds (through the governor, so it slows down when
// nobody is there and stops while the screen is locked) ends the current span
// when the person is away. Spans are kept per day in <userData>/time/, each
// day's file gzipped and encrypted with AES-256-GCM under a key in the system
// keychain (the same sealing as Places & Tracks). Nothing leaves the computer.

import { app, dialog, BrowserWindow } from 'electron';
import crypto from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import type { TimeStatus, TimeTrackApi } from '../../core/api-time';
import {
  cleanRules, cleanSpans, dayKey, hostOf, isBrowser, keepOf, normalizeTimeTrackOptions, splitByDay, step, summarizeDay, summarizeWeek, toCsv,
  type FrontSample, type TimeRule, type TimeSpan,
} from '../../core/time-track';
import { isSealed, open, seal } from '../../core/tracks/vault';
import { getSecret, setSecret, settings } from '../store';
import { featureOn, onFeature } from './features';
import { frontWatchAvailable, frontWindow, holdFrontWatch, onFrontWindow } from './fg-watch';
import { conditions, poll } from './governor';

const FEATURE = 'timeTracking';
const KEY_NAME = 'time.dataKey';
declare const __KEEPER_OFFICIAL__: boolean | undefined;
const TESTABLE = !(typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__);

const dir = () => path.join(app.getPath('userData'), 'time');
const stateFile = () => path.join(dir(), 'state.json');
const dayFile = (day: string) => path.join(dir(), `${day}.bin`);

interface State { rules: TimeRule[]; paused: boolean; pausedUntil?: number }
let state: State = { rules: [], paused: false };
let stateLoaded = false;
let key: Buffer | undefined;
let keyChecked = false;
let note: string | undefined;
const days = new Map<string, TimeSpan[]>();
const dirty = new Set<string>();
let openSpan: TimeSpan | undefined;
let lastPage: { site?: string; at: number } | undefined;
let testSample: FrontSample | null | undefined;
let release: (() => void) | undefined;
let offFront: (() => void) | undefined;
let stopPoll: (() => void) | undefined;
let stopFlush: (() => void) | undefined;
let away = false;
let broadcast: (channel: string) => void = () => undefined;

const options = () => normalizeTimeTrackOptions(settings().timeTrack);

async function ensureKey(): Promise<Buffer | undefined> {
  if (keyChecked) return key;
  keyChecked = true;
  const have = await getSecret(KEY_NAME).catch(() => undefined);
  if (have) { key = Buffer.from(have, 'base64'); return key; }
  const fresh = crypto.randomBytes(32);
  if (await setSecret(KEY_NAME, fresh.toString('base64')).catch(() => false)) { key = fresh; return key; }
  note = 'This system has no keychain Keeper can use, so your time is stored unencrypted (but still only in your profile folder).';
  return undefined;
}

async function loadState() {
  if (stateLoaded) return;
  stateLoaded = true;
  try {
    const raw = JSON.parse(await fsp.readFile(stateFile(), 'utf8')) as Partial<State>;
    state = { rules: cleanRules(raw.rules), paused: raw.paused === true, pausedUntil: Number.isFinite(raw.pausedUntil) ? raw.pausedUntil : undefined };
  } catch { /* first use */ }
}

async function writeAtomic(file: string, data: string | Buffer) {
  await fsp.mkdir(dir(), { recursive: true, mode: 0o700 });
  await fsp.writeFile(`${file}.tmp`, data, { mode: 0o600 });
  await fsp.rename(`${file}.tmp`, file);
}

const saveState = () => writeAtomic(stateFile(), JSON.stringify(state, null, 1));

async function readDay(day: string): Promise<TimeSpan[]> {
  if (days.has(day)) return days.get(day)!;
  let spans: TimeSpan[] = [];
  try {
    const b = await fsp.readFile(dayFile(day));
    if (isSealed(b) && !(await ensureKey())) note = 'The key for your recorded time is no longer in the system keychain, so older days cannot be read.';
    else spans = cleanSpans(JSON.parse(open(b, await ensureKey())));
  } catch { /* nothing that day */ }
  days.set(day, spans);
  return spans;
}

async function flush() {
  for (const day of [...dirty]) {
    dirty.delete(day);
    const spans = days.get(day) ?? [];
    await writeAtomic(dayFile(day), seal(JSON.stringify(spans), await ensureKey())).catch(() => dirty.add(day));
  }
  // Days that stay in memory are only today and yesterday (the rest are read again when asked).
  const keep = new Set([dayKey(Date.now()), dayKey(Date.now() - 86_400_000)]);
  for (const d of days.keys()) if (!keep.has(d) && !dirty.has(d)) days.delete(d);
}

async function record(span: TimeSpan) {
  for (const piece of splitByDay(span)) {
    const day = dayKey(piece.start);
    const list = await readDay(day);
    const last = list[list.length - 1];
    // A span picked up again straight after a short break continues the last one.
    if (last && last.app === piece.app && last.title === piece.title && last.site === piece.site && piece.start - last.end < 5000) last.end = piece.end;
    else list.push(piece);
    dirty.add(day);
  }
}

function isPaused(now = Date.now()): boolean {
  if (state.paused && state.pausedUntil && state.pausedUntil <= now) { state = { ...state, paused: false, pausedUntil: undefined }; void saveState(); }
  return state.paused;
}

/** What is in front now, by the options, or nothing (away, paused, excluded). */
function sampleNow(): FrontSample | undefined {
  if (isPaused() || away) return undefined;
  if (testSample !== undefined) return keepOf(testSample ?? undefined, options());
  const w = frontWindow();
  if (!w) return undefined;
  const site = isBrowser(w.app) && lastPage && Date.now() - lastPage.at < 6 * 3600_000 ? lastPage.site : undefined;
  return keepOf({ app: w.app, title: w.title, site }, options());
}

function tick() {
  if (!release) return;
  const now = Date.now();
  const r = step(openSpan, sampleNow(), now);
  openSpan = r.open;
  if (r.closed) void record(r.closed);
  broadcast('time-changed');
}

function checkAway() {
  const c = conditions();
  const wasAway = away;
  away = c.locked || c.suspended || c.idleSec >= options().idleMinutes * 60;
  // When someone was idle, their time stopped when they last touched the computer.
  if (away && !wasAway && openSpan && c.idleSec > 0 && !c.locked) openSpan = { ...openSpan, end: Math.max(openSpan.start, Date.now() - c.idleSec * 1000) };
  if (away && !wasAway && openSpan) { const s = openSpan; openSpan = undefined; if (s.end - s.start >= 2000) void record(s); broadcast('time-changed'); return; }
  tick();
}

function start() {
  if (release) return;
  void loadState();
  release = holdFrontWatch();
  offFront = onFrontWindow(() => tick());
  stopPoll = poll('time.check', { baseMs: 15_000, pauseWhenLocked: false, idleFactor: 2, maxMs: 60_000 }, checkAway, { feature: FEATURE });
  stopFlush = poll('time.flush', { baseMs: 120_000, idleFactor: 2 }, () => flush(), { feature: FEATURE, now: false });
  void prune();
}

async function stop() {
  if (openSpan) { const s = { ...openSpan, end: Date.now() }; openSpan = undefined; if (s.end - s.start >= 2000) await record(s); }
  release?.(); offFront?.(); stopPoll?.(); stopFlush?.();
  release = offFront = stopPoll = stopFlush = undefined;
  await flush().catch(() => undefined);
}

/** Days older than "keep" are deleted (once at start, then daily with the flush). */
async function prune() {
  const limit = dayKey(Date.now() - options().keepDays * 86_400_000);
  const names = await fsp.readdir(dir()).catch(() => [] as string[]);
  for (const n of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.bin$/.exec(n);
    if (m && m[1] < limit) { await fsp.rm(path.join(dir(), n), { force: true }); days.delete(m[1]); }
  }
}

async function recordedDays(): Promise<string[]> {
  const names = await fsp.readdir(dir()).catch(() => [] as string[]);
  const out = new Set(names.map((n) => /^(\d{4}-\d{2}-\d{2})\.bin$/.exec(n)?.[1]).filter((x): x is string => !!x));
  for (const [d, s] of days) if (s.length) out.add(d);
  return [...out].sort().reverse();
}

/** The day's spans with the one in progress. */
async function spansOf(day: string): Promise<TimeSpan[]> {
  const list = [...(await readDay(day))];
  if (openSpan) for (const p of splitByDay({ ...openSpan, end: Math.max(openSpan.end, Date.now()) })) if (dayKey(p.start) === day && p.end > p.start) list.push(p);
  return list;
}

async function status(): Promise<TimeStatus> {
  await loadState();
  const on = featureOn(FEATURE);
  await ensureKey();
  return {
    recording: on && !isPaused() && !away && !!openSpan,
    paused: isPaused(),
    pausedUntil: state.pausedUntil,
    away,
    supported: frontWatchAvailable(),
    now: openSpan ? { app: openSpan.app, title: openSpan.title, site: openSpan.site, since: openSpan.start } : undefined,
    options: options(),
    rules: state.rules,
    encrypted: !!key,
    note,
    days: await recordedDays(),
  };
}

const dayList = (from: string, to: string): string[] => {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`).getTime();
  while (d.getTime() <= end && out.length < 3700) { out.push(dayKey(d.getTime())); d.setDate(d.getDate() + 1); }
  return out;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const timeTrackApi: TimeTrackApi = {
  status,
  async day(day) {
    if (!DAY_RE.test(day)) throw new Error('Not a day');
    await loadState();
    const spans = await spansOf(day);
    return { spans, summary: summarizeDay(spans, state.rules, day) };
  },
  async week(monday) {
    if (!DAY_RE.test(monday)) throw new Error('Not a day');
    await loadState();
    const list = dayList(monday, dayKey(new Date(`${monday}T12:00:00`).getTime() + 6 * 86_400_000));
    return summarizeWeek(await Promise.all(list.map(async (day) => ({ day, spans: await spansOf(day) }))), state.rules);
  },
  async setPaused(paused, minutes) {
    await loadState();
    state = { ...state, paused, pausedUntil: paused && minutes ? Date.now() + minutes * 60_000 : undefined };
    await saveState();
    tick();
    return status();
  },
  async saveRules(rules) {
    await loadState();
    state = { ...state, rules: cleanRules(rules) };
    await saveState();
    broadcast('time-changed');
    return status();
  },
  async exportCsv(from, to) {
    if (!DAY_RE.test(from) || !DAY_RE.test(to)) throw new Error('Not a day');
    await loadState();
    const spans = (await Promise.all(dayList(from, to).map(spansOf))).flat();
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const out = process.env.KEEPER_TIME_TEST && TESTABLE ? path.join(app.getPath('downloads'), `Time ${from} to ${to}.csv`)
      : (await (win ? dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `Time ${from} to ${to}.csv`), filters: [{ name: 'CSV', extensions: ['csv'] }] }) : dialog.showSaveDialog({ defaultPath: `Time ${from} to ${to}.csv` }))).filePath;
    if (!out) return { saved: false };
    await fsp.writeFile(out, toCsv(spans, state.rules));
    return { saved: true, path: out, rows: spans.length };
  },
  async removeDay(day) {
    if (!DAY_RE.test(day)) throw new Error('Not a day');
    days.delete(day);
    dirty.delete(day);
    if (openSpan && dayKey(openSpan.start) === day) openSpan = undefined;
    await fsp.rm(dayFile(day), { force: true });
    broadcast('time-changed');
    return status();
  },
  async wipe() {
    openSpan = undefined;
    days.clear();
    dirty.clear();
    if (existsSync(dir())) for (const n of await fsp.readdir(dir())) if (/\.bin(\.tmp)?$/.test(n)) await fsp.rm(path.join(dir(), n), { force: true });
    await setSecret(KEY_NAME, '').catch(() => false);
    key = undefined;
    keyChecked = false;
    note = undefined;
    broadcast('time-changed');
    return status();
  },
  async testFront(sample) {
    if (!TESTABLE || !process.env.KEEPER_TIME_TEST) return;
    testSample = sample;
    tick();
  },
};

/** The page in front of a browser (from the extension through keeper/cues.active). */
export function timePageInFront(url: string) {
  if (!release) return;
  lastPage = { site: hostOf(url), at: Date.now() };
  tick();
}

export function startTimeTracking(d: { broadcast: (channel: string) => void }) {
  broadcast = d.broadcast;
  onFeature(FEATURE, (on) => { if (on) start(); else void stop(); }, { now: true });
}

export function stopTimeTracking(): Promise<void> {
  return stop();
}
