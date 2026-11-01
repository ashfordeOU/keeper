// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Watches for screen capture so Stage mode can start by itself (Settings →
// Features → "Stage: start when the screen is captured"). Linux listens to
// PipeWire's own change stream (no polling); the rest is one look every few
// seconds through the governor, slower while you are away and paused while
// the screen is locked. Nothing runs while the feature is off.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { run } from '../../../core/platform';
import { grabberSources, macWindowSources, PwDumpStream, recorderSources, captureView, newTracker, track, type CaptureSource, type CaptureTracker } from '../../../core/stage/capture';
import type { StageAutoSettings, StageCapture, StageOs } from '../../../core/stage/types';
import { frontmostApp, runningApps } from '../devices';
import { poll, pollNow } from '../governor';

const OS = process.platform as StageOs;

export interface CaptureFacts {
  /** Keeper's own recorder is running */
  keeperRecording: () => boolean;
}

function onPath(tool: string) {
  return (process.env.PATH ?? '').split(path.delimiter).some((d) => d && existsSync(path.join(d, tool)));
}

export class CaptureWatch {
  private pw: ChildProcess | null = null;
  private stream = new PwDumpStream();
  private stopPoll?: () => void;
  private tracker: CaptureTracker = newTracker();
  private last: CaptureSource[] = [];
  private cfg?: StageAutoSettings;

  constructor(private facts: CaptureFacts, private changed: (c: StageCapture) => void) {}

  get running() { return !!this.stopPoll; }

  start(cfg: StageAutoSettings) {
    this.cfg = cfg;
    if (this.stopPoll) return;
    if (OS === 'linux' && cfg.streams && onPath('pw-dump')) this.startPipeWire();
    this.stopPoll = poll('stage.capture', { baseMs: 5000, idleFactor: 2, pauseWhenLocked: true, maxMs: 30_000 }, () => this.look(), { feature: 'stageAuto' });
  }

  update(cfg: StageAutoSettings) {
    this.cfg = cfg;
    if (OS === 'linux') {
      if (cfg.streams && !this.pw && onPath('pw-dump')) this.startPipeWire();
      if (!cfg.streams && this.pw) this.stopPipeWire();
    }
  }

  stop() {
    this.stopPoll?.();
    this.stopPoll = undefined;
    this.stopPipeWire();
    this.tracker = newTracker();
    this.last = [];
  }

  private startPipeWire() {
    this.stream.reset();
    const p = spawn('pw-dump', ['--monitor', '--no-colors'], { stdio: ['ignore', 'pipe', 'ignore'] });
    p.stdout?.on('data', (d: Buffer) => { if (this.stream.push(d.toString('utf8'))) pollNow('stage.capture'); });
    p.on('error', () => { this.pw = null; });
    p.on('exit', () => { if (this.pw === p) this.pw = null; });
    this.pw = p;
  }

  private stopPipeWire() {
    try { this.pw?.kill(); } catch { /* gone */ }
    this.pw = null;
    this.stream.reset();
  }

  /** What is seen right now (also used by the "What does Keeper see?" button). */
  async sources(): Promise<CaptureSource[]> {
    const cfg = this.cfg;
    const out: CaptureSource[] = [];
    if (cfg?.keeperRecorder !== false && this.facts.keeperRecording()) out.push({ label: 'Keeper is recording the screen', reliable: true });
    if (OS === 'linux' && cfg?.streams !== false) {
      if (this.pw) out.push(...this.stream.sources());
      else if (onPath('pw-dump')) {
        const once = new PwDumpStream();
        once.push((await run('pw-dump', ['--no-colors'], 8000)).stdout);
        out.push(...once.sources());
      }
    }
    if (cfg?.apps !== false) {
      const [apps, front] = await Promise.all([runningApps().catch(() => [] as string[]), frontmostApp().catch(() => undefined)]);
      out.push(...recorderSources(OS, apps, front, cfg?.extraApps ?? []));
      if (OS === 'darwin') {
        const { macHelperCall } = await import('../platform/mac');
        const w = await macHelperCall<{ windows: { owner: string; layer: number }[] }>('stage.windows', {}, 4000).catch(() => null);
        if (w) out.push(...macWindowSources(w.windows));
      } else if (OS === 'linux') {
        const r = await run('pgrep', ['-af', 'ffmpeg|gst-launch'], 3000);
        out.push(...grabberSources(r.stdout.split('\n')));
      }
    }
    return out;
  }

  private async look() {
    const s = await this.sources();
    const was = this.tracker.active;
    this.tracker = track(this.tracker, s);
    const changedList = JSON.stringify(s) !== JSON.stringify(this.last);
    this.last = s;
    if (was !== this.tracker.active || changedList) this.changed(this.view());
  }

  view(): StageCapture {
    return captureView(OS, this.tracker, this.last);
  }
}
