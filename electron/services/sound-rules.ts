// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sound for each app: remembers the volume, mute and output given to an app in
// Health → Sound & tabs (<userData>/sound-rules.json) and sets them again when
// that app starts playing. Linux listens to the sound server's own events
// (`pactl subscribe`, one small process, no polling); on a Mac with the
// per-app volume experiment on, one look every 5 seconds; Windows keeps each
// app's volume itself, so nothing runs there. Nothing at all while it is off.

import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { appKey, forget, newStreamEvent, normalizeSoundRules, remember, rulePlan, type SoundRule, type SoundRules } from '../../core/sound-rules';
import { featureOn, onFeature } from './features';
import { poll } from './governor';
import { mixer, setStream, setStreamOutput, streamById } from './monitor-extras';

const FEATURE = 'soundPerApp';
const OS = process.platform;
const file = () => path.join(app.getPath('userData'), 'sound-rules.json');

let rules: SoundRules | null = null;
const seen = new Set<string>();
let broadcast: (channel: string) => void = () => undefined;

function load(): SoundRules {
  if (rules) return rules;
  try { rules = normalizeSoundRules(JSON.parse(readFileSync(file(), 'utf8'))); } catch { rules = {}; }
  return rules;
}

async function save(next: SoundRules) {
  rules = next;
  const tmp = `${file()}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next)).catch(() => undefined);
  await fsp.rename(tmp, file()).catch(() => undefined);
}

/** The person changed an app's volume, mute or output: keep it for that app. */
export async function rememberChange(id: string, patch: SoundRule) {
  if (!featureOn(FEATURE)) return;
  const s = streamById(id);
  if (!s) return;
  seen.add(id);
  await save(remember(load(), s, patch));
  broadcast('sound-rules-changed');
}

/** Sets remembered levels and outputs on apps that started playing since the last look. */
let applying: Promise<void> | null = null;
function applyRules(): Promise<void> {
  applying ??= (async () => {
    try {
      const m = await mixer();
      if (!m.supported) return;
      const r = load();
      const outputs = m.outputs.map((o) => o.id);
      for (const step of rulePlan(r, m.streams, seen, outputs)) {
        if (step.volume !== undefined || step.muted !== undefined) await setStream(step.id, { volume: step.volume, muted: step.muted }).catch(() => false);
        if (step.output) await setStreamOutput(step.id, step.output).catch(() => false);
      }
      const now = new Set(m.streams.map((s) => s.id));
      for (const id of [...seen]) if (!now.has(id)) seen.delete(id);
      for (const id of now) seen.add(id);
    } finally {
      applying = null;
    }
  })();
  return applying;
}

/** The mixer with each app marked when Keeper keeps something for it. */
export function markRemembered<T extends { streams: { name: string; remembered?: boolean }[] }>(m: T): T {
  if (!featureOn(FEATURE)) return m;
  const r = load();
  return { ...m, streams: m.streams.map((s) => ({ ...s, remembered: !!r[appKey(s.name)] })) };
}

export async function forgetApp(name: string): Promise<SoundRules> {
  await save(forget(load(), name));
  broadcast('sound-rules-changed');
  return load();
}

export const soundRules = () => ({ on: featureOn(FEATURE), rules: load() });

// ---------------------------------------------------------------- listening

let sub: ChildProcess | null = null;
let stopPoll: (() => void) | undefined;
let debounce: NodeJS.Timeout | undefined;
let retry: NodeJS.Timeout | undefined;

function listen(on: boolean) {
  clearTimeout(retry);
  if (!on) {
    sub?.kill();
    sub = null;
    stopPoll?.();
    stopPoll = undefined;
    seen.clear();
    return;
  }
  // Apps already playing get their sound back too.
  void applyRules();
  if (OS === 'linux' && !sub) {
    const child = spawn('pactl', ['subscribe'], { stdio: ['ignore', 'pipe', 'ignore'] });
    sub = child;
    createInterface({ input: child.stdout! }).on('line', (line) => {
      if (!newStreamEvent(line)) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => void applyRules(), 300);
    });
    child.on('error', () => undefined);
    child.on('exit', () => {
      if (sub !== child) return;
      sub = null;
      // The sound server restarted (or is not there): try again in a while.
      if (featureOn(FEATURE)) retry = setTimeout(() => listen(true), 30_000);
    });
  } else if (OS === 'darwin' && !stopPoll && featureOn('macAppVolume')) {
    stopPoll = poll('sound.rules', { baseMs: 5000, idleFactor: 3, pauseWhenLocked: true, maxMs: 60_000 }, applyRules, { feature: [FEATURE, 'macAppVolume'], now: false });
  }
}

export function startSoundRules(d: { broadcast: (channel: string) => void }) {
  broadcast = d.broadcast;
  onFeature(FEATURE, listen, { now: true });
  onFeature('macAppVolume', () => { if (featureOn(FEATURE)) { listen(false); listen(true); } });
}
