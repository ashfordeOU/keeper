// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Toolbox: saving videos from web pages, web pages as PDF, coordinates in every
// format (with an optional map search), and a voice recorder that can
// transcribe what was said.

import { useEffect, useRef, useState } from 'react';
import type { Progress } from '../../core/types';
import type { DisplayControl, DisplayInfo } from '../../core/display-control';
import { allFormats, bearing, compass, distanceKm, parseCoordinates, type LatLon } from '../../core/geotools';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useStore } from '../state';
import type { MoreTool } from './ToolsMore';

function useProgress(task: string): [Progress | null, (p: Progress | null) => void] {
  const [p, setP] = useState<Progress | null>(null);
  useEffect(() => api.on('progress', (x: Progress) => { if (x.task === task) setP(x); }), [task]);
  return [p, setP];
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function DownloadVideo() {
  const { toast } = useStore();
  const [url, setUrl] = useState('');
  const [quality, setQuality] = useState<'best' | '1080' | '720' | 'audio'>('1080');
  const [playlist, setPlaylist] = useState(false);
  const [subs, setSubs] = useState(false);
  const [cookies, setCookies] = useState<'' | 'chrome' | 'firefox' | 'safari' | 'edge' | 'brave'>('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [p, setP] = useProgress('download-video');
  const go = async () => {
    setBusy(true);
    setErr('');
    setFiles([]);
    setP(null);
    try {
      const r = await api.convert.downloadVideo({ url: url.trim(), quality, playlist, subtitles: subs, cookiesFrom: cookies || undefined });
      setFiles(r);
      toast(r.length === 1 ? 'Saved the video' : `Saved ${r.length} files`);
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="col" style={{ gap: 10 }}>
      <input className="input" placeholder="Paste a link to a video page" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && !busy && void go()} />
      <div className="seg" style={{ alignSelf: 'flex-start' }}>{([['best', 'Best'], ['1080', '1080p'], ['720', '720p'], ['audio', 'Sound only (MP3)']] as const).map(([v, l]) => <button key={v} className={quality === v ? 'on' : ''} onClick={() => setQuality(v)}>{l}</button>)}</div>
      <div className="row small" style={{ flexWrap: 'wrap', gap: 14 }}>
        <label className="row"><input type="checkbox" checked={playlist} onChange={(e) => setPlaylist(e.target.checked)} /> Whole playlist or channel page</label>
        <label className="row"><input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)} /> Include subtitles</label>
        <label className="row">Signed-in videos: <select className="input" style={{ width: 'auto', padding: '2px 6px' }} value={cookies} onChange={(e) => setCookies(e.target.value as typeof cookies)}><option value="">No</option><option value="chrome">Use Chrome’s sign-in</option><option value="firefox">Firefox</option><option value="safari">Safari</option><option value="edge">Edge</option><option value="brave">Brave</option></select></label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={!url.trim() || busy} onClick={() => void go()}>{busy ? <span className="spinner" /> : <Icon name="down" size={14} />} {busy ? 'Downloading…' : 'Download'}</button>
        {busy ? <button className="btn ghost" onClick={() => void api.convert.cancelDownload()}>Stop</button> : null}
      </div>
      {busy && p ? <div><div className="progress"><i style={{ width: `${pct}%` }} /></div><div className="small muted" style={{ marginTop: 4 }}>{p.phase} · {pct}%</div></div> : null}
      {err ? <div className="conv-error small"><Icon name="warning" size={14} /> {err}</div> : null}
      {files.map((f) => <div key={f} className="conv-out"><Icon name="check" size={14} /><span className="ellipsis grow" title={f}>{f.split(/[\\/]/).pop()}</span><button className="btn sm" onClick={() => void api.files.open(f)}>Open</button><button className="btn sm ghost" onClick={() => void api.files.reveal(f)}>Show</button></div>)}
      <p className="small muted">Saved to Downloads/Keeper Videos. Works with most video sites. Only download what you have the right to keep.</p>
    </div>
  );
}

function WebToPdf() {
  const [url, setUrl] = useState('');
  const [onePage, setOnePage] = useState(false);
  const [size, setSize] = useState<'a4' | 'letter'>('a4');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true);
    setErr('');
    setOut('');
    try {
      setOut(await api.convert.webToPdf(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`, { pageSize: size, onePage }));
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <input className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && void go()} />
      <div className="row" style={{ gap: 14 }}>
        <div className="seg">{(['a4', 'letter'] as const).map((v) => <button key={v} className={size === v ? 'on' : ''} onClick={() => setSize(v)}>{v === 'a4' ? 'A4' : 'Letter'}</button>)}</div>
        <label className="row small"><input type="checkbox" checked={onePage} onChange={(e) => setOnePage(e.target.checked)} /> One long page (nothing split across pages)</label>
      </div>
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!url.trim() || busy} onClick={() => void go()}>{busy ? <span className="spinner" /> : <Icon name="document" size={14} />} Save as PDF</button>
      {err ? <div className="conv-error small"><Icon name="warning" size={14} /> {err}</div> : null}
      {out ? <div className="conv-out"><Icon name="check" size={14} /><span className="ellipsis grow">{out.split(/[\\/]/).pop()}</span><button className="btn sm" onClick={() => void api.files.open(out)}>Open</button><button className="btn sm ghost" onClick={() => void api.files.reveal(out)}>Show</button></div> : null}
      <p className="small muted">The page is opened in a private window with its own cookies, then printed. Saved to Downloads.</p>
    </div>
  );
}

function Coordinates() {
  const { toast } = useStore();
  const [a, setA] = useState('59.4370, 24.7536');
  const [b, setB] = useState('');
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<{ name: string; lat: number; lon: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const pa = parseCoordinates(a);
  const pb = b.trim() ? parseCoordinates(b) : undefined;
  const lookup = async () => {
    // Asks OpenStreetMap's search only when the person presses Find; nothing is sent otherwise.
    setBusy(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(search)}`, { headers: { 'accept-language': navigator.language } });
      const list = (await res.json()) as { display_name: string; lat: string; lon: string }[];
      setFound(list.map((x) => ({ name: x.display_name, lat: +x.lat, lon: +x.lon })));
    } catch {
      toast('Could not reach the map search');
    } finally {
      setBusy(false);
    }
  };
  const here = () => navigator.geolocation?.getCurrentPosition((pos) => setA(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`), () => toast('Location is not available or was not allowed'), { enableHighAccuracy: true, timeout: 10000 });
  const show = (p: LatLon | undefined) => p ? allFormats(p).map((f) => <div key={f.label} className="row"><span className="badge" style={{ width: 170 }}>{f.label}</span><code className="mono grow ellipsis" title={f.value}>{f.value}</code><button className="btn sm ghost" onClick={() => { void api.files.copyText(f.value); toast('Copied'); }}><Icon name="copy" size={12} /></button></div>) : null;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row">
        <input className="input grow" value={a} onChange={(e) => setA(e.target.value)} placeholder="Coordinates in any form, or a map link" />
        <button className="btn sm" onClick={here} title="Where this computer is (asks first)"><Icon name="globe" size={12} /> My location</button>
      </div>
      {a.trim() && !pa ? <span className="badge warn">Not coordinates Keeper can read</span> : null}
      {show(pa)}
      <div className="row">
        <input className="input grow" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a place or address (asks OpenStreetMap)" onKeyDown={(e) => e.key === 'Enter' && search.trim() && void lookup()} />
        <button className="btn sm" disabled={!search.trim() || busy} onClick={() => void lookup()}>{busy ? <span className="spinner" /> : 'Find'}</button>
      </div>
      {found.map((f) => <button key={`${f.lat},${f.lon}`} className="item-row" style={{ textAlign: 'left' }} onClick={() => { setA(`${f.lat.toFixed(6)}, ${f.lon.toFixed(6)}`); setFound([]); }}><span className="small grow ellipsis">{f.name}</span><code className="small mono muted">{f.lat.toFixed(4)}, {f.lon.toFixed(4)}</code></button>)}
      <input className="input" value={b} onChange={(e) => setB(e.target.value)} placeholder="A second point, to measure the distance" />
      {pa && pb ? <div className="badge ok" style={{ alignSelf: 'flex-start', height: 'auto', padding: '4px 10px' }}>{distanceKm(pa, pb) < 1 ? `${Math.round(distanceKm(pa, pb) * 1000)} m` : `${distanceKm(pa, pb).toFixed(2)} km`} ({(distanceKm(pa, pb) * 0.621371).toFixed(2)} mi) as the crow flies · heading {Math.round(bearing(pa, pb))}° {compass(bearing(pa, pb))}</div> : null}
      <p className="small muted">Reads decimal degrees, degrees-minutes-seconds, map links and geo: links. Map search and location are only used when you press them.</p>
    </div>
  );
}

function VoiceRecorder() {
  const { toast, go } = useStore();
  const [state, setState] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [secs, setSecs] = useState(0);
  const [saved, setSaved] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  useEffect(() => {
    if (state !== 'recording') return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const r = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined });
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState('saving');
        const blob = new Blob(chunks.current, { type: r.mimeType });
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        try {
          setSaved(await api.convert.saveRecording(btoa(bin), 'webm'));
        } catch (e) {
          toast(msg(e));
        }
        setState('idle');
      };
      r.start(1000);
      rec.current = r;
      setSecs(0);
      setSaved('');
      setText('');
      setState('recording');
    } catch {
      toast('The microphone is not available or was not allowed');
    }
  };
  const transcribe = async () => {
    setBusy(true);
    try {
      const r = await api.convert.run({ op: { tool: 'audio.transcribe', format: 'timestamps' }, inputs: [saved] });
      setText(r.details ?? '');
    } catch (e) {
      toast(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row">
        {state === 'recording'
          ? <button className="btn danger" onClick={() => rec.current?.stop()}><span className="rec-dot" /> Stop · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</button>
          : <button className="btn primary" disabled={state === 'saving'} onClick={() => void start()}><Icon name="mic" size={14} /> {state === 'saving' ? 'Saving…' : 'Record'}</button>}
      </div>
      {saved ? (
        <div className="conv-out"><Icon name="check" size={14} /><span className="ellipsis grow">{saved.split(/[\\/]/).pop()}</span><button className="btn sm" onClick={() => void api.files.open(saved)}>Play</button><button className="btn sm" disabled={busy} onClick={() => void transcribe()}>{busy ? <span className="spinner" /> : null} Transcribe</button><button className="btn sm ghost" onClick={() => go({ name: 'convert', arg: JSON.stringify([saved]) })}>More…</button></div>
      ) : null}
      {text ? <><pre className="mono small" style={{ whiteSpace: 'pre-wrap', userSelect: 'text', maxHeight: 220, overflow: 'auto' }}>{text}</pre><button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => { void api.files.copyText(text); toast('Copied'); }}><Icon name="copy" size={12} /> Copy text</button></> : null}
      <p className="small muted">Recordings go to Music/Keeper Recordings as M4A. Transcription uses the speech-to-text service chosen for dictation.</p>
    </div>
  );
}

const CONTROL_LABEL: Record<DisplayControl, string> = { brightness: 'Brightness', contrast: 'Contrast', volume: 'Volume' };

/** Brightness, contrast and volume of external displays over DDC/CI. */
function DisplayControls() {
  const [state, setState] = useState<{ displays: DisplayInfo[]; note?: string } | null>(null);
  const [error, setError] = useState('');
  const timers = useRef<Record<string, number>>({});
  const load = () => { setState(null); setError(''); void api.convert.displays().then(setState).catch((e) => setError(msg(e))); };
  useEffect(load, []);
  const change = (d: DisplayInfo, c: DisplayControl, v: number) => {
    setState((s) => (s ? { ...s, displays: s.displays.map((x) => (x.id === d.id ? { ...x, [c]: v } : x)) } : s));
    const key = `${d.id}:${c}`;
    clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(() => void api.convert.setDisplay(d.id, c, v).catch((e) => setError(msg(e))), 250);
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row"><span className="small muted grow">Changes external monitors directly over DDC/CI, like their own buttons. Built-in screens use the system's brightness keys.</span><button className="btn sm" onClick={load}><Icon name="refresh" size={12} /> Look again</button></div>
      {!state && !error ? <div className="row small muted"><span className="spinner" /> Asking the displays…</div> : null}
      {error ? <div className="small" style={{ color: 'var(--danger)' }}>{error}</div> : null}
      {state?.note ? <div className="small muted">{state.note}</div> : null}
      {state?.displays.map((d) => (
        <div key={d.id} className="card col" style={{ gap: 8, padding: 12 }}>
          <b>{d.name}</b>
          {(['brightness', 'contrast', 'volume'] as DisplayControl[]).map((c) => (
            <label key={c} className="row" style={{ gap: 10 }}>
              <span className="small" style={{ width: 80 }}>{CONTROL_LABEL[c]}</span>
              <input type="range" min={0} max={100} className="grow" value={d[c] ?? 50} onChange={(e) => change(d, c, +e.target.value)} />
              <span className="num small" style={{ width: 34, textAlign: 'right' }}>{d[c] ?? '—'}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

export function plusTools(): MoreTool[] {
  return [
    { id: 'download-video', name: 'Download video', desc: 'Save a video or its sound from a web page — best, 1080p, 720p or MP3.', icon: 'down', group: 'Media', render: () => <DownloadVideo /> },
    { id: 'record-voice', name: 'Record your voice', desc: 'Record from the microphone, then transcribe it.', icon: 'mic', group: 'Media', render: () => <VoiceRecorder /> },
    { id: 'web-pdf', name: 'Web page to PDF', desc: 'Save any page as a PDF, paged or as one long page.', icon: 'globe', group: 'Media', render: () => <WebToPdf /> },
    { id: 'displays', name: 'Display control', desc: 'Brightness, contrast and volume of external monitors.', icon: 'sun', group: 'System', render: () => <DisplayControls /> },
    { id: 'coords', name: 'Coordinates', desc: 'Every coordinate format, map search, distances and your location.', icon: 'globe', group: 'Developer', render: () => <Coordinates /> },
  ];
}
