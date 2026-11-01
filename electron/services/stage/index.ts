// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stage mode: a clean screen for recording, presenting and screenshots.
//
// Every change goes through a write-ahead journal (userData/stage-journal.json):
// it is written down with the value it replaces before it is made. Stage puts
// everything back, newest first, when it ends; when Keeper starts again after a
// crash; and, if Keeper's process disappears, a small watchdog process runs a
// restore script written next to the journal. A setting the person changed by
// hand while Stage was on is left as they set it.
//
// Idle cost: nothing runs while Stage is off (no timer, no window, no child
// process). While it is on: one timer for its time limit, the overlays you
// chose, and the watchdog (a shell that checks once every two seconds whether
// Keeper is still there).

import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fsp, existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { addPending, decide, dropEntry, markApplied, newJournal, parseJournal, revertOrder } from '../../../core/stage/journal';
import { keyLabel, showKey as allowKey } from '../../../core/stage/overlay';
import { planStage, SWITCHES, staysOnScreen } from '../../../core/stage/plan';
import { ALWAYS_KEEP, LEGACY_PRESENTATION, normalizePreset, normalizeStageSettings } from '../../../core/stage/presets';
import { redactIsland, type IslandStage } from '../../../core/stage/private';
import { isValueTarget, restoreScript, targetKey } from '../../../core/stage/targets';
import type { JournalEntry, RevertResult, StageCapture, StageJournal, StageOs, StagePreset, StageSettings, StageStatus, SwitchId, SwitchInfo } from '../../../core/stage/types';
import type { IslandState } from '../../../core/api';
import { featureOn, onFeature } from '../features';
import { mediaAction, nowPlaying } from '../media';
import { CaptureWatch } from './detect';
import { listen, type EventSource } from './events';
import { chooseMode, displayModes, gatherEnv, hideApps, macCursorSize, quitApps, readValue, reopenApps, setMode, showApps, wallpaperThumb, writeValue } from './exec';
import { clearLook, hideBackdrop, overlayWindows, setLook, showBackdrop, showClick, showCountdown, showKey } from './overlay';

const OS = process.platform as StageOs;

/** What Stage borrows from the rest of Keeper (set by electron/ipc/stage.ts). */
export interface StageHost {
  /** a short message in the Island (or a notification) */
  notify(title: string, detail?: string): void;
  /** state changed: tell the windows, the Island and the tray */
  changed(status: StageStatus): void;
  /** Keep Awake: start or stop a session that also turns Do Not Disturb on, or Focus on its own */
  awake(on: boolean, opts: { reason: string; focus: boolean }): Promise<{ ok: boolean; notice?: string; mine: boolean }>;
  focus(on: boolean): Promise<{ notice?: string }>;
  /** Keeper's own screen recorder is running */
  recording(): boolean;
  /** Monorail and anything else that follows presentation mode */
  presenting?(on: boolean): void;
  /**
   * A window arranger (Monorail) that forgets the windows of hidden apps:
   * its layout is read before apps are hidden and put back after they show
   * again; changed() tells it about any Stage starting or ending.
   */
  arranger?: { beforeHide(): Promise<void>; afterShow(): Promise<string | undefined>; changed(on: boolean): void };
}

export class StageService {
  cfg: StageSettings = normalizeStageSettings(undefined);
  private dir = app.getPath('userData');
  private journal: StageJournal | null = null;
  private preset?: StagePreset;
  private since?: number;
  private endsAt?: number;
  private countdownEndsAt?: number;
  private reason?: string;
  private auto = false;
  private applied: StageStatus['applied'] = [];
  private notices: string[] = [];
  private lastRevert?: RevertResult[];
  private recovered?: string;
  private limitTimer?: NodeJS.Timeout;
  private countTimer?: NodeJS.Timeout;
  private watchdog: ChildProcess | null = null;
  private events: EventSource | null = null;
  private protectedWins = new Set<number>();
  private onNewWindow?: (e: unknown, w: BrowserWindow) => void;
  private busy: Promise<unknown> = Promise.resolve();
  private capture: CaptureWatch;
  private captureView?: StageCapture;
  private offs: (() => void)[] = [];
  private quitting = false;
  /** every change of the current start has been made (until then the page shows it starting) */
  private ready = false;

  constructor(private host: StageHost) {
    this.capture = new CaptureWatch({ keeperRecording: () => host.recording() }, (c) => this.onCapture(c));
  }

  private get file() { return path.join(this.dir, 'stage.json'); }
  private get journalFile() { return path.join(this.dir, 'stage-journal.json'); }
  private get scriptFile() { return path.join(this.dir, OS === 'win32' ? 'stage-restore.ps1' : 'stage-restore.sh'); }

  get on() { return !!this.preset; }

  async init() {
    this.cfg = normalizeStageSettings(await fsp.readFile(this.file, 'utf8').then((t) => JSON.parse(t), () => undefined));
    // A crash (or a power cut) while Stage was on: put things back now.
    const left = parseJournal(await fsp.readFile(this.journalFile, 'utf8').catch(() => ''));
    if (left?.entries.length) {
      const res = await this.revert(left);
      const back = res.filter((r) => r.outcome === 'restored').length;
      this.recovered = `Stage mode was still on when Keeper stopped. ${back ? `Put back ${back} change${back === 1 ? '' : 's'}` : 'Nothing needed putting back'}${res.some((r) => r.outcome === 'left') ? '; settings you changed yourself were left as they are' : ''}.`;
      this.lastRevert = res;
      this.host.notify('Stage mode cleaned up', this.recovered);
    }
    await this.clearJournal();
    this.offs.push(onFeature('stage', (on) => { if (!on && this.on) void this.stop('Stage was switched off'); }));
    this.offs.push(onFeature('stageAuto', (on) => this.syncCapture(on)));
    this.syncCapture(featureOn('stageAuto'));
    app.on('before-quit', (e) => {
      if (!this.on || this.quitting) return;
      // Put everything back before Keeper goes.
      e.preventDefault();
      this.quitting = true;
      void this.stop('Keeper quit').finally(() => app.quit());
    });
  }

  dispose() {
    this.offs.forEach((o) => o());
    this.capture.stop();
  }

  // ---------------------------------------------------------------- settings

  async saveSettings(patch: Partial<StageSettings>): Promise<StageSettings> {
    this.cfg = normalizeStageSettings({ ...this.cfg, ...patch });
    await fsp.writeFile(this.file, JSON.stringify(this.cfg, null, 1)).catch(() => undefined);
    this.capture.update(this.cfg.auto);
    this.publish();
    return this.cfg;
  }

  async savePreset(p: StagePreset): Promise<StageSettings> {
    const n = normalizePreset(p, `custom-${this.cfg.presets.length + 1}`);
    if (!n) return this.cfg;
    const presets = this.cfg.presets.some((x) => x.id === n.id) ? this.cfg.presets.map((x) => (x.id === n.id ? n : x)) : [...this.cfg.presets, n];
    return this.saveSettings({ presets });
  }

  async removePreset(id: string): Promise<StageSettings> {
    if (this.cfg.presets.find((p) => p.id === id)?.builtIn) throw new Error('The presets that come with Keeper can be changed but not removed.');
    return this.saveSettings({ presets: this.cfg.presets.filter((p) => p.id !== id) });
  }

  support(): SwitchInfo[] {
    return SWITCHES;
  }

  // ---------------------------------------------------------------- status

  status(): StageStatus {
    return {
      on: this.on && this.ready, starting: this.on && !this.ready, countdownEndsAt: this.countdownEndsAt, preset: this.preset?.id, presetName: this.preset?.name, since: this.since, endsAt: this.endsAt,
      reason: this.reason, auto: this.auto, applied: this.applied, lastRevert: this.lastRevert, recovered: this.recovered, notices: this.notices,
      capture: this.captureView, platform: process.platform,
    };
  }

  private publish() {
    this.host.changed(this.status());
  }

  /** The Island's view while Stage is on: private things hidden, the live activity shown. */
  islandView(s: IslandState): IslandState {
    if (!this.on && !this.countdownEndsAt) return s;
    if (!this.ready && !this.countdownEndsAt) return redactIsland(s, { hidePrivate: !!this.preset?.switches.hidePrivate, cleanClipboard: !!this.preset?.switches.cleanClipboard, stage: { on: false, name: this.preset?.name, private: true } });
    const sw = this.preset?.switches;
    const stage: IslandStage = { on: this.on, since: this.since, endsAt: this.endsAt, countdownEndsAt: this.countdownEndsAt, preset: this.preset?.id, name: this.preset?.name, auto: this.auto, private: !!sw?.hidePrivate };
    return redactIsland(s, { hidePrivate: this.on && !!sw?.hidePrivate, cleanClipboard: this.on && !!sw?.cleanClipboard, stage });
  }

  journalNow(): StageJournal | null {
    return this.journal;
  }

  // ---------------------------------------------------------------- start and stop

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.busy.then(fn, fn);
    this.busy = next.catch(() => undefined);
    return next;
  }

  findPreset(id?: string): StagePreset | undefined {
    if (id === LEGACY_PRESENTATION.id) return LEGACY_PRESENTATION;
    const want = (id ?? this.cfg.preset).toLowerCase();
    return this.cfg.presets.find((p) => p.id.toLowerCase() === want || p.name.toLowerCase() === want);
  }

  async start(presetId?: string, opts: { reason?: string; auto?: boolean; skipCountdown?: boolean } = {}): Promise<StageStatus> {
    if (!featureOn('stage')) throw new Error('Stage mode is switched off in Settings → Features.');
    const preset = this.findPreset(presetId);
    if (!preset) throw new Error(`There is no Stage preset called “${presetId}”.`);
    if (this.on && this.preset?.id === preset.id) return this.status();
    if (this.on) await this.stop('Switched to another preset', true);
    if (this.countdownEndsAt) return this.status();
    const go = () => this.serial(() => this.apply(preset, opts));
    if (preset.countdown > 0 && !opts.skipCountdown && !opts.auto) {
      this.countdownEndsAt = Date.now() + preset.countdown * 1000;
      this.reason = opts.reason;
      let n = preset.countdown;
      showCountdown(n);
      this.publish();
      await new Promise<void>((resolve) => {
        this.countTimer = setInterval(() => {
          n--;
          showCountdown(n);
          if (n <= 0) { clearInterval(this.countTimer); this.countTimer = undefined; resolve(); }
        }, 1000);
      });
      // Cancelled during the countdown.
      if (!this.countdownEndsAt) return this.status();
      this.countdownEndsAt = undefined;
    }
    return go();
  }

  /** Stops a countdown before anything changed. */
  private cancelCountdown() {
    if (!this.countdownEndsAt) return false;
    clearInterval(this.countTimer);
    this.countTimer = undefined;
    this.countdownEndsAt = undefined;
    showCountdown(0);
    this.publish();
    return true;
  }

  async toggle(presetId?: string, reason?: string): Promise<StageStatus> {
    if (this.cancelCountdown()) return this.status();
    if (this.on && (!presetId || this.preset?.id === this.findPreset(presetId)?.id)) return this.stop();
    return this.start(presetId, { reason });
  }

  async extend(minutes: number): Promise<StageStatus> {
    if (!this.on) return this.status();
    this.endsAt = Math.max(this.endsAt ?? Date.now(), Date.now()) + Math.max(1, minutes) * 60_000;
    this.armLimit();
    this.publish();
    return this.status();
  }

  private armLimit() {
    clearTimeout(this.limitTimer);
    if (!this.endsAt) return;
    this.limitTimer = setTimeout(() => void this.stop('Time is up'), Math.max(0, this.endsAt - Date.now()));
    this.limitTimer.unref?.();
  }

  private async persist() {
    if (!this.journal) return;
    const tmp = `${this.journalFile}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.journal));
    await fsp.rename(tmp, this.journalFile);
    let helper: string | undefined;
    if (OS === 'darwin') helper = (await import('../platform/mac')).helperPath();
    await fsp.writeFile(this.scriptFile, restoreScript(this.journal.entries, OS, helper), { mode: 0o700 }).catch(() => undefined);
  }

  private async clearJournal() {
    this.journal = null;
    await fsp.rm(this.journalFile, { force: true }).catch(() => undefined);
    await fsp.rm(this.scriptFile, { force: true }).catch(() => undefined);
  }

  /** A watchdog that restores things if Keeper's process disappears while Stage is on. */
  private startWatchdog() {
    if (this.watchdog) return;
    const j = this.journalFile;
    const s = this.scriptFile;
    try {
      if (OS === 'win32') {
        const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const q = (x: string) => `'${x.replace(/['‘’‚‛]/g, '$&$&')}'`;
        this.watchdog = spawn(ps, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command',
          `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 2 }; if (Test-Path ${q(j)}) { & ${q(s)}; Remove-Item ${q(j)},${q(s)} -Force -ErrorAction SilentlyContinue }`],
        { detached: true, stdio: 'ignore', windowsHide: true });
      } else {
        const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
        this.watchdog = spawn('/bin/sh', ['-c', `while kill -0 ${process.pid} 2>/dev/null; do sleep 2; done; if [ -f ${q(j)} ]; then /bin/sh ${q(s)}; rm -f ${q(j)} ${q(s)}; fi`], { detached: true, stdio: 'ignore' });
      }
      this.watchdog.on('error', () => { this.watchdog = null; });
      this.watchdog.unref();
    } catch {
      this.watchdog = null;
    }
  }

  private stopWatchdog() {
    try { this.watchdog?.kill(); } catch { /* gone */ }
    this.watchdog = null;
  }

  private note(sw: SwitchId, label: string, ok: boolean, note?: string) {
    this.applied.push({ switch: sw, label, ok, note });
  }

  /** Writes the change down, makes it, and records the outcome. */
  private async record(e: Omit<JournalEntry, 'seq' | 'state' | 'at'>, make: () => Promise<Partial<Pick<JournalEntry, 'target' | 'applied'>> | false>): Promise<boolean> {
    const j = this.journal!;
    const seq = addPending(j, e);
    await this.persist();
    let res: Awaited<ReturnType<typeof make>> = false;
    try { res = await make(); } catch { res = false; }
    if (res === false) { dropEntry(j, seq); await this.persist(); return false; }
    markApplied(j, seq, res);
    await this.persist();
    return true;
  }

  private async apply(preset: StagePreset, opts: { reason?: string; auto?: boolean }): Promise<StageStatus> {
    this.preset = preset;
    this.ready = false;
    this.since = Date.now();
    this.endsAt = preset.limitMin ? this.since + preset.limitMin * 60_000 : undefined;
    this.reason = opts.reason;
    this.auto = !!opts.auto;
    this.applied = [];
    this.notices = [];
    this.recovered = undefined;
    this.journal = newJournal(process.pid, preset.id);
    await this.persist();
    this.startWatchdog();
    this.publish();
    const s = preset.switches;
    const env = await gatherEnv();
    const plan = planStage(s, env);
    for (const k of plan.skipped) this.note(k.switch, SWITCHES.find((x) => x.id === k.switch)?.label ?? k.switch, false, k.note);

    // Keeper's own windows leave the picture first, so nothing private is captured while the rest happens.
    if (plan.actions.includes('keepKeeperOut')) this.protectWindows(true);
    if (plan.actions.includes('hidePrivate') || plan.actions.includes('cleanClipboard')) this.publish();

    // Settings, each read first so it can be put back.
    const seen = new Set<string>();
    for (const v of plan.values) {
      const key = targetKey(v.target);
      if (seen.has(key)) continue;
      seen.add(key);
      const prior = await readValue(v.target).catch(() => null);
      if (prior === null) { this.note(v.switch, v.label, false, 'Could not read the current setting, so it was left alone'); continue; }
      if (prior === v.value) { this.note(v.switch, v.label, true, 'Already set'); continue; }
      const ok = await this.record({ switch: v.switch, label: v.label, target: v.target, prior, applied: v.value }, async () => {
        if (!(await writeValue(v.target, v.value))) return false;
        const now = await readValue(v.target).catch(() => null);
        return { applied: now ?? v.value };
      });
      this.note(v.switch, v.label, ok, ok ? undefined : 'The system did not accept the change');
    }

    // Do Not Disturb and keeping awake, through Keep Awake.
    if (plan.actions.includes('keepAwake')) {
      const focus = plan.actions.includes('dnd');
      let notice: string | undefined;
      const ok = await this.record({ switch: 'keepAwake', label: 'Keep awake', target: { t: 'awake' } }, async () => {
        const r = await this.host.awake(true, { reason: opts.reason === 'Presentation mode' ? 'Presentation mode' : 'Stage mode', focus });
        notice = r.notice;
        return r.ok && r.mine ? {} : false;
      });
      this.note('keepAwake', 'Keep awake', ok || !!notice?.startsWith('Already'), notice ?? (ok ? undefined : 'Keep Awake is off or busy'));
      if (focus) this.note('dnd', 'Do Not Disturb', ok && !notice, notice);
    } else if (plan.actions.includes('dnd')) {
      let notice: string | undefined;
      const ok = await this.record({ switch: 'dnd', label: 'Do Not Disturb', target: { t: 'focus' } }, async () => {
        const r = await this.host.focus(true);
        notice = r.notice;
        return r.notice ? false : {};
      });
      this.note('dnd', 'Do Not Disturb', ok, notice);
    }

    if (plan.actions.includes('pauseMusic')) {
      const np = await nowPlaying().catch(() => undefined);
      if (np?.playing) {
        const ok = await this.record({ switch: 'pauseMusic', label: `Paused ${np.app ?? 'music'}`, target: { t: 'music-paused', player: np.app } }, async () => { await mediaAction(np.app, 'toggle'); return {}; });
        this.note('pauseMusic', 'Pause music', ok);
      } else this.note('pauseMusic', 'Pause music', true, 'Nothing was playing');
    }

    if (OS === 'darwin' && (plan.actions.includes('hideOtherApps') || (plan.actions.includes('apps') && s.apps.some((a) => a.action === 'hide')))) {
      await this.host.arranger?.beforeHide().catch(() => undefined);
    }

    if (plan.actions.includes('apps')) {
      const hide = s.apps.filter((a) => a.action === 'hide').map((a) => a.name);
      const quit = s.apps.filter((a) => a.action === 'quit');
      if (hide.length) {
        let ids: string[] = [];
        const ok = await this.record({ switch: 'apps', label: `Hid ${hide.join(', ')}`, target: { t: 'apps-hidden', ids: [], how: OS === 'darwin' ? 'mac' : OS === 'win32' ? 'win' : 'x11' } }, async () => {
          const h = await hideApps('only', hide, () => false);
          if (!h) return false;
          ids = h.ids;
          return { target: { t: 'apps-hidden', ids: h.ids, how: h.how, bundles: h.bundles } };
        });
        this.note('apps', `Hide ${hide.join(', ')}`, ok, ok && !ids.length ? 'None of them had windows open' : undefined);
      }
      if (quit.length) {
        const ok = await this.record({ switch: 'apps', label: `Quit ${quit.map((a) => a.name).join(', ')}`, target: { t: 'apps-quit', apps: [] } }, async () => {
          const done = await quitApps(quit.map((a) => a.name));
          const reopen = done.filter((d) => quit.find((q) => q.name === d.name)?.reopen);
          return { target: { t: 'apps-quit', apps: reopen } };
        });
        this.note('apps', `Quit ${quit.map((a) => a.name).join(', ')}`, ok);
      }
    }

    if (plan.actions.includes('hideOtherApps')) {
      const keep = [...this.cfg.keep];
      let n = 0;
      const ok = await this.record({ switch: 'hideOtherApps', label: 'Other apps hidden', target: { t: 'apps-hidden', ids: [], how: OS === 'darwin' ? 'mac' : OS === 'win32' ? 'win' : 'x11' } }, async () => {
        const h = await hideApps('except', [], (a) => staysOnScreen(a, keep, ALWAYS_KEEP));
        if (!h) return false;
        n = h.ids.length;
        return { target: { t: 'apps-hidden', ids: h.ids, how: h.how, bundles: h.bundles } };
      });
      this.note('hideOtherApps', 'Hide other apps', ok, ok ? `${n} hidden` : 'Needs wmctrl and xdotool (X11)');
    }

    if (plan.actions.includes('resolution')) await this.setResolution(s.resolution.width, s.resolution.height);

    if (plan.actions.includes('neutralCursor') && OS === 'darwin') {
      const size = await macCursorSize();
      if (size && size > 1.05) this.notices.push('Your pointer is enlarged (System Settings → Accessibility → Display → Pointer size). macOS does not let apps change it.');
      this.note('neutralCursor', 'Normal pointer size', !(size && size > 1.05), size && size > 1.05 ? 'macOS does not let apps change it; see the note above' : 'Already normal');
    }

    if (plan.actions.includes('backdrop')) {
      const wp = s.backdrop.kind === 'blur' ? await wallpaperThumb() : undefined;
      await showBackdrop(s.backdrop, wp);
      this.note('backdrop', 'Backdrop', true, s.backdrop.kind === 'blur' && !wp ? 'Could not read the wallpaper, so a gradient is shown' : undefined);
    }

    this.startLook(preset);
    for (const id of ['spotlight', 'clicks', 'keystrokes', 'cleanClipboard', 'hidePrivate', 'keepKeeperOut'] as SwitchId[]) {
      if (plan.actions.includes(id)) this.note(id, SWITCHES.find((x) => x.id === id)!.label, true, id === 'keystrokes' || id === 'clicks' ? this.events?.error : undefined);
    }

    if (opts.reason === 'Presentation mode' || preset.id === 'presenting') this.host.presenting?.(true);
    this.host.arranger?.changed(true);
    this.ready = true;
    this.armLimit();
    this.publish();
    return this.status();
  }

  private async setResolution(width: number, height: number) {
    const t = await displayModes().catch(() => null);
    const cur = t?.modes.find((m) => m.current);
    const want = t ? chooseMode(t.modes, width, height) : null;
    if (!t || !cur) { this.note('resolution', 'Recording resolution', false, 'Could not read the screen’s modes'); return; }
    if (!want) { this.note('resolution', 'Recording resolution', false, `This screen has no ${width} × ${height} mode`); return; }
    if (want.width === cur.width && want.height === cur.height) { this.note('resolution', 'Recording resolution', true, 'Already that size'); return; }
    const ok = await this.record({ switch: 'resolution', label: `Screen size ${want.width} × ${want.height}`, target: { t: 'display-mode', display: t.display, how: t.how, prior: { width: cur.width, height: cur.height, refresh: cur.refresh, modeId: cur.id } } }, async () => ((await setMode(t, want)) ? {} : false));
    this.note('resolution', `Screen size ${want.width} × ${want.height}`, ok, ok ? undefined : 'The screen did not accept the change');
  }

  private startLook(preset: StagePreset) {
    const s = preset.switches;
    const keys = s.keystrokes !== 'off';
    setLook({ spotlight: s.spotlight, clicks: s.clicks, keys });
    if ((keys || s.clicks) && !this.events) {
      void listen((e) => {
        if (e.t === 'click') { if (e.x !== undefined && e.y !== undefined) showClick(e.x, e.y, e.right); return; }
        if (allowKey(s.keystrokes, e)) showKey(keyLabel(e, OS === 'darwin'));
      }).then((src) => { if (this.on) this.events = src; else src.stop(); });
    }
  }

  private protectWindows(on: boolean) {
    const overlays = new Set(overlayWindows().map((w) => w.id));
    if (on) {
      if (OS === 'linux') return;
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isDestroyed() || overlays.has(w.id)) continue;
        w.setContentProtection(true);
        this.protectedWins.add(w.id);
      }
      this.onNewWindow = (_e, w) => {
        setTimeout(() => {
          if (!this.on || w.isDestroyed() || overlayWindows().some((o) => o.id === w.id)) return;
          w.setContentProtection(true);
          this.protectedWins.add(w.id);
        }, 0);
      };
      app.on('browser-window-created', this.onNewWindow as never);
    } else {
      for (const id of this.protectedWins) BrowserWindow.fromId(id)?.setContentProtection(false);
      this.protectedWins.clear();
      if (this.onNewWindow) app.off('browser-window-created', this.onNewWindow as never);
      this.onNewWindow = undefined;
    }
  }

  async stop(why = 'Turned off', quiet = false): Promise<StageStatus> {
    if (this.cancelCountdown()) return this.status();
    return this.serial(async () => {
      if (!this.preset) return this.status();
      const was = this.preset;
      const auto = this.auto;
      clearTimeout(this.limitTimer);
      this.limitTimer = undefined;
      this.events?.stop();
      this.events = null;
      clearLook();
      hideBackdrop();
      this.protectWindows(false);
      const res = this.journal ? await this.revert(this.journal) : [];
      await this.clearJournal();
      this.host.arranger?.changed(false);
      if (res.some((r) => r.label.startsWith('Hid ') || r.label === 'Other apps hidden')) {
        const note = await this.host.arranger?.afterShow().catch(() => undefined);
        if (note) res.push({ label: 'Window layout', outcome: note.includes('not back') ? 'failed' : 'restored', note });
      }
      this.stopWatchdog();
      this.preset = undefined;
      this.ready = false;
      this.since = undefined;
      this.endsAt = undefined;
      this.reason = undefined;
      this.auto = false;
      this.applied = [];
      this.lastRevert = res;
      if (was.id === 'presenting' || was.id === LEGACY_PRESENTATION.id) this.host.presenting?.(false);
      if (!quiet && why !== 'Turned off') this.host.notify('Stage mode ended', why);
      if (auto) this.captureView = this.capture.view();
      this.publish();
      return this.status();
    });
  }

  /** Puts back everything in a journal, newest first. */
  private async revert(j: StageJournal): Promise<RevertResult[]> {
    const out: RevertResult[] = [];
    for (const e of revertOrder(j)) {
      const t = e.target;
      try {
        if (isValueTarget(t)) {
          const cur = await readValue(t).catch(() => null);
          const d = decide(e, cur);
          if (d === 'already') { out.push({ label: e.label, outcome: 'skipped', note: 'Already back' }); continue; }
          if (d === 'left') { out.push({ label: e.label, outcome: 'left', note: 'You changed it while Stage was on' }); continue; }
          if (d === 'unknown' && e.state === 'pending') { out.push({ label: e.label, outcome: 'skipped', note: 'Not changed' }); continue; }
          const ok = await writeValue(t, e.prior!);
          out.push({ label: e.label, outcome: ok ? 'restored' : 'failed' });
        } else if (t.t === 'apps-hidden') {
          await showApps(t);
          out.push({ label: e.label, outcome: 'restored' });
        } else if (t.t === 'apps-quit') {
          await reopenApps(t.apps);
          out.push({ label: e.label, outcome: t.apps.length ? 'restored' : 'skipped' });
        } else if (t.t === 'music-paused') {
          const np = await nowPlaying().catch(() => undefined);
          if (np && !np.playing) { await mediaAction(t.player ?? np.app, 'toggle'); out.push({ label: e.label, outcome: 'restored' }); }
          else out.push({ label: e.label, outcome: 'left', note: 'Something else is playing now' });
        } else if (t.t === 'display-mode') {
          const m = await displayModes().catch(() => null);
          const back = m?.modes.find((x) => x.width === t.prior.width && x.height === t.prior.height && (!t.prior.modeId || x.id === t.prior.modeId)) ?? m?.modes.find((x) => x.width === t.prior.width && x.height === t.prior.height);
          const ok = !!m && !!back && (await setMode({ display: t.display, how: t.how }, { ...back, refresh: t.prior.refresh ?? back.refresh }));
          out.push({ label: e.label, outcome: ok ? 'restored' : 'failed' });
        } else if (t.t === 'awake') {
          await this.host.awake(false, { reason: 'Stage mode', focus: false });
          out.push({ label: e.label, outcome: 'restored' });
        } else if (t.t === 'focus') {
          await this.host.focus(false);
          out.push({ label: e.label, outcome: 'restored' });
        }
      } catch (err) {
        out.push({ label: e.label, outcome: 'failed', note: err instanceof Error ? err.message : String(err) });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- previews

  /** Shows one overlay for a few seconds (the "Try it" buttons on the Stage page). */
  async preview(what: 'spotlight' | 'clicks' | 'keys' | 'countdown' | 'backdrop'): Promise<boolean> {
    if (this.on) return false;
    const p = this.findPreset() ?? this.cfg.presets[0];
    const end = () => { if (!this.on) { clearLook(); hideBackdrop(); } };
    if (what === 'countdown') {
      let n = 3;
      showCountdown(n);
      const t = setInterval(() => { n--; showCountdown(n); if (n <= 0) clearInterval(t); }, 1000);
      return true;
    }
    if (what === 'backdrop') {
      const b = p.switches.backdrop.kind === 'off' ? { ...p.switches.backdrop, kind: 'gradient' as const } : p.switches.backdrop;
      await showBackdrop(b, b.kind === 'blur' ? await wallpaperThumb() : undefined);
      setTimeout(end, 3000);
      return true;
    }
    const spot = what === 'spotlight' ? (p.switches.spotlight.mode === 'off' ? { ...p.switches.spotlight, mode: 'spotlight' as const } : p.switches.spotlight) : { mode: 'off' as const, size: 'm' as const, dim: 55 };
    setLook({ spotlight: spot, clicks: what === 'clicks', keys: what === 'keys' });
    await new Promise((r) => setTimeout(r, 400));
    const { screen } = await import('electron');
    const pt = screen.getCursorScreenPoint();
    if (what === 'clicks') { showClick(pt.x, pt.y); setTimeout(() => showClick(pt.x + 40, pt.y + 20, true), 400); }
    if (what === 'keys') { showKey(keyLabel({ key: 'S', mods: ['cmd'] }, OS === 'darwin')); setTimeout(() => showKey(keyLabel({ key: 'Z', mods: ['cmd', 'shift'] }, OS === 'darwin')), 500); }
    setTimeout(end, what === 'spotlight' ? 4000 : 2500);
    return true;
  }

  // ---------------------------------------------------------------- starting when the screen is captured

  private syncCapture(on: boolean) {
    if (on && featureOn('stage')) this.capture.start(this.cfg.auto);
    else { this.capture.stop(); this.captureView = undefined; }
    this.publish();
  }

  async detect(): Promise<StageCapture> {
    const sources = await this.capture.sources();
    return { ...this.capture.view(), sources, active: this.capture.running ? this.capture.view().active : sources.some((s) => s.reliable) };
  }

  private onCapture(c: StageCapture) {
    this.captureView = c;
    if (c.active && !this.on && !this.countdownEndsAt && featureOn('stage')) {
      void this.start(this.cfg.auto.preset, { reason: `Screen capture: ${c.sources[0]?.label ?? 'detected'}`, auto: true }).catch(() => undefined);
    } else if (!c.active && this.on && this.auto && this.cfg.auto.stopWhenDone) {
      void this.stop('The screen is no longer being captured');
    } else this.publish();
  }

  /** The older "Presentation mode" switch (Island, palette, Monorail): stay awake and hide desktop icons. */
  async presentation(on: boolean): Promise<boolean> {
    if (on) await this.start(LEGACY_PRESENTATION.id, { reason: 'Presentation mode', skipCountdown: true });
    else if (this.on) await this.stop();
    return this.on;
  }
}

/** Is a journal file left over from a crash (for the end-to-end test and diagnostics)? */
export const journalPath = () => path.join(app.getPath('userData'), 'stage-journal.json');
export const hasLeftovers = () => existsSync(journalPath());
