// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keep Awake: holds the computer (and, if wanted, the screen) awake for a
// session, ends it when its time or its "while" conditions run out, starts
// sessions from triggers, keeps a laptop awake with its lid closed (with
// safety rules), and records statistics. The decisions are in
// core/awake-engine.ts; this file gathers facts and runs the commands.
//
// What holds the computer awake:
//   everywhere  Electron's powerSaveBlocker (IOPMAssertion on macOS,
//               SetThreadExecutionState / power requests on Windows,
//               the D-Bus ScreenSaver / PowerManagement inhibit on Linux)
//   macOS       plus `caffeinate -i [-d] -m -w <Keeper's pid>` (dies with Keeper)
//   Linux       plus `systemd-inhibit --what=sleep[:idle][:handle-lid-switch]`
//   Windows     plus a PowerShell child holding SetThreadExecutionState
//               until Keeper's process is gone
//
// Nothing runs while no session is on and no trigger is enabled: no timer,
// no child process, no listener doing work.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, powerMonitor, powerSaveBlocker, screen, shell } from 'electron';
import {
  addRecord, caffeinateArgs, closedDisplaySafe, describeCondition, evaluate, extend as extendSession, fmtDuration, matchingRules, newSession,
  parsePmsetAssertions, parsePmsetSleepDisabled, parsePowercfgLid, parsePowercfgRequests, parseSystemdInhibit, pmsetDisableSleep, powercfgLid, ruleMatches,
  summarize, systemdInhibitArgs, trackFalse, triggerConditionHolds, windowsHoldScript,
  type AwakeRule, type AwakeSettings, type Blocker, type Facts, type RestoreRecord, type Session, type SessionRecord, type SessionSpec,
} from '../../../core/awake-engine';
import type { AwakeStatus, TriggerTest } from '../../../core/api-awake';
import { powershell, run } from '../../../core/platform';
import { onSettings, settings, updateSettings } from '../../store';
import { featureOn, onFeature } from '../features';
import { conditions, poll, usage } from '../governor';
import { bluetoothBatteries, cpuPercent, frontmostApp, mountedVolumes, runningApps, touchDrive, usbDevices, wifiName } from '../devices';
import { readBattery } from '../system';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';
const PARTIAL = /\.(crdownload|part|partial|download|opdownload|!ut)$/i;
const SUDOERS = '/etc/sudoers.d/keeper-awake';

/** What the Island and the rest of Keeper need from the service. */
export interface AwakeHost {
  /** a short message (the Island alert, or a system notification when the Island is off) */
  notify(title: string, detail?: string): void;
  /** state changed: mirror it into the Island and tell the windows */
  changed(status: AwakeStatus): void;
  /** live facts the Island already keeps */
  live(): { audioPlaying?: boolean; agents: number; events: { start: number; end: number }[]; battery?: { percent: number; charging: boolean } };
}

let svc: AwakeService | null = null;
export const awakeService = () => svc;

export class AwakeService {
  session?: Session;
  private matching: string[] = [];
  /** trigger id → do not start again before (after the person ended its session) */
  private snoozed: Record<string, number> = {};
  private blocker: number | null = null;
  private blockerType: 'prevent-app-suspension' | 'prevent-display-sleep' | null = null;
  private child: ChildProcess | null = null;
  private childName = '';
  private lidWatch: ChildProcess | null = null;
  private closedOn = false;
  private notice?: string;
  private displayAllowed = false;
  private stopPoll?: () => void;
  private lastDrive = 0;
  private lastCursor = 0;
  private focusOn = false;
  private records: SessionRecord[] = [];
  private paths: Record<string, { size: number; mtime: number }> = {};
  private net?: { at: number; bytes: number };
  private listeners: (() => void)[] = [];
  private dir = app.getPath('userData');

  constructor(private host: AwakeHost) {
    svc = this;
  }

  private get cfg(): AwakeSettings {
    return settings().awake;
  }

  async start() {
    this.records = await fsp.readFile(path.join(this.dir, 'awake-stats.json'), 'utf8').then((t) => JSON.parse(t) as SessionRecord[], () => []);
    // A crash or power loss in closed-lid mode must not leave the computer unable to sleep.
    await this.restoreLeftovers();
    // Event-driven where the system tells us: power source, sleep, displays, thermal state.
    const look = () => this.needCheck() && void this.tick();
    const onSuspend = () => {
      // Putting the computer to sleep by hand ends the session (if the session says so).
      if (this.session?.options.endOnManualSleep) void this.stop('The computer went to sleep');
    };
    powerMonitor.on('on-ac', look);
    powerMonitor.on('on-battery', look);
    powerMonitor.on('suspend', onSuspend);
    powerMonitor.on('thermal-state-change', look);
    screen.on('display-added', look);
    screen.on('display-removed', look);
    this.listeners.push(() => {
      powerMonitor.off('on-ac', look);
      powerMonitor.off('on-battery', look);
      powerMonitor.off('suspend', onSuspend);
      powerMonitor.off('thermal-state-change', look);
      screen.off('display-added', look);
      screen.off('display-removed', look);
    });
    // Switching Keep Awake off in Settings → Features ends the session and every hold, and stops all checks.
    this.listeners.push(onFeature('keepAwake', (on) => {
      if (!on) void this.stop('Keep Awake was switched off').then(() => this.schedule());
      else this.schedule();
    }));
    // Triggers edited anywhere (Settings, sync, the command line) take effect straight away.
    this.listeners.push(onSettings((n, p) => { if (n.awake !== p.awake) { this.schedule(); this.publish(); } }));
    app.on('before-quit', () => this.releaseAll());
    this.schedule();
  }

  dispose() {
    this.listeners.forEach((l) => l());
    this.stopPoll?.();
    this.releaseAll();
  }

  // ---------------------------------------------------------------- sessions

  async begin(spec: SessionSpec = {}): Promise<AwakeStatus> {
    if (!featureOn('keepAwake')) throw new Error('Keep Awake is switched off in Settings → Features.');
    if (this.session) await this.stop('Replaced by a new session', true);
    const b = this.host.live().battery ?? (await readBattery().catch(() => undefined));
    const onPower = !powerMonitor.isOnBatteryPower();
    this.session = newSession({ ...spec, options: { ...spec.options } }, this.cfg.defaults, Date.now(), `s${Date.now().toString(36)}`, b ? { percent: b.percent, onPower } : undefined);
    this.notice = undefined;
    await this.hold();
    const o = this.session.options;
    if (o.focus) await this.setFocus(true);
    if (o.notifyStart) this.host.notify('Keeping awake', this.session.reason);
    this.sound('start');
    this.schedule();
    void this.tick();
    return this.publish();
  }

  async stop(why = 'Turned off', quiet = false): Promise<AwakeStatus> {
    const s = this.session;
    if (!s) return this.publish();
    this.session = undefined;
    await this.release();
    if (this.focusOn) await this.setFocus(false);
    // A trigger's session ended by hand waits before it may start again.
    if (s.triggerId && why === 'Turned off') {
      const rule = this.cfg.triggers.find((r) => r.id === s.triggerId);
      this.snoozed[s.triggerId] = rule?.reactivateAfterMin ? Date.now() + rule.reactivateAfterMin * 60_000 : Number.MAX_SAFE_INTEGER;
    }
    if (this.cfg.stats) {
      const b = s.batteryAtStart !== undefined ? await readBattery().catch(() => undefined) : undefined;
      this.records = addRecord(this.records, { start: s.startedAt, end: Date.now(), source: s.source, reason: s.reason, why, batteryUsed: b && s.batteryAtStart !== undefined ? Math.max(0, s.batteryAtStart - b.percent) : undefined });
      void fsp.writeFile(path.join(this.dir, 'awake-stats.json'), JSON.stringify(this.records)).catch(() => undefined);
    }
    if (!quiet) {
      if (s.options.notifyEnd && why !== 'Turned off') this.host.notify('Keep awake ended', why);
      this.sound('end');
      if (s.options.lockAtEnd && why !== 'Turned off') await lockScreen();
    }
    this.schedule();
    return this.publish();
  }

  async toggle(spec?: SessionSpec) {
    return this.session ? this.stop() : this.begin(spec);
  }

  async extend(minutes: number) {
    if (!this.session) return this.begin({ minutes });
    this.session = extendSession(this.session, minutes, Date.now());
    this.schedule();
    return this.publish();
  }

  // ---------------------------------------------------------------- holds

  private async hold() {
    const s = this.session;
    if (!s) return;
    this.applyBlocker(s.options.display === 'keep-on');
    // The second, system-level hold: it shows up in the system's own "who keeps it awake" list
    // and dies with Keeper, so a crash never leaves the computer awake.
    this.killChild();
    try {
      if (isMac) {
        this.child = spawn('/usr/bin/caffeinate', caffeinateArgs(s.options, process.pid), { stdio: 'ignore' });
        this.childName = 'caffeinate';
      } else if (isLinux && (await run('which', ['systemd-inhibit'], 2000)).ok) {
        this.child = spawn('systemd-inhibit', systemdInhibitArgs(s.options, `Keeper: ${s.reason}`), { stdio: 'ignore' });
        this.childName = 'systemd-inhibit';
      } else if (isWin) {
        this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', windowsHoldScript(s.options, process.pid)], { stdio: 'ignore', windowsHide: true });
        this.childName = 'SetThreadExecutionState';
      }
      // If the child cannot run (no systemd, no system bus), the Electron hold stays in place.
      const c = this.child;
      c?.on('exit', () => { if (this.child === c) { this.child = null; this.childName = ''; this.publish(); } });
      c?.on('error', () => { if (this.child === c) { this.child = null; this.childName = ''; } });
    } catch {
      this.child = null;
    }
    if (s.options.closedDisplay) await this.setClosedDisplay(true);
  }

  private applyBlocker(keepDisplay: boolean) {
    const type = keepDisplay ? 'prevent-display-sleep' : 'prevent-app-suspension';
    this.displayAllowed = !keepDisplay;
    if (this.blocker !== null && this.blockerType === type && powerSaveBlocker.isStarted(this.blocker)) return;
    if (this.blocker !== null) powerSaveBlocker.stop(this.blocker);
    this.blocker = powerSaveBlocker.start(type);
    this.blockerType = type;
  }

  private killChild() {
    if (this.child) {
      try { this.child.kill(); } catch { /* gone */ }
      this.child = null;
      this.childName = '';
    }
  }

  private async release() {
    if (this.blocker !== null) {
      powerSaveBlocker.stop(this.blocker);
      this.blocker = null;
      this.blockerType = null;
    }
    this.killChild();
    if (this.closedOn) await this.setClosedDisplay(false);
  }

  /** Synchronous last-chance cleanup when Keeper quits. */
  private releaseAll() {
    if (this.blocker !== null) powerSaveBlocker.stop(this.blocker);
    this.blocker = null;
    this.killChild();
    if (this.closedOn) {
      // The watchdog child puts the setting back the moment Keeper's process is gone.
      this.closedOn = false;
    }
  }

  // ---------------------------------------------------------------- closed lid

  supportsClosedDisplay() {
    return isMac || isWin || isLinux;
  }

  /** macOS: one administrator prompt adds a rule that lets Keeper run only `pmset -a disablesleep 0|1` without a password. */
  async setupClosedDisplay(): Promise<{ ok: boolean; message?: string }> {
    if (!isMac) {
      await this.saveSettings({ closedDisplayAgreed: true });
      return { ok: true };
    }
    const user = os.userInfo().username;
    if (!/^[A-Za-z0-9_.-]+$/.test(user)) return { ok: false, message: 'Your user name has characters the setup cannot use safely.' };
    const line = `${user} ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1`;
    const tmp = `/tmp/keeper-awake-${process.pid}`;
    const cmd = `printf '%s\\n' '${line}' > ${tmp} && /usr/sbin/visudo -cf ${tmp} && /usr/sbin/chown root:wheel ${tmp} && /bin/chmod 440 ${tmp} && /bin/mv ${tmp} ${SUDOERS}`;
    const r = await run('/usr/bin/osascript', ['-e', `do shell script ${JSON.stringify(cmd)} with administrator privileges with prompt "Keeper needs your password once to keep this Mac awake with the lid closed."`], 120_000);
    if (!r.ok) return { ok: false, message: /cancel/i.test(r.stderr) ? 'Cancelled.' : r.stderr.trim() || 'The setup did not finish.' };
    await this.saveSettings({ closedDisplayAgreed: true });
    return { ok: true };
  }

  private async setClosedDisplay(on: boolean) {
    const rec = path.join(this.dir, 'awake-restore.json');
    if (on) {
      if (!this.cfg.closedDisplayAgreed) {
        this.notice = 'Closed-lid mode needs its one-time setup on the Keep Awake page.';
        return;
      }
      const record: RestoreRecord = { platform: process.platform, at: Date.now() };
      if (isMac) {
        const was = parsePmsetSleepDisabled((await run('/usr/bin/pmset', ['-g'], 5000)).stdout);
        if (was) return; // already disabled by the person; nothing of ours to undo
        const r = await run('/usr/bin/sudo', ['-n', '/usr/bin/pmset', ...pmsetDisableSleep(true)], 10_000);
        if (!r.ok) {
          this.notice = 'Closed-lid mode needs its one-time setup again (the permission was removed).';
          return;
        }
        record.macDisableSleep = true;
        // Restores sleep the moment Keeper's process is gone, whatever the reason.
        this.lidWatch = spawn('/bin/sh', ['-c', `while kill -0 ${process.pid} 2>/dev/null; do sleep 5; done; /usr/bin/sudo -n /usr/bin/pmset -a disablesleep 0`], { detached: true, stdio: 'ignore' });
        this.lidWatch.unref();
      } else if (isWin) {
        const before = parsePowercfgLid((await run('powercfg', ['/q', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION'], 10_000)).stdout);
        if (!before) {
          this.notice = 'Could not read the lid setting.';
          return;
        }
        for (const args of powercfgLid(0, 0)) await run('powercfg', args, 10_000);
        record.winLid = before;
        const restore = powercfgLid(before.ac, before.dc).map((a) => `powercfg ${a.join(' ')}`).join('; ');
        this.lidWatch = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 5 }; ${restore}`], { detached: true, stdio: 'ignore', windowsHide: true });
        this.lidWatch.unref();
      }
      // Linux: systemd-inhibit holds handle-lid-switch for as long as the session runs; nothing to restore.
      await fsp.writeFile(rec, JSON.stringify(record)).catch(() => undefined);
      this.closedOn = true;
    } else {
      this.closedOn = false;
      try { this.lidWatch?.kill(); } catch { /* gone */ }
      this.lidWatch = null;
      const r = await fsp.readFile(rec, 'utf8').then((t) => JSON.parse(t) as RestoreRecord, () => undefined);
      if (r) await this.undo(r);
      await fsp.rm(rec, { force: true });
    }
  }

  private async undo(r: RestoreRecord) {
    if (r.macDisableSleep && isMac) await run('/usr/bin/sudo', ['-n', '/usr/bin/pmset', ...pmsetDisableSleep(false)], 10_000);
    if (r.winLid && isWin) for (const args of powercfgLid(r.winLid.ac, r.winLid.dc)) await run('powercfg', args, 10_000);
    if (r.gnomeBanners !== undefined && isLinux) await run('gsettings', ['set', 'org.gnome.desktop.notifications', 'show-banners', String(r.gnomeBanners)], 5000);
  }

  private async restoreLeftovers() {
    for (const f of ['awake-restore.json', 'awake-focus.json']) {
      const p = path.join(this.dir, f);
      const r = await fsp.readFile(p, 'utf8').then((t) => JSON.parse(t) as RestoreRecord, () => undefined);
      if (r) {
        await this.undo(r).catch(() => undefined);
        await fsp.rm(p, { force: true });
      }
    }
  }

  // ---------------------------------------------------------------- focus, sounds, pointer

  focusSupport(): AwakeStatus['supports']['focus'] {
    if (isMac) return 'shortcuts';
    if (isLinux && /gnome|unity|ubuntu/i.test(process.env.XDG_CURRENT_DESKTOP ?? '')) return 'gnome';
    return 'none';
  }

  private async setFocus(on: boolean) {
    const kind = this.focusSupport();
    if (kind === 'shortcuts') {
      const name = on ? this.cfg.focusOnShortcut : this.cfg.focusOffShortcut;
      if (!name) {
        if (on) this.notice = 'Pick the Shortcuts that turn Focus on and off on the Keep Awake page.';
        return;
      }
      await run('/usr/bin/shortcuts', ['run', name], 20_000);
      this.focusOn = on;
    } else if (kind === 'gnome') {
      const p = path.join(this.dir, 'awake-focus.json');
      if (on) {
        const was = (await run('gsettings', ['get', 'org.gnome.desktop.notifications', 'show-banners'], 5000)).stdout.trim() !== 'false';
        await fsp.writeFile(p, JSON.stringify({ platform: 'linux', gnomeBanners: was, at: Date.now() } satisfies RestoreRecord)).catch(() => undefined);
        await run('gsettings', ['set', 'org.gnome.desktop.notifications', 'show-banners', 'false'], 5000);
        this.focusOn = true;
      } else {
        const r = await fsp.readFile(p, 'utf8').then((t) => JSON.parse(t) as RestoreRecord, () => undefined);
        await run('gsettings', ['set', 'org.gnome.desktop.notifications', 'show-banners', String(r?.gnomeBanners ?? true)], 5000);
        await fsp.rm(p, { force: true });
        this.focusOn = false;
      }
    }
  }

  private sound(when: 'start' | 'end' | 'remind') {
    const s = this.session?.options.sound ?? this.cfg.defaults.sound;
    if (s === 'none') return;
    if (isMac) {
      const file = { soft: when === 'end' ? 'Bottle' : 'Tink', chime: 'Glass', pop: 'Pop' }[s];
      spawn('/usr/bin/afplay', [`/System/Library/Sounds/${file}.aiff`], { stdio: 'ignore' }).on('error', () => undefined);
    } else if (isLinux) {
      spawn('canberra-gtk-play', ['-i', when === 'end' ? 'complete' : 'message'], { stdio: 'ignore' }).on('error', () => shell.beep());
    } else shell.beep();
  }

  /** One point right and back, for apps that decide on their own that you are away. */
  private async nudgeCursor() {
    const p = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(p);
    const host = { id: String(d.id), label: d.label || 'Screen', x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, scale: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id };
    const nx = (x: number) => (x - d.bounds.x) / d.bounds.width;
    const ny = (p.y - d.bounds.y) / d.bounds.height;
    const { injector } = await import('../screen/injector');
    const inj = injector();
    if (!(await inj.status()).available) return;
    inj.send([{ t: 'move', x: nx(p.x + 1), y: ny }, { t: 'move', x: nx(p.x), y: ny }] as never, host as never);
  }

  // ---------------------------------------------------------------- the regular check

  private needCheck() {
    return featureOn('keepAwake') && (!!this.session || this.cfg.triggers.some((t) => t.enabled));
  }

  /** Starts the check while a session or an enabled trigger needs it, and stops it otherwise. */
  schedule() {
    if (!this.needCheck()) {
      this.stopPoll?.();
      this.stopPoll = undefined;
      if (this.matching.length) { this.matching = []; this.publish(); }
      return;
    }
    if (this.stopPoll) return;
    this.stopPoll = poll('awake.check', () => ({
      // A session checks every 15 s (it must notice its end while nobody touches the computer);
      // triggers alone every 30 s, slower while away.
      baseMs: this.session ? (this.session.endsAt && this.session.endsAt - Date.now() < 90_000 ? 5000 : 15_000) : 30_000,
      idleFactor: this.session ? 1 : 2,
    }), () => this.tick(), { feature: 'keepAwake', now: false });
  }

  private ticking = false;

  async tick() {
    if (this.ticking || !featureOn('keepAwake')) return;
    this.ticking = true;
    try {
      const rules = this.cfg.triggers.filter((t) => t.enabled);
      const kinds = new Set<string>([...(this.session?.while ?? []).map((c) => c.kind), ...rules.flatMap((r) => r.conditions.map((c) => c.kind))]);
      const f = await this.facts(kinds, [...(this.session?.while ?? []).filter((c) => c.kind === 'file' || c.kind === 'folder').map((c) => c.value ?? '')]);
      // Snoozes clear when the trigger stops matching (its conditions changed).
      for (const r of rules) if (this.snoozed[r.id] === Number.MAX_SAFE_INTEGER && !ruleMatches(r, f)) delete this.snoozed[r.id];
      const matching = matchingRules(rules, f, this.snoozed);
      const names = matching.map((r) => r.name);
      const changed = names.join('\n') !== this.matching.join('\n');
      this.matching = names;
      if (this.session) await this.keepGoing(f, matching);
      if (!this.session && matching.length) {
        const top = matching[0];
        await this.begin({ source: 'trigger', triggerId: top.id, reason: top.name, options: top.options });
        this.host.notify('Keeping awake', top.name);
        return;
      }
      if (changed) this.publish();
    } finally {
      this.ticking = false;
    }
  }

  private async keepGoing(f: Facts, matching: AwakeRule[]) {
    let s = this.session!;
    // A trigger's session lasts while its trigger matches.
    if (s.source === 'trigger' && s.triggerId && !matching.some((r) => r.id === s.triggerId)) {
      await this.stop('The trigger no longer applies');
      return;
    }
    s = this.session = trackFalse(s, f);
    const v = evaluate(s, f);
    if (v.end) {
      await this.stop(v.why);
      return;
    }
    if (s.options.closedDisplay && this.closedOn) {
      const safe = closedDisplaySafe(f, Math.max(this.cfg.closedDisplayMinBattery, s.options.endBelowBattery));
      if (!safe.ok) {
        await this.setClosedDisplay(false);
        this.host.notify('Closed-lid mode ended', safe.why);
      }
    }
    if (v.remind) {
      this.session = { ...s, reminded: true };
      this.host.notify('Keep awake ends soon', `In ${fmtDuration(Math.max(60_000, (s.endsAt ?? 0) - f.now))}. Extend it from the Island or the menu.`);
      this.sound('remind');
    }
    // Screen-saver timeout: after N idle minutes the screen may sleep again, the computer stays awake.
    this.applyBlocker(!v.displayAllowed);
    const o = s.options;
    if (o.driveAlive.length && Date.now() - this.lastDrive >= Math.max(10, o.driveAliveSec) * 1000) {
      this.lastDrive = Date.now();
      for (const d of o.driveAlive) await touchDrive(d);
    }
    if (o.cursorEverySec > 0 && f.idleSec >= o.cursorEverySec && Date.now() - this.lastCursor >= o.cursorEverySec * 1000) {
      this.lastCursor = Date.now();
      await this.nudgeCursor().catch(() => undefined);
    }
    this.publish();
  }

  // ---------------------------------------------------------------- facts

  /** Gathers only what the active conditions need. */
  async facts(kinds: Set<string>, watchPaths: string[] = []): Promise<Facts> {
    const now = Date.now();
    const c = conditions();
    const live = this.host.live();
    const need = (...k: string[]) => k.some((x) => kinds.has(x));
    const nets = os.networkInterfaces();
    const displays = screen.getAllDisplays();
    const b = live.battery ?? (need('battery') || this.session ? await readBattery().catch(() => undefined) : undefined);
    const f: Facts = {
      now,
      onPower: !powerMonitor.isOnBatteryPower(),
      battery: b?.percent,
      charging: b?.charging,
      lowPowerMode: c.lowPower,
      thermal: c.thermal,
      externalDisplays: Math.max(0, displays.filter((d) => !d.internal).length - (displays.some((d) => d.internal) ? 0 : 1)),
      mirroring: displays.length > 1 && new Set(displays.map((d) => `${d.bounds.x},${d.bounds.y}`)).size < displays.length,
      apps: need('app', 'appFront') ? await runningApps().catch(() => []) : [],
      frontApp: need('appFront') ? await frontmostApp().catch(() => undefined) : undefined,
      cpu: need('cpu') ? cpuPercent() : 0,
      processCpu: need('cpu') ? await processCpu() : undefined,
      audioPlaying: live.audioPlaying,
      audioOutput: need('audioOutput') ? await audioOutput() : undefined,
      netBytesPerSec: need('network') ? await this.netRate() : undefined,
      usb: need('usb') ? await usbDevices().catch(() => []) : [],
      bluetooth: need('bluetooth') ? (await bluetoothBatteries().catch(() => [])).map((d) => d.name) : [],
      volumes: need('drive') ? await mountedVolumes().catch(() => []) : [],
      ssid: need('wifi') ? await wifiName().catch(() => undefined) : undefined,
      interfaces: Object.keys(nets),
      ips: Object.values(nets).flat().filter((n) => n && !n.internal).map((n) => n!.address),
      dns: need('dns') ? await dnsServers() : [],
      idleSec: powerMonitor.getSystemIdleTime(),
      agentsRunning: live.agents,
      terminalSessions: 0,
      keeperJobs: need('job') ? usage().tasks.filter((t) => t.state === 'working').map((t) => t.label) : [],
      downloadsActive: need('downloads', 'job') ? await downloadsActive() : 0,
      calendarBusy: need('calendar') ? live.events.some((e) => e.start <= now && e.end > now) : undefined,
      paths: {},
    };
    for (const p of watchPaths.filter(Boolean)) f.paths![p] = await this.pathFact(p, now);
    return f;
  }

  private async pathFact(p: string, now: number) {
    const st = await fsp.stat(p).catch(() => null);
    const partial = ['.crdownload', '.part', '.download'].some((x) => existsSync(p + x)) || PARTIAL.test(p);
    if (!st) return { exists: false, size: 0, mtime: 0, partial };
    // A folder's own mtime only changes when entries are added or removed: look one level in too.
    let mtime = st.mtimeMs;
    if (st.isDirectory()) {
      for (const n of (await fsp.readdir(p).catch(() => [])).slice(0, 500)) {
        const s = await fsp.stat(path.join(p, n)).catch(() => null);
        if (s && s.mtimeMs > mtime) mtime = s.mtimeMs;
      }
    }
    const was = this.paths[p];
    // A growing file counts as changing even when the filesystem is slow to update its time.
    if (was && was.size !== st.size) mtime = Math.max(mtime, now);
    this.paths[p] = { size: st.size, mtime };
    return { exists: true, size: st.size, mtime, partial };
  }

  private async netRate(): Promise<number | undefined> {
    let bytes = 0;
    if (isLinux) {
      const t = await fsp.readFile('/proc/net/dev', 'utf8').catch(() => '');
      for (const line of t.split('\n').slice(2)) {
        const [name, rest] = line.split(':');
        if (!rest || name.trim() === 'lo') continue;
        const n = rest.trim().split(/\s+/).map(Number);
        bytes += (n[0] || 0) + (n[8] || 0);
      }
    } else if (isMac) {
      const r = await run('/usr/sbin/netstat', ['-ib'], 5000);
      for (const line of r.stdout.split('\n')) {
        const c = line.trim().split(/\s+/);
        if (c[0]?.startsWith('lo') || !/<Link#/.test(line)) continue;
        bytes += (Number(c[c.length - 5]) || 0) + (Number(c[c.length - 2]) || 0);
      }
    } else {
      const r = await powershell('(Get-NetAdapterStatistics | Measure-Object -Property ReceivedBytes,SentBytes -Sum | Measure-Object -Property Sum -Sum).Sum', 10_000);
      bytes = Number(r.stdout.trim()) || 0;
    }
    const now = Date.now();
    const was = this.net;
    this.net = { at: now, bytes };
    if (!was || now <= was.at) return undefined;
    return Math.max(0, (bytes - was.bytes) / ((now - was.at) / 1000));
  }

  // ---------------------------------------------------------------- triggers

  async saveSettings(patch: Partial<AwakeSettings>): Promise<AwakeSettings> {
    await updateSettings({ awake: { ...this.cfg, ...patch } });
    this.schedule();
    this.publish();
    return this.cfg;
  }

  async saveTrigger(rule: AwakeRule) {
    const list = this.cfg.triggers;
    const i = list.findIndex((r) => r.id === rule.id);
    const next = i >= 0 ? list.map((r) => (r.id === rule.id ? rule : r)) : [...list, { ...rule, priority: list.length }];
    delete this.snoozed[rule.id];
    const s = await this.saveSettings({ triggers: next });
    void this.tick();
    return s;
  }

  async removeTrigger(id: string) {
    if (this.session?.triggerId === id) await this.stop('The trigger was removed', true);
    return this.saveSettings({ triggers: this.cfg.triggers.filter((r) => r.id !== id) });
  }

  async reorderTriggers(ids: string[]) {
    const by = new Map(this.cfg.triggers.map((r) => [r.id, r]));
    const ordered = [...ids.map((id) => by.get(id)).filter((r): r is AwakeRule => !!r), ...this.cfg.triggers.filter((r) => !ids.includes(r.id))];
    return this.saveSettings({ triggers: ordered.map((r, i) => ({ ...r, priority: i })) });
  }

  /** "Would this match now?", condition by condition. */
  async testTrigger(rule: AwakeRule): Promise<TriggerTest> {
    const f = await this.facts(new Set(rule.conditions.map((c) => c.kind)));
    return { matches: ruleMatches(rule, f), conditions: rule.conditions.map((c) => ({ label: describeCondition(c), holds: triggerConditionHolds(c, f) })) };
  }

  // ---------------------------------------------------------------- what keeps the computer awake

  async blockers(): Promise<{ list: Blocker[]; source: string; error?: string }> {
    if (isMac) {
      const r = await run('/usr/bin/pmset', ['-g', 'assertions'], 8000);
      return { list: parsePmsetAssertions(r.stdout), source: 'pmset -g assertions', error: r.ok ? undefined : r.stderr.trim() };
    }
    if (isWin) {
      const r = await run('powercfg', ['/requests'], 10_000);
      // powercfg /requests needs an administrator; say so instead of showing an empty list.
      if (!r.ok || /administrator/i.test(r.stdout + r.stderr)) return { list: this.ownBlockers(), source: 'powercfg /requests', error: 'Windows only lists other apps to administrators. Keeper’s own hold is shown.' };
      return { list: parsePowercfgRequests(r.stdout), source: 'powercfg /requests' };
    }
    const r = await run('systemd-inhibit', ['--list', '--no-pager', '--no-legend'], 8000);
    if (!r.ok) return { list: this.ownBlockers(), source: 'Keeper', error: `Other apps’ holds cannot be listed here (systemd-inhibit: ${r.stderr.trim().split('\n')[0] || 'not installed'}). Keeper’s own hold is shown.` };
    return { list: parseSystemdInhibit(r.stdout), source: 'systemd-inhibit --list' };
  }

  private ownBlockers(): Blocker[] {
    if (!this.session) return [];
    return this.holds().map((h) => ({ who: 'Keeper', what: h, why: this.session!.reason }));
  }

  // ---------------------------------------------------------------- statistics

  stats() {
    return { ...summarize(this.records, Date.now()), recent: this.records.slice(-30).reverse() };
  }

  async resetStats() {
    this.records = [];
    await fsp.rm(path.join(this.dir, 'awake-stats.json'), { force: true });
  }

  // ---------------------------------------------------------------- status

  holds(): string[] {
    const out: string[] = [];
    if (this.blocker !== null && powerSaveBlocker.isStarted(this.blocker)) out.push(`powerSaveBlocker (${this.blockerType})`);
    if (this.child && this.childName) out.push(this.childName);
    if (this.closedOn) out.push('closed lid');
    return out;
  }

  status(): AwakeStatus {
    const s = this.session;
    return {
      on: !!s,
      session: s && { id: s.id, startedAt: s.startedAt, endsAt: s.endsAt, reason: s.reason, source: s.source, while: s.while, options: s.options, triggerId: s.triggerId },
      matching: this.matching,
      holds: this.holds(),
      closedDisplay: this.closedOn,
      notice: this.notice,
      displayAllowed: s ? this.displayAllowed : true,
      checking: !!this.stopPoll,
      platform: process.platform,
      supports: { closedDisplay: this.supportsClosedDisplay(), focus: this.focusSupport(), cursor: !(process.env.XDG_SESSION_TYPE === 'wayland' && !process.env.DISPLAY), lock: true, thermal: isMac },
    };
  }

  private publish(): AwakeStatus {
    const st = this.status();
    this.host.changed(st);
    return st;
  }
}

// ---------------------------------------------------------------- small system lookups

async function processCpu(): Promise<Record<string, number> | undefined> {
  if (isWin) return undefined;
  const r = await run('ps', ['-Ao', '%cpu=,comm='], 5000);
  const out: Record<string, number> = {};
  for (const line of r.stdout.split('\n')) {
    const m = line.trim().match(/^([\d.]+)\s+(.+)$/);
    if (!m) continue;
    const name = m[2].match(/\/([^/]+)\.app\//)?.[1] ?? m[2].split('/').pop() ?? m[2];
    out[name] = (out[name] ?? 0) + Number(m[1]);
  }
  return out;
}

async function dnsServers(): Promise<string[]> {
  if (isWin) return (await powershell('Get-DnsClientServerAddress -AddressFamily IPv4 | ForEach-Object ServerAddresses', 10_000)).stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (isMac) return [...new Set([...(await run('/usr/sbin/scutil', ['--dns'], 5000)).stdout.matchAll(/nameserver\[\d+\]\s*:\s*(\S+)/g)].map((m) => m[1]))];
  const t = await fsp.readFile('/etc/resolv.conf', 'utf8').catch(() => '');
  return [...t.matchAll(/^nameserver\s+(\S+)/gm)].map((m) => m[1]);
}

async function audioOutput(): Promise<string | undefined> {
  if (isMac) {
    const r = await run('/usr/sbin/system_profiler', ['SPAudioDataType'], 15_000);
    // The block that says "Default Output Device: Yes" starts with the device name.
    const blocks = r.stdout.split(/\n(?=\s{8}\S[^\n]*:\n)/);
    const hit = blocks.find((b) => /Default Output Device: Yes/.test(b));
    return hit?.trim().split('\n')[0].replace(/:$/, '').trim();
  }
  if (isLinux) {
    const r = await run('pactl', ['get-default-sink'], 3000);
    return r.ok ? r.stdout.trim() : undefined;
  }
  return undefined;
}

async function downloadsActive(): Promise<number> {
  const dir = path.join(os.homedir(), 'Downloads');
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => PARTIAL.test(n)).length;
}

async function lockScreen() {
  if (isMac) await run('/usr/bin/pmset', ['displaysleepnow'], 5000);
  else if (isWin) await run('rundll32.exe', ['user32.dll,LockWorkStation'], 5000);
  else if (!(await run('loginctl', ['lock-session'], 5000)).ok) await run('xdg-screensaver', ['lock'], 5000);
}

