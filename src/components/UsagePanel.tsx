// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Keeper's own usage: how much of the computer Keeper uses right
// now, what its background work is doing (and why it waits), and the mode.

import { useEffect, useState } from 'react';
import type { KeeperUsage } from '../../core/api-usage';
import type { ResourceMode } from '../../core/governor';
import { formatBytes } from '../../core/format';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import '../styles/usage.css';

const MODES: [ResourceMode, string, string][] = [
  ['minimal', 'Minimal', 'The least use of your computer. Reading text in pictures and understanding files wait until you take a break on mains power; checks look less often.'],
  ['balanced', 'Balanced', 'Background work fits around you: it slows down while you work, waits on battery for the heavy parts and catches up when you are away.'],
  ['performance', 'Performance', 'Gets everything ready as fast as possible, even while you work or on battery. Keeper’s window also stays loaded when closed to the tray.'],
];

const CHECK_NAMES: Record<string, string> = {
  'island.clipboard': 'Clipboard history',
  'island.tick': 'Focus timer and break reminders',
  'island.agents': 'Coding assistant sessions',
  'island.media': 'Now playing',
  'island.awake': 'Keep awake',
  'island.battery': 'Battery',
  'island.devices': 'Volume, brightness and devices',
  'island.housekeeping': 'Notifications and drive keep-alive',
  'island.fullscreen': 'Hide in full screen',
  'island.mic': 'Microphone in use',
  'island.calendar': 'Calendar',
  'island.weather': 'Weather',
  'places.mounts': 'Disks and servers',
  'library.rescan': 'Library re-read',
  'rules.run': 'Automations',
};

function every(ms: number | null): string {
  if (ms === null) return 'paused';
  if (ms < 1000) return `every ${(ms / 1000).toFixed(1)} s`;
  if (ms < 60_000) return `every ${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `every ${Math.round(ms / 60_000)} min`;
  return `every ${Math.round(ms / 3_600_000)} h`;
}

export function UsagePanel() {
  const { settings, updateSettings } = useStore();
  const [u, setU] = useState<KeeperUsage | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => void api.usage.get().then((x) => alive && setU(x)).catch(() => undefined);
    load();
    // Only while this page is open, and gently.
    const h = setInterval(load, 3000);
    return () => { alive = false; clearInterval(h); };
  }, []);
  if (!settings) return null;
  const mode = settings.resourceMode ?? 'balanced';
  const busy = u?.tasks.filter((t) => t.state !== 'idle') ?? [];
  const why = u ? [u.conditions.onBattery && 'on battery', u.conditions.locked && 'screen locked', u.conditions.idleSec >= 60 && 'you are away', u.conditions.thermal !== 'nominal' && `heat: ${u.conditions.thermal}`, u.conditions.lowPower && 'low power mode', u.conditions.memoryLow && 'memory is short'].filter(Boolean) : [];

  return (
    <div className="usage">
      <div className="usage-stats">
        <div className="usage-stat"><Icon name="bolt" size={16} /><div><b>{u ? `${u.cpu.toFixed(1)}%` : '…'}</b><span className="small muted">processor (of one core)</span></div></div>
        <div className="usage-stat"><Icon name="weight" size={16} /><div><b>{u ? formatBytes(u.memory) : '…'}</b><span className="small muted">memory</span></div></div>
        <div className="usage-stat"><Icon name="grid" size={16} /><div><b>{u?.processes ?? '…'}</b><span className="small muted">processes</span></div></div>
      </div>
      {why.length ? <div className="small muted" style={{ marginTop: 8 }}>Right now: {why.join(' · ')}.</div> : null}

      <div className="usage-tasks">
        {busy.length === 0 ? (
          <div className="small muted"><Icon name="check" size={13} style={{ verticalAlign: -2 }} /> Nothing running in the background.</div>
        ) : busy.map((t) => (
          <div key={t.id} className={`usage-task ${t.state}`}>
            <span className={`usage-dot ${t.state}`} />
            <span className="grow"><b>{t.label}</b>{t.pending ? <span className="muted"> · {t.pending.toLocaleString()} left</span> : null}</span>
            <span className="small muted">{t.state === 'waiting' ? t.detail ?? 'Waiting' : t.detail ?? 'Working'}</span>
          </div>
        ))}
      </div>

      <div className="update-modes" role="radiogroup" aria-label="How much Keeper may use">
        {MODES.map(([value, title, desc]) => (
          <label key={value} className={`update-mode ${mode === value ? 'on' : ''}`}>
            <input type="radio" name="resourceMode" checked={mode === value} onChange={() => void updateSettings({ resourceMode: value })} />
            <div>
              <div className="update-mode-title">{title}</div>
              <div className="small muted">{desc}</div>
            </div>
          </label>
        ))}
      </div>

      <button className="notes-toggle" style={{ marginTop: 10 }} onClick={() => setShowChecks(!showChecks)}>
        <Icon name={showChecks ? 'chevronDown' : 'chevronRight'} size={13} /> Regular checks ({u?.checks.length ?? 0})
      </button>
      {showChecks && u ? (
        <div className="usage-checks">
          {u.checks.map((c) => (
            <div key={c.name} className="usage-check"><span className="grow">{CHECK_NAMES[c.name] ?? c.name}</span><span className="small muted">{every(c.everyMs)}</span></div>
          ))}
          <div className="small muted" style={{ marginTop: 6 }}>Checks slow down when you are away or on battery, pause while the screen is locked, and speed up the moment you are back.</div>
        </div>
      ) : null}
    </div>
  );
}
