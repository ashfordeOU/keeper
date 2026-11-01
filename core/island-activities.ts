// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the Island shows, and in what order. Everything going on (music, a
// timer, a recording, a download, an agent waiting) becomes an activity with a
// priority; the most important takes the pill, the next one a small bubble
// beside it, and the rest are counted. Short-lived ones (charger plugged in,
// something copied, headphones connected) show for a few seconds.
// Pure: the Island window feeds it the state and draws the result.

import type { IslandState } from './api';

export type ActivityKind =
  | 'dictation' | 'recording' | 'agent-waiting' | 'agent-stuck' | 'meeting' | 'charging' | 'battery-low' | 'timer'
  | 'progress' | 'music' | 'agent-working' | 'rain' | 'copied' | 'headphones' | 'awake' | 'unlocked' | 'paused-music' | 'sharing' | 'ai-control' | 'workspace' | 'remote' | 'mesh-exit'
  | 'call' | 'level' | 'cue';

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
  // An AI moving the pointer and typing: always on top, Stop one tap away.
  'ai-control': 101,
  dictation: 100,
  // Someone else sees this screen: always visible, with Stop one tap away.
  sharing: 98,
  // Volume or brightness just changed: a moment's level beside the system's own pop-up.
  level: 97,
  recording: 95,
  // A call: its timer and mute stay one tap away.
  call: 92,
  // Watching another device, or a help code waiting: Stop one tap away.
  remote: 90,
  'agent-waiting': 88,
  'agent-stuck': 86,
  charging: 82,
  meeting: 80,
  'battery-low': 78,
  timer: 72,
  // A cue for the app or page in front.
  cue: 70,
  progress: 66,
  music: 60,
  copied: 58,
  headphones: 56,
  'agent-working': 50,
  rain: 40,
  unlocked: 34,
  awake: 30,
  // Keeper Mesh: all traffic goes through another device
  'mesh-exit': 32,
  // Monorail moved to another workspace: a quick note, never in the way.
  workspace: 26,
  'paused-music': 20,
};

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};

const callClock = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` : `${m}:${String(t % 60).padStart(2, '0')}`;
};

export interface ExtraInputs {
  dictation?: 'on' | 'working';
  /** long jobs reported by Keeper (convert, clean up, duplicates, space map, first scan) */
  jobs?: { task: string; phase: string; fraction: number }[];
  /** folders unlocked right now */
  unlocked?: number;
  /** another device or phone watching (or controlling) this screen */
  sharing?: { sid: string; name: string; control: boolean; since: number }[];
  /** this device watching another one, or a help code waiting for a helper */
  remote?: { id: string; title: string; detail?: string; since: number; ref: string }[];
  /** AIs using this computer (screen, pointer, keyboard) right now */
  aiControl?: { id: string; client: string; since: number; actions: number }[];
  /** Keeper Mesh: the exit node in use (shown only where the person placed it) */
  meshExit?: { name: string; since: number } | null;
  /** kinds turned off in Settings */
  off?: string[];
  /** a meeting Voice is recording (core/voice) */
  meetingRec?: { title: string; elapsedMs: number; paused: boolean; last?: string };
}

/** Ongoing activities from the Island's state. */
export function activitiesFrom(s: IslandState, now: number, x: ExtraInputs = {}): Activity[] {
  const out: Activity[] = [];
  const add = (a: Omit<Activity, 'priority'> & { priority?: number }) => out.push({ priority: PRIORITY[a.kind], ...a });

  if (x.dictation) add({ id: 'dictation', kind: 'dictation', icon: 'mic', title: x.dictation === 'on' ? 'Listening…' : 'Writing it down…', color: '#ff9f0a', wave: x.dictation === 'on' });
  if (s.recording) add({ id: 'recording', kind: 'recording', icon: 'camera', title: 'Recording the screen', trailing: mmss(now - s.recording.since), color: '#ff453a', since: s.recording.since });
  if (x.meetingRec) add({ id: 'meeting-rec', kind: 'recording', icon: 'mic', title: x.meetingRec.paused ? `Paused: ${x.meetingRec.title}` : `Recording “${x.meetingRec.title}”`, detail: x.meetingRec.last, trailing: mmss(x.meetingRec.elapsedMs), color: '#ff453a', priority: PRIORITY.recording - 1 });

  if (s.call) {
    const c = s.call;
    add({ id: `call-${c.id}`, kind: 'call', icon: c.video ? 'camera' : 'phone', title: c.app, detail: c.muted ? 'Microphone muted' : 'Microphone on', trailing: callClock(now - c.since), color: c.muted ? '#ff453a' : '#30d158', since: c.since, ref: c.id });
  }
  if (s.hud && now - s.hud.at < 1800) {
    const h = s.hud;
    add({ id: `level-${h.kind}`, kind: 'level', icon: h.kind === 'brightness' ? 'sun' : h.kind === 'mic' ? 'mic' : 'audio', title: `${h.kind === 'brightness' ? 'Brightness' : 'Volume'}${h.muted ? ' muted' : ''}`, trailing: h.muted ? 'off' : `${h.value}%`, progress: h.muted ? 0 : h.value / 100, color: h.kind === 'brightness' ? '#ffd60a' : '#0a84ff', until: h.at + 1800, since: h.at });
  }
  if (s.cueHere) add({ id: `cue-${s.cueHere.id}`, kind: 'cue', icon: 'pin', title: s.cueHere.title, detail: s.cueHere.count > 1 ? `${s.cueHere.count} cues here` : 'A cue for this place', trailing: s.cueHere.count > 1 ? String(s.cueHere.count) : undefined, color: '#ff9f0a', ref: s.cueHere.id });

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

  // Countdown timers from Alarms (several can run; each is its own activity).
  for (const t of s.countdowns ?? []) {
    const left = t.endsAt !== undefined ? Math.max(0, t.endsAt - now) : t.leftMs ?? t.durationMs;
    add({ id: `countdown-${t.id}`, kind: 'timer', icon: 'timer', title: t.endsAt !== undefined ? t.label : `${t.label} (paused)`, trailing: mmss(left), progress: t.durationMs ? 1 - left / t.durationMs : undefined, color: '#ff9f0a', ref: t.id });
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
  for (const c of x.aiControl ?? []) add({ id: `ai-${c.id}`, kind: 'ai-control', icon: 'sparkle', title: `${c.client} is using this computer`, detail: `${c.actions} action${c.actions === 1 ? '' : 's'}`, trailing: mmss(now - c.since), color: '#ff9f0a', since: c.since, ref: c.id });
  for (const sh of x.sharing ?? []) add({ id: `share-${sh.sid}`, kind: 'sharing', icon: 'eye', title: `${sh.name} is ${sh.control ? 'controlling' : 'viewing'} this screen`, trailing: mmss(now - sh.since), color: '#ff453a', since: sh.since, ref: sh.sid });
  if (x.meshExit) add({ id: 'mesh-exit', kind: 'mesh-exit', icon: 'graph', title: `Internet through ${x.meshExit.name}`, detail: 'Keeper Mesh exit node', trailing: 'exit', color: '#8b5cf6', since: x.meshExit.since });
  for (const r of x.remote ?? []) add({ id: `remote-${r.id}`, kind: 'remote', icon: 'laptop', title: r.title, detail: r.detail, trailing: mmss(now - r.since), color: '#0a84ff', since: r.since, ref: r.ref });
  if (x.unlocked) add({ id: 'unlocked', kind: 'unlocked', icon: 'lock', title: `${x.unlocked} folder${x.unlocked === 1 ? '' : 's'} unlocked`, trailing: String(x.unlocked), color: '#fbbf24' });
  if (s.keepAwake.on) {
    const left = s.keepAwake.until ? Math.max(0, s.keepAwake.until - now) : 0;
    add({ id: 'awake', kind: 'awake', icon: 'coffee', title: 'Staying awake', detail: s.keepAwake.reason, trailing: left ? mmss(left) : '∞', color: '#d6a46b' });
  }
  return out.filter((a) => !x.off?.includes(a.kind));
}

const JOB_TITLE: Record<string, string> = { convert: 'Converting', cleanup: 'Looking for things to clean', junk: 'Looking for things to clean', duplicates: 'Finding duplicates', dupes: 'Finding duplicates', space: 'Measuring folders', index: 'Reading your files', upload: 'Uploading', download: 'Downloading', lock: 'Locking a folder', unlock: 'Unlocking a folder', sync: 'Syncing', backup: 'Backing up', restore: 'Restoring', mirror: 'Mirroring', arriving: 'Arriving', workout: 'Workout running' };
const JOB_ICON: Record<string, string> = { convert: 'refresh', cleanup: 'broom', junk: 'broom', duplicates: 'dupes', dupes: 'dupes', space: 'map', index: 'search', upload: 'arrowUp', download: 'down', lock: 'lock', unlock: 'lock', sync: 'refresh', backup: 'shield', restore: 'undo', mirror: 'cloud', arriving: 'map', workout: 'bolt' };

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
  // Monorail (an Ashforde app) switched workspace or slide: say where you are for a moment.
  const m = next.monorail;
  if (m && prev.monorail && (m.workspace !== prev.monorail.workspace || m.slide !== prev.monorail.slide)) {
    out.push({ id: `workspace-${now}`, kind: 'workspace', priority: PRIORITY.workspace, icon: 'columns', title: m.workspaceName || `Workspace ${m.workspace}`, detail: `Slide ${m.slide} of ${m.slides}${m.app ? ` · ${m.app}` : ''}`, trailing: `${m.slide}/${m.slides}`, progress: m.slides > 1 ? m.slide / m.slides : undefined, color: '#5e5ce6', until: now + 1800 });
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
