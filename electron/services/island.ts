// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's live state: shelf, clipboard history, focus timer, keep-awake,
// download and screenshot alerts, coding agents, calendar, now playing,
// weather and battery. (Dictation lives in electron/services/voice.)

import { app, globalShortcut, nativeImage, Notification, powerMonitor, powerSaveBlocker, shell } from 'electron';
import { exec } from 'node:child_process';
import { existsSync, promises as fsp, readFileSync, watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DevicesState, IslandAlert, IslandState, KeepAwakeOptions, KeepAwakeState, NowPlaying, ShelfAction } from '../../core/api';
import { activeTriggers, describeTrigger, type TriggerKind } from '../../core/awake';
import { kindOf, looksLikeScreenshot } from '../../core/classify';
import type { FileIndex } from '../../core/indexer';
import {
  ClipHistory, detectClipKind, extendFocus, focusLeft, looksSecret, newFocus, parseIcs, pauseFocus, resumeFocus, startFocus, stopFocus, systemPause, systemResume, tickFocus,
  type AgentSession, type CalendarEvent, type ClipItem, type FocusState, type LyricLine,
} from '../../core/island';
import { powershell, run } from '../../core/platform';
import * as shelves from '../../core/shelves';
import { cleanLink, isUrl } from '../../core/textools';
import type { FileEntry } from '../../core/types';
import { fetchWeather, type Weather } from '../../core/weather';
import { getSecret, settings } from '../store';
import { lyricsFor, mediaAction, micInUse, nowPlaying, watchMic } from './media';
import { cameraInUse } from './island-place';
import { readBattery } from './system';
import { clipboardChanged, hasImage, readFileList, readImage, readText, writeImage, writePaths, writeText } from './clip';
import { devicesState, frontmostApp, frontmostFullscreen, setBrightness, setMuted, setVolume, snapshot, touchDrive } from './devices';
import { NotificationMirror } from './notify-mirror';
import { wantNotification } from '../../core/island-notify';
import { scanAgentSessions, scanMoreAgents } from '../../core/island-scan';
import { lyricsFor as lyricsOn, plusSetting } from '../../core/island-plus';
import { uploadFile } from './upload';
import { poll, pollNow } from './governor';
import { featureOn, onFeature } from './features';
import { PasteQueue } from '../../core/paste-queue';

/** Things the Island borrows from the rest of the app (set by electron/ipc/island.ts). */
export interface IslandHooks {
  compress?(paths: string[]): Promise<string>;
  readText?(paths: string[]): Promise<{ path: string; text: string }[]>;
  move?(paths: string[], dir: string): Promise<{ removed: number }>;
  copy?(paths: string[], dir: string): Promise<{ removed: number }>;
  resize?(paths: string[], width: number): Promise<string[]>;
  ocrImage?(img: Electron.NativeImage): Promise<string>;
  pickFolder?(): Promise<string | null>;
  confirm?(message: string, detail: string): Promise<boolean>;
  /** called when the Island should hide or show (full-screen apps, the hide shortcut) */
  onVisibility?(hidden: boolean): void;
}

const PARTIAL = /\.(crdownload|part|partial|download|opdownload|tmp|!ut)$/i;

export class IslandService {
  store: shelves.ShelfStore = shelves.newStore();
  clips = new ClipHistory(200, 30);
  /** paste one by one (core/paste-queue.ts) */
  queue = new PasteQueue();
  devices?: DevicesState;
  hooks: IslandHooks = {};
  /** reasons the automatic keep-awake rules are holding the computer awake */
  awakeTriggers: string[] = [];
  private autoAwake = false;
  private userHidden = false;
  private fsHidden = false;
  /** other apps' notifications (read by Island+ for its status) */
  mirror = new NotificationMirror();
  /** calls, levels, cues and the usage ring (electron/services/island-plus.ts) */
  plus?: import('./island-plus').IslandPlus;
  private entryCache = new Map<string, FileEntry>();
  private lastDriveTouch = 0;
  focus: FocusState = newFocus();
  awake: KeepAwakeState = { on: false };
  agents: AgentSession[] = [];
  events: CalendarEvent[] = [];
  playing?: NowPlaying;
  lyrics?: LyricLine[];
  weather?: Weather;
  battery?: { percent: number; charging: boolean; lowPower?: boolean };
  mic: string[] = [];
  private micEvents?: () => void;
  /** apps using a camera (Windows, Linux) */
  cam: string[] = [];
  alerts: IslandAlert[] = [];
  /** set while a screen recording runs */
  recording?: { since: number };
  private blocker: number | null = null;
  private timers: NodeJS.Timeout[] = [];
  private stopPolls?: () => void;
  private watchers: FSWatcher[] = [];
  private lastClip = '';
  private lastImageSig = '';
  private activeSince = Date.now();
  /** Stage mode's view of the Island while it is on: private things hidden, its live activity (electron/ipc/stage.ts) */
  stageView?: (s: IslandState) => IslandState;
  /** Monorail's workspace and slide (Settings → Ashforde apps), set by ipc/ashforde */
  monorail?: import('../../core/ashforde/monorail').MonorailState;
  /** told when a Focus session or presentation mode starts or ends (Monorail follows them) */
  modeHook?: (kind: 'focus' | 'presentation', on: boolean) => void;
  /** a focus session ended: its focused minutes and its task, for Insights and the task (electron/services/pim) */
  focusLog?: (minutes: number, taskId?: string) => void;
  /** says why a Focus session cannot be stopped now (strict Focus blocking), or nothing */
  stopGuard?: () => string | undefined;
  private lastFocusOn = false;
  private file = path.join(app.getPath('userData'), 'island.json');

  constructor(private index: FileIndex, private emit: () => void) {}

  async start() {
    await this.load();
    // Every regular look goes through the governor: it slows down when nobody is at the
    // computer, pauses while the screen is locked, and speeds up again on return.
    const win = process.platform === 'win32';
    const stops = [
      // While nobody is at the computer, copies are rare: look far less often.
      poll('island.clipboard', { baseMs: 700, idleFactor: 10, pauseWhenLocked: true }, () => this.pollClipboard(), { feature: 'clipboard' }),
      // Once a second only while a focus timer runs or music plays; otherwise break reminders need far less.
      poll('island.tick', () => ({ baseMs: (this.focus.mode !== 'idle' && this.focus.pausedLeft === undefined) || this.playing?.playing ? 1000 : 15_000, idleFactor: this.focus.mode !== 'idle' ? 1 : 2 }), () => this.tick(), { feature: 'focus' }),
      poll('island.agents', { baseMs: 5000, idleFactor: 3, pauseWhenLocked: true }, () => this.pollAgents(), { feature: 'agents' }),
      poll('island.media', () => ({ baseMs: this.playing?.playing ? (win ? 5000 : 2500) : this.playing ? 10_000 : 15_000, idleFactor: this.playing?.playing ? 1.5 : 3, pauseWhenLocked: true }), () => this.pollMedia(), { feature: 'media' }),
      // Keep-awake has to notice its end even while nobody touches the computer.
      // (the Keep Awake service checks on its own, and only while a session or a trigger needs it)
      ...(this.awakeDriver ? [] : [poll('island.awake', { baseMs: 15_000, idleFactor: 1 }, () => this.checkAwake(), { feature: 'keepAwake' })]),
      poll('island.battery', { baseMs: 120_000, idleFactor: 2, pauseWhenLocked: true }, () => this.pollBattery(), { feature: 'island' }),
      poll('island.devices', { baseMs: 60_000, idleFactor: 3, pauseWhenLocked: true }, () => this.refreshDevices(), { feature: 'island' }),
      poll('island.housekeeping', { baseMs: 10_000, idleFactor: 1 }, () => this.housekeeping(), { feature: 'island' }),
      poll('island.fullscreen', () => ({ baseMs: settings().island.hideInFullscreen ? (win ? 5000 : 2500) : 60_000, idleFactor: 4, pauseWhenLocked: true }), () => this.checkFullscreen(), { feature: 'island' }),
      // With a microphone event stream the regular look is only a safety net.
      poll('island.mic', () => ({ baseMs: this.micEvents ? 120_000 : 10_000, idleFactor: this.micEvents ? 1 : 3, pauseWhenLocked: true }), () => this.pollMic(), { feature: 'micIndicator' }),
      poll('island.calendar', { baseMs: 15 * 60_000, idleFactor: 2, pauseWhenLocked: true }, () => this.pollCalendar(), { feature: 'calendar' }),
      poll('island.weather', { baseMs: 20 * 60_000, idleFactor: 2, pauseWhenLocked: true }, () => this.pollWeather(), { feature: 'islandWeather' }),
    ];
    // Switching a part off in Settings → Features clears what it showed and stops what it holds.
    const offs = [
      onFeature('notifyMirror', (on) => { if (!on) this.mirror.stop(); }),
      onFeature('keepAwake', (on) => { if (!on && this.awake.on && !this.awakeDriver) this.keepAwake(false); this.emit(); }),
      onFeature('media', (on) => { if (!on && this.playing) { this.playing = undefined; this.lyrics = undefined; this.lastTrack = ''; this.emit(); } }),
      onFeature('micIndicator', (on) => { if (!on && this.mic.length) { this.mic = []; this.emit(); } }),
      onFeature('islandWeather', (on) => { if (!on && this.weather) { this.weather = undefined; this.emit(); } }),
      onFeature('agents', (on) => { if (!on && this.agents.length) { this.agents = []; this.emit(); } }),
      // The Downloads and screenshot folder watchers serve the Island's shelf and alerts.
      onFeature('island', (on) => {
        if (on) void this.watchFolders();
        else { this.watchers.forEach((w) => w.close()); this.watchers = []; }
      }),
    ];
    const micWatch = () => {
      this.micEvents?.();
      this.micEvents = featureOn('micIndicator') ? watchMic(() => pollNow('island.mic'), () => { this.micEvents = undefined; pollNow('island.mic'); }) : undefined;
    };
    micWatch();
    offs.push(onFeature('micIndicator', () => micWatch()));
    this.stopPolls = () => { stops.forEach((s) => s()); offs.forEach((o) => o()); this.micEvents?.(); this.micEvents = undefined; };
    // Plugging in or unplugging shows straight away.
    powerMonitor.on('on-ac', () => pollNow('island.battery'));
    powerMonitor.on('on-battery', () => pollNow('island.battery'));
    // A focus session waits while the computer sleeps or is locked, and carries on when the person is back.
    const away = () => this.focusAway(true);
    const back = () => this.focusAway(false);
    for (const e of ['suspend', 'lock-screen'] as const) powerMonitor.on(e as 'suspend', away);
    for (const e of ['resume', 'unlock-screen'] as const) powerMonitor.on(e as 'resume', back);
    const stopPolls = this.stopPolls;
    this.stopPolls = () => {
      stopPolls?.();
      for (const e of ['suspend', 'lock-screen'] as const) powerMonitor.off(e as 'suspend', away);
      for (const e of ['resume', 'unlock-screen'] as const) powerMonitor.off(e as 'resume', back);
    };
    if (featureOn('island')) await this.watchFolders();
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.stopPolls?.();
    this.mirror.stop();
    this.watchers.forEach((w) => w.close());
    if (this.blocker !== null) powerSaveBlocker.stop(this.blocker);
    void this.save();
  }

  /** events from Mail & Calendar (next to the calendar link's) */
  pimEvents: CalendarEvent[] = [];
  /** countdown timers from Alarms */
  countdowns: NonNullable<IslandState['countdowns']> = [];

  setPimEvents(evs: CalendarEvent[]) {
    this.pimEvents = evs;
    this.emit();
  }

  /** reminders ringing now (Mail & Calendar's task list) */
  dueReminders: NonNullable<IslandState['dueReminders']> = [];

  setDueReminders(list: NonNullable<IslandState['dueReminders']>) {
    if (JSON.stringify(list) === JSON.stringify(this.dueReminders)) return;
    this.dueReminders = list;
    this.emit();
  }

  setCountdowns(t: NonNullable<IslandState['countdowns']>) {
    if (JSON.stringify(t) === JSON.stringify(this.countdowns)) return;
    this.countdowns = t;
    this.emit();
  }

  state(): IslandState {
    const raw = this.rawState();
    const st = this.plus ? this.plus.decorate(raw) : raw;
    return this.stageView ? this.stageView(st) : st;
  }

  /** Tells the Island windows to look again (Stage mode started or ended). */
  refresh() {
    this.emit();
  }

  private rawState(): IslandState {
    const s = settings();
    const breakIn = s.island.breakEvery > 0 ? Math.max(0, s.island.breakEvery * 60_000 - (Date.now() - this.activeSince)) : undefined;
    const views = this.store.shelves.map((sh) => ({ id: sh.id, name: sh.name, color: sh.color, pinned: sh.pinned, items: sh.items.map((p) => this.entryOf(p)).filter((e): e is FileEntry => !!e) }));
    return {
      shelf: views.find((v) => v.id === this.store.active)?.items ?? [], shelves: views, activeShelf: this.store.active,
      closedShelves: this.store.closed.map((c) => ({ id: c.id, name: c.name, color: c.color, count: c.items.length })),
      devices: this.devices, awakeTriggers: this.awakeTriggers, awakeAvailable: featureOn('keepAwake'), hidden: this.userHidden || this.fsHidden,
      clips: this.clips.items, pasteQueue: this.queueView(), focus: this.focus, keepAwake: this.awake, agents: this.agents, events: [...this.events, ...this.pimEvents].sort((a, b) => a.start - b.start), countdowns: this.countdowns, dueReminders: this.dueReminders,
      nowPlaying: this.playing, lyrics: this.lyrics, weather: this.weather, battery: this.battery, micInUse: this.mic, camInUse: this.cam, alerts: this.alerts, breakIn, recording: this.recording,
      monorail: this.monorail,
    };
  }

  // ---------------------------------------------------------------- persistence

  private async load() {
    try {
      const d = JSON.parse(await fsp.readFile(this.file, 'utf8')) as { shelf?: string[]; shelves?: unknown; clips?: ClipItem[]; focus?: FocusState };
      this.clips.items = (d.clips ?? []).filter((c) => c && c.id).map((c) => ({ ...c, kind: c.kind ?? 'text' }));
      // Older versions kept one shelf as a plain list.
      this.store = d.shelves ? shelves.normalizeStore(d.shelves) : shelves.addItems(shelves.newStore(), d.shelf ?? []);
      this.store = shelves.prune(this.store, existsSync);
      for (const sh of this.store.shelves) for (const p of sh.items) await this.loadEntry(p);
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
      const data = { shelves: this.store, clips: this.clips.items, focus: this.focus };
      void fsp.writeFile(this.file, JSON.stringify(data)).catch(() => undefined);
    }, 500);
  }

  /** Monorail's state changed (or it was switched off): show it without saving anything. */
  setMonorail(m: import('../../core/ashforde/monorail').MonorailState | undefined) {
    if (JSON.stringify(m) === JSON.stringify(this.monorail)) return;
    this.monorail = m;
    this.emit();
  }

  private changed() {
    const focusOn = this.focus.mode === 'focus';
    if (focusOn !== this.lastFocusOn) {
      this.lastFocusOn = focusOn;
      this.modeHook?.('focus', focusOn);
    }
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

  // ---------------------------------------------------------------- shelves

  private entryOf(p: string): FileEntry | undefined {
    return this.index.files.get(p) ?? this.entryCache.get(p);
  }

  /** Shelves can hold files from anywhere, not just indexed folders. */
  private async loadEntry(p: string): Promise<FileEntry | undefined> {
    const known = this.index.files.get(p);
    if (known) return known;
    try {
      const st = await fsp.stat(p);
      const e = this.index.makeEntry(p, st);
      this.entryCache.set(p, e);
      return e;
    } catch {
      return undefined;
    }
  }

  private setStore(next: shelves.ShelfStore) {
    this.store = next;
    this.changed();
  }

  async addToShelf(paths: string[], id?: string) {
    const ok: string[] = [];
    // With "keep copies" on, the shelf holds its own copies (Settings → Island).
    const kept = await (await import('./island-tools')).keepShelfCopies(paths).catch(() => paths);
    for (const p of kept) if (await this.loadEntry(p)) ok.push(p);
    this.setStore(shelves.addItems(this.store, ok, id ?? this.store.active));
  }

  removeFromShelf(p: string) { this.setStore(shelves.removeItem(this.store, p)); }
  clearShelf() { this.setStore(shelves.clearShelf(this.store)); }
  createShelf(name?: string) { this.setStore(shelves.createShelf(this.store, name).store); }
  selectShelf(id: string) { if (this.store.shelves.some((s) => s.id === id)) this.setStore({ ...this.store, active: id }); }
  renameShelf(id: string, name: string) { this.setStore(shelves.renameShelf(this.store, id, name)); }
  setShelfColor(id: string, color: string) { this.setStore(shelves.setShelfColor(this.store, id, color)); }
  pinShelf(id: string) { this.setStore(shelves.togglePin(this.store, id)); }
  closeShelf(id: string) { this.setStore(shelves.closeShelf(this.store, id)); }
  reopenShelf(id: string) { this.setStore(shelves.reopenShelf(this.store, id)); }
  moveShelfItem(from: number, to: number) { this.setStore(shelves.moveItem(this.store, from, to)); }

  /** Renames a file on disk from the shelf; every shelf follows it. */
  async renameShelfItem(p: string, name: string) {
    const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim();
    if (!clean) throw new Error('A name cannot be empty');
    const to = path.join(path.dirname(p), clean);
    if (to === p) return;
    if (existsSync(to)) throw new Error(`“${clean}” already exists there`);
    await fsp.rename(p, to);
    if (this.index.files.has(p)) this.index.rename(p, to);
    this.entryCache.delete(p);
    await this.loadEntry(to);
    this.setStore(shelves.renamePath(this.store, p, to));
  }

  /** Runs an action on the active shelf (or the given files). */
  async shelfAction(action: ShelfAction, arg?: string, given?: string[]): Promise<{ message: string; link?: string }> {
    const paths = (given?.length ? given : shelves.activeShelf(this.store).items).filter((p) => existsSync(p));
    if (!paths.length) throw new Error('The shelf is empty');
    const n = `${paths.length} item${paths.length === 1 ? '' : 's'}`;
    switch (action) {
      case 'copyPaths':
        await writePaths(paths);
        return { message: `Copied ${n}` };
      case 'zip': {
        if (!this.hooks.compress) throw new Error('Zipping is not available');
        const out = await this.hooks.compress(paths);
        await this.addToShelf([out]);
        return { message: `Created ${path.basename(out)}` };
      }
      case 'copyText': {
        if (!this.hooks.readText) throw new Error('Reading text is not available');
        const texts = (await this.hooks.readText(paths)).map((t) => t.text.trim()).filter(Boolean);
        if (!texts.length) return { message: 'No text found in these files' };
        await writeText(texts.join('\n\n'));
        return { message: `Copied text from ${texts.length} file${texts.length === 1 ? '' : 's'}` };
      }
      case 'moveTo':
      case 'copyTo': {
        const dir = arg || (await this.hooks.pickFolder?.());
        if (!dir) return { message: 'Cancelled' };
        const fn = action === 'moveTo' ? this.hooks.move : this.hooks.copy;
        if (!fn) throw new Error('Not available');
        const r = await fn(paths, dir);
        if (action === 'moveTo') {
          let st = this.store;
          for (const p of paths) st = shelves.renamePath(st, p, path.join(dir, path.basename(p)));
          for (const sh of st.shelves) for (const p of sh.items) await this.loadEntry(p);
          this.setStore(shelves.prune(st, existsSync));
        }
        return { message: `${action === 'moveTo' ? 'Moved' : 'Copied'} ${r.removed} to ${path.basename(dir)}` };
      }
      case 'resize': {
        if (!this.hooks.resize) throw new Error('Image resizing is not available in this build');
        const out = await this.hooks.resize(paths, Number(arg) || 1600);
        if (out.length) await this.addToShelf(out);
        return { message: `Resized ${out.length} image${out.length === 1 ? '' : 's'}` };
      }
      case 'script': {
        const act = settings().island.scriptActions.find((a) => a.id === arg);
        if (!act) throw new Error('That action no longer exists');
        const cmd = shelves.fillCommand(act.command, paths, process.platform === 'win32' ? shelves.winQuote : shelves.shQuote);
        const ok = this.hooks.confirm ? await this.hooks.confirm(`Run “${act.name}” on ${n}?`, cmd) : true;
        if (!ok) return { message: 'Cancelled' };
        const out = await new Promise<{ code: number; text: string }>((resolve) => {
          exec(cmd, { cwd: path.dirname(paths[0]), timeout: 10 * 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
            resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, text: (stderr || stdout || '').trim().split('\n').slice(-1)[0] ?? '' }));
        });
        return { message: out.code === 0 ? `${act.name}: done${out.text ? ` — ${out.text.slice(0, 120)}` : ''}` : `${act.name} failed (${out.code})${out.text ? `: ${out.text.slice(0, 160)}` : ''}` };
      }
      case 'upload': {
        const cfg = settings().island.upload;
        const secret = await getSecret('upload');
        const links: string[] = [];
        for (const p of paths) links.push(await uploadFile(p, cfg, secret));
        await writeText(links.join('\n'));
        return { message: `Uploaded ${n} — link${links.length === 1 ? '' : 's'} copied`, link: links[0] };
      }
    }
  }

  // ---------------------------------------------------------------- clipboard

  private polling = false;
  private async pollClipboard() {
    const s = settings().island;
    if (!s.clipboard || this.polling) return;
    this.polling = true;
    try {
      // Nothing copied since the last look (macOS asks the system's counter): nothing to read.
      if (!(await clipboardChanged())) return;
      await this.readClipboard(s.cleanLinks);
    } finally {
      this.polling = false;
    }
  }

  private async readClipboard(cleanLinks: boolean) {
    const s = settings().island;
    this.clips.max = Math.max(10, s.clipMax);
    this.clips.maxAgeDays = Math.max(0, s.clipRetentionDays);
    const text = await readText();
    if (text && text !== this.lastClip) {
      this.lastClip = text;
      const source = await frontmostApp().catch(() => undefined);
      // Copies made inside password managers and other ignored apps are never kept.
      if (source && s.clipIgnoreApps.some((a) => a && source.toLowerCase().includes(a.toLowerCase()))) return;
      // Copies the app marked secret or short-lived (password managers, one-time codes) are never kept either.
      if (await (await import('./clip-formats')).clipboardIsConcealed().catch(() => false)) return;
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
      if (looksSecret(value) || value.length >= 100_000) return;
      const item = this.clips.add({ kind: detectClipKind(value), text: value, source });
      if (!item) return;
      void this.queueCopied(item.id);
      this.changed();
      if (item.kind === 'link' && s.clipFetchTitles) void this.fetchTitle(item.id, value);
      return;
    }
    if (!text) {
      const files = await readFileList();
      const joined = files.join('\n');
      if (files.length && joined !== this.lastClip) {
        this.lastClip = joined;
        const it = this.clips.add({ kind: 'file', text: joined, source: await frontmostApp().catch(() => undefined) });
        if (it) { void this.queueCopied(it.id); this.changed(); }
        return;
      }
    }
    if (!text && (await hasImage())) {
      const img = await readImage();
      if (!img) return;
      const { width, height } = img.getSize();
      const sig = imageSig(img);
      if (sig === this.lastImageSig) return;
      this.lastImageSig = sig;
      const thumb = img.resize({ width: Math.min(320, width) }).toDataURL();
      const item = this.clips.add({ kind: 'image', image: thumb, text: `Image ${width}×${height}`, source: await frontmostApp().catch(() => undefined) });
      if (!item) return;
      void this.queueCopied(item.id);
      this.changed();
      // Read the text in the copied image so it can be found later.
      if (this.hooks.ocrImage) {
        void this.hooks.ocrImage(img).then((t) => {
          if (t.trim()) {
            this.clips.update(item.id, { ocr: t.trim() });
            this.changed();
          }
        }).catch(() => undefined);
      }
    }
  }

  private async fetchTitle(id: string, url: string) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'text/html' } });
      const html = (await res.text()).slice(0, 200_000);
      const title = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
      if (title) {
        this.clips.update(id, { title });
        this.changed();
      }
    } catch {
      /* offline or not HTML */
    }
  }

  async copyClip(id: string) {
    const c = this.clips.items.find((x) => x.id === id);
    if (!c) return;
    if (c.kind === 'image' && c.image) {
      // Only the stored preview is available; good enough for pasting a quick image.
      await writeImage(nativeImage.createFromDataURL(c.image));
    } else if (c.kind === 'file' && c.text) {
      await writePaths(c.text.split('\n'));
      this.lastClip = c.text;
    } else if (c.text) {
      await writeText(c.text);
      this.lastClip = c.text;
    }
    this.clips.add({ kind: c.kind, image: c.image, text: c.text, source: c.source });
    this.changed();
  }

  /** Copies a clip and pastes it into the app in front. */
  async pasteClip(id: string) {
    await this.copyClip(id);
    await new Promise((r) => setTimeout(r, 120));
    await pasteKeystroke();
  }

  /** Puts a clip on the clipboard without moving it in the history (the queue's next one). */
  private async putOnClipboard(c: ClipItem) {
    if (c.kind === 'image' && c.image) await writeImage(nativeImage.createFromDataURL(c.image));
    else if (c.kind === 'file' && c.text) await writePaths(c.text.split('\n'));
    else if (c.text) await writeText(c.text);
    if (c.kind === 'image') {
      // What we put there is not a new copy.
      const back = await readImage();
      if (back) this.lastImageSig = imageSig(back);
    } else this.lastClip = c.text ?? this.lastClip;
  }

  // ---------------------------------------------------------------- paste one by one

  private queueView(): IslandState['pasteQueue'] {
    const v = this.queue.view();
    if (!v) return undefined;
    const head = this.queue.peek();
    const c = head ? this.clips.get(head) : undefined;
    return { ...v, next: c ? (c.kind === 'image' ? 'An image' : (c.text ?? '').slice(0, 120)) : undefined };
  }

  /** While collecting, a new copy joins the queue and the first one stays on the clipboard, ready. */
  private async queueCopied(id: string) {
    if (!this.queue.copied(id)) return;
    const head = this.queue.peek();
    if (head && head !== id) {
      const c = this.clips.get(head);
      if (c) await this.putOnClipboard(c);
    }
    this.changed();
  }

  /** Called with the paste listener's events (typing.ts) while a queue runs. */
  queuePasted = () => {
    if (!this.queue.active || this.queue.collecting && !this.queue.items.length) return;
    // The app reads the clipboard as the keys go down: the next one goes on it a moment later.
    setTimeout(() => void this.queueAdvance(), 250);
  };

  private async queueAdvance() {
    const next = this.queue.took();
    if (next) {
      const c = this.clips.get(next);
      if (c) await this.putOnClipboard(c);
    } else this.queueEnded(true);
    this.changed();
  }

  private queueListening = false;
  private queueFeatureWatch?: () => void;
  private async queueHooks(on: boolean) {
    const acc = settings().island.pasteNextShortcut;
    if (on) {
      // Clipboard history switched off: the queue ends with it.
      this.queueFeatureWatch ??= onFeature('clipboard', (yes) => { if (!yes && this.queue.active) this.queueStop(); });
      try { if (acc && !globalShortcut.isRegistered(acc)) globalShortcut.register(acc, () => void this.queueNext()); } catch { /* taken or not valid */ }
      if (settings().island.queueOnPaste && !this.queueListening) {
        this.queueListening = true;
        const { listen } = await import('./typing');
        await listen('pasteQueue', (e) => { if (e.t === 'paste') this.queuePasted(); });
      }
    } else {
      try { if (acc) globalShortcut.unregister(acc); } catch { /* not ours */ }
      if (this.queueListening) {
        this.queueListening = false;
        const { unlisten } = await import('./typing');
        unlisten('pasteQueue');
      }
    }
  }

  private queueEnded(done: boolean) {
    this.queue.stop();
    void this.queueHooks(false);
    if (done) this.alert({ kind: 'info', title: 'Pasted them all', detail: 'The paste queue is empty' });
  }

  /** Starts a queue: with ids, ready to paste them in order; without, what is copied next joins. */
  async queueStart(ids?: string[]) {
    const known = (ids ?? []).filter((id) => this.clips.get(id));
    this.queue.start(known);
    const head = this.queue.peek();
    if (head) await this.putOnClipboard(this.clips.get(head)!);
    await this.queueHooks(true);
    this.changed();
  }

  /** Pastes the next one into the app in front (the shortcut, or the Island's button). */
  async queueNext() {
    const head = this.queue.peek();
    if (!head) { if (this.queue.active && !this.queue.items.length) this.alert({ kind: 'info', title: 'Nothing to paste yet', detail: 'Copy what you want to paste one by one' }); return; }
    const c = this.clips.get(head);
    if (c) {
      await this.putOnClipboard(c);
      await new Promise((r) => setTimeout(r, 80));
      // Our own paste is not the person's: the listener's ⌘V is left out for a moment.
      if (this.queueListening) (await import('./typing')).quiet(600);
      await pasteKeystroke();
      await new Promise((r) => setTimeout(r, 250));
    }
    await this.queueAdvance();
  }

  queueStop() {
    this.queueEnded(false);
    this.changed();
  }

  /** Pastes what is on the clipboard as plain text (formatting dropped), then puts it back as it was. */
  async pastePlain() {
    const text = await readText();
    if (!text) return;
    const { clipboard, ClipboardItem } = await import('electron');
    // Everything on the clipboard now (rich text, HTML), read out so it can go back afterwards.
    const kept: Record<string, Blob>[] = [];
    try {
      for (const item of await clipboard.read()) {
        const parts: Record<string, Blob> = {};
        for (const t of item.types) parts[t] = (await item.getType(t)) as Blob;
        kept.push(parts);
      }
    } catch { /* nothing readable */ }
    const rich = kept.some((k) => Object.keys(k).some((t) => t !== 'text/plain'));
    this.lastClip = text;
    await writeText(text);
    await new Promise((r) => setTimeout(r, 60));
    await pasteKeystroke();
    // The formatting comes back for the next ordinary paste.
    if (rich) setTimeout(() => void (async () => { if ((await readText()) === text) await clipboard.write(kept.map((k) => new ClipboardItem(k))).catch(() => undefined); })(), 700);
  }

  /** Never keep copies from this app again; the ones kept from it go too (pinned and filed ones stay). */
  async neverKeepFrom(appName: string): Promise<number> {
    const name = appName.trim();
    if (!name) return 0;
    const { updateSettings } = await import('../store');
    const isl = settings().island;
    if (!isl.clipIgnoreApps.some((a) => a.toLowerCase() === name.toLowerCase())) await updateSettings({ island: { ...isl, clipIgnoreApps: [...isl.clipIgnoreApps, name] } });
    const before = this.clips.items.length;
    this.clips.items = this.clips.items.filter((c) => c.pinned || c.collections?.length || (c.source ?? '').toLowerCase() !== name.toLowerCase());
    for (const id of [...this.queue.items]) if (!this.clips.get(id)) this.queue.drop(id);
    this.changed();
    return before - this.clips.items.length;
  }

  updateClip(id: string, patch: { note?: string }) {
    this.clips.update(id, { note: patch.note?.slice(0, 2000) });
    this.changed();
  }

  toggleClipCollection(id: string, name: string) {
    this.clips.toggleCollection(id, name);
    this.changed();
  }

  importClips(json: string): number {
    const n = this.clips.import(json);
    this.changed();
    return n;
  }

  pinClip(id: string) { this.clips.togglePin(id); this.changed(); }
  removeClip(id: string) { this.clips.remove(id); this.queue.drop(id); this.changed(); }
  clearClips() { this.clips.clear(); this.changed(); }

  // ---------------------------------------------------------------- focus & breaks

  /**
   * start (a countdown of `minutes`), stopwatch (counting up), pause, resume,
   * extend (+`minutes`, 5 by default) or stop. A session can be for a task:
   * its focused minutes are logged on it when it ends.
   */
  focusAction(action: 'start' | 'stopwatch' | 'pause' | 'resume' | 'stop' | 'extend', minutes?: number, o: { taskId?: string; taskTitle?: string } = {}): FocusState {
    const refused = action === 'stop' && this.focus.mode === 'focus' ? this.stopGuard?.() : undefined;
    if (refused) {
      this.alert({ kind: 'focus', title: 'Strict mode is on', detail: refused });
      return this.focus;
    }
    if (action === 'start' || action === 'stopwatch') {
      // Starting over a running session ends that one first (and logs it).
      if (this.focus.mode === 'focus') this.endFocus();
      const is = settings().island;
      this.focus = startFocus({ ...this.focus, longEvery: plusSetting(is, 'longBreakEvery'), longBreakMin: plusSetting(is, 'longBreakMin') }, minutes ?? this.focus.focusMin, Date.now(), { stopwatch: action === 'stopwatch', taskId: o.taskId, taskTitle: o.taskTitle });
      // Focus sessions keep the computer awake (a stopwatch until it is stopped).
      if (!this.awake.on) this.keepAwake(true, this.focus.stopwatch ? {} : { until: this.focus.endsAt }, 'Focus session');
    } else if (action === 'pause') this.focus = pauseFocus(this.focus);
    else if (action === 'resume') this.focus = resumeFocus(this.focus);
    else if (action === 'extend') {
      this.focus = extendFocus(this.focus, minutes ?? 5);
      if (this.awake.reason === 'Focus session' && this.focus.pausedLeft === undefined && this.focus.endsAt) this.keepAwake(true, { until: this.focus.endsAt }, 'Focus session');
    } else this.endFocus();
    this.changed();
    return this.focus;
  }

  private endFocus() {
    const r = stopFocus(this.focus);
    this.focus = r.state;
    if (r.minutes >= 1) this.focusLog?.(r.minutes, r.taskId);
    if (this.awake.reason === 'Focus session') this.keepAwake(false);
  }

  /** Sleep or lock pauses a running session; waking or unlocking carries it on (only one the system paused). */
  private focusAway(away: boolean) {
    const next = away ? systemPause(this.focus) : systemResume(this.focus);
    if (next === this.focus) return;
    this.focus = next;
    this.changed();
  }

  private tick() {
    const { state, event, minutes } = tickFocus(this.focus);
    if (event) {
      this.focus = state;
      if (event === 'focus-done') {
        if ((minutes ?? 0) >= 1) this.focusLog?.(minutes!, state.taskId);
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

  /** Set by the Keep Awake service (electron/services/awake): sessions, triggers and holds live there. */
  awakeDriver?: (on: boolean, options: KeepAwakeOptions, reason?: string) => KeepAwakeState;

  /** The Keep Awake service tells the Island what is going on, so the Island, tray and palette show it. */
  mirrorAwake(state: KeepAwakeState, matching: string[]) {
    const same = JSON.stringify(state) === JSON.stringify(this.awake) && matching.join('\n') === this.awakeTriggers.join('\n');
    this.awake = state;
    this.awakeTriggers = matching;
    if (!same) this.emit();
  }

  keepAwake(on: boolean, options: KeepAwakeOptions = {}, reason?: string): KeepAwakeState {
    if (this.awakeDriver) return this.awakeDriver(on, options, reason);
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
    if (this.awakeDriver) return;
    await this.checkTriggers();
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

  /** Starts or ends the automatic session from the user's keep-awake rules. */
  private async checkTriggers() {
    const rules = settings().island.awakeTriggers.filter((t) => t.enabled);
    if (!rules.length) {
      if (this.autoAwake) this.endAuto('No keep-awake rules are on');
      return;
    }
    const snap = await snapshot(new Set<TriggerKind>(rules.map((r) => r.kind)));
    const active = activeTriggers(rules, snap);
    const reasons = active.map(describeTrigger);
    const changed = reasons.join() !== this.awakeTriggers.join();
    this.awakeTriggers = reasons;
    if (active.length && !this.awake.on) {
      this.keepAwake(true, { allowDisplaySleep: active.every((t) => t.allowDisplaySleep) }, reasons[0]);
      this.autoAwake = true;
      this.alert({ kind: 'info', title: 'Keeping awake', detail: reasons.join(' · ') });
    } else if (!active.length && this.autoAwake) {
      this.endAuto('The conditions no longer apply');
    } else if (changed) this.emit();
  }

  private endAuto(why: string) {
    this.autoAwake = false;
    this.awakeTriggers = [];
    if (this.awake.on) {
      this.keepAwake(false);
      this.alert({ kind: 'info', title: 'Keep awake ended', detail: why });
    }
  }

  async awakeStatus(): Promise<{ active: string[]; snapshot: Record<string, unknown> }> {
    const rules = settings().island.awakeTriggers;
    const snap = await snapshot(new Set<TriggerKind>(['app', 'usb', 'wifi', 'drive']));
    return { active: activeTriggers(rules, snap).map(describeTrigger), snapshot: { ...snap, apps: snap.apps.slice(0, 200) } as unknown as Record<string, unknown> };
  }

  // ---------------------------------------------------------------- devices, visibility, mirrored notifications

  /** `fresh`: asked by the person (the Island's refresh), so nothing cached is reused. */
  async refreshDevices(fresh = false): Promise<DevicesState> {
    this.devices = await devicesState({ fresh });
    this.emit();
    return this.devices;
  }

  async setVolume(v: number) {
    this.plus?.quietLevel('volume', v);
    await setVolume(v);
    if (this.devices) this.devices = { ...this.devices, volume: Math.round(v), muted: false };
    this.emit();
  }

  async setMuted(m: boolean) {
    await setMuted(m);
    if (this.devices) this.devices = { ...this.devices, muted: m };
    this.emit();
  }

  async setBrightness(id: string, v: number) {
    await setBrightness(id, v);
    if (this.devices) this.devices = { ...this.devices, monitors: this.devices.monitors.map((m) => (m.id === id ? { ...m, brightness: Math.round(v) } : m)) };
    this.emit();
  }

  hide(hidden: boolean) {
    this.userHidden = hidden;
    this.hooks.onVisibility?.(this.userHidden || this.fsHidden);
    this.emit();
  }

  get hidden() {
    return this.userHidden || this.fsHidden;
  }

  private async checkFullscreen() {
    if (!settings().island.hideInFullscreen) {
      if (this.fsHidden) {
        this.fsHidden = false;
        this.hooks.onVisibility?.(this.userHidden);
      }
      return;
    }
    const fs = await frontmostFullscreen().catch(() => false);
    if (fs !== this.fsHidden) {
      this.fsHidden = fs;
      this.hooks.onVisibility?.(this.userHidden || this.fsHidden);
    }
  }

  /** Mirrored notifications, the drive keep-alive and clipboard limits follow settings. */
  private async housekeeping() {
    const s = settings().island;
    if (s.notifyMirror) {
      this.mirror.start((n) => {
        const is = settings().island;
        if (!wantNotification(n.app, is.notifyApps, is.notifyBlock ?? [])) return;
        this.alert({ kind: 'notification', app: n.app, title: n.title, detail: n.body });
      }, { dismiss: !!s.notifyDismiss });
    } else this.mirror.stop();
    const drive = s.driveKeepAwake;
    if (drive?.path && Date.now() - this.lastDriveTouch >= Math.max(10, drive.seconds) * 1000) {
      this.lastDriveTouch = Date.now();
      await touchDrive(drive.path);
    }
  }

  // Presentation mode moved to Stage mode (electron/services/stage), which keeps its behaviour.

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
    const active = shelves.activeShelf(this.store);
    if (!active.items.includes(p)) {
      this.entryCache.set(p, entry);
      // New arrivals go to the front of the shelf.
      this.setStore(shelves.moveItem(shelves.addItems(this.store, [p]), active.items.length, 0));
    }
  }

  // ---------------------------------------------------------------- agents

  private async pollAgents() {
    if (!settings().island.agents) return;
    const prev = new Map(this.agents.map((a) => [a.id, a.state]));
    // Claude Code and Codex from their transcripts; Cursor-like editors, Gemini-style CLIs and any hooked agent from core/island-agents.ts.
    const order: Record<string, number> = { waiting: 0, stuck: 1, working: 2, done: 3, idle: 4 };
    const next = [...(await scanAgentSessions()), ...(await scanMoreAgents().catch(() => []))].sort((a, b) => order[a.state] - order[b.state] || b.updatedAt - a.updatedAt);
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
      if (np && settings().island.lyrics && lyricsOn(np.app, settings().island.lyricsOffApps)) this.lyrics = await lyricsFor(np);
    }
    if (changed) this.emit();
  }

  async media(action: 'toggle' | 'next' | 'previous' | 'seek' | 'shuffle' | 'repeat', value?: number) {
    await mediaAction(this.playing?.app, action, value);
    setTimeout(() => void this.pollMedia(), 300);
  }

  private async pollBattery() {
    const b = TEST_BATTERY() ?? await readBattery();
    if (!b || !Number.isFinite(b.percent)) return;
    const lowPower = 'lowPower' in b ? !!b.lowPower : await readLowPower();
    const was = this.battery;
    this.battery = { percent: b.percent, charging: b.charging, lowPower };
    // Plugging in and unplugging are a short notice drawn by the Island itself (core/island-activities.ts
    // transientsFrom), and a low battery stays as an activity: no alert, so nothing sits in the wings as text.
    if (!was || was.percent !== b.percent || was.charging !== b.charging || !!was.lowPower !== lowPower) this.emit();
  }

  private async pollMic() {
    const m = await micInUse();
    // The camera is checked on the same beat; on Linux it is one small file unless a camera is open.
    const c = settings().island.privacyDots === false ? [] : await cameraInUse().catch(() => [] as string[]);
    if (m.join() !== this.mic.join() || c.join() !== this.cam.join()) {
      this.mic = m;
      this.cam = c;
      this.emit();
    }
  }

  async pollCalendar() {
    const url = settings().island.calendarUrl.trim();
    // With Calendar on, the link is one of its subscriptions and reaches the Island from there.
    if (!url || featureOn('calendars')) {
      this.events = [];
      return;
    }
    try {
      const text = /^(https?|webcal):/i.test(url) ? await (await fetch(url.replace(/^webcal:/i, 'https:'), { signal: AbortSignal.timeout(15_000) })).text() : await fsp.readFile(url.replace(/^file:\/\//, ''), 'utf8');
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

  // Dictation moved to electron/services/voice (VOICE). It pastes through the
  // clipboard too; this keeps those writes out of the clipboard history.
  ignoreClip(text: string) {
    this.lastClip = text;
  }
}

/** A quick fingerprint of a picture on the clipboard (its size and first pixels). */
function imageSig(img: Electron.NativeImage): string {
  const { width, height } = img.getSize();
  return `${width}x${height}:${img.toBitmap().subarray(0, 4096).reduce((a, b) => (a * 31 + b) >>> 0, 7)}`;
}

/** Presses the paste shortcut in the app in front. */
export async function pasteKeystroke() {
  if (process.platform === 'darwin') await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
  else if (process.platform === 'win32') await powershell("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')");
  else if (!(await run('xdotool', ['key', '--clearmodifiers', 'ctrl+v'])).ok) await run('wtype', ['-M', 'ctrl', 'v', '-m', 'ctrl']);
}

declare const __KEEPER_OFFICIAL__: boolean | undefined;
/**
 * Tests only (never in official builds): KEEPER_TEST_BATTERY names a JSON file such as
 * {"percent":84,"charging":true,"lowPower":false}, read on every battery check, so the Island's
 * power notices can be checked under a virtual display.
 */
function TEST_BATTERY(): { percent: number; charging: boolean; lowPower?: boolean } | null {
  if ((typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__) || !process.env.KEEPER_TEST_BATTERY) return null;
  try {
    const b = JSON.parse(readFileSync(process.env.KEEPER_TEST_BATTERY, 'utf8')) as { percent?: unknown; charging?: unknown; lowPower?: unknown };
    return typeof b.percent === 'number' ? { percent: b.percent, charging: !!b.charging, lowPower: !!b.lowPower } : null;
  } catch {
    return null;
  }
}

/** macOS Low Power Mode (pmset's lowpowermode). Elsewhere, or when unknown: off. */
async function readLowPower(): Promise<boolean> {
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/pmset', ['-g'], 5000);
    return /^\s*lowpowermode\s+1\b/m.test(r.stdout);
  }
  return false;
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
