// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Voice keeps its own plain files in Keeper's data folder: settings (with the
// dictionary and snippets), the dictation history, and one JSON file per
// meeting (plus its sound, only when the person keeps recordings).

import { app } from 'electron';
import { existsSync, promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { mergeVoiceSettings, normalizeVoiceSettings } from '../../../core/voice/settings';
import { pruneTakes } from '../../../core/voice/history';
import type { DeepPartial, MeetingRecord, Take, VoiceSettings } from '../../../core/voice/types';
import { settings } from '../../store';

export const voiceDir = () => path.join(app.getPath('userData'), 'voice');
const settingsFile = () => path.join(voiceDir(), 'settings.json');
const takesFile = () => path.join(voiceDir(), 'history.json');
export const meetingsDir = () => path.join(voiceDir(), 'meetings');
export const audioDir = () => path.join(voiceDir(), 'audio');

async function writeJson(file: string, v: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(v, null, 1));
  await fsp.rename(tmp, file);
}

let cached: VoiceSettings | null = null;
const listeners = new Set<(s: VoiceSettings, prev: VoiceSettings) => void>();

export function voiceSettings(): VoiceSettings {
  if (cached) return cached;
  let raw: unknown = {};
  try {
    if (existsSync(settingsFile())) raw = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    // first run: keep the dictation shortcut the person already had in Island settings
    else raw = { dictation: { shortcut: settings().island?.dictationShortcut || undefined } };
  } catch { /* start fresh */ }
  cached = normalizeVoiceSettings(raw, process.platform);
  return cached;
}

export async function saveVoiceSettings(patch: DeepPartial<VoiceSettings>): Promise<VoiceSettings> {
  const prev = voiceSettings();
  const next = normalizeVoiceSettings(mergeVoiceSettings(prev, patch), process.platform);
  cached = next;
  await writeJson(settingsFile(), next);
  for (const fn of listeners) fn(next, prev);
  return next;
}

export function onVoiceSettings(fn: (s: VoiceSettings, prev: VoiceSettings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------- dictation history

let takes: Take[] | null = null;
let takesTimer: NodeJS.Timeout | undefined;

export async function loadTakes(): Promise<Take[]> {
  if (takes) return takes;
  try { takes = JSON.parse(await fsp.readFile(takesFile(), 'utf8')) as Take[]; } catch { takes = []; }
  return takes;
}

function saveTakesSoon() {
  clearTimeout(takesTimer);
  takesTimer = setTimeout(() => void writeJson(takesFile(), takes ?? []), 400);
}

export async function addTake(t: Take, cap: number) {
  const all = await loadTakes();
  const { keep, drop } = pruneTakes([t, ...all], cap);
  takes = keep;
  for (const d of drop) if (d.audio) void fsp.rm(d.audio, { force: true });
  saveTakesSoon();
}

export async function updateTake(id: string, patch: Partial<Take>) {
  const all = await loadTakes();
  takes = all.map((t) => (t.id === id ? { ...t, ...patch } : t));
  saveTakesSoon();
}

export async function removeTakes(ids?: string[]) {
  const all = await loadTakes();
  const gone = ids ? all.filter((t) => ids.includes(t.id)) : all;
  for (const d of gone) if (d.audio) await fsp.rm(d.audio, { force: true });
  takes = ids ? all.filter((t) => !ids.includes(t.id)) : [];
  saveTakesSoon();
}

// ---------------------------------------------------------------- remembered voices

const voicesFile = () => path.join(voiceDir(), 'voices.json');

export async function loadVoices(): Promise<import('../../../core/voice/diarize').VoiceProfile[]> {
  try { return JSON.parse(await fsp.readFile(voicesFile(), 'utf8')); } catch { return []; }
}

export const saveVoices = (v: import('../../../core/voice/diarize').VoiceProfile[]) => writeJson(voicesFile(), v);

// ---------------------------------------------------------------- meetings

const meetingFile = (id: string) => path.join(meetingsDir(), `${id.replace(/[^\w-]/g, '')}.json`);

export async function listMeetings(): Promise<MeetingRecord[]> {
  const names = await fsp.readdir(meetingsDir()).catch(() => [] as string[]);
  const out: MeetingRecord[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try { out.push(JSON.parse(await fsp.readFile(path.join(meetingsDir(), n), 'utf8')) as MeetingRecord); } catch { /* skip a broken file */ }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

export async function readMeeting(id: string): Promise<MeetingRecord | null> {
  try { return JSON.parse(await fsp.readFile(meetingFile(id), 'utf8')) as MeetingRecord; } catch { return null; }
}

export const saveMeeting = (m: MeetingRecord) => writeJson(meetingFile(m.id), m);

export async function deleteMeeting(id: string) {
  const m = await readMeeting(id);
  for (const f of [m?.audio?.mic, m?.audio?.system]) if (f) await fsp.rm(f, { force: true });
  await fsp.rm(meetingFile(id), { force: true });
}
