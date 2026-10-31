// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings › Island › Placement: a picture of each screen showing what Keeper
// found (menu bar or top bar, the notch or camera) and where the Island sits,
// with the controls to change it.

import { useEffect, useState } from 'react';
import type { IslandPlacementPreview, IslandSettings as IS } from '../../core/api';
import type { ActivityKind } from '../../core/island-activities';
import { api } from '../api';
import { Toggle } from '../components/ui';
import { Row } from '../screens/IslandSettings';

const KIND_LABEL: [ActivityKind, string][] = [
  ['music', 'Music'], ['timer', 'Focus timer'], ['recording', 'Screen recording'], ['meeting', 'Next meeting'], ['progress', 'Long jobs (convert, clean up, locking)'],
  ['charging', 'Charging'], ['battery-low', 'Battery low'], ['copied', 'Copied'], ['headphones', 'Headphones connected'], ['agent-waiting', 'Agent needs you'],
  ['agent-working', 'Agent working'], ['rain', 'Rain soon'], ['awake', 'Keeping awake'], ['unlocked', 'Unlocked folders'],
];

function ScreenPicture({ d, wanted }: { d: IslandPlacementPreview['displays'][number]; wanted: boolean }) {
  const { info, placement: p } = d;
  const W = 300;
  const k = W / info.bounds.width;
  const H = Math.round(info.bounds.height * k);
  const rel = (r: { x: number; y: number; width: number; height: number }) => ({ left: (r.x - info.bounds.x) * k, top: (r.y - info.bounds.y) * k, width: Math.max(2, r.width * k), height: Math.max(2, r.height * k) });
  const ins = { top: (info.workArea.y - info.bounds.y) * k, left: (info.workArea.x - info.bounds.x) * k, right: (info.bounds.x + info.bounds.width - info.workArea.x - info.workArea.width) * k, bottom: (info.bounds.y + info.bounds.height - info.workArea.y - info.workArea.height) * k };
  const c = p.cutout;
  // The pill as it looks with something going on.
  const pillW = p.pill.width * k;
  const pillH = p.pill.height * k;
  const col = rel(p.collapsed);
  const side = p.edge === 'left' || p.edge === 'right';
  const pill = side
    ? { left: p.edge === 'left' ? col.left : col.left + col.width - pillW, top: col.top + col.height / 2 - pillH / 2, width: pillW, height: pillH }
    : { left: col.left + col.width / 2 - pillW / 2, top: col.top, width: pillW, height: pillH };
  return (
    <figure className={`scr ${wanted ? '' : 'off'}`}>
      <div className="scr-frame" style={{ width: W, height: H }}>
        {ins.top ? <div className="scr-bar top" style={{ height: ins.top }} /> : null}
        {ins.bottom ? <div className="scr-bar bottom" style={{ height: ins.bottom }} /> : null}
        {ins.left ? <div className="scr-bar left" style={{ width: ins.left }} /> : null}
        {ins.right ? <div className="scr-bar right" style={{ width: ins.right }} /> : null}
        {c.kind === 'notch' ? <div className="scr-notch" style={{ left: c.center * k - (c.width * k) / 2, width: c.width * k, height: c.height * k }} /> : null}
        {c.kind === 'camera' ? (
          <div className={`scr-cam ${c.edge}`} style={c.edge === 'top' || c.edge === 'bottom' ? { left: c.center * k - 3 } : { top: c.center * k - 3 }} title="Camera" />
        ) : null}
        {wanted ? <div className={`scr-island ${p.anchor}`} style={pill} /> : null}
      </div>
      <figcaption>
        <b>{d.label || (info.internal ? 'Built-in screen' : 'Screen')}</b>{d.primary ? ' · main' : ''} · {Math.round(info.bounds.width)}×{Math.round(info.bounds.height)}{info.rotation ? ` · turned ${info.rotation}°` : ''}{info.touch ? ' · touch' : ''}
        <div className="muted small">{c.kind === 'notch' ? `Notch found (${Math.round(c.width)}×${Math.round(c.height)} pt). ` : c.kind === 'camera' ? `Camera on the ${c.edge}. ` : ''}{wanted ? p.reason : 'No Island on this screen.'}</div>
      </figcaption>
    </figure>
  );
}

export function PlacementSettings({ isl, set }: { isl: IS; set: (patch: Partial<IS>) => void }) {
  const [prev, setPrev] = useState<IslandPlacementPreview | null>(null);
  useEffect(() => {
    void api.island.placementPreview?.().then(setPrev).catch(() => setPrev(null));
  }, [isl.edge, isl.displays, isl.size, isl.blendNotch, isl.cameraEdge, isl.followCamera, isl.offsetX, isl.offsetY]);
  const notchFound = prev?.displays.some((d) => d.placement.cutout.kind === 'notch');
  const off = isl.activitiesOff ?? [];

  return (
    <>
      {prev ? (
        <div className="scr-row">
          {prev.displays.map((d) => <ScreenPicture key={d.info.id} d={d} wanted={prev.wanted.includes(d.info.id)} />)}
        </div>
      ) : null}
      {prev?.platform === 'linux' && prev.wayland ? (
        <div className="card pad small" style={{ marginBottom: 10 }}>
          This desktop uses Wayland, which does not let apps keep a small window on top in a fixed place. {prev.xwayland ? 'Keeper runs through XWayland so the Island works as it should.' : 'Turn on “Use XWayland” below and restart Keeper so the Island can stay on top.'}
        </div>
      ) : null}
      <div className="card settings-section">
        <Row title="Position" desc="Top follows the notch or camera; on a tablet turned on its side the Island can follow the camera to that edge.">
          <div className="seg">{(['top', 'left', 'right'] as const).map((e) => <button key={e} className={isl.edge === e ? 'on' : ''} onClick={() => set({ edge: e })}>{e === 'top' ? 'Top' : e === 'left' ? 'Left edge' : 'Right edge'}</button>)}</div>
        </Row>
        <Row title="Screens">
          <div className="seg">
            {([['primary', 'Main'], ['builtin', 'Laptop’s own'], ['mouse', 'With the pointer'], ['all', 'All']] as const).map(([v, l]) => <button key={v} className={(isl.displays ?? 'primary') === v ? 'on' : ''} onClick={() => set({ displays: v })}>{l}</button>)}
          </div>
        </Row>
        <Row title="Size">
          <div className="seg">{(['compact', 'normal', 'large'] as const).map((v) => <button key={v} className={(isl.size ?? 'normal') === v ? 'on' : ''} onClick={() => set({ size: v })}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>
        </Row>
        <Row title="Grow out of the notch" desc={notchFound ? 'On this Mac the Island uses the notch’s own black, with what is going on to either side of it.' : 'For Macs with a notch. This screen has none.'}>
          <Toggle on={isl.blendNotch !== false} onChange={(v) => set({ blendNotch: v })} />
        </Row>
        <Row title="Camera" desc="Where the camera is. Automatic follows the screen when a tablet or 2-in-1 is turned.">
          <select className="input" value={isl.cameraEdge ?? 'auto'} onChange={(e) => set({ cameraEdge: e.target.value as IS['cameraEdge'] })}>
            <option value="auto">Automatic</option><option value="top">Top</option><option value="left">Left</option><option value="right">Right</option><option value="bottom">Bottom</option>
          </select>
        </Row>
        <Row title="Follow the camera when turned"><Toggle on={isl.followCamera !== false} onChange={(v) => set({ followCamera: v })} /></Row>
        <Row title="Camera dot" desc="On screens without a notch, a small dot in the middle of the pill, where the camera is."><Toggle on={!!isl.cameraDot} onChange={(v) => set({ cameraDot: v })} /></Row>
        <Row title="Nudge" desc={`${isl.offsetX ?? 0} across, ${isl.offsetY ?? 0} down (points)`}>
          <div className="row" style={{ gap: 8 }}>
            <input type="range" min={-300} max={300} step={2} value={isl.offsetX ?? 0} onChange={(e) => set({ offsetX: Number(e.target.value) })} aria-label="Across" />
            <input type="range" min={0} max={200} step={2} value={isl.offsetY ?? 0} onChange={(e) => set({ offsetY: Number(e.target.value) })} aria-label="Down" />
            <button className="btn sm" onClick={() => set({ offsetX: 0, offsetY: 0 })}>Reset</button>
          </div>
        </Row>
        <Row title="Open when the pointer rests on it" desc="Clicking, tapping or swiping down always opens it; press and hold for the card."><Toggle on={isl.hoverOpen !== false} onChange={(v) => set({ hoverOpen: v })} /></Row>
        <Row title="Camera and microphone dots" desc="Green while an app uses the camera, orange for the microphone (Windows and Linux; macOS shows its own)."><Toggle on={isl.privacyDots !== false} onChange={(v) => set({ privacyDots: v })} /></Row>
        {prev?.platform === 'linux' ? (
          <Row title="Use XWayland" desc="Wayland sessions only. Takes effect the next time Keeper starts."><Toggle on={isl.x11OnWayland !== false} onChange={(v) => set({ x11OnWayland: v })} /></Row>
        ) : null}
        <Row title="Buddy" desc="A little face that reacts: naps when you are away, perks up when something needs you."><Toggle on={isl.buddy} onChange={(v) => set({ buddy: v })} /></Row>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>Live activities</h2>
      <div className="card settings-section">
        <div className="small muted" style={{ marginBottom: 8 }}>The most important takes the Island; a second one shows as a bubble beside it; the rest wait their turn.</div>
        <div className="act-checks">
          {KIND_LABEL.map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={!off.includes(k)} onChange={(e) => set({ activitiesOff: e.target.checked ? off.filter((x) => x !== k) : [...off, k] })} /> {l}
            </label>
          ))}
        </div>
      </div>
    </>
  );
}
