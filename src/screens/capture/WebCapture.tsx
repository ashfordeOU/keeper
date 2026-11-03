// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Capture a web page": paste an address, choose desktop, phone or the social
// preview size and PNG or PDF; Keeper's browser does the rest in a private
// window and the result opens from here.

import { useEffect, useRef, useState } from 'react';
import type { WebCaptureResult } from '../../../core/api-webcapture';
import { defaultWebCapture, DEVICES, normalizeCaptureUrl, type CaptureDevice, type WebCaptureOptions } from '../../../core/web-capture';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { Modal, Toggle } from '../../components/ui';
import '../../styles/extras.css';

const DEVICE_ICON: Record<CaptureDevice, string> = { desktop: 'laptop', phone: 'phone', social: 'share' };

export function WebCaptureSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [o, setO] = useState<Omit<WebCaptureOptions, 'url'>>(defaultWebCapture());
  const [phase, setPhase] = useState('');
  const [err, setErr] = useState('');
  const [res, setRes] = useState<WebCaptureResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => api.on('webcapture-phase', (t) => setPhase(String(t))), []);
  useEffect(() => { input.current?.focus(); }, []);

  let valid = '';
  try { valid = url.trim() ? normalizeCaptureUrl(url) : ''; } catch { valid = ''; }
  const busy = !!phase && !res && !err;
  const set = (p: Partial<typeof o>) => setO({ ...o, ...p, ...(p.device === 'social' ? { format: 'png' as const } : {}) });
  const start = async () => {
    setErr(''); setRes(null); setPhase('Opening the page');
    try {
      const r = await api.capture.webPage({ ...o, url: valid });
      setRes(r);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally { setPhase(''); }
  };

  return (
    <Modal title="Capture a web page" onClose={onClose} width={560}>
      {res ? (
        <div className="xform wc-done" data-testid="wc-done">
          <div className="wc-result">
            {res.thumb ? <img src={res.thumb} alt="" className="wc-thumb" /> : <div className="wc-thumb wc-pdf" aria-hidden><Icon name="document" size={28} /></div>}
            <div className="wc-result-text">
              <b>{res.title}</b>
              <span className="trust-line" data-testid="wc-facts">{[res.format === 'pdf' ? 'PDF' : `${res.width} × ${res.height.toLocaleString()} pixels`, res.banner ? 'Cookie banner closed' : '', res.cut ? 'Cut at the tallest picture possible' : '', 'Saved to Screenshots'].filter(Boolean).join(' · ')}</span>
            </div>
          </div>
          <div className="xform-foot">
            <button className="btn ghost" onClick={() => { setRes(null); setUrl(''); input.current?.focus(); }}>Capture another</button>
            <span className="grow" />
            <button className="btn" onClick={() => void api.files.reveal(res.path)}>Show in folder</button>
            <button className="btn primary" onClick={() => void api.files.open(res.path)} data-testid="wc-open">Open</button>
          </div>
        </div>
      ) : (
        <form className="xform" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void start(); }} data-testid="wc-sheet">
          <label>Address
            <input ref={input} className="input" value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} placeholder="example.com/article" disabled={busy} data-testid="wc-url" inputMode="url" />
          </label>
          <div className="wc-row">
            <span className="insp-title">Looks like</span>
            <div className="seg" role="radiogroup" aria-label="Looks like">
              {(Object.keys(DEVICES) as CaptureDevice[]).map((d) => (
                <button type="button" key={d} role="radio" aria-checked={o.device === d} className={o.device === d ? 'on' : ''} onClick={() => set({ device: d })} disabled={busy} data-testid={`wc-device-${d}`}>
                  <Icon name={DEVICE_ICON[d]} size={13} /> {DEVICES[d].label}
                </button>
              ))}
            </div>
          </div>
          <div className="wc-row">
            <span className="insp-title">Save as</span>
            <div className="seg" role="radiogroup" aria-label="Save as">
              <button type="button" role="radio" aria-checked={o.format === 'png'} className={o.format === 'png' ? 'on' : ''} onClick={() => set({ format: 'png' })} disabled={busy} data-testid="wc-png">Picture (PNG)</button>
              <button type="button" role="radio" aria-checked={o.format === 'pdf'} className={o.format === 'pdf' ? 'on' : ''} onClick={() => set({ format: 'pdf' })} disabled={busy || o.device === 'social'} title={o.device === 'social' ? 'The social image is always a picture' : undefined} data-testid="wc-pdf">PDF</button>
            </div>
          </div>
          <p className="xform-note">{o.device === 'social' ? 'The top of the page at 1200 × 630, the size link previews use.' : o.device === 'phone' ? 'The whole page as a phone shows it.' : 'The whole page, top to bottom, as a desktop browser shows it.'}</p>
          <details className="xmore">
            <summary>More settings</summary>
            <div className="xform">
              <label className="mo-inline wc-toggle"><Toggle on={o.banners} onChange={(v) => set({ banners: v })} label="Close cookie banners" /> Close cookie banners (choosing “only necessary” where offered)</label>
              <label className="mo-inline wc-toggle"><Toggle on={o.scroll} onChange={(v) => set({ scroll: v })} label="Load the whole page first" /> Load the whole page first, so late pictures are there</label>
              {o.device === 'desktop' ? <label className="mo-inline wc-toggle"><Toggle on={o.sharp} onChange={(v) => set({ sharp: v })} label="Sharper picture" /> Sharper picture (twice the pixels)</label> : null}
            </div>
          </details>
          {busy ? <div className="wc-busy" role="status" aria-live="polite" data-testid="wc-phase"><div className="progress indeterminate" aria-hidden><i /></div><span>{phase}…</span></div> : null}
          {err ? <p className="xform-err" role="alert" data-testid="wc-error">{err}</p> : null}
          <div className="xform-foot">
            <span className="trust-line grow">A private window · nothing kept · saved to Screenshots</span>
            <button className="btn primary" type="submit" disabled={!valid || busy} data-testid="wc-go">{busy ? 'Capturing…' : 'Capture'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
