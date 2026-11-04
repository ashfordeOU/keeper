// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Look & Feel (once Wallpaper & Vibes): the home for the desktop's mood. The wallpaper and widgets
// live on the desktop, vibes are picked from the tray and the Island, and sound
// from a floating mixer; this page is where the library, schedules and options
// are set up.

import { useEffect, useMemo, useRef, useState } from 'react';
import { describeMix } from '../../core/scenes/ambient';
import type { AmbienceState, WallpaperCost } from '../../core/scenes/api';
import { clampParams, describeSource, paletteById, PALETTES, SCENE_CATEGORIES, sceneById, sceneSource, SCENES } from '../../core/scenes/catalog';
import { folderIconSvg, ICON_COLORS, ICON_PATTERNS, type FolderIconSpec } from '../../core/scenes/folder-icons';
import { paletteFromPixels } from '../../core/scenes/palette';
import { FRAME_RATES } from '../../core/scenes/policy';
import type { NamedPalette, SceneCategory, SceneParams, WallpaperSource } from '../../core/scenes/types';
import { THEMES } from '../../core/themes';
import { orderedTools, toggleTool } from '../../core/island-tools/tools';
import { describeRule, newId, presetRules, type RuleWhen, type Surface, type Vibe, type VibeRule } from '../../core/vibes';
import { api, isDemo } from '../api';
import { Icon } from '../components/Icon';
import { PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import { vibeSwatch } from '../wallpaper/IslandVibes';
import { MixerControls, useAmbience } from '../wallpaper/MixerControls';
import { SceneRenderer } from '../wallpaper/scene-gl';
import '../styles/ambience.css';
import { Tabs } from '../components/Tabs';
import { ThemeGallery } from '../components/ThemeGallery';

type Tab = 'theme' | 'vibes' | 'wallpaper' | 'schedule' | 'sound' | 'icons' | 'options';
// Look & Feel: how the computer looks and sounds in one place. Theme, wallpaper and sound first;
// vibes save them together. Settings → Appearance keeps the same theme picker.
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'theme', label: 'Theme', icon: 'palette' },
  { id: 'wallpaper', label: 'Wallpaper', icon: 'image' },
  { id: 'sound', label: 'Sound', icon: 'audio' },
  { id: 'vibes', label: 'Vibes', icon: 'sparkle' },
  { id: 'schedule', label: 'Schedule', icon: 'clock' },
  { id: 'icons', label: 'Folder icons', icon: 'folder' },
  { id: 'options', label: 'Options', icon: 'settings' },
];

const paletteCss = (colors: string[]) => `linear-gradient(150deg, ${colors[0]}, ${colors[1]} 40%, ${colors[2]} 80%, ${colors[3]})`;

// ---------------------------------------------------------------- live preview (one canvas, only while the page is open)

function ScenePreview({ source, palettes, testid }: { source: WallpaperSource; palettes: NamedPalette[]; testid?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const r = useRef<SceneRenderer | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    try { r.current = new SceneRenderer(ref.current); r.current.setPolicy(true, 30, 0.6); } catch { r.current = null; }
    return () => { r.current?.dispose(); r.current = null; };
  }, []);
  useEffect(() => {
    if (source.kind === 'scene') r.current?.setScene(source.scene, paletteById(source.palette, palettes).colors, source.params);
  }, [source, palettes]);
  if (source.kind !== 'scene') {
    return <div className="amb-preview amb-preview-media" data-testid={testid}><Icon name={source.kind === 'video' ? 'video' : source.kind === 'web' ? 'globe' : source.kind === 'none' ? 'eyeOff' : 'image'} size={28} /><span>{describeSource(source)}</span></div>;
  }
  return <canvas ref={ref} className="amb-preview" data-testid={testid} />;
}

// ---------------------------------------------------------------- vibes

function VibeEditor({ v, state, onDone }: { v: Vibe; state: AmbienceState; onDone: () => void }) {
  const [x, setX] = useState<Vibe>(v);
  const a = state.settings;
  const save = async () => { await api.ambience.saveVibe(x); onDone(); };
  return (
    <div className="amb-vibe-editor" data-testid="amb-vibe-editor">
      <div className="row"><input className="input" style={{ width: 56, textAlign: 'center' }} value={x.emoji} onChange={(e) => setX({ ...x, emoji: e.target.value })} aria-label="Emoji" /><input className="input grow" value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} aria-label="Name" /></div>
      <label className="amb-field"><span>Wallpaper</span><span className="row small">{x.wallpaper ? describeSource(x.wallpaper) : 'Leave as it is'}<button className="btn sm" onClick={() => setX({ ...x, wallpaper: a.wallpaper.default, perDisplay: Object.keys(a.wallpaper.perDisplay).length ? { ...a.wallpaper.perDisplay } : undefined })}>Use current</button>{x.wallpaper ? <button className="btn ghost sm" onClick={() => setX({ ...x, wallpaper: null, perDisplay: undefined })}>None</button> : null}</span></label>
      <label className="amb-field"><span>Theme</span><select className="input" value={x.theme ?? ''} onChange={(e) => setX({ ...x, theme: e.target.value || null })}><option value="">Leave as it is</option>{THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label className="amb-field"><span>Light or dark</span><div className="seg">{([null, 'system', 'light', 'dark'] as const).map((m) => <button key={String(m)} className={x.appearance === m ? 'on' : ''} onClick={() => setX({ ...x, appearance: m })}>{m ? m[0].toUpperCase() + m.slice(1) : 'Keep'}</button>)}</div></label>
      <label className="amb-field"><span>Sound</span><span className="row small">{x.sound ? (x.sound.playing ? describeMix(x.sound.mix) : 'Silence') : 'Leave as it is'}<button className="btn sm" onClick={() => setX({ ...x, sound: { playing: a.sound.playing, mix: { ...a.sound.mix }, master: a.sound.master } })}>Use current</button><button className="btn ghost sm" onClick={() => setX({ ...x, sound: { playing: false, mix: {}, master: 0.5 } })}>Silence</button>{x.sound ? <button className="btn ghost sm" onClick={() => setX({ ...x, sound: null })}>Keep</button> : null}</span></label>
      <label className="amb-field"><span>Widgets</span><span className="row small">{x.widgets ? `${x.widgets.length} widget${x.widgets.length === 1 ? '' : 's'}` : 'Leave as they are'}<button className="btn sm" onClick={() => void api.widgets.list().then((w) => setX({ ...x, widgets: w }))}>Use current layout</button>{x.widgets ? <button className="btn ghost sm" onClick={() => setX({ ...x, widgets: null })}>Keep</button> : null}</span></label>
      <label className="amb-field"><span>Also start a focus session</span><select className="input" value={x.focusMinutes ?? 0} onChange={(e) => setX({ ...x, focusMinutes: Number(e.target.value) || null })}><option value={0}>No</option>{[25, 50, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
      <div className="row"><button className="btn primary sm" data-testid="amb-vibe-save" onClick={() => void save()}>Save</button><button className="btn ghost sm" onClick={onDone}>Cancel</button><span className="grow" /><button className="btn danger sm" onClick={() => void api.ambience.removeVibe(v.id).then(onDone)}><Icon name="trash" size={12} /> Delete</button></div>
    </div>
  );
}

function VibesTab({ state }: { state: AmbienceState }) {
  const { toast } = useStore();
  const a = state.settings;
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  return (
    <div>
      <div className="section-head"><h2>Your vibes</h2><span className="muted small">Wallpaper, theme, sound and widgets, switched together. Also in the tray and the Island.</span></div>
      <div className="amb-vibes">
        {a.vibes.map((v) => (
          <div key={v.id} className={`card amb-vibe ${a.activeVibe === v.id ? 'on' : ''}`} data-testid={`amb-vibe-${v.id}`}>
            <button className="amb-vibe-swatch" style={{ background: vibeSwatch(v, a.palettes) }} onClick={() => void api.ambience.applyVibe(v.id).then(() => toast(`${v.emoji} ${v.name}`))} aria-label={`Switch to ${v.name}`}>
              <span className="amb-vibe-emoji">{v.emoji}</span>
              {a.activeVibe === v.id ? <span className="badge amb-vibe-active"><Icon name="check" size={10} /> Active</span> : null}
            </button>
            <div className="amb-vibe-body">
              <div className="row"><b className="grow ellipsis">{v.name}</b><button className="btn ghost icon sm" title="Edit" aria-label="Edit" onClick={() => setEditing(editing === v.id ? null : v.id)}><Icon name="settings" size={13} /></button></div>
              <div className="muted small ellipsis">{[v.wallpaper ? describeSource(v.wallpaper) : null, v.sound ? (v.sound.playing ? describeMix(v.sound.mix) : 'Silence') : null, v.theme ? THEMES.find((t) => t.id === v.theme)?.name : null, v.widgets ? `${v.widgets.length} widgets` : null].filter(Boolean).join(' · ') || 'Changes nothing yet'}</div>
            </div>
            {editing === v.id ? <VibeEditor v={v} state={state} onDone={() => setEditing(null)} /> : null}
          </div>
        ))}
      </div>
      <div className="card pad amb-capture">
        <Icon name="plus" size={14} />
        <input className="input grow" placeholder="Name a new vibe from what’s on screen and playing now" value={name} onChange={(e) => setName(e.target.value)} data-testid="amb-capture-name" />
        <button className="btn primary" data-testid="amb-capture" disabled={!name.trim()} onClick={() => void api.ambience.captureVibe(name).then(() => { setName(''); toast('Vibe saved'); })}>Save vibe</button>
        <button className="btn ghost" onClick={() => void api.ambience.resetStarters().then(() => toast('Starter vibes are back'))}>Restore starters</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- wallpaper

function ParamSlider({ label, k, min, max, step, params, set }: { label: string; k: keyof SceneParams; min: number; max: number; step: number; params: SceneParams; set: (p: SceneParams) => void }) {
  return <label className="amb-field"><span>{label}</span><input type="range" min={min} max={max} step={step} value={params[k]} onChange={(e) => set(clampParams({ ...params, [k]: Number(e.target.value) }))} /></label>;
}

function WallpaperTab({ state }: { state: AmbienceState }) {
  const { toast } = useStore();
  const a = state.settings;
  const [target, setTarget] = useState<string>('all');
  const cur = target === 'all' ? a.wallpaper.default : a.wallpaper.perDisplay[target] ?? a.wallpaper.default;
  const [draft, setDraft] = useState<WallpaperSource>(cur);
  const [cat, setCat] = useState<SceneCategory | 'all'>('all');
  const [url, setUrl] = useState('');
  useEffect(() => setDraft(cur), [JSON.stringify(cur)]); // eslint-disable-line react-hooks/exhaustive-deps
  const allPalettes = [...PALETTES, ...a.palettes];
  const scene = draft.kind === 'scene' ? draft : null;
  const apply = (src: WallpaperSource = draft) => void api.ambience.setWallpaper(target, src).then(() => toast(target === 'all' ? 'Wallpaper set on every display' : 'Wallpaper set on this display'));
  const pick = async (kind: 'video' | 'image' | 'folder') => {
    const p = await api.ambience.pickMedia(kind);
    if (!p) return;
    const src: WallpaperSource = kind === 'video' ? { kind: 'video', path: p, muted: true } : kind === 'image' ? { kind: 'image', path: p, motion: 'drift' } : { kind: 'folder', path: p, interval: 300, motion: 'drift', shuffle: true };
    setDraft(src);
    apply(src);
  };
  const fromPhoto = async () => {
    const p = await api.ambience.pickMedia('image');
    if (!p) return;
    const thumb = await api.files.thumbnail(p, 160);
    if (!thumb) return toast('That picture could not be read');
    const img = new Image();
    img.src = thumb;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const colors = paletteFromPixels(ctx.getImageData(0, 0, c.width, c.height).data);
    const pal: NamedPalette = { id: newId('p'), name: p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '').slice(0, 24), colors, custom: true };
    await api.ambience.savePalette(pal);
    if (scene) setDraft({ ...scene, palette: pal.id });
    toast('Palette made from your photo');
  };
  const scenes = SCENES.filter((s) => cat === 'all' || s.category === cat);
  return (
    <div>
      <div className="amb-displays">
        <button className={`card amb-display ${target === 'all' ? 'on' : ''}`} onClick={() => setTarget('all')}><Icon name="grid" size={16} /><span><b>Every display</b><span className="muted small" style={{ display: 'block' }}>{describeSource(a.wallpaper.default)}</span></span></button>
        {state.displays.map((d) => (
          <button key={d.id} className={`card amb-display ${target === d.id ? 'on' : ''}`} onClick={() => setTarget(d.id)} data-testid={`amb-display-${d.id}`}>
            <Icon name="laptop" size={16} />
            <span><b>{d.label}{d.primary ? ' · main' : ''}</b><span className="muted small" style={{ display: 'block' }}>{d.width}×{d.height} · {a.wallpaper.perDisplay[d.id] ? describeSource(d.source) : 'Same as every display'}</span>
              {d.live ? <span className={`small ${d.live.running ? 'amb-ok' : 'muted'}`} style={{ display: 'block' }}>{d.live.running ? `Live · ${d.live.fps} fps at ${Math.round(d.live.scale * 100)}%` : `Paused · ${d.live.reason ?? ''}`}</span> : null}
            </span>
          </button>
        ))}
      </div>
      {target !== 'all' && a.wallpaper.perDisplay[target] ? <div className="row small" style={{ margin: '6px 0' }}><button className="btn ghost sm" onClick={() => void api.ambience.set({ wallpaper: { ...a.wallpaper, perDisplay: Object.fromEntries(Object.entries(a.wallpaper.perDisplay).filter(([k]) => k !== target)) } })}>Use the same as every display</button><button className="btn ghost sm" onClick={() => apply({ kind: 'none' })}>Leave this display alone</button></div> : null}

      <div className="amb-studio">
        <div className="amb-studio-preview">
          <ScenePreview source={draft} palettes={a.palettes} testid="amb-preview" />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" data-testid="amb-apply" onClick={() => apply()}><Icon name="check" size={13} /> Use {target === 'all' ? 'on every display' : 'on this display'}</button>
            {scene ? <button className="btn" onClick={() => setDraft({ ...scene, params: { ...scene.params, seed: Math.floor(Math.random() * 1000) } })}><Icon name="shuffle" size={13} /> Shuffle</button> : null}
          </div>
        </div>
        {scene ? (
          <div className="amb-studio-controls card pad">
            <b>{sceneById(scene.scene)?.name}</b>
            <span className="muted small">{sceneById(scene.scene)?.description}</span>
            <ParamSlider label="Speed" k="speed" min={0} max={3} step={0.05} params={scene.params} set={(p) => setDraft({ ...scene, params: p })} />
            <ParamSlider label="Intensity" k="intensity" min={0} max={1} step={0.02} params={scene.params} set={(p) => setDraft({ ...scene, params: p })} />
            <ParamSlider label="Scale" k="scale" min={0.25} max={4} step={0.05} params={scene.params} set={(p) => setDraft({ ...scene, params: p })} />
            <ParamSlider label="Grain" k="grain" min={0} max={1} step={0.02} params={scene.params} set={(p) => setDraft({ ...scene, params: p })} />
            <ParamSlider label="Vignette" k="vignette" min={0} max={1} step={0.02} params={scene.params} set={(p) => setDraft({ ...scene, params: p })} />
            <div className="amb-palettes">
              {allPalettes.map((p) => <button key={p.id} title={p.name} className={`amb-palette ${scene.palette === p.id ? 'on' : ''}`} style={{ background: paletteCss(p.colors) }} onClick={() => setDraft({ ...scene, palette: p.id })} />)}
              <button className="amb-palette add" title="Palette from a photo" aria-label="Palette from a photo" onClick={() => void fromPhoto()}><Icon name="image" size={13} /></button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="section-head"><h2>Scenes</h2><div className="row">{(['all', ...SCENE_CATEGORIES] as const).map((c) => <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c === 'all' ? 'All' : c}</button>)}</div></div>
      <div className="amb-scenes">
        {scenes.map((s) => {
          const pal = paletteById(s.palette).colors;
          return (
            <button key={s.id} className={`card amb-scene ${scene?.scene === s.id ? 'on' : ''}`} data-testid={`amb-scene-${s.id}`} onClick={() => setDraft(sceneSource(s.id, scene?.scene === s.id ? scene.palette : undefined))}>
              <span className="amb-scene-swatch" style={{ background: paletteCss(pal) }}><span className="badge">{s.category}</span></span>
              <b>{s.name}</b><span className="muted small">{s.description}</span>
            </button>
          );
        })}
      </div>

      <div className="section-head"><h2>Your own</h2><span className="muted small">Videos play muted and loop; pictures can drift or breathe.</span></div>
      <div className="grid cols-auto">
        <button className="card pad hover amb-own" onClick={() => void pick('video')}><Icon name="video" size={18} /><span><b>A video…</b><span className="muted small" style={{ display: 'block' }}>MP4, WebM or MOV, looped</span></span></button>
        <button className="card pad hover amb-own" onClick={() => void pick('image')}><Icon name="image" size={18} /><span><b>A picture…</b><span className="muted small" style={{ display: 'block' }}>Still, drifting or breathing</span></span></button>
        <button className="card pad hover amb-own" onClick={() => void pick('folder')}><Icon name="folder" size={18} /><span><b>A folder of pictures…</b><span className="muted small" style={{ display: 'block' }}>A new one every few minutes</span></span></button>
        <div className="card pad amb-own"><Icon name="globe" size={18} /><span className="grow"><b>A web page</b><input className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} style={{ marginTop: 4, width: '100%' }} /></span><button className="btn sm" disabled={!/^https?:\/\/./.test(url)} onClick={() => { const s: WallpaperSource = { kind: 'web', url }; setDraft(s); apply(s); }}>Use</button></div>
      </div>
      {draft.kind === 'image' || draft.kind === 'folder' ? (
        <div className="row" style={{ marginTop: 10 }}>
          <span className="small muted">Motion</span>
          <div className="seg">{(['still', 'drift', 'breathe'] as const).map((m) => <button key={m} className={draft.motion === m ? 'on' : ''} onClick={() => { const s = { ...draft, motion: m }; setDraft(s); apply(s); }}>{m[0].toUpperCase() + m.slice(1)}</button>)}</div>
          {draft.kind === 'folder' ? <><span className="small muted">Every</span><select className="input" value={draft.interval} onChange={(e) => { const s = { ...draft, interval: Number(e.target.value) }; setDraft(s); apply(s); }}>{[60, 300, 900, 3600].map((n) => <option key={n} value={n}>{n < 3600 ? `${n / 60} min` : '1 hour'}</option>)}</select></> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- schedule

function RuleForm({ state, onAdd }: { state: AmbienceState; onAdd: (r: VibeRule) => void }) {
  const vibes = state.settings.vibes;
  const [kind, setKind] = useState<RuleWhen['kind']>('time');
  const [vibe, setVibe] = useState(vibes[0]?.id ?? '');
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('17:00');
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [sun, setSun] = useState<'sunrise' | 'sunset'>('sunset');
  const [offset, setOffset] = useState(0);
  const [below, setBelow] = useState(0);
  const when = (): RuleWhen => (kind === 'time' ? { kind, from, to, days } : kind === 'sun' ? { kind, from: sun, offsetMin: offset } : kind === 'battery' ? { kind, below: below || null } : { kind: 'focus' });
  return (
    <div className="card pad amb-rule-form" data-testid="amb-rule-form">
      <span className="small muted">Switch to</span>
      <select className="input" value={vibe} onChange={(e) => setVibe(e.target.value)} data-testid="amb-rule-vibe">{vibes.map((v) => <option key={v.id} value={v.id}>{v.emoji} {v.name}</option>)}</select>
      <div className="seg">{(['time', 'sun', 'battery', 'focus'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{{ time: 'Time', sun: 'Sun', battery: 'Battery', focus: 'Focus' }[k]}</button>)}</div>
      {kind === 'time' ? <><input className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />–<input className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} /><span className="row">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <button key={i} className={`chip ${days.includes(i) ? 'on' : ''}`} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}>{d}</button>)}</span></> : null}
      {kind === 'sun' ? <><span className="small muted">from</span><select className="input" value={sun} onChange={(e) => setSun(e.target.value as 'sunrise')}><option value="sunrise">sunrise</option><option value="sunset">sunset</option></select><input className="input" type="number" style={{ width: 70 }} value={offset} onChange={(e) => setOffset(Number(e.target.value))} /><span className="small muted">min (until {sun === 'sunrise' ? 'sunset' : 'sunrise'})</span></> : null}
      {kind === 'battery' ? <><span className="small muted">on battery, below</span><input className="input" type="number" min={0} max={100} style={{ width: 70 }} value={below} onChange={(e) => setBelow(Number(e.target.value))} /><span className="small muted">% (0: any level)</span></> : null}
      {kind === 'focus' ? <span className="small muted">while a Keeper focus session runs</span> : null}
      <button className="btn primary sm" data-testid="amb-rule-add" disabled={!vibe} onClick={() => onAdd({ id: newId('r'), vibe, enabled: true, when: when() })}>Add rule</button>
    </div>
  );
}

function ScheduleTab({ state }: { state: AmbienceState }) {
  const s = state.settings.schedule;
  const vibes = state.settings.vibes;
  const save = (rules: VibeRule[]) => void api.ambience.saveRules(rules);
  const setSched = (patch: Partial<typeof s>) => void api.ambience.set({ schedule: { ...s, ...patch } });
  const move = (i: number, d: -1 | 1) => { const r = [...s.rules]; const [x] = r.splice(i, 1); r.splice(Math.max(0, Math.min(r.length, i + d)), 0, x); save(r); };
  const { settings } = useStore();
  const place = s.location?.name ?? settings?.island?.place?.name;
  return (
    <div>
      <div className="card pad row amb-sched-head">
        <Toggle on={s.enabled} onChange={(v) => setSched({ enabled: v })} />
        <span className="grow"><b>Switch vibes on a schedule</b><span className="muted small" style={{ display: 'block' }}>{state.scheduled.vibe ? <>Now: {vibes.find((v) => v.id === state.scheduled.vibe)?.name} {state.scheduled.rule ? `(${state.scheduled.rule})` : '(when nothing else applies)'}</> : 'The first rule that applies wins. A vibe you pick yourself stays until the next change.'}</span></span>
        <span className="row"><span className="small muted">Presets</span>{(['day-night', 'work-week', 'battery'] as const).map((p) => <button key={p} className="btn sm" data-testid={`amb-preset-${p}`} onClick={() => save([...s.rules, ...presetRules(p, vibes)])}>{{ 'day-night': 'Day & night', 'work-week': 'Work week', battery: 'On battery' }[p]}</button>)}</span>
      </div>
      <div className="amb-rules" data-testid="amb-rules">
        {s.rules.map((r, i) => (
          <div key={r.id} className="card amb-rule">
            <Toggle on={r.enabled} onChange={(v) => save(s.rules.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))} />
            <span className="grow">{describeRule(r, vibes)}</span>
            <button className="btn ghost icon sm" disabled={!i} onClick={() => move(i, -1)} title="Higher priority" aria-label="Higher priority"><Icon name="arrowUp" size={12} /></button>
            <button className="btn ghost icon sm" onClick={() => save(s.rules.filter((x) => x.id !== r.id))} title="Remove" aria-label="Remove"><Icon name="trash" size={12} /></button>
          </div>
        ))}
        {!s.rules.length ? <div className="muted small" style={{ padding: 10 }}>No rules yet: add one below, or start from a preset.</div> : null}
      </div>
      <RuleForm state={state} onAdd={(r) => save([...s.rules, r])} />
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="card pad">
          <b>Sunrise and sunset</b>
          <div className="muted small">{place ? `Worked out on this computer for ${place} (from Weather or the Island).` : 'No place chosen: these times are used. Choose a place in Weather for real sun times.'}</div>
          {!place ? <div className="row" style={{ marginTop: 8 }}><span className="small">Sunrise</span><input className="input" type="time" value={s.manualSun.sunrise} onChange={(e) => setSched({ manualSun: { ...s.manualSun, sunrise: e.target.value } })} /><span className="small">Sunset</span><input className="input" type="time" value={s.manualSun.sunset} onChange={(e) => setSched({ manualSun: { ...s.manualSun, sunset: e.target.value } })} /></div> : null}
        </div>
        <div className="card pad">
          <b>When no rule applies</b>
          <select className="input" style={{ marginTop: 8 }} value={s.fallback ?? ''} onChange={(e) => setSched({ fallback: e.target.value || null })}><option value="">Keep the current vibe</option>{vibes.map((v) => <option key={v.id} value={v.id}>{v.emoji} {v.name}</option>)}</select>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- folder icons

async function svgToPng(svg: string, size = 512): Promise<string> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d')!.drawImage(img, 0, 0, size, size);
  return c.toDataURL('image/png');
}

function IconsTab({ state }: { state: AmbienceState }) {
  const { toast } = useStore();
  const [spec, setSpec] = useState<FolderIconSpec>({ pattern: 'gradient', color: ICON_COLORS[0][0], color2: ICON_COLORS[0][1], symbol: '★' });
  const svg = useMemo(() => folderIconSvg(spec, 160), [spec]);
  const records = state.settings.folderIcons;
  const apply = async () => {
    const folders = await api.ambience.pickFolders();
    if (!folders.length) return;
    const png = await svgToPng(folderIconSvg(spec, 512));
    const r = await api.ambience.applyFolderIcon(folders, spec, png);
    toast(r.failed.length ? `${r.done.length} changed, ${r.failed.length} failed: ${r.failed[0].error}` : `New icon on ${r.done.length} folder${r.done.length === 1 ? '' : 's'}`);
  };
  const ownPicture = async () => {
    const p = await api.ambience.pickMedia('image');
    if (!p) return;
    const t = await api.files.thumbnail(p, 512);
    if (t) setSpec({ ...spec, image: t });
  };
  return (
    <div>
      <div className="amb-icon-maker">
        <div className="amb-icon-preview card" data-testid="amb-icon-preview" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="card pad amb-icon-controls">
          <label className="amb-field"><span>Pattern</span><div className="row">{ICON_PATTERNS.map((p) => <button key={p} className={`chip ${spec.pattern === p ? 'on' : ''}`} onClick={() => setSpec({ ...spec, pattern: p, image: undefined })}>{p[0].toUpperCase() + p.slice(1)}</button>)}</div></label>
          <label className="amb-field"><span>Colours</span><div className="row">{ICON_COLORS.map(([a, b]) => <button key={a} className={`amb-palette ${spec.color === a ? 'on' : ''}`} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} onClick={() => setSpec({ ...spec, color: a, color2: b })} aria-label={a} />)}<input type="color" value={spec.color} onChange={(e) => setSpec({ ...spec, color: e.target.value })} /></div></label>
          <label className="amb-field"><span>Symbol</span><input className="input" style={{ width: 90 }} value={spec.symbol} onChange={(e) => setSpec({ ...spec, symbol: [...e.target.value].slice(0, 2).join('') })} placeholder="★ or AB" data-testid="amb-icon-symbol" /><span className="row">{['★', '♥', '✓', '📷', '🎵', '💼', '🎮', '📚'].map((s) => <button key={s} className="chip" onClick={() => setSpec({ ...spec, symbol: s })}>{s}</button>)}</span></label>
          <div className="row"><button className="btn sm" onClick={() => void ownPicture()}><Icon name="image" size={12} /> Your own picture…</button>{spec.image ? <button className="btn ghost sm" onClick={() => setSpec({ ...spec, image: undefined })}>Remove picture</button> : null}</div>
          <button className="btn primary" data-testid="amb-icon-apply" onClick={() => void apply()}><Icon name="folder" size={13} /> Choose folders…</button>
          <span className="muted small">{state.caps.folderIconsHow}</span>
        </div>
      </div>
      <div className="section-head"><h2>Changed folders</h2>{records.length ? <button className="btn sm" data-testid="amb-icon-restore-all" onClick={() => void api.ambience.restoreFolderIcon(records.map((r) => r.folder)).then((r) => toast(`${r.done.length} folder${r.done.length === 1 ? '' : 's'} back to normal`))}>Restore all</button> : null}</div>
      {records.length ? (
        <div className="amb-icon-list" data-testid="amb-icon-list">
          {records.map((r) => (
            <div key={r.folder} className="card amb-rule">
              <span className="amb-icon-mini" dangerouslySetInnerHTML={{ __html: folderIconSvg({ ...r.spec, image: undefined }, 28) }} />
              <span className="grow ellipsis mono small" title={r.folder}>{r.folder}</span>
              <span className="muted small">{new Date(r.appliedAt).toLocaleDateString()}</span>
              <button className="btn sm" onClick={() => void api.ambience.restoreFolderIcon([r.folder])}>Restore</button>
            </div>
          ))}
        </div>
      ) : <div className="muted small">Folders you change are listed here, with their original icon one click away.</div>}
    </div>
  );
}

// ---------------------------------------------------------------- options

const SURFACES: { id: Surface; label: string; hint: string }[] = [
  { id: 'tray', label: 'Menu bar / tray', hint: 'Vibes, scenes, pause and sound in the tray menu' },
  { id: 'island', label: 'Island', hint: 'The Vibes tool in the Island (Settings → Island → Tools can reorder it)' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', hint: 'Next and previous vibe, surprise, pause and the mixer from anywhere' },
  { id: 'palette', label: 'Command palette', hint: 'Vibe and wallpaper commands in ⌘K / Ctrl+K' },
];

function OptionsTab({ state }: { state: AmbienceState }) {
  const { toast, settings, updateSettings } = useStore();
  const isl = settings?.island;
  const inIsland = !!isl && orderedTools(isl.toolOrder, isl.toolsOff).includes('vibes');
  const setSurface = (id: Surface, v: boolean) => {
    // The Island's own tool list decides what it shows; keep the two in step.
    if (id === 'island' && isl) void updateSettings({ island: { ...isl, toolsOff: toggleTool(isl.toolsOff, 'vibes', v) } });
    void api.ambience.set({ surfaces: { ...a.surfaces, [id]: v } });
  };
  const a = state.settings;
  const w = a.wallpaper;
  const setW = (patch: Partial<typeof w>) => void api.ambience.set({ wallpaper: { ...w, ...patch } });
  const [cost, setCost] = useState<WallpaperCost | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const row = (label: string, hint: string, el: React.ReactNode) => <div className="amb-opt"><span className="grow"><b>{label}</b><span className="muted small" style={{ display: 'block' }}>{hint}</span></span>{el}</div>;
  return (
    <div className="grid cols-2 amb-options">
      <div className="card pad">
        <h3>Where it appears</h3>
        {SURFACES.map((s) => <div key={s.id} data-testid={`amb-surface-${s.id}`}>{row(s.label, s.hint, <Toggle on={s.id === 'island' ? inIsland : a.surfaces[s.id]} onChange={(v) => setSurface(s.id, v)} />)}</div>)}
        {a.surfaces.shortcuts ? (
          <div className="amb-shortcuts">
            {(Object.keys(a.shortcuts) as (keyof typeof a.shortcuts)[]).map((k) => <label key={k} className="amb-field"><span>{{ next: 'Next vibe', previous: 'Previous vibe', surprise: 'Surprise me', pause: 'Pause wallpaper', mixer: 'Sound mixer' }[k]}</span><input className="input mono small" value={a.shortcuts[k]} onChange={(e) => void api.ambience.set({ shortcuts: { ...a.shortcuts, [k]: e.target.value } })} /></label>)}
          </div>
        ) : null}
      </div>
      <div className="card pad">
        <h3>Smooth and light</h3>
        {row('Frame rate', 'Scenes never draw faster than this', <select className="input" value={w.fps} onChange={(e) => setW({ fps: Number(e.target.value) as 30 })}>{FRAME_RATES.map((f) => <option key={f} value={f}>{f} fps</option>)}</select>)}
        {row('Quality', 'Efficient draws a quarter of the pixels and scales up', <div className="seg">{(['efficient', 'balanced', 'full'] as const).map((q) => <button key={q} className={w.quality === q ? 'on' : ''} onClick={() => setW({ quality: q })}>{q[0].toUpperCase() + q.slice(1)}</button>)}</div>)}
        {row('Pause on battery', 'Otherwise: half the frame rate at half resolution', <Toggle on={w.pauseOnBattery} onChange={(v) => setW({ pauseOnBattery: v })} />)}
        {row('Save energy on battery', 'Half frame rate and resolution while unplugged', <Toggle on={w.saveOnBattery} onChange={(v) => setW({ saveOnBattery: v })} />)}
        {row('Pause under full-screen apps', 'Video, games and slides get the computer to themselves', <Toggle on={w.pauseInFullscreen} onChange={(v) => setW({ pauseInFullscreen: v })} />)}
        {row('Pause in low power mode', 'When the system asks apps to save energy', <Toggle on={w.pauseOnLowPower} onChange={(v) => setW({ pauseOnLowPower: v })} />)}
        <div className="muted small" style={{ marginTop: 6 }}>Always paused while the screen is locked, the computer sleeps or runs hot, and when the desktop is covered.</div>
      </div>
      <div className="card pad">
        <h3>The desktop picture</h3>
        <div className="muted small">{state.strategyNote}</div>
        {row('Also set the desktop picture', `A still frame of the wallpaper, refreshed now and then. ${state.caps.lockScreen}`, <Toggle on={w.matchDesktopPicture} onChange={(v) => setW({ matchDesktopPicture: v })} />)}
        {state.platform !== 'linux' || state.strategy !== 'still' ? row('Always use a still picture', 'For systems where a live window misbehaves', <Toggle on={w.forceStill} onChange={(v) => setW({ forceStill: v })} />) : null}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn sm" data-testid="amb-still" onClick={() => void api.ambience.setStill().then((r) => toast(r.ok ? `Desktop picture set (${r.how})` : `Could not set it: ${r.error}`))}><Icon name="image" size={12} /> Set a still frame now</button>
          <button className="btn ghost sm" disabled={!a.previousDesktop} onClick={() => void api.ambience.restoreDesktop().then((r) => toast(r.ok ? 'Your previous desktop picture is back' : r.error ?? 'Nothing to restore'))}>Restore previous picture</button>
        </div>
      </div>
      <div className="card pad">
        <h3>What it costs</h3>
        <div className="muted small">Measured on this computer over two seconds: processor time of each wallpaper window, and the shared graphics process.</div>
        <button className="btn sm" style={{ marginTop: 8 }} data-testid="amb-measure" disabled={measuring} onClick={() => { setMeasuring(true); void api.ambience.cost().then(setCost).finally(() => setMeasuring(false)); }}><Icon name="chart" size={12} /> {measuring ? 'Measuring…' : 'Measure now'}</button>
        {cost ? (
          <div className="amb-cost" data-testid="amb-cost">
            {cost.displays.length ? cost.displays.map((d) => <div key={d.id} className="row small"><span className="grow">Display {d.id}</span><b>{d.cpu}% CPU</b><span className="muted">{d.running ? `${d.fps} fps · ${d.frameMs} ms/frame` : 'paused'}</span></div>) : <div className="small muted">No wallpaper windows are open.</div>}
            <div className="row small"><span className="grow">Graphics process (all of Keeper)</span><b>{cost.gpuCpu}% CPU</b></div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

export function Ambience() {
  const { route, go } = useStore();
  const [state] = useAmbience();
  const tab = (TABS.some((t) => t.id === route.arg) ? route.arg : 'theme') as Tab;
  if (!state) return <div className="empty"><Icon name="sparkle" size={30} /></div>;
  const a = state.settings;
  const live = state.features.wallpaper && a.wallpaper.enabled;
  const running = state.displays.filter((d) => d.live?.running).length;
  return (
    <div className="amb-page" data-testid="amb-page">
      <PageHead title="Look & Feel" sub="How your computer looks and sounds: theme, wallpaper and sound, saved together as vibes.">
        <button className="btn" onClick={() => void api.ambience.surprise()} data-testid="amb-surprise"><Icon name="shuffle" size={13} /> Surprise me</button>
        <button className="btn" onClick={() => void api.ambience.openMixer()}><Icon name="audio" size={13} /> Sound mixer</button>
        <label className="amb-live-toggle" data-testid="amb-live"><Toggle on={live} onChange={(v) => void api.ambience.setPlaying(v)} /><span><b>Live wallpaper</b><span className="muted small" style={{ display: 'block' }}>{!live ? 'Off' : state.strategy === 'still' ? 'Still picture mode' : running ? `Playing on ${running} display${running === 1 ? '' : 's'}` : state.displays.find((d) => d.live)?.live?.reason ?? 'Starting…'}</span></span></label>
      </PageHead>
      {isDemo ? <div className="muted small" style={{ marginBottom: 8 }}>In the app, the wallpaper draws behind your desktop icons and the sound plays from a floating mixer.</div> : null}
      <Tabs label="Look & Feel" value={tab} onChange={(id) => go({ name: 'ambience', arg: id })} items={TABS.map((t) => ({ id: t.id, text: t.label, label: <><Icon name={t.icon} size={13} /> {t.label}</>, testId: `amb-tab-${t.id}` }))} />
      <div className="amb-tab">
        {tab === 'theme' ? <div className="card pad" data-testid="amb-theme"><ThemeGallery /></div> : null}
        {tab === 'vibes' ? <VibesTab state={state} /> : null}
        {tab === 'wallpaper' ? <WallpaperTab state={state} /> : null}
        {tab === 'schedule' ? <ScheduleTab state={state} /> : null}
        {tab === 'sound' ? <div><div className="row" style={{ marginBottom: 10 }}><span className="muted small grow">Sounds are made on this computer from noise and filters: nothing is recorded or downloaded. Mix as many as you like.</span><button className="btn sm" onClick={() => void api.ambience.openMixer()}>Open the floating mixer</button></div><div className="card pad"><MixerControls state={state} /></div></div> : null}
        {tab === 'icons' ? <IconsTab state={state} /> : null}
        {tab === 'options' ? <OptionsTab state={state} /> : null}
      </div>
    </div>
  );
}
