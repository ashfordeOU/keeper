// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sound for each app: Keeper remembers the volume, mute and output you give
// an app in Health → Sound & tabs, and sets them again the next time that app
// starts playing. Linux can also send each app to its own output (PipeWire or
// PulseAudio); Windows keeps per-app volumes itself; on a Mac the volume of
// one app is an experiment through the system's audio capture (macOS 14.2+).
// Pure: electron/services/sound-rules.ts listens and applies.

import type { MixerStream } from './monitor-mixer';

export interface SoundRule { volume?: number; muted?: boolean; output?: string }
export type SoundRules = Record<string, SoundRule>;

/** One name per app, whatever its streams are called this time ("Firefox", "firefox-bin" → "firefox"). */
export const appKey = (name: string) => name.trim().toLowerCase().replace(/\.(exe|app|bin)$/, '').replace(/[-_ ](bin|helper)$/, '').replace(/\s+/g, ' ');

/** The rules after the person changed an app's volume, mute or output. A plain 100%, unmuted, default output is no rule at all. */
export function remember(rules: SoundRules, stream: Pick<MixerStream, 'name'>, patch: SoundRule): SoundRules {
  const k = appKey(stream.name);
  if (!k) return rules;
  const next: SoundRule = { ...rules[k], ...patch };
  if (next.volume !== undefined) next.volume = Math.max(0, Math.min(150, Math.round(next.volume)));
  const plain = (next.volume === undefined || next.volume === 100) && !next.muted && !next.output;
  const out = { ...rules };
  if (plain) delete out[k];
  else out[k] = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== false && v !== '')) as SoundRule;
  return out;
}

export const forget = (rules: SoundRules, key: string): SoundRules => {
  const out = { ...rules };
  delete out[appKey(key)];
  return out;
};

/** What to change on streams Keeper has not seen before (it never fights a change made elsewhere afterwards). */
export function rulePlan(rules: SoundRules, streams: (MixerStream & { output?: string })[], seen: Set<string>, outputs: string[]): { id: string; volume?: number; muted?: boolean; output?: string }[] {
  const out: { id: string; volume?: number; muted?: boolean; output?: string }[] = [];
  for (const s of streams) {
    if (seen.has(s.id)) continue;
    const r = rules[appKey(s.name)];
    if (!r) continue;
    const step: { id: string; volume?: number; muted?: boolean; output?: string } = { id: s.id };
    if (r.volume !== undefined && Math.abs(r.volume - s.volume) >= 1) step.volume = r.volume;
    if (r.muted !== undefined && r.muted !== s.muted) step.muted = r.muted;
    if (r.output && r.output !== s.output && outputs.includes(r.output)) step.output = r.output;
    if (Object.keys(step).length > 1) out.push(step);
  }
  return out;
}

export function normalizeSoundRules(raw: unknown): SoundRules {
  const out: SoundRules = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as SoundRule;
    const rule: SoundRule = {};
    if (Number.isFinite(Number(r.volume))) rule.volume = Math.max(0, Math.min(150, Math.round(Number(r.volume))));
    if (r.muted === true) rule.muted = true;
    if (typeof r.output === 'string' && /^[\w.:@-]{1,200}$/.test(r.output)) rule.output = r.output;
    if (Object.keys(rule).length) out[appKey(k)] = rule;
  }
  return out;
}

// ---------------------------------------------------------------- Linux: each app's own output

/** `pactl list sink-inputs`: the sink (index) each stream plays to. */
export function streamSinks(out: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const block of out.split(/\n(?=Sink Input #)/)) {
    const id = block.match(/^Sink Input #(\d+)/)?.[1];
    const sink = block.match(/^\s*Sink:\s*(\d+)/m)?.[1];
    if (id && sink) m.set(id, sink);
  }
  return m;
}

/** `pactl list short sinks`: index → name. */
export function sinkIndex(short: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of short.split('\n')) {
    const f = l.trim().split(/\s+/);
    if (f.length >= 2 && /^\d+$/.test(f[0])) m.set(f[0], f[1]);
  }
  return m;
}

export function linuxMoveCmd(id: string, sink: string) {
  if (!/^\d+$/.test(id)) throw new Error('Not a stream');
  if (!/^[\w.:@-]+$/.test(sink)) throw new Error('Not an output device name');
  return { file: 'pactl', args: ['move-sink-input', id, sink] };
}

/** `pactl subscribe` lines that mean a new app started playing ("Event 'new' on sink-input #42"). */
export const newStreamEvent = (line: string) => /Event 'new' on sink-input #\d+/.test(line);

// ---------------------------------------------------------------- macOS (keeper-helper)

/** keeper-helper's `audio.processes`: apps with sound going out, by process. */
export function macStreams(list: { pid: number; bundleId?: string; name?: string; volume?: number; muted?: boolean }[]): MixerStream[] {
  const by = new Map<number, MixerStream>();
  for (const p of list) {
    if (!Number.isInteger(p.pid) || p.pid <= 0 || by.has(p.pid)) continue;
    by.set(p.pid, { id: String(p.pid), pid: p.pid, name: p.name || p.bundleId || `Process ${p.pid}`, volume: Math.round((p.volume ?? 1) * 100), muted: !!p.muted });
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const MAC_EXPERIMENT_NOTE = 'Volume for each app on a Mac is an experiment (Settings → Features → Computer): it uses the system’s audio capture, so the app’s sound is muted and played again at your level, with a little delay.';
