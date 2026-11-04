// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo data for Settings → Battery and speed.

import type { UsageApi } from '../core/api-usage';

export function mockUsage(): UsageApi {
  return {
    get: async () => ({
      cpu: 0.4 + Math.random() * 0.3,
      memory: 212 * 1048576,
      processes: 5,
      mode: 'balanced',
      conditions: { onBattery: false, locked: false, idleSec: 3, thermal: 'nominal', lowPower: false, memoryLow: false },
      tasks: [
        { id: 'vision', label: 'Reading text in documents and pictures', kind: 'text', state: 'idle' },
        { id: 'brain', label: 'Understanding what your files are about', kind: 'embed', state: 'waiting', detail: 'On battery: continues when plugged in', pending: 1240 },
      ],
      checks: [
        { name: 'island.clipboard', everyMs: 700, runs: 1200 },
        { name: 'island.media', everyMs: 15_000, runs: 40 },
        { name: 'places.mounts', everyMs: 4000, runs: 150 },
        { name: 'library.rescan', everyMs: 1_800_000, runs: 1 },
      ],
    }),
  };
}
