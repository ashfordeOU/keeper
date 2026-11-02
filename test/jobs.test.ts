// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Long jobs the person starts (recordings, exports, downloads, backups, transfers) are listed
// as Keeper's work while they run, which is what Keep Awake's "while Keeper is working" reads.
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

const blockers = new Set<number>();
let next = 1;
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getAppMetrics: () => [], isHardwareAccelerationEnabled: () => true, on: () => undefined, isReady: () => false },
  BrowserWindow: { getAllWindows: () => [] },
  powerMonitor: { on: () => undefined, getSystemIdleTime: () => 0, isOnBatteryPower: () => false },
  powerSaveBlocker: { start: () => { const id = next++; blockers.add(id); return id; }, stop: (id: number) => blockers.delete(id) },
}));

describe('jobs', () => {
  it('a job is listed as working until it ends, and a recording holds off sleep meanwhile', async () => {
    const { asJob, startJob, usage } = await import('../electron/services/governor');
    const rec = startJob('Studio recording', { id: 'studio-recording', keepAwake: true });
    rec.update('0:42');
    let t = usage().tasks.find((x) => x.id === 'studio-recording');
    expect(t).toMatchObject({ label: 'Studio recording', state: 'working', detail: '0:42', job: true });
    expect(blockers.size).toBe(1);
    rec.end();
    rec.end();
    expect(usage().tasks.some((x) => x.id === 'studio-recording')).toBe(false);
    expect(blockers.size).toBe(0);

    // asJob ends the job however the work ends
    await expect(asJob('Backup: Photos', async () => {
      expect(usage().tasks.some((x) => x.label === 'Backup: Photos' && x.state === 'working')).toBe(true);
      throw new Error('drive gone');
    })).rejects.toThrow('drive gone');
    t = usage().tasks.find((x) => x.label === 'Backup: Photos');
    expect(t).toBeUndefined();
  });
});
