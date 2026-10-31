// SPDX-License-Identifier: AGPL-3.0-or-later
// The Island window: a pill at the top of the screen that opens into a small
// panel with music, shelf, clipboard, agents, focus timer and calendar.

import { OwlMark, type OwlMood } from '../components/OwlMark';
import { resolveLanguage, translate } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IslandAlert, IslandState } from '../../core/api';
import { formatDuration } from '../../core/format';
import type { LyricLine } from '../../core/island';
import { describeCode } from '../../core/weather';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { CameraTab, ClipboardTab, ControlsTab, ShelfTab } from './IslandTabs';
import { Leading, LiveCard, PrivacyDots, Trailing, useActivities, useGestures, useLayout } from './Activities';
import { useStore } from '../state';
import '../styles/island.css';

type Tab = 'home' | 'shelf' | 'clipboard' | 'agents' | 'focus' | 'calendar' | 'controls' | 'camera';
type Mood = 'calm' | 'happy' | 'listening' | 'thinking' | 'needs' | 'done' | 'napping' | 'broken' | 'recording' | 'sleeping';

function lineAt(lines: LyricLine[], t: number): number {
  let ans = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].t <= t) ans = i; else break;
  return ans;
}

/** The little owl beside the pill: Keeper's own mark, with a face for every mood. */
function Buddy({ mood }: { mood: Mood }) {
  return <OwlMark className="buddy" size={22} mood={mood as OwlMood} />;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const timeOf = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function Island() {
  const { settings } = useStore();
  const isl = settings?.island;
  const tr = (key: string) => translate(resolveLanguage(settings?.language), key);
  const [state, setState] = useState<IslandState | null>(null);
  // compact: the pill; live: one activity's card; panel: everything (tabs)
  const [mode, setMode] = useState<'compact' | 'live' | 'panel'>('compact');
  const [liveId, setLiveId] = useState<string | null>(null);
  const expanded = mode === 'panel';
  const layout = useLayout();
  const [tab, setTab] = useState<Tab>('home');
  const [now, setNow] = useState(Date.now());
  const [alert, setAlert] = useState<IslandAlert | null>(null);
  const [listening, setListening] = useState<'off' | 'on' | 'working'>('off');
  const [level, setLevel] = useState<number[]>(Array(12).fill(2));
  const [custom, setCustom] = useState(15);
  const closeTimer = useRef<number | undefined>(undefined);
  const seenAlerts = useRef(new Set<string>());
  const rec = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);

  const load = useCallback(() => void api.island.state().then(setState), []);
  useEffect(() => {
    load();
    const off = api.on('island-changed', load);
    const t = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(load, 15_000);
    return () => { off(); clearInterval(t); clearInterval(poll); };
  }, [load]);

  // New download / screenshot alerts open a banner for a few seconds.
  useEffect(() => {
    const fresh = state?.alerts.find((a) => !seenAlerts.current.has(a.id));
    if (!fresh) return;
    seenAlerts.current.add(fresh.id);
    setAlert(fresh);
    api.island.setExpanded(true);
    const t = setTimeout(() => { setAlert(null); if (!expanded) api.island.setExpanded(false); void api.island.dismiss(fresh.id); }, 6000);
    return () => clearTimeout(t);
  }, [state?.alerts, expanded]);

  // Opening grows the window first and then the shape; closing shrinks the shape, then the window.
  const show = (m: 'live' | 'panel', id?: string) => {
    window.clearTimeout(closeTimer.current);
    api.island.setExpanded(true);
    if (id) setLiveId(id);
    setMode(m);
  };
  const collapse = (delay = 350) => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setMode('compact');
      closeTimer.current = window.setTimeout(() => { if (!alert) api.island.setExpanded(false); }, 420);
    }, delay);
  };

  // ---------------------------------------------------------------- dictation
  const stopRecording = useCallback(async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setListening('working');
    await new Promise<void>((res) => { r.mr.onstop = () => res(); r.mr.stop(); });
    cancelAnimationFrame(r.raf);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close();
    try {
      const blob = new Blob(r.chunks, { type: r.mr.mimeType });
      const text = await api.island.transcribe(await blob.arrayBuffer(), r.mr.mimeType);
      if (text.trim()) await api.island.typeText(text.trim());
    } catch (e) {
      setAlert({ id: `err-${Date.now()}`, kind: 'info', title: 'Dictation failed', detail: e instanceof Error ? e.message : String(e), at: Date.now() });
    } finally {
      setListening('off');
      api.island.setExpanded(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (rec.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.start(250);
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteFrequencyData(buf);
        setLevel(Array.from({ length: 12 }, (_, i) => 2 + (buf[i * 2] / 255) * 16));
        if (rec.current) rec.current.raf = requestAnimationFrame(tick);
      };
      rec.current = { mr, chunks, stream, ctx, raf: requestAnimationFrame(tick) };
      setListening('on');
      api.island.setExpanded(true);
    } catch {
      setListening('off');
    }
  }, []);

  useEffect(() => api.on('dictation', (s: 'start' | 'stop') => void (s === 'start' ? (rec.current ? stopRecording() : startRecording()) : stopRecording())), [startRecording, stopRecording]);

  // The shelf shortcut (and the tray) open a tab directly.
  useEffect(() => api.on('island-open', (t: string) => {
    setTab(t as Tab);
    show('panel');
  }), []);

  const [toast, setToast] = useState('');
  useEffect(() => {
    const on = (e: Event) => {
      setToast((e as CustomEvent<string>).detail);
      window.setTimeout(() => setToast(''), 3500);
    };
    window.addEventListener('island-toast', on);
    return () => window.removeEventListener('island-toast', on);
  }, []);

  const acts = useActivities(state, now, listening, isl?.activitiesOff ?? []);
  const gestures = useGestures({
    tap: () => (acts.pres.primary ? show('live', acts.pres.primary.id) : show('panel')),
    hold: () => (acts.pres.primary ? show('live', acts.pres.primary.id) : show('panel')),
    down: () => show('panel'),
    up: () => collapse(0),
  });

  // ---------------------------------------------------------------- sizes of each state
  const sc = layout?.scale ?? 1;
  const notch = layout?.anchor === 'notch';
  const side = layout?.edge === 'left' || layout?.edge === 'right';
  const notchH = notch ? layout!.pill.height : 0;
  const gap = notch ? layout!.gap : 0;
  const pillW = layout?.pill.width ?? Math.round(220 * sc);
  const pillH = notch ? notchH : layout?.pill.height ?? 34;
  // No room beside the notch (menus or icons reach it): a small tab hangs below the notch instead.
  const hang = notch ? layout!.hang ?? 0 : 0;
  const primary = acts.pres.primary;
  const secondary = acts.pres.secondary;
  const dotsOn = isl?.privacyDots !== false && (acts.dots.camera.length > 0 || acts.dots.mic.length > 0);
  // A Mac's notch with nothing going on: the Island is exactly the notch, invisible.
  const idleNotch = notch && !primary && !dotsOn;
  const compact = { w: idleNotch ? gap : pillW, h: idleNotch ? pillH : pillH + hang };
  const bubble = secondary && !idleNotch ? pillH : 0;
  const ears = notch ? 10 : 0;
  // The closed window is just big enough for the pill (kept centred) and its bubble.
  useEffect(() => {
    if (!layout) return;
    const w = side ? compact.w + (bubble ? bubble + 6 : 0) : compact.w + 2 * ((bubble ? bubble + 6 : 0) + ears);
    const h = side ? compact.h + (bubble ? bubble + 6 : 0) : compact.h;
    api.island.setSize?.(w, h);
  }, [layout, compact.w, compact.h, bubble, ears, side]);

  if (!state || isl?.enabled === false) return null;

  // ---------------------------------------------------------------- what the pill shows
  const waiting = state.agents.find((a) => a.state === 'waiting');
  const working = state.agents.find((a) => a.state === 'working');
  const stuck = state.agents.find((a) => a.state === 'stuck');
  const focusLeft = state.focus.mode === 'idle' ? 0 : state.focus.pausedLeft ?? Math.max(0, state.focus.endsAt - now);
  const nextEv = state.events.find((e) => !e.allDay && e.end > now);
  const soon = nextEv && nextEv.start - now < 15 * 60_000 ? nextEv : undefined;
  const np = state.nowPlaying;
  const hour = new Date(now).getHours();
  const night = hour >= 23 || hour < 6;
  const mood: Mood = listening !== 'off' ? 'listening' : state.recording ? 'recording' : stuck ? 'broken' : waiting ? 'needs' : alert ? 'happy' : working ? 'thinking' : state.agents.some((a) => a.state === 'done') ? 'done' : np?.playing || focusLeft ? 'calm' : night ? 'sleeping' : 'napping';

  let liveText: React.ReactNode = <span className="muted">{new Date(now).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>;
  if (listening === 'on') liveText = <span className="level">{level.map((h, i) => <i key={i} style={{ height: h }} />)} <span style={{ marginLeft: 6 }}>Listening…</span></span>;
  else if (listening === 'working') liveText = 'Writing it down…';
  else if (state.recording) liveText = <button className="rec-live" title="Stop recording" onClick={(e) => { e.stopPropagation(); void api.capture.stopRecording(); }}><span className="rec-dot" /> Recording · <b className="num">{mmss(now - state.recording.since)}</b> · Stop</button>;
  else if (waiting) liveText = <><b>{waiting.project}</b> needs you</>;
  else if (soon) liveText = <>{soon.title} · {soon.start > now ? `in ${Math.ceil((soon.start - now) / 60_000)} min` : 'now'}</>;
  else if (focusLeft) liveText = <>{state.focus.mode === 'break' ? 'Break' : 'Focus'} · <b className="num">{mmss(focusLeft)}</b></>;
  else if (np) liveText = <>{np.playing ? '♪' : '❚❚'} {np.title} — <span className="muted">{np.artist}</span></>;
  else if (working) liveText = <><b>{working.project}</b> is working</>;
  else if (state.keepAwake.on) liveText = <>☕ Staying awake</>;
  else if (state.weather && isl?.weather) liveText = <>{Math.round(state.weather.current.temp)}° {describeCode(state.weather.current.code).label}</>;

  const view: 'compact' | 'alert' | 'live' | 'panel' = mode === 'panel' ? 'panel' : alert && mode === 'compact' ? 'alert' : mode === 'live' ? 'live' : 'compact';
  const live = mode === 'live' ? acts.all.find((a) => a.id === liveId) ?? primary : undefined;
  if (view === 'live' && !live) {
    // The activity ended while its card was open.
    window.setTimeout(() => collapse(0), 0);
  }
  const box = {
    compact: compact,
    alert: { w: Math.round(420 * sc), h: notchH + Math.round(76 * sc) },
    live: { w: Math.max(Math.round(440 * sc), gap + 160), h: notchH + Math.round(150 * sc) },
    panel: { w: Math.round(640 * sc), h: notchH + Math.round(300 * sc) },
  }[view];
  const full = { w: Math.max(box.w, Math.round(640 * sc)), h: Math.max(box.h, notchH + Math.round(300 * sc)) };
  const floating = layout?.anchor === 'below-bar' || side;
  const r = view === 'compact' ? (floating ? box.h / 2 : Math.min(box.h / 2, 20 * sc)) : 26 * sc;
  const edge = layout?.edge ?? isl?.edge ?? 'top';
  const dx = (full.w - box.w) / 2;
  const dy = (full.h - box.h) / 2;
  // The black shape stays one element and is clipped to each state, so going from one to the next is one smooth morph.
  const clip = edge === 'left' ? `inset(${dy}px ${full.w - box.w}px ${dy}px 0px round 0 ${r}px ${r}px 0)`
    : edge === 'right' ? `inset(${dy}px 0px ${dy}px ${full.w - box.w}px round ${r}px 0 0 ${r}px)`
      : `inset(0px ${dx}px ${full.h - box.h}px ${dx}px round ${floating ? r : 0}px ${floating ? r : 0}px ${r}px ${r}px)`;
  const hover = isl?.hoverOpen !== false;
  const enter = () => {
    if (view === 'compact') {
      if (!hover) return;
      if (primary) show('live', primary.id);
      else show('panel');
    } else window.clearTimeout(closeTimer.current);
  };
  const cameraDot = isl?.cameraDot && layout?.cutout.kind === 'camera' && layout.anchor === 'edge';

  let content: React.ReactNode;
  if (view === 'alert' && alert) {
    content = (
      <div className="isl-alert">
        {isl?.buddy !== false ? <Buddy mood="happy" /> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          {alert.kind === 'notification' && alert.app ? <span className="muted small" style={{ display: 'block' }}>{alert.app}</span> : null}
          <b className="ellipsis" style={{ display: 'block' }}>{alert.title}</b>
          <span className="muted small ellipsis" style={{ display: 'block' }}>{alert.detail}</span>
        </div>
        {alert.path ? (
          <div className="btn-row">
            <button className="btn sm" onClick={() => void api.files.open(alert.path!)}>Open</button>
            <button className="btn sm" onClick={() => void api.files.reveal(alert.path!)}>Show</button>
            <button className="btn sm icon" title="Add to shelf" onClick={() => void api.island.addToShelf([alert.path!])}><Icon name="plus" size={12} /></button>
          </div>
        ) : null}
      </div>
    );
  } else if (view === 'live' && live) {
    content = <LiveCard a={live} state={state} now={now} unlocked={acts.unlocked} onMore={() => show('panel')} reload={load} />;
  } else if (view === 'compact') {
    const a = primary;
    const trailing = a ? (a.kind === 'dictation' && listening === 'on' ? <span className="level">{level.map((h, i) => <i key={i} style={{ height: h }} />)}</span> : <Trailing a={a} />) : null;
    const more = acts.pres.more ? <span className="act-more">+{acts.pres.more}</span> : null;
    if (notch && hang) {
      content = idleNotch ? <div className="cmp" /> : (
        <div className="cmp notch hang">
          <span className="hang-gap" style={{ height: notchH }} />
          <span className="hang-row" style={{ height: hang }}>
            {a ? <Leading a={a} /> : null}
            <span className="live">{a ? a.title : null}</span>
            {trailing}{more}{isl?.privacyDots !== false ? <PrivacyDots dots={acts.dots} /> : null}
          </span>
        </div>
      );
    } else if (notch) {
      content = idleNotch ? <div className="cmp" /> : (
        <div className="cmp notch">
          <span className="wing l">{a ? <Leading a={a} /> : null}</span>
          <span className="cut" style={{ width: gap }} />
          <span className="wing r">{trailing}{more}{isl?.privacyDots !== false ? <PrivacyDots dots={acts.dots} /> : null}</span>
        </div>
      );
    } else {
      content = (
        <div className="cmp">
          {a ? <Leading a={a} /> : isl?.buddy !== false ? <Buddy mood={mood} /> : null}
          <span className="live">{a ? a.title : liveText}</span>
          {cameraDot && !a ? <i className="cam-dot" aria-hidden /> : null}
          {trailing}
          {more}
          {isl?.privacyDots !== false ? <PrivacyDots dots={acts.dots} /> : null}
          {!a && state.battery && state.battery.percent < 20 && !state.battery.charging ? <span style={{ color: '#f87171' }}>{Math.round(state.battery.percent)}%</span> : null}
        </div>
      );
    }
  }

  // ---------------------------------------------------------------- expanded panel
  const tabs: { id: Tab; icon: string; label: string; badge?: number }[] = [
    { id: 'home', icon: 'home', label: tr('island.home') },
    { id: 'shelf', icon: 'archive', label: tr('island.shelf'), badge: state.shelf.length || undefined },
    ...(isl?.clipboard !== false ? [{ id: 'clipboard' as Tab, icon: 'clipboard', label: tr('island.clipboard') }] : []),
    ...(isl?.agents !== false ? [{ id: 'agents' as Tab, icon: 'terminal', label: tr('island.agents'), badge: state.agents.filter((a) => a.state === 'waiting').length || undefined }] : []),
    { id: 'focus', icon: 'timer', label: tr('island.focus') },
    { id: 'calendar', icon: 'calendar', label: tr('island.today') },
    { id: 'controls', icon: 'settings', label: 'Controls' },
    { id: 'camera', icon: 'camera', label: 'Mirror' },
  ];

  const lyricIdx = np && state.lyrics ? lineAt(state.lyrics, np.position) : -1;

  if (view === 'panel') content = (
      <div className="isl-panel" onDragOver={(e) => { e.preventDefault(); if (tab !== 'shelf') setTab('shelf'); }}>
        <div className="tabs">
          {isl?.buddy !== false ? <span style={{ marginRight: 6, display: 'grid', placeItems: 'center' }}><Buddy mood={mood} /></span> : null}
          {tabs.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={13} /> {t.label}{t.badge ? <span style={{ background: '#fbbf24', color: '#000', borderRadius: 8, padding: '0 5px', fontSize: 10 }}>{t.badge}</span> : null}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button title={state.keepAwake.on ? 'Stop keeping awake' : 'Keep awake'} className={state.keepAwake.on ? 'on' : ''} onClick={() => void api.island.keepAwake(!state.keepAwake.on).then(load)}><Icon name="coffee" size={13} /></button>
        </div>

        {toast ? <div className="isl-toast">{toast}</div> : null}
        <div className="body">
          {tab === 'home' ? (
            <div className="grid2">
              <div className="tile" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                {np ? (
                  <>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div className="art">{np.artwork ? <img src={np.artwork} alt="" /> : <Icon name="audio" size={22} />}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <b className="ellipsis" style={{ display: 'block' }}>{np.title}</b>
                        <span className="muted ellipsis" style={{ display: 'block' }}>{np.artist}{np.album ? ` · ${np.album}` : ''}</span>
                        <span className="muted small">{np.app}</span>
                      </div>
                    </div>
                    {isl?.lyrics !== false && state.lyrics?.length ? <div className="lyric">{lyricIdx >= 0 ? state.lyrics[lyricIdx].text : '♪'}</div> : null}
                    <div>
                      <div className="scrub" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); void api.island.media('seek', ((e.clientX - r.left) / r.width) * np.duration); }}>
                        <i style={{ width: `${(np.position / Math.max(1, np.duration)) * 100}%` }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                        <span className="muted small num">{formatDuration(np.position)}</span>
                        <div className="btn-row">
                          <button className="btn sm icon" onClick={() => void api.island.media('previous').then(load)}><Icon name="prev" size={12} /></button>
                          <button className="btn sm icon primary" onClick={() => void api.island.media('toggle').then(load)}><Icon name={np.playing ? 'pause' : 'play'} size={12} /></button>
                          <button className="btn sm icon" onClick={() => void api.island.media('next').then(load)}><Icon name="next" size={12} /></button>
                        </div>
                        <span className="muted small num">{formatDuration(np.duration)}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ margin: 'auto', textAlign: 'center' }} className="muted">
                    <div className="big-time" style={{ color: '#fff' }}>{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    {new Date(now).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {state.weather && isl?.weather !== false ? (
                  <div className="tile">
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span style={{ fontSize: 26, fontWeight: 800 }}>{Math.round(state.weather.current.temp)}°</span><span>{describeCode(state.weather.current.code).label}</span></div>
                    <div className="muted small">{state.weather.place.name} · H {Math.round(state.weather.daily[0]?.max ?? 0)}° L {Math.round(state.weather.daily[0]?.min ?? 0)}°{state.weather.current.aqi !== undefined ? ` · AQI ${Math.round(state.weather.current.aqi)}` : ''}</div>
                    {state.weather.nowcast ? <div className="small" style={{ color: '#93c5fd', marginTop: 4 }}>{state.weather.nowcast}</div> : null}
                  </div>
                ) : null}
                <div className="tile">
                  {nextEv ? <><span className="muted small">Next · {timeOf(nextEv.start)}</span><b className="ellipsis" style={{ display: 'block' }}>{nextEv.title}</b>{nextEv.location ? <span className="muted small">{nextEv.location}</span> : null}</> : <span className="muted">Nothing else today</span>}
                </div>
                <div className="tile" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {state.battery ? <span><Icon name={state.battery.charging ? 'bolt' : 'battery'} size={13} /> {Math.round(state.battery.percent)}%</span> : null}
                  {state.micInUse?.length ? <span style={{ color: '#fbbf24' }}><Icon name="mic" size={13} /> {state.micInUse[0]}</span> : null}
                  {state.recording ? <span style={{ color: '#ff453a' }}><span className="rec-dot" /> {mmss(now - state.recording.since)}</span> : null}
                  {state.keepAwake.on ? <span><Icon name="coffee" size={13} /> Awake</span> : null}
                  {focusLeft ? <span><Icon name="timer" size={13} /> {mmss(focusLeft)}</span> : null}
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'shelf' ? <ShelfTab state={state} settings={isl} reload={load} /> : null}

          {tab === 'clipboard' ? <ClipboardTab state={state} reload={load} /> : null}

          {tab === 'controls' ? <ControlsTab state={state} reload={load} /> : null}

          {tab === 'camera' ? <CameraTab /> : null}

          {tab === 'agents' ? (
            <div>
              {state.agents.length === 0 ? <div className="muted" style={{ textAlign: 'center', padding: 20 }}>No coding-agent sessions in the last few hours.</div> : null}
              {state.agents.map((a) => (
                <div key={a.id} className="agent" onClick={() => void api.island.openAgent(a.id)} title="Open its folder">
                  <span className={`state ${a.state}`} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{a.project}</b> <span className="muted small">{a.tool === 'claude-code' ? 'Claude Code' : 'Codex'} · {a.state === 'waiting' ? 'waiting for you' : a.state}</span>
                    <div className="muted small ellipsis">{a.summary}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {tab === 'focus' ? (
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', height: '100%' }}>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div className="big-time">{focusLeft ? mmss(focusLeft) : `${state.focus.focusMin}:00`}</div>
                <div className="muted">{state.focus.mode === 'idle' ? `${state.focus.rounds} round${state.focus.rounds === 1 ? '' : 's'} today` : state.focus.mode === 'break' ? 'Break — stretch and look away' : state.focus.pausedLeft !== undefined ? 'Paused' : 'Focusing'}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {state.focus.mode === 'idle' ? (
                  <>
                    <div className="btn-row">
                      <button className="btn primary" onClick={() => void api.island.focus('start', 25).then(load)}>25 min</button>
                      <button className="btn" onClick={() => void api.island.focus('start', 50).then(load)}>50 min</button>
                    </div>
                    <div className="btn-row">
                      <input type="range" min={5} max={120} step={5} value={custom} onChange={(e) => setCustom(Number(e.target.value))} />
                      <button className="btn sm" onClick={() => void api.island.focus('start', custom).then(load)}>{custom} min</button>
                    </div>
                  </>
                ) : (
                  <div className="btn-row">
                    {state.focus.pausedLeft !== undefined
                      ? <button className="btn primary" onClick={() => void api.island.focus('resume').then(load)}><Icon name="play" size={12} /> Resume</button>
                      : <button className="btn" onClick={() => void api.island.focus('pause').then(load)}><Icon name="pause" size={12} /> Pause</button>}
                    <button className="btn" onClick={() => void api.island.focus('stop').then(load)}>Stop</button>
                  </div>
                )}
                <button className="btn sm" onClick={() => void api.island.keepAwake(!state.keepAwake.on).then(load)}><Icon name="coffee" size={12} /> {state.keepAwake.on ? 'Stop keeping awake' : 'Keep awake'}</button>
              </div>
            </div>
          ) : null}

          {tab === 'calendar' ? (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{new Date(now).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div>
              {state.events.length === 0 ? <div className="muted">{isl?.calendarUrl ? 'Nothing coming up.' : 'Add a calendar link in Keeper › Island to see your day here.'}</div> : null}
              {state.events.slice(0, 12).map((e) => (
                <div key={e.uid} className="ev" style={{ opacity: e.end < now ? 0.45 : 1 }}>
                  <span className="time">{e.allDay ? 'All day' : timeOf(e.start)}</span>
                  <div style={{ minWidth: 0 }}>
                    <b className="ellipsis" style={{ display: 'block' }}>{e.title}</b>
                    <span className="muted small">{new Date(e.start).toDateString() !== new Date(now).toDateString() ? new Date(e.start).toLocaleDateString([], { weekday: 'short' }) + ' · ' : ''}{e.location ?? ''}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
  );

  const vars = {
    '--notch-h': `${notchH}px`, '--gap': `${gap}px`, '--box-w': `${box.w}px`, '--box-h': `${box.h}px`, '--full-w': `${full.w}px`, '--full-h': `${full.h}px`, '--bubble': `${bubble}px`,
  } as React.CSSProperties;
  return (
    <div className={`isl-root edge-${edge} anchor-${layout?.anchor ?? 'edge'} view-${view} ${floating ? 'floating' : ''}`} style={vars}>
      <div className="isl-shadow">
        <div className="isl-shape" style={{ clipPath: clip }} />
      </div>
      <div
        className={`isl isl-content view-${view}`}
        onMouseEnter={enter}
        onMouseLeave={() => (view === 'compact' ? undefined : collapse())}
        onClick={() => { if (view === 'compact') (primary ? show('live', primary.id) : show('panel')); }}
        onDragEnter={() => { show('panel'); setTab('shelf'); }}
        {...gestures}
      >
        {notch ? <><i className="ear l" /><i className="ear r" /></> : null}
        <div key={view} className="isl-in">{content}</div>
      </div>
      {bubble && view === 'compact' && secondary ? (
        <button className="isl-bubble" title={secondary.title} onClick={() => show('live', secondary.id)} onMouseEnter={() => hover && show('live', secondary.id)}>
          <Leading a={secondary} />
        </button>
      ) : null}
    </div>
  );
}
