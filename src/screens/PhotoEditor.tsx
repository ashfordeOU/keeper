// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The light photo editor: the picture in a calm canvas with a floating
// toolbar (undo, turn, flip, compare), and an inspector on the right with four
// tabs: Adjust (light and colour), Crop (shape, straighten), Hide (blur,
// pixelate or cover an area) and Export (size, format, cut out, annotate).
// Nothing is baked in: the original is kept and Revert brings it back.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureEntry } from '../../core/capture';
import type { PhotoInfo } from '../../core/api-photo';
import { formatBytes } from '../../core/format';
import { ASPECTS, aspectCrop, defaultRecipe, describeRecipe, isUnchanged, normalizeRecipe, type PhotoFormat, type PhotoRecipe, type Rect, type RedactKind } from '../../core/photo-edit';
import { api } from '../api';
import { FirstRun, PhotoArt } from '../components/FirstRun';
import { Icon } from '../components/Icon';
import { Loading, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/extras.css';
import '../styles/photo.css';

type Tab = 'adjust' | 'crop' | 'hide' | 'export';
const TABS: { id: Tab; label: string }[] = [{ id: 'adjust', label: 'Adjust' }, { id: 'crop', label: 'Crop' }, { id: 'hide', label: 'Hide' }, { id: 'export', label: 'Export' }];
const SLIDERS: { key: 'exposure' | 'contrast' | 'saturation' | 'temperature'; label: string }[] = [
  { key: 'exposure', label: 'Light' }, { key: 'contrast', label: 'Contrast' }, { key: 'saturation', label: 'Colour' }, { key: 'temperature', label: 'Warmth' },
];
const err = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

export function PhotoEditor() {
  const { route } = useStore();
  const p = route.arg;
  return p ? <Editor key={p} path={p} /> : <Start />;
}

/** No picture yet: one main action, and recent captures to pick from. */
function Start() {
  const { go } = useStore();
  const [recent, setRecent] = useState<CaptureEntry[]>([]);
  useEffect(() => { void api.capture.history().then((h) => setRecent(h.filter((x) => x.path && x.thumb && /\.(png|jpe?g|webp)$/i.test(x.path)).slice(0, 6))).catch(() => undefined); }, []);
  const open = async () => {
    const [f] = await api.settings.pickFiles({ title: 'Choose a picture to edit', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'gif', 'avif'] });
    if (f) go({ name: 'photo', arg: f });
  };
  return (
    <div className="page ph-page" data-testid="photo-start">
      <PageHead title="Photo Editor" sub="Crop, straighten, light and colour, hide what is private." />
      <FirstRun testid="ph-first" kicker="Photo editor" title="Make a picture just right" mark="right"
        line="Open any picture from your files or captures. Your original is kept, so you can always go back."
        art={<PhotoArt />}
        action={<button className="btn primary" onClick={() => void open()} data-testid="ph-open"><Icon name="image" size={14} /> Open a picture</button>}
        more={<span className="muted small">Or right-click a picture → Edit Photo</span>}
        trust={['On this computer', 'Original kept', 'Revert anytime']} />
      {recent.length ? (
        <section className="xpanel ph-recent">
          <div className="xpanel-head"><h3>Recent captures</h3></div>
          <div className="ph-recent-grid">
            {recent.map((r) => <button key={r.id} className="ph-recent-item" onClick={() => go({ name: 'photo', arg: r.path })} title={r.value}><img src={r.thumb} alt={r.value} /></button>)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Editor({ path }: { path: string }) {
  const { go, toast } = useStore();
  const [info, setInfo] = useState<PhotoInfo | null>(null);
  const [fail, setFail] = useState('');
  const [recipe, setRecipe] = useState<PhotoRecipe>(defaultRecipe());
  const [past, setPast] = useState<PhotoRecipe[]>([]);
  const [future, setFuture] = useState<PhotoRecipe[]>([]);
  const [tab, setTab] = useState<Tab>('adjust');
  const [view, setView] = useState<{ url: string; width: number; height: number } | null>(null);
  const [original, setOriginal] = useState<string>('');
  const [comparing, setComparing] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState('');
  const [hideKind, setHideKind] = useState<RedactKind>('blur');
  const [aspect, setAspect] = useState('free');
  const saved = useRef<PhotoRecipe>(defaultRecipe());

  useEffect(() => {
    void api.photo.info(path).then((i) => {
      setInfo(i);
      const start = i.edited ? normalizeRecipe(i.edited.recipe) : defaultRecipe();
      setRecipe(start);
      saved.current = start;
    }, (e) => setFail(err(e)));
  }, [path]);

  // What the canvas shows: in Crop, the whole turned picture (to choose the crop on); elsewhere the result.
  const shown = useMemo<PhotoRecipe>(() => (tab === 'crop' ? { ...recipe, crop: undefined, redact: [], cutout: false } : recipe), [recipe, tab]);
  const seq = useRef(0);
  useEffect(() => {
    if (!info) return;
    const n = ++seq.current;
    setRendering(true);
    const t = setTimeout(() => {
      void api.photo.preview(path, shown).then((v) => { if (n === seq.current) setView(v); }, (e) => { if (n === seq.current) toast(err(e)); }).finally(() => { if (n === seq.current) setRendering(false); });
    }, 90);
    return () => clearTimeout(t);
  }, [info, shown, path, toast]);
  useEffect(() => {
    if (!info || !comparing || original) return;
    void api.photo.preview(path, defaultRecipe()).then((v) => setOriginal(v.url)).catch(() => undefined);
  }, [comparing, info, original, path]);

  /** A finished change goes into the undo history. */
  const commit = useCallback((next: PhotoRecipe) => {
    setPast((h) => [...h.slice(-49), recipe]);
    setFuture([]);
    setRecipe(normalizeRecipe(next));
  }, [recipe]);
  const undo = () => { if (!past.length) return; setFuture((f) => [recipe, ...f]); setRecipe(past[past.length - 1]); setPast(past.slice(0, -1)); };
  const redo = () => { if (!future.length) return; setPast((h) => [...h, recipe]); setRecipe(future[0]); setFuture(future.slice(1)); };
  const dirty = JSON.stringify(recipe) !== JSON.stringify(saved.current);

  const save = async (mode: 'replace' | 'copy') => {
    setBusy(mode === 'copy' ? 'Saving a copy' : 'Saving');
    try {
      const r = await api.photo.save(path, recipe, mode);
      if (r.copy) toast(`Saved ${r.path.split(/[\\/]/).pop()}`, { label: 'Open', run: () => go({ name: 'photo', arg: r.path }) });
      else { saved.current = recipe; setInfo(await api.photo.info(path)); toast('Saved. Your original is kept: Revert brings it back.'); }
    } catch (e) { toast(err(e)); } finally { setBusy(''); }
  };
  const revert = async () => {
    setBusy('Reverting');
    try {
      await api.photo.revert(path);
      const d = defaultRecipe();
      setPast((h) => [...h, recipe]); setRecipe(d); saved.current = d; setInfo(await api.photo.info(path)); setOriginal('');
      toast('The original is back');
    } catch (e) { toast(err(e)); } finally { setBusy(''); }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || (e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (e.key.toLowerCase() === 's') { e.preventDefault(); void save(e.shiftKey ? 'copy' : 'replace'); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  if (fail) return <div className="page ph-page"><PageHead title="Photo Editor" /><div className="xpanel ph-fail" role="alert"><b>This picture cannot be edited</b><p className="muted">{fail}</p><button className="btn" onClick={() => go({ name: 'photo' })}>Open another picture</button></div></div>;
  if (!info) return <div className="page ph-page"><PageHead title="Photo Editor" /><Loading /></div>;

  return (
    <div className="page ph-page ph-editing" data-testid="photo-editor">
      <PageHead title={<span>Photo Editor <span className="ph-crumb">› {info.name}</span></span>} sub={`${info.width} × ${info.height} · ${formatBytes(info.size)}${info.edited ? ` · Edited: ${info.edited.summary}` : ''}`}>
        {info.edited || dirty ? <button className="btn ghost" disabled={!!busy || (!info.edited && !dirty)} onClick={() => (info.edited ? void revert() : setRecipe(saved.current))} data-testid="ph-revert">Revert</button> : null}
        <button className="btn" disabled={!!busy || isUnchanged(recipe)} onClick={() => void save('copy')} data-testid="ph-copy">Save a copy</button>
        <button className="btn primary" disabled={!!busy || !dirty} onClick={() => void save('replace')} data-testid="ph-save">{busy || 'Save'}</button>
      </PageHead>
      <div className="ph-layout">
        <div className="ph-stage">
          <Canvas view={view} original={comparing ? original : ''} tab={tab} recipe={recipe} hideKind={hideKind} aspect={ASPECTS.find((a) => a.id === aspect)?.ratio ?? null} onCommit={commit} />
          <div className="capsule ph-tools" role="toolbar" aria-label="Picture tools">
            <button className="btn sm ghost icon" title="Undo (⌘Z)" aria-label="Undo" disabled={!past.length} onClick={undo}><Icon name="undo" size={15} /></button>
            <button className="btn sm ghost icon ph-flip-x" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!future.length} onClick={redo}><Icon name="undo" size={15} /></button>
            <span className="ph-sep" aria-hidden />
            <button className="btn sm ghost icon ph-flip-x" title="Turn left" aria-label="Turn left" onClick={() => commit({ ...recipe, turns: ((recipe.turns + 3) % 4) as PhotoRecipe['turns'], crop: undefined, redact: [] })} data-testid="ph-turn-left"><Icon name="refresh" size={15} /></button>
            <button className="btn sm ghost icon" title="Turn right" aria-label="Turn right" onClick={() => commit({ ...recipe, turns: ((recipe.turns + 1) % 4) as PhotoRecipe['turns'], crop: undefined, redact: [] })} data-testid="ph-turn-right"><Icon name="refresh" size={15} /></button>
            <button className="btn sm ghost icon" title="Flip" aria-label="Flip" aria-pressed={recipe.flip} onClick={() => commit({ ...recipe, flip: !recipe.flip, crop: undefined, redact: [] })}><Icon name="columns" size={15} /></button>
            <span className="ph-sep" aria-hidden />
            <button className="btn sm ghost" title="Hold to see the original" aria-pressed={comparing} onPointerDown={() => setComparing(true)} onPointerUp={() => setComparing(false)} onPointerLeave={() => setComparing(false)} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') setComparing(true); }} onKeyUp={() => setComparing(false)} data-testid="ph-compare"><Icon name="eye" size={14} /> Original</button>
            {rendering ? <span className="ph-busy muted small" role="status">Updating…</span> : null}
          </div>
        </div>

        <aside className="xpanel ph-insp" aria-label="Edit">
          <div className="seg ph-tabs" role="tablist" aria-label="Edit">
            {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} data-testid={`ph-tab-${t.id}`}>{t.label}</button>)}
          </div>
          {tab === 'adjust' ? (
            <div className="insp">
              <div className="insp-sec">
                <h3 className="insp-title">Light and colour</h3>
                {SLIDERS.map((s) => (
                  <Slider key={s.key} label={s.label} value={recipe[s.key]} onChange={(v) => setRecipe({ ...recipe, [s.key]: v })} onCommit={(v) => commit({ ...recipe, [s.key]: v })} testid={`ph-${s.key}`} />
                ))}
              </div>
              <div className="ph-quick">
                <button className="btn sm ghost" onClick={() => commit({ ...recipe, saturation: -100 })}>Black and white</button>
                <button className="btn sm ghost" disabled={!recipe.exposure && !recipe.contrast && !recipe.saturation && !recipe.temperature} onClick={() => commit({ ...recipe, exposure: 0, contrast: 0, saturation: 0, temperature: 0 })}>Reset</button>
              </div>
            </div>
          ) : tab === 'crop' ? (
            <div className="insp">
              <div className="insp-sec">
                <h3 className="insp-title">Shape</h3>
                <div className="xchecks" role="radiogroup" aria-label="Crop shape">
                  {ASPECTS.map((a) => (
                    <button key={a.id} role="radio" className="xcheck" aria-checked={aspect === a.id} aria-pressed={aspect === a.id} data-testid={`ph-aspect-${a.id}`}
                      onClick={() => { setAspect(a.id); if (a.ratio && view) commit({ ...recipe, crop: aspectCrop(view.width, view.height, a.ratio), redact: [] }); }}>{a.label}</button>
                  ))}
                </div>
                <p className="insp-help">Drag on the picture to choose what to keep.</p>
              </div>
              <div className="insp-sec">
                <h3 className="insp-title">Straighten</h3>
                <Slider label="Angle" min={-45} max={45} step={0.5} unit="°" value={recipe.straighten} onChange={(v) => setRecipe({ ...recipe, straighten: v })} onCommit={(v) => commit({ ...recipe, straighten: v, crop: undefined, redact: [] })} testid="ph-straighten" />
              </div>
              <div className="ph-quick"><button className="btn sm ghost" disabled={!recipe.crop && !recipe.straighten} onClick={() => commit({ ...recipe, crop: undefined, straighten: 0 })}>Reset crop</button></div>
            </div>
          ) : tab === 'hide' ? (
            <div className="insp">
              <div className="insp-sec">
                <h3 className="insp-title">Hide an area</h3>
                <div className="seg" role="radiogroup" aria-label="How to hide">
                  {(['blur', 'pixelate', 'box'] as RedactKind[]).map((k) => <button key={k} role="radio" aria-checked={hideKind === k} className={hideKind === k ? 'on' : ''} onClick={() => setHideKind(k)} data-testid={`ph-hide-${k}`}>{k === 'blur' ? 'Blur' : k === 'pixelate' ? 'Pixelate' : 'Cover'}</button>)}
                </div>
                <p className="insp-help">Drag over a face, a name or a number. Cover is the safest: nothing can be read back.</p>
              </div>
              {recipe.redact.length ? (
                <ul className="ph-areas" aria-label="Hidden areas">
                  {recipe.redact.map((z, i) => (
                    <li key={i}><span>{z.kind === 'blur' ? 'Blurred' : z.kind === 'pixelate' ? 'Pixelated' : 'Covered'} area {i + 1}</span><button className="btn sm ghost icon" title="Show this area again" aria-label={`Show area ${i + 1} again`} onClick={() => commit({ ...recipe, redact: recipe.redact.filter((_, j) => j !== i) })}><Icon name="close" size={12} /></button></li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="insp">
              <div className="insp-sec">
                <h3 className="insp-title">Size and format</h3>
                <label className="insp-field">Longest side
                  <select className="input" value={recipe.maxSide} onChange={(e) => commit({ ...recipe, maxSide: Number(e.target.value) })} data-testid="ph-size">
                    <option value={0}>As it is</option>{[3840, 2048, 1600, 1080, 640].map((n) => <option key={n} value={n}>{n} pixels</option>)}
                  </select>
                </label>
                <label className="insp-field">Format
                  <select className="input" value={recipe.format} onChange={(e) => commit({ ...recipe, format: e.target.value as PhotoFormat })} data-testid="ph-format">
                    <option value="same">Same as now</option><option value="jpeg">JPEG (smallest for photos)</option><option value="png">PNG (sharp text, see-through)</option><option value="webp">WebP (small, for the web)</option>
                  </select>
                </label>
                {recipe.format !== 'same' ? <p className="insp-help">A new format is saved as a copy beside the original.</p> : null}
              </div>
              <div className="insp-sec">
                <h3 className="insp-title">Background</h3>
                <label className="mo-inline ph-toggle">
                  <Toggle on={recipe.cutout} disabled={info.cutout === 'off'} onChange={(v) => commit({ ...recipe, cutout: v })} label="Remove the background" />
                  Remove the background
                </label>
                <p className="insp-help">{info.cutout === 'off' ? 'Needs Convert, which is switched off.' : info.cutout === 'download' ? 'Runs on this computer; the first time, Keeper downloads the part it needs.' : 'Runs on this computer. Saved as PNG, so the background is see-through.'}</p>
              </div>
              <div className="insp-sec">
                <h3 className="insp-title">Draw on it</h3>
                <button className="btn sm" onClick={() => go({ name: 'annotate', arg: path })} data-testid="ph-annotate"><Icon name="rename" size={13} /> Arrows, text and shapes…</button>
              </div>
            </div>
          )}
          <p className="trust-line ph-trust" data-testid="ph-summary">{dirty ? describeRecipe(recipe) : 'Original kept · Revert anytime · On this computer'}</p>
        </aside>
      </div>
    </div>
  );
}

function Slider({ label, value, onChange, onCommit, min = -100, max = 100, step = 1, unit = '', testid }: { label: string; value: number; onChange: (v: number) => void; onCommit: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; testid?: string }) {
  const id = `ph-s-${label}`;
  return (
    <div className="insp-row">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} data-testid={testid}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onDoubleClick={() => onCommit(0)} title="Double-click to reset" />
      <output htmlFor={id}>{value > 0 ? '+' : ''}{value}{unit}</output>
    </div>
  );
}

/** The picture, with the crop frame or the hidden areas drawn over it; dragging makes a new one. */
function Canvas({ view, original, tab, recipe, hideKind, aspect, onCommit }: { view: { url: string; width: number; height: number } | null; original: string; tab: Tab; recipe: PhotoRecipe; hideKind: RedactKind; aspect: number | null; onCommit: (r: PhotoRecipe) => void }) {
  const img = useRef<HTMLImageElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const interactive = tab === 'crop' || tab === 'hide';
  const rel = (e: React.PointerEvent) => {
    const b = img.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)) };
  };
  const rect = (d: NonNullable<typeof drag>): Rect => {
    let w = Math.abs(d.x1 - d.x0);
    let h = Math.abs(d.y1 - d.y0);
    if (tab === 'crop' && aspect && view) {
      // Keep the chosen shape: the height follows the width (in pixels).
      h = Math.min(1, (w * view.width) / aspect / view.height);
      if (d.y0 + h > 1) { h = 1 - Math.min(d.y0, d.y1); w = (h * view.height * aspect) / view.width; }
    }
    return { x: d.x1 < d.x0 ? d.x0 - w : d.x0, y: d.y1 < d.y0 ? d.y0 - h : d.y0, w, h };
  };
  const finish = () => {
    if (!drag) return;
    const r = rect(drag);
    setDrag(null);
    if (r.w < 0.01 || r.h < 0.01) return;
    if (tab === 'crop') onCommit({ ...recipe, crop: r, redact: [] });
    else onCommit({ ...recipe, redact: [...recipe.redact, { ...r, kind: hideKind }] });
  };
  const box = (r: Rect, cls: string, key?: number) => <div key={key} className={cls} style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />;
  return (
    <div className="ph-canvas" data-testid="ph-canvas">
      {view ? (
        <div className={`ph-frame${interactive ? ' interactive' : ''}`}>
          <img ref={img} src={original || view.url} alt="The picture being edited" draggable={false} data-testid="ph-image" />
          {interactive && !original ? (
            <div className="ph-overlay" role="presentation" data-testid="ph-overlay"
              onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); const p = rel(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
              onPointerMove={(e) => { if (drag) { const p = rel(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } }}
              onPointerUp={finish}>
              {tab === 'crop' && (drag || recipe.crop) ? <>{box(drag ? rect(drag) : recipe.crop!, 'ph-crop')}</> : null}
              {tab === 'hide' ? recipe.redact.map((z, i) => box(z, `ph-redact ${z.kind}`, i)) : null}
              {tab === 'hide' && drag ? box(rect(drag), `ph-redact ${hideKind} live`) : null}
            </div>
          ) : null}
          {original ? <span className="xchip ph-badge">Original</span> : null}
        </div>
      ) : <Loading label="Opening the picture…" />}
    </div>
  );
}
