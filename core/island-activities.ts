// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the Island shows, and in what order. Everything going on (music, a
// timer, a recording, a download, an agent waiting) becomes an activity with a
// priority; the most important takes the pill, the next one a small bubble
// beside it, and the rest are counted. Short-lived ones (charger plugged in,
// something copied, headphones connected) show for a few seconds.
// Pure: the Island window feeds it the state and draws the result.

import type { IslandState } from './api';
import { countdownShort, joinLink } from './pim/agenda';
import type { CalendarEvent } from './island';
import { queueLabel } from './paste-queue';

export type ActivityKind =
  | 'dictation' | 'recording' | 'agent-waiting' | 'agent-stuck' | 'meeting' | 'charging' | 'battery-low' | 'timer'
  | 'progress' | 'music' | 'agent-working' | 'rain' | 'copied' | 'headphones' | 'awake' | 'unlocked' | 'paused-music' | 'sharing' | 'ai-control' | 'workspace' | 'remote' | 'mesh-exit'
  | 'call' | 'level' | 'cue' | 'alert' | 'reminder' | 'update' | 'usage'
  // Power: plugged in or unplugged (a 3-second notice), and the battery glyph (only when asked for, or when low).
  | 'unplugged' | 'battery'
  // Files waiting on the shelf: a small count when nothing else is going on.
  | 'shelf-idle'
  // Paste one by one: how many are left.
  | 'paste-queue';

/** The battery as the closed Island draws it: one glyph, its fill and colour by charge, and the percentage. */
export interface BatteryLook {
  percent: number;
  charging: boolean;
  lowPower?: boolean;
}

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
  /** power activities: the battery glyph's state */
  battery?: BatteryLook;
  /** music: the artwork (a data: or https: URL) shown left of the notch */
  art?: string;
  /** timers counting down: ms left (the digits pulse in the last 10 s) */
  left?: number;
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
  // A fresh alert shown inside the bar for a few seconds (core/island-expand.ts).
  alert: 99,
  recording: 95,
  // A task is due: it stays until Done or Snooze (core/pim/tasks.ts).
  reminder: 93,
  // A call: its timer and mute stay one tap away.
  call: 92,
  // Watching another device, or a help code waiting: Stop one tap away.
  remote: 90,
  'agent-waiting': 88,
  'agent-stuck': 86,
  // Plugged in or unplugged: a notice for 3 s, never a live activity.
  charging: 82,
  unplugged: 82,
  meeting: 80,
  'battery-low': 78,
  // Pasting one by one: the count stays in view until the queue is done.
  'paste-queue': 74,
  timer: 72,
  // A cue for the app or page in front.
  cue: 70,
  // An AI limit running out (the usage tracker): a ring of what is left.
  usage: 45,
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
  // A Keeper update is downloaded and installs on restart: quiet, never in the way.
  update: 22,
  // The battery glyph when "Always show battery" is on (or while charging below 20%): only when nothing else is going on.
  battery: 12,
  // Files on the shelf: the lowest of all.
  'shelf-idle': 5,
};

/** How long the plug-in or unplug notice stays in the closed Island. */
export const POWER_NOTICE_MS = 3000;
/** At or below this the battery counts as low (red, and it stays in the Island). */
export const BATTERY_LOW = 20;
/** Music paused this long leaves the closed Island. */
export const PAUSED_MUSIC_LEAVES_MS = 2 * 60_000;

/** The battery's colour: green while charging, red when low, yellow in Low Power Mode, otherwise white. */
export function batteryColor(b: BatteryLook): string {
  if (b.charging) return '#30d158';
  if (Math.round(b.percent) <= BATTERY_LOW) return '#ff453a';
  if (b.lowPower) return '#ffd60a';
  return '#f5f5f7';
}

/** A kind turned off in Settings; "Charging" covers both plugging in and unplugging. */
export function kindOff(kind: ActivityKind, off: readonly string[] | undefined): boolean {
  if (!off?.length) return false;
  return off.includes(kind) || (kind === 'unplugged' && off.includes('charging'));
}

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
  /** a Keeper update downloaded and ready to install (its version) */
  updateReady?: string;
  /** Settings → Island → "Always show battery": the battery glyph whenever nothing else is going on */
  alwaysBattery?: boolean;
  /** when the music was paused (it leaves the closed Island 2 minutes later) */
  musicPausedSince?: number;
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
  for (const r of s.dueReminders ?? []) {
    const late = now - r.at > 60_000;
    add({ id: `reminder-${r.id}`, kind: 'reminder', icon: 'listCheck', title: r.title, detail: late ? `Due ${new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Due now', trailing: late ? '!' : 'now', color: '#bf5af2', since: r.at, ref: r.id });
  }
  if (x.updateReady) add({ id: 'update', kind: 'update', icon: 'down', title: `Keeper ${x.updateReady} is ready`, detail: 'Installs when Keeper restarts', trailing: 'new', color: '#30d158', ref: x.updateReady });
  if (s.usageAlert) {
    const u = s.usageAlert;
    add({ id: `usage-${u.id}`, kind: 'usage', icon: 'chart', title: u.title, detail: u.detail, trailing: u.urgency === 'used-up' ? '0%' : `${u.left}%`, progress: u.left / 100, color: u.urgency === 'used-up' ? '#ff453a' : '#ff9f0a', ref: u.id });
  }
  if (s.cueHere) add({ id: `cue-${s.cueHere.id}`, kind: 'cue', icon: 'pin', title: s.cueHere.title, detail: s.cueHere.count > 1 ? `${s.cueHere.count} cues here` : 'A cue for this place', trailing: s.cueHere.count > 1 ? String(s.cueHere.count) : undefined, color: '#ff9f0a', ref: s.cueHere.id });

  for (const a of s.agents) {
    if (a.state === 'waiting') add({ id: `agent-${a.id}`, kind: 'agent-waiting', icon: 'terminal', title: `${a.project} needs you`, detail: a.summary, trailing: '!', color: '#fbbf24', ref: a.id, since: a.updatedAt });
    else if (a.state === 'stuck') add({ id: `agent-${a.id}`, kind: 'agent-stuck', icon: 'warning', title: `${a.project} is stuck`, detail: a.summary, color: '#f87171', ref: a.id, since: a.updatedAt });
    else if (a.state === 'working') add({ id: `agent-${a.id}`, kind: 'agent-working', icon: 'terminal', title: `${a.project} is working`, detail: a.summary, color: '#60a5fa', ref: a.id, since: a.updatedAt });
  }

  const ev = meetingNow(s.events, now);
  if (ev) {
    add({ id: `ev-${ev.uid}`, kind: 'meeting', icon: 'calendar', title: ev.title, detail: ev.location, trailing: countdownShort(ev.start, now), color: ev.color ?? '#a78bfa', since: ev.start, ref: ev.url });
  }

  if (s.battery && Number.isFinite(s.battery.percent)) {
    const b = s.battery;
    const pct = Math.round(b.percent);
    const look: BatteryLook = { percent: pct, charging: b.charging, lowPower: b.lowPower };
    // Low stays until the charger is in or it is above 20%; the glyph otherwise only when asked for,
    // or while it charges from low. Being on battery by itself shows nothing.
    if (!b.charging && pct <= BATTERY_LOW) add({ id: 'battery-low', kind: 'battery-low', icon: 'battery', title: 'Battery low', detail: `${pct}% left`, trailing: `${pct}%`, color: batteryColor(look), progress: pct / 100, battery: look });
    else if (x.alwaysBattery || (b.charging && pct < BATTERY_LOW)) add({ id: 'battery', kind: 'battery', icon: 'battery', title: b.charging ? 'Charging' : b.lowPower ? 'Low Power Mode' : 'Battery', detail: `${pct}%`, trailing: `${pct}%`, color: batteryColor(look), progress: pct / 100, battery: look });
  }

  if (s.focus.mode !== 'idle') {
    const f = s.focus;
    const paused = f.pausedLeft !== undefined;
    const name = f.mode === 'break' ? 'Break' : f.taskTitle ?? (f.stopwatch ? 'Stopwatch' : 'Focus');
    if (f.stopwatch) {
      // Counting up: the time so far, no ring.
      const so = f.pausedLeft ?? Math.max(0, now - (f.startedAt ?? now));
      add({ id: 'timer', kind: 'timer', icon: 'stopwatch', title: paused ? `${name} (paused)` : name, trailing: mmss(so), color: '#ff9f0a', ref: f.taskId });
    } else {
      const left = f.pausedLeft ?? Math.max(0, f.endsAt - now);
      const total = (f.mode === 'break' ? f.breakMin : f.focusMin) * 60_000;
      add({ id: 'timer', kind: 'timer', icon: 'timer', title: paused ? `${name} (paused)` : name, trailing: mmss(left), progress: total ? Math.max(0, 1 - left / total) : undefined, color: f.mode === 'break' ? '#34d399' : '#ff9f0a', ref: f.taskId, left: paused ? undefined : left });
    }
  }

  // Countdown timers from Alarms (several can run; each is its own activity).
  for (const t of s.countdowns ?? []) {
    const left = t.endsAt !== undefined ? Math.max(0, t.endsAt - now) : t.leftMs ?? t.durationMs;
    add({ id: `countdown-${t.id}`, kind: 'timer', icon: 'timer', title: t.endsAt !== undefined ? t.label : `${t.label} (paused)`, trailing: mmss(left), progress: t.durationMs ? 1 - left / t.durationMs : undefined, color: '#ff9f0a', ref: t.id, left: t.endsAt !== undefined ? left : undefined });
  }

  for (const j of x.jobs ?? []) {
    add({ id: `job-${j.task}`, kind: 'progress', icon: JOB_ICON[j.task] ?? 'refresh', title: JOB_TITLE[j.task] ?? 'Working', detail: j.phase, progress: Math.max(0, Math.min(1, j.fraction)), trailing: `${Math.round(j.fraction * 100)}%`, color: '#0a84ff' });
  }

  const np = s.nowPlaying;
  // Paused music leaves after two minutes (it comes back when it plays again).
  if (np && (np.playing || x.musicPausedSince === undefined || now - x.musicPausedSince < PAUSED_MUSIC_LEAVES_MS)) {
    add({
      id: 'music', kind: np.playing ? 'music' : 'paused-music', icon: 'audio', title: np.title, detail: np.artist, color: '#ff375f', wave: np.playing,
      progress: np.duration ? np.position / np.duration : undefined, ref: np.app, art: np.artwork,
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
  if (s.pasteQueue) {
    const q = s.pasteQueue;
    add({ id: 'paste-queue', kind: 'paste-queue', icon: 'clipboard', title: q.collecting ? 'Collecting to paste one by one' : 'Pasting one by one', detail: q.next ? q.next.slice(0, 80) : queueLabel(q), trailing: q.collecting ? `+${q.left}` : `${q.left} left`, color: '#bf5af2' });
  }
  // Files waiting on the shelf: a small count, only when nothing else is going on (it has the lowest priority).
  if (s.shelf?.length) add({ id: 'shelf-idle', kind: 'shelf-idle', icon: 'archive', title: `${s.shelf.length} on the shelf`, trailing: String(s.shelf.length), color: '#a1a1aa' });
  return out.filter((a) => !kindOff(a.kind, x.off));
}

const JOB_TITLE: Record<string, string> = { convert: 'Converting', cleanup: 'Looking for things to clean', junk: 'Looking for things to clean', duplicates: 'Finding duplicates', dupes: 'Finding duplicates', space: 'Measuring folders', index: 'Reading your files', upload: 'Uploading', download: 'Downloading', lock: 'Locking a folder', unlock: 'Unlocking a folder', sync: 'Syncing', backup: 'Backing up', restore: 'Restoring', mirror: 'Mirroring', arriving: 'Arriving', workout: 'Workout running' };
const JOB_ICON: Record<string, string> = { convert: 'refresh', cleanup: 'broom', junk: 'broom', duplicates: 'dupes', dupes: 'dupes', space: 'map', index: 'search', upload: 'arrowUp', download: 'down', lock: 'lock', unlock: 'lock', sync: 'refresh', backup: 'shield', restore: 'undo', mirror: 'cloud', arriving: 'map', workout: 'bolt' };

/** Short-lived activities from what changed between two states. */
export function transientsFrom(prev: IslandState | null, next: IslandState, now: number): Activity[] {
  if (!prev) return [];
  const out: Activity[] = [];
  // Plugged in or unplugged: shown for 3 seconds, then the Island goes back to what it showed.
  const nb = next.battery;
  if (nb && prev.battery && nb.charging !== prev.battery.charging && Number.isFinite(nb.percent)) {
    const pct = Math.round(nb.percent);
    const look: BatteryLook = { percent: pct, charging: nb.charging, lowPower: nb.lowPower };
    out.push(nb.charging
      ? { id: `charging-${now}`, kind: 'charging', priority: PRIORITY.charging, icon: 'bolt', title: 'Charging', detail: `${pct}%`, trailing: `${pct}%`, progress: pct / 100, color: batteryColor(look), until: now + POWER_NOTICE_MS, since: now, battery: look }
      : { id: `unplugged-${now}`, kind: 'unplugged', priority: PRIORITY.unplugged, icon: 'battery', title: 'On battery', detail: `${pct}%`, trailing: `${pct}%`, progress: pct / 100, color: batteryColor(look), until: now + POWER_NOTICE_MS, since: now, battery: look });
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
/** Shown only when nothing else is going on: never as the bubble, never counted. */
const AMBIENT: ActivityKind[] = ['shelf-idle', 'battery'];

export function present(list: Activity[], now: number): Presentation {
  const going = list.filter((a) => !a.until || a.until > now);
  const busy = going.some((a) => !AMBIENT.includes(a.kind));
  const live = busy ? going.filter((a) => !AMBIENT.includes(a.kind)) : going;
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

/**
 * The calendar event worth a live activity, if any: from 15 minutes before it starts
 * until 10 minutes after, or until it ends when it has a meeting link. All-day events
 * and anything longer than 4 hours (a trip, a stay, a block of time) never are.
 */
export function meetingNow(events: CalendarEvent[], now: number): CalendarEvent | undefined {
  return events.find((e) => {
    if (e.allDay || e.end <= now || e.end - e.start > 4 * 3_600_000) return false;
    if (e.start - now >= 15 * 60_000) return false;
    if (now - e.start <= 10 * 60_000) return true;
    return !!joinLink({ location: e.location, url: e.url });
  });
}
