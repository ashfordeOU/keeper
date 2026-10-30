// SPDX-License-Identifier: AGPL-3.0-or-later
// The Island's live state: shelf, clipboard history, focus timer, keep-awake,
// download and screenshot alerts, coding agents, calendar, now playing,
// weather, battery and dictation.

import { app, nativeImage, Notification, powerMonitor, powerSaveBlocker, shell } from 'electron';
import { existsSync, promises as fsp, watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IslandAlert, IslandState, KeepAwakeOptions, KeepAwakeState, NowPlaying } from '../../core/api';
import { kindOf, looksLikeScreenshot } from '../../core/classify';
import type { FileIndex } from '../../core/indexer';
import {
  ClipHistory, focusLeft, looksSecret, newFocus, parseIcs, pauseFocus, resumeFocus, scanAgentSessions, startFocus, tickFocus,
  type AgentSession, type CalendarEvent, type ClipItem, type FocusState, type LyricLine,
} from '../../core/island';
import { powershell, run } from '../../core/platform';
import { cleanLink, isUrl } from '../../core/textools';
import type { FileEntry } from '../../core/types';
import { fetchWeather, type Weather } from '../../core/weather';
import { getSecret, settings } from '../store';
import { lyricsFor, mediaAction, micInUse, nowPlaying } from './media';
import { readBattery } from './system';
import { hasImage, readImage, readText, writeImage, writeText } from './clip';

const PARTIAL = /\.(crdownload|part|partial|download|opdownload|tmp|!ut)$/i;

export class IslandService {
  shelf: FileEntry[] = [];
  clips = new ClipHistory(60);
  focus: FocusState = newFocus();
  awake: KeepAwakeState = { on: false };
  agents: AgentSession[] = [];
  events: CalendarEvent[] = [];
  playing?: NowPlaying;
  lyrics?: LyricLine[];
  weather?: Weather;
  battery?: { percent: number; charging: boolean };
  mic: string[] = [];
  alerts: IslandAlert[] = [];
  /** set while a screen recording runs */
  recording?: { since: number };
  private blocker: number | null = null;
  private timers: NodeJS.Timeout[] = [];
  private watchers: FSWatcher[] = [];
  private lastClip = '';
  private lastImageSig = '';
  private activeSince = Date.now();
  private presentation = false;
  private file = path.join(app.getPath('userData'), 'island.json');

  constructor(private index: FileIndex, private emit: () => void) {}

  async start() {
    await this.load();
    const every = (ms: number, fn: () => unknown) => {
      const t = setInterval(() => void Promise.resolve(fn()).catch(() => undefined), ms);
      this.timers.push(t);
      void Promise.resolve(fn()).catch(() => undefined);
    };
    every(700, () => this.pollClipboard());
    every(1000, () => this.tick());
    every(5000, () => this.pollAgents());
    every(process.platform === 'win32' ? 5000 : 2500, () => this.pollMedia());
    every(15_000, () => this.checkAwake());
    every(60_000, () => this.pollBattery());
    every(10_000, () => this.pollMic());
    every(15 * 60_000, () => this.pollCalendar());
    every(20 * 60_000, () => this.pollWeather());
    await this.watchFolders();
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.watchers.forEach((w) => w.close());
    if (this.blocker !== null) powerSaveBlocker.stop(this.blocker);
    void this.save();
  }

  state(): IslandState {
    const s = settings();
    const breakIn = s.island.breakEvery > 0 ? Math.max(0, s.island.breakEvery * 60_000 - (Date.now() - this.activeSince)) : undefined;
    return {
      shelf: this.shelf, clips: this.clips.items, focus: this.focus, keepAwake: this.awake, agents: this.agents, events: this.events,
      nowPlaying: this.playing, lyrics: this.lyrics, weather: this.weather, battery: this.battery, micInUse: this.mic, alerts: this.alerts, breakIn, recording: this.recording,
    };
  }

  // ---------------------------------------------------------------- persistence

  private async load() {
    try {
      const d = JSON.parse(await fsp.readFile(this.file, 'utf8')) as { shelf?: string[]; clips?: ClipItem[]; focus?: FocusState };
      this.clips.items = (d.clips ?? []).filter((c) => c && c.id);
      for (const p of d.shelf ?? []) {
        const e = this.index.files.get(p) ?? (await this.index.refresh(p));
        if (e) this.shelf.push(e);
      }
      if (d.focus) this.focus = d.focus;
    } catch {
      /* first run */
    }
  }

  private saveTimer?: NodeJS.Timeout;
  private save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      // Images in the clipboard history are kept small; pinned items survive restarts.
      const data = { shelf: this.shelf.map((f) => f.path), clips: this.clips.items.slice(0, 60), focus: this.focus };
      void fsp.writeFile(this.file, JSON.stringify(data)).catch(() => undefined);
    }, 500);
  }

  private changed() {
    this.save();
    this.emit();
  }

  // ---------------------------------------------------------------- alerts

  alert(a: Omit<IslandAlert, 'id' | 'at'>) {
    const item: IslandAlert = { ...a, id: Math.random().toString(36).slice(2), at: Date.now() };
    this.alerts = [item, ...this.alerts].slice(0, 5);
    setTimeout(() => this.dismiss(item.id), 8000);
    this.emit();
  }

  dismiss(id: string) {
    const n = this.alerts.length;
    this.alerts = this.alerts.filter((a) => a.id !== id);
    if (n !== this.alerts.length) this.emit();
  }

  private notify(title: string, body?: string) {
    if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  }

  // ---------------------------------------------------------------- shelf

  async addToShelf(paths: string[]) {
    for (const p of paths) {
      if (this.shelf.some((f) => f.path === p)) continue;
      const e = this.index.files.get(p) ?? (await this.index.refresh(p));
      if (e) this.shelf.push(e);
    }
    this.changed();
  }

  removeFromShelf(p: string) {
    this.shelf = this.shelf.filter((f) => f.path !== p);
    this.changed();
  }

  clearShelf() {
    this.shelf = [];
    this.changed();
  }

  // ---------------------------------------------------------------- clipboard

  private polling = false;
  private async pollClipboard() {
    const s = settings().island;
    if (!s.clipboard || this.polling) return;
    this.polling = true;
    try {
      await this.readClipboard(s.cleanLinks);
    } finally {
      this.polling = false;
    }
  }

  private async readClipboard(cleanLinks: boolean) {
    const text = await readText();
    if (text && text !== this.lastClip) {
      this.lastClip = text;
      let value = text;
      if (cleanLinks && isUrl(text)) {
        const clean = cleanLink(text);
        if (clean !== text) {
          await writeText(clean);
          this.lastClip = clean;
          value = clean;
        }
      }
      // Passwords and keys copied from a password manager are not remembered.
      if (!looksSecret(value) && value.length < 100_000 && this.clips.add({ kind: 'text', text: value })) this.changed();
      return;
    }
    if (!text && (await hasImage())) {
      const img = await readImage();
      if (!img) return;
      const { width, height } = img.getSize();
      const sig = `${width}x${height}:${img.toBitmap().subarray(0, 4096).reduce((a, b) => (a * 31 + b) >>> 0, 7)}`;
      if (sig === this.lastImageSig) return;
      this.lastImageSig = sig;
      const thumb = img.resize({ width: Math.min(320, width) }).toDataURL();
      if (this.clips.add({ kind: 'image', image: thumb, text: `Image ${width}×${height}` })) this.changed();
    }
  }

  async copyClip(id: string) {
    const c = this.clips.items.find((x) => x.id === id);
    if (!c) return;
    if (c.kind === 'image' && c.image) {
      // Only the stored preview is available; good enough for pasting a quick image.
      await writeImage(nativeImage.createFromDataURL(c.image));
    } else if (c.text) {
      await writeText(c.text);
      this.lastClip = c.text;
    }
    this.clips.add(c.kind === 'image' ? { kind: 'image', image: c.image, text: c.text } : { kind: 'text', text: c.text });
    this.changed();
  }

  pinClip(id: string) { this.clips.togglePin(id); this.changed(); }
  removeClip(id: string) { this.clips.remove(id); this.changed(); }
  clearClips() { this.clips.clear(); this.changed(); }

  // ---------------------------------------------------------------- focus & breaks

  focusAction(action: 'start' | 'pause' | 'resume' | 'stop', minutes?: number): FocusState {
    if (action === 'start') {
      this.focus = startFocus(this.focus, minutes ?? this.focus.focusMin);
      // Focus sessions keep the computer awake.
      if (!this.awake.on) this.keepAwake(true, { until: this.focus.endsAt }, 'Focus session');
    } else if (action === 'pause') this.focus = pauseFocus(this.focus);
    else if (action === 'resume') this.focus = resumeFocus(this.focus);
    else {
      this.focus = { ...this.focus, mode: 'idle', endsAt: 0, pausedLeft: undefined };
      if (this.awake.reason === 'Focus session') this.keepAwake(false);
    }
    this.changed();
    return this.focus;
  }

  private tick() {
    const { state, event } = tickFocus(this.focus);
    if (event) {
      this.focus = state;
      if (event === 'focus-done') {
        this.alert({ kind: 'focus', title: 'Focus session done', detail: `Take a ${state.breakMin}-minute break` });
        this.notify('Focus session done', `Take a ${state.breakMin}-minute break.`);
      } else {
        this.alert({ kind: 'focus', title: 'Break is over', detail: 'Ready for another round?' });
      }
      this.changed();
    }
    // Break reminders count active time; being idle for 5 minutes counts as a break.
    const every = settings().island.breakEvery;
    if (every > 0) {
      if (powerMonitor.getSystemIdleTime() > 300) this.activeSince = Date.now();
      else if (Date.now() - this.activeSince > every * 60_000) {
        this.activeSince = Date.now();
        this.alert({ kind: 'info', title: 'Time for a short break', detail: 'Look away from the screen and stretch for a minute.' });
        this.notify('Time for a short break', 'Look away from the screen and stretch for a minute.');
      }
    }
    if (this.focus.mode !== 'idle' || this.playing?.playing) this.emit();
  }

  // ---------------------------------------------------------------- keep awake

  keepAwake(on: boolean, options: KeepAwakeOptions = {}, reason?: string): KeepAwakeState {
    if (this.blocker !== null) {
      powerSaveBlocker.stop(this.blocker);
      this.blocker = null;
    }
    if (!on) {
      this.awake = { on: false };
    } else {
      this.blocker = powerSaveBlocker.start(options.allowDisplaySleep ? 'prevent-app-suspension' : 'prevent-display-sleep');
      const until = options.minutes ? Date.now() + options.minutes * 60_000 : options.until;
      const why = reason ?? (options.whileApp ? `While ${options.whileApp} is running` : options.whileFile ? `Until ${path.basename(options.whileFile)} finishes` : until ? 'For a while' : 'Until you turn it off');
      this.awake = { on: true, since: Date.now(), until, reason: why, options };
      this.fileWatch = undefined;
    }
    this.emit();
    return this.awake;
  }

  private fileWatch?: { size: number; since: number };

  private async checkAwake() {
    if (!this.awake.on) return;
    const o = this.awake.options ?? {};
    const end = (why: string) => {
      this.keepAwake(false);
      this.alert({ kind: 'info', title: 'Keep awake ended', detail: why });
    };
    if (this.awake.until && Date.now() > this.awake.until) return end('Time is up');
    if (o.stopBelowBattery && this.battery && !this.battery.charging && this.battery.percent < o.stopBelowBattery) return end('Battery is low');
    if (o.onlyOnPower && powerMonitor.isOnBatteryPower()) return end('Unplugged from power');
    if (o.whileApp) {
      const running = await isRunning(o.whileApp);
      if (!running) return end(`${o.whileApp} has quit`);
    }
    if (o.whileFile) {
      const size = await fsp.stat(o.whileFile).then((s) => s.size, () => -1);
      if (size < 0) return end('The file is gone');
      if (!this.fileWatch || this.fileWatch.size !== size) this.fileWatch = { size, since: Date.now() };
      else if (Date.now() - this.fileWatch.since > 60_000) return end(`${path.basename(o.whileFile)} finished`);
    }
  }

  /** Presentation mode: stay awake and hide desktop icons (macOS). */
  async setPresentation(on: boolean): Promise<boolean> {
    this.presentation = on;
    this.keepAwake(on, {}, on ? 'Presentation mode' : undefined);
    if (process.platform === 'darwin') {
      await run('/usr/bin/defaults', ['write', 'com.apple.finder', 'CreateDesktop', on ? 'false' : 'true']);
      await run('/usr/bin/killall', ['Finder']);
    }
    return this.presentation;
  }

  // ---------------------------------------------------------------- downloads & screenshots

  private async watchFolders() {
    const home = os.homedir();
    const folders = new Set([path.join(home, 'Downloads'), path.join(home, 'Desktop')]);
    if (process.platform === 'darwin') {
      const r = await run('/usr/bin/defaults', ['read', 'com.apple.screencapture', 'location']);
      if (r.ok && r.stdout.trim()) folders.add(r.stdout.trim().replace(/^~/, home));
    } else if (process.platform === 'win32') {
      folders.add(path.join(home, 'Pictures', 'Screenshots'));
      folders.add(path.join(home, 'OneDrive', 'Pictures', 'Screenshots'));
    } else {
      folders.add(path.join(home, 'Pictures', 'Screenshots'));
    }
    const seen = new Set<string>();
    for (const dir of folders) {
      if (!existsSync(dir)) continue;
      try {
        const w = watch(dir, (_ev, name) => {
          if (!name || name.startsWith('.') || PARTIAL.test(name)) return;
          const p = path.join(dir, name.toString());
          if (seen.has(p)) return;
          seen.add(p);
          setTimeout(() => seen.delete(p), 10_000);
          void this.onNewFile(p, dir);
        });
        this.watchers.push(w);
      } catch {
        /* not watchable */
      }
    }
  }

  private async onNewFile(p: string, dir: string) {
    // Wait until the size stops changing: the file has finished arriving.
    let last = -1;
    for (let i = 0; i < 30; i++) {
      const st = await fsp.stat(p).catch(() => null);
      if (!st || !st.isFile()) return;
      if (st.size === last && Date.now() - st.mtimeMs > 1500) break;
      last = st.size;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const isNewFile = await fsp.stat(p).then((s) => Date.now() - s.birthtimeMs < 5 * 60_000 || Date.now() - s.mtimeMs < 60_000, () => false);
    if (!isNewFile) return;
    const entry = await this.index.refresh(p);
    if (!entry) return;
    const name = path.basename(p);
    const shot = looksLikeScreenshot(name) || (kindOf(name) === 'image' && /screenshots?$/i.test(dir));
    const isDownload = !shot && dir.endsWith('Downloads');
    if (!shot && !isDownload) return;
    if (settings().island.downloadAlerts) {
      this.alert({ kind: shot ? 'screenshot' : 'download', title: shot ? 'Screenshot saved' : 'Download finished', detail: entry.source ? `${name} · from ${entry.source.name}` : name, path: p });
    }
    if (!this.shelf.some((f) => f.path === p)) {
      this.shelf = [entry, ...this.shelf].slice(0, 30);
      this.changed();
    }
  }

  // ---------------------------------------------------------------- agents

  private async pollAgents() {
    if (!settings().island.agents) return;
    const prev = new Map(this.agents.map((a) => [a.id, a.state]));
    const next = await scanAgentSessions();
    let changed = next.length !== this.agents.length;
    for (const a of next) {
      const was = prev.get(a.id);
      if (was !== a.state) changed = true;
      if (a.state === 'waiting' && was !== 'waiting') {
        this.alert({ kind: 'agent', title: `${a.project} needs you`, detail: a.summary || 'Waiting for permission' });
        if (settings().island.soundOnAgent) shell.beep();
      } else if (a.state === 'done' && was === 'working') {
        this.alert({ kind: 'agent', title: `${a.project} is done`, detail: a.summary });
      }
    }
    this.agents = next;
    if (changed) this.emit();
  }

  async openAgent(id: string) {
    const a = this.agents.find((x) => x.id === id);
    const cwd = a?.cwd && existsSync(a.cwd) ? a.cwd : os.homedir();
    if (process.platform === 'darwin') await run('/usr/bin/open', ['-a', 'Terminal', cwd]);
    else if (process.platform === 'win32') {
      if (!(await run('wt.exe', ['-d', cwd])).ok) await run('cmd.exe', ['/c', 'start', 'cmd.exe', '/K', `cd /d "${cwd}"`]);
    } else if (!(await run('x-terminal-emulator', ['--working-directory', cwd])).ok) await run('gnome-terminal', ['--working-directory', cwd]);
  }

  // ---------------------------------------------------------------- media, battery, mic, calendar, weather

  private lastTrack = '';
  private async pollMedia() {
    const np = await nowPlaying();
    const key = np ? `${np.artist}\u0000${np.title}` : '';
    const changed = key !== this.lastTrack || np?.playing !== this.playing?.playing;
    this.playing = np;
    if (key !== this.lastTrack) {
      this.lastTrack = key;
      this.lyrics = undefined;
      if (np && settings().island.lyrics) this.lyrics = await lyricsFor(np);
    }
    if (changed) this.emit();
  }

  async media(action: 'toggle' | 'next' | 'previous' | 'seek', value?: number) {
    await mediaAction(this.playing?.app, action, value);
    setTimeout(() => void this.pollMedia(), 300);
  }

  private async pollBattery() {
    const b = await readBattery();
    if (!b || !Number.isFinite(b.percent)) return;
    const was = this.battery;
    this.battery = { percent: b.percent, charging: b.charging };
    if (was && was.charging !== b.charging) this.alert({ kind: 'battery', title: b.charging ? 'Charging' : 'On battery', detail: `${b.percent}%` });
    if (was && !b.charging && was.percent > 10 && b.percent <= 10) this.alert({ kind: 'battery', title: 'Battery low', detail: `${b.percent}% left` });
    this.emit();
  }

  private async pollMic() {
    const m = await micInUse();
    if (m.join() !== this.mic.join()) {
      this.mic = m;
      this.emit();
    }
  }

  async pollCalendar() {
    const url = settings().island.calendarUrl.trim();
    if (!url) {
      this.events = [];
      return;
    }
    try {
      const text = /^(https?|webcal):/i.test(url) ? await (await fetch(url.replace(/^webcal:/i, 'https:'))).text() : await fsp.readFile(url.replace(/^file:\/\//, ''), 'utf8');
      const from = new Date().setHours(0, 0, 0, 0);
      this.events = parseIcs(text, from, from + 14 * 86_400_000);
      this.emit();
    } catch {
      /* calendar unreachable: keep the last copy */
    }
  }

  async pollWeather(force = false): Promise<Weather | undefined> {
    const s = settings().island;
    if (!s.weather || !s.place) return undefined;
    if (!force && this.weather && Date.now() - this.weather.fetchedAt < 15 * 60_000 && this.weather.place.name === s.place.name) return this.weather;
    try {
      const prevCast = this.weather?.nowcast;
      this.weather = await fetchWeather(s.place, s.units);
      if (this.weather.nowcast && this.weather.nowcast !== prevCast && /starting/.test(this.weather.nowcast)) this.alert({ kind: 'info', title: this.weather.nowcast, detail: s.place.name });
      this.emit();
    } catch {
      /* offline */
    }
    return this.weather;
  }

  // ---------------------------------------------------------------- dictation

  /** Sends recorded audio to an OpenAI-compatible transcription endpoint chosen by the user. */
  async transcribe(audio: ArrayBuffer, mime: string): Promise<string> {
    const s = settings().island;
    const key = await getSecret('dictation');
    if (!key && !/localhost|127\.0\.0\.1/.test(s.dictationUrl)) throw new Error('Add a speech-to-text key in Island settings');
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mime }), `speech.${mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm'}`);
    form.append('model', s.dictationModel);
    form.append('response_format', 'json');
    const res = await fetch(s.dictationUrl, { method: 'POST', headers: key ? { authorization: `Bearer ${key}` } : {}, body: form });
    if (!res.ok) throw new Error(`Speech service returned ${res.status}`);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? '').trim();
  }

  /** Types text at the cursor in whatever app is in front, by pasting it. */
  async typeText(text: string) {
    if (!text) return;
    const before = await readText();
    await writeText(text);
    this.lastClip = text;
    if (process.platform === 'darwin') await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    else if (process.platform === 'win32') await powershell("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')");
    else if (!(await run('xdotool', ['key', '--clearmodifiers', 'ctrl+v'])).ok) await run('wtype', ['-M', 'ctrl', 'v', '-m', 'ctrl']);
    setTimeout(() => {
      void writeText(before);
      this.lastClip = before;
    }, 800);
  }
}

async function isRunning(name: string): Promise<boolean> {
  const n = name.toLowerCase().replace(/\.(app|exe)$/, '');
  if (process.platform === 'win32') {
    const r = await run('tasklist', ['/FO', 'CSV', '/NH']);
    return r.stdout.toLowerCase().split(/\r?\n/).some((l) => l.startsWith(`"${n}`));
  }
  const r = await run('ps', ['-Ao', 'comm=']);
  return r.stdout.toLowerCase().split('\n').some((l) => l.split('/').pop()!.startsWith(n) || l.includes(`/${n}.app/`));
}

export { focusLeft };
