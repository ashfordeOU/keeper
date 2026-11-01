// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The bigger Island tabs: shelves, clipboard, controls and the camera mirror.

import { ShareButton } from './tools/IslandTools';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { IslandSettings, IslandState, ShelfAction } from '../../core/api';
import type { ClipKind } from '../../core/island';
import { formatBytes, relativeTime } from '../../core/format';
import { SHELF_COLORS } from '../../core/shelves';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Thumb } from '../components/ui';
import { filterClips, KIND_ICON } from './ClipPicker';
import { usePeek } from '../preview/Peek';
import { QuickTiles } from './QuickTiles';
import { StageTile } from '../stage/StageTile';
import { RemoteTile } from '../screen/island-remote';

const say = (msg: string) => window.dispatchEvent(new CustomEvent('island-toast', { detail: msg }));
const fail = (e: unknown) => say(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

// ---------------------------------------------------------------- shelves

export function ShelfTab({ state, settings, reload }: { state: IslandState; settings?: IslandSettings; reload: () => void }) {
  const [over, setOver] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<'more' | 'closed' | null>(null);
  const active = state.shelves.find((s) => s.id === state.activeShelf) ?? state.shelves[0];
  const items = active?.items ?? state.shelf;
  const peek = usePeek();
  const paths = items.map((f) => f.path);

  const run = (a: ShelfAction, arg?: string) => {
    setMenu(null);
    void api.island.shelfAction(a, arg).then((r) => { say(r.message); reload(); }, fail);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const dropped = [...e.dataTransfer.files].map((f) => api.files.pathOf?.(f) ?? (f as File & { path?: string }).path).filter((p): p is string => !!p);
    // Calendar files go into the calendar; everything else onto the shelf.
    const ics = api.pim ? dropped.filter((p) => /\.(ics|ical|icalendar)$/i.test(p)) : [];
    const rest = dropped.filter((p) => !ics.includes(p));
    if (ics.length) void Promise.all(ics.map((p) => api.pim.importIcs(p).catch(() => 0))).then((n) => { const t = n.reduce((a, b) => a + b, 0); say(t ? `Added ${t} event${t === 1 ? '' : 's'} to your calendar` : 'No events in that calendar file'); });
    if (rest.length) void api.island.addToShelf(rest).then(reload);
  };

  return (
    <div className="shelf-wrap">
      <div className="shelf-bar">
        {state.shelves.map((s) => (
          renaming === s.id ? (
            <input key={s.id} className="input shelf-rename" autoFocus defaultValue={s.name}
              onBlur={(e) => { void api.island.renameShelf(s.id, e.target.value).then(reload); setRenaming(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
          ) : (
            <button key={s.id} className={`shelf-chip ${s.id === active?.id ? 'on' : ''}`} style={{ ['--c' as string]: s.color }}
              onClick={() => void api.island.selectShelf(s.id).then(reload)} onDoubleClick={() => setRenaming(s.id)} title="Double-click to rename">
              <i />{s.name}<span>{s.items.length}</span>{s.pinned ? <Icon name="pin" size={9} /> : null}
            </button>
          )
        ))}
        <button className="shelf-chip add" title="New shelf" aria-label="New shelf" onClick={() => void api.island.createShelf().then(reload)}><Icon name="plus" size={11} /></button>
        <span style={{ flex: 1 }} />
        {state.closedShelves.length ? <button className="btn sm" onClick={() => setMenu(menu === 'closed' ? null : 'closed')} title="Recently closed shelves" aria-label="Recently closed shelves"><Icon name="history" size={11} /></button> : null}
        {active ? <button aria-label="More options" title="More options" className="btn sm" onClick={() => setMenu(menu === 'more' ? null : 'more')}><Icon name="settings" size={11} /></button> : null}
      </div>

      {menu === 'closed' ? (
        <div className="shelf-pop">
          <div className="muted small">Recently closed</div>
          {state.closedShelves.map((c) => <button key={c.id} onClick={() => { setMenu(null); void api.island.reopenShelf(c.id).then(reload); }}><i style={{ background: c.color }} />{c.name} <span className="muted">· {c.count}</span></button>)}
        </div>
      ) : null}
      {menu === 'more' && active ? (
        <div className="shelf-pop">
          <button onClick={() => { setMenu(null); setRenaming(active.id); }}><Icon name="rename" size={11} /> Rename shelf</button>
          <button onClick={() => { setMenu(null); void api.island.pinShelf(active.id).then(reload); }}><Icon name="pin" size={11} /> {active.pinned ? 'Unpin from menu bar' : 'Pin to the menu bar'}</button>
          <div className="shelf-colors">{SHELF_COLORS.map((c) => <button key={c} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => void api.island.setShelfColor(active.id, c).then(reload)} />)}</div>
          <button onClick={() => { setMenu(null); void api.island.closeShelf(active.id).then(reload); }}><Icon name="close" size={11} /> Close shelf</button>
        </div>
      ) : null}

      <div className={`shelf-drop ${over ? 'over' : ''}`} style={{ ['--c' as string]: active?.color }} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        {items.length === 0 ? <div className="muted" style={{ margin: 'auto', textAlign: 'center' }}><Icon name="archive" size={24} /><div>Drop files here to keep them handy,<br />then drag them out wherever you need them.</div></div> : null}
        {items.map((f, i) => (
          <div key={f.path} className="shelf-item" {...peek.bind(f.path)} draggable onDragStart={(e) => { e.preventDefault(); api.files.startDrag([f.path]); }} onDoubleClick={() => void api.files.open(f.path)} title={`${f.path}\n${formatBytes(f.size)}`}>
            <div className="th"><Thumb file={f} size={128} /></div>
            <div className="nm" onDoubleClick={(e) => {
              e.stopPropagation();
              const name = window.prompt?.('Rename to', f.name);
              if (name && name !== f.name) void api.island.renameShelfItem(f.path, name).then(reload, fail);
            }}>{f.name}</div>
            <div className="mv">
              {i > 0 ? <button title="Move left" aria-label="Move left" onClick={() => void api.island.moveShelfItem(i, i - 1).then(reload)}><Icon name="chevronLeft" size={10} /></button> : <span />}
              {i < items.length - 1 ? <button title="Move right" aria-label="Move right" onClick={() => void api.island.moveShelfItem(i, i + 1).then(reload)}><Icon name="chevronRight" size={10} /></button> : <span />}
            </div>
            <button aria-label="Remove from shelf" title="Remove from shelf" className="btn sm icon x" onClick={() => void api.island.removeFromShelf(f.path).then(reload)}><Icon name="close" size={10} /></button>
          </div>
        ))}
      </div>
      {peek.node}

      {items.length ? (
        <div className="shelf-actions">
          <button className="btn sm" draggable onDragStart={(e) => { e.preventDefault(); api.files.startDrag(paths); }} title="Drag everything out at once"><Icon name="drag" size={12} /> Drag all</button>
          <button className="btn sm" onClick={() => run('zip')}><Icon name="zip" size={12} /> Zip</button>
          <button className="btn sm" onClick={() => run('copyText')} title="Copy the text in these images and documents"><Icon name="text" size={12} /> Text</button>
          <button className="btn sm" onClick={() => run('copyPaths')}><Icon name="copy" size={12} /> Copy</button>
          <ShareButton paths={paths} />
          <button className="btn sm" onClick={() => run('moveTo')}><Icon name="folder" size={12} /> Move to…</button>
          {items.some((f) => f.kind === 'image') ? <button className="btn sm" onClick={() => run('resize', '1600')} title="Make smaller copies (1600 px)"><Icon name="image" size={12} /> Resize</button> : null}
          {settings?.upload.kind && settings.upload.kind !== 'none' ? <button className="btn sm" onClick={() => run('upload')} title="Upload to your own storage and copy a link"><Icon name="send" size={12} /> Share link</button> : null}
          {(settings?.scriptActions ?? []).map((a) => <button key={a.id} className="btn sm" onClick={() => run('script', a.id)} title={a.command}><Icon name="terminal" size={12} /> {a.name}</button>)}
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => void api.island.clearShelf().then(reload)}>Clear</button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- clipboard

const KINDS: { id: ClipKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'text', label: 'Text' }, { id: 'link', label: 'Links' }, { id: 'code', label: 'Code' },
  { id: 'color', label: 'Colours' }, { id: 'image', label: 'Images' }, { id: 'file', label: 'Files' },
];

export function ClipboardTab({ state, reload }: { state: IslandState; reload: () => void }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ClipKind | 'all'>('all');
  const [coll, setColl] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const collections = useMemo(() => [...new Set(state.clips.flatMap((c) => c.collections ?? []))].sort(), [state.clips]);
  const items = filterClips(state.clips, q, kind, coll || undefined);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input className="input" style={{ flex: 1, height: 28 }} placeholder="Search text, notes, apps, words in images" value={q} onChange={(e) => setQ(e.target.value)} />
        {collections.length ? <select className="input" style={{ height: 28 }} value={coll} onChange={(e) => setColl(e.target.value)}><option value="">All lists</option>{collections.map((c) => <option key={c}>{c}</option>)}</select> : null}
        <button className="btn sm" title="Open the clipboard picker" aria-label="Open the clipboard picker" onClick={() => void api.island.openClips()}><Icon name="external" size={11} /></button>
        <button className="btn sm" title="Back up history" aria-label="Back up history" onClick={() => void api.island.exportClips().then((p) => p && say('Saved a backup'))}><Icon name="down" size={11} /></button>
        <button className="btn sm" title="Restore a backup" aria-label="Restore a backup" onClick={() => void api.island.importClips().then((n) => { say(`Added ${n} item${n === 1 ? '' : 's'}`); reload(); }, fail)}><Icon name="arrowUp" size={11} /></button>
        <button className="btn sm" onClick={() => void api.island.clearClips().then(reload)} title="Clear (keeps pinned and listed items)">Clear</button>
      </div>
      <div className="clip-kinds">{KINDS.map((k) => <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}>{k.label}</button>)}</div>
      {items.length === 0 ? <div className="muted" style={{ textAlign: 'center', padding: 20 }}>{state.clips.length ? 'Nothing matches.' : 'Things you copy will appear here.'}</div> : null}
      {items.map((c) => (
        <div key={c.id}>
          <div className="clip" onClick={(e) => (e.altKey ? void api.island.removeClip(c.id).then(reload) : void api.island.copyClip(c.id).then(() => say('Copied')))} title="Click to copy · Option/Alt-click to delete">
            {c.pinned ? <Icon name="pin" size={12} /> : null}
            {c.kind === 'color' && c.text ? <span className="swatch" style={{ background: c.text }} /> : c.image ? <img src={c.image} alt="" style={{ height: 28, borderRadius: 4 }} /> : <Icon name={KIND_ICON[c.kind] ?? 'text'} size={12} />}
            <span className="t">
              {c.kind === 'code' ? <code className="code">{c.text}</code> : c.kind === 'link' && c.title ? <>{c.title} <span className="muted">{c.text}</span></> : c.text ?? 'Image'}
              <span className="muted small" style={{ display: 'block' }}>{[c.source, relativeTime(c.at), c.note, ...(c.collections ?? [])].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="acts">
              <button className="btn sm icon" title="Paste into the app in front" aria-label="Paste into the app in front" onClick={(e) => { e.stopPropagation(); void api.island.pasteClip(c.id); }}><Icon name="send" size={11} /></button>
              <button className="btn sm icon" title="Note and lists" aria-label="Note and lists" onClick={(e) => { e.stopPropagation(); setOpen(open === c.id ? null : c.id); }}><Icon name="tag" size={11} /></button>
              <button className="btn sm icon" title={c.pinned ? 'Unpin' : 'Pin'} aria-label={c.pinned ? 'Unpin' : 'Pin'} onClick={(e) => { e.stopPropagation(); void api.island.pinClip(c.id).then(reload); }}><Icon name="pin" size={11} /></button>
              <button className="btn sm icon" title="Remove" aria-label="Remove" onClick={(e) => { e.stopPropagation(); void api.island.removeClip(c.id).then(reload); }}><Icon name="close" size={11} /></button>
            </span>
          </div>
          {open === c.id ? (
            <div className="clip-edit">
              <textarea className="input" rows={2} placeholder="Add a note" defaultValue={c.note ?? ''} onBlur={(e) => void api.island.updateClip(c.id, { note: e.target.value }).then(reload)} />
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {collections.map((n) => <button key={n} className={`btn sm ${c.collections?.includes(n) ? 'primary' : ''}`} onClick={() => void api.island.toggleClipCollection(c.id, n).then(reload)}>{n}</button>)}
                <input className="input" style={{ height: 26, width: 120 }} placeholder="New list…" onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (e.key === 'Enter' && v) { void api.island.toggleClipCollection(c.id, v).then(reload); (e.target as HTMLInputElement).value = ''; } }} />
              </div>
              {c.ocr ? <div className="muted small" style={{ whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'auto' }}>Text in image: {c.ocr}</div> : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- controls

export function ControlsTab({ state, reload }: { state: IslandState; reload: () => void }) {
  const d = state.devices;
  const [busy, setBusy] = useState(!d);
  useEffect(() => {
    void api.island.refreshDevices().then(() => { setBusy(false); reload(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const slide = useRef(new Map<string, number>());
  const later = (key: string, fn: () => void) => {
    window.clearTimeout(slide.current.get(key));
    slide.current.set(key, window.setTimeout(fn, 180));
  };
  return (
    <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="tile">
          <div className="ctl-head"><Icon name="audio" size={13} /> Sound
            <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => void api.island.setMuted(!d?.muted).then(reload)}>{d?.muted ? 'Unmute' : 'Mute'}</button></div>
          {d?.volume !== undefined ? <input className="ctl-range" type="range" min={0} max={100} defaultValue={d.volume} key={`v${d.volume}`} onChange={(e) => { const v = Number(e.target.value); later('vol', () => void api.island.setVolume(v)); }} /> : <div className="muted small">{busy ? 'Checking…' : 'Volume control is not available here'}</div>}
        </div>
        <div className="tile" style={{ flex: 1, overflow: 'auto' }}>
          <div className="ctl-head"><Icon name="sun" size={13} /> Displays</div>
          {d?.monitors.length ? d.monitors.map((m) => (
            <div key={m.id} style={{ marginBottom: 6 }}>
              <div className="small">{m.name}{m.external ? <span className="muted"> · external</span> : null}</div>
              <input className="ctl-range" type="range" min={0} max={100} defaultValue={m.brightness ?? 50} key={`${m.id}${m.brightness}`} onChange={(e) => { const v = Number(e.target.value); later(m.id, () => void api.island.setBrightness(m.id, v)); }} />
            </div>
          )) : <div className="muted small">{busy ? 'Checking…' : 'No adjustable displays found.'}</div>}
          {d?.ddc && !d.monitors.some((m) => m.external) ? <div className="muted small">{d.ddc}</div> : null}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="tile">
          <div className="ctl-head"><Icon name="battery" size={13} /> Batteries</div>
          {state.battery ? <div className="ctl-dev"><span>This computer{state.battery.charging ? ' (charging)' : ''}</span><b>{Math.round(state.battery.percent)}%</b></div> : null}
          {d?.bluetooth.map((b) => <div key={b.name} className="ctl-dev"><span className="ellipsis">{b.name}</span><b style={{ color: b.percent <= 20 ? '#f87171' : undefined }}>{b.percent}%</b></div>)}
          {!state.battery && !d?.bluetooth.length ? <div className="muted small">{busy ? 'Checking…' : 'No batteries reported.'}</div> : null}
        </div>
        {state.awakeAvailable === false ? null : <div className="tile">
          <div className="ctl-head"><Icon name="coffee" size={13} /> Keep awake
            <button className={`btn sm ${state.keepAwake.on ? 'primary' : ''}`} style={{ marginLeft: 'auto' }} onClick={() => void api.island.keepAwake(!state.keepAwake.on).then(reload)}>{state.keepAwake.on ? 'On' : 'Off'}</button></div>
          <div className="muted small">{state.keepAwake.on ? state.keepAwake.reason ?? 'Until you turn it off' : state.awakeTriggers?.length ? state.awakeTriggers.join(' · ') : 'Triggers can be set on the Keep Awake page.'}</div>
        </div>}
        <StageTile />
        <QuickTiles />
        <RemoteTile />
        <button className="btn sm" onClick={() => void api.island.hide(true)}><Icon name="eye" size={12} /> Hide the Island (shortcut brings it back)</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- camera mirror

export function CameraTab() {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({ video: { width: 640, height: 360 }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError('No camera, or permission was not given.'));
    // The camera is switched off as soon as the tab closes.
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);
  return (
    <div className="cam">
      {error ? <div className="muted">{error}</div> : <video ref={video} autoPlay playsInline muted />}
    </div>
  );
}
