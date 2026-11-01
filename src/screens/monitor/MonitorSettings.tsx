// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Health → Settings (also in Settings → System monitor): where the monitor
// shows up (menu bar, Island, launcher shortcut), what the menu-bar readings
// show, how long history is kept, where tool results go, quiet apps and the
// folders AI agents may never stop.

import { useEffect, useState } from 'react';
import type { MonitorSettings as MS, TrayMetric } from '../../../core/monitor-tray';
import { TRAY_METRICS } from '../../../core/monitor-tray';
import { api } from '../../api';
import { useFeature } from '../../features';
import { Toggle } from '../../components/ui';
import { useStore } from '../../state';
import { Row } from '../IslandSettings';
import '../../styles/monitor.css';

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(([v, l]) => <button key={String(v)} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}

function ListEditor({ items, placeholder, onChange, pickFolder }: { items: string[]; placeholder: string; onChange: (v: string[]) => void; pickFolder?: boolean }) {
  const [v, setV] = useState('');
  const add = (x: string) => x.trim() && !items.includes(x.trim()) && onChange([...items, x.trim()]);
  return (
    <div className="col" style={{ gap: 6, minWidth: 260 }}>
      <div className="mon-chips">{items.map((x) => <button key={x} className="mon-chip on" title="Remove" onClick={() => onChange(items.filter((y) => y !== x))}>{x} ×</button>)}</div>
      <div className="row" style={{ gap: 6 }}>
        {pickFolder ? <button className="btn sm" onClick={async () => { const p = await api.settings.pickFolder(); if (p) add(p); }}>Add folder…</button> : (
          <>
            <input className="input" style={{ width: 180 }} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { add(v); setV(''); } }} />
            <button className="btn sm" onClick={() => { add(v); setV(''); }}>Add</button>
          </>
        )}
      </div>
    </div>
  );
}

export function MonitorSettingsPanel() {
  const { toast } = useStore();
  const [s, setS] = useState<MS | null>(null);
  const [preview, setPreview] = useState<{ metric: string; image: string; title: string }[]>([]);
  const [out, setOut] = useState('');
  const trayOn = useFeature('monitorTray');
  const launcherOn = useFeature('toolLauncher');

  useEffect(() => { void api.sysmon.settings().then(setS); }, []);
  useEffect(() => {
    if (!s) return;
    void api.sysmon.outputPreview().then(setOut).catch(() => undefined);
    if (!s.surfaces.tray || !trayOn) return;
    const load = () => void api.sysmon.trayPreview().then(setPreview).catch(() => undefined);
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [s, trayOn]);

  if (!s) return null;
  const set = async (patch: Partial<MS>) => setS(await api.sysmon.setSettings(patch));
  const toggleMetric = (m: TrayMetric) => {
    const has = s.tray.metrics.includes(m);
    const next = has ? s.tray.metrics.filter((x) => x !== m) : [...s.tray.metrics, m];
    if (!next.length) return toast('Keep at least one reading');
    void set({ tray: { ...s.tray, metrics: next } });
  };

  return (
    <div className="card settings-section mon-settings">
      <Row title="Readings in the menu bar" desc="Live numbers and sparklines next to the clock (the tray on Windows and Linux); click one for details. Readings run only while they are shown.">
        <Toggle on={s.surfaces.tray && trayOn} onChange={(v) => { if (v && !trayOn) void api.features.set('monitorTray', true); void set({ surfaces: { ...s.surfaces, tray: v } }); }} />
      </Row>
      {s.surfaces.tray && trayOn ? (
        <>
          <Row title="Show" desc="Pick the readings; they appear in this order.">
            <div className="mon-chips">{TRAY_METRICS.map((m) => <button key={m.id} className={`mon-chip${s.tray.metrics.includes(m.id) ? ' on' : ''}`} onClick={() => toggleMetric(m.id)}>{m.label}</button>)}</div>
          </Row>
          <Row title="Layout" desc="One item per reading, or all of them together in one.">
            <Seg value={s.tray.layout} options={[['combined', 'All in one'], ['separate', 'One each']]} onChange={(v) => void set({ tray: { ...s.tray, layout: v } })} />
          </Row>
          <Row title="Style" desc="Windows and Linux draw the number into the icon; macOS shows text beside it.">
            <Seg value={s.tray.style} options={[['both', 'Number and graph'], ['text', 'Number'], ['graph', 'Graph']]} onChange={(v) => void set({ tray: { ...s.tray, style: v } })} />
          </Row>
          <Row title="Update every" desc="Slower costs less; readings slow down by themselves while you are away and stop while the screen is locked.">
            <Seg value={s.tray.intervalSec} options={[[1, '1 s'], [2, '2 s'], [5, '5 s'], [10, '10 s']]} onChange={(v) => void set({ tray: { ...s.tray, intervalSec: v } })} />
          </Row>
          <Row title="Red under strain" desc="Amber when busy, red when very busy, hot or low.">
            <Toggle on={s.tray.strainColor} onChange={(v) => void set({ tray: { ...s.tray, strainColor: v } })} />
          </Row>
          <Row title="Units" desc="Network in bytes or bits; memory used or free; temperature.">
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Seg value={s.tray.netUnit} options={[['bytes', 'MB/s'], ['bits', 'Mbit/s']]} onChange={(v) => void set({ tray: { ...s.tray, netUnit: v } })} />
              <Seg value={s.tray.memShows} options={[['used', 'Used'], ['free', 'Free']]} onChange={(v) => void set({ tray: { ...s.tray, memShows: v } })} />
              <Seg value={s.tray.tempUnit} options={[['c', '°C'], ['f', '°F']]} onChange={(v) => void set({ tray: { ...s.tray, tempUnit: v } })} />
            </div>
          </Row>
          {preview.length ? (
            <Row title="Preview" desc="What the menu bar shows right now.">
              <div className="mon-preview">{preview.map((p) => <span key={p.metric} className="row" style={{ gap: 4 }}><img src={p.image} alt="" />{p.title}</span>)}</div>
            </Row>
          ) : null}
        </>
      ) : null}
      <Row title="Alerts in the Island" desc="Apps that work hard for a long time show in the Island instead of a system notification.">
        <Toggle on={s.surfaces.island} onChange={(v) => void set({ surfaces: { ...s.surfaces, island: v } })} />
      </Row>
      <Row title="Never alert about" desc="Apps that are meant to work hard (a build server, a game).">
        <ListEditor items={s.quietApps} placeholder="App name" onChange={(quietApps) => void set({ quietApps })} />
      </Row>
      <Row title="Keep history for" desc="Hourly and daily points; minute and 5-minute detail is kept for 2 and 14 days. A year takes about 1 MB.">
        <Seg value={s.retentionDays} options={[[30, '30 days'], [90, '90 days'], [180, '6 months'], [365, '1 year']]} onChange={(v) => void set({ retentionDays: v })} />
      </Row>
      <Row title="Tool launcher shortcut" desc="Opens a search over every Keeper tool from any app.">
        <div className="row" style={{ gap: 8 }}>
          <Toggle on={s.surfaces.launcher && launcherOn} onChange={(v) => { if (v && !launcherOn) void api.features.set('toolLauncher', true); void set({ surfaces: { ...s.surfaces, launcher: v } }); }} />
          <input className="input mono" style={{ width: 210 }} value={s.launcherShortcut} onChange={(e) => setS({ ...s, launcherShortcut: e.target.value })} onBlur={() => void set({ launcherShortcut: s.launcherShortcut })} aria-label="Launcher shortcut" />
          <button className="btn sm" onClick={() => void api.sysmon.openLauncher()}>Try it</button>
        </div>
      </Row>
      <Row title="Tools open in their own window" desc="A small window with only that tool; off opens tools in the main window.">
        <Toggle on={s.toolWindows} onChange={(v) => void set({ toolWindows: v })} />
      </Row>
      <Row title="Results go to" desc={out ? `For example: ${out}` : 'A new folder next to the originals, never overwriting them.'}>
        <div className="col" style={{ gap: 6, alignItems: 'flex-end' }}>
          <Seg value={s.output.mode} options={[['beside', 'Next to the originals'], ['dated', 'Dated folder'], ['folder', 'One folder']]} onChange={(v) => void set({ output: { ...s.output, mode: v } })} />
          {s.output.mode !== 'beside' ? (
            <div className="row" style={{ gap: 6 }}>
              <span className="small muted ellipsis" style={{ maxWidth: 260 }}>{s.output.folder || (s.output.mode === 'dated' ? 'Downloads/Keeper' : 'Choose a folder')}</span>
              <button className="btn sm" onClick={async () => { const p = await api.settings.pickFolder(); if (p) void set({ output: { ...s.output, folder: p } }); }}>Choose…</button>
            </div>
          ) : null}
        </div>
      </Row>
      <Row title="AI agents may never stop programs in" desc="Even with your approval, agents cannot quit, pause or stop anything working in these folders.">
        <ListEditor items={s.protectedFolders} placeholder="" pickFolder onChange={(protectedFolders) => void set({ protectedFolders })} />
      </Row>
    </div>
  );
}
