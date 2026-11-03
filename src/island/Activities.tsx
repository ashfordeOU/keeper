// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's activities: what is going on, drawn around the notch (or the
// camera), a second one as a bubble beside it, and a Live Activity card with
// controls. Everything here reacts to events; nothing polls.

import { RemoteActivityActions, useRemoteActivities } from '../screen/island-remote';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { IslandState } from '../../core/api';
import { activitiesFrom, batteryColor, kindOff, present, transientsFrom, type Activity, type BatteryLook, type ExtraInputs, type Presentation } from '../../core/island-activities';
import type { Placement } from '../../core/island-place';
import type { Progress } from '../../core/types';
import { formatDuration } from '../../core/format';
import { meetingProvider } from '../../core/pim/agenda';
import { meetingLink } from '../../core/pim/alarms';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { CallCard, MediaModes, useGlow } from './IslandPlus';

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
    void api.screen?.state?.().then(apply).catch(() => undefined);
    return api.on('screen-state', apply as never);
  }, []);
  return list;
}

/** A Keeper update downloaded and ready (the updater says so when it changes; nothing is asked on a timer). */
function useUpdateReady(): string | undefined {
  const [v, setV] = useState<string | undefined>();
  useEffect(() => {
    const apply = (s?: { state?: string; version?: string } | null) => setV(s?.state === 'ready' ? s.version ?? 'A new version' : undefined);
    void api.appInfo?.updateStatus?.().then(apply).catch(() => undefined);
    return api.on('update-status' as 'navigate', apply as never);
  }, []);
  return v;
}

/** A soft three-note chime when a reminder comes due (made on the spot, no sound files). */
export function chime() {
  try {
    const ctx = new AudioContext();
    let t = ctx.currentTime;
    for (const f of [784, 988, 1175]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.4);
      t += 0.22;
    }
    window.setTimeout(() => void ctx.close(), 1500);
  } catch {
    /* no audio here */
  }
}

/** Voice: the meeting being recorded (its clock runs here between updates). */
function useVoiceMeeting(now: number): ExtraInputs['meetingRec'] {
  const [m, setM] = useState<{ title: string; elapsedMs: number; paused: boolean; last?: string; at: number } | null>(null);
  useEffect(() => {
    const apply = (x?: { title: string; elapsedMs: number; paused: boolean; utterances: { text: string }[] } | null) => setM(x ? { title: x.title, elapsedMs: x.elapsedMs, paused: x.paused, last: x.utterances[x.utterances.length - 1]?.text, at: Date.now() } : null);
    void api.voice?.status?.().then((s) => apply(s.meeting)).catch(() => undefined);
    const offs = [api.on('voice-meeting', apply as never), api.on('voice-state', ((_s: unknown, mt?: Parameters<typeof apply>[0]) => apply(mt)) as never)];
    return () => offs.forEach((f) => f());
  }, []);
  return m ? { title: m.title, paused: m.paused, last: m.last, elapsedMs: m.paused ? m.elapsedMs : m.elapsedMs + Math.max(0, now - m.at) } : undefined;
}

/** Keeper Mesh: the exit node in use, if the person shows it in the Island. */
function useMeshExit(): ExtraInputs['meshExit'] {
  const [v, setV] = useState<ExtraInputs['meshExit']>(null);
  useEffect(() => {
    void api.mesh?.state?.().then((s) => {
      const p = s.networks.flatMap((n) => n.peers).find((x) => x.device === s.exit.using);
      setV(s.on && s.exit.using && s.places.exit.includes('island') ? { name: p?.name ?? 'another device', since: Date.now() } : null);
    }).catch(() => undefined);
    return api.on('mesh-changed', (x) => setV(x));
  }, []);
  return v;
}

/** AIs using this computer right now (Agents → Use this computer). */
function useAiControl(): NonNullable<ExtraInputs['aiControl']> {
  const [list, setList] = useState<NonNullable<ExtraInputs['aiControl']>>([]);
  useEffect(() => {
    const apply = (s: { sessions: NonNullable<ExtraInputs['aiControl']> }) => setList(s.sessions);
    void api.agents?.computerState?.().then(apply).catch(() => undefined);
    return api.on('computer-state', apply as never);
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

/** When the music was paused (undefined while it plays or nothing plays); a new track starts over. */
function usePausedSince(np: IslandState['nowPlaying'] | undefined): number | undefined {
  const since = useRef<{ key: string; at: number } | null>(null);
  const key = np ? `${np.app}\u0000${np.title}` : '';
  if (!np || np.playing) since.current = null;
  else if (!since.current || since.current.key !== key) since.current = { key, at: Date.now() };
  return since.current?.at;
}

export function useActivities(state: IslandState | null, now: number, dictation: 'off' | 'on' | 'working', off: string[] = [], o: { alwaysBattery?: boolean } = {}): IslandActivities {
  const musicPausedSince = usePausedSince(state?.nowPlaying);
  const jobs = useJobs();
  const unlocked = useUnlocked();
  const sharing = useSharing();
  const meshExit = useMeshExit();
  const aiControl = useAiControl();
  const remote = useRemoteActivities();
  const meetingRec = useVoiceMeeting(now);
  const updateReady = useUpdateReady();
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
      ...activitiesFrom(state, now, { dictation: dictation === 'off' ? undefined : dictation, jobs, unlocked: unlocked.count, sharing, meshExit, aiControl, remote, off, meetingRec, updateReady, alwaysBattery: o.alwaysBattery, musicPausedSince }),
      ...transient.filter((a) => !kindOff(a.kind, off) && (!a.until || a.until > now)),
    ];
    return { pres: present(all, now), all, dots: { camera: state.camInUse ?? [], mic: state.micInUse ?? [] }, unlocked: unlocked.folders };
  }, [state, now, dictation, jobs, unlocked, sharing, meshExit, aiControl, remote, transient, off, meetingRec, updateReady, o.alwaysBattery, musicPausedSince]);
}

// ---------------------------------------------------------------- glyphs

/** A progress ring around an icon. */
function Ring({ value, color, size = 18, children }: { value: number; color: string; size?: number; children?: React.ReactNode }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="act-ring" style={{ width: size, height: size }} role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(1, value)) * 100)}>
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
  return <span className="act-wave" style={{ color }} aria-hidden>{[0, 1, 2, 3, 4].map((i) => <i key={i} />)}</span>;
}

/** The artwork's own colour (core/island-plus.ts glowColor), fully opaque, for the waveform. */
function useArtTint(art: string | undefined, on: boolean): string | undefined {
  const glow = useGlow(art, on && !!art);
  return glow?.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgb($1,$2,$3)');
}

/** The music's waveform, in the colour of its artwork (pink when the artwork has none or cannot be read). */
function MusicWave({ a }: { a: Activity }) {
  const tint = useArtTint(a.art, a.kind === 'music');
  return <Wave color={tint ?? a.color} />;
}

/** True once the element's content is wider than the element (measured again whenever it resizes). */
function useOverflows<T extends HTMLElement>(dep: unknown): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOver(el.scrollWidth > el.clientWidth + 0.5);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dep]);
  return [ref, over];
}

/**
 * A label in the closed Island that is shown whole or not at all: text that does not fit is never cut
 * off with "…" there; the icon and the number carry it instead.
 */
export function FitText({ text, className = '', testId }: { text: string; className?: string; testId?: string }) {
  const [ref, over] = useOverflows<HTMLSpanElement>(text);
  return <span ref={ref} className={`fit-text ${over ? 'nofit' : ''} ${className}`} data-testid={testId} data-fits={over ? 'no' : 'yes'} aria-hidden={over || undefined}>{text}</span>;
}

/**
 * One battery glyph with its percentage: filled to the charge, green while charging, red when low, yellow in
 * Low Power Mode. The percentage sits beside it in tabular figures, or inside the glyph when the room is short.
 */
export function BatteryMeter({ b, inside: forceInside }: { b: BatteryLook; inside?: boolean }) {
  const pct = Math.max(0, Math.min(100, Math.round(b.percent)));
  const color = batteryColor(b);
  const [ref, over] = useOverflows<HTMLSpanElement>(pct);
  const [inside, setInside] = useState(!!forceInside);
  // Beside it first; when the wing has no room for that, the number moves into the glyph.
  useLayoutEffect(() => { if (!forceInside && over) setInside(true); }, [over, forceInside]);
  useLayoutEffect(() => { setInside(!!forceInside); }, [pct, forceInside]);
  const label = `Battery ${pct}%${b.charging ? ', charging' : b.lowPower ? ', Low Power Mode' : ''}`;
  // The glyph is drawn: an outline, the fill to the charge, the cap, and a bolt or the number inside.
  const W = inside ? 28 : 22;
  const H = inside ? 13 : 11;
  const inner = W - 6.2;
  return (
    <span ref={ref} className={`batt ${inside ? 'inside' : ''}`} role="img" aria-label={label} title={label} data-testid="island-battery" style={{ ['--batt' as string]: color }}>
      <svg className="batt-glyph" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <rect x={0.6} y={0.6} width={W - 3.8} height={H - 1.2} rx={inside ? 3.5 : 3} fill="none" stroke="rgba(255,255,255,.5)" strokeWidth={1.2} />
        <rect x={2} y={2} width={Math.max(1, (inner * pct) / 100)} height={H - 4} rx={1.5} fill={color} />
        <rect x={W - 2.4} y={H / 2 - 2} width={1.8} height={4} rx={0.9} fill="rgba(255,255,255,.5)" />
        {inside
          ? <text x={(W - 3.2) / 2} y={H / 2 + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={8.5} fontWeight={700} fill="#fff" stroke="#000" strokeWidth={1.6} paintOrder="stroke" style={{ fontVariantNumeric: 'tabular-nums' }}>{pct}</text>
          : b.charging ? <path d={`M${W / 2 - 0.4} 1.6 l-3.4 4.6 h2.6 l-0.8 3.4 l3.6 -4.8 h-2.6 z`} fill="#fff" stroke="#000" strokeWidth={0.6} /> : null}
      </svg>
      {inside ? null : <b className="batt-pct num">{pct}%</b>}
    </span>
  );
}

/** Power activities (plugged in, unplugged, the battery glyph, low battery). */
export const isPower = (a: Activity | undefined): a is Activity & { battery: BatteryLook } => !!a?.battery;

/** Left of the notch for power: a green bolt while charging, else nothing (the battery is on the right). */
export function PowerLead({ a }: { a: Activity & { battery: BatteryLook } }) {
  return a.battery.charging ? <span className="act-lead" style={{ color: batteryColor(a.battery) }} aria-hidden><Icon name="bolt" size={15} /></span> : null;
}

/** Left of the notch: what it is. */
export function Leading({ a }: { a: Activity }) {
  // The real artwork, crossfading when the track changes.
  if ((a.kind === 'music' || a.kind === 'paused-music') && a.art) return <span className="act-lead act-art has-art"><img key={a.art} src={a.art} alt="" /></span>;
  if (a.kind === 'music' && a.ref) return <span className="act-lead act-art" style={{ background: a.color }}><Icon name="audio" size={12} /></span>;
  // Files on the shelf: only the small count on the right.
  if (a.kind === 'shelf-idle') return null;
  // On its own (the bubble): the battery with its number inside.
  if (isPower(a)) return <BatteryMeter b={a.battery} inside />;
  return <span className="act-lead" style={{ color: a.color }}><Icon name={a.icon} size={15} /></span>;
}

/** Right of the notch: how it is going. */
export function Trailing({ a }: { a: Activity }) {
  if (a.kind === 'music') return <MusicWave a={a} />;
  if (a.kind === 'paused-music' && a.art) return <span className="act-wave flat" aria-hidden>{[0, 1, 2, 3, 4].map((i) => <i key={i} />)}</span>;
  if (a.wave) return <Wave color={a.color} />;
  if (isPower(a)) return <BatteryMeter b={a.battery} />;
  if (a.kind === 'shelf-idle') return <span className="act-shelf" title={a.title}><Icon name="archive" size={11} /><b className="num">{a.trailing}</b></span>;
  if (a.kind === 'timer' && a.left !== undefined && a.left <= 10_000 && a.left > 0) return <b className="act-trail num act-pulse" style={{ color: a.color }}>{a.trailing}</b>;
  if (a.kind === 'headphones') return <span className="act-pair"><b className="act-trail num" style={{ color: a.color }}>{a.trailing}</b><Ring value={a.progress ?? 0} color={a.color} /></span>;
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

interface LiveProps { a: Activity; state: IslandState; now: number; unlocked: string[]; reload: () => void }

/** An activity's details and its buttons, for its card in the open Island and for the banner above a view. */
function liveParts({ a, state, now, unlocked, reload }: LiveProps): { body: React.ReactNode; actions: React.ReactNode } {
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
        <button className="btn sm icon" title="Previous" aria-label="Previous" onClick={() => void api.island.media('previous').then(reload)}><Icon name="prev" size={13} /></button>
        <button className="btn sm icon primary" title={np.playing ? 'Pause' : 'Play'} aria-label={np.playing ? 'Pause' : 'Play'} onClick={() => void api.island.media('toggle').then(reload)}><Icon name={np.playing ? 'pause' : 'play'} size={13} /></button>
        <button className="btn sm icon" title="Next" aria-label="Next" onClick={() => void api.island.media('next').then(reload)}><Icon name="next" size={13} /></button>
        <MediaModes np={np} reload={reload} />
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
        {a.id === 'timer' && !state.focus.stopwatch ? <button className="btn sm" title="Five more minutes" onClick={() => void api.island.focus('extend', 5).then(reload)}>+5 min</button> : null}
        <button className="btn sm" onClick={() => void api.island.focus('stop').then(reload)}>Stop</button>
      </>
    );
  } else if (a.id === 'meeting-rec') {
    // Voice's meeting recorder: pause and stop from the Island.
    body = <div><div className="live-big num" style={{ color: a.color }}><span className="rec-dot" /> {a.trailing}</div>{a.detail ? <div className="muted small ellipsis">{a.detail}</div> : <div className="muted small">Microphone and the computer’s sound</div>}</div>;
    actions = (
      <>
        <button className="btn sm" onClick={() => void api.voice.pauseMeeting(!a.title.startsWith('Paused')).then(reload)}><Icon name={a.title.startsWith('Paused') ? 'play' : 'pause'} size={12} /> {a.title.startsWith('Paused') ? 'Resume' : 'Pause'}</button>
        <button className="btn sm danger" onClick={() => void api.voice.stopMeeting().then(reload)}>Stop and save</button>
      </>
    );
  } else if (a.kind === 'recording' && state.recording) {
    body = <div className="live-big num" style={{ color: a.color }}><span className="rec-dot" /> {mmss(now - state.recording.since)}<span className="muted small"> Recording the screen</span></div>;
    actions = <button className="btn sm danger" onClick={() => void api.capture.stopRecording().then(reload)}>Stop recording</button>;
  } else if (a.kind.startsWith('agent') && a.ref) {
    actions = <button className="btn sm primary" onClick={() => void api.island.openAgent(a.ref!)}>Open</button>;
  } else if (a.kind === 'meeting') {
    body = <div><div className="live-big num" style={{ color: a.color }}>{a.trailing === 'now' ? 'Now' : `in ${a.trailing}`}</div>{a.detail ? <div className="muted small">{a.detail}</div> : null}</div>;
    actions = (
      <>
        {a.ref ? <button className="btn sm primary" title={meetingProvider(a.ref) ? `Join on ${meetingProvider(a.ref)}` : a.ref} onClick={() => void api.system.openExternal(a.ref!)}>{meetingProvider(a.ref) || meetingLink({ url: a.ref }) ? 'Join' : 'Open link'}</button> : null}
        {api.voice ? <button className="btn sm" title="Tell everyone it is recorded" onClick={() => void api.voice.startMeeting({ title: a.title }).then(reload).catch(() => undefined)}><span className="rec-dot" /> Record</button> : null}
      </>
    );
  } else if (isPower(a)) {
    body = (
      <>
        <div className="live-big num" style={{ color: batteryColor(a.battery) }}>{a.trailing}</div>
        <div className={`live-bar ${a.battery.charging ? 'charge' : ''}`}><i style={{ width: `${a.battery.percent}%`, background: batteryColor(a.battery) }} /></div>
        <div className="muted small">{a.battery.charging ? 'Charging' : a.battery.lowPower ? 'On battery · Low Power Mode' : 'On battery'}</div>
      </>
    );
  } else if (a.kind === 'progress' || a.kind === 'headphones') {
    body = (
      <>
        <div className="live-big num" style={{ color: a.color }}>{a.trailing ?? `${Math.round((a.progress ?? 0) * 100)}%`}</div>
        <div className="live-bar"><i style={{ width: `${(a.progress ?? 0) * 100}%`, background: a.color }} /></div>
        {a.detail ? <div className="muted small ellipsis">{a.detail}</div> : null}
      </>
    );
  } else if (a.kind === 'awake') {
    actions = (
      <>
        <button className="btn sm" onClick={() => void api.awake.extend(15).then(reload)}>+15 min</button>
        <button className="btn sm" onClick={() => void api.awake.extend(60).then(reload)}>+1 h</button>
        <button className="btn sm" onClick={() => void api.island.keepAwake(false).then(reload)}>Stop keeping awake</button>
      </>
    );
  } else if (a.kind === 'reminder' && a.ref) {
    body = <div><b className="ellipsis block">{a.title}</b><div className="muted small">{a.detail}</div></div>;
    actions = (
      <>
        <button className="btn sm" data-testid="reminder-snooze" onClick={() => void api.pim.snoozeReminder(a.ref!, 5).then(reload)}><Icon name="alarm" size={12} /> Snooze 5 min</button>
        <button className="btn sm primary" data-testid="reminder-done" onClick={() => void api.pim.completeReminder(a.ref!, true).then(reload)}><Icon name="check" size={12} /> Done</button>
      </>
    );
  } else if (a.kind === 'update') {
    body = <div className="muted small">{a.detail}</div>;
    actions = (
      <>
        <button className="btn sm primary" onClick={() => void api.appInfo.installUpdate()}>Restart and update</button>
        <button className="btn sm" onClick={() => void api.appInfo.scheduleUpdate('quit').then(reload).catch(() => undefined)}>When I quit</button>
      </>
    );
  } else if (a.kind === 'ai-control') {
    body = <div><div className="live-big num" style={{ color: a.color }}>{a.trailing}</div><div className="muted small">It can see the screen, move the pointer and type. {a.detail}.</div></div>;
    actions = <button className="btn sm danger" onClick={() => void api.agents.computerStop()}>Stop</button>;
  } else if (a.kind === 'sharing') {
    body = <div><div className="live-big num" style={{ color: a.color }}>{a.trailing}</div><div className="muted small">The other side sees everything on this screen.</div></div>;
    actions = <button className="btn sm danger" onClick={() => void api.screen.stop(a.ref!)}>Stop sharing</button>;
  } else if (a.kind === 'remote') {
    body = <div><div className="live-big num" style={{ color: a.color }}>{a.trailing}</div>{a.detail ? <div className="muted small">{a.detail}</div> : null}</div>;
    actions = <RemoteActivityActions refId={a.ref!} />;
  } else if (a.kind === 'unlocked') {
    body = <div className="muted small">{unlocked.map((f) => f.split(/[\\/]/).pop()).join(', ')}</div>;
    actions = <button className="btn sm primary" onClick={() => void Promise.all(unlocked.map((f) => api.lock.relock(f))).catch(() => undefined)}><Icon name="lock" size={12} /> Lock now</button>;
  } else if (a.kind === 'call' && state.call) {
    body = <CallCard call={state.call} now={now} />;
  } else if (a.kind === 'level') {
    body = (
      <>
        <div className="live-big num" style={{ color: a.color }}>{a.trailing}</div>
        <div className="live-bar"><i style={{ width: `${(a.progress ?? 0) * 100}%`, background: a.color }} /></div>
        <div className="muted small">Shown beside the system’s own pop-up.</div>
      </>
    );
  } else if (a.kind === 'cue' && a.ref) {
    const id = a.ref;
    body = <div className="muted small">{a.detail}</div>;
    actions = (
      <>
        <button className="btn sm primary" onClick={() => void api.cues.complete(id).then(reload)}>Done</button>
        <button className="btn sm" onClick={() => void api.cues.snooze(id, 'nextvisit').then(reload)}>Next time</button>
        <button className="btn sm" onClick={() => void api.cues.openPage(id)}>Open</button>
      </>
    );
  } else if (a.kind === 'usage') {
    body = <div><div className="live-big num" style={{ color: a.color }}>{a.trailing} left</div><div className="live-bar"><i style={{ width: `${(a.progress ?? 0) * 100}%`, background: a.color }} /></div>{a.detail ? <div className="muted small">{a.detail}</div> : null}</div>;
    actions = <><button className="btn sm primary" onClick={() => void api.glance.show()}>Details</button><button className="btn sm" onClick={() => void api.aiUsage.openPage()}>Usage page</button></>;
  } else if (a.kind === 'copied') {
    body = <div className="live-copied ellipsis">{a.detail}</div>;
  }

  return { body, actions };
}

/** The activity's chip: its icon on its colour (the battery for power). */
function LiveIcon({ a }: { a: Activity }) {
  if (isPower(a)) return <span className="live-icon" style={{ background: batteryColor(a.battery), color: a.battery.charging ? '#fff' : '#000' }}><Icon name={a.battery.charging ? 'bolt' : 'battery'} size={13} /></span>;
  return <span className="live-icon" style={{ background: a.color }}><Icon name={a.icon} size={13} /></span>;
}

/** An activity in full, as a view of the open Island (its deck stays above it). */
export function LiveCard(p: LiveProps) {
  const { a } = p;
  const { body, actions } = liveParts(p);
  return (
    <div className="live-card in-panel" role="status" data-testid="island-live-card">
      <div className="live-head">
        <LiveIcon a={a} />
        <b className="ellipsis grow-min">{a.title}</b>
      </div>
      <div className="live-body">{body}</div>
      {actions ? <div className="btn-row live-actions">{actions}</div> : null}
    </div>
  );
}

/**
 * The live activity (or the notice the Island was opened from) as a compact row above the open view: its icon,
 * title, how it is going, and its buttons. Clicking it shows the activity in full.
 */
export function LiveBanner(p: LiveProps & { onOpen?: () => void; onHide: () => void }) {
  const { a } = p;
  const { actions } = liveParts(p);
  return (
    <div className="live-banner" role="status" data-testid="island-live-banner" data-kind={a.kind}>
      <LiveIcon a={a} />
      <button className="live-banner-main" onClick={p.onOpen} disabled={!p.onOpen} title={p.onOpen ? 'Show it in full' : undefined}>
        <b className="ellipsis">{a.title}</b>
        {a.detail && !isPower(a) ? <span className="muted small ellipsis">{a.detail}</span> : null}
      </button>
      {isPower(a) ? <BatteryMeter b={a.battery} /> : a.trailing && a.kind !== 'music' ? <b className="num live-banner-trail" style={{ color: a.color }}>{a.trailing}</b> : null}
      {actions ? <div className="btn-row live-banner-actions">{actions}</div> : null}
      <button className="btn sm icon ghost" aria-label="Hide this" title="Hide this" onClick={p.onHide}><Icon name="close" size={11} /></button>
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
