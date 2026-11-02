// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Island+ pieces: the call card (timer and mute), the focus ruler, actions on
// cue and hint banners, the usage ring beside the pill, the artwork glow, and
// shuffle/repeat for the player.

import { useEffect, useRef, useState } from 'react';
import type { IslandAlert, IslandState, NowPlaying } from '../../core/api';
import { callTimer } from '../../core/island-calls';
import { glowColor } from '../../core/island-plus';
import { rulerMinutes } from '../../core/island';
import { api } from '../api';
import { Icon } from '../components/Icon';

/** A call: which app, how long, mute or unmute (system microphone or the app's own button). */
/** A short line in the Island (as Island.tsx's islandSay). */
const say = (msg: string) => window.dispatchEvent(new CustomEvent('island-toast', { detail: msg }));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function CallCard({ call, now }: { call: NonNullable<IslandState['call']>; now: number }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try { await api.islandx.callMute(!call.muted); } finally { setBusy(false); }
  };
  return (
    <div className="isl-call" data-testid="island-call">
      <div className="live-big num" style={{ color: call.muted ? '#ff453a' : '#30d158' }}>{callTimer(now - call.since)}</div>
      <div className="muted small">{call.muted ? 'Your microphone is muted' : 'Your microphone is on'}{call.video ? ' · camera on' : ''}</div>
      <div className="btn-row live-actions">
        <button className={`btn sm ${call.muted ? 'primary' : 'danger'}`} disabled={busy} data-testid="island-call-mute" onClick={() => void toggle()}>
          <Icon name="mic" size={12} /> {call.muted ? 'Unmute' : 'Mute'}
        </button>
        <button className="btn sm ghost" onClick={() => void api.islandx.callDismiss()}>Hide</button>
      </div>
    </div>
  );
}

/** Drag along the ruler (up to 3 hours) to pick a focus length; ticks every 15 minutes. */
export function FocusRuler({ value, onChange, onStart }: { value: number; onChange: (m: number) => void; onStart: (m: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pick = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) onChange(rulerMinutes((clientX - r.left) / r.width));
  };
  return (
    <div className="isl-ruler-wrap">
      <div
        ref={ref} className="isl-ruler" role="slider" aria-label="Focus length" aria-valuemin={1} aria-valuemax={180} aria-valuenow={value} tabIndex={0}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); pick(e.clientX); }}
        onPointerMove={(e) => { if (e.buttons) pick(e.clientX); }}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') onChange(Math.min(180, value + 5)); else if (e.key === 'ArrowLeft') onChange(Math.max(1, value - 5)); else if (e.key === 'Enter') onStart(value); }}
      >
        {Array.from({ length: 13 }, (_, i) => <i key={i} className={i % 4 === 0 ? 'hour' : ''} style={{ left: `${(i / 12) * 100}%` }} />)}
        <b style={{ width: `${(value / 180) * 100}%` }} />
      </div>
      <button className="btn sm" onClick={() => onStart(value)}>{value >= 60 ? `${Math.floor(value / 60)} h ${value % 60 ? `${value % 60} min` : ''}` : `${value} min`}</button>
    </div>
  );
}

/** Done / Later on a cue banner, "Add a cue" on the capture hint, Clean Up on a low-disk warning. */
export function PlusAlertActions({ alert, onDone }: { alert: IslandAlert; onDone: () => void }) {
  if (alert.kind === 'cue' && alert.ref === 'hint') {
    return <div className="btn-row"><button className="btn sm primary" onClick={() => { void api.cues.compose({ attach: ['page'] }); onDone(); }}>Add a cue</button></div>;
  }
  if (alert.kind === 'cue' && alert.ref) {
    const id = alert.ref;
    return (
      <div className="btn-row">
        <button className="btn sm primary" onClick={() => { void api.cues.complete(id); onDone(); }}>Done</button>
        <button className="btn sm" onClick={() => { void api.cues.snooze(id, '1h'); onDone(); }}>1 h</button>
        <button className="btn sm icon" title="Open" aria-label="Open" onClick={() => { void api.cues.openPage(id); onDone(); }}><Icon name="external" size={12} /></button>
      </div>
    );
  }
  if (alert.kind === 'mail' && alert.ref) {
    // New Important mail dropped down from the notch: read it, or deal with it from here.
    const id = alert.ref;
    const one = id.split(':').length > 2;
    return (
      <div className="btn-row" data-testid="island-mail-actions">
        <button className="btn sm primary" onClick={() => { void api.islandx.showPage(one ? `mail:${id}` : 'mail'); onDone(); }}>Open</button>
        {one ? <button className="btn sm icon" title="Archive" aria-label="Archive" onClick={() => { api.pim.archive([id]).catch((e) => say(`Couldn’t archive it: ${errMsg(e)}`)); onDone(); }}><Icon name="archive" size={12} /></button> : null}
        {one ? <button className="btn sm icon" title="Mark read" aria-label="Mark read" onClick={() => { api.pim.setRead([id], true).catch((e) => say(`Couldn’t mark it read: ${errMsg(e)}`)); onDone(); }}><Icon name="check" size={12} /></button> : null}
      </div>
    );
  }
  if (alert.kind === 'disk') return <div className="btn-row"><button className="btn sm" onClick={() => { void api.islandx.showPage('cleanup'); onDone(); }}>Clean Up</button></div>;
  return null;
}

/** The AI allowance closest to its limit, as a small ring beside the pill. */
export function UsagePin({ pin }: { pin: NonNullable<IslandState['usagePin']> }) {
  const size = 22;
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  const color = pin.percent >= 98 ? '#ff453a' : pin.percent >= 80 ? '#ff9f0a' : '#30d158';
  return (
    <span className="isl-usage-pin" title={`${pin.label}: ${pin.percent}% used`} data-testid="island-usage-pin">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth={3} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, pin.percent / 100))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="num">{pin.percent}</span>
    </span>
  );
}

/** The average colour of the artwork (when the image allows reading it), else a soft default. */
export function useGlow(artwork: string | undefined, on: boolean): string | undefined {
  const [color, setColor] = useState<string | undefined>();
  useEffect(() => {
    if (!on) { setColor(undefined); return; }
    if (!artwork) { setColor('rgba(255, 55, 95, .55)'); return; }
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 24;
        const g = cv.getContext('2d');
        g?.drawImage(img, 0, 0, 24, 24);
        const px = g?.getImageData(0, 0, 24, 24).data;
        const c = px ? glowColor(px) : null;
        if (alive) setColor(c ?? 'rgba(255, 55, 95, .55)');
      } catch {
        // The artwork's server does not allow reading its pixels.
        if (alive) setColor('rgba(255, 55, 95, .55)');
      }
    };
    img.onerror = () => alive && setColor('rgba(255, 55, 95, .55)');
    img.src = artwork;
    return () => { alive = false; };
  }, [artwork, on]);
  return color;
}

/** Shuffle and repeat, where the player reports them. */
export function MediaModes({ np, reload }: { np: NowPlaying; reload: () => void }) {
  if (!np.canShuffle && np.shuffle === undefined) return null;
  return (
    <>
      <button className={`btn sm icon ${np.shuffle ? 'on' : ''}`} title={np.shuffle ? 'Shuffle is on' : 'Shuffle'} aria-label={np.shuffle ? 'Shuffle is on' : 'Shuffle'} aria-pressed={!!np.shuffle} onClick={() => void api.islandx.mediaMode('shuffle').then(reload)}><Icon name="shuffle" size={12} /></button>
      <button className={`btn sm icon ${np.repeat ? 'on' : ''}`} title={np.repeat ? 'Repeat is on' : 'Repeat'} aria-label={np.repeat ? 'Repeat is on' : 'Repeat'} aria-pressed={!!np.repeat} onClick={() => void api.islandx.mediaMode('repeat').then(reload)}><Icon name="repeat" size={12} /></button>
    </>
  );
}
