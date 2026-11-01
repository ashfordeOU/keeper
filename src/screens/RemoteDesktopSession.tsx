// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A remote desktop in a Keeper tab: VNC drawn on a canvas (keyboard, pointer,
// wheel, clipboard, special keys, fit or 100 %, view only), and web consoles
// shown in a page view laid over the tab.

import { useEffect, useRef, useState } from 'react';
import type { RdcSession } from '../../core/rdc/types';
import type { FrameOp } from '../../core/rdc/rfb';
import { buttonMask, COMBOS, keysymFor } from '../../core/rdc/keysym';
import type { VncInput } from '../../core/rdc/api';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ContextMenu, Empty, Modal } from '../components/ui';
import { useStore } from '../state';
import { rdcTabNames } from '../components/TabStrip';
import '../styles/rdc.css';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function useSession(sid: string): RdcSession | null | undefined {
  const [s, setS] = useState<RdcSession | null | undefined>(undefined);
  useEffect(() => {
    const load = () => void api.rdc.state().then((st) => { const x = st.sessions.find((y) => y.id === sid) ?? null; if (x) rdcTabNames.set(sid, x.name); setS(x); }).catch(() => setS(null));
    load();
    return api.on('rdc-changed', load);
  }, [sid]);
  return s;
}

/** Draws one update; JPEG rectangles (Tight) are decoded by the window's own image decoder first, so order is kept. */
async function drawOps(ctx: CanvasRenderingContext2D, ops: FrameOp[]) {
  const jpegs = new Map<FrameOp, ImageBitmap | null>();
  await Promise.all(ops.map(async (op) => {
    if (op.t !== 'jpeg') return;
    const bytes = new Uint8Array(op.data);
    jpegs.set(op, await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' })).catch(() => null));
  }));
  for (const op of ops) {
    if (op.t === 'jpeg') {
      const bmp = jpegs.get(op);
      if (bmp) { ctx.drawImage(bmp, op.x, op.y, op.w, op.h); bmp.close(); }
    } else if (op.t === 'img') {
      if (!op.w || !op.h) continue;
      const data = new Uint8ClampedArray(op.data.buffer as ArrayBuffer, op.data.byteOffset, op.data.byteLength);
      ctx.putImageData(new ImageData(data, op.w, op.h), op.x, op.y);
    } else if (op.t === 'copy') {
      ctx.drawImage(ctx.canvas, op.sx, op.sy, op.w, op.h, op.x, op.y, op.w, op.h);
    } else {
      ctx.fillStyle = `rgb(${op.rgba[0]},${op.rgba[1]},${op.rgba[2]})`;
      ctx.fillRect(op.x, op.y, op.w, op.h);
    }
  }
}

export function VncView({ sid }: { sid: string }) {
  const { toast, tabs } = useStore();
  const session = useSession(sid);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState(true);
  const [viewOnly, setViewOnly] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [cursor, setCursor] = useState('default');
  const buttons = useRef(0);
  const pending = useRef<VncInput[]>([]);

  useEffect(() => {
    let alive = true;
    void api.rdc.vncAttach(sid).then((r) => {
      if (!alive) return;
      if (!r) { setEnded('This connection has ended.'); return; }
      setSize({ w: r.width, h: r.height });
      setViewOnly(r.viewOnly);
    }).catch((e) => setEnded(clean(e)));
    const offFrame = api.on('rdc-frame', (f) => {
      if (f.sid !== sid) return;
      const ctx = canvas.current?.getContext('2d');
      // Drawn: the next picture may come.
      void (ctx ? drawOps(ctx, f.ops) : Promise.resolve()).finally(() => api.rdc.vncAck(sid, f.seq));
    });
    const offVnc = api.on('rdc-vnc', (s, e) => {
      if (s !== sid) return;
      if (e.t === 'resize') setSize({ w: e.width, h: e.height });
      else if (e.t === 'clipboard') void api.files.copyText(e.text).catch(() => undefined);
      else if (e.t === 'closed') setEnded(e.error ?? 'The connection ended.');
      else if (e.t === 'cursor') {
        if (!e.w || !e.h) { setCursor('none'); return; }
        const c = document.createElement('canvas');
        c.width = e.w;
        c.height = e.h;
        c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(e.rgba.buffer as ArrayBuffer, e.rgba.byteOffset, e.rgba.byteLength), e.w, e.h), 0, 0);
        setCursor(`url(${c.toDataURL()}) ${e.hotX} ${e.hotY}, default`);
      }
    });
    return () => { alive = false; offFrame(); offVnc(); api.rdc.vncDetach(sid); };
  }, [sid]);

  // The canvas keeps its pixels when it is resized only if we copy them; a resize means a full picture comes anyway.
  useEffect(() => { if (size && canvas.current) { canvas.current.width = size.w; canvas.current.height = size.h; } }, [size]);

  const flush = () => {
    if (!pending.current.length) return;
    api.rdc.vncInput(sid, pending.current);
    pending.current = [];
  };
  const queue = (e: VncInput) => {
    if (viewOnly) return;
    pending.current.push(e);
    if (pending.current.length === 1) requestAnimationFrame(flush);
  };
  const point = (e: React.MouseEvent | React.WheelEvent) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };

  if (session === undefined) return <div className="spinner" />;
  if (ended || session === null || session.state === 'closed' || session.state === 'error') {
    return (
      <Empty icon="laptop" title={session?.name ?? 'Remote desktop'}>
        {ended ?? session?.error ?? 'This connection has ended.'}
        <div style={{ marginTop: 10 }}><button className="btn" onClick={() => tabs.open({ name: 'rdc' }, {})}>Remote Desktops</button></div>
      </Empty>
    );
  }
  return (
    <div className="rdc-viewer" data-testid="rdc-vnc">
      <div className="rdc-viewer-bar">
        <span className="rdc-dot online" />
        <b className="ellipsis">{session.name}</b>
        <span className="small muted ellipsis">{session.desktop ? `${session.desktop} · ` : ''}{size ? `${size.w}×${size.h}` : ''}{session.via ? ` · ${session.via}` : ''}</span>
        <div className="grow" />
        <button className={`btn sm ${fit ? 'primary' : ''}`} onClick={() => setFit(!fit)} title="Fit to the tab, or show at 100 %">{fit ? 'Fit' : '100%'}</button>
        <button className={`btn sm ${viewOnly ? 'primary' : ''}`} onClick={() => { setViewOnly(!viewOnly); void api.rdc.vncSetViewOnly(sid, !viewOnly); }} title="View only: your keyboard and mouse are not sent"><Icon name={viewOnly ? 'eyeOff' : 'eye'} size={13} /> {viewOnly ? 'View only' : 'Control'}</button>
        <button className="btn sm" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}>Keys <Icon name="chevronDown" size={12} /></button>
        <button className="btn sm" title="Type or paste text to send to the remote clipboard" onClick={() => void navigator.clipboard.readText().then((t) => setPaste(t)).catch(() => setPaste(''))}><Icon name="clipboard" size={13} /> Send clipboard</button>
        <button className="btn sm ghost" title="Move this tab into a window of its own" aria-label="Move this tab into a window of its own" onClick={() => tabs.toWindow(tabs.active)}><Icon name="external" size={13} /></button>
        <button className="btn sm ghost" onClick={() => void api.rdc.disconnect(sid)}>Disconnect</button>
      </div>
      <div className={`rdc-stage ${fit ? 'fit' : ''}`}>
        <canvas
          ref={canvas}
          tabIndex={0}
          data-testid="rdc-canvas"
          className="rdc-canvas"
          style={{ cursor: viewOnly ? 'default' : cursor }}
          onMouseMove={(e) => { const p = point(e); queue({ t: 'pointer', ...p, buttons: buttons.current }); }}
          onMouseDown={(e) => { e.preventDefault(); canvas.current?.focus(); buttons.current = buttonMask(e.buttons); const p = point(e); queue({ t: 'pointer', ...p, buttons: buttons.current }); }}
          onMouseUp={(e) => { buttons.current = buttonMask(e.buttons); const p = point(e); queue({ t: 'pointer', ...p, buttons: buttons.current }); }}
          onContextMenu={(e) => e.preventDefault()}
          onWheel={(e) => {
            const p = point(e);
            const b = e.deltaY < 0 ? 8 : e.deltaY > 0 ? 16 : e.deltaX < 0 ? 32 : 64;
            queue({ t: 'pointer', ...p, buttons: buttons.current | b });
            queue({ t: 'pointer', ...p, buttons: buttons.current });
          }}
          onKeyDown={(e) => { const k = keysymFor(e); if (k) { e.preventDefault(); queue({ t: 'key', keysym: k, down: true }); } }}
          onKeyUp={(e) => { const k = keysymFor(e); if (k) { e.preventDefault(); queue({ t: 'key', keysym: k, down: false }); } }}
        />
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={Object.entries(COMBOS).map(([id, c]) => ({ label: c.label, run: () => void api.rdc.vncKeys(sid, id).then(() => canvas.current?.focus()) }))} /> : null}
      {paste !== null ? (
        <Modal title="Send to the remote clipboard" onClose={() => setPaste(null)} width={460}>
          <textarea className="input mono" rows={5} style={{ width: '100%' }} autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} />
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn" onClick={() => setPaste(null)}>Cancel</button>
            <button className="btn primary" onClick={() => { void api.rdc.vncClipboard(sid, paste).then(() => toast('Sent. Paste it on the remote computer.')); setPaste(null); canvas.current?.focus(); }}>Send</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function WebConsole({ sid }: { sid: string }) {
  const { toast } = useStore();
  const session = useSession(sid);
  const area = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<{ url: string; title: string; cert?: { fingerprint: string; trusted: boolean } } | null>(null);
  const [cert, setCert] = useState<string | null>(null);

  useEffect(() => {
    const el = area.current;
    if (!el || !session || session.state !== 'connected') return;
    const place = () => {
      const r = el.getBoundingClientRect();
      // Hidden while a question is showing, so the page does not cover it.
      void api.rdc.webShow(sid, cert ? null : { x: r.left, y: r.top, width: r.width, height: r.height }).then((i) => i && setInfo(i)).catch(() => undefined);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener('resize', place);
    return () => { ro.disconnect(); window.removeEventListener('resize', place); void api.rdc.webShow(sid, null).catch(() => undefined); };
  }, [sid, session, cert]);

  useEffect(() => api.on('rdc-web', (s, e) => {
    if (s !== sid) return;
    if (e.t === 'cert') setCert(e.fingerprint);
    else setInfo((i) => ({ ...(i ?? { url: e.url, title: e.title }), url: e.url, title: e.title }));
  }), [sid]);

  if (session === undefined) return <div className="spinner" />;
  if (!session || session.state !== 'connected') return <Empty icon="globe" title="This console is closed" />;
  const trust = async () => {
    const st = await api.rdc.state();
    const c = st.connections.find((x) => x.id === session.connId);
    if (!c || !cert) { setCert(null); return; }
    await api.rdc.save({ ...c, web: { ...c.web, pin: cert } });
    toast('Trusted this certificate for this console only');
    setCert(null);
    void api.rdc.webAction(sid, 'reload');
  };
  return (
    <div className="rdc-viewer" data-testid="rdc-web">
      <div className="rdc-viewer-bar">
        <button className="btn sm ghost icon" title="Back" aria-label="Back" onClick={() => void api.rdc.webAction(sid, 'back')}><Icon name="chevronLeft" size={14} /></button>
        <button className="btn sm ghost icon" title="Forward" aria-label="Forward" onClick={() => void api.rdc.webAction(sid, 'forward')}><Icon name="chevronRight" size={14} /></button>
        <button className="btn sm ghost icon" title="Reload" aria-label="Reload" onClick={() => void api.rdc.webAction(sid, 'reload')}><Icon name="refresh" size={14} /></button>
        <b className="ellipsis">{info?.title || session.name}</b>
        <span className="small muted ellipsis mono">{info?.url}</span>
        {info?.cert ? <span className={`badge ${info.cert.trusted ? 'ok' : 'warn'}`} title={info.cert.fingerprint}><Icon name="lock" size={11} /> {info.cert.trusted ? 'Certificate trusted' : 'Not trusted'}</span> : null}
        <div className="grow" />
        <button className="btn sm ghost" onClick={() => void api.rdc.webAction(sid, 'external')}><Icon name="external" size={13} /> Browser</button>
        <button className="btn sm ghost" onClick={() => void api.rdc.disconnect(sid)}>Close</button>
      </div>
      {cert ? (
        <div className="card pad rdc-cert" data-testid="rdc-cert">
          <b>This console’s certificate is not trusted by the system</b>
          <div className="small muted">Many management pages use a certificate they made themselves. If this fingerprint matches the one the device shows, trust it for this console only; any other certificate will be refused.</div>
          <div className="rdc-fp mono">{cert}</div>
          <div className="btn-row"><button className="btn" onClick={() => setCert(null)}>Not Now</button><button className="btn primary" onClick={() => void trust()}>Trust for This Console</button></div>
        </div>
      ) : null}
      <div ref={area} className="rdc-web-area" />
    </div>
  );
}
