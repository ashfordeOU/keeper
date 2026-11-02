// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What Studio lays over the picture or writes beside it: captions (and .srt
// files), chapters from the apps used, keyboard-shortcut badges, and finding
// things on screen that should be blurred (email addresses, keys, tokens).

import { keyLabel } from '../stage/overlay';
import { srcToOut } from './timeline';
import type { BlurBox, Caption, Chapter, Clip, EventLog } from './types';
import { newId } from './types';

// ------------------------------------------------------------------ captions

/** Speech segments (seconds, in the microphone track's time) to captions in the recording's time, split to readable lengths. */
export function captionsFrom(segments: { start: number; end: number; text: string }[], trackOffsetMs: number, maxChars = 64): Caption[] {
  const out: Caption[] = [];
  for (const s of segments) {
    const text = s.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = s.start * 1000 + trackOffsetMs, end = s.end * 1000 + trackOffsetMs;
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) lines.push(cur);
    const total = lines.reduce((n, l) => n + l.length, 0);
    let t = start;
    for (const l of lines) {
      const len = ((end - start) * l.length) / total;
      out.push({ start: Math.round(t), end: Math.round(t + len), text: l });
      t += len;
    }
  }
  return out;
}

export function captionAt(caps: Caption[], t: number): Caption | null {
  for (const c of caps) if (t >= c.start && t < c.end) return c;
  return null;
}

const srtTime = (ms: number) => {
  const v = Math.max(0, Math.round(ms));
  const h = Math.floor(v / 3600000), m = Math.floor((v % 3600000) / 60000), s = Math.floor((v % 60000) / 1000), x = v % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x).padStart(3, '0')}`;
};

/** Captions moved onto the finished video's time: cut parts drop out, sped-up parts shrink. */
export function captionsOnOutput(caps: Caption[], clips: Clip[]): Caption[] {
  const out: Caption[] = [];
  for (const c of caps) {
    // the kept pieces of this caption
    for (const k of clips) {
      const s = Math.max(c.start, k.start), e = Math.min(c.end, k.end);
      if (e - s < 120) continue;
      const a = srcToOut(clips, s), b = srcToOut(clips, e);
      if (a !== null && b !== null) out.push({ start: a, end: b, text: c.text });
    }
  }
  return out;
}

export function toSrt(caps: Caption[]): string {
  return caps.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

// ------------------------------------------------------------------ chapters

/** Chapters where the app in front changes and stays a while. */
export function chaptersFrom(ev: EventLog, duration: number, minMs = 4000): Chapter[] {
  const out: Chapter[] = [];
  const f = ev.focus.filter((x) => x.app);
  for (let i = 0; i < f.length; i++) {
    const until = i + 1 < f.length ? f[i + 1].t : duration;
    if (until - f[i].t < minMs) continue;
    if (out.length && out[out.length - 1].title === f[i].app) continue;
    out.push({ t: out.length ? f[i].t : 0, title: f[i].app });
  }
  return out;
}

/** Chapters on the finished video's time (dropping ones that were cut). */
export function chaptersOnOutput(ch: Chapter[], clips: Clip[]): Chapter[] {
  const out: Chapter[] = [];
  for (const c of ch) {
    let o = srcToOut(clips, c.t);
    if (o === null) { const k = clips.find((x) => x.start > c.t); o = k ? srcToOut(clips, k.start) : null; }
    if (o !== null && !out.some((x) => Math.abs(x.t - o!) < 1000)) out.push({ t: o, title: c.title });
  }
  return out;
}

/** "0:00 Intro" lines, the way video sites read chapters from a description. */
export function chapterList(ch: Chapter[]): string {
  return ch.map((c) => { const s = Math.floor(c.t / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} ${c.title}`; }).join('\n');
}

/** An ffmpeg metadata file with chapters, for MP4 and WebM. */
export function ffmetadata(ch: Chapter[], duration: number, title?: string): string {
  const esc = (s: string) => s.replace(/([=;#\\\n])/g, '\\$1');
  let s = ';FFMETADATA1\n' + (title ? `title=${esc(title)}\n` : '');
  ch.forEach((c, i) => {
    const end = i + 1 < ch.length ? ch[i + 1].t : duration;
    s += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.t)}\nEND=${Math.round(end)}\ntitle=${esc(c.title)}\n`;
  });
  return s;
}

// ------------------------------------------------------------------ keyboard shortcuts

export interface Badge { start: number; end: number; label: string; count: number }

export const BADGE_MS = 1300;

/** Badges for shortcuts (and, unless `shortcutsOnly`, typed keys) from the key log. */
export function keyBadges(ev: EventLog, mac: boolean, shortcutsOnly: boolean): Badge[] {
  const out: Badge[] = [];
  for (const k of ev.keys) {
    const shortcut = k.mods.some((m) => m !== 'shift') || /^(Escape|Tab|F\d+)$/.test(k.key);
    if (shortcutsOnly && !shortcut) continue;
    const label = keyLabel({ key: k.key, mods: k.mods }, mac);
    const prev = out[out.length - 1];
    if (prev && prev.label === label && k.t - prev.start < BADGE_MS + 600 * prev.count) { prev.count++; prev.end = k.t + BADGE_MS; continue; }
    if (prev && prev.end > k.t) prev.end = k.t;
    out.push({ start: k.t, end: k.t + BADGE_MS, label, count: 1 });
  }
  return out;
}

export function badgeAt(b: Badge[], t: number): (Badge & { k: number }) | null {
  for (const x of b) if (t >= x.start && t < x.end) return { ...x, k: Math.min(1, (t - x.start) / 140, (x.end - t) / 220) };
  return null;
}

// ------------------------------------------------------------------ privacy

export type SensitiveKind = 'email' | 'key' | 'token' | 'card' | 'phone';

const PATTERNS: [SensitiveKind, RegExp][] = [
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  // well-known key shapes: cloud, code hosts, chat and payment services, private keys
  ['key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b|\bxox[abpr]-[A-Za-z0-9-]{10,}\b|\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bAIza[0-9A-Za-z_-]{35}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['token', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\b[a-f0-9]{32,}\b|\b(?=[A-Za-z0-9+/_-]{32,}\b)(?=[^\s]*\d)(?=[^\s]*[a-z])(?=[^\s]*[A-Z])[A-Za-z0-9+/_-]{32,}={0,2}/g],
  ['card', /\b(?:\d[ -]?){13,19}\b/g],
  ['phone', /(?:\+\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g],
];

function luhn(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = +digits[i];
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}

/** Things in a line of text that should not be seen: where they are and what they look like. */
export function findSensitive(text: string): { start: number; end: number; kind: SensitiveKind }[] {
  const out: { start: number; end: number; kind: SensitiveKind }[] = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0, end = start + m[0].length;
      if (kind === 'card') { const d = m[0].replace(/\D/g, ''); if (d.length < 13 || !luhn(d)) continue; }
      if (out.some((o) => start < o.end && end > o.start)) continue;
      out.push({ start, end, kind });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface OcrLine { text: string; x0: number; y0: number; x1: number; y1: number }

/** Boxes (0–1) over the sensitive parts of recognised lines, assuming even letter widths. */
export function sensitiveBoxes(lines: OcrLine[], size: { width: number; height: number }): { x: number; y: number; w: number; h: number; kind: SensitiveKind }[] {
  const out: { x: number; y: number; w: number; h: number; kind: SensitiveKind }[] = [];
  for (const l of lines) {
    const hits = findSensitive(l.text);
    if (!hits.length) continue;
    const per = (l.x1 - l.x0) / Math.max(1, l.text.length);
    const pad = (l.y1 - l.y0) * 0.25;
    for (const h of hits) {
      const x0 = l.x0 + h.start * per - pad, x1 = l.x0 + h.end * per + pad;
      out.push({ x: Math.max(0, x0 / size.width), y: Math.max(0, (l.y0 - pad) / size.height), w: Math.min(1, (x1 - x0) / size.width), h: Math.min(1, (l.y1 - l.y0 + pad * 2) / size.height), kind: h.kind });
    }
  }
  return out;
}

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = ix * iy;
  return i / (a.w * a.h + b.w * b.h - i || 1);
};

/**
 * Boxes found on frames sampled every `stepMs` become blur boxes over time:
 * the same box on neighbouring samples is one box, held a little either side.
 */
export function blursFromSamples(samples: { t: number; boxes: { x: number; y: number; w: number; h: number; kind: SensitiveKind }[] }[], stepMs: number, duration: number): BlurBox[] {
  const open: (BlurBox & { seen: number })[] = [];
  const done: BlurBox[] = [];
  for (const s of [...samples].sort((a, b) => a.t - b.t)) {
    for (const b of s.boxes) {
      const hit = open.find((o) => overlap(o, b) > 0.3 && s.t - o.seen <= stepMs * 1.5);
      if (hit) {
        hit.seen = s.t; hit.end = Math.min(duration, s.t + stepMs);
        const x = Math.min(hit.x, b.x), y = Math.min(hit.y, b.y);
        hit.w = Math.max(hit.x + hit.w, b.x + b.w) - x; hit.h = Math.max(hit.y + hit.h, b.y + b.h) - y; hit.x = x; hit.y = y;
      } else open.push({ id: newId('b'), start: Math.max(0, s.t - stepMs), end: Math.min(duration, s.t + stepMs), x: b.x, y: b.y, w: b.w, h: b.h, auto: true, label: b.kind, seen: s.t });
    }
    for (let i = open.length - 1; i >= 0; i--) if (s.t - open[i].seen > stepMs * 1.5) { const { seen: _, ...rest } = open[i]; done.push(rest); open.splice(i, 1); }
  }
  for (const o of open) { const { seen: _, ...rest } = o; done.push(rest); }
  return done.sort((a, b) => a.start - b.start);
}

/** Times (ms of the recording) to look at for privacy blur: every `stepMs` of what is kept. */
export function sampleTimes(clips: Clip[], stepMs: number, max = 600): number[] {
  const out: number[] = [];
  const total = clips.reduce((n, c) => n + c.end - c.start, 0);
  const step = Math.max(stepMs, total / max);
  for (const c of clips) for (let t = c.start + Math.min(200, (c.end - c.start) / 2); t < c.end; t += step) out.push(Math.round(t));
  return out;
}

