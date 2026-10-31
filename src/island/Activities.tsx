// SPDX-License-Identifier: AGPL-3.0-or-later
// The Island's activities: what is going on, drawn around the notch (or the
// camera), a second one as a bubble beside it, and a Live Activity card with
// controls. Everything here reacts to events; nothing polls.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { IslandState } from '../../core/api';
import { activitiesFrom, present, transientsFrom, type Activity, type ExtraInputs, type Presentation } from '../../core/island-activities';
import type { Placement } from '../../core/island-place';
import type { Progress } from '../../core/types';
import { formatDuration } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';

// ---------------------------------------------------------------- data

/** Where this window sits and what it fits around; updated when screens change. */
export function useLayout(): Placement | null {
  const [p, setP] = useState<Placement | null>(null);
  useEffect(() => {
    void api.island.layout?.().then(setP).catch(() => undefined);
    return api.on('island-layout', (x: Placement) => setP(x));
  }, []);
  return p;
}

/** Long jobs Keeper reports (convert, clean up, duplicates, space map, locking). */
function useJobs(): ExtraInputs['jobs'] {
  const [jobs, setJobs] = useState<Record<string, { task: string; phase: string; fraction: number; at: number }>>({});
  useEffect(() => {
    // A finished job stays a moment at 100%, unless more progress for it arrives meanwhile.
    const set = (task: string, phase: string, fraction: number, fin: boolean) => {
      const at = Date.now() + Math.random();
      setJobs((j) => ({ ...j, [task]: { task, phase, fraction, at } }));
      if (fin) window.setTimeout(() => setJobs((j) => { if (j[task]?.at !== at) return j; const n = { ...j }; delete n[task]; return n; }), 1200);
    };
    const offP = api.on('progress', (p: Progress) => {
      if (p.task === 'index' && p.total < 50) return;
      set(p.task, p.phase, p.total ? p.done / p.total : 0, p.phase === 'Done' || (p.total > 0 && p.done >= p.total));
    });
    const PHASE: Record<string, string> = { scan: 'Looking through the folder', encrypt: 'Encrypting', verify: 'Checking every file', remove: 'Removing the unlocked copy', decrypt: 'Decrypting' };
    const offL = api.on('lock-progress', (p: { phase: string; done: number; total: number }) => {
      const fraction = p.total ? p.done / p.total : 0;
      // Locking ends with removing the originals; unlocking with decrypting.
      set(p.phase === 'decrypt' ? 'unlock' : 'lock', PHASE[p.phase] ?? p.phase, fraction, fraction >= 1 && (p.phase === 'remove' || p.phase === 'decrypt'));
    });
    // Files going to or coming from another device (Keeper Link).
    const offT = api.on('link-transfer', (t: { id: string; name: string; size: number; done: number; direction: 'send' | 'receive'; state: string; peer?: string }) => {
      if (t.size < 256 * 1024 && t.state !== 'done') return;
      set(t.direction === 'receive' ? 'download' : 'upload', `${t.name}${t.peer ? ` ${t.direction === 'receive' ? 'from' : 'to'} ${t.peer}` : ''}`, t.size ? t.done / t.size : 0, t.state === 'done' || t.state === 'failed' || t.state === 'cancelled');
    });
    return () => { offP(); offL(); offT(); };
  }, []);
  return useMemo(() => Object.values(jobs), [jobs]);
}

/** This screen being watched by another device or phone right now. */
function useSharing(): NonNullable<ExtraInputs['sharing']> {
  const [list, setList] = useState<NonNullable<ExtraInputs['sharing']>>([]);
  useEffect(() => {
    const apply = (s: { sessions: { id: string; role: string; state: string; peerName: string; control: boolean; started: number }[] }) =>
      setList(s.sessions.filter((x) => x.role === 'host' && x.state !== 'ended').map((x) => ({ sid: x.id, name: x.peerName, control: x.control, since: x.started })));
    // Filled in once remote screen sharing is part of this build.
    void apply;
    return undefined;
  }, []);
  return list;
}

/** Folders unlocked right now, refreshed when locks change. */
function useUnlocked(): { count: number; folders: string[] } {
  const [u, setU] = useState<{ count: number; folders: string[] }>({ count: 0, folders: [] });
  useEffect(() => {
    const load = () => void api.lock?.list?.().then((l) => {
      const open = l.filter((x) => x.state === 'unlocked');
      setU({ count: open.length, folders: open.map((x) => x.folder ?? x.vault) });
    }).catch(() => undefined);
    load();
    return api.on('locks-changed', load);
  }, []);
  return u;
}

export interface IslandActivities {
  pres: Presentation;
  all: Activity[];
  dots: { camera: string[]; mic: string[] };
  unlocked: string[];
}

export function useActivities(state: IslandState | null, now: number, dictation: 'off' | 'on' | 'working', off: string[] = []): IslandActivities {
  const jobs = useJobs();
  const unlocked = useUnlocked();
  const sharing = useSharing();
  const prev = useRef<IslandState | null>(null);
  const [transient, setTransient] = useState<Activity[]>([]);

  // Short-lived ones come from what changed between two states.
  useEffect(() => {
    if (!state) return;
    const fresh = transientsFrom(prev.current, state, Date.now());
    prev.current = state;
    if (!fresh.length) return;
    setTransient((t) => [...t.filter((x) => (x.until ?? 0) > Date.now()), ...fresh]);
    const last = Math.max(...fresh.map((a) => a.until ?? 0)) - Date.now();
    const h = window.setTimeout(() => setTransient((t) => t.filter((x) => (x.until ?? 0) > Date.now())), last + 50);
    return () => window.clearTimeout(h);
  }, [state]);

  return useMemo(() => {
    if (!state) return { pres: { more: 0 }, all: [], dots: { camera: [], mic: [] }, unlocked: [] };
    const all = [
      ...activitiesFrom(state, now, { dictation: dictation === 'off' ? undefined : dictation, jobs, unlocked: unlocked.count, sharing, off }),
      ...transient.filter((a) => !off.includes(a.kind)),
    ];
    return { pres: present(all, now), all, dots: { camera: state.camInUse ?? [], mic: state.micInUse ?? [] }, unlocked: unlocked.folders };
  }, [state, now, dictation, jobs, unlocked, sharing, transient, off]);
}

// ---------------------------------------------------------------- glyphs

/** A progress ring around an icon. */
function Ring({ value, color, size = 18, children }: { value: number; color: string; size?: number; children?: React.ReactNode }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="act-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth={2.4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      {children ? <span className="act-ring-in">{children}</span> : null}
    </span>
  );
}

/** Five bars that dance while music plays or someone speaks; CSS-only, paused when not shown. */
function Wave({ color }: { color: string }) {
  return <span className="act-wave" style={{ color }}>{[0, 1, 2, 3, 4].map((i) => <i key={i} />)}</span>;
}

/** Left of the notch: what it is. */
export function Leading({ a }: { a: Activity }) {
  if (a.kind === 'music' && a.ref) return <span className="act-lead act-art" style={{ background: a.color }}><Icon name="audio" size={12} /></span>;
  return <span className="act-lead" style={{ color: a.color }}><Icon name={a.icon} size={15} /></span>;
}

/** Right of the notch: how it is going. */
export function Trailing({ a }: { a: Activity }) {
  if (a.wave) return <Wave color={a.color} />;
  if (a.kind === 'charging' || a.kind === 'headphones') return <span className="act-pair"><b className="act-trail num" style={{ color: a.color }}>{a.trailing}</b><Ring value={a.progress ?? 0} color={a.color} /></span>;
  if (a.kind === 'progress') return <Ring value={a.progress ?? 0} color={a.color} />;
  if (a.trailing) return <b className="act-trail num" style={{ color: a.kind === 'timer' || a.kind === 'recording' ? a.color : undefined }}>{a.trailing}</b>;
  if (a.progress !== undefined) return <Ring value={a.progress} color={a.color} />;
  return null;
}

export function PrivacyDots({ dots }: { dots: { camera: string[]; mic: string[] } }) {
  if (!dots.camera.length && !dots.mic.length) return null;
  return (
    <span className="privacy-dots" title={[dots.camera.length ? `Camera: ${dots.camera.join(', ')}` : '', dots.mic.length ? `Microphone: ${dots.mic.join(', ')}` : ''].filter(Boolean).join(' · ')}>
      {dots.camera.length ? <i className="dot-cam" /> : null}
      {dots.mic.length ? <i className="dot-mic" /> : null}
    </span>
  );
}

// ---------------------------------------------------------------- the Live Activity card

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function LiveCard({ a, state, now, unlocked, onMore, reload }: { a: Activity; state: IslandState; now: number; unlocked: string[]; onMore: () => void; reload: () => void }) {
  const np = state.nowPlaying;
  let body: React.ReactNode = <div className="muted small">{a.detail}</div>;
  let actions: React.ReactNode = null;

  if ((a.kind === 'music' || a.kind === 'paused-music') && np) {
    body = (
      <>
        <div className="live-row">
          <div className="art">{np.artwork ? <img src={np.artwork} alt="" /> : <Icon name="audio" size={22} />}</div>
          <div className="grow-min">
            <b className="ellipsis block">{np.title}</b>
            <span className="muted ellipsis block">{np.artist}{np.album ? ` · ${np.album}` : ''}</span>
          </div>
          {np.playing ? <Wave color={a.color} /> : null}
        </div>
        <div className="live-bar"><i style={{ width: `${(np.position / Math.max(1, np.duration)) * 100}%`, background: a.color }} /></div>
        <div className="live-times muted small num"><span>{formatDuration(np.position)}</span><span>-{formatDuration(Math.max(0, np.duration - np.position))}</span></div>
      </>
    );
    actions = (
      <>
        <button className="btn sm icon" title="Previous" onClick={() => void api.island.media('previous').then(reload)}><Icon name="prev" size={13} /></button>
        <button className="btn sm icon primary" title={np.playing ? 'Pause' : 'Play'} onClick={() => void api.island.media('toggle').then(reload)}><Icon name={np.playing ? 'pause' : 'play'} size={13} /></button>
        <button className="btn sm icon" title="Next" onClick={() => void api.island.media('next').then(reload)}><Icon name="next" size={13} /></button>
      </>
    );
  } else if (a.kind === 'timer') {
    const paused = state.focus.pausedLeft !== undefined;
    body = (
      <>
        <div className="live-big num" style={{ color: a.color }}>{a.trailing}</div>
        {a.progress !== undefined ? <div className="live-bar"><i style={{ width: `${a.progress * 100}%`, background: a.color }} /></div> : null}
      </>
    );
    actions = (
      <>
        {paused
          ? <button className="btn sm primary" onClick={() => void api.island.focus('resume').then(reload)}><Icon name="play" size={12} /> Resume</button>
          : <button className="btn sm" onClick={() => void api.island.focus('pause').then(reload)}><Icon name="pause" size={12} /> Pause</button>}
        <button className="btn sm" onClick={() => void api.island.focus('stop').then(reload)}>Stop</button>
      </>
    );
  } else if (a.kind === 'recording' && state.recording) {
    body = <div className="live-big num" style={{ color: a.color }}><span className="rec-dot" /> {mmss(now - state.recording.since)}<span className="muted small"> Recording the screen</span></div>;
    actions = <button className="btn sm danger" onClick={() => void api.capture.stopRecording().then(reload)}>Stop recording</button>;
  } else if (a.kind.startsWith('agent') && a.ref) {
    actions = <button className="btn sm primary" onClick={() => void api.island.openAgent(a.ref!)}>Open</button>;
  } else if (a.kind === 'meeting') {
    body = <div><div className="live-big num" style={{ color: a.color }}>{a.trailing === 'now' ? 'Now' : `in ${a.trailing}`}</div>{a.detail ? <div className="muted small">{a.detail}</div> : null}</div>;
    actions = a.ref ? <button className="btn sm primary" onClick={() => void api.system.openExternal(a.ref!)}>Join</button> : null;
  } else if (a.kind === 'progress' || a.kind === 'charging' || a.kind === 'battery-low' || a.kind === 'headphones') {
    body = (
      <>
        <div className="live-big num" style={{ color: a.color }}>{a.trailing ?? `${Math.round((a.progress ?? 0) * 100)}%`}</div>
        <div className={`live-bar ${a.kind === 'charging' ? 'charge' : ''}`}><i style={{ width: `${(a.progress ?? 0) * 100}%`, background: a.color }} /></div>
        {a.detail ? <div className="muted small ellipsis">{a.detail}</div> : null}
      </>
    );
  } else if (a.kind === 'awake') {
    actions = <button className="btn sm" onClick={() => void api.island.keepAwake(false).then(reload)}>Stop keeping awake</button>;
  } else if (a.kind === 'sharing') {
    body = <div><div className="live-big num" style={{ color: a.color }}>{a.trailing}</div><div className="muted small">The other side sees everything on this screen.</div></div>;
    actions = <button className="btn sm danger" onClick={() => undefined}>Stop sharing</button>;
  } else if (a.kind === 'unlocked') {
    body = <div className="muted small">{unlocked.map((f) => f.split(/[\\/]/).pop()).join(', ')}</div>;
    actions = <button className="btn sm primary" onClick={() => void Promise.all(unlocked.map((f) => api.lock.relock(f))).catch(() => undefined)}><Icon name="lock" size={12} /> Lock now</button>;
  } else if (a.kind === 'copied') {
    body = <div className="live-copied ellipsis">{a.detail}</div>;
  }

  return (
    <div className="live-card" role="status">
      <div className="live-head">
        <span className="live-icon" style={{ background: a.color }}><Icon name={a.icon} size={13} /></span>
        <b className="ellipsis grow-min">{a.title}</b>
        <button className="btn sm ghost" onClick={onMore} title="Open the Island">More</button>
      </div>
      <div className="live-body">{body}</div>
      {actions ? <div className="btn-row live-actions">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- touch and pen

/** Tap to open, swipe down for everything, swipe up to close, press and hold for the card. */
export function useGestures(handlers: { tap: () => void; down: () => void; up: () => void; hold: () => void }) {
  const start = useRef<{ x: number; y: number; t: number; held: boolean; timer: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const timer = window.setTimeout(() => { if (start.current) { start.current.held = true; handlers.hold(); } }, 550);
      start.current = { x: e.clientX, y: e.clientY, t: Date.now(), held: false, timer };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      window.clearTimeout(s.timer);
      if (s.held) return;
      const dy = e.clientY - s.y;
      if (dy > 24) handlers.down();
      else if (dy < -24) handlers.up();
      else if (Math.abs(e.clientX - s.x) < 12) handlers.tap();
    },
    onPointerCancel: () => {
      if (start.current) window.clearTimeout(start.current.timer);
      start.current = null;
    },
  };
}
