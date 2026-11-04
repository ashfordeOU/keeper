// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote Desktop (RDP) in a Keeper tab. The engine is IronRDP's WebAssembly
// client, a downloadable component loaded from keeper-engine:// the first time
// a tab needs it. It draws into the canvas here and talks to the computer
// through Keeper's local relay (electron/services/rdc/rdp.ts), which owns the
// network connection and the certificate check. Keys go as scancodes (the
// remote layout decides) or as typed letters; the pointer and wheel, the
// clipboard both ways, resizing with the tab, full screen, special keys and
// Reconnect are here. When the engine cannot load, the same connection opens
// in the outside app instead.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RdpAttach } from '../../core/rdc/api';
import type { RdcSession } from '../../core/rdc/types';
import { comboScancodes, desktopSize, engineMessage, RDP_COMBOS, rdpKey } from '../../core/rdc/rdp-tab';
import { usable } from '../../core/components';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ContextMenu, type MenuItem } from '../components/ui';
import { FirstRun } from '../components/FirstRun';
import { useComponents } from '../components/ComponentsPanel';
import { useStore } from '../state';
import { rdcTabNames } from '../components/TabStrip';
import '../styles/rdc.css';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ---------------------------------------------------------------- the engine (loaded once per window)

/* The engine's own types, as far as this tab uses them. */
interface EngineSession {
  run(): Promise<{ reason(): string }>;
  desktopSize(): { width: number; height: number };
  applyInputs(t: unknown): void;
  releaseAllInputs(): void;
  synchronizeLockKeys(scroll: boolean, num: boolean, caps: boolean, kana: boolean): void;
  shutdown(): void;
  onClipboardPaste(d: unknown): Promise<void>;
  resize(w: number, h: number, scale?: number | null): void;
}
interface EngineModule {
  init(level: string): Promise<void>;
  enableCredssp(on: boolean): unknown;
  displayControl(on: boolean): unknown;
  Backend: {
    SessionBuilder: new () => Record<string, (...a: unknown[]) => unknown> & { connect(): Promise<EngineSession> };
    DesktopSize: new (w: number, h: number) => unknown;
    InputTransaction: new () => { addEvent(e: unknown): void };
    ClipboardData: new () => { addText(mime: string, text: string): void; items(): { mimeType(): string; value(): unknown }[] };
    DeviceEvent: {
      keyPressed(c: number): unknown; keyReleased(c: number): unknown;
      unicodePressed(s: string): unknown; unicodeReleased(s: string): unknown;
      mouseButtonPressed(b: number): unknown; mouseButtonReleased(b: number): unknown;
      mouseMove(x: number, y: number): unknown;
      wheelRotations(vertical: boolean, amount: number, unit: number): unknown;
    };
  };
}

let engine: Promise<EngineModule> | null = null;
function loadEngine(url: string): Promise<EngineModule> {
  engine ??= (import(/* @vite-ignore */ url) as Promise<EngineModule>).then(async (m) => {
    await m.init('WARN');
    return m;
  });
  engine.catch(() => { engine = null; });
  return engine;
}

/** The engine's error, in words; `signIn` when the name or password was refused. */
function engineError(e: unknown): { text: string; signIn: boolean } {
  const x = e as { kind?: () => number; backtrace?: () => string };
  if (typeof x?.kind === 'function') {
    const kind = x.kind();
    if (kind === 1 || kind === 2) return { text: 'The user name or password was not accepted.', signIn: true };
    if (kind === 3) return { text: 'This account may not sign in to this computer by Remote Desktop.', signIn: false };
    if (kind === 6) return { text: 'The computer and Keeper could not agree on how to connect. Try switching Network Level Authentication on or off for this connection.', signIn: false };
    return { text: engineMessage(x.backtrace?.() ?? ''), signIn: false };
  }
  return { text: engineMessage(clean(e)), signIn: false };
}

// ---------------------------------------------------------------- the tab

function useSession(sid: string): RdcSession | null | undefined {
  const [s, setS] = useState<RdcSession | null | undefined>(undefined);
  useEffect(() => {
    const load = () => void api.rdc.state().then((st) => { const x = st.sessions.find((y) => y.id === sid) ?? null; if (x) rdcTabNames.set(sid, x.name); setS(x); }).catch(() => setS(null));
    load();
    return api.on('rdc-changed', load);
  }, [sid]);
  return s;
}

type Phase =
  | { t: 'engine' }
  | { t: 'connecting'; again?: boolean }
  | { t: 'live' }
  | { t: 'ended'; text: string; signIn?: boolean }
  | { t: 'outside'; text: string };

export function RdpView({ sid }: { sid: string }) {
  const { toast, tabs } = useStore();
  const session = useSession(sid);
  const { list } = useComponents();
  const comp = list?.find((c) => c.id === 'ironrdp');
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<{ s: EngineSession; m: EngineModule; follow: boolean; userEnded: boolean; started: number } | null>(null);
  const attach = useRef<RdpAttach | null>(null);
  const lastClip = useRef('');
  const [phase, setPhase] = useState<Phase>({ t: 'connecting' });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState(true);
  const [cursor, setCursor] = useState('default');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [letters, setLetters] = useState(false);
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(false);
  const [full, setFull] = useState(false);
  const retried = useRef(false);

  const inputs = useCallback((events: unknown[]) => {
    const l = live.current;
    if (!l || !events.length) return;
    const t = new l.m.Backend.InputTransaction();
    for (const e of events) t.addEvent(e);
    try { l.s.applyInputs(t); } catch { /* the session is closing */ }
  }, []);

  /** Sends this computer's clipboard text to the remote one (when it changed). */
  const pushClipboard = useCallback(async (force = false) => {
    const l = live.current;
    if (!l || !attach.current?.options.clipboard) return;
    const text = await navigator.clipboard.readText().catch(() => '');
    if (!text || (!force && text === lastClip.current)) return;
    lastClip.current = text;
    const d = new l.m.Backend.ClipboardData();
    d.addText('text/plain', text);
    await l.s.onClipboardPaste(d).catch(() => undefined);
  }, []);

  const fallback = useCallback(async (why: string) => {
    setPhase({ t: 'outside', text: why });
    try {
      const r = await api.rdc.rdpFallback(sid, why);
      // The tab already says why; only a problem in the outside app itself is added.
      if (r.session?.state === 'error') {
        // Outside apps write log lines ("[time] [ERROR][module] - [function]: message"): the last message says it.
        const raw = r.session.error ?? '';
        const last = [...raw.matchAll(/\]:\s*([^[]+)/g)].map((x) => x[1].trim()).filter(Boolean).pop() ?? raw;
        setPhase({ t: 'outside', text: `${why} It did not connect there either (${last.replace(/[.\s]+$/, '').slice(0, 160) || 'no reason given'}).` });
      }
    } catch (e) {
      setPhase({ t: 'ended', text: `${why} The outside app did not open either: ${clean(e)}` });
    }
  }, [sid, toast]);

  const start = useCallback(async (again = false) => {
    const a = await api.rdc.rdpAttach(sid).catch(() => null);
    if (!a) { setPhase({ t: 'ended', text: 'This connection has ended.' }); return; }
    attach.current = a;
    setLetters(a.options.keyboard === 'letters');
    if (a.engine === 'unavailable') { void fallback('Remote Desktop in a tab is not available on this computer.'); return; }
    if (a.engine === 'missing') { setPhase({ t: 'engine' }); return; }
    setPhase({ t: 'connecting', again });
    let m: EngineModule;
    try {
      m = await loadEngine(a.engineUrl);
    } catch (e) {
      void fallback(`The Remote Desktop engine did not load (${clean(e)}).`);
      return;
    }
    const c = canvas.current;
    const area = stage.current?.getBoundingClientRect();
    if (!c || !area) return;
    const want = desktopSize({ id: '', name: '', protocol: 'rdp', host: '', created: 0, rdp: { width: a.options.width, height: a.options.height, fullscreen: a.options.fullscreen, dynamicResolution: a.options.dynamicResolution } }, { width: area.width, height: area.height }, { width: screen.width, height: screen.height });
    const b = new m.Backend.SessionBuilder();
    b.username(a.user);
    b.password(a.password);
    b.serverDomain(a.domain);
    b.destination(a.destination);
    b.proxyAddress(a.url);
    b.authToken(a.token);
    b.desktopSize(new m.Backend.DesktopSize(want.width, want.height));
    b.renderCanvas(c);
    b.setCursorStyleCallbackContext({});
    b.setCursorStyleCallback((kind: unknown, data: unknown, x: unknown, y: unknown) => {
      if (kind === 'hidden') setCursor('none');
      else if (kind === 'url' && typeof data === 'string') setCursor(`url(${data}) ${Math.round(Number(x) || 0)} ${Math.round(Number(y) || 0)}, default`);
      else setCursor('default');
    });
    b.canvasResizedCallback(() => setSize({ w: c.width, h: c.height }));
    b.extension(m.enableCredssp(a.options.nla));
    b.extension(m.displayControl(true));
    if (a.options.clipboard) {
      b.remoteClipboardChangedCallback((d: unknown) => {
        for (const it of (d as { items(): { mimeType(): string; value(): unknown }[] }).items()) {
          if (it.mimeType() !== 'text/plain' || typeof it.value() !== 'string') continue;
          lastClip.current = it.value() as string;
          void api.files.copyText(lastClip.current).catch(() => undefined);
        }
      });
      b.forceClipboardUpdateCallback(() => void pushClipboard(true));
    }
    let s: EngineSession;
    try {
      s = await b.connect();
    } catch (e) {
      const err = engineError(e);
      // The relay knows best why the network part failed; it is in the session's own error.
      const st = await api.rdc.state().catch(() => null);
      const relayWhy = st?.sessions.find((x) => x.id === sid)?.error;
      const text = !err.signIn && relayWhy ? relayWhy : err.text;
      void api.rdc.rdpEnded(sid, text);
      setPhase({ t: 'ended', text, signIn: err.signIn });
      return;
    }
    live.current = { s, m, follow: want.follow, userEnded: false, started: Date.now() };
    const d = s.desktopSize();
    setSize({ w: d.width, h: d.height });
    setPhase({ t: 'live' });
    c.focus();
    void pushClipboard(true);
    void s.run().then((info) => {
      const l = live.current;
      live.current = null;
      if (!l || l.userEnded) return;
      const why = info.reason();
      // One quiet try again after a drop in a session that was working.
      if (!retried.current && Date.now() - l.started > 10_000 && !/logoff|logged off|disconnected by|user/i.test(why)) {
        retried.current = true;
        void start(true);
        return;
      }
      void api.rdc.rdpEnded(sid, undefined);
      setPhase({ t: 'ended', text: why ? `The session ended: ${engineMessage(why)}` : 'The session ended.' });
    }).catch((e) => {
      live.current = null;
      const err = engineError(e);
      void api.rdc.rdpEnded(sid, err.text);
      setPhase({ t: 'ended', text: err.text, signIn: err.signIn });
    });
  }, [sid, fallback, pushClipboard]);

  // Start once, and stop the engine when the tab goes (the relay waits a while for it to come back).
  useEffect(() => {
    void start();
    return () => {
      const l = live.current;
      live.current = null;
      if (l) { l.userEnded = true; try { l.s.shutdown(); } catch { /* gone */ } }
    };
  }, [start]);

  // The engine arrives: go on. It could not be downloaded: the outside app.
  useEffect(() => {
    if (phase.t !== 'engine' || !comp) return;
    if (usable(comp.state)) void start();
    else if (comp.state === 'error' && !comp.offline) void fallback(`the Remote Desktop engine could not be downloaded (${comp.error ?? 'unknown problem'}).`);
    else if (comp.state === 'error' && comp.offline) void fallback('this computer is offline, so the Remote Desktop engine could not be downloaded yet.');
    else if (comp.state === 'unavailable') void fallback('Remote Desktop in a tab is not available on this computer.');
  }, [phase.t, comp, start, fallback]);

  // Resize the remote desktop with the tab (and full screen), a moment after it settles.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        const l = live.current;
        if (!l?.follow) return;
        const r = el.getBoundingClientRect();
        const w = Math.max(200, Math.round(r.width)) & ~1;
        const h = Math.max(200, Math.round(r.height));
        try { l.s.resize(w, h); } catch { /* not ready */ }
      }, 400);
    });
    ro.observe(el);
    const fs = () => setFull(document.fullscreenElement === el);
    document.addEventListener('fullscreenchange', fs);
    return () => { ro.disconnect(); clearTimeout(t); document.removeEventListener('fullscreenchange', fs); };
  }, []);

  const point = (e: React.MouseEvent) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: Math.max(0, Math.round(((e.clientX - r.left) * c.width) / r.width)), y: Math.max(0, Math.round(((e.clientY - r.top) * c.height) / r.height)) };
  };
  const D = () => live.current?.m.Backend.DeviceEvent;
  const key = (e: React.KeyboardEvent, down: boolean) => {
    const dev = D();
    if (!dev) return;
    const k = rdpKey(e, letters ? 'letters' : 'keys');
    e.preventDefault();
    e.stopPropagation();
    if (!k) return;
    if (k.t === 'unicode') inputs([down ? dev.unicodePressed(k.text) : dev.unicodeReleased(k.text)]);
    else inputs([down ? dev.keyPressed(k.code) : dev.keyReleased(k.code)]);
  };
  const combo = (id: string) => {
    const dev = D();
    if (!dev) return;
    inputs(comboScancodes(RDP_COMBOS[id].keys).map((x) => (x.down ? dev.keyPressed(x.code) : dev.keyReleased(x.code))));
    canvas.current?.focus();
  };
  const disconnect = () => {
    const l = live.current;
    if (l) { l.userEnded = true; try { l.s.shutdown(); } catch { /* gone */ } }
    void api.rdc.disconnect(sid);
    setPhase({ t: 'ended', text: 'You disconnected.' });
  };
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen().catch(() => toast('Full screen is not available here'));
  };

  const name = session?.name ?? attach.current?.name ?? 'Remote Desktop';
  const showCanvas = phase.t === 'live' || phase.t === 'connecting';
  return (
    <div className="rdc-viewer" data-testid="rdc-rdp" data-phase={phase.t}>
      <div className="rdc-viewer-bar capsule" role="toolbar" aria-label={`${name} controls`}>
        <span className={`rdc-dot ${phase.t === 'live' ? 'online' : 'unknown'}`} aria-hidden />
        <b className="ellipsis">{name}</b>
        <span className="small muted ellipsis">{phase.t === 'live' && size ? `${size.w}×${size.h}` : phase.t === 'connecting' ? 'Connecting…' : ''}{session?.via ? ` · ${session.via}` : ''}</span>
        <div className="grow" />
        {phase.t === 'live' ? (
          <>
            <div className="seg" role="group" aria-label="Size">
              <button className={fit ? 'on' : ''} aria-pressed={fit} onClick={() => setFit(true)} title="Fit the picture to the tab">Fit</button>
              <button className={!fit ? 'on' : ''} aria-pressed={!fit} onClick={() => setFit(false)} title="Show the picture at its real size">100%</button>
            </div>
            <button className="btn sm ghost" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, items: [
              ...Object.entries(RDP_COMBOS).map(([id, c]) => ({ label: c.label, run: () => combo(id) })),
              { sep: true, label: '' },
              { label: letters ? 'Send Physical Keys' : 'Type Letters as Here', icon: 'keyboard', run: () => { setLetters(!letters); canvas.current?.focus(); } },
            ] })}>Keys <Icon name="chevronDown" size={12} /></button>
            <button className="btn sm ghost icon" title={full ? 'Leave full screen' : 'Full screen'} aria-label={full ? 'Leave full screen' : 'Full screen'} onClick={toggleFull}><Icon name={full ? 'shrink' : 'expand'} size={14} /></button>
          </>
        ) : null}
        {phase.t !== 'outside' ? <><button className="btn sm ghost icon" title="More" aria-label="More" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, items: [
          ...(phase.t === 'live' && attach.current?.options.clipboard ? [{ label: 'Send Clipboard Now', icon: 'clipboard', run: () => void pushClipboard(true).then(() => toast('Sent. Paste it on the remote computer.')) }] : []),
          { label: 'Reconnect', icon: 'refresh', run: () => { const l = live.current; if (l) { l.userEnded = true; try { l.s.shutdown(); } catch { /* gone */ } } retried.current = false; void start(true); } },
          { label: 'Move to Its Own Window', icon: 'external', run: () => tabs.toWindow(tabs.active) },
          { label: 'Open in the Outside App', icon: 'laptop', run: () => void fallback('you asked for the outside app.') },
        ] })}><Icon name="more" size={14} /></button>
        <button className="btn sm ghost" onClick={disconnect}>Disconnect</button></> : null}
      </div>

      <div ref={stage} className={`rdc-stage ${fit ? 'fit' : ''}`} hidden={!showCanvas}>
        <canvas
          ref={canvas}
          tabIndex={0}
          data-testid="rdc-canvas"
          aria-label={`Screen of ${name}`}
          className="rdc-canvas"
          style={{ cursor }}
          onFocus={() => void pushClipboard()}
          onBlur={() => { try { live.current?.s.releaseAllInputs(); } catch { /* gone */ } }}
          onMouseMove={(e) => { const d = D(); if (d) { const p = point(e); inputs([d.mouseMove(p.x, p.y)]); } }}
          onMouseDown={(e) => {
            e.preventDefault();
            canvas.current?.focus();
            const d = D();
            if (!d) return;
            const p = point(e);
            try { live.current?.s.synchronizeLockKeys(e.getModifierState('ScrollLock'), e.getModifierState('NumLock'), e.getModifierState('CapsLock'), false); } catch { /* fine */ }
            inputs([d.mouseMove(p.x, p.y), d.mouseButtonPressed(e.button)]);
          }}
          onMouseUp={(e) => { const d = D(); if (d) inputs([d.mouseButtonReleased(e.button)]); }}
          onContextMenu={(e) => e.preventDefault()}
          onWheel={(e) => { const d = D(); if (!d) return; const v = e.deltaY !== 0; inputs([d.wheelRotations(v, -(v ? e.deltaY : e.deltaX), e.deltaMode)]); }}
          onKeyDown={(e) => key(e, true)}
          onKeyUp={(e) => key(e, false)}
        />
        {phase.t === 'connecting' ? <div className="rdp-overlay" role="status" aria-live="polite"><div className="spinner" aria-hidden /><span>{phase.again ? 'Connecting again…' : `Connecting to ${name}…`}</span></div> : null}
      </div>

      {phase.t === 'engine' ? (
        <FirstRun testid="rdp-engine" kicker="Remote Desktop" title="Getting it ready" mark="ready" art={<ScreenArt />}
          line="Keeper downloads its Remote Desktop engine once, then connects in this tab."
          action={comp && (comp.state === 'downloading' || comp.state === 'verifying') ? (
            <span className="component-progress" role="progressbar" aria-label="Remote Desktop engine download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((comp.progress ?? 0) * 100)}>
              <span className={`progress ${comp.state === 'verifying' ? 'indeterminate' : ''}`}><i style={{ width: comp.state === 'verifying' ? undefined : `${Math.round((comp.progress ?? 0) * 100)}%` }} /></span>
              <span className="small muted">{comp.state === 'verifying' ? 'Checking…' : `${Math.round((comp.progress ?? 0) * 100)}%`}</span>
            </span>
          ) : <button className="btn primary" onClick={() => void api.components.download('ironrdp').catch((e) => toast(clean(e)))}>Download</button>}
          more={<button className="btn ghost" onClick={() => void fallback('you asked for the outside app.')}>Use the Outside App</button>}
          trust={['One-time download', 'Checked before use', 'Free and open source']} />
      ) : null}

      {phase.t === 'ended' ? (
        <FirstRun testid="rdp-ended" kicker="Remote Desktop" title={phase.signIn ? 'Sign in again' : 'Not connected'} art={<ScreenArt off />}
          line={phase.text}
          action={phase.signIn ? (
            <form className="rdp-signin" onSubmit={(e) => { e.preventDefault(); void api.rdc.rdpSignIn(sid, pw, remember).then(() => { setPw(''); retried.current = false; void start(true); }); }}>
              <input className="input" type="password" autoFocus aria-label="Password" placeholder={`Password${attach.current?.user ? ` for ${attach.current.user}` : ''}`} value={pw} onChange={(e) => setPw(e.target.value)} data-testid="rdp-password" />
              <button className="btn primary" disabled={!pw}>Connect</button>
              <label className="row small"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember in the keychain</label>
            </form>
          ) : <button className="btn primary" data-testid="rdp-reconnect" onClick={() => { retried.current = false; void start(true); }}>Reconnect</button>}
          more={<button className="btn ghost" onClick={() => tabs.open({ name: 'rdc' }, {})}>All Connections</button>} />
      ) : null}

      {phase.t === 'outside' ? (
        <FirstRun testid="rdp-outside" kicker="Remote Desktop" title="Opened outside Keeper" mark="outside" art={<ScreenArt off />}
          line={`This connection opened in the outside app because ${phase.text}`}
          action={<button className="btn primary" onClick={() => tabs.open({ name: 'rdc' }, {})}>All Connections</button>} />
      ) : null}

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

/** A screen with a window on it, in the theme's colours; dimmed when nothing is connected. */
function ScreenArt({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 240 200" className="art">
      <circle cx="120" cy="96" r="86" className="art-halo" />
      <g className="art-shadow">
        <rect x="38" y="40" width="164" height="106" rx="12" className="art-card" />
        <rect x="48" y="50" width="144" height="86" rx="6" className="art-sunk" />
      </g>
      <rect x="108" y="146" width="24" height="16" className="art-line" />
      <rect x="86" y="160" width="68" height="6" rx="3" className="art-line strong" />
      {off ? (
        <rect x="96" y="88" width="48" height="6" rx="3" className="art-line strong" />
      ) : (
        <g className="art-pop">
          <rect x="62" y="62" width="76" height="50" rx="5" className="art-card" />
          <rect x="62" y="62" width="76" height="10" rx="5" className="art-accent" />
          <rect x="70" y="80" width="44" height="5" rx="2.5" className="art-line" />
          <rect x="70" y="91" width="56" height="5" rx="2.5" className="art-line" />
          <rect x="148" y="104" width="34" height="22" rx="4" className="art-card" />
        </g>
      )}
    </svg>
  );
}
