// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Island+: calls (timer and mute), volume and brightness feedback, the AI
// usage ring beside the pill, the low-disk warning, hide-for-a-minute and
// agent hooks. Everything goes through the governor or system events and
// costs nothing while its feature is off.

import { shell } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IslandState } from '../../core/api';
import { detectCall, type CallState } from '../../core/island-calls';
import { hudTitle, type HudEvent } from '../../core/island-hud';
import { addEditorHooks, hookScriptPs, hookScriptSh, removeEditorHooks } from '../../core/island-agents';
import { statusDir } from '../../core/island-scan';
import { mirrorSupport } from '../../core/island-notify';
import { lowDiskAlert, plusSetting, type IslandPlusStatus } from '../../core/island-plus';
import { mostUsed } from '../../core/island-tools/usage';
import { settings } from '../store';
import { featureOn, onFeature } from './features';
import { poll, pollNow } from './governor';
import { callTitles, macMicApps, muteInApp, setSystemMicMuted, systemMicMuted } from './island-calls';
import { HudWatcher } from './island-hud';
import type { IslandService } from './island';
import { micInUse } from './media';
import { permissionNeeded } from './permission-nudge';
import { onUsageChange, usageIslandAlert } from './usage-tracker';

const HOOK_EDITORS = [
  { id: 'cursor', name: 'Cursor', file: path.join(os.homedir(), '.cursor', 'hooks.json'), dir: path.join(os.homedir(), '.cursor') },
];

export class IslandPlus {
  call?: CallState;
  hud?: HudEvent;
  usagePin?: IslandState['usagePin'];
  cueHere?: IslandState['cueHere'];
  private hudW = new HudWatcher((e) => this.onHud(e));
  private hudClear?: NodeJS.Timeout;
  private stops: (() => void)[] = [];
  private diskWarned = false;
  private hideTimer?: NodeJS.Timeout;
  /** the tool launcher, from main (MONITOR owns it) */
  openLauncher?: () => void;

  constructor(private island: IslandService, private emit: () => void) {}

  start() {
    this.stops.push(
      poll('island.calls', () => ({ baseMs: this.call ? 5000 : 10_000, idleFactor: this.call ? 1 : 3, pauseWhenLocked: true }), () => this.pollCall(), { feature: 'islandCalls' }),
      poll('island.usagePin', { baseMs: 5 * 60_000, idleFactor: 3, pauseWhenLocked: true }, () => this.pollUsagePin(), { feature: 'islandUsage' }),
      poll('island.disk', { baseMs: 10 * 60_000, idleFactor: 2, pauseWhenLocked: true }, () => this.pollDisk(), { feature: 'island' }),
      onFeature('islandHud', (on) => void this.hudOn(on), { now: true }),
      onFeature('islandCalls', (on) => { if (!on && this.call) { this.call = undefined; this.emit(); } }),
      // The usage tracker's ring: redrawn when its numbers change.
      onUsageChange(() => this.emit()),
    );
  }

  stop() {
    this.stops.forEach((s) => s());
    this.stops = [];
    this.hudW.stop();
  }

  /** Adds Island+ parts to what the Island windows see. */
  decorate(s: IslandState): IslandState {
    const m = this.island.mirror;
    return {
      ...s, call: this.call, hud: this.hud, usagePin: plusSetting(settings().island, 'usagePin') ? this.usagePin : undefined, cueHere: this.cueHere, usageAlert: usageIslandAlert(),
      notifyMode: settings().island.notifyMirror ? { mode: m.mode, problem: m.problem } : undefined,
    };
  }

  // ---------------------------------------------------------------- calls

  private async pollCall() {
    let mic: string[];
    if (process.platform === 'darwin') mic = await macMicApps();
    // The Island's own microphone check already runs on this beat; asking the system again doubles the cost at idle.
    else mic = featureOn('micIndicator') && featureOn('island') ? this.island.mic : await micInUse().catch(() => []);
    const titles = mic.length ? await callTitles() : [];
    const next = detectCall({ micApps: mic, titles, prev: this.call, camApps: this.island.cam });
    if (next && (!this.call || this.call.id !== next.id)) {
      const muted = await systemMicMuted().catch(() => undefined);
      if (muted !== undefined) next.muted = muted;
    }
    if (JSON.stringify(next) !== JSON.stringify(this.call)) {
      this.call = next;
      this.emit();
    }
  }

  async callMute(muted: boolean): Promise<{ muted: boolean; how: string }> {
    const c = this.call;
    const how = plusSetting(settings().island, 'callMute');
    let used = 'system';
    if (how === 'app' && c && (await muteInApp(c).catch(() => false))) used = 'app';
    else await setSystemMicMuted(muted);
    if (this.call) this.call = { ...this.call, muted };
    this.emit();
    return { muted, how: used };
  }

  callDismiss() {
    this.call = undefined;
    this.emit();
  }

  // ---------------------------------------------------------------- levels

  private async hudOn(on: boolean) {
    if (!on) { this.hudW.stop(); return; }
    await this.hudW.start({ brightnessKeys: plusSetting(settings().island, 'hudBrightnessKeys') }).catch(() => false);
  }

  private onHud(e: HudEvent) {
    this.hud = e;
    this.emit();
    clearTimeout(this.hudClear);
    this.hudClear = setTimeout(() => { if (this.hud === e) { this.hud = undefined; this.emit(); } }, 1800);
  }

  /** A level set from the Island's own sliders: no pop-up for it. */
  quietLevel(kind: 'volume' | 'brightness', value: number, muted?: boolean) {
    this.hudW.quietly({ kind, value, muted });
  }

  // ---------------------------------------------------------------- usage ring, disk, hiding

  private async pollUsagePin() {
    if (!plusSetting(settings().island, 'usagePin')) return;
    const { usage } = await import('./island-tools');
    const best = mostUsed(await usage().catch(() => []));
    const next = best ? { tool: best.tool, label: `${best.label} · ${best.window.label}`, percent: Math.round(best.window.usedPercent ?? 0) } : undefined;
    if (JSON.stringify(next) !== JSON.stringify(this.usagePin)) { this.usagePin = next; this.emit(); }
  }

  /** Called when the setting is switched on, so the ring shows straight away. */
  refreshUsagePin() {
    pollNow('island.usagePin');
  }

  private async pollDisk() {
    const gb = plusSetting(settings().island, 'lowDiskGb');
    if (!gb) return;
    const root = process.platform === 'win32' ? (process.env.SystemDrive ?? 'C:') + '\\' : '/';
    const st = await fsp.statfs(root).catch(() => null);
    if (!st) return;
    const free = Number(st.bavail) * Number(st.bsize);
    const r = lowDiskAlert(free, gb, this.diskWarned);
    this.diskWarned = r.warned;
    if (r.alert) this.island.alert({ kind: 'disk', title: 'Low on disk space', detail: `${(free / 1e9).toFixed(1)} GB free · Clean Up can make room` });
  }

  hideFor(minutes: number) {
    clearTimeout(this.hideTimer);
    this.island.hide(true);
    this.hideTimer = setTimeout(() => this.island.hide(false), Math.max(0.25, minutes) * 60_000);
  }

  setCueHere(c: IslandState['cueHere']) {
    if (JSON.stringify(c) === JSON.stringify(this.cueHere)) return;
    this.cueHere = c;
    this.emit();
  }

  // ---------------------------------------------------------------- agent hooks

  private async hookScript(): Promise<string> {
    const bin = path.join(os.homedir(), '.keeper', 'bin');
    await fsp.mkdir(bin, { recursive: true });
    if (process.platform === 'win32') {
      const p = path.join(bin, 'keeper-agent-status.ps1');
      await fsp.writeFile(p, hookScriptPs());
      return p;
    }
    const p = path.join(bin, 'keeper-agent-status.sh');
    await fsp.writeFile(p, hookScriptSh(), { mode: 0o755 });
    return p;
  }

  async installAgentHooks(id: string): Promise<{ ok: boolean; message: string }> {
    const ed = HOOK_EDITORS.find((e) => e.id === id);
    if (!ed) return { ok: false, message: 'Keeper does not know that editor’s hooks' };
    if (!existsSync(ed.dir)) return { ok: false, message: `${ed.name} is not set up on this computer` };
    const script = await this.hookScript();
    const cmd = (ev: string) => (process.platform === 'win32' ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" ${ed.id} ${ev}` : `"${script}" ${ed.id} ${ev}`);
    const before = await fsp.readFile(ed.file, 'utf8').catch(() => undefined);
    const next = addEditorHooks(before, cmd);
    if (before !== undefined && before !== next) await fsp.writeFile(`${ed.file}.keeper-backup`, before);
    await fsp.writeFile(ed.file, next);
    await fsp.mkdir(statusDir(), { recursive: true });
    return { ok: true, message: `${ed.name} now tells the Island when its agent works, waits or finishes. Restart ${ed.name} to pick it up.` };
  }

  async removeAgentHooks(id: string): Promise<{ ok: boolean; message: string }> {
    const ed = HOOK_EDITORS.find((e) => e.id === id);
    if (!ed) return { ok: false, message: 'Unknown editor' };
    const before = await fsp.readFile(ed.file, 'utf8').catch(() => undefined);
    if (!before) return { ok: true, message: 'Nothing to remove' };
    await fsp.writeFile(ed.file, removeEditorHooks(before));
    return { ok: true, message: `Keeper’s hooks were removed from ${ed.name}.` };
  }

  // ---------------------------------------------------------------- status

  async status(): Promise<IslandPlusStatus> {
    const sup = mirrorSupport(process.platform);
    const m = this.island.mirror;
    const hooks = await Promise.all(HOOK_EDITORS.map(async (e) => ({ id: e.id, name: e.name, file: e.file, available: existsSync(e.dir), installed: /keeper-agent-status/.test(await fsp.readFile(e.file, 'utf8').catch(() => '')) })));
    let ocrSystem = process.platform === 'darwin' || process.platform === 'win32';
    if (process.platform === 'win32') ocrSystem = !!settings().platform?.nativeOcr;
    return {
      platform: process.platform,
      notify: { mode: m.mode, how: sup.how, problem: m.problem, fragile: sup.fragile, canDismiss: sup.suppress },
      hud: {
        on: featureOn('islandHud'), how: this.hudW.how || 'Starts when switched on.', replaces: false,
        why: process.platform === 'darwin' ? 'macOS draws its own volume and brightness pop-up; only private APIs can hide it, so Keeper shows its level beside it.' : process.platform === 'win32' ? 'Windows draws its own volume flyout; Keeper shows its level beside it rather than hiding the system’s window.' : 'Your desktop draws its own pop-up; Keeper shows its level beside it.',
      },
      calls: { on: featureOn('islandCalls'), perApp: process.platform !== 'darwin' || Number(os.release().split('.')[0]) >= 23, how: process.platform === 'darwin' ? 'Core Audio says which app uses the microphone (macOS 14.2 and later).' : process.platform === 'win32' ? 'Windows’ privacy records say which app uses the microphone.' : 'The sound server says which app records.' },
      agents: { statusDir: statusDir(), hooks },
      ocr: { system: ocrSystem, engines: ocrSystem ? ['system', 'builtin'] : ['builtin'] },
    };
  }

  describeHud(e: HudEvent): string {
    return hudTitle(e);
  }

  openNotifyPermission() {
    // Asked for from the Island: the exact pane, and Keeper's Permissions row highlighted for later.
    if (process.platform === 'darwin') { permissionNeeded('accessibility', 'notifyMirror'); void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'); }
    else if (process.platform === 'win32') void shell.openExternal('ms-settings:privacy-notifications');
  }
}
