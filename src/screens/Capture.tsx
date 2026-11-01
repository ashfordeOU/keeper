// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Captures: text copied from the screen, QR codes and barcodes, screenshots,
// recordings and picked colours — with the tools to make more.

import { useEffect, useMemo, useState } from 'react';
import type { CaptureResult, RecordState } from '../../core/api';
import type { CaptureEntry, CaptureOptions } from '../../core/capture';
import { isHttpUrl } from '../../core/capture';
import { relativeTime } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Modal, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/capture.css';

type Tab = 'all' | 'text' | 'links' | 'codes' | 'media';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'text', label: 'Text' },
  { id: 'links', label: 'Links' },
  { id: 'codes', label: 'Codes' },
  { id: 'media', label: 'Screenshots & more' },
];

const KIND_LABEL: Record<CaptureEntry['kind'], string> = {
  text: 'Text', link: 'Link', qr: 'QR code', barcode: 'Barcode', screenshot: 'Screenshot', recording: 'Recording', color: 'Colour',
};

function inTab(e: CaptureEntry, tab: Tab): boolean {
  switch (tab) {
    case 'text': return e.kind === 'text';
    case 'links': return e.kind === 'link' || ((e.kind === 'qr' || e.kind === 'barcode') && isHttpUrl(e.value));
    case 'codes': return e.kind === 'qr' || e.kind === 'barcode';
    case 'media': return e.kind === 'screenshot' || e.kind === 'recording' || e.kind === 'color';
    default: return true;
  }
}

function mmss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Capture() {
  const { toast, go, settings } = useStore();
  const isMac = /Mac/.test(navigator.platform);
  const [items, setItems] = useState<CaptureEntry[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [rec, setRec] = useState<RecordState>({ recording: false });
  const [now, setNow] = useState(Date.now());
  const [opts, setOpts] = useState<CaptureOptions | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);

  const reload = () => void api.capture.history().then(setItems);
  useEffect(() => {
    reload();
    void api.capture.recordState().then(setRec);
    void api.capture.options().then(setOpts);
    const off = api.on('island-changed', () => { reload(); void api.capture.recordState().then(setRec); });
    return off;
  }, []);
  useEffect(() => {
    if (!rec.recording) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [rec.recording]);

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    try {
      return await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(null);
      reload();
    }
  };

  const afterRead = (r: CaptureResult | null | undefined) => {
    if (!r) return;
    setResult(r);
    if (r.code && isHttpUrl(r.code) && opts?.openQrLinks) toast(`Found a link: ${r.code}`, { label: 'Open', run: () => void api.capture.openLink(r.code!) });
  };

  const setOpt = async (patch: Partial<CaptureOptions>) => setOpts(await api.capture.setOptions(patch));

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((e) => inTab(e, tab) && (!q || e.value.toLowerCase().includes(q)));
  }, [items, tab, query]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, items.filter((e) => inTab(e, t.id)).length])) as Record<Tab, number>, [items]);
  const key = (a: string) => a.replace('CommandOrControl', isMac ? '⌘' : 'Ctrl').replace('Alt', isMac ? '⌥' : 'Alt').replace('Shift', isMac ? '⇧' : 'Shift').replace(/\+/g, isMac ? '' : '+');

  return (
    <div className="capture-page">
      <PageHead title="Capture" sub="Copy text from anywhere on screen, read QR codes and barcodes, take screenshots, record the screen and pick colours. Everything stays on this computer.">
        <button className="btn" onClick={() => setShowOptions(true)}><Icon name="settings" size={14} /> Options</button>
      </PageHead>

      <div className="capture-actions">
        <button className="capture-action" disabled={!!busy} onClick={() => void run('text', () => api.capture.text()).then(afterRead)}>
          <Icon name="text" size={20} /><b>Copy text from screen</b><span>Drag over any text — even in a video or picture</span>{settings?.island.captureShortcut ? <kbd>{key(settings.island.captureShortcut)}</kbd> : null}
        </button>
        <button className="capture-action" disabled={!!busy} onClick={() => void run('clip', () => api.capture.clipboardImage()).then((r) => (r ? afterRead(r) : toast('There is no image on the clipboard')))}>
          <Icon name="clipboard" size={20} /><b>Read clipboard image</b><span>Text and codes from an image you copied</span>
        </button>
        <div className="capture-action split">
          <Icon name="screenshot" size={20} /><b>Take a screenshot</b><span>Saved to Pictures › Screenshots and the shelf</span>
          <div className="btn-row">
            <button className="btn sm" disabled={!!busy} onClick={() => void run('shot', () => api.capture.screenshot('area'))}>Area</button>
            <button className="btn sm" disabled={!!busy} onClick={() => void run('shot', () => api.capture.screenshot('window'))}>Window</button>
            <button className="btn sm" disabled={!!busy} onClick={() => void run('shot', () => api.capture.screenshot('full'))}>Screen</button>
          </div>
          {opts ? <kbd>{key(opts.screenshotShortcut)}</kbd> : null}
        </div>
        <div className={`capture-action split ${rec.recording ? 'recording' : ''}`}>
          <Icon name="video" size={20} /><b>{rec.recording ? `Recording · ${mmss(now - (rec.since ?? now))}` : 'Record the screen'}</b>
          <span>{rec.recording ? 'Stop to save the video' : 'Whole screen, a window or an area, with sound if you like'}</span>
          {rec.recording ? (
            <button className="btn sm danger" onClick={() => void run('rec', () => api.capture.stopRecording()).then(() => api.capture.recordState().then(setRec))}><span className="rec-dot" /> Stop</button>
          ) : (
            <div className="btn-row">
              <button className="btn sm" disabled={!!busy} onClick={() => void run('rec', () => api.capture.record('full')).then((s) => s && setRec(s))}>Screen</button>
              <button className="btn sm" disabled={!!busy} onClick={() => void run('rec', () => api.capture.record('window')).then((s) => s && setRec(s))}>Window</button>
              <button className="btn sm" disabled={!!busy} onClick={() => void run('rec', () => api.capture.record('area')).then((s) => s && setRec(s))}>Area</button>
            </div>
          )}
          {opts ? <kbd>{key(opts.recordShortcut)}</kbd> : null}
        </div>
        <button className="capture-action" disabled={!!busy} onClick={() => void run('color', () => api.capture.color())}>
          <Icon name="drop" size={20} /><b>Pick a colour</b><span>From anywhere on screen; copied as hex</span>{opts ? <kbd>{key(opts.colorShortcut)}</kbd> : null}
        </button>
      </div>

      {busy ? <div className="progress indeterminate" role="progressbar" aria-label="Working" style={{ margin: '14px 0' }}><i /></div> : null}

      {result ? (
        <div className="card pad capture-result">
          <div className="row" style={{ marginBottom: 8 }}>
            <h3 className="grow">Just read</h3>
            {result.text ? <button className="btn sm" onClick={() => void api.files.copyText(result.text)}><Icon name="copy" size={12} /> Copy text</button> : null}
            {result.code ? <button className="btn sm" onClick={() => void api.files.copyText(result.code!)}><Icon name="copy" size={12} /> Copy code</button> : null}
            {result.code && isHttpUrl(result.code) ? <button className="btn sm" onClick={() => void api.capture.openLink(result.code!)}><Icon name="external" size={12} /> Open link</button> : null}
            <button aria-label="Close" title="Close" className="btn ghost sm icon" onClick={() => setResult(null)}><Icon name="close" size={12} /></button>
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {result.image ? <img className="result-thumb" src={result.image} alt="" /> : null}
            <div className="grow">
              {result.code ? <div className="small" style={{ marginBottom: 6 }}><span className="badge accent">{result.codeFormat === 'QR_CODE' ? 'QR code' : (result.codeFormat ?? 'Code').replace(/_/g, '-')}</span> <code className="mono">{result.code}</code></div> : null}
              <pre className="capture-text">{result.text || (result.code ? '' : 'No text found in that area.')}</pre>
            </div>
          </div>
        </div>
      ) : null}

      <div className="row" style={{ margin: '22px 0 12px', flexWrap: 'wrap' }}>
        <div className="seg">
          {TABS.map((t) => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label} <span className="muted">{counts[t.id]}</span></button>)}
        </div>
        <input className="input grow" style={{ maxWidth: 280 }} placeholder="Search captures" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="grow" />
        {items.length ? <button className="btn sm" onClick={() => void api.capture.clearHistory().then(reload)}>Clear history</button> : null}
      </div>

      {shown.length === 0 ? (
        <Empty icon="screenshot" title={items.length ? 'Nothing in this tab' : 'Nothing captured yet'}>Text you copy from the screen, codes you scan, screenshots, recordings and colours show up here.</Empty>
      ) : (
        <div className="capture-list">
          {shown.map((e) => (
            <div key={e.id} className="card capture-item">
              <div className="capture-thumb">
                {e.kind === 'color' ? <span style={{ background: e.value }} className="swatch" /> : e.thumb ? <img src={e.thumb} alt="" /> : <Icon name={e.kind === 'recording' ? 'video' : e.kind === 'link' ? 'globe' : e.kind === 'text' ? 'text' : 'grid'} size={22} />}
              </div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row small" style={{ gap: 6 }}>
                  <span className="badge">{KIND_LABEL[e.kind]}{e.format && e.kind === 'barcode' ? ` · ${e.format.replace(/_/g, '-')}` : ''}</span>
                  <span className="muted">{relativeTime(e.at)}</span>
                </div>
                <div className={`capture-value ${e.kind === 'text' ? 'multi' : ''}`} title={e.value}>{e.value}</div>
              </div>
              <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
                {e.path ? (
                  <>
                    <button className="btn sm" onClick={() => void api.files.open(e.path!)}>Open</button>
                    {e.kind === 'screenshot' ? <button className="btn sm" onClick={() => go({ name: 'annotate', arg: e.path })}><Icon name="rename" size={12} /> Annotate</button> : null}
                    <button className="btn sm icon" title="Show in folder" aria-label="Show in folder" onClick={() => void api.files.reveal(e.path!)}><Icon name="reveal" size={12} /></button>
                  </>
                ) : (
                  <>
                    <button className="btn sm" onClick={() => { void api.files.copyText(e.value); toast('Copied'); }}><Icon name="copy" size={12} /> Copy</button>
                    {isHttpUrl(e.value) ? <button className="btn sm icon" title="Open link" aria-label="Open link" onClick={() => void api.capture.openLink(e.value)}><Icon name="external" size={12} /></button> : null}
                  </>
                )}
                <button className="btn ghost sm icon" title="Remove" aria-label="Remove" onClick={() => void api.capture.removeHistory(e.id).then(reload)}><Icon name="close" size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showOptions && opts ? (
        <Modal title="Capture options" onClose={() => setShowOptions(false)}>
          <div className="col" style={{ gap: 12 }}>
            <Opt label="Keep line breaks" hint="Off joins wrapped lines into paragraphs."><Toggle on={opts.keepLineBreaks} onChange={(v) => void setOpt({ keepLineBreaks: v })} /></Opt>
            <Opt label="Careful recognition" hint="Slower but reads small text better. Off is faster."><Toggle on={opts.accurate} onChange={(v) => void setOpt({ accurate: v })} /></Opt>
            <Opt label="Detect the language" hint={navigator.platform.startsWith('Mac') ? "Works out the language by itself and reads neat handwriting, with macOS's own recognizer." : 'Works out the language and writing system by itself; the right reader is downloaded once.'}><Toggle on={opts.autoLanguage} onChange={(v) => void setOpt({ autoLanguage: v })} /></Opt>
            <Opt label="Reader" hint={navigator.platform.startsWith('Win') ? 'Windows’ own recognizer reads neat handwriting; the built-in reader works offline everywhere.' : navigator.platform.startsWith('Mac') ? 'macOS’s own recognizer reads neat handwriting.' : 'Linux uses the built-in reader; the settings below tune it.'}>
              <select className="input" value={opts.ocrEngine ?? 'auto'} onChange={(e) => void setOpt({ ocrEngine: e.target.value as never })}>
                <option value="auto">Automatic</option><option value="system">The system’s recognizer</option><option value="builtin">The built-in reader</option>
              </select>
            </Opt>
            <Opt label="Text layout" hint="Helps the built-in reader: one line, a block, or scattered text like a screenshot of an app.">
              <select className="input" value={opts.ocrLayout ?? 'auto'} onChange={(e) => void setOpt({ ocrLayout: e.target.value as never })}>
                <option value="auto">Automatic</option><option value="block">A block of text</option><option value="column">Columns</option><option value="line">One line</option><option value="word">One word</option><option value="sparse">Scattered text</option>
              </select>
            </Opt>
            <Opt label="Clean up the picture first" hint="Higher contrast, light-on-dark turned around, then black and white. Helps the built-in reader with screenshots and dark mode."><Toggle on={opts.ocrEnhance !== false} onChange={(v) => void setOpt({ ocrEnhance: v })} /></Opt>
            <Opt label="Handwriting" hint="Uses the system’s recognizer where there is one; elsewhere keeps soft strokes instead of black and white."><Toggle on={!!opts.handwriting} onChange={(v) => void setOpt({ handwriting: v })} /></Opt>
            <Opt label="Offer to open links in QR codes" hint="Asks first; only web links."><Toggle on={opts.openQrLinks} onChange={(v) => void setOpt({ openQrLinks: v })} /></Opt>
            <Opt label="Open screenshots in the editor" hint="Right after taking one."><Toggle on={opts.annotateAfterScreenshot} onChange={(v) => void setOpt({ annotateAfterScreenshot: v })} /></Opt>
            <div className="divider" />
            <Opt label="Record the microphone"><Toggle on={opts.recordMic} onChange={(v) => void setOpt({ recordMic: v })} /></Opt>
            <Opt label="Record system sound" hint="Windows and Linux."><Toggle on={opts.recordSystemAudio} onChange={(v) => void setOpt({ recordSystemAudio: v })} /></Opt>
            <Opt label="Save recordings as MP4" hint="Plays everywhere. Off keeps WebM."><Toggle on={opts.recordMp4} onChange={(v) => void setOpt({ recordMp4: v })} /></Opt>
            <div className="divider" />
            <Opt label="Screenshot folder"><FolderField value={opts.screenshotFolder} placeholder="Pictures › Screenshots" onChange={(v) => void setOpt({ screenshotFolder: v })} /></Opt>
            <Opt label="Recording folder"><FolderField value={opts.recordingFolder} placeholder="Movies / Videos" onChange={(v) => void setOpt({ recordingFolder: v })} /></Opt>
            <div className="divider" />
            <Opt label="Screenshot shortcut"><input className="input" value={opts.screenshotShortcut} onChange={(e) => setOpts({ ...opts, screenshotShortcut: e.target.value })} onBlur={(e) => void setOpt({ screenshotShortcut: e.target.value })} /></Opt>
            <Opt label="Recording shortcut"><input className="input" value={opts.recordShortcut} onChange={(e) => setOpts({ ...opts, recordShortcut: e.target.value })} onBlur={(e) => void setOpt({ recordShortcut: e.target.value })} /></Opt>
            <Opt label="Colour picker shortcut"><input className="input" value={opts.colorShortcut} onChange={(e) => setOpts({ ...opts, colorShortcut: e.target.value })} onBlur={(e) => void setOpt({ colorShortcut: e.target.value })} /></Opt>
            <span className="small muted">Recognition languages are set in Settings › Library.</span>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Opt({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <div className="grow"><div style={{ fontWeight: 550 }}>{label}</div>{hint ? <div className="small muted">{hint}</div> : null}</div>
      {children}
    </div>
  );
}

function FolderField({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <span className="small ellipsis" style={{ maxWidth: 220 }} title={value}>{value || <span className="muted">{placeholder}</span>}</span>
      <button className="btn sm" onClick={() => void api.settings.pickFolder().then((p) => p && onChange(p))}>Choose…</button>
      {value ? <button className="btn ghost sm" onClick={() => onChange('')}>Default</button> : null}
    </div>
  );
}
