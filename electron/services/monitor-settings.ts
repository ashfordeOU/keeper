// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The monitor's own settings file (menu-bar readings, surfaces, history
// length, launcher shortcut, standard output folder), kept apart from the
// main settings so it can change without touching them.

import { app } from 'electron';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeMonitorSettings, type MonitorSettings } from '../../core/monitor-tray';

const file = () => path.join(app.getPath('userData'), 'monitor-settings.json');
let current: MonitorSettings | null = null;
const listeners = new Set<(next: MonitorSettings, prev: MonitorSettings) => void>();

export function monitorSettings(): MonitorSettings {
  if (!current) {
    try {
      current = normalizeMonitorSettings(JSON.parse(readFileSync(file(), 'utf8')));
    } catch {
      current = normalizeMonitorSettings(null);
    }
  }
  return current;
}

export async function setMonitorSettings(patch: Partial<MonitorSettings>): Promise<MonitorSettings> {
  const prev = monitorSettings();
  const next = normalizeMonitorSettings({ ...prev, ...patch, surfaces: { ...prev.surfaces, ...patch.surfaces }, tray: { ...prev.tray, ...patch.tray }, output: { ...prev.output, ...patch.output } });
  current = next;
  await fsp.writeFile(file() + '.tmp', JSON.stringify(next, null, 1)).then(() => fsp.rename(file() + '.tmp', file())).catch(() => undefined);
  for (const l of listeners) {
    try {
      l(next, prev);
    } catch {
      /* one listener failing does not stop the others */
    }
  }
  return next;
}

export function onMonitorSettings(fn: (next: MonitorSettings, prev: MonitorSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
