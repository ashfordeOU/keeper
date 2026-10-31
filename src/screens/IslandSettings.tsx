// SPDX-License-Identifier: AGPL-3.0-or-later
// The Island: what it shows and how it behaves, plus keep-awake and presentation mode.

import { useEffect, useState, type ReactNode } from 'react';
import type { IslandSettings as IS, KeepAwakeOptions, KeepAwakeState, ScriptAction, UploadSettings } from '../../core/api';
import { describeTrigger, type AwakeTrigger, type TriggerKind } from '../../core/awake';
import { relativeTime } from '../../core/format';
import type { Place } from '../../core/weather';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageHead, Toggle } from '../components/ui';
import { useAsync, useStore } from '../state';
import { PlacementSettings } from '../island/PlacementSettings';
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
  const hasUpload = useAsync(() => api.settings.hasSecret('upload'), []);
  const [uploadKey, setUploadKey] = useState('');
  const [awakeNow, setAwakeNow] = useState<string[] | null>(null);

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
      <PlacementSettings isl={isl} set={set} />

      <h2 style={{ margin: '18px 0 8px' }}>What it shows</h2>
      <div className="card settings-section">
        <Row title="Clipboard history" desc="Keeps what you copy — text, links, code, colours, images and files — with the app it came from. Text that looks like a password is never saved."><Toggle on={isl.clipboard} onChange={(v) => set({ clipboard: v })} /></Row>
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

      <h2 style={{ margin: '18px 0 8px' }}>Clipboard</h2>
      <div className="card settings-section">
        <Row title="Clipboard picker" desc="Opens over any app: type to filter, Return pastes, 1–9 paste instantly."><kbd className="badge">{pretty(isl.pasteShortcut)}</kbd></Row>
        <Row title="Remember up to">
          <select className="input" value={isl.clipMax} onChange={(e) => set({ clipMax: Number(e.target.value) })}>{[50, 100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n} items</option>)}</select>
        </Row>
        <Row title="Forget after" desc="Pinned items and items in a list are always kept.">
          <select className="input" value={isl.clipRetentionDays} onChange={(e) => set({ clipRetentionDays: Number(e.target.value) })}>
            <option value={1}>1 day</option><option value={7}>1 week</option><option value={30}>1 month</option><option value={90}>3 months</option><option value={365}>1 year</option><option value={0}>Never</option>
          </select>
        </Row>
        <Row title="Never record copies from" desc="Comma-separated app names, e.g. password managers.">
          <input className="input" style={{ width: 300 }} defaultValue={isl.clipIgnoreApps.join(', ')} onBlur={(e) => set({ clipIgnoreApps: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
        </Row>
        <Row title="Show page titles for links" desc="Keeper visits a copied link once to read its title. Off keeps everything on this computer."><Toggle on={isl.clipFetchTitles} onChange={(v) => set({ clipFetchTitles: v })} /></Row>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>Shelves and sharing</h2>
      <div className="card settings-section">
        <Row title="Open the shelf" desc="From anywhere. Dragging a file onto the Island opens it too."><kbd className="badge">{pretty(isl.shelfShortcut)}</kbd></Row>
        <Row title="Share links" desc="Upload shelf files to your own storage and copy a link. Nothing goes through a Keeper server.">
          <div className="seg">{(['none', 'webdav', 's3'] as const).map((k) => <button key={k} className={isl.upload.kind === k ? 'on' : ''} onClick={() => set({ upload: { ...isl.upload, kind: k } })}>{k === 'none' ? 'Off' : k === 'webdav' ? 'WebDAV' : 'S3-compatible'}</button>)}</div>
        </Row>
        {isl.upload.kind !== 'none' ? <UploadFields u={isl.upload} onChange={(u) => set({ upload: u })} /> : null}
        {isl.upload.kind !== 'none' ? (
          <Row title={isl.upload.kind === 's3' ? 'Secret access key' : 'Password'} desc={hasUpload.data ? 'Saved, encrypted by your system keychain.' : 'Kept in your system keychain.'}>
            <input className="input" type="password" placeholder={hasUpload.data ? '••••••••' : 'Paste here'} value={uploadKey} onChange={(e) => setUploadKey(e.target.value)} />
            <button className="btn" disabled={!uploadKey} onClick={async () => { await api.settings.setSecret('upload', uploadKey); setUploadKey(''); hasUpload.reload(); toast('Saved'); }}>Save</button>
          </Row>
        ) : null}
        <ScriptActions list={isl.scriptActions} onChange={(l) => set({ scriptActions: l })} />
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

      <h2 style={{ margin: '18px 0 8px' }}>Keep awake automatically</h2>
      <div className="card settings-section">
        <Row title="Rules" desc={awakeNow === null ? 'Start keeping awake by itself when any of these is true, and stop when none is.' : awakeNow.length ? `Right now: ${awakeNow.join(' · ')}` : 'None of these is true right now.'}>
          <button className="btn sm" onClick={() => void api.island.awakeStatus().then((r) => setAwakeNow(r.active))}>Check now</button>
          <button className="btn sm" onClick={() => set({ awakeTriggers: [...isl.awakeTriggers, { id: `t${Date.now().toString(36)}`, kind: 'display', enabled: true }] })}><Icon name="plus" size={12} /> Add rule</button>
        </Row>
        {isl.awakeTriggers.map((t) => <TriggerRow key={t.id} t={t} onChange={(n) => set({ awakeTriggers: isl.awakeTriggers.map((x) => (x.id === t.id ? n : x)) })} onRemove={() => set({ awakeTriggers: isl.awakeTriggers.filter((x) => x.id !== t.id) })} />)}
        <Row title="Keep an external drive awake" desc={isl.driveKeepAwake ? `Touching a hidden file on ${isl.driveKeepAwake.path} every ${isl.driveKeepAwake.seconds} seconds so it does not spin down.` : 'Some drives fall asleep and pause your work while they spin up again.'}>
          {isl.driveKeepAwake ? <button className="btn sm" onClick={() => set({ driveKeepAwake: null })}>Stop</button> : <button className="btn sm" onClick={() => void api.settings.pickFolder().then((p) => p && set({ driveKeepAwake: { path: p, seconds: 60 } }))}>Choose drive…</button>}
        </Row>
        <Row title="Turn keep-awake on or off" desc="From anywhere."><kbd className="badge">{pretty(isl.awakeShortcut)}</kbd></Row>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>Notifications and visibility</h2>
      <div className="card settings-section">
        <Row title="Show other apps’ notifications" desc="Linux: notifications appear in the Island as well. Other systems do not let apps read notifications."><Toggle on={isl.notifyMirror} onChange={(v) => set({ notifyMirror: v })} /></Row>
        {isl.notifyMirror ? <Row title="Only from" desc="Comma-separated app names; empty means all."><input className="input" style={{ width: 280 }} defaultValue={isl.notifyApps.join(', ')} onBlur={(e) => set({ notifyApps: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Row> : null}
        <Row title="Hide while an app is full screen" desc="Videos, games and presentations get the whole screen."><Toggle on={isl.hideInFullscreen} onChange={(v) => set({ hideInFullscreen: v })} /></Row>
        <Row title="Hide or show the Island"><kbd className="badge">{pretty(isl.hideShortcut)}</kbd></Row>
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
        {(['captureShortcut', 'pasteShortcut', 'shelfShortcut', 'hideShortcut', 'awakeShortcut', 'dictationShortcut'] as const).map((k) => (
          <Row key={k} title={`Change: ${({ captureShortcut: 'copy text from screen', pasteShortcut: 'clipboard picker', shelfShortcut: 'open shelf', hideShortcut: 'hide Island', awakeShortcut: 'keep awake', dictationShortcut: 'dictation' })[k]}`} desc="Use names like CommandOrControl+Shift+V, Alt+Space or F9.">
            <input className="input" style={{ width: 230 }} defaultValue={isl[k]} onBlur={(e) => e.target.value.trim() !== isl[k] && set({ [k]: e.target.value.trim() } as Partial<IS>)} />
          </Row>
        ))}
      </div>
    </div>
  );
}

const TRIGGER_KINDS: { kind: TriggerKind; label: string; needs?: 'value' | 'threshold'; placeholder?: string }[] = [
  { kind: 'display', label: 'An external display is connected' },
  { kind: 'power', label: 'Plugged into power' },
  { kind: 'app', label: 'An app is running', needs: 'value', placeholder: 'App name, e.g. Zoom' },
  { kind: 'usb', label: 'A USB device is connected', needs: 'value', placeholder: 'Device name, e.g. Logitech' },
  { kind: 'wifi', label: 'On a Wi-Fi network', needs: 'value', placeholder: 'Network name' },
  { kind: 'vpn', label: 'A VPN is connected' },
  { kind: 'cpu', label: 'The processor is busy', needs: 'threshold' },
  { kind: 'drive', label: 'A drive is mounted', needs: 'value', placeholder: 'Drive name, e.g. Backup' },
];

function TriggerRow({ t, onChange, onRemove }: { t: AwakeTrigger; onChange: (t: AwakeTrigger) => void; onRemove: () => void }) {
  const meta = TRIGGER_KINDS.find((k) => k.kind === t.kind)!;
  return (
    <Row title={describeTrigger(t)} desc={t.allowDisplaySleep ? 'The screen may sleep; the computer stays on.' : 'Keeps the screen on too.'}>
      <Toggle on={t.enabled} onChange={(v) => onChange({ ...t, enabled: v })} />
      <select className="input" value={t.kind} onChange={(e) => onChange({ ...t, kind: e.target.value as TriggerKind })}>{TRIGGER_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select>
      {meta.needs === 'value' ? <input className="input" style={{ width: 160 }} placeholder={meta.placeholder} defaultValue={t.value ?? ''} onBlur={(e) => onChange({ ...t, value: e.target.value.trim() })} /> : null}
      {meta.needs === 'threshold' ? <select className="input" value={t.threshold ?? 50} onChange={(e) => onChange({ ...t, threshold: Number(e.target.value) })}>{[30, 50, 70, 90].map((n) => <option key={n} value={n}>Above {n}%</option>)}</select> : null}
      <button className="btn sm" title={t.allowDisplaySleep ? 'Keep the screen on' : 'Let the screen sleep'} onClick={() => onChange({ ...t, allowDisplaySleep: !t.allowDisplaySleep })}><Icon name={t.allowDisplaySleep ? 'moon' : 'sun'} size={12} /></button>
      <button className="btn sm icon" title="Remove" onClick={onRemove}><Icon name="close" size={12} /></button>
    </Row>
  );
}

function UploadFields({ u, onChange }: { u: UploadSettings; onChange: (u: UploadSettings) => void }) {
  const f = (k: keyof UploadSettings, title: string, desc?: string, placeholder?: string, width = 300) => (
    <Row title={title} desc={desc}>
      <input className="input" style={{ width }} placeholder={placeholder} defaultValue={String(u[k] ?? '')} onBlur={(e) => onChange({ ...u, [k]: k === 'expiresHours' ? Number(e.target.value) || 72 : e.target.value.trim() })} />
    </Row>
  );
  if (u.kind === 'webdav') {
    return (
      <>
        {f('url', 'Folder address', 'Where files are uploaded, e.g. your Nextcloud folder.', 'https://cloud.example.com/remote.php/dav/files/me/Shared')}
        {f('username', 'User name')}
        {f('prefix', 'Sub-folder', undefined, 'keeper', 160)}
        {f('publicUrl', 'Public link address (optional)', 'If uploads are published at another address, links start with this instead.', 'https://files.example.com/shared')}
      </>
    );
  }
  return (
    <>
      {f('url', 'Storage address', 'The service endpoint.', 'https://s3.eu-west-1.amazonaws.com')}
      {f('bucket', 'Bucket', undefined, 'my-shared-files', 220)}
      {f('region', 'Region', 'Use “auto” where the service does not have regions.', 'us-east-1', 160)}
      {f('accessKeyId', 'Access key ID', undefined, 'AKIA…', 240)}
      {f('prefix', 'Folder in the bucket', undefined, 'keeper', 160)}
      {f('expiresHours', 'Links work for (hours)', 'At most 168 hours (7 days).', '72', 90)}
    </>
  );
}

function ScriptActions({ list, onChange }: { list: ScriptAction[]; onChange: (l: ScriptAction[]) => void }) {
  const [name, setName] = useState('');
  const [cmd, setCmd] = useState('');
  return (
    <>
      <Row title="Shelf actions" desc={<>Your own commands, shown as buttons on the shelf. <code>{'{files}'}</code> becomes the shelf’s files, <code>{'{file}'}</code> the first one and <code>{'{dir}'}</code> its folder. Keeper asks before running.</>}>
        <input className="input" style={{ width: 120 }} placeholder="Button name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" style={{ width: 240 }} placeholder="e.g. open -a Preview {files}" value={cmd} onChange={(e) => setCmd(e.target.value)} />
        <button className="btn sm" disabled={!name.trim() || !cmd.trim()} onClick={() => { onChange([...list, { id: `a${Date.now().toString(36)}`, name: name.trim(), command: cmd.trim() }]); setName(''); setCmd(''); }}>Add</button>
      </Row>
      {list.map((a) => (
        <Row key={a.id} title={a.name} desc={<code>{a.command}</code>}>
          <button className="btn sm icon" title="Remove" onClick={() => onChange(list.filter((x) => x.id !== a.id))}><Icon name="close" size={12} /></button>
        </Row>
      ))}
    </>
  );
}
