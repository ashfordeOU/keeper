// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The photo editor: the picture in a calm canvas with a floating toolbar
// (undo, turn, flip, before and after), and an inspector on the right whose
// tabs hold the tools (Adjust, Crop, Background, Retouch, Add; Hide, Canvas
// and History under More). Nothing is baked in: the original is kept and
// Revert brings it back. Panels live in ./photo/.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureEntry } from '../../core/capture';
import type { PhotoInfo, RecentPicture } from '../../core/api-photo';
import { formatBytes } from '../../core/format';
import { ASPECTS, defaultRecipe, describeRecipe, describeStep, normalizeRecipe, whiteBalanceFor, type PhotoRecipe, type Rect, type RedactKind, type RetouchKind } from '../../core/photo-edit';
import { isEditablePicture, OPEN_EXT } from '../../core/photo-formats';
import { drawOverlays, overlayBounds } from '../../core/photo-overlay';
import type { Progress } from '../../core/types';
import { api } from '../api';
import { FirstRun, PhotoArt } from '../components/FirstRun';
import { Icon } from '../components/Icon';
import { ContextMenu, Loading, PageHead, useThumb } from '../components/ui';
import { useStore } from '../state';
import { AddPanel, AdjustPanel, BackgroundPanel, CanvasPanel, CropPanel, HidePanel, HistoryPanel, RetouchPanel, type BrushMode, type PanelProps } from './photo/panels';
import { SaveSheet } from './photo/SaveSheet';
import '../styles/extras.css';
import '../styles/photo.css';

type Tab = 'adjust' | 'crop' | 'background' | 'retouch' | 'add' | 'hide' | 'canvas' | 'history';
/** The tools: five in the rail, the rest under More (the visual budget allows six in view). */
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'adjust', label: 'Adjust', icon: 'sliders' }, { id: 'crop', label: 'Crop', icon: 'crop' }, { id: 'background', label: 'Background', icon: 'image' }, { id: 'retouch', label: 'Retouch', icon: 'sparkle' },
  { id: 'add', label: 'Add', icon: 'plus' },
];
const MORE: { id: Tab; label: string; icon: string }[] = [{ id: 'hide', label: 'Hide', icon: 'eyeOff' }, { id: 'canvas', label: 'Canvas', icon: 'expand' }, { id: 'history', label: 'History', icon: 'history' }];
const err = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
/** The first picture in what was dropped: files from the system, or file links (from a browser or a file manager). */
const droppedPicture = (dt: DataTransfer | null) => {
  const files = [...(dt?.files ?? [])].map((f) => api.files.pathOf?.(f) ?? '');
  const links = (dt?.getData('text/uri-list') ?? '').split(/\r?\n/).filter((u) => u.startsWith('file://')).map((u) => { try { return decodeURIComponent(new URL(u).pathname).replace(/^\/([A-Za-z]:\/)/, '$1'); } catch { return ''; } });
  return [...files, ...links].find((p) => p && isEditablePicture(p));
};

export function PhotoEditor() {
  const { route } = useStore();
  const p = route.arg;
  return p ? <Editor key={p} path={p} /> : <Start />;
}

function RecentTile({ path, name, onOpen }: { path: string; name: string; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const src = useThumb(path, 'image', 256, ref);
  return (
    <button ref={ref} className="ph-recent-item" onClick={onOpen} title={name} data-testid="ph-recent-item">
      {src ? <img src={src} alt="" /> : <Icon name="image" size={22} />}
      <span className="ph-recent-name" data-user-text>{name}</span>
    </button>
  );
}

/** No picture yet: one main action, recent pictures, and dropping a picture anywhere. */
function Start() {
  const { go } = useStore();
  const [recent, setRecent] = useState<RecentPicture[]>([]);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    void Promise.all([api.photo.recent().catch(() => [] as RecentPicture[]), api.capture.history().catch(() => [] as CaptureEntry[])]).then(([mine, caps]) => {
      const fromCaps: RecentPicture[] = caps.flatMap((x) => (x.path && /\.(png|jpe?g|webp)$/i.test(x.path) ? [{ path: x.path, name: x.path.split(/[\\/]/).pop() ?? x.path, at: 0 }] : []));
      const seen = new Set<string>();
      setRecent([...mine, ...fromCaps].filter((x) => (seen.has(x.path) ? false : (seen.add(x.path), true))).slice(0, 8));
    });
  }, []);
  const open = async () => {
    const [f] = await api.settings.pickFiles({ title: 'Choose a picture to edit', extensions: OPEN_EXT });
    if (f) go({ name: 'photo', arg: f });
  };
  return (
    <div className={`page ph-page${drag ? ' ph-dragging' : ''}`} data-testid="photo-start"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const p = droppedPicture(e.dataTransfer); if (p) go({ name: 'photo', arg: p }); }}>
      <PageHead title="Photo Editor" sub="Light and colour, cut-outs and new backgrounds, retouching, any format." />
      <FirstRun testid="ph-first" kicker="Photo editor" title="Make a picture just right" mark="right"
        line="Open any picture: JPEG, HEIC, RAW, PNG, Photoshop and more. Your original is kept, so you can always go back."
        art={<PhotoArt />}
        action={<button className="btn primary" onClick={() => void open()} data-testid="ph-open"><Icon name="image" size={14} /> Open a picture</button>}
        more={<span className="muted small">Or drop a picture here · right-click a picture → Edit Photo</span>}
        trust={['On this computer', 'Original kept', 'Revert anytime']} />
      {recent.length ? (
        <section className="xpanel ph-recent">
          <div className="xpanel-head"><h3>Recent pictures</h3></div>
          <div className="ph-recent-grid">
            {recent.map((r) => <RecentTile key={r.path} path={r.path} name={r.name} onOpen={() => go({ name: 'photo', arg: r.path })} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

interface Step { r: PhotoRecipe; label: string }

function Editor({ path }: { path: string }) {
  const { go, toast } = useStore();
  const [info, setInfo] = useState<PhotoInfo | null>(null);
  const [fail, setFail] = useState('');
  const [steps, setSteps] = useState<Step[]>([{ r: defaultRecipe(), label: 'Opened' }]);
  const [at, setAt] = useState(0);
  const [draft, setDraft] = useState<PhotoRecipe | null>(null);
  const recipe = draft ?? steps[at].r;
  const [tab, setTab] = useState<Tab>('adjust');
  const [view, setView] = useState<{ url: string; width: number; height: number } | null>(null);
  const [before, setBefore] = useState('');
  const [comparing, setComparing] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState('');
  const [hideKind, setHideKind] = useState<RedactKind>('blur');
  const [aspect, setAspect] = useState('free');
  const [picking, setPicking] = useState(false);
  const [brush, setBrush] = useState<BrushMode>('off');
  const [brushSize, setBrushSize] = useState(6);
  const [rtool, setRtool] = useState<RetouchKind>('heal');
  const [rsize, setRsize] = useState(4);
  const [cloneFrom, setCloneFrom] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState(-1);
  const [saveSheet, setSaveSheet] = useState(false);
  const [work, setWork] = useState<Progress | null>(null);
  const saved = useRef<PhotoRecipe>(defaultRecipe());

  const load = useCallback(() => api.photo.info(path).then((i) => { setInfo(i); return i; }), [path]);
  useEffect(() => {
    void load().then((i) => {
      const start = i.edited ? normalizeRecipe(i.edited.recipe) : defaultRecipe();
      setSteps([{ r: start, label: i.edited ? 'Opened with earlier edits' : 'Opened' }]);
      setAt(0);
      saved.current = start;
    }, (e) => setFail(err(e)));
  }, [load]);
  useEffect(() => api.on('progress', (x: Progress) => { if (x.task === 'photo-cutout' || x.task === 'photo-save') setWork(x.phase === 'Done' ? null : x); }), []);

  // What the canvas shows: in Crop, the whole turned picture; where you point at the picture, it without its added canvas; elsewhere the result.
  const shown = useMemo<PhotoRecipe>(() => {
    const bare = { ...recipe, extend: { ...recipe.extend, t: 0, r: 0, b: 0, l: 0 }, width: 0, height: 0, maxSide: 0 };
    if (tab === 'crop') return { ...bare, crop: undefined, redact: [], retouch: [], cutout: false, strokes: [] };
    if (tab === 'hide' || tab === 'retouch' || tab === 'background') return bare;
    return recipe;
  }, [recipe, tab]);
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
    if (!info || !comparing) { setBefore(''); return; }
    let alive = true;
    void api.photo.preview(path, shown, { before: true }).then((v) => { if (alive) setBefore(v.url); }).catch(() => undefined);
    return () => { alive = false; };
  }, [comparing, info, path, shown]);

  /** A finished change goes into the history. */
  const lastCommit = useRef(0);
  const commit = useCallback((next: PhotoRecipe) => {
    const n = normalizeRecipe(next);
    setDraft(null);
    if (JSON.stringify(n) === JSON.stringify(steps[at].r)) return;
    // Nudging one slider again and again (arrow keys) is one step, not twenty.
    const prev = at > 0 && at === steps.length - 1 ? steps[at] : null;
    const label = describeStep(steps[at].r, n);
    const same = (l: string) => l.replace(/ [+-]?[\d.]+°?$/, '');
    if (prev && Date.now() - lastCommit.current < 1500 && /[+-]?\d$/.test(label) && same(label) === same(prev.label) && describeStep(steps[at - 1].r, n).startsWith(same(label))) {
      lastCommit.current = Date.now();
      setSteps((s) => [...s.slice(0, at), { r: n, label: describeStep(s[at - 1].r, n) }]);
      return;
    }
    lastCommit.current = Date.now();
    setSteps((s) => [...s.slice(0, at + 1), { r: n, label }].slice(-80));
    setAt((a) => Math.min(a + 1, 79));
  }, [steps, at]);
  const undo = () => { setDraft(null); setAt((a) => Math.max(0, a - 1)); };
  const redo = () => { setDraft(null); setAt((a) => Math.min(steps.length - 1, a + 1)); };
  const dirty = JSON.stringify(recipe) !== JSON.stringify(saved.current);

  const save = async (mode: 'replace' | 'copy', r = recipe) => {
    setBusy(mode === 'copy' ? 'Saving a copy' : 'Saving');
    try {
      const out = await api.photo.save(path, r, mode);
      if (out.copy) toast(`Saved ${out.path.split(/[\\/]/).pop()}`, { label: 'Open', run: () => go({ name: 'photo', arg: out.path }) });
      else { saved.current = r; await load(); toast('Saved. Your original is kept: Revert brings it back.'); }
    } catch (e) { toast(err(e)); } finally { setBusy(''); }
  };
  const revert = async () => {
    setBusy('Reverting');
    try {
      await api.photo.revert(path);
      const d = defaultRecipe();
      commit(d); saved.current = d; await load();
      toast('The original is back');
    } catch (e) { toast(err(e)); } finally { setBusy(''); }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || (e.target as HTMLElement)?.closest('input, textarea, select') || saveSheet) return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (e.key.toLowerCase() === 's') { e.preventDefault(); if (e.shiftKey) setSaveSheet(true); else if (dirty) void save('replace'); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  if (fail) return <div className="page ph-page"><PageHead title="Photo Editor" /><div className="xpanel ph-fail" role="alert"><b>This picture cannot be edited</b><p className="muted">{fail}</p><button className="btn" onClick={() => go({ name: 'photo' })}>Open another picture</button></div></div>;
  if (!info) return <div className="page ph-page"><PageHead title="Photo Editor" /><Loading /></div>;

  const props: PanelProps = { path, info, recipe, set: setDraft, commit };
  const sel = selected >= 0 ? recipe.overlays[selected] : undefined;
  const mode: CanvasMode = tab === 'crop' ? 'crop' : tab === 'hide' ? 'hide' : tab === 'retouch' ? 'retouch' : tab === 'background' && recipe.cutout && brush !== 'off' ? 'brush' : tab === 'adjust' && picking ? 'pick' : tab === 'add' && sel && overlayBounds(sel, 1, 1) ? 'move' : 'none';
  const drawn = tab !== 'crop' && tab !== 'hide' && tab !== 'retouch' && tab !== 'background';
  const facts = [`${info.width} × ${info.height}`, formatBytes(info.size), ...(info.frames ? [`${info.frames} frames`] : []), ...(info.edited ? [`Edited: ${info.edited.summary}`] : [])].join(' · ');

  return (
    <div className="page ph-page ph-editing" data-testid="photo-editor"
      onDragOver={(e) => { if ([...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/uri-list')) e.preventDefault(); }}
      onDrop={(e) => { const p = droppedPicture(e.dataTransfer); if (p) { e.preventDefault(); go({ name: 'photo', arg: p }); } }}>
      <PageHead title={<span>Photo Editor <span className="ph-crumb" data-user-text>› {info.name}</span></span>} sub={facts}>
        {info.edited || dirty ? <button className="btn ghost" disabled={!!busy || (!info.edited && !dirty)} onClick={() => (info.edited ? void revert() : commit(saved.current))} data-testid="ph-revert">Revert</button> : null}
        <button className="btn" disabled={!!busy} onClick={() => setSaveSheet(true)} data-testid="ph-copy">Save a copy…</button>
        <button className="btn primary" disabled={!!busy || !dirty} onClick={() => void save('replace')} data-testid="ph-save">{busy || 'Save'}</button>
      </PageHead>
      {info.note ? <p className="ph-note" role="note" data-testid="ph-note"><Icon name="info" size={13} /> {info.note}</p> : null}
      <div className="ph-layout">
        <div className="ph-stage">
          <Canvas view={view} before={comparing ? before : ''} split={split} setSplit={setSplit} mode={mode} recipe={recipe} drawn={drawn}
            hideKind={hideKind} aspect={ASPECTS.find((a) => a.id === aspect)?.ratio ?? null} brush={brush} brushSize={brushSize} rtool={rtool} rsize={rsize} cloneFrom={cloneFrom} setCloneFrom={setCloneFrom} selected={selected}
            onPick={(rgb) => { setPicking(false); commit({ ...recipe, ...whiteBalanceFor(rgb, recipe), look: undefined }); }}
            onCommit={commit} onDraft={setDraft} />
          <div className="capsule ph-tools" role="toolbar" aria-label="Picture tools">
            <button className="btn sm ghost icon" title="Undo (⌘Z)" aria-label="Undo" disabled={at === 0} onClick={undo} data-testid="ph-undo"><Icon name="undo" size={15} /></button>
            <button className="btn sm ghost icon ph-flip-x" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={at >= steps.length - 1} onClick={redo}><Icon name="undo" size={15} /></button>
            <span className="ph-sep" aria-hidden />
            <button className="btn sm ghost icon ph-flip-x" title="Turn left" aria-label="Turn left" onClick={() => commit({ ...recipe, turns: ((recipe.turns + 3) % 4) as PhotoRecipe['turns'], crop: undefined, redact: [], retouch: [], strokes: [] })} data-testid="ph-turn-left"><Icon name="refresh" size={15} /></button>
            <button className="btn sm ghost icon" title="Turn right" aria-label="Turn right" onClick={() => commit({ ...recipe, turns: ((recipe.turns + 1) % 4) as PhotoRecipe['turns'], crop: undefined, redact: [], retouch: [], strokes: [] })} data-testid="ph-turn-right"><Icon name="refresh" size={15} /></button>
            <button className="btn sm ghost icon" title="Flip" aria-label="Flip" aria-pressed={recipe.flip} onClick={() => commit({ ...recipe, flip: !recipe.flip, crop: undefined, redact: [], retouch: [], strokes: [] })}><Icon name="columns" size={15} /></button>
            <span className="ph-sep" aria-hidden />
            <button className="btn sm ghost" title="Before and after, side by side" aria-pressed={comparing} onClick={() => setComparing(!comparing)} data-testid="ph-compare"><Icon name="eye" size={14} /> Compare</button>
            {rendering || work ? <span className="ph-busy muted small" role="status">{work ? work.phase : 'Updating…'}</span> : null}
          </div>
        </div>

        <aside className="xpanel ph-insp" aria-label="Edit">
          <Rail tab={tab} onChange={(t) => { setTab(t); setPicking(false); }} />
          <div className="ph-panel">
          {tab === 'adjust' ? <AdjustPanel {...props} picking={picking} setPicking={setPicking} />
            : tab === 'crop' ? <CropPanel {...props} aspect={aspect} setAspect={setAspect} view={view} />
            : tab === 'background' ? <BackgroundPanel {...props} brush={brush} setBrush={setBrush} brushSize={brushSize} setBrushSize={setBrushSize} comparing={comparing} setComparing={setComparing} refreshInfo={() => void load()} />
            : tab === 'retouch' ? <RetouchPanel {...props} tool={rtool} setTool={(t) => { setRtool(t); setCloneFrom(null); }} size={rsize} setSize={setRsize} source={cloneFrom} setSource={setCloneFrom} />
            : tab === 'add' ? <AddPanel {...props} selected={selected} setSelected={setSelected} />
            : tab === 'hide' ? <HidePanel {...props} kind={hideKind} setKind={setHideKind} />
            : tab === 'canvas' ? <CanvasPanel {...props} cropped={croppedSize(info, recipe)} />
            : <HistoryPanel steps={steps} at={at} onJump={(i) => { setDraft(null); setAt(i); }} />}
          <p className="trust-line ph-trust" data-testid="ph-summary">{dirty ? describeRecipe(recipe) : 'Original kept · Revert anytime · On this computer'}</p>
          </div>
        </aside>
      </div>
      {saveSheet ? <SaveSheet info={info} recipe={recipe} onClose={() => setSaveSheet(false)} onSave={(r) => { setSaveSheet(false); commit(r); void save('copy', normalizeRecipe(r)); }} /> : null}
    </div>
  );
}

/** The tool rail: five tools with words under their icons, and More for the rest. Arrow keys move along it. */
function Rail({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const extra = MORE.find((m) => m.id === tab);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = Math.max(0, TABS.findIndex((t) => t.id === tab));
    const j = (i + (e.key === 'ArrowDown' ? 1 : -1) + TABS.length) % TABS.length;
    onChange(TABS[j].id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="ph-tab-${TABS[j].id}"]`)?.focus());
  };
  return (
    <div className="ph-rail" role="tablist" aria-label="Tools" aria-orientation="vertical" onKeyDown={onKey}>
      {TABS.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} className={tab === t.id ? 'on' : ''} onClick={() => onChange(t.id)} data-testid={`ph-tab-${t.id}`}>
          <Icon name={t.icon} size={17} /><span>{t.label}</span>
        </button>
      ))}
      <button type="button" className={extra ? 'on' : ''} aria-haspopup="menu" aria-expanded={!!menu} tabIndex={extra ? 0 : -1} data-testid="ph-tab-more"
        onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}>
        <Icon name={extra?.icon ?? 'more'} size={17} /><span>{extra?.label ?? 'More'}</span>
      </button>
      {menu ? <ContextMenu x={menu.x} y={menu.y} label="More tools" onClose={() => setMenu(null)} items={MORE.map((m) => ({ label: m.label, icon: m.icon, testId: `ph-tab-${m.id}`, run: () => onChange(m.id) }))} /> : null}
    </div>
  );
}

/** The picture's size after turning and cropping (for the Size fields). */
function croppedSize(info: PhotoInfo, r: PhotoRecipe): { w: number; h: number } {
  let w = r.turns % 2 ? info.height : info.width;
  let h = r.turns % 2 ? info.width : info.height;
  if (r.crop) { w = Math.max(1, Math.round(w * r.crop.w)); h = Math.max(1, Math.round(h * r.crop.h)); }
  return { w, h };
}

type CanvasMode = 'crop' | 'hide' | 'retouch' | 'brush' | 'pick' | 'move' | 'none';

/**
 * The picture, with what each tool needs drawn over it: the crop frame, hidden
 * areas, retouched spots, the brush, things added on top; and the before and
 * after split.
 */
function Canvas(p: {
  view: { url: string; width: number; height: number } | null; before: string; split: number; setSplit: (n: number) => void; mode: CanvasMode; recipe: PhotoRecipe; drawn: boolean;
  hideKind: RedactKind; aspect: number | null; brush: BrushMode; brushSize: number; rtool: RetouchKind; rsize: number; cloneFrom: { x: number; y: number } | null; setCloneFrom: (s: { x: number; y: number } | null) => void; selected: number;
  onPick: (rgb: [number, number, number]) => void; onCommit: (r: PhotoRecipe) => void; onDraft: (r: PhotoRecipe | null) => void;
}) {
  const { view, recipe, mode } = p;
  const img = useRef<HTMLImageElement>(null);
  const layer = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [stroke, setStroke] = useState<number[] | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const moving = useRef<{ x: number; y: number } | null>(null);

  // Things added on top, drawn by the same code that draws them into the saved file.
  useEffect(() => {
    const c = layer.current;
    if (!c || !view) return;
    c.width = view.width;
    c.height = view.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (p.drawn) drawOverlays(ctx, recipe.overlays, view.width, view.height);
  }, [view, recipe.overlays, p.drawn]);

  const rel = (e: React.PointerEvent) => {
    const b = img.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)) };
  };
  const rect = (d: NonNullable<typeof drag>): Rect => {
    let w = Math.abs(d.x1 - d.x0);
    let h = Math.abs(d.y1 - d.y0);
    if (mode === 'crop' && p.aspect && view) {
      h = Math.min(1, (w * view.width) / p.aspect / view.height);
      if (d.y0 + h > 1) { h = 1 - Math.min(d.y0, d.y1); w = (h * view.height * p.aspect) / view.width; }
    }
    return { x: d.x1 < d.x0 ? d.x0 - w : d.x0, y: d.y1 < d.y0 ? d.y0 - h : d.y0, w, h };
  };
  const short = view ? Math.min(view.width, view.height) : 1;
  const down = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const q = rel(e);
    if (mode === 'crop' || mode === 'hide') setDrag({ x0: q.x, y0: q.y, x1: q.x, y1: q.y });
    else if (mode === 'brush') setStroke([q.x, q.y]);
    else if (mode === 'move') moving.current = q;
    else if (mode === 'pick') {
      const el = img.current!;
      const c = document.createElement('canvas');
      c.width = el.naturalWidth; c.height = el.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(el, 0, 0);
      const x = Math.floor(q.x * (c.width - 1)), y = Math.floor(q.y * (c.height - 1));
      const d = ctx.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data;
      const acc = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { acc[0] += d[i]; acc[1] += d[i + 1]; acc[2] += d[i + 2]; }
      const n = d.length / 4;
      p.onPick([acc[0] / n, acc[1] / n, acc[2] / n]);
    } else if (mode === 'retouch') {
      const r = p.rsize / 100;
      if (p.rtool === 'clone') {
        if (e.altKey || !p.cloneFrom) { p.setCloneFrom(q); return; }
        p.onCommit({ ...recipe, retouch: [...recipe.retouch, { kind: 'clone', x: q.x, y: q.y, r, sx: p.cloneFrom.x, sy: p.cloneFrom.y }] });
        return;
      }
      p.onCommit({ ...recipe, retouch: [...recipe.retouch, { kind: p.rtool, x: q.x, y: q.y, r }] });
    }
  };
  const move = (e: React.PointerEvent) => {
    const q = rel(e);
    setHover(q);
    if (drag) setDrag({ ...drag, x1: q.x, y1: q.y });
    else if (stroke) setStroke([...stroke, q.x, q.y]);
    else if (moving.current && p.selected >= 0) {
      const dx = q.x - moving.current.x, dy = q.y - moving.current.y;
      moving.current = q;
      const list = recipe.overlays.map((x, i) => (i === p.selected && 'x' in x ? { ...x, x: Math.max(0, Math.min(1, x.x + dx)), y: Math.max(0, Math.min(1, x.y + dy)) } : x));
      p.onDraft({ ...recipe, overlays: list });
    }
  };
  const up = () => {
    if (drag) {
      const r = rect(drag);
      setDrag(null);
      if (r.w < 0.01 || r.h < 0.01) return;
      if (mode === 'crop') p.onCommit({ ...recipe, crop: r, redact: [], retouch: [], strokes: [] });
      else p.onCommit({ ...recipe, redact: [...recipe.redact, { ...r, kind: p.hideKind }] });
    } else if (stroke) {
      const pts = stroke;
      setStroke(null);
      p.onCommit({ ...recipe, strokes: [...recipe.strokes, { keep: p.brush === 'keep', r: p.brushSize / 100, pts }] });
    } else if (moving.current) {
      moving.current = null;
      p.onCommit(recipe);
    }
  };
  const box = (r: Rect, cls: string, key?: number) => <div key={key} className={cls} style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />;
  const ring = (x: number, y: number, r: number, cls: string, key?: number | string) => (view ? <div key={key} className={cls} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${((r * short * 2) / view.width) * 100}%`, height: `${((r * short * 2) / view.height) * 100}%` }} /> : null);
  const interactive = mode !== 'none';
  const selBox = p.selected >= 0 && recipe.overlays[p.selected] && view ? overlayBounds(recipe.overlays[p.selected], view.width, view.height) : null;
  return (
    <div className="ph-canvas" data-testid="ph-canvas">
      {view ? (
        <div className={`ph-frame${interactive ? ' interactive' : ''} ph-mode-${mode}`}>
          <img ref={img} src={view.url} alt="The picture being edited" draggable={false} data-testid="ph-image" />
          <canvas ref={layer} className="ph-layer" aria-hidden />
          {p.before ? (
            <div className="ph-before" style={{ clipPath: `inset(0 ${(1 - p.split) * 100}% 0 0)` }} data-testid="ph-before">
              <img src={p.before} alt="Before" draggable={false} />
            </div>
          ) : null}
          {interactive && !p.before ? (
            <div className="ph-overlay" role="presentation" data-testid="ph-overlay" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)}>
              {mode === 'crop' && (drag || recipe.crop) ? box(drag ? rect(drag) : recipe.crop!, 'ph-crop') : null}
              {mode === 'hide' ? recipe.redact.map((z, i) => box(z, `ph-redact ${z.kind}`, i)) : null}
              {mode === 'hide' && drag ? box(rect(drag), `ph-redact ${p.hideKind} live`) : null}
              {mode === 'retouch' ? recipe.retouch.map((s, i) => ring(s.x, s.y, s.r, 'ph-spot', i)) : null}
              {mode === 'retouch' && p.cloneFrom ? ring(p.cloneFrom.x, p.cloneFrom.y, p.rsize / 100, 'ph-spot source', 'src') : null}
              {(mode === 'retouch' || mode === 'brush') && hover ? ring(hover.x, hover.y, (mode === 'brush' ? p.brushSize : p.rsize) / 100, `ph-spot cursor ${mode === 'brush' ? p.brush : ''}`, 'cur') : null}
              {stroke && view ? <svg className="ph-stroke" viewBox={`0 0 ${view.width} ${view.height}`} preserveAspectRatio="none" aria-hidden><polyline points={Array.from({ length: stroke.length / 2 }, (_, i) => `${stroke[i * 2] * view.width},${stroke[i * 2 + 1] * view.height}`).join(' ')} className={p.brush} strokeWidth={(p.brushSize / 100) * short * 2} /></svg> : null}
              {mode === 'move' && selBox ? box(selBox, 'ph-selected') : null}
            </div>
          ) : null}
          {p.before ? (
            <>
              <div className="ph-divider" style={{ left: `${p.split * 100}%` }} aria-hidden />
              <input className="ph-split" type="range" min={0} max={100} value={Math.round(p.split * 100)} onChange={(e) => p.setSplit(Number(e.target.value) / 100)} aria-label="Before and after" data-testid="ph-split" />
              <span className="xchip ph-badge">Before</span><span className="xchip ph-badge after">After</span>
            </>
          ) : null}
        </div>
      ) : <Loading label="Opening the picture…" />}
    </div>
  );
}
