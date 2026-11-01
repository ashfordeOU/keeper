// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Desktop widgets: add, style and arrange small windows that live on the desktop.

import { useEffect, useRef, useState } from 'react';
import { WIDGET_KINDS, newWidget, type WidgetConfig, type WidgetKind } from '../../core/widgets';
import { api, isDemo } from '../api';
import { Icon } from '../components/Icon';
import { Empty, PageHead, Toggle } from '../components/ui';
import { WidgetBody, widgetSurface } from '../island/Widget';
import { useStore } from '../state';
import '../styles/widgets.css';

const KIND_ICON: Record<WidgetKind, string> = {
  clock: 'clock', date: 'calendar', events: 'calendar', weather: 'sun', countdown: 'timer', 'sun-moon': 'moon', photo: 'image',
  text: 'text', battery: 'battery', disk: 'weight', system: 'bolt', focus: 'timer', clipboard: 'clipboard',
};

const ZONES = ['America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Africa/Lagos', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];

function Preview({ w }: { w: WidgetConfig }) {
  // Scaled to fit the card while keeping the widget's real proportions.
  const scale = Math.min(1, 300 / w.bounds.width, 220 / w.bounds.height);
  return (
    <div className="wgp-stage">
      <div style={{ width: w.bounds.width * scale, height: w.bounds.height * scale }}>
        <div className="wg locked" style={{ ...widgetSurface(w), width: w.bounds.width, height: w.bounds.height, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
          <WidgetBody w={w} />
        </div>
      </div>
    </div>
  );
}

function Editor({ w, onChange, onRemove }: { w: WidgetConfig; onChange: (w: WidgetConfig) => void; onRemove: () => void }) {
  const st = w.style;
  const set = (patch: Partial<WidgetConfig['style']>) => onChange({ ...w, style: { ...st, ...patch } });
  const opt = (patch: Partial<WidgetConfig['options']>) => onChange({ ...w, options: { ...w.options, ...patch } });
  const row = (label: string, el: React.ReactNode) => <label className="wge-row"><span>{label}</span>{el}</label>;
  return (
    <div className="wge">
      {w.kind === 'clock' ? (
        <>
          {row('Analog', <Toggle on={!!w.options.analog} onChange={(v) => opt({ analog: v })} />)}
          {row('Seconds', <Toggle on={!!w.options.seconds} onChange={(v) => opt({ seconds: v })} />)}
          {row('Other time zones', (
            <select className="input" multiple value={w.options.timeZones ?? []} style={{ height: 76 }} onChange={(e) => opt({ timeZones: [...e.target.selectedOptions].map((o) => o.value).slice(0, 3) })}>
              {ZONES.map((z) => <option key={z} value={z}>{z.split('/').pop()!.replace(/_/g, ' ')}</option>)}
            </select>
          ))}
        </>
      ) : null}
      {w.kind === 'countdown' ? (
        <>
          {row('Title', <input className="input" value={w.options.title ?? ''} onChange={(e) => opt({ title: e.target.value })} />)}
          {row('Date', <input className="input" type="datetime-local" value={w.options.target ? new Date(w.options.target - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ''} onChange={(e) => opt({ target: new Date(e.target.value).getTime() })} />)}
        </>
      ) : null}
      {w.kind === 'text' ? row('Text', <textarea className="input" rows={3} value={w.options.text ?? ''} onChange={(e) => opt({ text: e.target.value })} />) : null}
      {w.kind === 'photo' ? (
        <>
          {row('Folder', <button className="btn sm" onClick={() => void api.settings.pickFolder().then((f) => f && opt({ folder: f }))}>{w.options.folder ? w.options.folder.split(/[\\/]/).pop() : 'Choose…'}</button>)}
          {row('Change every', <select className="input" value={w.options.interval ?? 30} onChange={(e) => opt({ interval: Number(e.target.value) })}>{[10, 30, 60, 300, 900].map((s) => <option key={s} value={s}>{s < 60 ? `${s} seconds` : `${s / 60} minute${s === 60 ? '' : 's'}`}</option>)}</select>)}
        </>
      ) : null}
      <div className="divider" />
      {row('Font', <div className="seg">{(['system', 'rounded', 'serif', 'mono'] as const).map((f) => <button key={f} className={st.font === f ? 'on' : ''} onClick={() => set({ font: f })}>{f[0].toUpperCase() + f.slice(1)}</button>)}</div>)}
      {row('Text size', <input type="range" min={0.7} max={1.8} step={0.05} value={st.size} onChange={(e) => set({ size: Number(e.target.value) })} />)}
      {row('Text colour', <input type="color" value={st.color} onChange={(e) => set({ color: e.target.value })} />)}
      {row('Background', <div className="seg">{(['glass', 'solid', 'gradient', 'none'] as const).map((b) => <button key={b} className={st.background === b ? 'on' : ''} onClick={() => set({ background: b })}>{b[0].toUpperCase() + b.slice(1)}</button>)}</div>)}
      {st.background === 'solid' || st.background === 'gradient' ? row('Colours', <span className="row"><input type="color" value={st.bgColor} onChange={(e) => set({ bgColor: e.target.value })} />{st.background === 'gradient' ? <input type="color" value={st.bgColor2} onChange={(e) => set({ bgColor2: e.target.value })} /> : null}</span>) : null}
      {row('Corners', <input type="range" min={0} max={48} value={st.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />)}
      {row('Opacity', <input type="range" min={0.3} max={1} step={0.02} value={st.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />)}
      <div className="divider" />
      {row('Size', <span className="row small"><input className="input" style={{ width: 70 }} type="number" min={120} max={900} value={w.bounds.width} onChange={(e) => onChange({ ...w, bounds: { ...w.bounds, width: Number(e.target.value) || w.bounds.width } })} />×<input className="input" style={{ width: 70 }} type="number" min={90} max={900} value={w.bounds.height} onChange={(e) => onChange({ ...w, bounds: { ...w.bounds, height: Number(e.target.value) || w.bounds.height } })} /></span>)}
      {row('Lock position', <Toggle on={w.locked} onChange={(v) => onChange({ ...w, locked: v })} />)}
      {row('Show on every desktop', <Toggle on={w.allWorkspaces} onChange={(v) => onChange({ ...w, allWorkspaces: v })} />)}
      <button className="btn danger sm" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={onRemove}><Icon name="trash" size={12} /> Remove widget</button>
    </div>
  );
}

export function Widgets() {
  const { toast } = useStore();
  const [list, setList] = useState<WidgetConfig[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const load = () => void api.widgets.list().then(setList);
    load();
    return api.on('widgets-changed', load);
  }, []);

  const add = async (kind: WidgetKind) => {
    const n = list?.length ?? 0;
    const w = newWidget(kind, { x: 60 + (n % 5) * 40, y: 120 + (n % 5) * 40 });
    setList(await api.widgets.save(w));
    setOpen(w.id);
    toast(isDemo ? 'Widget added (shown on your desktop in the app)' : 'Widget added to your desktop — drag it where you like');
  };

  // Changes show at once; saving waits for a pause in typing or dragging sliders.
  const change = (w: WidgetConfig) => {
    setList((l) => l?.map((x) => (x.id === w.id ? w : x)) ?? null);
    window.clearTimeout(timers.current.get(w.id));
    timers.current.set(w.id, window.setTimeout(() => void api.widgets.save(w), 300));
  };

  return (
    <div>
      <PageHead title="Widgets" sub="Small live windows for your desktop. Drag them anywhere; style each one your way." />
      <div className="section-head"><h2>Add a widget</h2></div>
      <div className="grid cols-auto">
        {WIDGET_KINDS.map((k) => (
          <button key={k.kind} className="card pad hover wg-add" onClick={() => void add(k.kind)}>
            <span className="wg-add-icon"><Icon name={KIND_ICON[k.kind]} size={18} /></span>
            <span><b>{k.name}</b><span className="muted small" style={{ display: 'block' }}>{k.description}</span></span>
            <Icon name="plus" size={14} />
          </button>
        ))}
      </div>

      <div className="section">
        <div className="section-head"><h2>On your desktop</h2><span className="muted small">{list?.length ?? 0} widget{list?.length === 1 ? '' : 's'}</span></div>
        {list && !list.length ? <Empty icon="grid" title="No widgets yet">Pick one above and it appears on your desktop.</Empty> : null}
        <div className="wgp-grid">
          {list?.map((w) => {
            const meta = WIDGET_KINDS.find((k) => k.kind === w.kind)!;
            return (
              <div key={w.id} className="card wgp">
                <Preview w={w} />
                <div className="row" style={{ padding: '10px 14px' }}>
                  <Icon name={KIND_ICON[w.kind]} size={14} />
                  <b className="grow">{meta.name}{w.kind === 'countdown' && w.options.title ? ` · ${w.options.title}` : ''}</b>
                  {w.locked ? <span className="badge"><Icon name="lock" size={10} /> Locked</span> : null}
                  <button className="btn sm" onClick={() => setOpen(open === w.id ? null : w.id)}>{open === w.id ? 'Done' : 'Edit'}</button>
                </div>
                {open === w.id ? <Editor w={w} onChange={change} onRemove={() => void api.widgets.remove(w.id).then((l) => { setList(l); setOpen(null); })} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
