// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Convert: video, audio, picture, PDF and file tools in one place. Results go
// to a new folder next to the originals, which are never changed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extOf, kindOf } from '../../core/classify';
import { TOOL_INFO, type ConvertCategory, type ConvertCapabilities, type ConvertOp, type ConvertResult, type ConvertTool, type Corner, type HashAlgo, type SpeechOptions } from '../../core/convert-types';
import { moveItem, normRotate, type OrganizePage } from '../../core/pdf-organize';
import type { Progress } from '../../core/types';
import { api } from '../api';
import { useFeature } from '../features';
import { Icon } from '../components/Icon';
import { KIND_COLOR, PageHead } from '../components/ui';
import { useStore } from '../state';
import '../styles/screens-m.css';
import '../styles/filekit.css';
import { isKitTool, kitBlocked, kitDefaults, type KitOp } from '../../core/filekit/tools';
import { familyOf } from '../../core/filekit/matrix';
import { KitOptions } from './KitOptions';
import { WorkflowsPanel } from './WorkflowsPanel';

const CATEGORIES: { id: ConvertCategory; label: string; icon: string }[] = [
  { id: 'convert', label: 'Convert to…', icon: 'refresh' },
  { id: 'video', label: 'Video', icon: 'video' },
  { id: 'audio', label: 'Audio', icon: 'audio' },
  { id: 'image', label: 'Pictures', icon: 'image' },
  { id: 'pdf', label: 'PDF', icon: 'document' },
  { id: 'doc', label: 'Documents', icon: 'text' },
  { id: 'file', label: 'Any file', icon: 'lock' },
];

type Accept = 'video' | 'audio' | 'image' | 'pdf' | 'document' | 'code' | 'keeper-enc' | '*';

function acceptOf(p: string): Accept {
  const e = extOf(p.split(/[\\/]/).pop() ?? '');
  if (e === 'pdf') return 'pdf';
  if (e === 'keeper-enc') return 'keeper-enc';
  const k = kindOf(p.split(/[\\/]/).pop() ?? '');
  return k === 'video' || k === 'audio' || k === 'image' || k === 'document' || k === 'code' ? k : '*';
}

function fits(tool: ConvertTool, paths: string[]): boolean {
  if (!paths.length) return true;
  const acc = TOOL_INFO[tool].accepts;
  if (acc.includes('*')) return true;
  return paths.every((p) => acc.includes(acceptOf(p)));
}

function defaults(tool: ConvertTool): ConvertOp {
  if (isKitTool(tool)) return kitDefaults(tool);
  switch (tool) {
    case 'video.compress': return { tool, targetMb: 25 };
    case 'video.preset': return { tool, preset: 'email' };
    case 'video.convert': return { tool, format: 'mp4' };
    case 'video.trim': return { tool, start: 0, end: 10 };
    case 'video.audio': return { tool, format: 'mp3' };
    case 'video.mute': return { tool };
    case 'video.rotate': return { tool, degrees: 90 };
    case 'video.speed': return { tool, factor: 2 };
    case 'video.frames': return { tool, fps: 1, format: 'jpg' };
    case 'audio.convert': return { tool, format: 'mp3' };
    case 'audio.normalize': return { tool };
    case 'image.convert': return { tool, format: 'jpg', quality: 85 };
    case 'image.resize': return { tool, maxSide: 1600 };
    case 'image.compress': return { tool, quality: 70 };
    case 'image.strip': return { tool };
    case 'image.rotate': return { tool, degrees: 90 };
    case 'image.watermark': return { tool, text: '', position: 'bottom-right', opacity: 0.7 };
    case 'image.toPdf': return { tool, pageSize: 'a4' };
    case 'image.removeBg': return { tool };
    case 'image.scan': return { tool, mode: 'bw', pageSize: 'a4' };
    case 'pdf.merge': return { tool };
    case 'pdf.split': return { tool, ranges: '' };
    case 'pdf.extract': return { tool, pages: '1' };
    case 'pdf.rotate': return { tool, degrees: 90, pages: '' };
    case 'pdf.reorder': return { tool, order: '' };
    case 'pdf.organize': return { tool, pages: [] };
    case 'doc.translate': return { tool, language: 'en', engine: 'ai' };
    case 'pdf.delete': return { tool, pages: '' };
    case 'pdf.number': return { tool, position: 'bottom-center', start: 1 };
    case 'pdf.watermark': return { tool, text: 'CONFIDENTIAL', opacity: 0.2 };
    case 'pdf.compress': return { tool, quality: 60, maxSide: 1600 };
    case 'pdf.encrypt': return { tool, password: '' };
    case 'pdf.decrypt': return { tool, password: '' };
    case 'pdf.toImages': return { tool, format: 'png', dpi: 150 };
    case 'file.checksum': return { tool, algo: 'sha256' };
    case 'file.verify': return { tool, algo: 'sha256', expected: '' };
    case 'file.encrypt': return { tool, password: '' };
    case 'file.decrypt': return { tool, password: '' };
    case 'file.split': return { tool, sizeMb: 25 };
    case 'file.join': return { tool };
    case 'video.merge': return { tool };
    case 'video.subtitles': return { tool, auto: false, fontSize: 22 };
    case 'video.crop': return { tool, ratio: '1:1' };
    case 'video.flip': return { tool, axis: 'h' };
    case 'video.resize': return { tool, width: 1280, height: 720, mode: 'fit' };
    case 'video.replaceAudio': return { tool, audio: '', mode: 'replace', volume: 1 };
    case 'video.info': return { tool };
    case 'audio.clean': return { tool, strength: 'light', hum: 0 };
    case 'audio.transcribe': return { tool, format: 'txt' };
    case 'image.flip': return { tool, axis: 'h' };
    case 'image.faces': return { tool, style: 'blur' };
    case 'pdf.redact': return { tool, words: '', caseSensitive: false };
    case 'pdf.fill': return { tool, values: {}, flatten: true };
    case 'pdf.sign': return { tool, signature: '', page: 'last', corner: 'bottom-right', width: 0.28, date: true };
    case 'pdf.searchable': return { tool };
    case 'pdf.toWord': return { tool };
    case 'doc.toPdf': return { tool, pageSize: 'a4', onePage: false };
    case 'doc.convert': return { tool, format: 'docx' };
    case 'doc.speak': return { tool, rate: 1, format: 'mp3' };
    case 'file.zip': return { tool, password: '' };
    case 'file.unzip': return { tool, password: '' };
    case 'file.base64': return { tool, urlSafe: false, wrap: 0 };
  }
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="conv-field">
      <span className="conv-label">{label}</span>
      {children}
      {hint ? <span className="small muted">{hint}</span> : null}
    </label>
  );
}

const CORNERS: [Corner, string][] = [['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom'], ['top-right', 'Top right'], ['top-left', 'Top left'], ['center', 'Middle']];

/** Draw with the mouse or a pen, or type a name in a handwriting-style font; saved for next time on this computer. */
function SignaturePad({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [name, setName] = useState('');
  const drawing = useRef(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('signature');
      if (saved && !value) onChange(saved);
    } catch {
      /* none saved */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = (url: string) => {
    onChange(url);
    try {
      localStorage.setItem('signature', url);
    } catch {
      /* storage unavailable */
    }
  };
  const ctx = () => ref.current?.getContext('2d') ?? null;
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * ref.current!.width, ((e.clientY - r.top) / r.height) * ref.current!.height] as const;
  };
  const typed = (text: string) => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 240;
    const g = c.getContext('2d')!;
    g.fillStyle = '#10204a';
    g.font = 'italic 120px "Snell Roundhand", "Segoe Script", "Brush Script MT", "URW Chancery L", cursive';
    g.textBaseline = 'middle';
    g.fillText(text, 20, 125, 860);
    return c.toDataURL('image/png');
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <Seg value={mode} options={[['draw', 'Draw'], ['type', 'Type']]} onChange={setMode} />
      {mode === 'draw' ? (
        <canvas
          ref={ref}
          width={900}
          height={240}
          className="sig-pad"
          style={{ width: '100%', height: 120, background: '#fff', borderRadius: 8, border: '1px solid var(--line)', touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={(e) => { drawing.current = true; const g = ctx(); if (!g) return; const [x, y] = pos(e); g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#10204a'; g.beginPath(); g.moveTo(x, y); (e.target as Element).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (!drawing.current) return; const g = ctx(); if (!g) return; const [x, y] = pos(e); g.lineTo(x, y); g.stroke(); }}
          onPointerUp={() => { drawing.current = false; if (ref.current) save(ref.current.toDataURL('image/png')); }}
        />
      ) : (
        <input className="input" placeholder="Your name" value={name} onChange={(e) => { setName(e.target.value); if (e.target.value.trim()) save(typed(e.target.value)); }} />
      )}
      <div className="row">
        {value ? <img src={value} alt="Your signature" style={{ height: 36, background: '#fff', borderRadius: 6, padding: 2 }} /> : <span className="small muted">No signature yet</span>}
        <button className="btn sm ghost" onClick={() => { ctx()?.clearRect(0, 0, 900, 240); setName(''); onChange(''); try { localStorage.removeItem('signature'); } catch { /* ignore */ } }}>Clear</button>
      </div>
    </div>
  );
}

/** The fields of the first PDF, to fill in. */
function FormEditor({ file, values, onChange }: { file?: string; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const [fields, setFields] = useState<{ name: string; type: string; value: string; options?: string[] }[] | null>(null);
  useEffect(() => {
    setFields(null);
    if (file) void api.convert.pdfFields(file).then(setFields).catch(() => setFields([]));
  }, [file]);
  if (!file) return <div className="small muted">Add a PDF form.</div>;
  if (!fields) return <div className="small muted">Reading the form…</div>;
  if (!fields.length) return <div className="small muted">This PDF has no form fields. Use “Type on the page” below to add text anywhere.</div>;
  return (
    <div className="col" style={{ gap: 8, maxHeight: 280, overflow: 'auto' }}>
      {fields.map((f) => (
        <Field key={f.name} label={f.name}>
          {f.type === 'checkbox' ? <input type="checkbox" checked={!!(values[f.name] ?? f.value)} onChange={(e) => onChange({ ...values, [f.name]: e.target.checked ? 'yes' : '' })} />
            : f.options?.length ? <select className="input" value={values[f.name] ?? f.value} onChange={(e) => onChange({ ...values, [f.name]: e.target.value })}><option value="">—</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
              : <input className="input" value={values[f.name] ?? f.value} onChange={(e) => onChange({ ...values, [f.name]: e.target.value })} />}
        </Field>
      ))}
    </div>
  );
}

function PickOne({ label, value, extensions, onChange }: { label: string; value?: string; extensions: string[]; onChange: (p: string) => void }) {
  return (
    <Field label={label}>
      <div className="row">
        <span className="ellipsis small grow" title={value}>{value ? value.split(/[\\/]/).pop() : 'None chosen'}</span>
        <button className="btn sm" onClick={() => void api.settings.pickFiles({ extensions }).then((p) => p[0] && onChange(p[0]))}>Choose…</button>
      </div>
    </Field>
  );
}

type OrgPage = OrganizePage & { key: string; thumb: string };

/** Every page as a picture: drag to reorder, turn, remove, or add pages from other PDFs. */
function PdfOrganizer({ files, set }: { files: string[]; set: (p: OrganizePage[]) => void }) {
  const [items, setItems] = useState<OrgPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const seq = useRef(0);
  const load = useCallback(async (file: string): Promise<OrgPage[]> => {
    const thumbs = await api.convert.pdfThumbs(file);
    return thumbs.map((thumb, page) => ({ file, page, rotate: 0, thumb, key: `${++seq.current}` }));
  }, []);
  const commit = (next: OrgPage[]) => { setItems(next); set(next.map(({ file, page, rotate }) => ({ file, page, rotate }))); };
  useEffect(() => {
    if (!files[0]) return;
    setLoading(true);
    setError('');
    void load(files[0]).then((list) => commit(list)).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files[0], load]);
  const insert = async () => {
    const picked = await api.settings.pickFiles({ extensions: ['pdf'] });
    if (!picked[0]) return;
    setLoading(true);
    try { commit([...items, ...(await load(picked[0]))]); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  };
  const fileCount = new Set(items.map((p) => p.file)).size;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 6 }}>
        <span className="small muted grow">{loading ? 'Drawing pages…' : `${items.length} page${items.length === 1 ? '' : 's'}${fileCount > 1 ? ` from ${fileCount} files` : ''}. Drag to reorder.`}</span>
        <button className="btn sm" onClick={() => void insert()}><Icon name="plus" size={12} /> Add pages from a PDF…</button>
        <button className="btn sm ghost" onClick={() => commit(items.slice().reverse())}>Reverse</button>
      </div>
      {error ? <div className="small" style={{ color: 'var(--danger)' }}>{error}</div> : null}
      <div className="org-grid">
        {items.map((p, i) => (
          <div key={p.key} className={`org-page${drag === i ? ' dragging' : ''}${over === i && drag !== i ? ' over' : ''}`} draggable
            onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { e.preventDefault(); setOver(i); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onDrop={(e) => { e.preventDefault(); if (drag !== null) commit(moveItem(items, drag, i)); setDrag(null); setOver(null); }}>
            <div className="org-thumb"><img src={p.thumb} alt={`Page ${i + 1}`} style={{ transform: `rotate(${p.rotate}deg)` }} draggable={false} /></div>
            <div className="org-bar">
              <span className="num small">{i + 1}{fileCount > 1 ? <span className="muted"> · {p.file.split(/[\\/]/).pop()?.slice(0, 10)}</span> : null}</span>
              <button className="btn sm icon" title="Turn left" onClick={() => commit(items.map((x, k) => (k === i ? { ...x, rotate: normRotate(x.rotate - 90) } : x)))}>⟲</button>
              <button className="btn sm icon" title="Turn right" onClick={() => commit(items.map((x, k) => (k === i ? { ...x, rotate: normRotate(x.rotate + 90) } : x)))}>⟳</button>
              <button className="btn sm icon" title="Remove page" onClick={() => commit(items.filter((_, k) => k !== i))}><Icon name="trash" size={12} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const TRANSLATE_LANGS: [string, string][] = [['en', 'English'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['sv', 'Swedish'], ['da', 'Danish'], ['no', 'Norwegian'], ['fi', 'Finnish'], ['et', 'Estonian'], ['cs', 'Czech'], ['tr', 'Turkish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['el', 'Greek'], ['ar', 'Arabic'], ['he', 'Hebrew'], ['hi', 'Hindi'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['id', 'Indonesian'], ['vi', 'Vietnamese'], ['th', 'Thai']];

const SPEECH_LANGS: [string, string][] = [['auto', 'Detect automatically'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['sv', 'Swedish'], ['da', 'Danish'], ['no', 'Norwegian'], ['fi', 'Finnish'], ['cs', 'Czech'], ['el', 'Greek'], ['he', 'Hebrew'], ['id', 'Indonesian'], ['vi', 'Vietnamese'], ['th', 'Thai']];

/** Where speech becomes text: on this computer (default), macOS's own recognizer, or the dictation service. */
function SpeechFields({ op, set }: { op: SpeechOptions; set: (o: SpeechOptions) => void }) {
  const mac = navigator.platform.startsWith('Mac');
  const deviceOn = useFeature('speechModel');
  const engine = op.engine ?? (deviceOn ? 'device' : 'service');
  useEffect(() => { if (!op.engine && !deviceOn) set({ engine: 'service' }); }, [deviceOn]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Field label="Listen" hint={engine === 'device' ? 'Runs a speech model on this computer: nothing is uploaded. It is downloaded once, the first time.' : engine === 'system' ? "Uses macOS's own on-device speech recognizer." : 'Uses the speech-to-text service chosen for dictation (Island settings).'}>
        <Seg value={engine} options={[...(deviceOn ? [['device', 'On this computer'] as ['device', string]] : []), ...(mac ? [['system', 'macOS recognizer'] as ['system', string]] : []), ['service', 'Dictation service']]} onChange={(e) => set({ engine: e })} />
      </Field>
      {engine === 'device' ? <Field label="Model"><Seg value={op.model ?? 'base'} options={[['tiny', 'Fast'], ['base', 'Balanced'], ['small', 'Most accurate']]} onChange={(model) => set({ model })} /></Field> : null}
      {engine !== 'service' ? <Field label="Language"><select value={op.language ?? 'auto'} onChange={(e) => set({ language: e.target.value })}>{SPEECH_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field> : null}
    </>
  );
}

function Options({ op, set, duration, pages, files }: { op: ConvertOp; set: (o: ConvertOp) => void; duration: number | null; pages: number | null; files: string[] }) {
  const num = (v: string, d = 0) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const pageHint = pages ? `This PDF has ${pages} page${pages === 1 ? '' : 's'}. Use 1-3, 5, 8- or “last”.` : 'Use 1-3, 5, 8- or “last”.';
  switch (op.tool) {
    case 'video.compress':
      return <Field label="Target size (MB)" hint="Keeper picks the best quality that fits."><input className="input" type="number" min={1} value={op.targetMb} onChange={(e) => set({ ...op, targetMb: num(e.target.value, 25) })} /></Field>;
    case 'video.preset':
      return <Field label="Make it fit"><Seg value={op.preset} options={[['email', 'E-mail 25 MB'], ['whatsapp', 'Messaging 16 MB'], ['discord', 'Chat 10 MB'], ['720p', '720p'], ['1080p', '1080p']]} onChange={(preset) => set({ ...op, preset })} /></Field>;
    case 'video.convert':
      return (
        <>
          <Field label="Format"><Seg value={op.format} options={[['mp4', 'MP4'], ['webm', 'WebM'], ['mov', 'MOV'], ['gif', 'GIF']]} onChange={(format) => set({ ...op, format })} /></Field>
          <Field label="Width (optional)" hint={op.format === 'gif' ? 'GIFs default to 480 px wide at 12 frames a second.' : 'Leave empty to keep the size.'}>
            <input className="input" type="number" min={16} value={op.width ?? ''} placeholder="Keep" onChange={(e) => set({ ...op, width: e.target.value ? num(e.target.value) : undefined })} />
          </Field>
          {op.format === 'gif' ? <Field label="Frames per second"><input className="input" type="number" min={1} max={30} value={op.fps ?? 12} onChange={(e) => set({ ...op, fps: num(e.target.value, 12) })} /></Field> : null}
        </>
      );
    case 'video.trim':
      return (
        <div className="row">
          <Field label="Start (seconds)"><input className="input" type="number" min={0} step={0.1} value={op.start} onChange={(e) => set({ ...op, start: num(e.target.value) })} /></Field>
          <Field label="End (seconds)" hint={duration ? `The clip is ${mmss(duration)} long.` : undefined}><input className="input" type="number" min={0} step={0.1} value={op.end} onChange={(e) => set({ ...op, end: num(e.target.value) })} /></Field>
          <label className="row small" style={{ alignSelf: 'flex-end' }}><input type="checkbox" checked={!!op.lossless} onChange={(e) => set({ ...op, lossless: e.target.checked })} /> Instant, no quality loss (cuts at the nearest keyframe)</label>
        </div>
      );
    case 'video.audio':
      return <Field label="Format"><Seg value={op.format} options={[['mp3', 'MP3'], ['m4a', 'M4A']]} onChange={(format) => set({ ...op, format })} /></Field>;
    case 'video.rotate':
    case 'image.rotate':
      return <Field label="Turn by"><Seg value={op.degrees} options={[[90, '90° right'], [180, '180°'], [270, '90° left']]} onChange={(degrees) => set({ ...op, degrees })} /></Field>;
    case 'video.speed':
      return <Field label="Speed"><Seg value={op.factor} options={[[0.5, '0.5×'], [1.5, '1.5×'], [2, '2×'], [4, '4×'], [8, '8×']]} onChange={(factor) => set({ ...op, factor })} /></Field>;
    case 'video.frames':
      return (
        <>
          <Field label="Pictures per second"><input className="input" type="number" min={0.1} step={0.1} value={op.fps} onChange={(e) => set({ ...op, fps: num(e.target.value, 1) })} /></Field>
          <Field label="Format"><Seg value={op.format} options={[['jpg', 'JPEG'], ['png', 'PNG']]} onChange={(format) => set({ ...op, format })} /></Field>
        </>
      );
    case 'audio.convert':
      return <Field label="Format"><Seg value={op.format} options={[['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV'], ['flac', 'FLAC'], ['ogg', 'OGG'], ['aiff', 'AIFF']]} onChange={(format) => set({ ...op, format })} /></Field>;
    case 'image.convert':
      return (
        <>
          <Field label="Format"><Seg value={op.format} options={[['jpg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP'], ['avif', 'AVIF'], ['tiff', 'TIFF'], ['gif', 'GIF'], ...(navigator.platform.startsWith('Mac') ? [['heic', 'HEIC'] as ['heic', string]] : [])]} onChange={(format) => set({ ...op, format })} /></Field>
          {['jpg', 'webp', 'avif'].includes(op.format) ? <Field label={`Quality ${op.quality ?? 85}`}><input type="range" min={30} max={100} value={op.quality ?? 85} onChange={(e) => set({ ...op, quality: +e.target.value })} /></Field> : null}
        </>
      );
    case 'image.resize':
      return (
        <>
          <Field label="Resize by"><Seg value={op.width ? 'exact' : op.percent ? 'percent' : 'side'} options={[['side', 'Longest side'], ['percent', 'Percent'], ['exact', 'Exact size']]} onChange={(v) => set(v === 'percent' ? { tool: op.tool, percent: 50 } : v === 'exact' ? { tool: op.tool, width: 1080, height: 1080 } : { tool: op.tool, maxSide: 1600 })} /></Field>
          {op.width
            ? <div className="row"><Field label="Width"><input className="input" type="number" min={1} value={op.width} onChange={(e) => set({ ...op, width: num(e.target.value, 1080) })} /></Field><Field label="Height"><input className="input" type="number" min={1} value={op.height ?? 1080} onChange={(e) => set({ ...op, height: num(e.target.value, 1080) })} /></Field></div>
            : op.percent
            ? <Field label="Percent"><input className="input" type="number" min={1} max={400} value={op.percent} onChange={(e) => set({ ...op, percent: num(e.target.value, 50) })} /></Field>
            : <Field label="Longest side (pixels)" hint="Smaller pictures are left as they are."><input className="input" type="number" min={16} value={op.maxSide ?? 1600} onChange={(e) => set({ ...op, maxSide: num(e.target.value, 1600) })} /></Field>}
        </>
      );
    case 'image.compress':
      return <Field label={`Quality ${op.quality}`} hint="70 looks the same to most eyes and is often half the size."><input type="range" min={20} max={95} value={op.quality} onChange={(e) => set({ ...op, quality: +e.target.value })} /></Field>;
    case 'image.watermark':
      return (
        <>
          <Field label="Text"><input className="input" value={op.text} placeholder="© Your name" onChange={(e) => set({ ...op, text: e.target.value })} /></Field>
          <Field label="Where"><select className="input" value={op.position} onChange={(e) => set({ ...op, position: e.target.value as Corner })}>{CORNERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label={`Opacity ${Math.round(op.opacity * 100)}%`}><input type="range" min={10} max={100} value={Math.round(op.opacity * 100)} onChange={(e) => set({ ...op, opacity: +e.target.value / 100 })} /></Field>
        </>
      );
    case 'image.toPdf':
      return <Field label="Page size" hint="Pictures are added in the order shown above."><Seg value={op.pageSize} options={[['a4', 'A4'], ['letter', 'Letter'], ['fit', 'Fit picture']]} onChange={(pageSize) => set({ ...op, pageSize })} /></Field>;
    case 'pdf.split':
      return <Field label="Ranges (optional)" hint="Empty makes one PDF per page. “1-3, 4-6” makes two PDFs."><input className="input" value={op.ranges ?? ''} placeholder="Every page" onChange={(e) => set({ ...op, ranges: e.target.value })} /></Field>;
    case 'pdf.extract':
      return <Field label="Pages" hint={pageHint}><input className="input" value={op.pages} onChange={(e) => set({ ...op, pages: e.target.value })} /></Field>;
    case 'pdf.delete':
      return <Field label="Pages to delete" hint={pageHint}><input className="input" value={op.pages} placeholder="2, 5-6" onChange={(e) => set({ ...op, pages: e.target.value })} /></Field>;
    case 'doc.translate':
      return (
        <>
          <Field label="Into"><select value={op.language} onChange={(e) => set({ ...op, language: e.target.value })}>{TRANSLATE_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Translate with" hint={(op.engine ?? 'ai') === 'ai' ? 'Uses the AI chosen in Settings → Assistant. A local model (Ollama) keeps the document on this computer.' : "macOS's own translator works on this Mac, offline once its languages are downloaded (macOS 26 or later)."}>
            <Seg value={op.engine ?? 'ai'} options={[['ai', "Keeper's AI"], ...(navigator.platform.startsWith('Mac') ? [['system', 'macOS translator'] as ['system', string]] : [])]} onChange={(engine) => set({ ...op, engine })} />
          </Field>
          <div className="small muted">Word files keep their styles, tables and pictures; Markdown its marks and code; web pages their tags; subtitles their timings. A copy is saved, like “Report.de.docx”.</div>
        </>
      );
    case 'pdf.organize':
      return <PdfOrganizer files={files} set={(p) => set({ ...op, pages: p })} />;
    case 'pdf.reorder':
      return <Field label="New order" hint={`List every page in the order you want, e.g. ${pages && pages > 2 ? `3, 1-2, 4-${pages}` : '3, 1, 2'} or ${pages ? `${pages}-1` : 'last-1'} to reverse.`}><input className="input" value={op.order} onChange={(e) => set({ ...op, order: e.target.value })} /></Field>;
    case 'pdf.rotate':
      return (
        <>
          <Field label="Turn by"><Seg value={op.degrees} options={[[90, '90° right'], [180, '180°'], [270, '90° left']]} onChange={(degrees) => set({ ...op, degrees })} /></Field>
          <Field label="Pages (optional)" hint="Empty turns every page."><input className="input" value={op.pages ?? ''} placeholder="All pages" onChange={(e) => set({ ...op, pages: e.target.value })} /></Field>
        </>
      );
    case 'pdf.number':
      return (
        <>
          <Field label="Where"><select className="input" value={op.position} onChange={(e) => set({ ...op, position: e.target.value as Corner })}>{CORNERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Start at"><input className="input" type="number" min={0} value={op.start ?? 1} onChange={(e) => set({ ...op, start: num(e.target.value, 1) })} /></Field>
        </>
      );
    case 'pdf.watermark':
      return (
        <>
          <Field label="Text"><input className="input" value={op.text} onChange={(e) => set({ ...op, text: e.target.value })} /></Field>
          <Field label={`Opacity ${Math.round(op.opacity * 100)}%`}><input type="range" min={5} max={80} value={Math.round(op.opacity * 100)} onChange={(e) => set({ ...op, opacity: +e.target.value / 100 })} /></Field>
        </>
      );
    case 'pdf.compress':
      return (
        <>
          <Field label={`Photo quality ${op.quality}`}><input type="range" min={25} max={90} value={op.quality} onChange={(e) => set({ ...op, quality: +e.target.value })} /></Field>
          <Field label="Largest photo side (pixels)"><Seg value={op.maxSide} options={[[1000, 'Screen'], [1600, 'Balanced'], [2400, 'Print']]} onChange={(maxSide) => set({ ...op, maxSide })} /></Field>
        </>
      );
    case 'pdf.encrypt':
      return (
        <>
          <Field label="Password to open" hint="Uses AES-256, which every current PDF reader supports."><input className="input" type="password" autoComplete="new-password" value={op.password} onChange={(e) => set({ ...op, password: e.target.value })} /></Field>
          <Field label="People who open it may">
            <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
              <label className="row small"><input type="checkbox" checked={op.allowPrint !== false} onChange={(e) => set({ ...op, allowPrint: e.target.checked })} /> Print</label>
              <label className="row small"><input type="checkbox" checked={op.allowCopy !== false} onChange={(e) => set({ ...op, allowCopy: e.target.checked })} /> Copy text</label>
              <label className="row small"><input type="checkbox" checked={op.allowEdit !== false} onChange={(e) => set({ ...op, allowEdit: e.target.checked })} /> Change, comment, fill in</label>
            </div>
          </Field>
          {op.allowPrint === false || op.allowCopy === false || op.allowEdit === false ? (
            <Field label="Owner password (optional)" hint="Lifts the limits. Left empty, Keeper makes one nobody knows, so the limits stay. Readers that respect PDF rules enforce them; they cannot stop a screenshot."><input className="input" type="password" autoComplete="new-password" value={op.ownerPassword ?? ''} onChange={(e) => set({ ...op, ownerPassword: e.target.value || undefined })} /></Field>
          ) : null}
        </>
      );
    case 'file.encrypt':
      return <Field label="Password" hint={op.tool === 'file.encrypt' ? 'Keeper cannot recover a lost password — keep it somewhere safe.' : 'Uses AES-256, which every current PDF reader supports.'}><input className="input" type="password" autoComplete="new-password" value={op.password} onChange={(e) => set({ ...op, password: e.target.value })} /></Field>;
    case 'pdf.decrypt':
    case 'file.decrypt':
      return <Field label="Password"><input className="input" type="password" value={op.password} onChange={(e) => set({ ...op, password: e.target.value })} /></Field>;
    case 'pdf.toImages':
      return (
        <>
          <Field label="Format"><Seg value={op.format} options={[['png', 'PNG'], ['jpg', 'JPEG']]} onChange={(format) => set({ ...op, format })} /></Field>
          <Field label="Sharpness"><Seg value={op.dpi} options={[[72, 'Screen'], [150, 'Good'], [300, 'Print']]} onChange={(dpi) => set({ ...op, dpi })} /></Field>
        </>
      );
    case 'file.checksum':
      return <Field label="Kind"><Seg<HashAlgo> value={op.algo} options={[['sha256', 'SHA-256'], ['sha512', 'SHA-512'], ['sha1', 'SHA-1'], ['md5', 'MD5']]} onChange={(algo) => set({ ...op, algo })} /></Field>;
    case 'file.verify':
      return <Field label="Checksum from the website" hint="Paste it as shown; the kind is detected from its length."><input className="input mono" value={op.expected} placeholder="e.g. 9f86d08188…" onChange={(e) => set({ ...op, expected: e.target.value })} /></Field>;
    case 'file.split':
      return <Field label="Part size (MB)" hint="Join the parts again with Join parts."><Seg value={op.sizeMb} options={[[8, '8 MB'], [25, '25 MB'], [100, '100 MB'], [1024, '1 GB'], [4000, '4 GB']]} onChange={(sizeMb) => set({ ...op, sizeMb })} /></Field>;
    case 'video.merge':
      return <div className="small muted">Clips are joined in the order shown above (use the arrows). Matching clips are joined instantly without losing quality; mixed ones are re-encoded to the first clip’s size.</div>;
    case 'video.subtitles':
      return (
        <>
          <PickOne label="Subtitle file" value={op.file} extensions={['srt', 'vtt', 'ass']} onChange={(file) => set({ ...op, file, auto: false })} />
          <label className="row small"><input type="checkbox" checked={!!op.auto} onChange={(e) => set({ ...op, auto: e.target.checked, file: e.target.checked ? undefined : op.file })} /> No file? Transcribe the speech automatically</label>
          {op.auto ? <SpeechFields op={op} set={(o) => set({ ...op, ...o })} /> : null}
          <Field label="Text size"><Seg value={op.fontSize} options={[[18, 'Small'], [22, 'Medium'], [28, 'Large']]} onChange={(fontSize) => set({ ...op, fontSize })} /></Field>
          <div className="small muted">A subtitle file with the same name next to the video is used automatically.</div>
        </>
      );
    case 'video.crop':
      return <Field label="Shape"><Seg value={op.ratio} options={[['1:1', 'Square'], ['9:16', 'Portrait 9:16'], ['4:5', '4:5'], ['16:9', 'Wide 16:9'], ['4:3', '4:3'], ['21:9', 'Cinema']]} onChange={(ratio) => set({ ...op, ratio })} /></Field>;
    case 'video.flip':
    case 'image.flip':
      return <Field label="Flip"><Seg value={op.axis} options={[['h', 'Left ↔ right'], ['v', 'Upside down']]} onChange={(axis) => set({ ...op, axis })} /></Field>;
    case 'video.resize':
      return (
        <>
          <div className="row">
            <Field label="Width"><input className="input" type="number" value={op.width} onChange={(e) => set({ ...op, width: num(e.target.value, 1280) })} /></Field>
            <Field label="Height"><input className="input" type="number" value={op.height} onChange={(e) => set({ ...op, height: num(e.target.value, 720) })} /></Field>
          </div>
          <Seg value={`${op.width}x${op.height}`} options={[['3840x2160', '4K'], ['1920x1080', '1080p'], ['1280x720', '720p'], ['1080x1920', 'Vertical'], ['1080x1080', 'Square']]} onChange={(v) => { const [w, h] = v.split('x').map(Number); set({ ...op, width: w, height: h }); }} />
          <Field label="Fitting"><Seg value={op.mode} options={[['fit', 'Fit inside (bars)'], ['fill', 'Fill (crop edges)'], ['exact', 'Stretch exactly']]} onChange={(mode) => set({ ...op, mode })} /></Field>
        </>
      );
    case 'video.replaceAudio':
      return (
        <>
          <PickOne label="New sound" value={op.audio} extensions={['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'mp4', 'mov']} onChange={(audio) => set({ ...op, audio })} />
          <Field label="How"><Seg value={op.mode} options={[['replace', 'Replace the sound'], ['mix', 'Mix under the original']]} onChange={(mode) => set({ ...op, mode })} /></Field>
          {op.mode === 'mix' ? <Field label={`New sound volume ${Math.round(op.volume * 100)}%`}><input type="range" min={0.05} max={1.5} step={0.05} value={op.volume} onChange={(e) => set({ ...op, volume: +e.target.value })} /></Field> : null}
        </>
      );
    case 'video.info':
      return <div className="small muted">Shows codecs, picture size, frame rate, bitrates, sound and details for each file, ready to copy.</div>;
    case 'audio.clean':
      return (
        <>
          <Field label="Strength"><Seg value={op.strength} options={[['light', 'Light'], ['strong', 'Strong']]} onChange={(strength) => set({ ...op, strength })} /></Field>
          <Field label="Mains hum" hint="50 Hz in Europe, Africa and most of Asia; 60 Hz in the Americas."><Seg value={op.hum} options={[[0, 'None'], [50, '50 Hz'], [60, '60 Hz']]} onChange={(hum) => set({ ...op, hum })} /></Field>
        </>
      );
    case 'audio.transcribe':
      return (
        <>
          <Field label="Save as"><Seg value={op.format} options={[['txt', 'Text'], ['timestamps', 'Text with times'], ['srt', 'Subtitles (.srt)'], ['vtt', 'Web subtitles (.vtt)']]} onChange={(format) => set({ ...op, format })} /></Field>
          <SpeechFields op={op} set={(o) => set({ ...op, ...o })} />
        </>
      );
    case 'image.removeBg':
      return <Field label="Background"><Seg value={op.background ?? ''} options={[['', 'Transparent (PNG)'], ['#ffffff', 'White'], ['#000000', 'Black'], ['#e8f0fe', 'Light blue']]} onChange={(background) => set({ ...op, background: background || undefined })} /></Field>;
    case 'image.scan':
      return (
        <>
          <Field label="Look"><Seg value={op.mode} options={[['bw', 'Black and white'], ['gray', 'Grey'], ['color', 'Colour']]} onChange={(mode) => set({ ...op, mode })} /></Field>
          <Field label="Page size"><Seg value={op.pageSize} options={[['a4', 'A4'], ['letter', 'Letter'], ['fit', 'As photographed']]} onChange={(pageSize) => set({ ...op, pageSize })} /></Field>
          <div className="small muted">Pages come in the order shown. Then use PDF → Make searchable to add the text.</div>
        </>
      );
    case 'image.faces':
      return <Field label="Hide with" hint="Faces are found on this computer by a small built-in model (downloaded once, 1.3 MB)."><Seg value={op.style} options={[['blur', 'Blur'], ['pixelate', 'Pixels'], ['black', 'Black box']]} onChange={(style) => set({ ...op, style })} /></Field>;
    case 'pdf.redact':
      return (
        <>
          <Field label="Words to remove" hint="One per line or separated by commas: names, numbers, addresses. Pages with matches are rebuilt so the text cannot be recovered; other pages stay as they are."><textarea className="input" rows={3} value={op.words} onChange={(e) => set({ ...op, words: e.target.value })} placeholder={'Jane Doe\nDE89 3704 0044 0532 0130 00'} /></Field>
          <label className="row small"><input type="checkbox" checked={op.caseSensitive} onChange={(e) => set({ ...op, caseSensitive: e.target.checked })} /> Match capital letters exactly</label>
        </>
      );
    case 'pdf.fill':
      return (
        <>
          <FormEditor file={files[0]} values={op.values} onChange={(values) => set({ ...op, values })} />
          <details>
            <summary className="small">Type on the page (forms without fields)</summary>
            {(op.stamps ?? []).map((s, i) => (
              <div key={i} className="row" style={{ marginTop: 6 }}>
                <input className="input" style={{ width: 60 }} type="number" min={1} value={s.page} onChange={(e) => set({ ...op, stamps: op.stamps!.map((x, j) => (j === i ? { ...x, page: num(e.target.value, 1) } : x)) })} title="Page" />
                <input className="input" style={{ width: 70 }} type="number" step={1} value={Math.round(s.x * 100)} onChange={(e) => set({ ...op, stamps: op.stamps!.map((x, j) => (j === i ? { ...x, x: num(e.target.value, 10) / 100 } : x)) })} title="From the left (% of the page)" />
                <input className="input" style={{ width: 70 }} type="number" step={1} value={Math.round(s.y * 100)} onChange={(e) => set({ ...op, stamps: op.stamps!.map((x, j) => (j === i ? { ...x, y: num(e.target.value, 10) / 100 } : x)) })} title="From the top (% of the page)" />
                <input className="input grow" value={s.text} onChange={(e) => set({ ...op, stamps: op.stamps!.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} placeholder="Text" />
              </div>
            ))}
            <button className="btn sm" style={{ marginTop: 6 }} onClick={() => set({ ...op, stamps: [...(op.stamps ?? []), { page: 1, x: 0.1, y: 0.1, text: '' }] })}>Add text</button>
          </details>
          <label className="row small"><input type="checkbox" checked={op.flatten} onChange={(e) => set({ ...op, flatten: e.target.checked })} /> Flatten (answers become part of the page and can no longer be changed)</label>
        </>
      );
    case 'pdf.sign':
      return (
        <>
          <SignaturePad value={op.signature} onChange={(signature) => set({ ...op, signature })} />
          <Field label="Where"><Seg value={op.corner} options={CORNERS} onChange={(corner) => set({ ...op, corner })} /></Field>
          <Field label="Page"><Seg value={op.page === 'last' ? 'last' : 'first'} options={[['last', 'Last page'], ['first', 'First page']]} onChange={(v) => set({ ...op, page: v === 'last' ? 'last' : 1 })} /></Field>
          <Field label={`Size ${Math.round(op.width * 100)}% of the page width`}><input type="range" min={0.12} max={0.6} step={0.01} value={op.width} onChange={(e) => set({ ...op, width: +e.target.value })} /></Field>
          <label className="row small"><input type="checkbox" checked={op.date} onChange={(e) => set({ ...op, date: e.target.checked })} /> Add today’s date under it</label>
        </>
      );
    case 'pdf.searchable':
      return <div className="small muted">Scanned pages are read on this computer, in the languages chosen in Settings, and their text is added invisibly. Pages that already have text are left as they are.</div>;
    case 'pdf.toWord':
      return <div className="small muted">Text becomes editable paragraphs and headings, page by page; scanned pages come across as pictures (make the PDF searchable first to get their text).</div>;
    case 'doc.toPdf':
      return (
        <>
          <Field label="Page size"><Seg value={op.pageSize} options={[['a4', 'A4'], ['letter', 'US Letter']]} onChange={(pageSize) => set({ ...op, pageSize })} /></Field>
          <label className="row small"><input type="checkbox" checked={op.onePage} onChange={(e) => set({ ...op, onePage: e.target.checked })} /> One long page (Markdown, text and web pages)</label>
          <div className="small muted">Word, PowerPoint and Excel files use LibreOffice, Microsoft Office or (on a Mac) Pages, Keynote and Numbers when one is installed; Word, Markdown, text and web pages also work without any.</div>
        </>
      );
    case 'doc.convert':
      return <Field label="Into"><Seg value={op.format} options={[['docx', 'Word (.docx)'], ['html', 'Web page'], ['md', 'Markdown'], ['txt', 'Plain text']]} onChange={(format) => set({ ...op, format })} /></Field>;
    case 'doc.speak':
      return (
        <>
          <Field label="Save as"><Seg value={op.format} options={[['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV']]} onChange={(format) => set({ ...op, format })} /></Field>
          <Field label={`Speed ${op.rate.toFixed(2)}×`}><input type="range" min={0.6} max={1.8} step={0.05} value={op.rate} onChange={(e) => set({ ...op, rate: +e.target.value })} /></Field>
          <Field label="Voice (optional)" hint="A voice installed on this computer, e.g. Samantha (Mac), Microsoft Zira (Windows), en-gb (Linux)."><input className="input" value={op.voice ?? ''} onChange={(e) => set({ ...op, voice: e.target.value || undefined })} /></Field>
        </>
      );
    case 'file.zip':
      return <Field label="Password (optional)" hint="Any unzip tool opens it with the password. This protection is basic; for strong protection use Lock with a password."><input className="input" type="password" autoComplete="new-password" value={op.password ?? ''} onChange={(e) => set({ ...op, password: e.target.value })} /></Field>;
    case 'file.base64':
      return <div className="row small" style={{ gap: 14 }}><label className="row"><input type="checkbox" checked={!!op.urlSafe} onChange={(e) => set({ ...op, urlSafe: e.target.checked })} /> URL-safe</label><label className="row"><input type="checkbox" checked={!!op.wrap} onChange={(e) => set({ ...op, wrap: e.target.checked ? 76 : 0 })} /> Wrap lines at 76</label></div>;
    case 'file.unzip':
      return <Field label="Password (if it has one)"><input className="input" type="password" value={op.password ?? ''} onChange={(e) => set({ ...op, password: e.target.value })} /></Field>;
    default:
      return isKitTool(op.tool) ? <KitOptions op={op as KitOp} set={set as (o: KitOp) => void} files={files} /> : <div className="small muted">No options needed.</div>;
  }
}

/** The options of any tool, for the workflow editor. */
export function ToolOptions(p: { op: ConvertOp; set: (o: ConvertOp) => void; files: string[] }) {
  return <Options op={p.op} set={p.set} duration={null} pages={null} files={p.files} />;
}

function canRun(op: ConvertOp, files: string[]): string | null {
  if (!files.length) return 'Add files first';
  if (!fits(op.tool, files)) return `This tool works on ${TOOL_INFO[op.tool].accepts.join(' or ')} files`;
  if (isKitTool(op.tool)) return kitBlocked(op as KitOp, files);
  if (TOOL_INFO[op.tool].multi && op.tool === 'pdf.merge' && files.length < 2) return 'Add at least two PDFs to merge';
  if ('password' in op && !op.password && op.tool !== 'file.zip' && op.tool !== 'file.unzip') return 'Type a password';
  if ('text' in op && !op.text.trim()) return 'Type the text';
  if (op.tool === 'file.verify' && !op.expected.trim()) return 'Paste the checksum';
  if ((op.tool === 'pdf.extract' && !op.pages.trim()) || (op.tool === 'pdf.delete' && !op.pages.trim()) || (op.tool === 'pdf.reorder' && !op.order.trim())) return 'List the pages';
  if (op.tool === 'pdf.organize' && !op.pages.length) return 'Keep at least one page';
  if (op.tool === 'doc.translate' && files.some((f) => !/\.(docx|md|markdown|html?|txt|srt|vtt)$/i.test(f))) return 'Translate works on .docx, .md, .html, .txt, .srt and .vtt files';
  if (op.tool === 'video.trim' && !(op.end > op.start)) return 'The end must be after the start';
  if (op.tool === 'video.merge' && files.length < 2) return 'Add at least two clips to join';
  if (op.tool === 'video.replaceAudio' && !op.audio) return 'Choose the new sound';
  if (op.tool === 'video.subtitles' && !op.file && !op.auto) return 'Choose a subtitle file or turn on automatic subtitles';
  if (op.tool === 'pdf.redact' && !op.words.trim() && !op.boxes?.length) return 'List the words to remove';
  if (op.tool === 'pdf.sign' && !op.signature) return 'Draw or type your signature';
  return null;
}

export function Convert() {
  const { route, info, toast } = useStore();
  // The page opens with files (a list), or with a tool chosen ({ tool, files }) from the command palette or the Toolbox.
  const { initial, initialTool } = useMemo<{ initial: string[]; initialTool?: ConvertTool }>(() => {
    try {
      const v = route.arg ? JSON.parse(route.arg) : [];
      const list = Array.isArray(v) ? v : Array.isArray(v?.files) ? v.files : [];
      const tool = !Array.isArray(v) && typeof v?.tool === 'string' && v.tool in TOOL_INFO ? (v.tool as ConvertTool) : undefined;
      return { initial: list.filter((x: unknown): x is string => typeof x === 'string'), initialTool: tool };
    } catch {
      return { initial: [] };
    }
  }, [route.arg]);
  const [files, setFiles] = useState<string[]>(initial);
  const firstAccept = files[0] ? acceptOf(files[0]) : 'video';
  const firstFamily = files[0] ? familyOf(extOf(files[0].split(/[\\/]/).pop() ?? '')) : undefined;
  const anyFormat = firstAccept === '*' && !!firstFamily;
  const [flows, setFlows] = useState(false);
  const [cat, setCat] = useState<ConvertCategory>(initialTool ? TOOL_INFO[initialTool].category : anyFormat ? 'convert' : firstAccept === 'pdf' ? 'pdf' : firstAccept === 'image' ? 'image' : firstAccept === 'audio' ? 'audio' : firstAccept === 'document' || firstAccept === 'code' ? 'doc' : firstAccept === '*' || firstAccept === 'keeper-enc' ? 'file' : 'video');
  const [op, setOp] = useState<ConvertOp>(() => initialTool ? defaults(initialTool) : anyFormat ? defaults('convert.to') : defaults(firstAccept === 'pdf' ? 'pdf.compress' : firstAccept === 'image' ? 'image.convert' : firstAccept === 'audio' ? 'audio.convert' : firstAccept === 'keeper-enc' ? 'file.decrypt' : firstAccept === '*' ? 'file.checksum' : 'video.compress'));
  const [outDir, setOutDir] = useState<string | null>(null);
  const [caps, setCaps] = useState<ConvertCapabilities | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const [find, setFind] = useState('');

  useEffect(() => setFiles(initial), [initial]);
  useEffect(() => {
    if (!initialTool) return;
    setCat(TOOL_INFO[initialTool].category);
    setOp(defaults(initialTool));
  }, [initialTool]);
  useEffect(() => { void api.convert.capabilities().then(setCaps); }, []);
  useEffect(() => api.on('progress', (p: Progress) => { if (p.task === 'convert') setProgress(p); }), []);
  // Facts that make the options smarter: clip length for trimming, page count for PDFs.
  useEffect(() => {
    setDuration(null);
    setPages(null);
    const f = files[0];
    if (!f) return;
    const a = acceptOf(f);
    if (a === 'video' || a === 'audio') void api.convert.duration(f).then((d) => {
      setDuration(d);
      if (d) setOp((o) => (o.tool === 'video.trim' && o.end === 10 ? { ...o, end: Math.round(d * 10) / 10 } : o));
    });
    if (a === 'pdf') void api.convert.pageCount(f).then(setPages);
  }, [files]);

  const add = (paths: string[]) => setFiles((cur) => [...cur, ...paths.filter((p) => !cur.includes(p))]);
  const move = (i: number, d: -1 | 1) => setFiles((cur) => {
    const n = [...cur];
    const j = i + d;
    if (j < 0 || j >= n.length) return cur;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  const kitOn = useFeature('fileKit');
  const flowsOn = useFeature('workflows');
  const tools = (Object.keys(TOOL_INFO) as ConvertTool[]).filter((t) => TOOL_INFO[t].category === cat && (kitOn || !isKitTool(t)));
  const blocked = canRun(op, files);
  const missing =
    op.tool.startsWith('video') || op.tool.startsWith('audio') ? (caps && !caps.ffmpeg ? 'The video engine is missing from this copy of Keeper.' : null)
    : op.tool === 'image.removeBg' && caps && !caps.bgRemoval ? 'Background removal is not available in this copy of Keeper.'
    : (op.tool === 'pdf.toImages' || op.tool === 'pdf.redact' || op.tool === 'pdf.searchable') && caps && !caps.pdfRender ? 'Drawing PDF pages is not available here.'
    : (op.tool === 'audio.transcribe' || (op.tool === 'video.subtitles' && op.auto)) && op.engine === 'service' && caps && !caps.transcribeService ? 'Choose a speech-to-text service first (Island settings → Dictation), or transcribe on this computer.'
    : op.tool === 'doc.speak' && caps && !caps.speech ? 'Install a speech engine (espeak-ng) to read aloud to a file.'
    : op.tool === 'image.faces' && caps && !caps.bgRemoval ? 'Finding faces is not available in this copy of Keeper.'
    : null;

  const run = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    setProgress({ task: 'convert', phase: 'Starting', done: 0, total: 1 });
    try {
      const r = await api.convert.run({ op, inputs: files, outDir: outDir ?? undefined });
      setResult(r);
      if (r.outputs.length) toast(`${TOOL_INFO[op.tool].label}: ${r.outputs.length} new file${r.outputs.length === 1 ? '' : 's'}`);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setRunning(false);
    }
  };

  const name = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="conv">
      <PageHead title="Convert" sub="Video, audio, pictures, PDFs and any file — on this computer. Results go to a new folder; your originals are never changed." />

      <div
        className={`card pad conv-drop ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const paths = [...e.dataTransfer.files].map((f) => api.files.pathOf?.(f) ?? (f as File & { path?: string }).path).filter((p): p is string => !!p);
          if (paths.length) add(paths);
        }}
      >
        {files.length ? (
          <div className="conv-files">
            {files.map((p, i) => (
              <div key={p} className="conv-file">
                <span className="dot" style={{ background: KIND_COLOR[acceptOf(p) === 'pdf' ? 'document' : acceptOf(p) === '*' || acceptOf(p) === 'keeper-enc' ? 'other' : (acceptOf(p) as 'video')] }} />
                <span className="ellipsis grow" title={p}>{name(p)}</span>
                {files.length > 1 ? (
                  <>
                    <button className="btn ghost sm icon" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrowUp" size={12} /></button>
                    <button className="btn ghost sm icon" title="Move down" disabled={i === files.length - 1} onClick={() => move(i, 1)}><Icon name="chevronDown" size={12} /></button>
                  </>
                ) : null}
                <button className="btn ghost sm icon" title="Remove" onClick={() => setFiles(files.filter((x) => x !== p))}><Icon name="close" size={12} /></button>
              </div>
            ))}
          </div>
        ) : (
          <div className="conv-empty">
            <Icon name="drop" size={28} stroke={1.4} />
            <div><b>Drop files here</b> or choose them. You can also right-click any file in Keeper and pick <b>Convert…</b></div>
          </div>
        )}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => void api.settings.pickFiles().then(add)}><Icon name="plus" size={14} /> Choose files</button>
          {files.length ? <button className="btn ghost" onClick={() => { setFiles([]); setResult(null); }}>Clear</button> : null}
        </div>
      </div>

      <div className="seg conv-cats">
        {CATEGORIES.filter((c) => kitOn || c.id !== 'convert').map((c) => (
          <button key={c.id} className={cat === c.id && !flows ? 'on' : ''} onClick={() => { setFlows(false); setCat(c.id); setOp(defaults((Object.keys(TOOL_INFO) as ConvertTool[]).find((t) => TOOL_INFO[t].category === c.id && fits(t, files)) ?? (Object.keys(TOOL_INFO) as ConvertTool[]).find((t) => TOOL_INFO[t].category === c.id)!)); setResult(null); setError(null); }}>
            <Icon name={c.icon} size={14} /> {c.label}
          </button>
        ))}
        {flowsOn ? <button className={flows ? 'on' : ''} onClick={() => setFlows(true)}><Icon name="sparkle" size={14} /> Workflows</button> : null}
      </div>

      {flows ? <WorkflowsPanel files={files} renderOptions={(o, set) => <ToolOptions op={o} set={set} files={files} />} defaults={defaults} /> : null}
      <div className="conv-grid" style={flows ? { display: 'none' } : undefined}>
        <div className="conv-tools">
          {tools.length > 12 ? <input className="input conv-find" placeholder={`Find among ${tools.length} tools`} aria-label="Find a tool" value={find} onChange={(e) => setFind(e.target.value)} /> : null}
          {tools.filter((t) => !find.trim() || `${TOOL_INFO[t].label} ${TOOL_INFO[t].description}`.toLowerCase().includes(find.trim().toLowerCase())).map((t) => {
            const ok = fits(t, files);
            return (
              <button key={t} className={`conv-tool ${op.tool === t ? 'on' : ''} ${ok ? '' : 'dim'}`} onClick={() => { setOp(defaults(t)); setResult(null); setError(null); }} title={ok ? TOOL_INFO[t].description : `Works on ${TOOL_INFO[t].accepts.join(' or ')} files`}>
                <b>{TOOL_INFO[t].label}</b>
                <span>{TOOL_INFO[t].description}</span>
              </button>
            );
          })}
        </div>

        <div className="card pad conv-panel">
          <h2>{TOOL_INFO[op.tool].label}</h2>
          <div className="sub small" style={{ marginBottom: 12 }}>{TOOL_INFO[op.tool].description}</div>
          <div className="col" style={{ gap: 12 }}>
            <Options op={op} set={setOp} duration={duration} pages={pages} files={files} />
            {!['file.checksum', 'file.verify'].includes(op.tool) ? (
              <Field label="Save to">
                <div className="row">
                  <span className="ellipsis small grow" title={outDir ?? ''}>{outDir ? outDir.replace(info?.home ?? '\u0000', '~') : 'A new folder next to the file'}</span>
                  <button className="btn sm" onClick={() => void api.settings.pickFolder().then((d) => d && setOutDir(d))}>Choose…</button>
                  {outDir ? <button className="btn sm ghost" onClick={() => setOutDir(null)}>Reset</button> : null}
                </div>
              </Field>
            ) : null}
          </div>

          {missing ? <div className="conv-warn small"><Icon name="warning" size={14} /> {missing}</div> : null}

          <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
            <span className="small muted">{blocked ?? `${files.length} file${files.length === 1 ? '' : 's'}`}</span>
            <button className="btn primary" disabled={!!blocked || running || !!missing} onClick={() => void run()}>
              {running ? <span className="spinner" /> : <Icon name="sparkle" size={14} />} {running ? 'Working…' : 'Run'}
            </button>
          </div>

          {running && progress ? (
            <div style={{ marginTop: 12 }}>
              <div className="progress"><i style={{ width: `${pct}%` }} /></div>
              <div className="small muted" style={{ marginTop: 4 }}>{progress.phase} · {pct}%</div>
            </div>
          ) : null}

          {error ? <div className="conv-error small"><Icon name="warning" size={14} /> {error}</div> : null}

          {result ? (
            <div className="conv-result">
              {result.message ? <div className={`badge ${result.verified === false ? 'danger' : 'ok'}`} style={{ height: 'auto', padding: '4px 10px', whiteSpace: 'normal' }}>{result.message}</div> : null}
              {result.checksums?.map((c) => (
                <div key={c.path} className="conv-out">
                  <span className="ellipsis grow"><b>{name(c.path)}</b><br /><span className="mono small" style={{ userSelect: 'text' }}>{c.algo.toUpperCase()} {c.hash}</span></span>
                  <button className="btn sm" onClick={() => void api.files.copyText(c.hash)}><Icon name="copy" size={12} /> Copy</button>
                </div>
              ))}
              {result.outputs.slice(0, 50).map((o) => (
                <div key={o} className="conv-out">
                  <Icon name="check" size={14} style={{ color: 'var(--ok)' }} />
                  <span className="ellipsis grow" title={o}>{name(o)}</span>
                  <button className="btn sm" onClick={() => void api.files.open(o)}>Open</button>
                  <button className="btn sm ghost" onClick={() => void api.files.reveal(o)}>Show</button>
                </div>
              ))}
              {result.outputs.length > 50 ? <div className="small muted">…and {result.outputs.length - 50} more in the same folder</div> : null}
              {result.failed?.map((f) => <div key={f.path} className="conv-error small"><b>{name(f.path)}</b>: {f.reason}</div>)}
              {result.details ? (
                <div className="conv-details">
                  <pre className="mono small" style={{ whiteSpace: 'pre-wrap', userSelect: 'text', maxHeight: 260, overflow: 'auto', margin: 0 }}>{result.details}</pre>
                  <button className="btn sm" onClick={() => void api.files.copyText(result.details!)}><Icon name="copy" size={12} /> Copy</button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="small muted" style={{ marginTop: 14 }}>
        Everything runs on this computer. Large videos can take a while; you can keep using Keeper meanwhile.
      </div>
    </div>
  );
}
