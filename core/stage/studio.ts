// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Studio cleans the screen with Stage while it records. When the recording
// ends, Stage goes back to how the person had it: the preset they were in, or
// off. If they changed Stage themselves during the recording, it is left alone.

export interface StageBefore { preset?: string; reason?: string }

/** What Stage looked like when Studio started (null: it was off). */
export function stageBefore(s: { on: boolean; starting?: boolean; preset?: string; reason?: string }): StageBefore | null {
  return s.on || s.starting ? { preset: s.preset, reason: s.reason } : null;
}

/** What to do with Stage when the recording ends. */
export function stageAfterStudio(before: StageBefore | null | undefined, now: { on: boolean; reason?: string }, studioReason = 'Studio'): { action: 'leave' } | { action: 'stop' } | { action: 'restore'; preset: string; reason?: string } {
  // Stage is not (or no longer) Studio's: the person changed it, or Studio never switched it.
  if (!now.on || now.reason !== studioReason) return { action: 'leave' };
  if (before?.preset) return { action: 'restore', preset: before.preset, reason: before.reason };
  return { action: 'stop' };
}
