// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Modes in the main process: switching (with the computer's context, so the
// essentials match this computer), Reset, and the timed Focus session. The
// session holds one timer while it runs and none otherwise.

import { modeOf, normalizeSession, previewSwitch, resetModePatch, startSession, switchPatch, type ModeChoice, type ModePreview, type ModeSession, type ModeState } from '../../core/modes';
import { onSettings, settings, updateSettings } from '../store';
import { computerContext } from './setup';

export interface ModesDeps {
  /** start or stop the Island's focus timer (notices wait while it runs) */
  focus(action: 'start' | 'stop', minutes?: number): void;
  /** the mode or the session changed (the tray menu reads them) */
  changed(): void;
}

let deps: ModesDeps | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastKey = '';

const ctx = () => computerContext().catch(() => undefined);
const platform = process.platform;

export function initModes(d: ModesDeps) {
  deps = d;
  armSession();
  onSettings((s) => {
    const key = `${JSON.stringify([s.mode?.base, s.mode?.addons])}:${s.modeSession?.until ?? 0}`;
    if (key === lastKey) return;
    lastKey = key;
    armSession();
    deps?.changed();
  });
}

export async function previewMode(to: ModeChoice): Promise<ModePreview> {
  return previewSwitch(settings(), to, await ctx(), platform);
}

export async function switchMode(to: ModeChoice): Promise<ModeState> {
  const patch = switchPatch(settings(), to, await ctx(), Date.now(), platform);
  if (Object.keys(patch).length) await updateSettings(patch);
  return modeOf(settings());
}

export async function resetMode(): Promise<ModeState> {
  const patch = resetModePatch(settings(), await ctx());
  if (Object.keys(patch).length) await updateSettings(patch);
  return modeOf(settings());
}

export async function startFocusSession(minutes: number): Promise<ModeSession> {
  const session = startSession(Number(minutes) || 50);
  await updateSettings({ modeSession: session });
  deps?.focus('start', Math.round((session.until - session.start) / 60_000));
  return session;
}

export async function endFocusSession(): Promise<void> {
  if (!settings().modeSession) return;
  await updateSettings({ modeSession: null });
  deps?.focus('stop');
}

/** One timer while a session runs, to end it on time; none otherwise. */
function armSession() {
  if (timer) clearTimeout(timer);
  timer = null;
  const s = normalizeSession(settings().modeSession);
  if (!s) {
    if (settings().modeSession) void updateSettings({ modeSession: null });
    return;
  }
  timer = setTimeout(() => { timer = null; void updateSettings({ modeSession: null }); }, Math.min(s.until - Date.now() + 500, 2 ** 31 - 1));
  timer.unref?.();
}
