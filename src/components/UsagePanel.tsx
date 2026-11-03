// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Performance: how much of the computer Keeper uses right now, what
// its background work is doing (and why it waits), the mode, and memory choices.

import { useEffect, useState } from 'react';
import type { KeeperUsage } from '../../core/api-usage';
import type { ResourceMode } from '../../core/governor';
import { formatBytes } from '../../core/format';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Toggle } from './ui';
import '../styles/usage.css';

const MODES: [ResourceMode, string, string][] = [
  // The stored values stay 'minimal', 'balanced' and 'performance' (settings from every version read the same).
  ['minimal', 'Save battery', 'The least use of your computer. Reading text in pictures and understanding files wait until you take a break on mains power; checks look less often. From the next start Keeper also draws without the graphics card (about 60 MB less), unless a live wallpaper is playing.'],
  ['balanced', 'Balanced', 'Background work fits around you: it slows down while you work, waits on battery for the heavy parts and catches up when you are away.'],
  ['performance', 'Fastest', 'Gets everything ready as fast as possible, even while you work or on battery. Keeper’s window also stays loaded when closed to the tray.'],
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
        <div className="usage-stat"><Icon name="bolt" size={16} /><div><b>{u ? `${u.cpu.toFixed(1)}%` : '…'}</b><span className="small muted" title="% of one core">processor</span></div></div>
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

      {u && u.hardwareGraphics !== undefined && (mode === 'minimal') === u.hardwareGraphics ? (
        <div className="small muted" style={{ marginTop: 8 }}><Icon name="info" size={13} style={{ verticalAlign: -2 }} /> {mode === 'minimal' ? 'Keeper stops using the graphics card the next time it starts.' : 'Keeper uses the graphics card again the next time it starts.'}</div>
      ) : null}

      <div className="usage-memory">
        <div className="usage-memory-row">
          <div className="grow">
            <b>Close the window to free memory</b>
            <div className="small muted">When you close Keeper’s window and it keeps running in the tray, its page is let go a moment later (about 50–80 MB). Opening it again takes under a second and brings back your tabs, pages, scroll positions and drafts. Off keeps it loaded{mode === 'performance' ? '' : ' for a while (15 minutes, 2 in Save battery)'}.</div>
          </div>
          <Toggle label="Close the window to free memory" on={settings.freeWindowOnClose ?? mode !== 'performance'} onChange={(v) => void updateSettings({ freeWindowOnClose: v })} />
        </div>
        <div className="small muted">All of Keeper’s windows (the main window, the Island, Quick Search, widgets) share one page process instead of one each, which saves memory for every small window. Most of the memory left is Keeper’s engine itself: the window system, graphics and network parts every app built this way carries.</div>
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
