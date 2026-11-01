// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
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
import { openNative } from '../lib/native';
import { Icon } from '../components/Icon';
import { ClipboardTab, ControlsTab, ShelfTab } from './IslandTabs';
import { AskTool, CalendarTool, ConvertTool, EmojiTool, FocusExtras, MirrorTool, NotesTool, SalesTool, ShortcutsTool, StocksTool, SystemTool, UsageTool, WeatherTool, useFocusSound, useToolsStore } from './tools/IslandTools';
import { TeleprompterTool } from './tools/Teleprompter';
import { InsightsTool, TasksTool, WeekTool } from './tools/IslandPlanner';
import { CuesTool } from './tools/CuesTool';
import { FocusRuler, MediaModes, PlusAlertActions, UsagePin, useGlow } from './IslandPlus';
import { agentName } from '../../core/island-agents';
import { plusSetting } from '../../core/island-plus';
import { alertIcon, alertPresentation, mayExpand, shortTitle } from '../../core/island-expand';
import type { Activity } from '../../core/island-activities';
import { VibesTool } from '../wallpaper/IslandVibes';
import { ISLAND_TOOLS, moveTool, orderedTools, toggleTool, type IslandToolId } from '../../core/island-tools/tools';
import { chime, Leading, LiveCard, PrivacyDots, Trailing, useActivities, useGestures, useLayout } from './Activities';
import { useFeatureStates } from '../features';
import { useStore } from '../state';
import '../styles/island.css';

// Shown in the Island's own toast.
const islandSay = (msg: string) => window.dispatchEvent(new CustomEvent('island-toast', { detail: msg }));

type Tab = IslandToolId;
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
  const { settings, updateSettings } = useStore();
  const isl = settings?.island;
  const [tools, saveTools] = useToolsStore();
  const featureStates = useFeatureStates();
  const [tabMenu, setTabMenu] = useState<{ id: Tab; x: number } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
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
  // An alert shown inside the bar (the notch wings or the pill) that the person opened by hovering or clicking.
  const [alertOpen, setAlertOpen] = useState(false);
  const alertRules = useRef({ notch: false, alertStyle: 'notch' as 'notch' | 'banner', showInfo: false });
  const [listening, setListening] = useState<'off' | 'on' | 'working'>('off');
  const [level, setLevel] = useState<number[]>(Array(12).fill(2));
  const [custom, setCustom] = useState(15);
  const closeTimer = useRef<number | undefined>(undefined);
  const seenAlerts = useRef(new Set<string>());

  const load = useCallback(() => void api.island.state().then(setState), []);
  useEffect(() => {
    load();
    const off = api.on('island-changed', load);
    const poll = setInterval(load, 15_000);
    return () => { off(); clearInterval(poll); };
  }, [load]);

  // New alerts show for a few seconds. Time-sensitive ones only (core/island-expand.ts);
  // they stay inside the bar (notch wings or pill) unless the person chose banners or opens them.
  useEffect(() => {
    const fresh = state?.alerts.find((a) => !seenAlerts.current.has(a.id));
    if (!fresh) return;
    seenAlerts.current.add(fresh.id);
    const how = alertPresentation(fresh, alertRules.current);
    if (how === 'hidden') return;
    setAlert(fresh);
    setAlertOpen(false);
    if (how === 'banner') api.island.setExpanded(true);
    const t = setTimeout(() => {
      setAlert(null);
      setAlertOpen(false);
      if (!expanded && how === 'banner') api.island.setExpanded(false);
      void api.island.dismiss(fresh.id);
    }, how === 'banner' ? 6000 : 5000);
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
      setAlertOpen(false);
      closeTimer.current = window.setTimeout(() => { if (!alert || alertRules.current.alertStyle !== 'banner') api.island.setExpanded(false); }, 420);
    }, delay);
  };

  // ---------------------------------------------------------------- dictation
  // Voice (electron/services/voice) listens and types; the Island shows it while it happens.
  const [voiceText, setVoiceText] = useState('');
  useEffect(() => {
    const offs = [
      api.on('voice-state', (s) => {
        const show = s.island !== false;
        const next = !show || s.phase === 'idle' ? 'off' : s.phase === 'working' || s.phase === 'review' ? 'working' : 'on';
        setListening((prev) => {
          // Listening shows in the bar (wings or pill); it never drops down over windows by itself.
          if (prev === 'off' && next !== 'off' && mayExpand('voice', alertRules.current)) api.island.setExpanded(true);
          return next;
        });
        setVoiceText(show ? `${s.stable} ${s.pending}`.trim() : '');
      }),
      api.on('voice-level', (n) => setLevel(Array.from({ length: 12 }, (_, i) => 2 + Math.max(0, n - Math.abs(i - 5.5) * 0.05) * 16))),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  // The shelf shortcut (and the tray) open a tab directly; "reminders:new" (the New task shortcut) focuses the composer.
  const [composeKey, setComposeKey] = useState(0);
  useEffect(() => api.on('island-open', (t: string) => {
    const [id, then] = t.split(':');
    setTab((ISLAND_TOOLS.some((x) => x.id === id) ? id : 'home') as Tab);
    if (then === 'new') setComposeKey(Date.now());
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
  // A reminder coming due chimes once (it then waits in the Island until Done or Snooze).
  const rung = useRef(new Set<string>());
  useEffect(() => {
    const due = state?.dueReminders ?? [];
    const fresh = due.filter((r) => !rung.current.has(`${r.id}:${r.at}`));
    for (const r of due) rung.current.add(`${r.id}:${r.at}`);
    if (fresh.length && !(isl?.activitiesOff ?? []).includes('reminder')) chime();
  }, [state?.dueReminders, isl?.activitiesOff]);
  // The clock ticks once a second only while something on show counts seconds (an open card or
  // panel, an activity, a timer, a recording, Stage, keep-awake with an end); otherwise once a
  // minute, on the minute, which is all the date and "in 5 min" need. Saves redrawing every second.
  const everySecond = mode !== 'compact' || acts.all.length > 0 || !!state && (state.focus.mode !== 'idle' || !!state.recording || !!state.stage?.on || !!state.stage?.countdownEndsAt || (state.keepAwake.on && !!state.keepAwake.until));
  useEffect(() => {
    let t: number | undefined;
    const next = () => (everySecond ? 1000 - (Date.now() % 1000) : 60_000 - (Date.now() % 60_000)) + 20;
    const tick = () => { setNow(Date.now()); t = window.setTimeout(tick, next()); };
    setNow(Date.now());
    t = window.setTimeout(tick, next());
    return () => window.clearTimeout(t);
  }, [everySecond]);
  // A soft glow in the colour of the artwork while music plays (Settings → Island).
  const glow = useGlow(plusSetting(isl, 'glow') && state?.nowPlaying?.playing ? state.nowPlaying.artwork : undefined, !!(plusSetting(isl, 'glow') && state?.nowPlaying?.playing));
  // Focus sounds play only while a focus session is running (not during breaks or pauses).
  useFocusSound(isl?.focusSound, !!state && state.focus.mode === 'focus' && state.focus.pausedLeft === undefined, isl?.focusVolume ?? 0.4);
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
  alertRules.current = { notch, alertStyle: isl?.alertStyle ?? 'notch', showInfo: !!isl?.alertsInfo };
  const inlineAlert = alert && !alertOpen && alertPresentation(alert, alertRules.current) === 'inline' ? alert : null;
  // An inline alert takes the pill (or the notch's wings) for a moment: its icon and a short title.
  const alertAct: Activity | undefined = inlineAlert ? { id: `alert-${inlineAlert.id}`, kind: 'alert', priority: 999, icon: alertIcon(inlineAlert.kind), title: shortTitle(inlineAlert.app ? `${inlineAlert.app}: ${inlineAlert.title}` : inlineAlert.title), color: '#ffd60a' } : undefined;
  const primary = alertAct ?? acts.pres.primary;
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
  const openWeather = () => { const p = state.weather?.place; if (p) void openNative('weather', { lat: p.lat, lon: p.lon, label: p.name }, islandSay); };
  const np = state.nowPlaying;
  const hour = new Date(now).getHours();
  const night = hour >= 23 || hour < 6;
  const mood: Mood = listening !== 'off' ? 'listening' : state.recording ? 'recording' : stuck ? 'broken' : waiting ? 'needs' : alert ? 'happy' : working ? 'thinking' : state.agents.some((a) => a.state === 'done') ? 'done' : np?.playing || focusLeft ? 'calm' : night ? 'sleeping' : 'napping';

  let liveText: React.ReactNode = <span className="muted">{new Date(now).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>;
  if (listening === 'on') liveText = <span className="level">{level.map((h, i) => <i key={i} style={{ height: h }} />)} <span style={{ marginLeft: 6 }} className="ellipsis">{voiceText ? voiceText.slice(-60) : 'Listening…'}</span></span>;
  else if (listening === 'working') liveText = 'Writing it down…';
  else if (state.recording) liveText = <button className="rec-live" title="Stop recording" onClick={(e) => { e.stopPropagation(); void api.capture.stopRecording(); }}><span className="rec-dot" /> Recording · <b className="num">{mmss(now - state.recording.since)}</b> · Stop</button>;
  // Stage mode (core/stage): a countdown, then a red dot with the time and Stop.
  else if (state.stage?.countdownEndsAt && !state.stage.on) liveText = <span data-testid="island-stage-live">Stage in <b className="num">{Math.max(1, Math.ceil((state.stage.countdownEndsAt - now) / 1000))}</b>…</span>;
  else if (state.stage?.on) liveText = <button className="rec-live" data-testid="island-stage-live" title="Stop Stage and put everything back" onClick={(e) => { e.stopPropagation(); void api.stage.stop(); }}><span className="rec-dot" /> {state.stage.name} · <b className="num">{mmss(now - (state.stage.since ?? now))}</b> · Stop</button>;
  else if (waiting) liveText = <><b>{waiting.project}</b> needs you</>;
  else if (soon) liveText = <>{soon.title} · {soon.start > now ? `in ${Math.ceil((soon.start - now) / 60_000)} min` : 'now'}</>;
  else if (focusLeft) liveText = <>{state.focus.mode === 'break' ? 'Break' : 'Focus'} · <b className="num">{mmss(focusLeft)}</b></>;
  else if (np) liveText = <>{np.playing ? '♪' : '❚❚'} {np.title} — <span className="muted">{np.artist}</span></>;
  else if (working) liveText = <><b>{working.project}</b> is working</>;
  else if (state.keepAwake.on) liveText = <>☕ Staying awake{state.keepAwake.until ? <> · <b className="num">{mmss(state.keepAwake.until - now)}</b> left</> : null}</>;
  else if (state.weather && isl?.weather) liveText = <>{Math.round(state.weather.current.temp)}° {describeCode(state.weather.current.code).label}</>;

  const view: 'compact' | 'alert' | 'live' | 'panel' = mode === 'panel' ? 'panel' : alert && mode === 'compact' && (alertOpen || alertPresentation(alert, alertRules.current) === 'banner') ? 'alert' : mode === 'live' ? 'live' : 'compact';
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
  const r = view === 'compact' ? (floating ? box.h / 2 : Math.min(box.h / 2, 20 * sc)) : plusSetting(isl, 'cornerRadius') * sc;
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
      // Rests a moment before opening, so passing the pointer over the top of the screen does not open it.
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => {
        if (inlineAlert) openAlert();
        else if (primary) show('live', primary.id);
        else show('panel');
      }, Math.max(0, isl?.hoverDelayMs ?? 250));
    } else window.clearTimeout(closeTimer.current);
  };
  /** The person asked to see an inline alert in full: it drops down from the notch or pill now. */
  function openAlert() {
    window.clearTimeout(closeTimer.current);
    api.island.setExpanded(true);
    setAlertOpen(true);
  }
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
        <PlusAlertActions alert={alert} onDone={() => { setAlert(null); if (!expanded) api.island.setExpanded(false); }} />
        {alert.path ? (
          <div className="btn-row">
            <button className="btn sm" onClick={() => void api.files.open(alert.path!)}>Open</button>
            <button className="btn sm" onClick={() => void api.files.reveal(alert.path!)}>Show</button>
            <button className="btn sm icon" title="Add to shelf" aria-label="Add to shelf" onClick={() => void api.island.addToShelf([alert.path!])}><Icon name="plus" size={12} /></button>
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
          <span className="wing r">{a?.kind === 'alert' ? <span className="wing-title ellipsis" data-testid="island-wing-alert">{a.title}</span> : null}{trailing}{more}{isl?.privacyDots !== false ? <PrivacyDots dots={acts.dots} /> : null}</span>
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
  // The person's tools, in their order (Settings → Island → Tools, or right-click a tab).
  const toolIds = orderedTools(isl?.toolOrder, isl?.toolsOff, (id) => {
    if (id === 'clipboard') return isl?.clipboard !== false;
    if (id === 'agents') return isl?.agents !== false;
    const f = ISLAND_TOOLS.find((x) => x.id === id)?.feature;
    return !f || f === 'island' || featureStates?.get(f)?.on !== false;
  });
  const LABELS: Partial<Record<Tab, string>> = { home: tr('island.home'), shelf: tr('island.shelf'), clipboard: tr('island.clipboard'), agents: tr('island.agents'), focus: tr('island.focus') };
  const BADGES: Partial<Record<Tab, number | undefined>> = { shelf: state.shelf.length || undefined, agents: state.agents.filter((a) => a.state === 'waiting').length || undefined };
  const tabs: { id: Tab; icon: string; label: string; badge?: number }[] = toolIds.map((id) => {
    const t = ISLAND_TOOLS.find((x) => x.id === id)!;
    return { id, icon: t.icon, label: LABELS[id] ?? t.label, badge: BADGES[id] };
  });
  const setIsl = (p: Partial<NonNullable<typeof isl>>) => isl && void updateSettings({ island: { ...isl, ...p } });

  const lyricIdx = np && state.lyrics ? lineAt(state.lyrics, np.position) : -1;

  if (view === 'panel') content = (
      <div className="isl-panel" onDragOver={(e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); if (tab !== 'shelf') setTab('shelf'); }}>
        <div className="tabs">
          {isl?.buddy !== false ? <span style={{ marginRight: 6, display: 'grid', placeItems: 'center' }}><Buddy mood={mood} /></span> : null}
          {tabs.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} title={t.label} aria-label={t.badge ? `${t.label} (${t.badge})` : t.label} aria-pressed={tab === t.id} onClick={() => setTab(t.id)} onContextMenu={(e) => { e.preventDefault(); setTabMenu({ id: t.id, x: (e.currentTarget as HTMLElement).offsetLeft }); }}>
              <Icon name={t.icon} size={13} />{tabs.length <= 8 || tab === t.id ? <> {t.label}</> : null}{t.badge ? <span style={{ background: '#fbbf24', color: '#000', borderRadius: 8, padding: '0 5px', fontSize: 10 }}>{t.badge}</span> : null}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {featureStates?.get('toolLauncher')?.on === false ? null : <button title="Tool launcher" aria-label="Tool launcher" data-testid="island-launcher-btn" onClick={() => void api.islandx?.openLauncher()}><Icon name="grid" size={13} /></button>}
          {state.awakeAvailable === false ? null : <button title={state.keepAwake.on ? 'Stop keeping awake' : 'Keep awake'} aria-label={state.keepAwake.on ? 'Stop keeping awake' : 'Keep awake'} className={state.keepAwake.on ? 'on' : ''} onClick={() => void api.island.keepAwake(!state.keepAwake.on).then(load)}><Icon name="coffee" size={13} /></button>}
          {featureStates?.get('stage')?.on === false ? null : <button title={state.stage?.on ? 'Stop Stage' : 'Stage: a clean screen'} aria-label={state.stage?.on ? 'Stop Stage' : 'Stage: a clean screen'} data-testid="island-stage-btn" className={state.stage?.on ? 'on' : ''} onClick={() => void (state.stage?.on ? api.stage.stop() : api.stage.toggle()).then(load)}><Icon name="eye" size={13} /></button>}
        </div>

        {tabMenu ? (
          <div className="shelf-pop tab-menu" style={{ left: tabMenu.x + 8, top: 40 }} onMouseLeave={() => setTabMenu(null)}>
            <button onClick={() => { setIsl({ toolOrder: moveTool(isl?.toolOrder, tabMenu.id, Math.max(0, orderedTools(isl?.toolOrder, []).indexOf(tabMenu.id) - 1)) }); setTabMenu(null); }}><Icon name="chevronLeft" size={11} /> Move left</button>
            <button onClick={() => { setIsl({ toolOrder: moveTool(isl?.toolOrder, tabMenu.id, orderedTools(isl?.toolOrder, []).indexOf(tabMenu.id) + 1) }); setTabMenu(null); }}><Icon name="chevronRight" size={11} /> Move right</button>
            {tabMenu.id !== 'home' ? <button onClick={() => { setIsl({ toolsOff: toggleTool(isl?.toolsOff, tabMenu.id, false) }); if (tab === tabMenu.id) setTab('home'); setTabMenu(null); }}><Icon name="close" size={11} /> Hide this tool</button> : null}
            <div className="muted small" style={{ padding: '4px 8px' }}>Show</div>
            {ISLAND_TOOLS.filter((x) => !toolIds.includes(x.id)).map((x) => <button key={x.id} onClick={() => { setIsl({ toolsOff: toggleTool(isl?.toolsOff, x.id, true) }); setTab(x.id); setTabMenu(null); }}><Icon name={x.icon} size={11} /> {x.label}</button>)}
          </div>
        ) : null}
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
                          <button aria-label="Previous track" title="Previous track" className="btn sm icon" onClick={() => void api.island.media('previous').then(load)}><Icon name="prev" size={12} /></button>
                          <button aria-label="Play or pause" title="Play or pause" className="btn sm icon primary" onClick={() => void api.island.media('toggle').then(load)}><Icon name={np.playing ? 'pause' : 'play'} size={12} /></button>
                          <button aria-label="Next track" title="Next track" className="btn sm icon" onClick={() => void api.island.media('next').then(load)}><Icon name="next" size={12} /></button>
                          <MediaModes np={np} reload={load} />
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
                  <div className="tile" role="button" tabIndex={0} title="Open in Weather" style={{ cursor: 'pointer' }} onClick={openWeather} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openWeather(); }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span style={{ fontSize: 26, fontWeight: 800 }}>{Math.round(state.weather.current.temp)}°</span><span>{describeCode(state.weather.current.code).label}</span></div>
                    <div className="muted small">{state.weather.place.name} · H {Math.round(state.weather.daily[0]?.max ?? 0)}° L {Math.round(state.weather.daily[0]?.min ?? 0)}°{state.weather.current.aqi !== undefined ? ` · AQI ${Math.round(state.weather.current.aqi)}` : ''}</div>
                    {state.weather.nowcast ? <div className="small" style={{ color: '#93c5fd', marginTop: 4 }}>{state.weather.nowcast}</div> : null}
                  </div>
                ) : null}
                <div className="tile" role={nextEv ? 'button' : undefined} tabIndex={nextEv ? 0 : undefined} title={nextEv ? 'Open in Calendar' : undefined} style={nextEv ? { cursor: 'pointer' } : undefined} onClick={nextEv ? () => void openNative('calendar', { date: nextEv.start }, islandSay) : undefined}>
                  {nextEv ? <><span className="muted small">Next · {timeOf(nextEv.start)}</span><b className="ellipsis" style={{ display: 'block' }}>{nextEv.title}</b>{nextEv.location ? <span className="muted small">{nextEv.location}</span> : null}</> : <span className="muted">Nothing else today</span>}
                </div>
                <div className="tile" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {state.battery ? <span><Icon name={state.battery.charging ? 'bolt' : 'battery'} size={13} /> {Math.round(state.battery.percent)}%</span> : null}
                  {state.micInUse?.length ? <span style={{ color: '#fbbf24' }}><Icon name="mic" size={13} /> {state.micInUse[0]}</span> : null}
                  {state.recording ? <span style={{ color: '#ff453a' }}><span className="rec-dot" /> {mmss(now - state.recording.since)}</span> : null}
                  {state.keepAwake.on ? <span title={state.keepAwake.reason}><Icon name="coffee" size={13} /> Awake{state.keepAwake.until ? ` · ${mmss(state.keepAwake.until - now)}` : ''}</span> : null}
                  {focusLeft ? <span><Icon name="timer" size={13} /> {mmss(focusLeft)}</span> : null}
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'shelf' ? <ShelfTab state={state} settings={isl} reload={load} /> : null}

          {tab === 'clipboard' ? <ClipboardTab state={state} reload={load} /> : null}

          {tab === 'controls' ? <ControlsTab state={state} reload={load} /> : null}

          {tab === 'camera' ? <MirrorTool /> : null}
          {tab === 'vibes' ? <VibesTool /> : null}
          {tab === 'ask' ? <AskTool /> : null}
          {tab === 'usage' ? <UsageTool /> : null}
          {tab === 'sales' ? <SalesTool /> : null}
          {tab === 'system' ? <SystemTool /> : null}
          {tab === 'weather' ? <WeatherTool state={state} /> : null}
          {tab === 'convert' ? <ConvertTool /> : null}
          {tab === 'shortcuts' ? <ShortcutsTool /> : null}
          {tools && tab === 'stocks' ? <StocksTool store={tools} save={saveTools} /> : null}
          {tab === 'reminders' ? <TasksTool composeKey={composeKey} /> : null}
          {tab === 'week' ? <WeekTool /> : null}
          {tab === 'insights' ? <InsightsTool /> : null}
          {tools && tab === 'notes' ? <NotesTool store={tools} save={saveTools} /> : null}
          {tools && tab === 'emoji' ? <EmojiTool store={tools} save={saveTools} /> : null}
          {tools && tab === 'prompter' ? <TeleprompterTool store={tools} save={saveTools} /> : null}

          {tab === 'agents' ? (
            <div>
              {state.agents.length === 0 ? <div className="muted" style={{ textAlign: 'center', padding: 20 }}>No coding-agent sessions in the last few hours.</div> : null}
              {state.agents.map((a) => (
                <div key={a.id} className="agent" onClick={() => void api.island.openAgent(a.id)} title="Open its folder">
                  <span className={`state ${a.state}`} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{a.project}</b> <span className="muted small">{agentName(a.tool)} · {a.state === 'waiting' ? 'waiting for you' : a.state}</span>
                    <div className="muted small ellipsis">{a.summary}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {tab === 'focus' ? (
            <div className="focus-tab">
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', flex: 1 }}>
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
                    <FocusRuler value={custom} onChange={setCustom} onStart={(m) => void api.islandx.focusFor(m).then(load)} />
                    <div className="btn-row">
                      <button className="btn sm" onClick={() => void api.islandx.startBreak(false).then(load)}>Short break</button>
                      <button className="btn sm" onClick={() => void api.islandx.startBreak(true).then(load)}>Long break</button>
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
                {state.awakeAvailable === false ? null : <button className="btn sm" onClick={() => void api.island.keepAwake(!state.keepAwake.on).then(load)}><Icon name="coffee" size={12} /> {state.keepAwake.on ? 'Stop keeping awake' : 'Keep awake'}</button>}
              </div>
            </div>
            <FocusExtras />
            </div>
          ) : null}

          {tab === 'calendar' ? <CalendarTool state={state} now={now} /> : null}
          {tab === 'cues' ? <CuesTool state={state} now={now} /> : null}
        </div>
      </div>
  );

  const vars = {
    '--notch-h': `${notchH}px`, '--gap': `${gap}px`, '--box-w': `${box.w}px`, '--box-h': `${box.h}px`, '--full-w': `${full.w}px`, '--full-h': `${full.h}px`, '--bubble': `${bubble}px`, '--wing': `${layout?.wing || 120}px`,
  } as React.CSSProperties;
  return (
    <div className={`isl-root edge-${edge} anchor-${layout?.anchor ?? 'edge'} view-${view} ${floating ? 'floating' : ''}`} style={vars} role="region" aria-label="Island">
      {/* Alerts are read out by screen readers as they arrive, without taking focus. */}
      <div className="sr-only" role="status" aria-live="assertive" aria-atomic="true">{view === 'alert' && alert ? [alert.app, alert.title, alert.detail].filter(Boolean).join('. ') : ''}</div>
      <div aria-hidden className={`isl-shadow ${plusSetting(isl, 'shadow') ? '' : 'no-shadow'} ${glow ? 'glowing' : ''}`} style={glow ? ({ '--glow': glow } as React.CSSProperties) : undefined}>
        <div className="isl-shape" style={{ clipPath: clip }} />
      </div>
      <div
        className={`isl isl-content view-${view}`}
        // Compact, the Island is one button: Enter or Space opens it, Escape closes it.
        role={view === 'compact' ? 'button' : undefined}
        tabIndex={view === 'compact' ? 0 : undefined}
        aria-label={view === 'compact' ? (primary ? `${primary.title}: open` : 'Open the Island') : undefined}
        onKeyDown={(e) => {
          if (view === 'compact' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (primary) show('live', primary.id); else show('panel'); }
          else if (view !== 'compact' && e.key === 'Escape') collapse();
        }}
        onMouseEnter={() => { api.island.setInteractive?.(true); enter(); }}
        onMouseLeave={() => { if (view === 'compact') api.island.setInteractive?.(false); else if (view === 'alert' && alertOpen) { setAlertOpen(false); api.island.setExpanded(false); } else collapse(); }}
        onClick={(e) => {
          if (view !== 'compact') return;
          // Alt/Option-click hides the Island for a minute (alerts still come back after).
          if (e.altKey) { void api.islandx?.hideFor(plusSetting(isl, 'altHideMinutes')); return; }
          if (inlineAlert) openAlert();
          else if (primary) show('live', primary.id); else show('panel');
        }}
        onDragEnter={(e) => { if (!e.dataTransfer.types.includes('Files')) return; show('panel'); setTab('shelf'); }}
        {...gestures}
      >
        {notch ? <><i className="ear l" aria-hidden /><i className="ear r" aria-hidden /></> : null}
        <div key={view} className="isl-in">{content}</div>
      </div>
      {view === 'compact' && state.usagePin && !idleNotch ? <UsagePin pin={state.usagePin} /> : null}
      {bubble && view === 'compact' && secondary ? (
        <button className="isl-bubble" title={secondary.title} aria-label={secondary.title} onClick={() => show('live', secondary.id)} onMouseEnter={() => hover && show('live', secondary.id)}>
          <Leading a={secondary} />
        </button>
      ) : null}
    </div>
  );
}
