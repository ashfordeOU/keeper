// SPDX-License-Identifier: AGPL-3.0-or-later
// What the Island shows, and in what order. Everything going on (music, a
// timer, a recording, a download, an agent waiting) becomes an activity with a
// priority; the most important takes the pill, the next one a small bubble
// beside it, and the rest are counted. Short-lived ones (charger plugged in,
// something copied, headphones connected) show for a few seconds.
// Pure: the Island window feeds it the state and draws the result.

import type { IslandState } from './api';

export type ActivityKind =
  | 'dictation' | 'recording' | 'agent-waiting' | 'agent-stuck' | 'meeting' | 'charging' | 'battery-low' | 'timer'
  | 'progress' | 'music' | 'agent-working' | 'rain' | 'copied' | 'headphones' | 'awake' | 'unlocked' | 'paused-music';

export interface Activity {
  id: string;
  kind: ActivityKind;
  /** higher wins the pill */
  priority: number;
  /** icon name for the leading side (left of the notch) */
  icon: string;
  /** short text or number for the trailing side (right of the notch) */
  trailing?: string;
  /** 0..1 shows a ring instead of text */
  progress?: number;
  title: string;
  detail?: string;
  /** accent colour of the activity */
  color: string;
  /** a moving waveform (music, dictation) */
  wave?: boolean;
  /** it ends by itself at this time (short-lived activities) */
  until?: number;
  since?: number;
  /** a path or id the card's buttons act on */
  ref?: string;
}

/** Small dots that are always shown while a camera or microphone is in use. */
export interface PrivacyDots {
  camera: string[];
  mic: string[];
}

export interface Presentation {
  primary?: Activity;
  /** shown as a separate circle beside the pill (two things at once) */
  secondary?: Activity;
  /** how many more are going on */
  more: number;
}

export const PRIORITY: Record<ActivityKind, number> = {
  dictation: 100,
  recording: 95,
  'agent-waiting': 88,
  'agent-stuck': 86,
  charging: 82,
  meeting: 80,
  'battery-low': 78,
  timer: 72,
  progress: 66,
  music: 60,
  copied: 58,
  headphones: 56,
  'agent-working': 50,
  rain: 40,
  unlocked: 34,
  awake: 30,
  'paused-music': 20,
};

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};

export interface ExtraInputs {
  dictation?: 'on' | 'working';
  /** long jobs reported by Keeper (convert, clean up, duplicates, space map, first scan) */
  jobs?: { task: string; phase: string; fraction: number }[];
  /** folders unlocked right now */
  unlocked?: number;
  /** kinds turned off in Settings */
  off?: string[];
}

/** Ongoing activities from the Island's state. */
export function activitiesFrom(s: IslandState, now: number, x: ExtraInputs = {}): Activity[] {
  const out: Activity[] = [];
  const add = (a: Omit<Activity, 'priority'> & { priority?: number }) => out.push({ priority: PRIORITY[a.kind], ...a });

  if (x.dictation) add({ id: 'dictation', kind: 'dictation', icon: 'mic', title: x.dictation === 'on' ? 'Listening…' : 'Writing it down…', color: '#ff9f0a', wave: x.dictation === 'on' });
  if (s.recording) add({ id: 'recording', kind: 'recording', icon: 'camera', title: 'Recording the screen', trailing: mmss(now - s.recording.since), color: '#ff453a', since: s.recording.since });

  for (const a of s.agents) {
    if (a.state === 'waiting') add({ id: `agent-${a.id}`, kind: 'agent-waiting', icon: 'terminal', title: `${a.project} needs you`, detail: a.summary, trailing: '!', color: '#fbbf24', ref: a.id, since: a.updatedAt });
    else if (a.state === 'stuck') add({ id: `agent-${a.id}`, kind: 'agent-stuck', icon: 'warning', title: `${a.project} is stuck`, detail: a.summary, color: '#f87171', ref: a.id, since: a.updatedAt });
    else if (a.state === 'working') add({ id: `agent-${a.id}`, kind: 'agent-working', icon: 'terminal', title: `${a.project} is working`, detail: a.summary, color: '#60a5fa', ref: a.id, since: a.updatedAt });
  }

  const ev = s.events.find((e) => !e.allDay && e.end > now && e.start - now < 15 * 60_000);
  if (ev) {
    const started = ev.start <= now;
    add({ id: `ev-${ev.uid}`, kind: 'meeting', icon: 'calendar', title: ev.title, detail: ev.location, trailing: started ? 'now' : `${Math.ceil((ev.start - now) / 60_000)}m`, color: '#a78bfa', since: ev.start, ref: ev.url });
  }

  if (s.battery && !s.battery.charging && s.battery.percent <= 20) {
    add({ id: 'battery-low', kind: 'battery-low', icon: 'battery', title: 'Battery low', detail: `${Math.round(s.battery.percent)}% left`, trailing: `${Math.round(s.battery.percent)}%`, color: '#ff453a', progress: s.battery.percent / 100 });
  }

  if (s.focus.mode !== 'idle') {
    const left = s.focus.pausedLeft ?? Math.max(0, s.focus.endsAt - now);
    const total = (s.focus.mode === 'break' ? s.focus.breakMin : s.focus.focusMin) * 60_000;
    add({ id: 'timer', kind: 'timer', icon: 'timer', title: s.focus.mode === 'break' ? 'Break' : s.focus.pausedLeft !== undefined ? 'Focus (paused)' : 'Focus', trailing: mmss(left), progress: total ? 1 - left / total : undefined, color: s.focus.mode === 'break' ? '#34d399' : '#ff9f0a' });
  }

  for (const j of x.jobs ?? []) {
    add({ id: `job-${j.task}`, kind: 'progress', icon: JOB_ICON[j.task] ?? 'refresh', title: JOB_TITLE[j.task] ?? 'Working', detail: j.phase, progress: Math.max(0, Math.min(1, j.fraction)), trailing: `${Math.round(j.fraction * 100)}%`, color: '#0a84ff' });
  }

  const np = s.nowPlaying;
  if (np) {
    add({
      id: 'music', kind: np.playing ? 'music' : 'paused-music', icon: 'audio', title: np.title, detail: np.artist, color: '#ff375f', wave: np.playing,
      progress: np.duration ? np.position / np.duration : undefined, ref: np.app,
    });
  }

  if (s.weather?.nowcast && /rain|snow|shower|drizzle|storm/i.test(s.weather.nowcast)) {
    add({ id: 'rain', kind: 'rain', icon: 'drop', title: s.weather.nowcast, detail: s.weather.place.name, color: '#64d2ff' });
  }
  if (x.unlocked) add({ id: 'unlocked', kind: 'unlocked', icon: 'lock', title: `${x.unlocked} folder${x.unlocked === 1 ? '' : 's'} unlocked`, trailing: String(x.unlocked), color: '#fbbf24' });
  if (s.keepAwake.on) {
    const left = s.keepAwake.until ? Math.max(0, s.keepAwake.until - now) : 0;
    add({ id: 'awake', kind: 'awake', icon: 'coffee', title: 'Staying awake', detail: s.keepAwake.reason, trailing: left ? mmss(left) : '∞', color: '#d6a46b' });
  }
  return out.filter((a) => !x.off?.includes(a.kind));
}

const JOB_TITLE: Record<string, string> = { convert: 'Converting', cleanup: 'Looking for things to clean', junk: 'Looking for things to clean', duplicates: 'Finding duplicates', dupes: 'Finding duplicates', space: 'Measuring folders', index: 'Reading your files', upload: 'Uploading', download: 'Downloading', lock: 'Locking a folder', unlock: 'Unlocking a folder' };
const JOB_ICON: Record<string, string> = { convert: 'refresh', cleanup: 'broom', junk: 'broom', duplicates: 'dupes', dupes: 'dupes', space: 'map', index: 'search', upload: 'arrowUp', download: 'down', lock: 'lock', unlock: 'lock' };

/** Short-lived activities from what changed between two states. */
export function transientsFrom(prev: IslandState | null, next: IslandState, now: number): Activity[] {
  if (!prev) return [];
  const out: Activity[] = [];
  if (next.battery && prev.battery && next.battery.charging && !prev.battery.charging) {
    out.push({ id: `charging-${now}`, kind: 'charging', priority: PRIORITY.charging, icon: 'bolt', title: 'Charging', trailing: `${Math.round(next.battery.percent)}%`, progress: next.battery.percent / 100, color: '#30d158', until: now + 4000 });
  }
  const clip = next.clips[0];
  if (clip && clip.id !== prev.clips[0]?.id && now - clip.at < 5000) {
    out.push({ id: `copied-${clip.id}`, kind: 'copied', priority: PRIORITY.copied, icon: 'clipboard', title: 'Copied', detail: clip.kind === 'image' ? 'An image' : (clip.text ?? '').slice(0, 80), color: '#bf5af2', until: now + 2000, ref: clip.id });
  }
  const was = new Set((prev.devices?.bluetooth ?? []).map((b) => b.name));
  for (const b of next.devices?.bluetooth ?? []) {
    if (!was.has(b.name) && prev.devices) {
      out.push({ id: `bt-${b.name}`, kind: 'headphones', priority: PRIORITY.headphones, icon: 'audio', title: `${b.name} connected`, trailing: `${b.percent}%`, progress: b.percent / 100, color: '#0a84ff', until: now + 4000 });
    }
  }
  return out;
}

/** The most important activity takes the pill, the next one the bubble, the rest are counted. */
export function present(list: Activity[], now: number): Presentation {
  const live = list.filter((a) => !a.until || a.until > now);
  // Highest priority first; among equals, the newest.
  live.sort((a, b) => b.priority - a.priority || (b.since ?? 0) - (a.since ?? 0) || a.id.localeCompare(b.id));
  // The same kind twice (two agents waiting) shows once with a count.
  const seen = new Set<ActivityKind>();
  const distinct = live.filter((a) => (seen.has(a.kind) ? false : (seen.add(a.kind), true)));
  return { primary: distinct[0], secondary: distinct[1], more: Math.max(0, live.length - 2) };
}

// ---------------------------------------------------------------- privacy (Windows)

/**
 * Apps using the camera or microphone right now, from `reg query … /s` over
 * CapabilityAccessManager\ConsentStore\<webcam|microphone>. An app whose
 * LastUsedTimeStop is 0 has the device open.
 */
export function parseConsentStore(text: string): string[] {
  const out: string[] = [];
  let key = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^HKEY_/i.test(line)) {
      key = line;
      continue;
    }
    const m = line.match(/^LastUsedTimeStop\s+REG_QWORD\s+0x([0-9a-f]+)$/i);
    if (!m || BigInt('0x' + m[1]) !== 0n || !key) continue;
    const leaf = key.split('\\').pop() ?? '';
    if (!leaf || /^(NonPackaged|webcam|microphone)$/i.test(leaf)) continue;
    // NonPackaged apps are stored as their path with \ replaced by #.
    const name = leaf.includes('#') ? leaf.split('#').pop()!.replace(/\.exe$/i, '') : leaf.replace(/_[a-z0-9]{13}$/i, '').split('.').pop()!;
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Linux: process ids whose open files include a camera device, from readlink results. */
export function cameraUsers(fds: { pid: number; name: string; target: string }[]): string[] {
  const names = new Set<string>();
  for (const f of fds) if (/^\/dev\/video\d+$/.test(f.target)) names.add(f.name);
  return [...names];
}
