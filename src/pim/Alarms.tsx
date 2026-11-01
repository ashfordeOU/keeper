// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Alarms, countdown timers, a stopwatch and world clocks. Alarms and timers
// ring with a sound in Keeper, a notification and the Island.

import { useCallback, useEffect, useState } from 'react';
import type { Ring } from '../../core/api-pim';
import { timerLeft, untilText } from '../../core/pim/alarms';
import type { Alarm, CountdownTimer, Weekday, WorldClock } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import { usePimChanges } from './Mail';
import '../styles/pim.css';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};
const daysText = (d: Weekday[]) => (!d.length ? 'Once' : d.length === 7 ? 'Every day' : d.join() === '1,2,3,4,5' ? 'Weekdays' : d.join() === '0,6' ? 'Weekends' : d.map((x) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x]).join(', '));

export function Alarms() {
  const { route, go } = useStore();
  const tab = (route.arg as 'alarms' | 'timers' | 'stopwatch' | 'clocks') || 'alarms';
  const [data, setData] = useState<{ alarms: Alarm[]; timers: CountdownTimer[]; clocks: WorldClock[]; next?: number }>({ alarms: [], timers: [], clocks: [] });
  const [, tick] = useState(0);
  const load = useCallback(() => void api.pim.alarms().then(setData), []);
  useEffect(load, [load]);
  usePimChanges(['alarms'], load);
  useEffect(() => {
    const h = setInterval(() => tick((x) => x + 1), tab === 'stopwatch' ? 50 : 1000);
    return () => clearInterval(h);
  }, [tab]);

  return (
    <div className="alarms-page">
      <PageHead title="Clock" sub={data.next ? `Next alarm ${untilText(data.next)} · ${new Date(data.next).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'No alarms on'}>
        <div className="seg">
          {([['alarms', 'Alarms', 'alarm'], ['timers', 'Timers', 'timer'], ['stopwatch', 'Stopwatch', 'stopwatch'], ['clocks', 'World clocks', 'globe']] as const).map(([id, label, icon]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => go({ name: 'alarms', arg: id })}><Icon name={icon} size={13} /> {label}</button>
          ))}
        </div>
      </PageHead>
      {tab === 'alarms' ? <AlarmList alarms={data.alarms} /> : tab === 'timers' ? <Timers timers={data.timers} /> : tab === 'stopwatch' ? <Stopwatch /> : <Clocks clocks={data.clocks} />}
    </div>
  );
}

function AlarmList({ alarms }: { alarms: Alarm[] }) {
  const [edit, setEdit] = useState<Alarm | null>(null);
  const { toast } = useStore();
  return (
    <>
      <div className="alarm-list">
        {[...alarms].sort((a, b) => a.time.localeCompare(b.time)).map((a) => (
          <div key={a.id} className={`alarm-card ${a.enabled ? '' : 'off'}`} onClick={() => setEdit(a)}>
            <div className="alarm-time">{new Date(`2026-01-01T${a.time}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
            <div className="grow"><div>{a.label || 'Alarm'}</div><div className="small muted">{daysText(a.days)}{a.snoozedUntil && a.snoozedUntil > Date.now() ? ` · snoozed until ${new Date(a.snoozedUntil).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}</div></div>
            <div onClick={(e) => e.stopPropagation()}><Toggle on={a.enabled} label={`${a.label} on`} onChange={(v) => void api.pim.saveAlarm({ ...a, enabled: v, date: v && !a.days.length ? undefined : a.date })} /></div>
          </div>
        ))}
        <button className="alarm-card add" onClick={() => setEdit({ id: '', label: '', time: '07:00', days: [1, 2, 3, 4, 5], enabled: true, sound: 'chime', snoozeMin: 9 })}><Icon name="plus" size={18} /> New alarm</button>
      </div>
      <p className="small muted" style={{ maxWidth: 640 }}>Alarms ring while the computer is awake. If it was asleep, an alarm missed by up to 15 minutes rings late when it wakes; on a Mac you can ask the computer to wake for an alarm (it asks for an administrator once).</p>
      {edit ? (
        <Modal title={edit.id ? 'Edit alarm' : 'New alarm'} onClose={() => setEdit(null)} width={440}>
          <div className="col" style={{ gap: 12 }}>
            <input className="input alarm-input" type="time" value={edit.time} onChange={(e) => setEdit({ ...edit, time: e.target.value })} aria-label="Time" />
            <input className="input" placeholder="Label" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
            <div className="day-picker">{DAYS.map((d, i) => <button key={i} className={edit.days.includes(i as Weekday) ? 'on' : ''} aria-pressed={edit.days.includes(i as Weekday)} onClick={() => setEdit({ ...edit, days: edit.days.includes(i as Weekday) ? edit.days.filter((x) => x !== i) : ([...edit.days, i].sort() as Weekday[]) })}>{d}</button>)}</div>
            <div className="row" style={{ gap: 8 }}>
              <select className="input" value={edit.sound} onChange={(e) => { const s = e.target.value as Alarm['sound']; setEdit({ ...edit, sound: s }); playSound(s, 1); }} aria-label="Sound">
                <option value="chime">Chime</option><option value="bell">Bell</option><option value="beep">Beep</option><option value="none">No sound</option>
              </select>
              <select className="input" value={edit.snoozeMin} onChange={(e) => setEdit({ ...edit, snoozeMin: Number(e.target.value) })} aria-label="Snooze">
                {[5, 9, 10, 15, 20].map((m) => <option key={m} value={m}>Snooze {m} min</option>)}
              </select>
            </div>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              {edit.id ? <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => { void api.pim.deleteAlarm(edit.id); setEdit(null); }}>Delete</button> : null}
              {edit.id ? <button className="btn ghost" onClick={async () => { const r = await api.pim.scheduleWake(edit.id); toast(r.message); }}>Wake the computer</button> : null}
              <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn primary" onClick={() => { // A one-off alarm gets its date again (today, or tomorrow when that time has passed).
                void api.pim.saveAlarm({ ...edit, enabled: true, date: undefined }); setEdit(null); }}>Save</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function Timers({ timers }: { timers: CountdownTimer[] }) {
  const [label, setLabel] = useState('');
  const [mins, setMins] = useState(5);
  const now = Date.now();
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="timer-presets">
        {[1, 3, 5, 10, 15, 25, 30, 60].map((m) => <button key={m} className="chip" onClick={() => void api.pim.startTimer(label || `${m} min`, m * 60_000)}>{m < 60 ? `${m} min` : '1 hour'}</button>)}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ maxWidth: 240 }} />
        <input className="input" type="number" min={1} max={1440} value={mins} onChange={(e) => setMins(Number(e.target.value))} style={{ width: 90 }} aria-label="Minutes" />
        <span className="muted">min</span>
        <button className="btn primary" onClick={() => { void api.pim.startTimer(label || `${mins} min`, mins * 60_000); setLabel(''); }}><Icon name="play" size={13} /> Start</button>
      </div>
      <div className="timer-list">
        {timers.map((t) => {
          const left = timerLeft(t, now);
          const pct = t.durationMs ? 1 - left / t.durationMs : 0;
          return (
            <div key={t.id} className="timer-card">
              <svg viewBox="0 0 100 100" className="timer-ring" aria-hidden><circle cx="50" cy="50" r="44" className="bg" /><circle cx="50" cy="50" r="44" className="fg" style={{ strokeDasharray: `${pct * 276.5} 276.5` }} /></svg>
              <div className="timer-left">{fmt(left)}</div>
              <div className="small muted ellipsis">{t.label}{t.endsAt === undefined ? ' (paused)' : ''}</div>
              <div className="btn-row" style={{ justifyContent: 'center' }}>
                {t.endsAt !== undefined ? <button className="btn sm" onClick={() => void api.pim.timerAction(t.id, 'pause')}><Icon name="pause" size={12} /></button> : <button className="btn sm" onClick={() => void api.pim.timerAction(t.id, 'resume')}><Icon name="play" size={12} /></button>}
                <button className="btn sm" onClick={() => void api.pim.timerAction(t.id, 'restart')}><Icon name="refresh" size={12} /></button>
                <button className="btn sm" onClick={() => void api.pim.timerAction(t.id, 'cancel')}><Icon name="close" size={12} /></button>
              </div>
            </div>
          );
        })}
        {!timers.length ? <div className="small muted">No timers running. Running timers also show in the Island.</div> : null}
      </div>
    </div>
  );
}

function Stopwatch() {
  // Kept in this window only; it survives switching pages but not quitting Keeper.
  const [s, setS] = useState<{ start?: number; acc: number; laps: number[] }>(() => {
    try { return JSON.parse(sessionStorage.getItem('stopwatch') ?? '') as { start?: number; acc: number; laps: number[] }; } catch { return { acc: 0, laps: [] }; }
  });
  useEffect(() => { sessionStorage.setItem('stopwatch', JSON.stringify(s)); }, [s]);
  const elapsed = s.acc + (s.start ? Date.now() - s.start : 0);
  const show = (ms: number) => {
    const m = Math.floor(ms / 60_000);
    return `${m}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`;
  };
  return (
    <div className="stopwatch">
      <div className="stopwatch-time">{show(elapsed)}</div>
      <div className="btn-row" style={{ justifyContent: 'center' }}>
        {s.start ? <button className="btn" onClick={() => setS({ ...s, laps: [elapsed, ...s.laps] })}>Lap</button> : <button className="btn" disabled={!elapsed} onClick={() => setS({ acc: 0, laps: [] })}>Reset</button>}
        {s.start ? <button className="btn danger" onClick={() => setS({ ...s, acc: elapsed, start: undefined })}>Stop</button> : <button className="btn primary" onClick={() => setS({ ...s, start: Date.now() })}>Start</button>}
      </div>
      <div className="laps">{s.laps.map((l, i) => <div key={i} className="row small"><span className="grow muted">Lap {s.laps.length - i}</span><span>{show(l - (s.laps[i + 1] ?? 0))}</span></div>)}</div>
    </div>
  );
}

const ZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC', 'Europe/London', 'America/New_York', 'Asia/Tokyo'];

function Clocks({ clocks }: { clocks: WorldClock[] }) {
  const [zone, setZone] = useState('');
  const now = new Date();
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="clock-grid">
        {clocks.map((c) => {
          const t = now.toLocaleTimeString(undefined, { timeZone: c.zone, hour: 'numeric', minute: '2-digit' });
          const local = new Date(now.toLocaleString('en-US', { timeZone: c.zone }));
          const diff = Math.round((local.getTime() - now.getTime()) / 3_600_000);
          const day = local.getDate() === now.getDate() ? 'Today' : local.getTime() > now.getTime() ? 'Tomorrow' : 'Yesterday';
          return (
            <div key={c.zone} className="clock-card">
              <div className="small muted">{day}, {diff === 0 ? 'same time' : `${diff > 0 ? '+' : ''}${diff} h`}</div>
              <div className="clock-time">{t}</div>
              <div className="row"><span className="grow">{c.label ?? c.zone.split('/').pop()!.replace(/_/g, ' ')}</span><button className="btn sm ghost icon" aria-label="Remove" onClick={() => void api.pim.saveClocks(clocks.filter((x) => x.zone !== c.zone))}><Icon name="close" size={12} /></button></div>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" list="zones" placeholder="Add a city or time zone" value={zone} onChange={(e) => setZone(e.target.value)} style={{ maxWidth: 320 }} />
        <datalist id="zones">{ZONES.map((z) => <option key={z} value={z}>{z.split('/').pop()!.replace(/_/g, ' ')}</option>)}</datalist>
        <button className="btn" disabled={!ZONES.includes(zone)} onClick={() => { void api.pim.saveClocks([...clocks, { zone, label: zone.split('/').pop()!.replace(/_/g, ' ') }]); setZone(''); }}>Add</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ringing

let audio: AudioContext | null = null;

/** Plays a short tone pattern with Web Audio (no sound files shipped). */
export function playSound(kind: Alarm['sound'] | 'event', times = 1) {
  if (kind === 'none') return;
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    const notes = kind === 'bell' ? [880, 660] : kind === 'beep' ? [1000, 1000, 1000] : kind === 'event' ? [660, 880] : [784, 988, 1175];
    let t = ctx.currentTime;
    for (let r = 0; r < times; r++) {
      for (const f of notes) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = kind === 'beep' ? 'square' : 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(kind === 'beep' ? 0.08 : 0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'bell' ? 0.9 : 0.35));
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 1);
        t += kind === 'beep' ? 0.18 : 0.28;
      }
      t += 0.6;
    }
  } catch {
    /* no audio device */
  }
}

/** Shows what is ringing (alarm, timer) with Snooze and Stop, and plays its sound until stopped. */
export function RingHost() {
  const [rings, setRings] = useState<Ring[]>([]);
  useEffect(() => {
    const offA = api.on('pim-ring', (r: Ring) => {
      if (r.kind === 'event' || r.kind === 'reminder') { playSound('event'); return; }
      setRings((x) => [...x.filter((y) => y.id !== r.id), r]);
    });
    const offB = api.on('pim-ring-stop', (id: string) => setRings((x) => x.filter((y) => y.id !== id)));
    return () => { offA(); offB(); };
  }, []);
  useEffect(() => {
    if (!rings.length) return;
    void api.pim.alarms().then((d) => {
      const a = d.alarms.find((x) => x.id === rings[0].id);
      playSound(a?.sound ?? 'chime', 2);
    });
    // Keeps ringing for up to two minutes, like a phone.
    const h = setInterval(() => playSound('chime', 1), 4000);
    const stop = setTimeout(() => clearInterval(h), 120_000);
    return () => { clearInterval(h); clearTimeout(stop); };
  }, [rings.length]);
  if (!rings.length) return null;
  const r = rings[0];
  return (
    <div className="ring-overlay" role="alertdialog" aria-label={r.title}>
      <div className="ring-card">
        <Icon name={r.kind === 'timer' ? 'timer' : 'alarm'} size={36} />
        <div className="ring-title">{r.title}</div>
        <div className="muted">{r.kind === 'timer' ? 'Time is up' : new Date(r.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{r.late ? ' · rang late (the computer was asleep)' : ''}</div>
        <div className="btn-row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <button className="btn" onClick={() => { void api.pim.snoozeAlarm(r.id); setRings((x) => x.slice(1)); }}>{r.kind === 'timer' ? '+5 min' : 'Snooze'}</button>
          <button className="btn primary" autoFocus onClick={() => { void api.pim.stopRinging(r.id); setRings((x) => x.slice(1)); }}>Stop</button>
        </div>
      </div>
    </div>
  );
}
