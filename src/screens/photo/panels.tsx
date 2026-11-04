// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The photo editor's inspector panels, one per tab: Adjust (looks, light,
// colour, detail, effects, colour mix, tone curve), Crop (shape, straighten,
// perspective), Background (cut out, edge, new background), Retouch, Add,
// Hide, Canvas (size, more canvas) and History. Each shows the essentials;
// the rest folds away.

import { useEffect, useState } from 'react';
import type { PhotoInfo } from '../../../core/api-photo';
import { CUTOUT_MODELS, modelSize } from '../../../core/cutout-models';
import { ASPECTS, BANDS, defaultBackground, lockedSize, type AdjustKey, type Background, type Band, type Overlay, type PhotoRecipe, type RedactKind, type RetouchKind } from '../../../core/photo-edit';
import { isLookApplied, LOOKS, applyLook, type Look } from '../../../core/photo-presets';
import type { Progress } from '../../../core/types';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { Toggle } from '../../components/ui';
import { useStore } from '../../state';
import { Curve, Fold, Slider, Swatches } from './parts';

export interface PanelProps {
  path: string;
  info: PhotoInfo;
  recipe: PhotoRecipe;
  /** a live change while a slider moves (not yet in the history) */
  set: (r: PhotoRecipe) => void;
  /** a finished change, into the history */
  commit: (r: PhotoRecipe) => void;
}

const err = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

function Sliders({ keys, p }: { keys: { key: AdjustKey; label: string; min?: number; help?: string }[]; p: PanelProps }) {
  return <>{keys.map((s) => <Slider key={s.key} label={s.label} min={s.min ?? -100} help={s.help} value={p.recipe[s.key]} onChange={(v) => p.set({ ...p.recipe, [s.key]: v, look: undefined })} onCommit={(v) => p.commit({ ...p.recipe, [s.key]: v, look: undefined })} testid={`ph-${s.key}`} />)}</>;
}

// ---------------------------------------------------------------- Adjust

export function AdjustPanel(p: PanelProps & { picking: boolean; setPicking: (v: boolean) => void }) {
  const { toast } = useStore();
  const [own, setOwn] = useState<Look[]>([]);
  const [naming, setNaming] = useState<string | null>(null);
  const [band, setBand] = useState<Band>('orange');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.photo.looks().then(setOwn).catch(() => undefined); }, []);
  const r = p.recipe;
  const hsl = r.hsl[band] ?? [0, 0, 0];
  const setHsl = (i: number, v: number, done: boolean) => {
    const t = [...hsl] as [number, number, number];
    t[i] = v;
    const next = { ...r, hsl: { ...r.hsl, [band]: t }, look: undefined };
    if (done) p.commit(next); else p.set(next);
  };
  const auto = async () => {
    setBusy(true);
    try { p.commit({ ...r, ...(await api.photo.auto(p.path, r)), look: undefined }); } catch (e) { toast(err(e)); } finally { setBusy(false); }
  };
  const has = (keys: AdjustKey[]) => keys.some((k) => r[k]);
  return (
    <div className="insp" data-testid="ph-panel-adjust">
      <div className="ph-quick">
        <button className="btn sm" disabled={busy} onClick={() => void auto()} data-testid="ph-auto"><Icon name="sparkle" size={13} /> {busy ? 'Working…' : 'Auto'}</button>
        <button className="btn sm ghost" aria-pressed={p.picking} onClick={() => p.setPicking(!p.picking)} title="Click something that should be white or grey" data-testid="ph-wb-pick"><Icon name="drop" size={13} /> White balance</button>
      </div>
      {p.picking ? <p className="insp-help" role="status">Click something white or grey in the picture.</p> : null}
      <div className="insp-sec">
        <h3 className="insp-title">Looks</h3>
        <div className="ph-looks" role="list" aria-label="Looks">
          {[...LOOKS, ...own].map((l) => (
            <div key={l.id} role="listitem" className="ph-look-wrap">
              <button className={`ph-look${isLookApplied(r, l) ? ' on' : ''}`} title={l.line ?? 'Your own look'} aria-pressed={isLookApplied(r, l)} onClick={() => p.commit(applyLook(r, l))} data-testid={`ph-look-${l.id}`}>{l.name}</button>
              {l.own ? <button className="btn ghost sm icon ph-look-x" aria-label={`Delete ${l.name}`} title="Delete this look" onClick={() => void api.photo.deleteLook(l.id).then(setOwn)}><Icon name="close" size={10} /></button> : null}
            </div>
          ))}
        </div>
        {naming === null ? (
          <button className="btn sm ph-link" onClick={() => setNaming('')} data-testid="ph-look-save">Save as a look…</button>
        ) : (
          <form className="ph-inline" onSubmit={(e) => { e.preventDefault(); void api.photo.saveLook(naming, r).then((l) => { setOwn(l); setNaming(null); toast('Look saved'); }); }}>
            <input className="input" autoFocus placeholder="Name" aria-label="Name of the look" value={naming} onChange={(e) => setNaming(e.target.value)} data-testid="ph-look-name" />
            <button className="btn sm" type="submit" disabled={!naming.trim()}>Save</button>
            <button className="btn sm ghost" type="button" onClick={() => setNaming(null)}>Cancel</button>
          </form>
        )}
      </div>
      <div className="insp-sec">
        <h3 className="insp-title">Light</h3>
        <Sliders p={p} keys={[{ key: 'exposure', label: 'Light' }, { key: 'contrast', label: 'Contrast' }, { key: 'highlights', label: 'Highlights' }, { key: 'shadows', label: 'Shadows' }, { key: 'whites', label: 'Whites' }, { key: 'blacks', label: 'Blacks' }]} />
      </div>
      <div className="insp-sec">
        <h3 className="insp-title">Colour</h3>
        <Sliders p={p} keys={[{ key: 'temperature', label: 'Warmth' }, { key: 'tint', label: 'Tint' }, { key: 'saturation', label: 'Colour' }, { key: 'vibrance', label: 'Vibrance', help: 'Lifts muted colours more than strong ones' }]} />
      </div>
      <Fold title="Detail" open={has(['clarity', 'sharpen', 'noise'])} testid="ph-fold-detail">
        <Sliders p={p} keys={[{ key: 'clarity', label: 'Clarity' }, { key: 'sharpen', label: 'Sharpen', min: 0 }, { key: 'noise', label: 'Less noise', min: 0 }]} />
      </Fold>
      <Fold title="Effects" open={has(['vignette', 'grain'])}>
        <Sliders p={p} keys={[{ key: 'vignette', label: 'Vignette' }, { key: 'grain', label: 'Grain', min: 0 }]} />
      </Fold>
      <Fold title="Colour mix" open={Object.keys(r.hsl).length > 0} testid="ph-fold-mix">
        <div className="ph-bands" role="radiogroup" aria-label="Colour">
          {BANDS.map((b) => <button key={b.id} role="radio" aria-checked={band === b.id} className={`ph-band${band === b.id ? ' on' : ''}${r.hsl[b.id] ? ' changed' : ''}`} style={{ background: b.swatch }} title={b.label} aria-label={b.label} onClick={() => setBand(b.id)} />)}
        </div>
        {(['Hue', 'Saturation', 'Lightness'] as const).map((label, i) => <Slider key={label} label={label} value={hsl[i]} onChange={(v) => setHsl(i, v, false)} onCommit={(v) => setHsl(i, v, true)} testid={`ph-hsl-${i}`} />)}
      </Fold>
      <Fold title="Tone curve" open={r.curve.length > 0}>
        <Curve value={r.curve} onCommit={(c) => p.commit({ ...r, curve: c, look: undefined })} />
        {r.curve.length ? <button className="btn sm ph-link" onClick={() => p.commit({ ...r, curve: [] })}>Straighten the curve</button> : null}
      </Fold>
    </div>
  );
}

// ---------------------------------------------------------------- Crop

export function CropPanel(p: PanelProps & { aspect: string; setAspect: (a: string) => void; view: { width: number; height: number } | null }) {
  const r = p.recipe;
  return (
    <div className="insp" data-testid="ph-panel-crop">
      <div className="insp-sec">
        <h3 className="insp-title">Shape</h3>
        <div className="xchecks" role="radiogroup" aria-label="Crop shape">
          {ASPECTS.map((a) => (
            <button key={a.id} role="radio" className="xcheck" aria-checked={p.aspect === a.id} data-testid={`ph-aspect-${a.id}`}
              onClick={() => { p.setAspect(a.id); if (a.ratio && p.view) { const w = p.view.width, h = p.view.height; const cw = Math.min(w, h * a.ratio); const ch = cw / a.ratio; p.commit({ ...r, crop: { x: (w - cw) / 2 / w, y: (h - ch) / 2 / h, w: cw / w, h: ch / h }, redact: [], retouch: [], strokes: [] }); } }}>{a.label}</button>
          ))}
        </div>
        <p className="insp-help">Drag on the picture to choose what to keep.</p>
      </div>
      <div className="insp-sec">
        <h3 className="insp-title">Straighten</h3>
        <Slider label="Angle" min={-45} max={45} step={0.5} unit="°" value={r.straighten} onChange={(v) => p.set({ ...r, straighten: v })} onCommit={(v) => p.commit({ ...r, straighten: v, crop: undefined, redact: [] })} testid="ph-straighten" />
      </div>
      <Fold title="Perspective" open={!!(r.perspectiveV || r.perspectiveH)} testid="ph-fold-perspective">
        <Slider label="Up and down" value={r.perspectiveV} onChange={(v) => p.set({ ...r, perspectiveV: v })} onCommit={(v) => p.commit({ ...r, perspectiveV: v })} testid="ph-persp-v" help="Buildings leaning back: pull in the top" />
        <Slider label="Side to side" value={r.perspectiveH} onChange={(v) => p.set({ ...r, perspectiveH: v })} onCommit={(v) => p.commit({ ...r, perspectiveH: v })} testid="ph-persp-h" />
      </Fold>
      <div className="ph-quick"><button className="btn sm ghost" disabled={!r.crop && !r.straighten && !r.perspectiveV && !r.perspectiveH} onClick={() => p.commit({ ...r, crop: undefined, straighten: 0, perspectiveV: 0, perspectiveH: 0 })}>Reset crop</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- Background

export type BrushMode = 'off' | 'keep' | 'remove';

export function BackgroundPanel(p: PanelProps & { brush: BrushMode; setBrush: (b: BrushMode) => void; brushSize: number; setBrushSize: (n: number) => void; comparing: boolean; setComparing: (v: boolean) => void; refreshInfo: () => void }) {
  const { toast } = useStore();
  const r = p.recipe;
  const [dl, setDl] = useState<Progress | null>(null);
  useEffect(() => api.on('progress', (x: Progress) => { if (x.task === 'photo-model') setDl(x.phase === 'Done' ? null : x); }), []);
  const bg = r.background;
  const setBg = (b: Partial<Background>, done = true) => { const next = { ...r, background: { ...bg, ...b } }; if (done) p.commit(next); else p.set(next); };
  const best = CUTOUT_MODELS.best;
  const download = async () => {
    setDl({ task: 'photo-model', phase: 'Starting', done: 0, total: 1000 });
    try { await api.photo.downloadModel('best'); p.refreshInfo(); toast('The best cut-out model is ready'); } catch (e) { toast(err(e)); } finally { setDl(null); }
  };
  const pickPicture = async () => {
    const [f] = await api.settings.pickFiles({ title: 'Choose a background picture', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif', 'tif', 'tiff', 'gif', 'bmp'] });
    if (f) setBg({ kind: 'picture', picture: f });
  };
  if (p.info.cutout === 'off') return <div className="insp" data-testid="ph-panel-background"><p className="insp-help">Removing the background needs Convert, which is switched off in Settings → Features.</p></div>;
  return (
    <div className="insp" data-testid="ph-panel-background">
      <div className="insp-sec">
        <label className="mo-inline ph-toggle">
          <Toggle on={r.cutout} onChange={(v) => p.commit({ ...r, cutout: v })} label="Remove the background" />
          Remove the background
        </label>
        <p className="insp-help">{p.info.cutout === 'download' ? 'Runs on this computer; the first time, Keeper downloads the part it needs.' : 'Runs on this computer. Nothing is uploaded.'}</p>
        <div className="seg" role="radiogroup" aria-label="Quality">
          {(['fast', 'best'] as const).map((q) => <button key={q} role="radio" aria-checked={r.cutoutQuality === q && (q === 'fast' || p.info.models.best)} className={r.cutoutQuality === q && (q === 'fast' || p.info.models.best) ? 'on' : ''} disabled={q === 'best' && !p.info.models.best} onClick={() => p.commit({ ...r, cutoutQuality: q })} data-testid={`ph-quality-${q}`}>{CUTOUT_MODELS[q].name}</button>)}
        </div>
        {!p.info.models.best ? (
          dl ? (
            <div className="ph-dl" role="status"><span className="small muted">{dl.phase}</span><span className="progress" role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((dl.done / Math.max(1, dl.total)) * 100)}><i style={{ width: `${(dl.done / Math.max(1, dl.total)) * 100}%` }} /></span></div>
          ) : (
            <p className="insp-help">{best.line} <button className="btn sm ph-link" onClick={() => void download()} data-testid="ph-model-download">Download ({modelSize(best)})</button></p>
          )
        ) : (
          <p className="insp-help">{best.line} <button className="btn sm ph-link" onClick={() => void api.photo.removeModel('best').then(p.refreshInfo)}>Remove the download</button></p>
        )}
      </div>
      {r.cutout ? (
        <>
          <div className="insp-sec">
            <h3 className="insp-title">New background</h3>
            <div className="xchecks" role="radiogroup" aria-label="Background">
              {([['clear', 'See-through'], ['colour', 'Colour'], ['gradient', 'Gradient'], ['blur', 'Blur'], ['picture', 'Picture']] as const).map(([k, label]) => (
                <button key={k} role="radio" className="xcheck" aria-checked={bg.kind === k} onClick={() => (k === 'picture' && !bg.picture ? void pickPicture() : setBg({ kind: k }))} data-testid={`ph-bg-${k}`}>{label}</button>
              ))}
            </div>
            {bg.kind === 'colour' ? <Swatches label="Background colour" value={bg.colour} onPick={(c) => setBg({ colour: c })} /> : null}
            {bg.kind === 'gradient' ? (
              <>
                <Swatches label="First colour" value={bg.colour} onPick={(c) => setBg({ colour: c })} />
                <Swatches label="Second colour" value={bg.colour2} onPick={(c) => setBg({ colour2: c })} />
                <Slider label="Direction" min={0} max={359} unit="°" value={bg.angle} onChange={(v) => setBg({ angle: v }, false)} onCommit={(v) => setBg({ angle: v })} />
              </>
            ) : null}
            {bg.kind === 'blur' ? <Slider label="Blur" min={0} max={100} value={bg.blur} onChange={(v) => setBg({ blur: v }, false)} onCommit={(v) => setBg({ blur: v })} testid="ph-bg-blur-amount" /> : null}
            {bg.kind === 'picture' ? <p className="insp-help">{bg.picture?.split(/[\\/]/).pop()} · fills the background <button className="btn sm ph-link" onClick={() => void pickPicture()}>Choose another…</button></p> : null}
            {bg.kind !== 'clear' ? <Slider label="Shadow" min={0} max={100} value={bg.shadow} onChange={(v) => setBg({ shadow: v }, false)} onCommit={(v) => setBg({ shadow: v })} testid="ph-bg-shadow" help="A soft shadow under the subject" /> : null}
          </div>
          <div className="insp-sec">
            <h3 className="insp-title">Edge</h3>
            <Slider label="Soften" min={0} max={100} value={r.feather} onChange={(v) => p.set({ ...r, feather: v })} onCommit={(v) => p.commit({ ...r, feather: v })} testid="ph-feather" />
            <Slider label="Shrink or grow" value={r.edge} onChange={(v) => p.set({ ...r, edge: v })} onCommit={(v) => p.commit({ ...r, edge: v })} testid="ph-edge" />
            <div className="seg" role="radiogroup" aria-label="Refine brush">
              {([['off', 'Look'], ['keep', 'Keep'], ['remove', 'Remove']] as const).map(([k, label]) => <button key={k} role="radio" aria-checked={p.brush === k} className={p.brush === k ? 'on' : ''} onClick={() => p.setBrush(k)} data-testid={`ph-brush-${k}`}>{label}</button>)}
            </div>
            {p.brush !== 'off' ? <Slider label="Brush" min={1} max={30} value={p.brushSize} onChange={p.setBrushSize} onCommit={p.setBrushSize} /> : null}
            <p className="insp-help">{p.brush === 'keep' ? 'Paint over parts of the subject that went missing.' : p.brush === 'remove' ? 'Paint over leftovers of the background.' : 'Choose Keep or Remove to touch up the edge with a brush.'}</p>
            {r.strokes.length ? <div className="ph-quick"><button className="btn sm ghost" onClick={() => p.commit({ ...r, strokes: r.strokes.slice(0, -1) })}>Undo brush</button><button className="btn sm ghost" onClick={() => p.commit({ ...r, strokes: [] })}>Clear brush</button></div> : null}
          </div>
          <div className="ph-quick">
            <button className="btn sm ghost" aria-pressed={p.comparing} onClick={() => p.setComparing(!p.comparing)} data-testid="ph-bg-compare"><Icon name="columns" size={13} /> Before and after</button>
            {bg.kind !== 'clear' || bg.shadow ? <button className="btn sm ghost" onClick={() => p.commit({ ...r, background: defaultBackground() })}>See-through again</button> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Retouch

export function RetouchPanel(p: PanelProps & { tool: RetouchKind; setTool: (t: RetouchKind) => void; size: number; setSize: (n: number) => void; source: { x: number; y: number } | null; setSource: (s: null) => void }) {
  const r = p.recipe;
  const mac = navigator.platform.toLowerCase().includes('mac');
  return (
    <div className="insp" data-testid="ph-panel-retouch">
      <div className="insp-sec">
        <div className="seg" role="radiogroup" aria-label="Retouch tool">
          {([['heal', 'Heal'], ['clone', 'Clone'], ['redeye', 'Red eye']] as const).map(([k, label]) => <button key={k} role="radio" aria-checked={p.tool === k} className={p.tool === k ? 'on' : ''} onClick={() => p.setTool(k)} data-testid={`ph-retouch-${k}`}>{label}</button>)}
        </div>
        <Slider label="Size" min={1} max={25} value={p.size} onChange={p.setSize} onCommit={p.setSize} testid="ph-retouch-size" />
        <p className="insp-help">{p.tool === 'heal' ? 'Click a spot, a speck or a small object: it blends away into what is around it.' : p.tool === 'clone' ? `${p.source ? 'Click where to copy to.' : `${mac ? 'Option' : 'Alt'}-click where to copy from first.`}` : 'Click each red eye.'}</p>
        {p.tool === 'clone' && p.source ? <button className="btn sm ph-link" onClick={() => p.setSource(null)}>Choose another place to copy from</button> : null}
      </div>
      {r.retouch.length ? (
        <ul className="ph-areas" aria-label="Retouched spots">
          {r.retouch.map((s, i) => <li key={i}><span>{s.kind === 'heal' ? 'Healed' : s.kind === 'clone' ? 'Cloned' : 'Red eye'} {i + 1}</span><button className="btn sm ghost icon" title="Undo this spot" aria-label={`Undo spot ${i + 1}`} onClick={() => p.commit({ ...r, retouch: r.retouch.filter((_, j) => j !== i) })}><Icon name="close" size={12} /></button></li>)}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Add

const STICKERS = ['😀', '😍', '🥳', '😎', '🤩', '❤️', '✨', '⭐', '🔥', '🎉', '🌸', '🌈', '☀️', '🌙', '🐶', '🐱', '🍕', '☕', '📍', '✅', '👍', '💬', '🎂', '🏖️'];
const NEW: Record<Overlay['kind'], Overlay> = {
  text: { kind: 'text', text: 'Your words', x: 0.5, y: 0.5, size: 0.08, colour: '#ffffff', font: 'sans', bold: true, shadow: true },
  shape: { kind: 'shape', shape: 'rect', x: 0.35, y: 0.35, w: 0.3, h: 0.3, colour: '#ffffff', width: 0.008, fill: false },
  sticker: { kind: 'sticker', emoji: '✨', x: 0.5, y: 0.5, size: 0.18 },
  watermark: { kind: 'watermark', text: '© Your name', place: 'br', size: 0.035, opacity: 0.6, colour: '#ffffff' },
  frame: { kind: 'frame', style: 'plain', size: 0.03, colour: '#ffffff' },
};
const KIND_LABEL: Record<Overlay['kind'], string> = { text: 'Text', shape: 'Shape', sticker: 'Sticker', watermark: 'Watermark', frame: 'Frame' };

export function AddPanel(p: PanelProps & { selected: number; setSelected: (i: number) => void }) {
  const { go } = useStore();
  const r = p.recipe;
  const o = r.overlays[p.selected];
  const upd = (patch: Partial<Overlay>, done = true) => {
    const list = r.overlays.map((x, i) => (i === p.selected ? ({ ...x, ...patch } as Overlay) : x));
    if (done) p.commit({ ...r, overlays: list }); else p.set({ ...r, overlays: list });
  };
  const add = (k: Overlay['kind']) => { p.commit({ ...r, overlays: [...r.overlays.filter((x) => k !== 'frame' || x.kind !== 'frame'), NEW[k]] }); p.setSelected(k === 'frame' ? r.overlays.filter((x) => x.kind !== 'frame').length : r.overlays.length); };
  return (
    <div className="insp" data-testid="ph-panel-add">
      <div className="xchecks" aria-label="Add">
        {(Object.keys(NEW) as Overlay['kind'][]).map((k) => <button key={k} className="xcheck" onClick={() => add(k)} data-testid={`ph-add-${k}`}><Icon name="plus" size={12} /> {KIND_LABEL[k]}</button>)}
      </div>
      {r.overlays.length ? (
        <ul className="ph-areas" aria-label="Added">
          {r.overlays.map((x, i) => (
            <li key={i} className={i === p.selected ? 'on' : ''}>
              <button className="ph-item" aria-pressed={i === p.selected} onClick={() => p.setSelected(i)}>{KIND_LABEL[x.kind]}{x.kind === 'text' || x.kind === 'watermark' ? `: ${x.text.split('\n')[0].slice(0, 18)}` : x.kind === 'sticker' ? ` ${x.emoji}` : ''}</button>
              <button className="btn sm ghost icon" title="Remove" aria-label={`Remove ${KIND_LABEL[x.kind]}`} onClick={() => { p.commit({ ...r, overlays: r.overlays.filter((_, j) => j !== i) }); p.setSelected(-1); }}><Icon name="close" size={12} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="insp-help">Add words, a shape, a sticker, your name as a watermark or a frame. Drag on the picture to move what you chose.</p>}
      {o ? (
        <div className="insp-sec" data-testid="ph-add-edit">
          {o.kind === 'text' || o.kind === 'watermark' ? <textarea className="input ph-text" rows={2} aria-label="Words" value={o.text} onChange={(e) => upd({ text: e.target.value }, false)} onBlur={(e) => upd({ text: e.target.value })} data-testid="ph-add-words" /> : null}
          {o.kind === 'text' ? (
            <>
              <div className="seg" role="radiogroup" aria-label="Font">
                {(['sans', 'serif', 'round', 'mono'] as const).map((f) => <button key={f} role="radio" aria-checked={o.font === f} className={o.font === f ? 'on' : ''} onClick={() => upd({ font: f })}>{{ sans: 'Plain', serif: 'Classic', round: 'Round', mono: 'Typed' }[f]}</button>)}
              </div>
              <label className="mo-inline ph-toggle"><Toggle on={o.bold} onChange={(v) => upd({ bold: v })} label="Bold" /> Bold</label>
            </>
          ) : null}
          {o.kind === 'shape' ? (
            <>
              <div className="seg" role="radiogroup" aria-label="Shape">
                {(['rect', 'ellipse', 'line', 'arrow'] as const).map((s) => <button key={s} role="radio" aria-checked={o.shape === s} className={o.shape === s ? 'on' : ''} onClick={() => upd({ shape: s })}>{{ rect: 'Box', ellipse: 'Oval', line: 'Line', arrow: 'Arrow' }[s]}</button>)}
              </div>
              {o.shape === 'rect' || o.shape === 'ellipse' ? <label className="mo-inline ph-toggle"><Toggle on={o.fill} onChange={(v) => upd({ fill: v })} label="Filled" /> Filled</label> : null}
              <Slider label="Line" min={1} max={40} value={Math.round(o.width * 1000)} onChange={(v) => upd({ width: v / 1000 }, false)} onCommit={(v) => upd({ width: v / 1000 })} />
            </>
          ) : null}
          {o.kind === 'sticker' ? <div className="ph-stickers" role="radiogroup" aria-label="Sticker">{STICKERS.map((e) => <button key={e} role="radio" aria-checked={o.emoji === e} className={o.emoji === e ? 'on' : ''} aria-label={`Sticker ${e}`} onClick={() => upd({ emoji: e })}>{e}</button>)}</div> : null}
          {o.kind === 'watermark' ? (
            <>
              <label className="insp-field">Where
                <select className="input" value={o.place} onChange={(e) => upd({ place: e.target.value as typeof o.place })}>
                  <option value="br">Bottom right</option><option value="bl">Bottom left</option><option value="tr">Top right</option><option value="tl">Top left</option><option value="c">Middle</option><option value="tile">All over</option>
                </select>
              </label>
              <Slider label="Strength" min={5} max={100} value={Math.round(o.opacity * 100)} onChange={(v) => upd({ opacity: v / 100 }, false)} onCommit={(v) => upd({ opacity: v / 100 })} />
            </>
          ) : null}
          {o.kind === 'frame' ? (
            <div className="seg" role="radiogroup" aria-label="Frame">
              {(['plain', 'double', 'print'] as const).map((s) => <button key={s} role="radio" aria-checked={o.style === s} className={o.style === s ? 'on' : ''} onClick={() => upd({ style: s })}>{{ plain: 'Plain', double: 'Double', print: 'Print' }[s]}</button>)}
            </div>
          ) : null}
          {'size' in o ? <Slider label="Size" min={1} max={o.kind === 'sticker' ? 80 : o.kind === 'frame' ? 20 : 40} value={Math.round(o.size * 100)} onChange={(v) => upd({ size: v / 100 }, false)} onCommit={(v) => upd({ size: v / 100 })} testid="ph-add-size" /> : null}
          {'colour' in o ? <Swatches label="Colour" value={o.colour} onPick={(c) => upd({ colour: c })} /> : null}
        </div>
      ) : null}
      <button className="btn sm ph-link" onClick={() => go({ name: 'annotate', arg: p.path })} data-testid="ph-annotate"><Icon name="rename" size={13} /> Arrows, pen and numbered steps…</button>
    </div>
  );
}

// ---------------------------------------------------------------- Hide

export function HidePanel(p: PanelProps & { kind: RedactKind; setKind: (k: RedactKind) => void }) {
  const r = p.recipe;
  return (
    <div className="insp" data-testid="ph-panel-hide">
      <div className="insp-sec">
        <h3 className="insp-title">Hide an area</h3>
        <div className="seg" role="radiogroup" aria-label="How to hide">
          {(['blur', 'pixelate', 'box'] as RedactKind[]).map((k) => <button key={k} role="radio" aria-checked={p.kind === k} className={p.kind === k ? 'on' : ''} onClick={() => p.setKind(k)} data-testid={`ph-hide-${k}`}>{k === 'blur' ? 'Blur' : k === 'pixelate' ? 'Pixelate' : 'Cover'}</button>)}
        </div>
        <p className="insp-help">Drag over a face, a name or a number. Cover is the safest: nothing can be read back.</p>
      </div>
      {r.redact.length ? (
        <ul className="ph-areas" aria-label="Hidden areas">
          {r.redact.map((z, i) => <li key={i}><span>{z.kind === 'blur' ? 'Blurred' : z.kind === 'pixelate' ? 'Pixelated' : 'Covered'} area {i + 1}</span><button className="btn sm ghost icon" title="Show this area again" aria-label={`Show area ${i + 1} again`} onClick={() => p.commit({ ...r, redact: r.redact.filter((_, j) => j !== i) })}><Icon name="close" size={12} /></button></li>)}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Canvas

export function CanvasPanel(p: PanelProps & { cropped: { w: number; h: number } }) {
  const r = p.recipe;
  const [lock, setLock] = useState(true);
  const base = p.cropped;
  const cur = r.width || r.height ? { w: r.width || Math.round((r.height * base.w) / base.h), h: r.height || Math.round((r.width * base.h) / base.w) } : r.maxSide ? (() => { const k = Math.min(1, r.maxSide / Math.max(base.w, base.h)); return { w: Math.round(base.w * k), h: Math.round(base.h * k) }; })() : base;
  const setSide = (side: 'w' | 'h', v: number) => {
    if (!v || v < 1) return;
    const next = lock ? lockedSize(base.w, base.h, side, v) : { ...cur, [side]: Math.round(v) };
    p.commit({ ...r, width: next.w, height: next.h, maxSide: 0 });
  };
  const ex = r.extend;
  const setEx = (patch: Partial<PhotoRecipe['extend']>, done = true) => { const next = { ...r, extend: { ...ex, ...patch } }; if (done) p.commit(next); else p.set(next); };
  const even = Math.round(Math.max(ex.t, ex.r, ex.b, ex.l) * 100);
  return (
    <div className="insp" data-testid="ph-panel-canvas">
      <div className="insp-sec">
        <h3 className="insp-title">Size</h3>
        <div className="ph-size">
          <label className="insp-field">Width<input className="input" type="number" min={1} max={30000} value={cur.w} onChange={(e) => setSide('w', Number(e.target.value))} data-testid="ph-width" /></label>
          <button className="btn sm ghost icon ph-lock" aria-pressed={lock} title={lock ? 'Shape kept: the other side follows' : 'Shape free'} aria-label="Keep the shape" onClick={() => setLock(!lock)}><Icon name={lock ? 'lock' : 'unlock'} size={13} /></button>
          <label className="insp-field">Height<input className="input" type="number" min={1} max={30000} value={cur.h} onChange={(e) => setSide('h', Number(e.target.value))} data-testid="ph-height" /></label>
        </div>
        <div className="xchecks" aria-label="Longest side">
          {[3840, 2048, 1600, 1080, 640].map((n) => <button key={n} className="xcheck" aria-pressed={r.maxSide === n && !r.width && !r.height} onClick={() => p.commit({ ...r, maxSide: n, width: 0, height: 0 })}>{n}</button>)}
          <button className="xcheck" aria-pressed={!r.maxSide && !r.width && !r.height} onClick={() => p.commit({ ...r, maxSide: 0, width: 0, height: 0 })}>As it is</button>
        </div>
      </div>
      <div className="insp-sec">
        <h3 className="insp-title">More canvas</h3>
        <Slider label="All round" min={0} max={50} unit="%" value={even} onChange={(v) => setEx({ t: v / 100, r: v / 100, b: v / 100, l: v / 100 }, false)} onCommit={(v) => setEx({ t: v / 100, r: v / 100, b: v / 100, l: v / 100 })} testid="ph-extend" />
        <Fold title="Each side">
          {(['t', 'r', 'b', 'l'] as const).map((k) => <Slider key={k} label={{ t: 'Top', r: 'Right', b: 'Bottom', l: 'Left' }[k]} min={0} max={100} unit="%" value={Math.round(ex[k] * 100)} onChange={(v) => setEx({ [k]: v / 100 }, false)} onCommit={(v) => setEx({ [k]: v / 100 })} />)}
        </Fold>
        <Swatches label="Canvas colour" value={ex.colour} allowClear onPick={(c) => setEx({ colour: c })} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- History

export function HistoryPanel({ steps, at, onJump }: { steps: { label: string }[]; at: number; onJump: (i: number) => void }) {
  return (
    <div className="insp" data-testid="ph-panel-history">
      <p className="insp-help">Every change, oldest first. Choose a step to go back to it; nothing is lost until you change something else.</p>
      <ol className="ph-history" aria-label="History">
        {steps.map((s, i) => (
          <li key={i}><button className={i === at ? 'on' : i > at ? 'later' : ''} aria-current={i === at ? 'step' : undefined} onClick={() => onJump(i)} data-testid={`ph-step-${i}`}>{s.label}</button></li>
        ))}
      </ol>
    </div>
  );
}
