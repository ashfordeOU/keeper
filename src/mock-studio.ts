// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Studio in the browser demo: the recorder page with its options and an
// empty list of recordings; nothing is recorded or written.

import { defaultStudioOptions, normalizeStudioOptions, type StudioApi, type StudioOptions, type StudioRecordState } from '../core/studio/api';

export function mockStudio(emit: (ch: string, ...a: unknown[]) => void): { studio: StudioApi } {
  let opts: StudioOptions = defaultStudioOptions();
  let state: StudioRecordState = { phase: 'idle' };
  const no = () => Promise.reject(new Error('Recording needs the Keeper app; the demo cannot record.'));
  const studio: StudioApi = {
    support: async () => ({ platform: 'browser', screen: { how: 'browser', cursorHidden: false, note: 'This is the demo: install Keeper to record.' }, input: { clicks: false, keys: false }, systemAudio: false, ffmpeg: false, wayland: false }),
    options: async () => opts,
    setOptions: async (patch) => { opts = normalizeStudioOptions({ ...opts, ...patch }); return opts; },
    state: async () => state,
    record: async () => { state = { phase: 'idle', error: 'Recording needs the Keeper app; the demo cannot record.' }; emit('studio-changed', state); return state; },
    pause: async () => state,
    resume: async () => state,
    stop: async () => state,
    discard: async () => state,
    projects: async () => [],
    open: no,
    save: async () => undefined,
    remove: async () => undefined,
    reveal: async () => undefined,
    pick: async () => null,
    levels: async () => ({ stepMs: 50, levels: [] }),
    transcribe: no,
    privacyScan: no,
    export: no,
    shareTarget: async () => ({ kind: 'none' as const, where: '', hours: 72 }),
    share: no,
    exportState: async () => null,
    cancelExport: async () => undefined,
    copyFile: async () => undefined,
    revealFile: async () => undefined,
    work: no,
    workChunk: async () => undefined,
    workProgress: async () => ({ cancelled: true }),
    workDone: async () => undefined,
  };
  return { studio };
}
