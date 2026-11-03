// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stage mode's home: start a preset, see what changed, edit presets (every
// switch is its own toggle, with how it works on this system), choose where
// Stage shows up (Island, tray, shortcut), starting by itself when the screen
// is captured, and external monitors (input source, display keys). Stage
// itself is started from the Island, the tray and the shortcut; this page is
// for presets and settings.

import { useEffect, useMemo, useState } from 'react';
import { copyPreset, countOn } from '../../core/stage/presets';
import { RECORDING_SIZES } from '../../core/stage/display';
import type { DrawSettings } from '../../core/stage/draw';
import type { StageCapture, StageDisplayMode, StagePreset, StageSettings, StageStatus, StageSwitches, SwitchInfo, StageOs } from '../../core/stage/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageHead, Toggle } from '../components/ui';
import { useFeature } from '../features';
import { useStore } from '../state';
import { Row } from './IslandSettings';
import { DisplayExtras } from '../stage/DisplayExtras';
import '../styles/stage.css';

const GROUPS: SwitchInfo['group'][] = ['Desktop and apps', 'Notifications and sound', 'Look', 'Behaviour'];
const pretty = (s: string) => s.replace('CommandOrControl', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl').replace(/\+/g, ' ');
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };

export function Stage() {
  const { toast, info } = useStore();
  const [st, setSt] = useState<StageStatus | null>(null);
  const [cfg, setCfg] = useState<StageSettings | null>(null);
  const [support, setSupport] = useState<SwitchInfo[]>([]);
  const [sel, setSel] = useState<string>('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    void api.stage.status().then(setSt);
    void api.stage.settings().then((c) => { setCfg(c); setSel((x) => x || c.preset); });
    void api.stage.support().then(setSupport);
    return api.on('stage-changed', (s) => setSt(s));
  }, []);
  useEffect(() => {
    if (!st?.on && !st?.countdownEndsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [st?.on, st?.countdownEndsAt]);
  if (!st || !cfg) return <div className="page"><PageHead title="Stage" /></div>;
  const os = (info?.platform ?? st.platform) as StageOs;
  const save = async (patch: Partial<StageSettings>) => setCfg(await api.stage.setSettings(patch));
  const start = async (id: string) => {
    try { setSt(await api.stage.start(id)); } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };
  const preset = cfg.presets.find((p) => p.id === sel) ?? cfg.presets[0];
  return (
    <div className="page stage-page">
      <PageHead title="Stage" sub="A clean screen for recording, presenting and screenshots. Start it from the Island, the menu bar or a shortcut; everything is put back when it ends." />
      <Hero st={st} cfg={cfg} now={now} onStart={start} />
      <h2 className="stage-h">Presets</h2>
      <div className="stage-presets" role="tablist">
        {cfg.presets.map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === preset.id} className={`card stage-preset${p.id === preset.id ? ' sel' : ''}`} data-testid={`stage-preset-${p.id}`} onClick={() => setSel(p.id)}>
            <Icon name={p.id === 'recording' ? 'video' : p.id === 'presenting' ? 'eye' : p.id === 'screenshot' ? 'screenshot' : 'sparkle'} size={18} />
            <b>{p.name}</b>
            <span className="muted small">{countOn(p.switches)} switches{p.countdown ? ` · ${p.countdown}-second countdown` : ''}{p.limitMin ? ` · ends after ${p.limitMin} min` : ''}</span>
            {p.id === cfg.preset ? <span className="badge accent">Shortcut</span> : null}
          </button>
        ))}
        <button className="card stage-preset add" onClick={async () => { const n = copyPreset(preset, `${preset.name} (mine)`, cfg.presets); const c = await api.stage.savePreset(n); setCfg(c); setSel(n.id); }}>
          <Icon name="plus" size={18} /><b>New preset</b><span className="muted small">Starts as a copy of “{preset.name}”</span>
        </button>
      </div>
      <PresetEditor key={preset.id} preset={preset} cfg={cfg} os={os} support={support} setCfg={setCfg} onDelete={() => setSel(cfg.preset)} />
      <Starting cfg={cfg} save={save} st={st} />
      <DrawSection cfg={cfg} save={save} />
      <h2 className="stage-h">External monitors</h2>
      <DisplayExtras cfg={cfg} save={save} />
      <h2 className="stage-h">How each switch works here</h2>
      <SupportTable support={support} os={os} />
    </div>
  );
}

function Hero({ st, cfg, now, onStart }: { st: StageStatus; cfg: StageSettings; now: number; onStart: (id: string) => void }) {
  const counting = !!st.countdownEndsAt && !st.on;
  return (
    <div className={`card stage-hero${st.on ? ' on' : ''}`} data-testid="stage-hero">
      <button className={`stage-switch${st.on ? ' on' : ''}`} aria-pressed={st.on} data-testid="stage-toggle" aria-label={st.on ? 'Stop Stage' : 'Start Stage'}
        onClick={() => (st.on || counting ? void api.stage.stop() : onStart(cfg.preset))}>
        {counting ? <b className="num">{Math.max(1, Math.ceil((st.countdownEndsAt! - now) / 1000))}</b> : <Icon name={st.on ? 'eye' : 'eyeOff'} size={28} />}
      </button>
      <div className="stage-hero-txt">
        <div className="stage-state">{st.on ? <>On: {st.presetName}</> : counting ? <>Starting {st.presetName}…</> : 'Stage is off'}</div>
        {st.on ? (
          <div className="muted">
            <span className="stage-rec" /> <b data-testid="stage-elapsed" className="num">{mmss(now - (st.since ?? now))}</b>
            {st.endsAt ? <> · ends in <b className="num">{mmss(st.endsAt - now)}</b></> : null}
            {st.reason ? ` · ${st.reason}` : ''}{st.auto ? ' · started by itself' : ''}
          </div>
        ) : <div className="muted">Pick a preset, or press <kbd>{pretty(cfg.shortcut)}</kbd> anywhere.</div>}
        {st.recovered ? <div className="stage-notice"><Icon name="info" size={12} /> {st.recovered}</div> : null}
        {st.notices.map((n) => <div key={n} className="stage-notice"><Icon name="info" size={12} /> {n}</div>)}
      </div>
      <div className="stage-hero-ctl">
        {st.on ? (
          <>
            <button className="btn sm" onClick={() => void api.stage.extend(15)}>+15 min</button>
            <button className="btn sm primary" data-testid="stage-stop" onClick={() => void api.stage.stop()}>Stop and put back</button>
          </>
        ) : cfg.presets.slice(0, 5).map((p) => <button key={p.id} className="btn sm" data-testid={`stage-start-${p.id}`} onClick={() => onStart(p.id)}>{p.name}</button>)}
      </div>
      {st.on && st.applied.length ? (
        <ul className="stage-changes" data-testid="stage-changes">
          {st.applied.map((a, i) => (
            <li key={i} className={a.ok ? 'ok' : 'no'}><Icon name={a.ok ? 'check' : 'minus'} size={12} /> {a.label}{a.note ? <span className="muted"> · {a.note}</span> : null}</li>
          ))}
        </ul>
      ) : null}
      {!st.on && st.lastRevert?.length ? (
        <details className="stage-last" data-testid="stage-last">
          <summary className="muted small">Last time: {st.lastRevert.filter((r) => r.outcome === 'restored').length} put back{st.lastRevert.some((r) => r.outcome === 'left') ? `, ${st.lastRevert.filter((r) => r.outcome === 'left').length} left as you set them` : ''}</summary>
          <ul className="stage-changes">{st.lastRevert.map((r, i) => <li key={i} className={r.outcome === 'failed' ? 'no' : 'ok'}>{r.label} <span className="muted">· {r.outcome === 'restored' ? 'put back' : r.outcome === 'left' ? 'left as you set it' : r.outcome === 'failed' ? 'could not be put back' : r.note ?? 'nothing to do'}</span></li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

function SupportBadge({ info, os }: { info?: SwitchInfo; os: StageOs }) {
  const s = info?.support[os];
  if (!s || s.how === 'built') return null;
  const label = s.how === 'partial' ? 'Limited here' : s.how === 'guide' ? 'Shows how' : 'Not possible here';
  return <span className={`badge ${s.how === 'none' ? 'off' : 'warn'}`} title={s.note}>{label}</span>;
}

function PresetEditor({ preset, cfg, os, support, setCfg, onDelete }: { preset: StagePreset; cfg: StageSettings; os: StageOs; support: SwitchInfo[]; setCfg: (c: StageSettings) => void; onDelete: () => void }) {
  const [p, setP] = useState(preset);
  const [modes, setModes] = useState<StageDisplayMode[]>([]);
  const [apps, setApps] = useState<string[]>([]);
  const [appName, setAppName] = useState('');
  useEffect(() => { void api.stage.modes().then(setModes).catch(() => undefined); void api.stage.apps().then(setApps).catch(() => undefined); }, []);
  const commit = async (next: StagePreset) => { setP(next); setCfg(await api.stage.savePreset(next)); };
  const sw = (patch: Partial<StageSwitches>) => void commit({ ...p, switches: { ...p.switches, ...patch } });
  const s = p.switches;
  const byId = useMemo(() => new Map(support.map((x) => [x.id, x])), [support]);
  const sizes = useMemo(() => {
    const list = RECORDING_SIZES.filter(([w, h]) => !modes.length || modes.some((m) => m.width === w && m.height === h));
    for (const m of modes) if (!list.some(([w, h]) => w === m.width && h === m.height) && list.length < 10) list.push([m.width, m.height]);
    return list;
  }, [modes]);
  const row = (id: SwitchInfo['id'], control: React.ReactNode) => {
    const info = byId.get(id);
    const sup = info?.support[os];
    return (
      <div className="setting" key={id} data-testid={`stage-sw-${id}`}>
        <div className="txt"><div style={{ fontWeight: 550 }}>{info?.label ?? id} <SupportBadge info={info} os={os} /></div><div className="d">{info?.desc}{sup?.note && sup.how !== 'built' ? <> <span className="stage-note">{sup.note}.</span></> : null}</div></div>
        <div className="ctl">{control}</div>
      </div>
    );
  };
  const tog = (id: keyof StageSwitches) => row(id as SwitchInfo['id'], <Toggle on={s[id] === true} onChange={(v) => sw({ [id]: v } as Partial<StageSwitches>)} />);
  const controls: Record<SwitchInfo['group'], React.ReactNode[]> = {
    'Desktop and apps': [
      tog('hideDesktopIcons'), tog('hideDock'), tog('hideOtherApps'), tog('hideMenuBar'),
      row('apps', (
        <div className="stage-apps">
          {s.apps.map((a, i) => (
            <span key={a.name} className="chip">{a.name}
              <select value={a.action} onChange={(e) => sw({ apps: s.apps.map((x, j) => (j === i ? { ...x, action: e.target.value as 'hide' | 'quit' } : x)) })}><option value="hide">hide</option><option value="quit">quit</option></select>
              {a.action === 'quit' ? <label className="small"><input type="checkbox" checked={!!a.reopen} onChange={(e) => sw({ apps: s.apps.map((x, j) => (j === i ? { ...x, reopen: e.target.checked } : x)) })} /> reopen</label> : null}
              <button aria-label={`Remove ${a.name}`} onClick={() => sw({ apps: s.apps.filter((_, j) => j !== i) })}><Icon name="close" size={10} /></button>
            </span>
          ))}
          <input list="stage-apps" placeholder="App name" value={appName} onChange={(e) => setAppName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && appName.trim()) { sw({ apps: [...s.apps, { name: appName.trim(), action: 'hide' }] }); setAppName(''); } }} />
          <datalist id="stage-apps">{apps.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
      )),
    ],
    'Notifications and sound': [tog('dnd'), tog('muteAlerts'), tog('pauseMusic')],
    Look: [
      row('backdrop', (
        <>
          <div className="seg">{(['off', 'solid', 'gradient', 'blur'] as const).map((k) => <button key={k} className={s.backdrop.kind === k ? 'on' : ''} onClick={() => sw({ backdrop: { ...s.backdrop, kind: k } })}>{k === 'off' ? 'Off' : k === 'solid' ? 'Colour' : k === 'gradient' ? 'Gradient' : 'Blurred wallpaper'}</button>)}</div>
          {s.backdrop.kind === 'solid' || s.backdrop.kind === 'gradient' ? <input type="color" aria-label="Colour" value={s.backdrop.color} onChange={(e) => sw({ backdrop: { ...s.backdrop, color: e.target.value } })} /> : null}
          {s.backdrop.kind === 'gradient' ? <input type="color" aria-label="Second colour" value={s.backdrop.color2} onChange={(e) => sw({ backdrop: { ...s.backdrop, color2: e.target.value } })} /> : null}
          <button className="btn sm ghost" onClick={() => void api.stage.preview('backdrop')}>Try it</button>
        </>
      )),
      tog('neutralCursor'),
      row('spotlight', (
        <>
          <div className="seg">{(['off', 'highlight', 'spotlight'] as const).map((k) => <button key={k} className={s.spotlight.mode === k ? 'on' : ''} onClick={() => sw({ spotlight: { ...s.spotlight, mode: k } })}>{k === 'off' ? 'Off' : k === 'highlight' ? 'Ring' : 'Spotlight'}</button>)}</div>
          {s.spotlight.mode !== 'off' ? <select aria-label="Size" value={s.spotlight.size} onChange={(e) => sw({ spotlight: { ...s.spotlight, size: e.target.value as 's' | 'm' | 'l' } })}><option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option></select> : null}
          {s.spotlight.mode === 'spotlight' ? <input type="range" min={10} max={90} aria-label="Dim" value={s.spotlight.dim} onChange={(e) => sw({ spotlight: { ...s.spotlight, dim: +e.target.value } })} /> : null}
          <button className="btn sm ghost" data-testid="stage-try-spotlight" onClick={() => void api.stage.preview('spotlight')}>Try it</button>
        </>
      )),
      row('clicks', <><Toggle on={s.clicks} onChange={(v) => sw({ clicks: v })} /><button className="btn sm ghost" data-testid="stage-try-clicks" onClick={() => void api.stage.preview('clicks')}>Try it</button></>),
      row('keystrokes', (
        <>
          <div className="seg">{(['off', 'shortcuts', 'all'] as const).map((k) => <button key={k} className={s.keystrokes === k ? 'on' : ''} onClick={() => sw({ keystrokes: k })}>{k === 'off' ? 'Off' : k === 'shortcuts' ? 'Shortcuts only' : 'Every key'}</button>)}</div>
          <button className="btn sm ghost" data-testid="stage-try-keys" onClick={() => void api.stage.preview('keys')}>Try it</button>
        </>
      )),
    ],
    Behaviour: [
      tog('keepAwake'),
      row('resolution', (
        <select aria-label="Screen size" data-testid="stage-resolution" value={s.resolution.mode === 'keep' ? 'keep' : `${s.resolution.width}x${s.resolution.height}`} onChange={(e) => {
          const v = e.target.value;
          if (v === 'keep') sw({ resolution: { ...s.resolution, mode: 'keep' } });
          else { const [w, h] = v.split('x').map(Number); sw({ resolution: { mode: 'set', width: w, height: h } }); }
        }}>
          <option value="keep">Leave as it is</option>
          {sizes.map(([w, h]) => <option key={`${w}x${h}`} value={`${w}x${h}`}>{w} × {h}</option>)}
        </select>
      )),
      tog('cleanClipboard'), tog('hidePrivate'), tog('keepKeeperOut'),
    ],
  };
  return (
    <div className="card settings-section stage-editor" data-testid="stage-editor">
      <div className="stage-editor-head">
        <input className="stage-name" aria-label="Preset name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} onBlur={() => void commit(p)} />
        <label className="small muted">Countdown <select value={p.countdown} onChange={(e) => void commit({ ...p, countdown: +e.target.value })}>{[0, 3, 5, 10].map((n) => <option key={n} value={n}>{n ? `${n} s` : 'None'}</option>)}</select></label>
        <label className="small muted">Ends after <select value={p.limitMin} onChange={(e) => void commit({ ...p, limitMin: +e.target.value })}>{[0, 5, 15, 30, 60, 120].map((n) => <option key={n} value={n}>{n ? `${n} min` : 'No limit'}</option>)}</select></label>
        <label className="small muted">Own shortcut <input className="stage-key" placeholder="None" value={p.shortcut} onChange={(e) => setP({ ...p, shortcut: e.target.value })} onBlur={() => void commit(p)} /></label>
        <span className="grow" />
        <button className="btn sm" data-testid="stage-try-countdown" onClick={() => void api.stage.preview('countdown')}>Try the countdown</button>
        {cfg.preset !== p.id ? <button className="btn sm" onClick={async () => setCfg(await api.stage.setSettings({ preset: p.id }))}>Use for the shortcut</button> : null}
        {!p.builtIn ? <button className="btn sm danger" onClick={async () => { setCfg(await api.stage.removePreset(p.id)); onDelete(); }}>Delete</button> : null}
      </div>
      {GROUPS.map((g) => (
        <div key={g} className="stage-group">
          <h3>{g}</h3>
          {controls[g]}
        </div>
      ))}
    </div>
  );
}

function Starting({ cfg, save, st }: { cfg: StageSettings; save: (p: Partial<StageSettings>) => void; st: StageStatus }) {
  const autoOn = useFeature('stageAuto');
  const [seen, setSeen] = useState<StageCapture | null>(null);
  const [keep, setKeep] = useState('');
  const [extra, setExtra] = useState('');
  const look = async () => setSeen(await api.stage.detect());
  return (
    <>
      <h2 className="stage-h">Starting Stage</h2>
      <div className="card settings-section" data-testid="stage-starting">
        <Row title="Shortcut" desc="Starts or stops the preset marked “Shortcut”, from any app.">
          <input className="stage-key" value={cfg.shortcut} onChange={(e) => save({ shortcut: e.target.value })} />
          <Toggle on={cfg.surfaces.shortcut} onChange={(v) => save({ surfaces: { ...cfg.surfaces, shortcut: v } })} />
        </Row>
        <Row title="In the Island" desc="A Stage switch in the Island’s Controls, and a red dot with the time while it is on."><Toggle on={cfg.surfaces.island} onChange={(v) => save({ surfaces: { ...cfg.surfaces, island: v } })} /></Row>
        <Row title="In the menu bar" desc="Each preset in Keeper’s menu-bar (tray) menu, and Stop while it is on."><Toggle on={cfg.surfaces.tray} onChange={(v) => save({ surfaces: { ...cfg.surfaces, tray: v } })} /></Row>
        <Row title="Start when the screen is captured" desc={<>Starts a preset when the screen is recorded or shared, and ends it afterwards. {st.platform === 'linux' ? 'Linux tells apps about screen casts (PipeWire), so this is reliable.' : 'This system has no public signal for it, so Keeper goes by known recorder apps (a best guess) and its own recorder.'}</>}>
          <select aria-label="Preset" value={cfg.auto.preset} onChange={(e) => save({ auto: { ...cfg.auto, preset: e.target.value } })}>{cfg.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <span data-testid="stage-auto-toggle"><Toggle on={autoOn} onChange={(v) => void api.features.set('stageAuto', v)} /></span>
        </Row>
        {autoOn ? (
          <div className="stage-sub">
            <label><input type="checkbox" checked={cfg.auto.streams} onChange={(e) => save({ auto: { ...cfg.auto, streams: e.target.checked } })} /> Screen-cast streams (Linux)</label>
            <label><input type="checkbox" checked={cfg.auto.keeperRecorder} onChange={(e) => save({ auto: { ...cfg.auto, keeperRecorder: e.target.checked } })} /> Keeper’s own recorder</label>
            <label><input type="checkbox" checked={cfg.auto.apps} onChange={(e) => save({ auto: { ...cfg.auto, apps: e.target.checked } })} /> Known recorder apps (a guess)</label>
            <label><input type="checkbox" checked={cfg.auto.stopWhenDone} onChange={(e) => save({ auto: { ...cfg.auto, stopWhenDone: e.target.checked } })} /> End when capture stops</label>
            <div className="chips">
              {cfg.auto.extraApps.map((a) => <span key={a} className="chip">{a}<button aria-label={`Remove ${a}`} onClick={() => save({ auto: { ...cfg.auto, extraApps: cfg.auto.extraApps.filter((x) => x !== a) } })}><Icon name="close" size={10} /></button></span>)}
              <input placeholder="Another recorder app" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && extra.trim()) { save({ auto: { ...cfg.auto, extraApps: [...cfg.auto.extraApps, extra.trim()] } }); setExtra(''); } }} />
            </div>
          </div>
        ) : null}
        <Row title="What does Keeper see now?" desc={seen ? seen.method : 'Checks once for anything capturing the screen.'}>
          <button className="btn sm" data-testid="stage-detect" onClick={() => void look()}>Look now</button>
        </Row>
        {seen ? (
          <ul className="stage-changes" data-testid="stage-detect-result">
            {seen.sources.length ? seen.sources.map((s) => <li key={s.label} className="ok">{s.label} <span className={`badge ${s.reliable ? 'ok' : 'warn'}`}>{s.reliable ? 'reliable' : 'a guess'}</span></li>) : <li className="muted">Nothing seems to be capturing the screen.</li>}
          </ul>
        ) : null}
        <Row title="Stays on screen" desc="Apps that “Hide other apps” leaves alone. Recorders, call apps and presentation apps stay without being listed.">
          <div className="chips">
            {cfg.keep.map((a) => <span key={a} className="chip">{a}<button aria-label={`Remove ${a}`} onClick={() => save({ keep: cfg.keep.filter((x) => x !== a) })}><Icon name="close" size={10} /></button></span>)}
            <input placeholder="App name" value={keep} onChange={(e) => setKeep(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && keep.trim()) { save({ keep: [...cfg.keep, keep.trim()] }); setKeep(''); } }} />
          </div>
        </Row>
      </div>
    </>
  );
}

function DrawSection({ cfg, save }: { cfg: StageSettings; save: (p: Partial<StageSettings>) => void }) {
  const on = useFeature('drawOnScreen');
  const { toast } = useStore();
  const d = cfg.draw;
  const set = (patch: Partial<DrawSettings>) => save({ draw: { ...d, ...patch } });
  return (
    <>
      <h2 className="stage-h">Draw on screen</h2>
      <div className="card settings-section" data-testid="stage-draw">
        <Row title="Draw on screen" desc="Press the shortcut to draw, highlight, add arrows and boxes or spotlight one spot, over any app. Esc or the shortcut again ends it and clears the ink.">
          <span data-testid="stage-draw-toggle"><Toggle on={on} onChange={(v) => void api.features.set('drawOnScreen', v)} /></span>
        </Row>
        {on ? (
          <>
            <Row title="Shortcut" desc="From any app. While drawing: P pen, H highlighter, A arrow, B box, S spotlight, 1–6 colours, F fade, W board, C clear.">
              <input className="stage-key" aria-label="Draw on screen shortcut" value={d.shortcut} onChange={(e) => set({ shortcut: e.target.value })} />
              <button className="btn sm" data-testid="stage-draw-try" onClick={() => void api.stage.draw(true).catch((e: unknown) => toast(e instanceof Error ? e.message : String(e)))}>Try it</button>
            </Row>
            <Row title="Pen colours" desc="Keys 1 to 6 while drawing.">
              <div className="stage-draw-colors">
                {d.colors.map((c, i) => (
                  <label key={i} className="stage-draw-swatch" style={{ background: c }}>
                    <span className="sr-only">Colour {i + 1}</span>
                    <input type="color" value={c} onChange={(e) => set({ colors: d.colors.map((x, j) => (j === i ? e.target.value : x)) })} />
                  </label>
                ))}
              </div>
            </Row>
            <Row title="Ink fades away" desc="Each line disappears by itself a moment after you draw it, so the screen stays clear while you talk.">
              <select aria-label="How long ink stays" value={d.fadeSeconds} disabled={!d.fade} onChange={(e) => set({ fadeSeconds: Number(e.target.value) })}>
                {[2, 3, 5, 10].map((n) => <option key={n} value={n}>After {n} seconds</option>)}
              </select>
              <Toggle on={d.fade} onChange={(v) => set({ fade: v })} />
            </Row>
          </>
        ) : null}
      </div>
    </>
  );
}

function SupportTable({ support, os }: { support: SwitchInfo[]; os: StageOs }) {
  const OSES: [StageOs, string][] = [['darwin', 'macOS'], ['win32', 'Windows'], ['linux', 'Linux']];
  const mark = { built: '✓', partial: '◐', guide: '→', none: '—' } as const;
  return (
    <details className="card stage-support">
      <summary>Every switch on macOS, Windows and Linux</summary>
      <table>
        <thead><tr><th>Switch</th>{OSES.map(([o, n]) => <th key={o} className={o === os ? 'here' : ''}>{n}</th>)}</tr></thead>
        <tbody>{support.map((s) => (
          <tr key={s.id}><td>{s.label}</td>{OSES.map(([o]) => <td key={o} className={`${s.support[o].how}${o === os ? ' here' : ''}`} title={s.support[o].note}>{mark[s.support[o].how]} {s.support[o].note ? <span className="muted small">{s.support[o].note}</span> : null}</td>)}</tr>
        ))}</tbody>
      </table>
      <p className="muted small">✓ works · ◐ works with limits · → Keeper shows you where to change it · — not possible. Night Shift and True Tone are not offered: apps can only switch them through private parts of macOS.</p>
    </details>
  );
}
