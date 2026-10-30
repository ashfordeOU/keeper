// SPDX-License-Identifier: AGPL-3.0-or-later
// Toolbox: small everyday tools. Everything runs on this computer.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CaptureResult } from '../../core/api';
import {
  base64Decode, base64Encode, cleanLink, convertCase, convertTimestamp, decodeJwt, formatJson, generatePassword, inspectUnicode,
  redactPersonal, textStats, wifiQrPayload, type CaseStyle,
} from '../../core/textools';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/screens-b.css';

interface Tool {
  id: string;
  name: string;
  desc: string;
  icon: string;
  group: 'Text' | 'Developer' | 'Screen' | 'System';
  render: () => ReactNode;
}

function CopyBtn({ text }: { text: string }) {
  const { toast } = useStore();
  return <button className="btn sm" disabled={!text} onClick={() => { void api.files.copyText(text); toast('Copied'); }}><Icon name="copy" size={12} /> Copy</button>;
}

function Area({ value, onChange, placeholder, rows = 6 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea className="input" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={false} />;
}

// ------------------------------------------------------------------ individual tools

function ScreenText() {
  const [r, setR] = useState<CaptureResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<CaptureResult | null>) => {
    setBusy(true);
    try { setR(await fn()); } finally { setBusy(false); }
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="btn-row">
        <button className="btn primary" disabled={busy} onClick={() => void run(() => api.capture.text())}>{busy ? <div className="spinner" /> : <Icon name="screenshot" size={14} />} Select an area</button>
        <button className="btn" disabled={busy} onClick={() => void run(() => api.capture.clipboardImage())}><Icon name="clipboard" size={14} /> Read image on clipboard</button>
      </div>
      {r?.code ? (
        <div className="card pad row"><Icon name="grid" size={16} /><span className="grow ellipsis">QR / barcode: <b>{r.code}</b></span><CopyBtn text={r.code} />{/^https?:/.test(r.code) ? <button className="btn sm" onClick={() => void api.system.openExternal(r.code!)}>Open</button> : null}</div>
      ) : null}
      {r ? <><pre>{r.text || 'No text found.'}</pre><div><CopyBtn text={r.text} /></div></> : <p className="small muted">The text is also copied to your clipboard automatically. Shortcut: see Island settings.</p>}
    </div>
  );
}

function LinkCleaner() {
  const [v, setV] = useState('');
  const out = v.split(/\s+/).filter(Boolean).map(cleanLink).join('\n');
  return <div className="col" style={{ gap: 8 }}><Area value={v} onChange={setV} placeholder="Paste one or more links" rows={3} /><pre>{out || '—'}</pre><div><CopyBtn text={out} /></div></div>;
}

function Json() {
  const [v, setV] = useState('');
  const [indent, setIndent] = useState(2);
  const r = v.trim() ? formatJson(v, indent) : null;
  return (
    <div className="col" style={{ gap: 8 }}>
      <Area value={v} onChange={setV} placeholder='{"paste": "JSON here"}' />
      <div className="seg" style={{ alignSelf: 'flex-start' }}>{[2, 4, 0].map((n) => <button key={n} className={indent === n ? 'on' : ''} onClick={() => setIndent(n)}>{n ? `${n} spaces` : 'Minify'}</button>)}</div>
      {r ? (r.ok ? <><pre>{indent ? r.text : JSON.stringify(JSON.parse(v))}</pre><div><CopyBtn text={indent ? r.text : JSON.stringify(JSON.parse(v))} /></div></> : <div className="badge danger" style={{ height: 'auto', padding: 8 }}>{r.error}</div>) : null}
    </div>
  );
}

function B64() {
  const [v, setV] = useState('');
  const [mode, setMode] = useState<'enc' | 'dec'>('enc');
  let out = '';
  try { out = v ? (mode === 'enc' ? base64Encode(v) : base64Decode(v)) : ''; } catch { out = 'Not valid Base64'; }
  return <div className="col" style={{ gap: 8 }}><div className="seg" style={{ alignSelf: 'flex-start' }}><button className={mode === 'enc' ? 'on' : ''} onClick={() => setMode('enc')}>Encode</button><button className={mode === 'dec' ? 'on' : ''} onClick={() => setMode('dec')}>Decode</button></div><Area value={v} onChange={setV} rows={4} /><pre>{out || '—'}</pre><div><CopyBtn text={out} /></div></div>;
}

function Hash() {
  const [v, setV] = useState('');
  const [out, setOut] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void Promise.all(['SHA-1', 'SHA-256', 'SHA-512'].map(async (a) => {
      const buf = await crypto.subtle.digest(a, new TextEncoder().encode(v));
      return [a, [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')] as const;
    })).then((r) => alive && setOut(Object.fromEntries(r)));
    return () => { alive = false; };
  }, [v]);
  return <div className="col" style={{ gap: 8 }}><Area value={v} onChange={setV} rows={3} placeholder="Text to hash" />{Object.entries(out).map(([k, h]) => <div key={k} className="row"><span className="badge" style={{ width: 70 }}>{k}</span><code className="mono grow ellipsis" title={h}>{h}</code><CopyBtn text={h} /></div>)}</div>;
}

function uuidV7(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const t = Date.now();
  for (let i = 0; i < 6; i++) b[i] = Math.floor(t / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function Uuid() {
  const [v, setV] = useState<'4' | '7'>('7');
  const [list, setList] = useState<string[]>([]);
  const gen = () => setList(Array.from({ length: 5 }, () => (v === '4' ? crypto.randomUUID() : uuidV7())));
  useEffect(gen, [v]);
  return <div className="col" style={{ gap: 8 }}><div className="row"><div className="seg"><button className={v === '7' ? 'on' : ''} onClick={() => setV('7')}>v7 (time-ordered)</button><button className={v === '4' ? 'on' : ''} onClick={() => setV('4')}>v4 (random)</button></div><button className="btn sm" onClick={gen}><Icon name="refresh" size={12} /> New</button></div><pre>{list.join('\n')}</pre><div><CopyBtn text={list.join('\n')} /></div></div>;
}

function Jwt() {
  const [v, setV] = useState('');
  let out: ReactNode = null;
  if (v.trim()) {
    try {
      const d = decodeJwt(v);
      out = <><pre>{JSON.stringify(d.header, null, 2)}</pre><pre>{JSON.stringify(d.payload, null, 2)}</pre>{d.expires ? <span className={`badge ${d.expired ? 'danger' : 'ok'}`}>{d.expired ? 'Expired' : 'Expires'} {new Date(d.expires).toLocaleString()}</span> : null}</>;
    } catch (e) { out = <div className="badge danger">{e instanceof Error ? e.message : 'Not a JWT'}</div>; }
  }
  return <div className="col" style={{ gap: 8 }}><Area value={v} onChange={setV} rows={3} placeholder="eyJhbGciOi…" />{out}<p className="small muted">Decoding only — the signature is not checked.</p></div>;
}

function Timestamp() {
  const [v, setV] = useState(String(Math.floor(Date.now() / 1000)));
  const r = convertTimestamp(v);
  return <div className="col" style={{ gap: 8 }}><input className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder="1730000000, 2026-10-30T15:00:00Z, …" /><button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setV(String(Math.floor(Date.now() / 1000)))}>Now</button>{r ? <dl className="kv"><dt>Local</dt><dd>{r.local}</dd><dt>ISO 8601</dt><dd>{r.iso}</dd><dt>Unix seconds</dt><dd>{r.unix}</dd><dt>Milliseconds</dt><dd>{r.ms}</dd></dl> : <span className="muted small">Not a date I understand.</span>}</div>;
}

function Case() {
  const [v, setV] = useState('');
  const styles: CaseStyle[] = ['title', 'sentence', 'lower', 'upper', 'camel', 'pascal', 'snake', 'kebab', 'constant'];
  return <div className="col" style={{ gap: 8 }}><Area value={v} onChange={setV} rows={3} placeholder="Text to convert" />{styles.map((s) => <div key={s} className="row"><span className="badge" style={{ width: 80 }}>{s}</span><code className="mono grow ellipsis">{convertCase(v, s)}</code><CopyBtn text={convertCase(v, s)} /></div>)}</div>;
}

function Words() {
  const [v, setV] = useState('');
  const s = textStats(v);
  return <div className="col" style={{ gap: 8 }}><Area value={v} onChange={setV} rows={8} placeholder="Paste text" /><div className="kv-grid">{[['Words', s.words], ['Characters', s.chars], ['Sentences', s.sentences], ['Lines', s.lines], ['Reading time', `${s.readingMin} min`]].map(([l, n]) => <div key={l as string} className="stat"><span className="v">{n}</span><span className="l">{l}</span></div>)}</div>{s.top.length ? <div className="chips">{s.top.map(([w, n]) => <span key={w} className="badge">{w} · {n}</span>)}</div> : null}</div>;
}

function Regex() {
  const [re, setRe] = useState('\\b\\w+@\\w+\\.\\w+\\b');
  const [flags, setFlags] = useState('g');
  const [v, setV] = useState('write to ana@example.com or team@keeper.dev');
  let err = '';
  let parts: ReactNode[] = [v];
  let count = 0;
  try {
    const r = new RegExp(re, flags.includes('g') ? flags : flags + 'g');
    parts = [];
    let last = 0;
    for (const m of v.matchAll(r)) {
      if (m[0] === '') break;
      parts.push(v.slice(last, m.index), <mark key={m.index}>{m[0]}</mark>);
      last = (m.index ?? 0) + m[0].length;
      count++;
    }
    parts.push(v.slice(last));
  } catch (e) { err = e instanceof Error ? e.message : 'Invalid pattern'; }
  return <div className="col" style={{ gap: 8 }}><div className="row"><span className="mono">/</span><input className="input grow mono" value={re} onChange={(e) => setRe(e.target.value)} /><span className="mono">/</span><input className="input mono" style={{ width: 60 }} value={flags} onChange={(e) => setFlags(e.target.value.replace(/[^gimsuy]/g, ''))} /></div><Area value={v} onChange={setV} rows={4} />{err ? <span className="badge danger">{err}</span> : <><span className="small muted">{count} match{count === 1 ? '' : 'es'}</span><pre className="regex-out">{parts}</pre></>}</div>;
}

function Unicode() {
  const [v, setV] = useState('');
  const chars = inspectUnicode(v);
  const bad = chars.filter((c) => c.suspicious);
  return <div className="col" style={{ gap: 8 }}><Area value={v} onChange={setV} rows={3} placeholder="Paste text to look for hidden or look-alike characters" />{v ? <span className={`badge ${bad.length ? 'warn' : 'ok'}`}>{bad.length ? `${bad.length} suspicious character${bad.length === 1 ? '' : 's'}` : 'Nothing hidden'}</span> : null}<div style={{ maxHeight: 220, overflow: 'auto' }}>{chars.filter((c) => c.suspicious || c.name !== 'ASCII').slice(0, 200).map((c, i) => <div key={i} className="item-row"><code className="mono" style={{ width: 30 }}>{c.char.trim() ? c.char : '·'}</code><code className="mono muted">{c.code}</code><span className="grow small">{c.name}</span>{c.suspicious ? <span className="badge warn">Hidden / look-alike</span> : null}</div>)}</div><button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!bad.length} onClick={() => setV(chars.filter((c) => !c.suspicious).map((c) => c.char).join(''))}>Remove suspicious characters</button></div>;
}

function Redact() {
  const [v, setV] = useState('');
  const r = redactPersonal(v);
  return <div className="col" style={{ gap: 8 }}><Area value={v} onChange={setV} placeholder="Paste text before sharing it with an AI tool" /><span className="small muted">{r.count} item{r.count === 1 ? '' : 's'} hidden: e-mails, phone and card numbers, IBANs, API keys.</span><pre>{r.text || '—'}</pre><div><CopyBtn text={r.text} /></div></div>;
}

function Password() {
  const [len, setLen] = useState(20);
  const [symbols, setSymbols] = useState(true);
  const [words, setWords] = useState(false);
  const [pw, setPw] = useState('');
  useEffect(() => setPw(generatePassword(len, { symbols, words })), [len, symbols, words]);
  return <div className="col" style={{ gap: 10 }}><pre style={{ fontSize: 16 }}>{pw}</pre><div className="row"><span className="small">Length</span><input type="range" min={8} max={64} value={len} onChange={(e) => setLen(Number(e.target.value))} className="grow" /><span className="num">{len}</span></div><div className="row"><span className="small grow">Symbols</span><Toggle on={symbols} onChange={setSymbols} /></div><div className="row"><span className="small grow">Words (easier to type)</span><Toggle on={words} onChange={setWords} /></div><div className="btn-row"><button className="btn sm" onClick={() => setPw(generatePassword(len, { symbols, words }))}><Icon name="refresh" size={12} /> New</button><CopyBtn text={pw} /></div></div>;
}

function Wifi() {
  const [list, setList] = useState<{ ssid: string; password?: string }[] | null>(null);
  const [ssid, setSsid] = useState('');
  const [pass, setPass] = useState('');
  const payload = ssid ? wifiQrPayload(ssid, pass, pass ? 'WPA' : 'nopass') : '';
  return (
    <div className="col" style={{ gap: 10 }}>
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => void api.system.wifiNetworks().then(setList)}><Icon name="lock" size={12} /> Show saved Wi-Fi passwords</button>
      {list ? (list.length ? list.map((n) => <div key={n.ssid} className="item-row"><b className="grow">{n.ssid}</b><code className="mono">{n.password ?? '—'}</code>{n.password ? <CopyBtn text={n.password} /> : null}<button className="btn sm" onClick={() => { setSsid(n.ssid); setPass(n.password ?? ''); }}>Share</button></div>) : <span className="small muted">No saved networks could be read. Your system may ask for your password.</span>) : null}
      <div className="row"><input className="input grow" placeholder="Network name" value={ssid} onChange={(e) => setSsid(e.target.value)} /><input className="input grow" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
      {payload ? <><pre>{payload}</pre><span className="small muted">Paste this into any QR code maker; a phone camera will offer to join the network.</span><div><CopyBtn text={payload} /></div></> : null}
    </div>
  );
}

function ColourPicker() {
  const [colors, setColors] = useState<string[]>([]);
  const ED = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
  const pick = async () => {
    if (!ED) return;
    try {
      const r = await new ED().open();
      setColors((c) => [r.sRGBHex, ...c.filter((x) => x !== r.sRGBHex)].slice(0, 12));
      void api.files.copyText(r.sRGBHex);
    } catch { /* cancelled */ }
  };
  const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
  return <div className="col" style={{ gap: 10 }}>{ED ? <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => void pick()}><Icon name="drop" size={14} /> Pick a colour from the screen</button> : <span className="small muted">Colour picking is not available on this system.</span>}{colors.map((c) => <div key={c} className="item-row"><span style={{ width: 22, height: 22, borderRadius: 6, background: c, border: '1px solid var(--line)' }} /><code className="mono grow">{c} · {rgb(c)}</code><CopyBtn text={c} /></div>)}</div>;
}

function Fullscreen({ kind, onDone }: { kind: 'pixels' | 'clean'; onDone: () => void }) {
  const colors = ['#000', '#fff', '#f00', '#0f0', '#00f', '#808080'];
  const [i, setI] = useState(0);
  const [left, setLeft] = useState(30);
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    const key = (e: KeyboardEvent) => {
      if (kind === 'pixels') { if (e.key === 'Escape') onDone(); else setI((x) => x + 1); return; }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    const t = kind === 'clean' ? setInterval(() => setLeft((l) => { if (l <= 1) { onDone(); return 0; } return l - 1; }), 1000) : undefined;
    return () => {
      window.removeEventListener('keydown', key, true);
      if (t) clearInterval(t);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [kind, onDone]);
  if (kind === 'pixels') return <div className="fullscreen-test" style={{ background: colors[i % colors.length] }} onClick={() => setI((x) => x + 1)}><span className="hint">Click or press any key for the next colour · Esc to finish</span></div>;
  return <div className="fullscreen-test" style={{ background: '#000', color: '#fff', cursor: 'default' }}><div style={{ textAlign: 'center' }}><div style={{ fontSize: 64, fontWeight: 800 }}>{left}</div><div>Keyboard locked — wipe away</div><button className="btn" style={{ marginTop: 20 }} onClick={onDone}>Unlock now</button></div></div>;
}

function Disks() {
  const [r, setR] = useState<{ ejected: string[]; failed: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  return <div className="col" style={{ gap: 8 }}><button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={async () => { setBusy(true); try { setR(await api.system.ejectAll()); } finally { setBusy(false); } }}>{busy ? <div className="spinner" /> : <Icon name="arrowUp" size={14} />} Eject all external disks</button>{r ? <span className="small">{r.ejected.length ? `Ejected ${r.ejected.join(', ')}.` : 'No external disks were mounted.'}{r.failed.length ? ` Could not eject ${r.failed.join(', ')} — something may still be using it.` : ''}</span> : null}</div>;
}

// ------------------------------------------------------------------ page

export function Tools() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState<'pixels' | 'clean' | null>(null);

  const tools: Tool[] = useMemo(() => [
    { id: 'screen', name: 'Copy text from screen', desc: 'Drag over anything on screen to copy its text, or read a QR code.', icon: 'screenshot', group: 'Screen', render: () => <ScreenText /> },
    { id: 'colour', name: 'Colour picker', desc: 'Pick any colour on screen as hex and RGB.', icon: 'drop', group: 'Screen', render: () => <ColourPicker /> },
    { id: 'pixels', name: 'Dead-pixel test', desc: 'Full-screen solid colours to spot stuck pixels.', icon: 'grid', group: 'Screen', render: () => <button className="btn primary" onClick={() => setFull('pixels')}>Start test</button> },
    { id: 'clean', name: 'Clean the keyboard', desc: 'Locks the keyboard for 30 seconds while you wipe it.', icon: 'lock', group: 'Screen', render: () => <button className="btn primary" onClick={() => setFull('clean')}>Lock for 30 seconds</button> },
    { id: 'link', name: 'Clean a link', desc: 'Strip tracking tags and unwrap redirect links.', icon: 'globe', group: 'Text', render: () => <LinkCleaner /> },
    { id: 'redact', name: 'Hide personal info', desc: 'Mask e-mails, numbers and keys before pasting into an AI tool.', icon: 'eye', group: 'Text', render: () => <Redact /> },
    { id: 'case', name: 'Change case', desc: 'Title, sentence, camelCase, snake_case and more.', icon: 'text', group: 'Text', render: () => <Case /> },
    { id: 'words', name: 'Word counter', desc: 'Words, characters, reading time and top words.', icon: 'document', group: 'Text', render: () => <Words /> },
    { id: 'unicode', name: 'Hidden characters', desc: 'Find zero-width and look-alike characters.', icon: 'search', group: 'Text', render: () => <Unicode /> },
    { id: 'password', name: 'Password generator', desc: 'Strong random passwords or easy-to-type word phrases.', icon: 'lock', group: 'Text', render: () => <Password /> },
    { id: 'json', name: 'JSON formatter', desc: 'Pretty-print or minify; shows exactly where it is broken.', icon: 'code', group: 'Developer', render: () => <Json /> },
    { id: 'b64', name: 'Base64', desc: 'Encode and decode text.', icon: 'code', group: 'Developer', render: () => <B64 /> },
    { id: 'hash', name: 'Hashes', desc: 'SHA-1, SHA-256 and SHA-512 of any text.', icon: 'code', group: 'Developer', render: () => <Hash /> },
    { id: 'uuid', name: 'UUIDs', desc: 'Random (v4) and time-ordered (v7).', icon: 'code', group: 'Developer', render: () => <Uuid /> },
    { id: 'jwt', name: 'JWT decoder', desc: 'See what is inside a token and when it expires.', icon: 'code', group: 'Developer', render: () => <Jwt /> },
    { id: 'time', name: 'Timestamp converter', desc: 'Unix time, ISO dates and your local time.', icon: 'clock', group: 'Developer', render: () => <Timestamp /> },
    { id: 'regex', name: 'Regex tester', desc: 'Live highlighting of matches.', icon: 'search', group: 'Developer', render: () => <Regex /> },
    { id: 'wifi', name: 'Wi-Fi passwords', desc: 'See saved Wi-Fi passwords and share a network.', icon: 'globe', group: 'System', render: () => <Wifi /> },
    { id: 'eject', name: 'Eject all disks', desc: 'Safely eject every external drive at once.', icon: 'arrowUp', group: 'System', render: () => <Disks /> },
  ], []);

  const shown = tools.filter((t) => !q || `${t.name} ${t.desc} ${t.group}`.toLowerCase().includes(q.toLowerCase()));
  const current = tools.find((t) => t.id === open);

  return (
    <div>
      <PageHead title="Toolbox" sub="Small tools you reach for every day. Everything runs on this computer.">
        <input className="input" placeholder="Find a tool" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} autoFocus />
      </PageHead>
      {current ? (
        <div className="card pad tool-panel" style={{ marginBottom: 18 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="tool-card" style={{ padding: 0, border: 0, boxShadow: 'none', background: 'none' }}><div className="ic"><Icon name={current.icon} size={16} /></div></div>
            <div className="grow"><h2>{current.name}</h2><div className="small muted">{current.desc}</div></div>
            <button className="btn ghost sm icon" onClick={() => setOpen(null)}><Icon name="close" size={14} /></button>
          </div>
          {current.render()}
        </div>
      ) : null}
      {(['Screen', 'Text', 'Developer', 'System'] as const).map((g) => {
        const list = shown.filter((t) => t.group === g);
        if (!list.length) return null;
        return (
          <div key={g} className="section" style={{ marginTop: 18 }}>
            <div className="section-head"><h3 className="muted">{g}</h3></div>
            <div className="tool-grid">
              {list.map((t) => (
                <button key={t.id} className="tool-card" onClick={() => { setOpen(t.id); document.querySelector('.content')?.scrollTo({ top: 0, behavior: 'smooth' }); }} style={open === t.id ? { borderColor: 'var(--accent)' } : undefined}>
                  <div className="ic"><Icon name={t.icon} size={16} /></div>
                  <b>{t.name}</b>
                  <span className="small muted">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {full ? <Fullscreen kind={full} onDone={() => setFull(null)} /> : null}
    </div>
  );
}
