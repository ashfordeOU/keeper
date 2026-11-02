// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island window: a pill at the top of the screen that opens into a small
// panel with music, shelf, clipboard, agents, focus timer and calendar.

import { OwlMark, type OwlMood } from '../components/OwlMark';
import { resolveLanguage, translate } from '../i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { IslandAlert, IslandState } from '../../core/api';
import { formatDuration } from '../../core/format';
import { focusLeft as focusShown, type LyricLine } from '../../core/island';
import { describeCode } from '../../core/weather';
import { api } from '../api';
import { openNative } from '../lib/native';
import { Icon } from '../components/Icon';
import { ClipboardTab, ControlsTab, ShelfTab } from './IslandTabs';
import { AskTool, CalendarTool, ConvertTool, EmojiTool, FocusExtras, MirrorTool, NotesTool, SalesTool, ShortcutsTool, StocksTool, SystemTool, UsageTool, WeatherTool, useFocusSound, useToolsStore } from './tools/IslandTools';
import { TeleprompterTool } from './tools/Teleprompter';
import { FocusTaskPicker, InsightsTool, TasksTool, WeekTool } from './tools/IslandPlanner';
import { CuesTool } from './tools/CuesTool';
import { FocusRuler, MediaModes, PlusAlertActions, UsagePin, useGlow } from './IslandPlus';
import { agentName } from '../../core/island-agents';
import { plusSetting } from '../../core/island-plus';
import { alertIcon, alertPresentation, mayExpand, shortTitle } from '../../core/island-expand';
import type { Activity } from '../../core/island-activities';
import { VibesTool } from '../wallpaper/IslandVibes';
import { DECK_MAX, ISLAND_TOOLS, addRecentTool, deckTools, liveSlot, migrateDeck, moreTools, moveInDeck, pinTool, unpinTool, type IslandToolId, type LiveSlot } from '../../core/island-tools/tools';
import { Deck, type DeckItem, type DeckView } from './Deck';
import { MoreGrid, readRecentTools, writeRecentTools } from './MoreGrid';
import { SpringSet, SPRINGS } from './spring';
import { BREATH, CLOSE_GRACE_MS, CONTENT_FADE_IN_MS, CONTENT_FADE_OUT_MS, CONTENT_REVEAL_AT, HOVER_DWELL_MS, addSample, isSweep, mayClose, motionFor, progressOf, type IslandView, type PointerSample } from '../../core/island-open';
import { chime, Leading, LiveCard, PrivacyDots, Trailing, useActivities, useGestures, useLayout } from './Activities';
import { useFeatureStates } from '../features';
import { PANEL_SIZES, PANEL_SIZE_LABEL, largestBox, panelBox, roomIn, snapSize, stepSize, tabPanel, withTabSize, type PanelSize } from '../../core/island-size';
import { useStore } from '../state';
import '../styles/island.css';

// Shown in the Island's own toast.
const islandSay = (msg: string) => window.dispatchEvent(new CustomEvent('island-toast', { detail: msg }));

type Tab = DeckView;
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

/** The picked task as the focus call wants it ("id\ttitle" in the picker). */
const focusTaskArg = (v: string) => { const i = v.indexOf('\t'); return i > 0 ? { taskId: v.slice(0, i), taskTitle: v.slice(i + 1) } : undefined; };

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** the window shrinks this long after the shape's spring has come to rest */
const SHRINK_AFTER_REST_MS = 50;
/** the person (or the system) asked for less motion: springs jump and content crossfades */
const reducedMotion = () => {
  const m = document.documentElement.dataset.motion;
  if (m === 'reduce') return true;
  if (m === 'full') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
/** fades an element in over `ms` */
function fadeIn(el: HTMLElement, ms: number) {
  el.style.transition = `opacity ${ms}ms ease-out`;
  el.style.opacity = '1';
}
type Box = { w: number; h: number };
/** what the shape is drawn in: the black is as big as the biggest state and clipped to the current one */
type ShapeGeo = { full: Box; box: Box; edge: string; floating: boolean };
/** The clip that shows a w × h shape (corner radius r) of the black, for the Island's edge. */
function clipFor(g: ShapeGeo, w: number, h: number, r: number): string {
  const dx = (g.full.w - w) / 2;
  const dy = (g.full.h - h) / 2;
  if (g.edge === 'left') return `inset(${dy}px ${g.full.w - w}px ${dy}px 0px round 0 ${r}px ${r}px 0)`;
  if (g.edge === 'right') return `inset(${dy}px 0px ${dy}px ${g.full.w - w}px round ${r}px 0 0 ${r}px)`;
  const top = g.floating ? r : 0;
  return `inset(0px ${dx}px ${g.full.h - h}px ${dx}px round ${top}px ${top}px ${r}px ${r}px)`;
}
/** room around the open Island for its shadow or glow (`.isl-shadow` in island.css) */
const HALO = 28;
/** the size button's short name for each size */
const SIZE_SHORT: Record<PanelSize, string> = { compact: 'S', regular: 'M', large: 'L', xl: 'XL' };
/** fields that take typing: clicking one gives the open Island the keyboard */
const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const timeOf = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function Island() {
  const { settings, updateSettings } = useStore();
  const isl = settings?.island;
  const [tools, saveTools] = useToolsStore();
  const featureStates = useFeatureStates();
  const hoverTimer = useRef<number | undefined>(undefined);
  const tr = (key: string) => translate(resolveLanguage(settings?.language), key);
  const [state, setState] = useState<IslandState | null>(null);
  // compact: the pill; live: one activity's card; panel: everything (tabs)
  const [mode, setMode] = useState<'compact' | 'live' | 'panel'>('compact');
  const [liveId, setLiveId] = useState<string | null>(null);
  const expanded = mode === 'panel';
  const layout = useLayout();
  const [tab, setTab] = useState<Tab>('home');
  const [recentTools, setRecentTools] = useState<string[]>(readRecentTools);
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
  // The pointer rests on the closed Island: the shape breathes (grows a little) and the window is already the open size.
  const [breath, setBreath] = useState(false);
  const pointerIn = useRef(false);
  const samples = useRef<PointerSample[]>([]);
  const pressed = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const bannerUp = useRef(false);
  // Where the pointer has been (to tell a visit from a sweep along the menu bar) and whether a button is held.
  useEffect(() => {
    const move = (e: MouseEvent) => { samples.current = addSample(samples.current, { x: e.screenX, y: e.screenY, t: performance.now() }); if (!e.buttons) pressed.current = 0; };
    const down = () => { pressed.current = Date.now(); };
    const up = () => { pressed.current = 0; };
    window.addEventListener('mousemove', move, { passive: true });
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); window.removeEventListener('blur', up); };
  }, []);

  // ---------------------------------------------------------------- the shape's motion (src/island/spring.ts)
  // One black shape, clipped to the current state; its width, height and corner radius are springs, written
  // straight to the clip each frame (no React render per frame). Nothing runs once they come to rest.
  const shapeEl = useRef<HTMLDivElement>(null);
  const contentEl = useRef<HTMLDivElement>(null);
  const inEl = useRef<HTMLDivElement>(null);
  const geo = useRef<ShapeGeo | null>(null);
  const target = useRef<{ view: IslandView; breath: boolean; w: number; h: number; r: number } | null>(null);
  const shown = useRef<{ view: IslandView; breath: boolean; w: number; h: number; r: number } | null>(null);
  // The content waits until the shape is most of the way to its new size, then fades in.
  const reveal = useRef<{ from: Box; to: Box } | null>(null);
  const closing = useRef<number | undefined>(undefined);
  const springs = useRef<SpringSet<'w' | 'h' | 'r'> | null>(null);
  const draw = useRef((v: Record<'w' | 'h' | 'r', number>) => {
    const g = geo.current;
    const el = shapeEl.current;
    if (!g || !el) return;
    const w = Math.max(0, Math.min(g.full.w, v.w));
    const h = Math.max(0, Math.min(g.full.h, v.h));
    el.style.clipPath = clipFor(g, w, h, Math.max(0, Math.min(v.r, w / 2, h)));
    // The notch's ears ride the shape's edges.
    contentEl.current?.style.setProperty('--ear-dx', `${(g.box.w - w) / 2}px`);
    const rv = reveal.current;
    if (rv && inEl.current && progressOf(rv.from, rv.to, v) >= CONTENT_REVEAL_AT) {
      reveal.current = null;
      fadeIn(inEl.current, CONTENT_FADE_IN_MS);
    }
  }).current;
  if (!springs.current) springs.current = new SpringSet<'w' | 'h' | 'r'>(draw);
  useEffect(() => () => springs.current?.stop(), []);
  useLayoutEffect(() => {
    const t = target.current;
    const s = springs.current!;
    if (!t) return;
    const was = shown.current;
    shown.current = t;
    const to = { w: t.w, h: t.h, r: t.r };
    if (!was) { s.jump(to); return; }
    const viewChanged = was.view !== t.view;
    if (!viewChanged && was.breath === t.breath && was.w === t.w && was.h === t.h && was.r === t.r) {
      if (!s.running) draw(s.get()); // the black's own size may have changed
      return;
    }
    const reduced = reducedMotion();
    if (viewChanged && inEl.current) {
      inEl.current.style.transition = 'none';
      inEl.current.style.opacity = '0';
      const now = s.get();
      reveal.current = { from: { w: now.w, h: now.h }, to };
    }
    const kind = motionFor(was, t);
    if (reduced) {
      // Less motion: sizes jump, the content crossfades.
      s.jump(to);
      if (reveal.current && inEl.current) { reveal.current = null; fadeIn(inEl.current, 120); }
    } else {
      s.to(to, SPRINGS[kind]);
      if (!s.running) draw(s.get());
    }
    if (kind === 'close') {
      // The window shrinks back to the pill only once the shape has closed.
      s.whenAtRest(() => {
        window.clearTimeout(closing.current);
        closing.current = window.setTimeout(() => { if (modeRef.current === 'compact' && !bannerUp.current) api.island.setExpanded(false); }, SHRINK_AFTER_REST_MS);
      });
    }
  });

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
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(closing.current);
    setBreath(false);
    unfade();
    api.island.setExpanded(true);
    if (id) setLiveId(id);
    setMode(m);
  };
  /** A close that was fading out is called off (the pointer came back): the content shows again. */
  const unfade = () => {
    const el = inEl.current;
    if (el && el.style.opacity === '0' && !reveal.current) fadeIn(el, 120);
  };
  /** What keeps the open Island open after the pointer leaves: a menu, a field with the keyboard, a drag, a held button. */
  const holds = () => ({
    menuOpen: !!document.querySelector('.isl-content [role="menu"], .isl-content .shelf-pop'),
    fieldFocused: document.hasFocus() && !!(document.activeElement as HTMLElement | null)?.matches?.(FIELD),
    dragging: !!drag.current,
    pressed: pressed.current > 0 && Date.now() - pressed.current < 10_000,
  });
  /**
   * Closes after `delay` (the grace after the pointer leaves; coming back calls it off). With `guard`, it waits
   * while something holds it open. The content fades out first, then the shape closes without a bounce, and
   * the window shrinks once the shape is at rest.
   */
  const collapse = (delay = CLOSE_GRACE_MS, guard = false) => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(hoverTimer.current);
    const attempt = () => {
      if (guard && (pointerIn.current || !mayClose(holds()))) { if (!pointerIn.current) closeTimer.current = window.setTimeout(attempt, 300); return; }
      const el = inEl.current;
      const fade = el && !reducedMotion() ? CONTENT_FADE_OUT_MS : 0;
      if (el && fade) { el.style.transition = `opacity ${fade}ms linear`; el.style.opacity = '0'; }
      closeTimer.current = window.setTimeout(() => {
        bannerUp.current = !!alert && alertRules.current.alertStyle === 'banner';
        setMode('compact');
        setAlertOpen(false);
        setBreath(false);
      }, fade);
    };
    closeTimer.current = window.setTimeout(attempt, delay);
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
    setTab((id === 'more' || ISLAND_TOOLS.some((x) => x.id === id) ? id : 'home') as Tab);
    show('panel');
    // The New task shortcut is for typing straight away: only then does opening take the keyboard.
    if (then === 'new') { setComposeKey(Date.now()); api.island.takeFocus?.(); }
  }), []);

  // The open panel's size while the grip is dragged (or until Settings has the size it was dropped at),
  // and the size button's menu.
  const [dragSize, setDragSize] = useState<PanelSize | null>(null);
  const drag = useRef<{ y0: number; h0: number; moved?: boolean } | null>(null);
  const dragEnded = useRef(0);
  const [sizeMenu, setSizeMenu] = useState(false);
  useEffect(() => { if (!drag.current) setDragSize(null); }, [isl?.panelSizes, isl?.panelSize, tab]);

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
  // The window is never bigger than what is showing: the pill (kept centred) and its bubble when closed,
  // the card or panel when open, plus room for a shadow or glow. Nothing else of the window is ever seen,
  // so the system can never show it as a frame around the Island. It grows at once and shrinks only
  // after the shape has finished its morph.
  const winSize = useRef<{ w: number; h: number } | null>(null);
  const sentSize = useRef<{ w: number; h: number } | null>(null);
  const shrinkTo = useRef<{ w: number; h: number; t: number } | null>(null);
  if (layout) winSize.current = side ? { w: compact.w + (bubble ? bubble + 6 : 0), h: compact.h + (bubble ? bubble + 6 : 0) } : { w: compact.w + 2 * ((bubble ? bubble + 6 : 0) + ears), h: compact.h };
  useLayoutEffect(() => {
    const want = winSize.current;
    if (!want) return;
    const send = (x: { w: number; h: number }) => { sentSize.current = x; api.island.setSize?.(x.w, x.h); };
    const had = sentSize.current;
    if (had && had.w === want.w && had.h === want.h) { if (shrinkTo.current) { window.clearTimeout(shrinkTo.current.t); shrinkTo.current = null; } return; }
    if (shrinkTo.current && shrinkTo.current.w === want.w && shrinkTo.current.h === want.h) return;
    if (shrinkTo.current) { window.clearTimeout(shrinkTo.current.t); shrinkTo.current = null; }
    if (!had || (want.w >= had.w && want.h >= had.h)) { send(want); return; }
    if (want.w > had.w || want.h > had.h) send({ w: Math.max(want.w, had.w), h: Math.max(want.h, had.h) });
    // Shrinks once the shape's spring has come to rest (and a moment more), never while it still moves.
    const job = { ...want, t: 0 };
    shrinkTo.current = job;
    springs.current!.whenAtRest(() => {
      if (shrinkTo.current !== job) return;
      job.t = window.setTimeout(() => { if (shrinkTo.current === job) { shrinkTo.current = null; send(want); } }, SHRINK_AFTER_REST_MS);
    });
  });
  useEffect(() => () => { if (shrinkTo.current) window.clearTimeout(shrinkTo.current.t); }, []);

  // The task a focus session is for (picked on the Timers tab).
  const [focusTask, setFocusTask] = useState('');

  if (!state || isl?.enabled === false) return null;

  // ---------------------------------------------------------------- what the pill shows
  const waiting = state.agents.find((a) => a.state === 'waiting');
  const working = state.agents.find((a) => a.state === 'working');
  const stuck = state.agents.find((a) => a.state === 'stuck');
  // Time left in the block, or for a stopwatch the time counted so far.
  const focusLeft = focusShown(state.focus, now);
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
  else if (state.focus.mode !== 'idle') liveText = <>{state.focus.mode === 'break' ? 'Break' : state.focus.taskTitle ?? 'Focus'} · <b className="num">{mmss(focusLeft)}</b></>;
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
  // The open panel: the tab's size (core/island-size.ts), never bigger than the room the placement has.
  // On a notch the open Island is the notch growing: pure black, no shadow and no glow, so no room for them either.
  const halo = !notch && (glow || plusSetting(isl, 'shadow')) ? HALO : 0;
  const sizeRoom = { scale: sc, notchH, max: layout ? roomIn(layout.expanded, { side, ears, halo }) : undefined };
  const tabP = tabPanel(tab, isl ?? {});
  const tabSize = tabP.size;
  const panelSize = dragSize ?? tabSize;
  const boxes = {
    compact: compact,
    alert: { w: Math.round(420 * sc), h: notchH + Math.round(76 * sc) },
    live: { w: Math.max(Math.round(440 * sc), gap + 160), h: notchH + Math.round(150 * sc) },
    panel: panelBox(dragSize ?? tabP.px, sizeRoom),
  };
  const box = boxes[view];
  // The shape is drawn as big as the biggest panel, so every change (open, close, another size) is one morph.
  const most = largestBox(sizeRoom);
  const full = { w: Math.max(box.w, most.w), h: Math.max(box.h, most.h) };
  const floating = layout?.anchor === 'below-bar' || side;
  // Open: the window is the card or panel itself (and the notch's ears), plus room for the shadow
  // below a floating Island or the artwork glow, the only things ever drawn outside the shape.
  const openWindow = (b: Box) => (side ? { w: b.w + halo, h: b.h + 2 * halo } : { w: b.w + 2 * Math.max(ears, halo), h: b.h + (halo ? halo + 6 : 0) });
  // What opens from here: an inline alert, the main activity's card, or the panel.
  const opensTo = inlineAlert ? boxes.alert : primary ? boxes.live : boxes.panel;
  if (layout && view !== 'compact') winSize.current = openWindow(box);
  // While the pointer rests on the closed Island, its window already grows to what will open (clicks still
  // go through outside the shape), so opening is only the shape's own motion.
  else if (layout && breath) winSize.current = ((a, b) => ({ w: Math.max(a.w, b.w), h: Math.max(a.h, b.h) }))(winSize.current ?? compact, openWindow(opensTo));
  const r = view === 'compact' ? (floating ? box.h / 2 : Math.min(box.h / 2, 20 * sc)) : plusSetting(isl, 'cornerRadius') * sc;
  const edge = layout?.edge ?? isl?.edge ?? 'top';
  // The breath: the closed shape grows a little at once (not with less motion; the content keeps its place).
  const breathing = view === 'compact' && breath && !reducedMotion();
  const grow = breathing ? (side ? { w: BREATH.h * sc, h: BREATH.w * sc } : { w: BREATH.w * sc, h: BREATH.h * sc }) : { w: 0, h: 0 };
  const shapeBox = { w: box.w + grow.w, h: box.h + grow.h };
  geo.current = { full: { w: Math.max(full.w, shapeBox.w), h: Math.max(full.h, shapeBox.h) }, box, edge, floating };
  target.current = { view, breath: breathing, w: shapeBox.w, h: shapeBox.h, r: view === 'compact' && floating ? shapeBox.h / 2 : r };
  const hover = isl?.hoverOpen !== false;
  /** Opens what the closed Island leads to (an inline alert, the main activity's card, or the panel), with a tap on the trackpad. */
  const openNow = (tap = true) => {
    if (inlineAlert) openAlert();
    else if (primary) show('live', primary.id);
    else show('panel');
    if (tap && isl?.haptics !== false) api.island.haptic?.();
  };
  const enter = () => {
    pointerIn.current = true;
    if (view === 'compact') {
      // At once: the shape breathes and the window grows to what will open.
      api.island.prepare?.(true);
      setBreath(true);
      if (!hover) return;
      // Then a short rest before opening; a pointer sweeping along the menu bar only passes by.
      window.clearTimeout(hoverTimer.current);
      const attempt = () => {
        if (!pointerIn.current) return;
        if (isSweep(samples.current, performance.now())) { hoverTimer.current = window.setTimeout(attempt, 60); return; }
        openNow();
      };
      hoverTimer.current = window.setTimeout(attempt, Math.max(0, isl?.hoverDelayMs ?? HOVER_DWELL_MS));
    } else {
      window.clearTimeout(closeTimer.current);
      unfade();
    }
  };
  /** The pointer left the closed Island: no open, the breath settles, the window shrinks back after it. */
  const leaveClosed = () => {
    pointerIn.current = false;
    window.clearTimeout(hoverTimer.current);
    setBreath(false);
    api.island.prepare?.(false);
    api.island.setInteractive?.(false);
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
  // The deck: up to four pinned tools, a live slot, and More with the rest (core/island-tools/tools.ts).
  const available = (id: IslandToolId) => {
    if (id === 'clipboard') return isl?.clipboard !== false;
    if (id === 'agents') return isl?.agents !== false;
    const f = ISLAND_TOOLS.find((x) => x.id === id)?.feature;
    return !f || f === 'island' || featureStates?.get(f)?.on !== false;
  };
  const deckIds = deckTools(isl?.deck ?? migrateDeck(isl?.toolOrder, isl?.toolsOff), available);
  const LABELS: Partial<Record<IslandToolId, string>> = { home: tr('island.home'), shelf: tr('island.shelf'), clipboard: tr('island.clipboard'), agents: tr('island.agents') };
  const BADGES: Partial<Record<IslandToolId, number | undefined>> = { shelf: state.shelf.length || undefined, agents: state.agents.filter((a) => a.state === 'waiting').length || undefined };
  const itemOf = (id: IslandToolId): DeckItem => {
    const t = ISLAND_TOOLS.find((x) => x.id === id)!;
    return { id, icon: t.icon, label: LABELS[id] ?? t.label, badge: BADGES[id] };
  };
  const deckItems = deckIds.map(itemOf);
  const slot = liveSlot(acts.all, deckIds, available);
  const more = moreTools(isl?.toolsOff, recentTools, available, (id) => itemOf(id).label);
  const viewLabel = tab === 'more' ? 'More' : itemOf(tab).label;
  const setIsl = (p: Partial<NonNullable<typeof isl>>) => isl && void updateSettings({ island: { ...isl, ...p } });
  /** This tab's own size (null: back to the default for it). */
  const setTabSize = (size: PanelSize | null) => {
    if (!isl) return;
    if (size) setDragSize(size);
    setIsl({ panelSizes: withTabSize(isl, tab, size) as NonNullable<typeof isl>['panelSizes'] });
  };
  const setDeck = (deck: IslandToolId[]) => setIsl({ deck, toolsOff: (isl?.toolsOff ?? []).filter((x) => !deck.includes(x as IslandToolId)) });
  /** Opens a tool (from the deck, More or the live slot); tools opened from More become recent. */
  const openTool = (id: IslandToolId) => {
    setTab(id);
    if (!deckIds.includes(id)) setRecentTools((r) => { const next = addRecentTool(r, id); writeRecentTools(next); return next; });
  };
  const openLive = (x: LiveSlot) => (x.kind === 'tool' ? openTool(x.tool) : show('live', x.activity));
  // The grip on the bottom edge: drag to resize, snapping to the nearest size; arrow keys step.
  const grip = (
    <div
      className="isl-grip" role="slider" tabIndex={0} data-testid="island-grip"
      aria-label="Size of the open Island" aria-valuemin={0} aria-valuemax={PANEL_SIZES.length - 1} aria-valuenow={PANEL_SIZES.indexOf(panelSize)} aria-valuetext={PANEL_SIZE_LABEL[panelSize]}
      title={`${PANEL_SIZE_LABEL[panelSize]}: drag to make the Island bigger or smaller for this tab`}
      onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y0: e.clientY, h0: box.h }; setDragSize(panelSize); }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const next = snapSize(drag.current.h0 + e.clientY - drag.current.y0, sizeRoom);
        if (next !== panelSize) { drag.current.moved = true; setDragSize(next); }
      }}
      onPointerUp={() => { const d = drag.current; if (!d) return; drag.current = null; dragEnded.current = Date.now(); if (panelSize !== tabSize || (d.moved && !tabP.own)) setTabSize(panelSize); else setDragSize(null); }}
      onPointerCancel={() => { drag.current = null; setDragSize(null); }}
      onKeyDown={(e) => {
        const by = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
        if (!by) return;
        e.preventDefault();
        const next = stepSize(panelSize, by);
        if (next !== panelSize) setTabSize(next);
      }}
    ><i /></div>
  );

  const lyricIdx = np && state.lyrics ? lineAt(state.lyrics, np.position) : -1;

  if (view === 'panel') content = (
      <div className="isl-panel" onDragOver={(e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); if (tab !== 'shelf') setTab('shelf'); }}>
        <Deck
          items={deckItems} view={tab} fromMore={tab !== 'more' && !deckIds.includes(tab) && !(slot?.kind === 'tool' && slot.tool === tab) ? itemOf(tab) : undefined}
          live={slot ? { ...slot, label: slot.kind === 'tool' ? itemOf(slot.tool).label : 'Live' } : null}
          onSelect={openTool} onMore={() => setTab('more')} onLive={openLive}
          onMove={(id, by) => setDeck(moveInDeck(deckIds, id, deckIds.indexOf(id) + by))}
          onUnpin={(id) => { setDeck(unpinTool(deckIds, id)); }}
          lead={isl?.buddy !== false && deckIds.length < DECK_MAX ? <span className="deck-buddy"><Buddy mood={mood} /></span> : null}
          trail={<button className="size-btn" title={`Size: ${PANEL_SIZE_LABEL[panelSize]} (for this view)`} aria-label={`Size of the open Island: ${PANEL_SIZE_LABEL[panelSize]}`} aria-haspopup="menu" aria-expanded={sizeMenu} data-testid="island-size-btn" onClick={() => setSizeMenu(!sizeMenu)}>{SIZE_SHORT[panelSize]}</button>}
        />
        {sizeMenu ? (
          <div className="shelf-pop tab-menu size-menu" role="menu" style={{ right: 12, left: 'auto', top: 40 }} onMouseLeave={() => setSizeMenu(false)}>
            <div className="muted small" style={{ padding: '4px 8px' }}>Size for {viewLabel}</div>
            {PANEL_SIZES.map((z) => <button key={z} role="menuitemradio" aria-checked={z === panelSize} className={z === panelSize ? 'on' : ''} onClick={() => { setTabSize(z); setSizeMenu(false); }}><b style={{ width: 22, display: 'inline-block' }}>{SIZE_SHORT[z]}</b> {PANEL_SIZE_LABEL[z]}</button>)}
            {isl?.panelSizes?.[tab] ? <button onClick={() => { setTabSize(null); setSizeMenu(false); }}><Icon name="undo" size={11} /> Use the default</button> : null}
          </div>
        ) : null}
        {toast ? <div className="isl-toast">{toast}</div> : null}
        <div className="body">
          {tab === 'home' ? (
            <div className="grid2 home">
              <div className="tile" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                {np ? (
                  <>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div className="art">{np.artwork ? <img src={np.artwork} alt="" /> : <Icon name="audio" size={22} />}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <b className="ellipsis isl-primary" style={{ display: 'block' }}>{np.title}</b>
                        <span className="ellipsis isl-secondary" style={{ display: 'block' }}>{np.artist}{np.album ? ` · ${np.album}` : ''}</span>
                        <span className="isl-caption">{np.app}</span>
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
                    <div className="big-time" style={{ color: 'var(--isl-fg)' }}>{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    {new Date(now).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {state.weather && isl?.weather !== false ? (
                  <div className="tile" role="button" tabIndex={0} title="Open in Weather" style={{ cursor: 'pointer' }} onClick={openWeather} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openWeather(); }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span className="isl-temp">{Math.round(state.weather.current.temp)}°</span><span>{describeCode(state.weather.current.code).label}</span></div>
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
                  {focusLeft ? <span><Icon name="timer" size={13} /> {mmss(focusLeft)}</span> : null}
                  {/* Keep awake and Stage: one tap from Home (they were buttons on the tab bar). */}
                  {state.awakeAvailable === false ? null : <button className={`status-chip ${state.keepAwake.on ? 'on' : ''}`} title={state.keepAwake.on ? 'Stop keeping awake' : 'Keep awake'} aria-pressed={state.keepAwake.on} data-testid="island-awake-chip" onClick={() => void api.island.keepAwake(!state.keepAwake.on).then(load)}><Icon name="coffee" size={13} />{state.keepAwake.on ? <> Awake{state.keepAwake.until ? ` · ${mmss(state.keepAwake.until - now)}` : ''}</> : null}</button>}
                  {featureStates?.get('stage')?.on === false ? null : <button className={`status-chip ${state.stage?.on ? 'on' : ''}`} title={state.stage?.on ? 'Stop Stage' : 'Stage: a clean screen'} aria-label={state.stage?.on ? 'Stop Stage' : 'Stage: a clean screen'} data-testid="island-stage-btn" onClick={() => void (state.stage?.on ? api.stage.stop() : api.stage.toggle()).then(load)}><Icon name="eye" size={13} /></button>}
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'more' ? (
            <MoreGrid
              deck={deckItems} recent={more.recent.filter((id) => !deckIds.includes(id)).map(itemOf)} rest={more.rest.filter((id) => !deckIds.includes(id)).map(itemOf)}
              onOpen={openTool}
              onPin={(id, o) => setDeck(pinTool(deckIds, id, o))}
              onUnpin={(id) => setDeck(unpinTool(deckIds, id))}
              onMove={(id, to) => setDeck(moveInDeck(deckIds, id, to))}
              onLauncher={featureStates?.get('toolLauncher')?.on === false ? undefined : () => void api.islandx?.openLauncher()}
              onSettings={() => void api.islandx?.showPage('island')}
            />
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
                <div className="big-time">{state.focus.mode !== 'idle' ? mmss(focusLeft) : `${state.focus.focusMin}:00`}</div>
                <div className="muted">{state.focus.mode === 'idle' ? `${state.focus.rounds} round${state.focus.rounds === 1 ? '' : 's'} today` : state.focus.mode === 'break' ? 'Break — stretch and look away' : state.focus.pausedLeft !== undefined ? (state.focus.pausedBy === 'system' ? 'Paused while the computer was away' : 'Paused') : state.focus.stopwatch ? 'Stopwatch' : 'Focusing'}</div>
                {state.focus.taskTitle && state.focus.mode !== 'idle' ? <div className="small ellipsis" title="The time is logged on this task"><Icon name="listCheck" size={11} /> {state.focus.taskTitle}</div> : null}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {state.focus.mode === 'idle' ? (
                  <>
                    <FocusTaskPicker value={focusTask} onChange={setFocusTask} />
                    <div className="btn-row">
                      <button className="btn primary" onClick={() => void api.island.focus('start', 25, focusTaskArg(focusTask)).then(load)}>25 min</button>
                      <button className="btn" onClick={() => void api.island.focus('start', 50, focusTaskArg(focusTask)).then(load)}>50 min</button>
                      <button className="btn" title="Count up with no end" onClick={() => void api.island.focus('stopwatch', undefined, focusTaskArg(focusTask)).then(load)}><Icon name="stopwatch" size={12} /> Stopwatch</button>
                    </div>
                    <FocusRuler value={custom} onChange={setCustom} onStart={(m) => void (focusTask ? api.island.focus('start', m, focusTaskArg(focusTask)) : api.islandx.focusFor(m)).then(load)} />
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
                    {!state.focus.stopwatch ? <button className="btn" title="Five more minutes" onClick={() => void api.island.focus('extend', 5).then(load)}>+5 min</button> : null}
                    <button className="btn" onClick={() => void api.island.focus('stop').then(load)}>Stop</button>
                  </div>
                )}
                {state.awakeAvailable === false ? null : <button className="btn sm" onClick={() => void api.island.keepAwake(!state.keepAwake.on).then(load)}><Icon name="coffee" size={12} /> {state.keepAwake.on ? 'Stop keeping awake' : 'Keep awake'}</button>}
              </div>
            </div>
            <FocusExtras />
            </div>
          ) : null}

          {tab === 'calendar' ? <CalendarTool state={state} now={now} size={panelSize} /> : null}
          {tab === 'cues' ? <CuesTool state={state} now={now} /> : null}
        </div>
        {side ? null : grip}
      </div>
  );

  const vars = {
    '--notch-h': `${notchH}px`, '--gap': `${gap}px`, '--box-w': `${box.w}px`, '--box-h': `${box.h}px`, '--full-w': `${full.w}px`, '--full-h': `${full.h}px`, '--bubble': `${bubble}px`, '--wing': `${layout?.wing || 120}px`,
  } as React.CSSProperties;
  return (
    <div className={`isl-root edge-${edge} anchor-${layout?.anchor ?? 'edge'} view-${view} size-${panelSize} ${floating ? 'floating' : ''} ${isl?.monochrome ? 'mono' : ''} ${breathing ? 'breath' : ''}`} style={vars} role="region" aria-label="Island">
      {/* Alerts are read out by screen readers as they arrive, without taking focus. */}
      <div className="sr-only" role="status" aria-live="assertive" aria-atomic="true">{view === 'alert' && alert ? [alert.app, alert.title, alert.detail].filter(Boolean).join('. ') : ''}</div>
      <div aria-hidden className={`isl-shadow ${plusSetting(isl, 'shadow') ? '' : 'no-shadow'} ${glow && !notch ? 'glowing' : ''}`} style={glow && !notch ? ({ '--glow': glow } as React.CSSProperties) : undefined}>
        <div className="isl-shape" ref={shapeEl} />
      </div>
      <div
        ref={contentEl}
        className={`isl isl-content view-${view}`}
        // Compact, the Island is one button: Enter or Space opens it, Escape closes it.
        role={view === 'compact' ? 'button' : undefined}
        tabIndex={view === 'compact' ? 0 : undefined}
        aria-label={view === 'compact' ? (primary ? `${primary.title}: open` : 'Open the Island') : undefined}
        onKeyDown={(e) => {
          if (view === 'compact' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (primary) show('live', primary.id); else show('panel'); }
          else if (view !== 'compact' && e.key === 'Escape') collapse(0);
        }}
        onMouseEnter={() => { api.island.setInteractive?.(true); enter(); }}
        // The open Island takes the keyboard only when a field in it is clicked, so opening it never
        // brings Keeper (or its main window) to the front.
        onMouseDownCapture={(e) => { if (view !== 'compact' && (e.target as HTMLElement).closest?.(FIELD)) api.island.takeFocus?.(); }}
        onMouseLeave={(e) => {
          if (drag.current) return;
          // A window that just grew or moved can report a leave with the pointer still on the Island (Linux): not a leave.
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX > r.left + 1 && e.clientX < r.right - 1 && e.clientY > r.top + 1 && e.clientY < r.bottom - 1) return;
          if (view === 'compact') { leaveClosed(); return; }
          pointerIn.current = false;
          if (view === 'alert' && alertOpen) { setAlertOpen(false); api.island.setExpanded(false); } else collapse(Date.now() - dragEnded.current < 500 ? 1500 : CLOSE_GRACE_MS, true); }}
        onClick={(e) => {
          if (view !== 'compact') return;
          // Alt/Option-click hides the Island for a minute (alerts still come back after).
          if (e.altKey) { void api.islandx?.hideFor(plusSetting(isl, 'altHideMinutes')); return; }
          // A click opens at once (also with hover-to-open off).
          openNow();
        }}
        onDragEnter={(e) => { if (!e.dataTransfer.types.includes('Files')) return; show('panel'); setTab('shelf'); }}
        {...gestures}
      >
        {notch ? <><i className="ear l" aria-hidden /><i className="ear r" aria-hidden /></> : null}
        <div key={view} ref={inEl} className="isl-in">{content}</div>
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
