// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// More Toolbox tools: QR codes, internet speed, diff, lorem ipsum, speech,
// number bases, colours, URL / HTML / Markdown / CSV / cron helpers, network
// details, system tweaks, receipts to a spreadsheet and subtitle translation.

import QRCode from 'qrcode';
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import type { NetworkInfo, Tweak } from '../../core/api-x';
import { colorFormats, convertBase, csvToJson, diffLines, explainCron, htmlDecode, htmlEncode, lorem, markdownToHtml } from '../../core/devtools';
import type { SpeedResult } from '../../core/monitor';
import { loremAs, sideBySide, wifiQrPayload } from '../../core/textools';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/screens-x.css';

export interface MoreTool {
  id: string;
  name: string;
  desc: string;
  icon: string;
  group: 'Text' | 'Developer' | 'Screen' | 'System' | 'Media';
  render: () => ReactNode;
}

function Copy({ text }: { text: string }) {
  const { toast } = useStore();
  return <button className="btn sm" disabled={!text} onClick={() => { void api.files.copyText(text); toast('Copied'); }}><Icon name="copy" size={12} /> Copy</button>;
}

const Area = ({ value, onChange, placeholder, rows = 6 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) => (
  <textarea className="input" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={false} style={{ width: '100%' }} />
);

// ------------------------------------------------------------------ QR codes

export function QrImage({ text, size = 440 }: { text: string; size?: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!text) { setUrl(''); return; }
    void QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' }).then(setUrl).catch(() => setUrl(''));
  }, [text, size]);
  const { toast } = useStore();
  if (!url) return null;
  return (
    <div className="col" style={{ gap: 8, alignItems: 'flex-start' }}>
      <div className="qr-out"><img src={url} alt="QR code" /></div>
      <div className="btn-row">
        <button className="btn sm" onClick={async () => { const p = await api.tools.saveAs('qr-code.png', url); if (p) toast(`Saved ${p.split(/[\\/]/).pop()}`); }}><Icon name="down" size={12} /> Save PNG</button>
        <Copy text={text} />
      </div>
    </div>
  );
}

function Qr() {
  const [mode, setMode] = useState<'text' | 'wifi' | 'contact'>('text');
  const [text, setText] = useState('https://');
  const [ssid, setSsid] = useState('');
  const [pass, setPass] = useState('');
  const [c, setC] = useState({ name: '', phone: '', email: '', org: '', url: '' });
  const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${c.name}\n${c.org ? `ORG:${c.org}\n` : ''}${c.phone ? `TEL:${c.phone}\n` : ''}${c.email ? `EMAIL:${c.email}\n` : ''}${c.url ? `URL:${c.url}\n` : ''}END:VCARD`;
  const payload = mode === 'text' ? text : mode === 'wifi' ? (ssid ? wifiQrPayload(ssid, pass, pass ? 'WPA' : 'nopass') : '') : c.name ? vcard : '';
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>Link or text</button>
        <button className={mode === 'wifi' ? 'on' : ''} onClick={() => setMode('wifi')}>Wi-Fi</button>
        <button className={mode === 'contact' ? 'on' : ''} onClick={() => setMode('contact')}>Contact</button>
      </div>
      {mode === 'text' ? <Area value={text} onChange={setText} rows={3} /> : mode === 'wifi' ? (
        <div className="row"><input className="input grow" placeholder="Network name" value={ssid} onChange={(e) => setSsid(e.target.value)} /><input className="input grow" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
      ) : (
        <div className="grid cols-2" style={{ gap: 8 }}>
          {(['name', 'phone', 'email', 'org', 'url'] as const).map((k) => <input key={k} className="input" placeholder={{ name: 'Full name', phone: 'Phone', email: 'E-mail', org: 'Company', url: 'Website' }[k]} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} />)}
        </div>
      )}
      <QrImage text={payload} />
    </div>
  );
}

// ------------------------------------------------------------------ network

function Speed() {
  const [runs, setRuns] = useState<SpeedResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { void api.monitor.speedHistory().then(setRuns); }, []);
  const last = runs[runs.length - 1];
  return (
    <div className="col" style={{ gap: 10 }}>
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={async () => { setBusy(true); setErr(''); try { const r = await api.monitor.speedTest(); setRuns((x) => [...x, r]); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>{busy ? <><span className="spinner" /> Measuring…</> : 'Start speed test'}</button>
      {err ? <span className="small" style={{ color: 'var(--danger)' }}>{err}</span> : null}
      {last ? <div className="row" style={{ gap: 28 }}><div className="stat"><span className="v">{last.downMbps}</span><span className="l">Mbps download</span></div><div className="stat"><span className="v">{last.upMbps}</span><span className="l">Mbps upload</span></div><div className="stat"><span className="v">{last.pingMs}</span><span className="l">ms latency</span></div></div> : null}
      {runs.length > 1 ? <div className="small muted">Earlier: {runs.slice(-6, -1).reverse().map((r) => `${new Date(r.t).toLocaleDateString()} ${r.downMbps}↓/${r.upMbps}↑`).join(' · ')}</div> : null}
      <span className="small muted">Downloads and uploads a few megabytes to a public test server. Your history stays on this computer.</span>
    </div>
  );
}

function Network() {
  const [info, setInfo] = useState<NetworkInfo | null>(null);
  const [ip, setIp] = useState('');
  useEffect(() => { void api.tools.networkInfo().then(setInfo); }, []);
  return (
    <div className="col" style={{ gap: 8 }}>
      {info ? <div className="small">Computer name: <b>{info.hostname}</b></div> : null}
      {info?.interfaces.filter((i) => !i.internal).map((i) => (
        <div key={i.name + i.address} className="row small"><span className="badge">{i.family}</span><span style={{ width: 70 }}>{i.name}</span><code className="mono grow">{i.address}</code><span className="muted mono">{i.mac}</span><Copy text={i.address} /></div>
      ))}
      <div className="row">
        <button className="btn sm" onClick={() => void api.tools.publicIp().then(setIp).catch(() => setIp('Could not reach the service'))}>Show my public address</button>
        {ip ? <><code className="mono">{ip}</code><Copy text={ip} /></> : <span className="small muted">Asks a public service, only when you press the button.</span>}
      </div>
    </div>
  );
}

function Tweaks() {
  const [list, setList] = useState<Tweak[] | null>(null);
  const [ask, setAsk] = useState<{ t: Tweak; value?: boolean | number } | null>(null);
  const [pending, setPending] = useState<Record<string, number>>({});
  const { toast, info } = useStore();
  useEffect(() => { void api.tools.tweaks().then(setList); }, []);
  const apply = async (t: Tweak, value?: boolean | number) => {
    setAsk(null);
    setList(await api.tools.setTweak(t.id, value));
    toast('Done');
  };
  const change = (t: Tweak, value?: boolean | number) => (t.confirm ? setAsk({ t, value }) : void apply(t, value));
  return (
    <div className="col" style={{ gap: 6 }}>
      {list === null ? <span className="small muted">Reading settings…</span> : !list.length ? <span className="small muted">No system settings to change here.</span> : list.map((t) => (
        <div key={t.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
          <div className="grow"><b className="small">{t.label}</b><div className="small muted">{t.description}</div></div>
          {t.kind === 'toggle' ? <Toggle on={!!t.value} onChange={(v) => change(t, v)} />
            : t.kind === 'number' ? <><input className="input" type="number" step={0.1} min={0} max={5} style={{ width: 70 }} value={pending[t.id] ?? Number(t.value)} onChange={(e) => setPending({ ...pending, [t.id]: +e.target.value })} /><button className="btn sm" disabled={pending[t.id] === undefined} onClick={() => change(t, pending[t.id])}>Set</button></>
            : <button className="btn sm" onClick={() => change(t)}>Run</button>}
        </div>
      ))}
      {info?.platform === 'darwin' ? <MacFixes /> : null}
      {ask ? (
        <Modal title={ask.t.label} onClose={() => setAsk(null)}>
          <p>{ask.t.confirm} You can change this back at any time.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => setAsk(null)}>Cancel</button><button className="btn primary" onClick={() => void apply(ask.t, ask.value)}>Continue</button></div>
        </Modal>
      ) : null}
    </div>
  );
}

function MacFixes() {
  const { toast } = useStore();
  const [app, setApp] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'quarantine' | 'permissions' | null>(null);
  const run = async () => {
    if (!app || !confirm) return;
    const ok = confirm === 'quarantine' ? await api.tools.clearQuarantine(app) : await api.tools.resetPermissions(app);
    setConfirm(null);
    toast(ok ? (confirm === 'quarantine' ? 'The app should open normally now' : 'macOS will ask for permissions again') : 'That did not work for this app');
  };
  return (
    <div className="col" style={{ gap: 8, marginTop: 10 }}>
      <b className="small">Fix an app</b>
      <div className="row">
        <button className="btn sm" onClick={() => void api.tools.pickApp().then(setApp)}>Choose an app…</button>
        <span className="small ellipsis grow">{app ?? 'No app chosen'}</span>
      </div>
      <div className="btn-row">
        <button className="btn sm" disabled={!app} onClick={() => setConfirm('quarantine')}>“App is damaged” fix</button>
        <button className="btn sm" disabled={!app} onClick={() => setConfirm('permissions')}>Reset its privacy permissions</button>
      </div>
      {confirm ? (
        <Modal title={confirm === 'quarantine' ? 'Clear the download flag?' : 'Reset permissions?'} onClose={() => setConfirm(null)}>
          <p>{confirm === 'quarantine' ? 'macOS will stop treating this app as just downloaded. Only do this for apps you trust.' : 'The app loses access to the camera, microphone, files and screen until you allow it again.'}</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className="btn primary" onClick={() => void run()}>Continue</button></div>
        </Modal>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ text & developer

function Diff() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [view, setView] = useState<'inline' | 'side'>('inline');
  const lines = useMemo(() => { try { return diffLines(a, b); } catch (e) { return e instanceof Error ? e.message : ''; } }, [a, b]);
  const changes = Array.isArray(lines) ? lines.filter((l) => l.type !== 'same').length : 0;
  const open = (set: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) void f.text().then(set); e.target.value = ''; };
  const pick = (label: string, set: (v: string) => void) => <label className="btn sm"><Icon name="document" size={12} /> {label}<input type="file" hidden onChange={open(set)} /></label>;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 6 }}>{pick('Open original…', setA)}{pick('Open changed…', setB)}<span style={{ flex: 1 }} /><div className="seg">{(['inline', 'side'] as const).map((v) => <button key={v} className={`btn sm${view === v ? ' primary' : ''}`} onClick={() => setView(v)}>{v === 'inline' ? 'Inline' : 'Side by side'}</button>)}</div></div>
      <div className="grid cols-2" style={{ gap: 8 }}><Area value={a} onChange={setA} placeholder="Original" /><Area value={b} onChange={setB} placeholder="Changed" /></div>
      {typeof lines === 'string' ? <span className="small" style={{ color: 'var(--danger)' }}>{lines}</span> : a || b ? (
        <>
          <span className="small muted">{changes ? `${changes} changed line${changes === 1 ? '' : 's'}` : 'The texts are the same'}</span>
          <div className="card" style={{ maxHeight: 320, overflow: 'auto', padding: '6px 0' }}>
            {view === 'inline'
              ? lines.map((l, i) => <div key={i} className={`diff-line ${l.type}`}>{l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}{l.text || ' '}</div>)
              : sideBySide(lines).map((r, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                    <div className={`diff-line ${r.left === null ? '' : r.type === 'same' ? 'same' : 'del'}`}>{r.left ?? ' '}</div>
                    <div className={`diff-line ${r.right === null ? '' : r.type === 'same' ? 'same' : 'add'}`}>{r.right ?? ' '}</div>
                  </div>
                ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Lorem() {
  const [p, setP] = useState(3);
  const [seed, setSeed] = useState(1);
  const [format, setFormat] = useState<'text' | 'html' | 'markdown'>('text');
  const text = loremAs(lorem(p, 5, seed), format);
  return <div className="col" style={{ gap: 8 }}><div className="row"><span className="small">Paragraphs</span><input type="range" min={1} max={10} value={p} onChange={(e) => setP(+e.target.value)} /><span className="num">{p}</span><select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}><option value="text">Plain text</option><option value="html">HTML</option><option value="markdown">Markdown</option></select><button className="btn sm" onClick={() => setSeed(seed + 1)}><Icon name="refresh" size={12} /> Shuffle</button><Copy text={text} /></div><div className="tool-out" style={{ whiteSpace: 'pre-wrap' }}>{text}</div></div>;
}

function Speak() {
  const [text, setText] = useState('Keeper reads this out loud using the voices already on your computer.');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoice] = useState('');
  const [rate, setRate] = useState(1);
  useEffect(() => {
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  const say = () => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.name === voice);
    if (v) u.voice = v;
    u.rate = rate;
    speechSynthesis.speak(u);
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <Area value={text} onChange={setText} rows={4} />
      <div className="row">
        <select className="input grow" value={voice} onChange={(e) => setVoice(e.target.value)}><option value="">Default voice</option>{voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}</select>
        <span className="small">Speed</span><input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(e) => setRate(+e.target.value)} /><span className="num small">{rate.toFixed(1)}×</span>
      </div>
      <div className="btn-row"><button className="btn primary" onClick={say}><Icon name="play" size={12} /> Speak</button><button className="btn" onClick={() => speechSynthesis.cancel()}>Stop</button></div>
    </div>
  );
}

function Bases() {
  const [v, setV] = useState('255');
  const [from, setFrom] = useState(10);
  const r = convertBase(v, from);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row"><input className="input grow" value={v} onChange={(e) => setV(e.target.value)} /><select className="input" value={from} onChange={(e) => setFrom(+e.target.value)}><option value={2}>Binary</option><option value={8}>Octal</option><option value={10}>Decimal</option><option value={16}>Hex</option></select></div>
      {r ? (['dec', 'hex', 'bin', 'oct'] as const).map((k) => <div key={k} className="row small"><span style={{ width: 70 }} className="muted">{{ dec: 'Decimal', hex: 'Hex', bin: 'Binary', oct: 'Octal' }[k]}</span><code className="mono grow ellipsis">{r[k]}</code><Copy text={r[k]} /></div>) : <span className="small muted">Not a valid number in that base.</span>}
    </div>
  );
}

function Colours() {
  const [v, setV] = useState('#6d6dff');
  const r = colorFormats(v);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row"><input type="color" value={r?.hex.slice(0, 7) ?? '#000000'} onChange={(e) => setV(e.target.value)} /><input className="input grow" value={v} onChange={(e) => setV(e.target.value)} placeholder="#hex, rgb(), hsl()" /></div>
      {r ? (
        <>
          {(['hex', 'rgb', 'hsl', 'oklch'] as const).map((k) => <div key={k} className="row small"><span style={{ width: 60 }} className="muted">{k.toUpperCase()}</span><code className="mono grow">{r[k]}</code><Copy text={r[k]} /></div>)}
          <div className="row small">
            <span className="badge" style={{ background: r.hex, color: '#fff' }}>Aa on white text</span><span className="muted">contrast with white {r.contrastOnWhite}:1 {r.contrastOnWhite >= 4.5 ? '✓' : ''}</span>
            <span className="badge" style={{ background: r.hex, color: '#000' }}>Aa</span><span className="muted">with black {r.contrastOnBlack}:1 {r.contrastOnBlack >= 4.5 ? '✓' : ''}</span>
          </div>
        </>
      ) : <span className="small muted">Type a colour like #ff8800, rgb(255 136 0) or hsl(32 100% 50%).</span>}
    </div>
  );
}

function Encode({ kind }: { kind: 'url' | 'html' }) {
  const [v, setV] = useState('');
  const [all, setAll] = useState(false);
  let enc = '';
  let dec = '';
  try {
    enc = kind === 'url' ? encodeURIComponent(v) : htmlEncode(v, all);
    dec = kind === 'url' ? decodeURIComponent(v.replace(/\+/g, ' ')) : htmlDecode(v);
  } catch {
    dec = '(not valid encoded text)';
  }
  return (
    <div className="col" style={{ gap: 8 }}>
      <Area value={v} onChange={setV} rows={4} placeholder="Text" />
      {kind === 'html' ? <div className="row small"><Toggle on={all} onChange={setAll} /><span>Encode every non-ASCII character too</span></div> : null}
      <div className="row small"><b style={{ width: 60 }}>Encoded</b><div className="tool-out grow">{enc}</div><Copy text={enc} /></div>
      <div className="row small"><b style={{ width: 60 }}>Decoded</b><div className="tool-out grow">{dec}</div><Copy text={dec} /></div>
    </div>
  );
}

function Markdown() {
  const [v, setV] = useState('# Hello\n\nSome **bold** text, a [link](https://example.com) and a list:\n\n- one\n- two');
  const html = markdownToHtml(v);
  return (
    <div className="grid cols-2" style={{ gap: 10 }}>
      <Area value={v} onChange={setV} rows={12} />
      <div className="col" style={{ gap: 6 }}>
        <div className="card pad md-preview" dangerouslySetInnerHTML={{ __html: html }} />
        <div><Copy text={html} /></div>
      </div>
    </div>
  );
}

function Csv() {
  const [v, setV] = useState('name,age,city\nAna,34,Lisbon\nBo,29,Oslo');
  let out = '';
  try { out = JSON.stringify(csvToJson(v), null, 2); } catch (e) { out = e instanceof Error ? e.message : ''; }
  return <div className="grid cols-2" style={{ gap: 10 }}><Area value={v} onChange={setV} rows={10} placeholder="CSV (comma, semicolon or tab)" /><div className="col" style={{ gap: 6 }}><div className="tool-out">{out}</div><div><Copy text={out} /></div></div></div>;
}

function Cron() {
  const [v, setV] = useState('30 9 * * 1-5');
  let out = '';
  let err = '';
  try { out = explainCron(v); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  return <div className="col" style={{ gap: 8 }}><input className="input mono" value={v} onChange={(e) => setV(e.target.value)} /><div className="small muted mono">minute · hour · day of month · month · day of week</div>{err ? <span className="small" style={{ color: 'var(--danger)' }}>{err}</span> : <b>{out}</b>}</div>;
}

// ------------------------------------------------------------------ AI tools

function AiConsent({ what, onGo, busy }: { what: string; onGo: () => void; busy: boolean }) {
  const [info, setInfo] = useState<{ label: string; local: boolean; configured: boolean } | null>(null);
  useEffect(() => { void api.aiActions.provider().then(setInfo); }, []);
  if (!info) return null;
  if (!info.configured) return <div className="ai-consent">Set up the assistant in Settings first (a Claude or OpenAI key, or a local model).</div>;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className={info.local ? 'small muted' : 'ai-consent'}>{info.local ? `Runs on ${info.label}; nothing leaves this computer.` : `This sends ${what} to ${info.label}. Nothing is sent until you press the button.`}</div>
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={onGo}>{busy ? <><span className="spinner" /> Working…</> : 'Go'}</button>
    </div>
  );
}

function Receipts() {
  const { toast } = useStore();
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ csvPath: string; rows: Record<string, string | number | null>[] } | null>(null);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row"><button className="btn sm" onClick={() => void api.tools.pickFiles([{ name: 'Receipts', extensions: ['jpg', 'jpeg', 'png', 'heic', 'pdf', 'webp'] }]).then(setFiles)}>Choose receipts…</button><span className="small muted">{files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'Photos, screenshots or PDFs'}</span></div>
      {files.length ? <AiConsent what="the text read from these receipts" busy={busy} onGo={async () => { setBusy(true); try { setRes(await api.aiActions.receipts(files)); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }} /> : null}
      {res ? (
        <>
          <table className="file-list"><thead><tr>{Object.keys(res.rows[0] ?? {}).map((k) => <th key={k}>{k}</th>)}</tr></thead><tbody>{res.rows.map((r, i) => <tr key={i}>{Object.values(r).map((v, k) => <td key={k}>{v ?? '—'}</td>)}</tr>)}</tbody></table>
          <div className="row"><span className="small grow">Saved as {res.csvPath.split(/[\\/]/).pop()}</span><button className="btn sm" onClick={() => void api.files.reveal(res.csvPath)}>Show</button></div>
        </>
      ) : null}
    </div>
  );
}

function Subtitles() {
  const { toast } = useStore();
  const [file, setFile] = useState<string | null>(null);
  const [lang, setLang] = useState('Spanish');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row"><button className="btn sm" onClick={() => void api.tools.pickFiles([{ name: 'Subtitles', extensions: ['srt', 'vtt'] }]).then((f) => setFile(f[0] ?? null))}>Choose a subtitle file…</button><span className="small ellipsis">{file?.split(/[\\/]/).pop() ?? '.srt or .vtt'}</span></div>
      <div className="row"><span className="small">Translate into</span><input className="input" value={lang} onChange={(e) => setLang(e.target.value)} style={{ width: 180 }} /></div>
      {file ? <AiConsent what="the subtitle text" busy={busy} onGo={async () => { setBusy(true); try { setOut(await api.aiActions.translateSubtitles(file, lang)); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }} /> : null}
      {out ? <div className="row"><span className="small grow">Saved {out.split(/[\\/]/).pop()} — timings unchanged</span><button className="btn sm" onClick={() => void api.files.reveal(out)}>Show</button></div> : null}
    </div>
  );
}

export function moreTools(platform: string | undefined): MoreTool[] {
  const sysName = platform === 'darwin' ? 'Mac settings' : platform === 'win32' ? 'Windows settings' : 'System settings';
  return [
    { id: 'qr', name: 'QR code maker', desc: 'Links, text, Wi-Fi networks and contact cards as a QR code.', icon: 'grid', group: 'Text', render: () => <Qr /> },
    { id: 'diff', name: 'Compare texts', desc: 'See exactly which lines changed between two versions.', icon: 'dupes', group: 'Text', render: () => <Diff /> },
    { id: 'speak', name: 'Read aloud', desc: 'Hear any text in the voices on your computer.', icon: 'audio', group: 'Text', render: () => <Speak /> },
    { id: 'lorem', name: 'Placeholder text', desc: 'Lorem ipsum paragraphs for mock-ups.', icon: 'document', group: 'Text', render: () => <Lorem /> },
    { id: 'receipts', name: 'Receipts to spreadsheet', desc: 'Date, shop, total and currency from photos of receipts, as a CSV.', icon: 'assistant', group: 'Text', render: () => <Receipts /> },
    { id: 'subs', name: 'Translate subtitles', desc: 'Translate .srt and .vtt files and keep every timing.', icon: 'assistant', group: 'Text', render: () => <Subtitles /> },
    { id: 'markdown', name: 'Markdown preview', desc: 'See Markdown as formatted text and copy the HTML.', icon: 'code', group: 'Developer', render: () => <Markdown /> },
    { id: 'csv', name: 'CSV to JSON', desc: 'Turn a spreadsheet export into JSON.', icon: 'code', group: 'Developer', render: () => <Csv /> },
    { id: 'colours', name: 'Colour converter', desc: 'Hex, RGB, HSL and OKLCH, with contrast checks.', icon: 'palette', group: 'Developer', render: () => <Colours /> },
    { id: 'bases', name: 'Number bases', desc: 'Decimal, hex, binary and octal.', icon: 'code', group: 'Developer', render: () => <Bases /> },
    { id: 'url', name: 'URL encode', desc: 'Encode and decode text for links.', icon: 'globe', group: 'Developer', render: () => <Encode kind="url" /> },
    { id: 'html', name: 'HTML entities', desc: 'Escape and unescape &amp;, &lt; and friends.', icon: 'code', group: 'Developer', render: () => <Encode kind="html" /> },
    { id: 'cron', name: 'Cron explainer', desc: 'What “30 9 * * 1-5” means, in words.', icon: 'clock', group: 'Developer', render: () => <Cron /> },
    { id: 'speed', name: 'Internet speed', desc: 'Download, upload and latency, with history.', icon: 'bolt', group: 'System', render: () => <Speed /> },
    { id: 'network', name: 'Network details', desc: 'Your addresses on this network and the internet.', icon: 'globe', group: 'System', render: () => <Network /> },
    { id: 'tweaks', name: sysName, desc: 'Hidden files, extensions and other handy switches — always asked first.', icon: 'settings', group: 'System', render: () => <Tweaks /> },
  ];
}
