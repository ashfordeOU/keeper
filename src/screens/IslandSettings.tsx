// SPDX-License-Identifier: AGPL-3.0-or-later
// The Island: what it shows and how it behaves, plus keep-awake and presentation mode.

import { useEffect, useState, type ReactNode } from 'react';
import type { IslandSettings as IS, KeepAwakeOptions, KeepAwakeState } from '../../core/api';
import { relativeTime } from '../../core/format';
import type { Place } from '../../core/weather';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageHead, Toggle } from '../components/ui';
import { useAsync, useStore } from '../state';
import '../styles/screens-b.css';

export function Row({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="txt"><div style={{ fontWeight: 550 }}>{title}</div>{desc ? <div className="d">{desc}</div> : null}</div>
      <div className="ctl">{children}</div>
    </div>
  );
}

const pretty = (s: string) => s.replace('CommandOrControl', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl').replace(/\+/g, ' ');

export function IslandSettings() {
  const { settings, updateSettings, toast } = useStore();
  const isl = settings?.island;
  const state = useAsync(() => api.island.state(), []);
  const hasKey = useAsync(() => api.settings.hasSecret('dictation'), []);
  const [placeQ, setPlaceQ] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [key, setKey] = useState('');
  const [awake, setAwake] = useState<KeepAwakeState | null>(null);
  const [opts, setOpts] = useState<KeepAwakeOptions & { mode: 'forever' | 'minutes' | 'until' | 'app' | 'file' }>({ mode: 'forever', minutes: 60 });
  const [untilTime, setUntilTime] = useState('18:00');
  const [presenting, setPresenting] = useState(false);

  useEffect(() => { if (state.data) setAwake(state.data.keepAwake); }, [state.data]);
  useEffect(() => {
    if (placeQ.trim().length < 2) { setPlaces([]); return; }
    const t = setTimeout(() => void api.weather.search(placeQ).then(setPlaces).catch(() => setPlaces([])), 300);
    return () => clearTimeout(t);
  }, [placeQ]);

  if (!isl) return null;
  const set = (patch: Partial<IS>) => void updateSettings({ island: { ...isl, ...patch } });

  const startAwake = async () => {
    const o: KeepAwakeOptions = { onlyOnPower: opts.onlyOnPower, allowDisplaySleep: opts.allowDisplaySleep, stopBelowBattery: opts.stopBelowBattery };
    if (opts.mode === 'minutes') o.minutes = opts.minutes;
    if (opts.mode === 'until') {
      const [h, m] = untilTime.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
      o.until = d.getTime();
    }
    if (opts.mode === 'app') o.whileApp = opts.whileApp;
    if (opts.mode === 'file') o.whileFile = opts.whileFile;
    setAwake(await api.island.keepAwake(true, o));
    toast('Keeping your computer awake');
  };

  return (
    <div style={{ maxWidth: 820 }}>
      <PageHead title="Island" sub="A small live panel at the top of your screen: shelf, clipboard, music, focus timer, calendar, weather and your coding agents. It stays out of the way until something happens.">
        <Toggle on={isl.enabled} onChange={(v) => set({ enabled: v })} label="Show the Island" />
      </PageHead>

      <div className="island-preview" style={{ marginBottom: 20 }}>
        <span style={{ fontSize: 18 }}>{isl.buddy ? '◕‿◕' : '●'}</span>
        <span className="grow small" style={{ opacity: 0.85 }}>{state.data?.nowPlaying ? `${state.data.nowPlaying.title} — ${state.data.nowPlaying.artist}` : state.data?.events[0] ? `Next: ${state.data.events[0].title}` : 'All quiet'}</span>
        {state.data?.weather ? <span className="small">{Math.round(state.data.weather.current.temp)}°</span> : null}
      </div>

      <h2 style={{ margin: '8px 0' }}>Placement</h2>
      <div className="card settings-section">
        <Row title="Position" desc="Screens with a camera notch use the notch; others get a slim island.">
          <div className="seg">{(['top', 'left', 'right'] as const).map((e) => <button key={e} className={isl.edge === e ? 'on' : ''} onClick={() => set({ edge: e })}>{e === 'top' ? 'Top' : e === 'left' ? 'Left edge' : 'Right edge'}</button>)}</div>
        </Row>
        <Row title="Displays">
          <div className="seg"><button className={isl.displays === 'primary' ? 'on' : ''} onClick={() => set({ displays: 'primary' })}>Main display</button><button className={isl.displays === 'all' ? 'on' : ''} onClick={() => set({ displays: 'all' })}>All displays</button></div>
        </Row>
        <Row title="Buddy" desc="A little face that reacts: naps when you are away, perks up when something needs you."><Toggle on={isl.buddy} onChange={(v) => set({ buddy: v })} /></Row>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>What it shows</h2>
      <div className="card settings-section">
        <Row title="Clipboard history" desc="Keeps the last 50 things you copied. Text that looks like a password is never saved."><Toggle on={isl.clipboard} onChange={(v) => set({ clipboard: v })} /></Row>
        <Row title="Clean links you copy" desc="Removes tracking bits like utm_ and fbclid from copied links."><Toggle on={isl.cleanLinks} onChange={(v) => set({ cleanLinks: v })} /></Row>
        <Row title="Download and screenshot alerts" desc="New downloads and screenshots appear for a moment and land on the shelf."><Toggle on={isl.downloadAlerts} onChange={(v) => set({ downloadAlerts: v })} /></Row>
        <Row title="Coding agents" desc="Shows whether your terminal coding agents are working, waiting for you or done. Read from files on this computer only."><Toggle on={isl.agents} onChange={(v) => set({ agents: v })} /></Row>
        <Row title="Sound when an agent needs you"><Toggle on={isl.soundOnAgent} onChange={(v) => set({ soundOnAgent: v })} /></Row>
        <Row title="Synced lyrics" desc="Looks up lyrics by song title and artist only."><Toggle on={isl.lyrics} onChange={(v) => set({ lyrics: v })} /></Row>
        <Row title="Break reminders" desc="A gentle nudge to look away and stretch.">
          <select className="input" value={isl.breakEvery} onChange={(e) => set({ breakEvery: Number(e.target.value) })}>
            <option value={0}>Off</option><option value={20}>Every 20 minutes</option><option value={30}>Every 30 minutes</option><option value={45}>Every 45 minutes</option><option value={60}>Every hour</option><option value={90}>Every 90 minutes</option>
          </select>
        </Row>
        <Row title="Calendar" desc="Paste a private calendar address (.ics) from your calendar app to see today and what is next.">
          <input className="input" style={{ width: 300 }} placeholder="https://…/calendar.ics" defaultValue={isl.calendarUrl} onBlur={(e) => e.target.value !== isl.calendarUrl && set({ calendarUrl: e.target.value.trim() })} />
        </Row>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>Weather</h2>
      <div className="card settings-section">
        <Row title="Show weather" desc="Forecasts come from a free public service; only the place you choose is sent."><Toggle on={isl.weather} onChange={(v) => set({ weather: v })} /></Row>
        <Row title="Place" desc={isl.place ? `${isl.place.name}${isl.place.country ? `, ${isl.place.country}` : ''}` : 'Not set'}>
          <div style={{ position: 'relative' }}>
            <input className="input" placeholder="Search a city" value={placeQ} onChange={(e) => setPlaceQ(e.target.value)} style={{ width: 220 }} />
            {places.length ? (
              <div className="menu" style={{ position: 'absolute', top: 36, right: 0, left: 'auto' }}>
                {places.map((p) => <button key={`${p.lat},${p.lon}`} onClick={() => { set({ place: p }); setPlaceQ(''); setPlaces([]); }}>{p.name}<span className="muted small">{p.country}</span></button>)}
              </div>
            ) : null}
          </div>
        </Row>
        <Row title="Units">
          <div className="seg"><button className={isl.units === 'metric' ? 'on' : ''} onClick={() => set({ units: 'metric' })}>°C, km/h</button><button className={isl.units === 'imperial' ? 'on' : ''} onClick={() => set({ units: 'imperial' })}>°F, mph</button></div>
        </Row>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>Keep awake</h2>
      <div className="card settings-section">
        <Row title={awake?.on ? 'Keeping your computer awake' : 'Stay awake'} desc={awake?.on ? `Since ${relativeTime(awake.since ?? Date.now())}${awake.until ? ` · until ${new Date(awake.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}${awake.reason ? ` · ${awake.reason}` : ''}` : 'Stops the screen or computer from sleeping during a download, a talk or a long build.'}>
          {awake?.on ? <button className="btn" onClick={async () => setAwake(await api.island.keepAwake(false))}>Stop</button> : <button className="btn primary" onClick={() => void startAwake()}><Icon name="coffee" size={14} /> Start</button>}
        </Row>
        <Row title="For how long">
          <select className="input" value={opts.mode} onChange={(e) => setOpts({ ...opts, mode: e.target.value as typeof opts.mode })}>
            <option value="forever">Until I stop it</option><option value="minutes">For a while</option><option value="until">Until a time</option><option value="app">While an app is running</option><option value="file">While a download finishes</option>
          </select>
          {opts.mode === 'minutes' ? (
            <select className="input" value={opts.minutes} onChange={(e) => setOpts({ ...opts, minutes: Number(e.target.value) })}>
              {[15, 30, 60, 120, 180, 300, 480].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}</option>)}
            </select>
          ) : null}
          {opts.mode === 'until' ? <input className="input" type="time" value={untilTime} onChange={(e) => setUntilTime(e.target.value)} /> : null}
          {opts.mode === 'app' ? <input className="input" placeholder="App name, e.g. Zoom" value={opts.whileApp ?? ''} onChange={(e) => setOpts({ ...opts, whileApp: e.target.value })} /> : null}
          {opts.mode === 'file' ? <input className="input" placeholder="File that is downloading" value={opts.whileFile ?? ''} onChange={(e) => setOpts({ ...opts, whileFile: e.target.value })} style={{ width: 240 }} /> : null}
        </Row>
        <Row title="Let the screen turn off" desc="The computer keeps running (downloads, builds) but the display can sleep."><Toggle on={!!opts.allowDisplaySleep} onChange={(v) => setOpts({ ...opts, allowDisplaySleep: v })} /></Row>
        <Row title="Only when plugged in"><Toggle on={!!opts.onlyOnPower} onChange={(v) => setOpts({ ...opts, onlyOnPower: v })} /></Row>
        <Row title="Stop when battery is low">
          <select className="input" value={opts.stopBelowBattery ?? 0} onChange={(e) => setOpts({ ...opts, stopBelowBattery: Number(e.target.value) || undefined })}>
            <option value={0}>Never</option><option value={10}>Below 10%</option><option value={20}>Below 20%</option><option value={30}>Below 30%</option>
          </select>
        </Row>
        <Row title="Presentation mode" desc="Keeps the screen on and hides desktop clutter while you present or share your screen.">
          <Toggle on={presenting} onChange={async (v) => setPresenting(await api.island.presentation(v))} />
        </Row>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>Dictation</h2>
      <div className="card settings-section">
        <Row title="Shortcut" desc="Press once to start talking, again to stop. The words are typed where your cursor is."><kbd className="badge">{pretty(isl.dictationShortcut)}</kbd></Row>
        <Row title="Speech-to-text service" desc="Any service that understands the common transcription format — a hosted one with your own key, or one running on this computer.">
          <input className="input" style={{ width: 320 }} defaultValue={isl.dictationUrl} onBlur={(e) => e.target.value !== isl.dictationUrl && set({ dictationUrl: e.target.value.trim() })} />
        </Row>
        <Row title="Model"><input className="input" defaultValue={isl.dictationModel} onBlur={(e) => e.target.value !== isl.dictationModel && set({ dictationModel: e.target.value.trim() })} /></Row>
        <Row title="API key" desc={hasKey.data ? 'Saved, encrypted by your system keychain.' : 'Not needed for a service on this computer.'}>
          <input className="input" type="password" placeholder={hasKey.data ? '••••••••' : 'Paste key'} value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn" disabled={!key} onClick={async () => { await api.settings.setSecret('dictation', key); setKey(''); hasKey.reload(); toast('Key saved'); }}>Save</button>
        </Row>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>Shortcuts</h2>
      <div className="card settings-section">
        <Row title="Copy text from the screen" desc="Drag over any area to copy the text in it — QR codes too."><kbd className="badge">{pretty(isl.captureShortcut)}</kbd></Row>
        <Row title="Quick Search"><kbd className="badge">{pretty(settings?.quickSearchShortcut ?? '')}</kbd></Row>
        <Row title="Dictation"><kbd className="badge">{pretty(isl.dictationShortcut)}</kbd></Row>
      </div>
    </div>
  );
}
