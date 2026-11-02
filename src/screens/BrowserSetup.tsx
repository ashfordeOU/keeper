// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The one-screen setup for Keeper's browser extension: the browsers on this
// computer, a big "Add to …" for each, and the few steps the browser keeps
// for the person, with pictures. Keeper has already registered itself with
// each browser; this screen asks only while it is open and moves on to the
// tabs by itself once the extension connects.

import { useCallback, useEffect, useRef, useState } from 'react';
import { setupDef, unpackedSteps, type DetectedBrowser, type SetupBrowserId } from '../../core/browser-setup';
import type { AddExtensionResult, BrowserSetupStatus } from '../../core/api-settingsplus';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty } from '../components/ui';
import { useStore } from '../state';

const POLL_MS = 2000;

/** What a browser's card says about it. */
export function browserLine(b: DetectedBrowser): string {
  if (!b.supported) return 'Safari support is coming';
  if (b.connected) return 'Connected';
  if (b.linked) return 'Ready: add Keeper’s extension';
  return 'Getting ready…';
}

export function BrowserSetup({ onConnected, onClose }: { onConnected: () => void; onClose?: () => void }) {
  const { toast } = useStore();
  const [st, setSt] = useState<BrowserSetupStatus | null>(null);
  const [guide, setGuide] = useState<{ id: SetupBrowserId; r: AddExtensionResult } | null>(null);
  const [busy, setBusy] = useState<SetupBrowserId | null>(null);
  const was = useRef<{ ids: Set<string>; any: boolean } | null>(null);
  const cb = useRef({ onConnected, adding: !onClose });
  cb.current = { onConnected, adding: !onClose };

  const check = useCallback(() => void api.browserTabs.setup().then((s) => {
    setSt(s);
    const now = new Set(s.browsers.filter((b) => b.connected).map((b) => b.id));
    // A browser that connected while this screen was open: on to its tabs.
    const prev = was.current;
    if (prev ? [...now].some((id) => !prev.ids.has(id)) || (s.connected && !prev.any) : s.connected && cb.current.adding) cb.current.onConnected();
    was.current = { ids: now, any: s.connected };
  }).catch(() => undefined), []);

  // Asks only while the setup is on screen.
  useEffect(() => {
    check();
    const t = setInterval(check, POLL_MS);
    const off = api.on('browsers-changed', check);
    return () => { clearInterval(t); off(); };
  }, [check]);

  const add = async (b: DetectedBrowser) => {
    setBusy(b.id);
    try {
      const r = await api.browserTabs.addExtension(b.id);
      setGuide({ id: b.id, r });
      if (r.mode === 'unsupported') toast(r.message ?? 'Not available for this browser yet');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!st) return <div className="card pad muted small">Looking for browsers…</div>;
  const list = st.browsers;
  const supported = list.filter((b) => b.supported);

  return (
    <div className="bs-setup" data-testid="browser-setup">
      <div className="card pad bs-intro">
        <div className="row">
          <div className="grow">
            <h3>Connect your browsers</h3>
            <div className="muted small">
              {supported.length
                ? 'Keeper has already set itself up with the browsers below. Browsers let only you add an extension, so the last click is yours.'
                : 'Keeper works with Chrome, Edge, Brave, Vivaldi, Opera, Arc and Firefox. None of them is on this computer yet.'}
            </div>
          </div>
          {onClose ? <button className="btn sm ghost" onClick={onClose}>Back to tabs</button> : null}
        </div>
      </div>

      {!list.length ? <Empty icon="globe" title="No supported browser found">Install Chrome, Edge, Brave, Vivaldi, Opera, Arc or Firefox; Keeper notices it by itself.</Empty> : null}

      <div className="bs-grid">
        {list.map((b) => (
          <div key={b.id} className={`card pad bs-browser ${b.connected ? 'ok' : ''} ${guide?.id === b.id ? 'sel' : ''}`} data-browser={b.id}>
            <div className="bs-name"><Icon name="globe" size={18} />{b.name}</div>
            <div className={`small ${b.connected ? 'bs-ok' : 'muted'}`}>{b.connected ? <Icon name="check" size={12} /> : null}{browserLine(b)}</div>
            {b.supported && !b.connected ? (
              <button className="btn primary bs-add" disabled={busy === b.id} onClick={() => void add(b)} data-testid={`add-${b.id}`}>
                {busy === b.id ? 'Opening…' : `Add to ${b.name}`}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {guide && guide.r.mode !== 'unsupported' ? <Guide id={guide.id} r={guide.r} /> : null}
    </div>
  );
}

function Guide({ id, r }: { id: SetupBrowserId; r: AddExtensionResult }) {
  const { toast } = useStore();
  const def = setupDef(id)!;
  const again = () => void api.browserTabs.addExtension(id).catch(() => undefined);
  const reveal = () => void api.browserTabs.revealExtension(id).then((x) => toast(x.ok ? 'Folder shown; its path is copied' : 'The extension folder is missing; reinstall Keeper')).catch(() => undefined);
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast('Copied'), () => undefined);

  if (r.mode === 'store') {
    return (
      <div className="card pad bs-guide" data-testid="browser-guide">
        <h3>Click “Add to {def.name}” on the page that opened</h3>
        <div className="muted small">Then confirm in {def.name}. This screen moves on to your tabs by itself.</div>
        <div className="row" style={{ marginTop: 10 }}><button className="btn sm" onClick={again}>Open the page again</button></div>
        <Waiting name={def.name} />
      </div>
    );
  }

  const steps = unpackedSteps(id);
  const firefox = def.engine === 'firefox';
  return (
    <div className="card pad bs-guide" data-testid="browser-guide">
      <h3>Three steps in {def.name}</h3>
      {!r.opened ? <div className="tk-warn small">Keeper could not open {def.name}. Open it, then type <code>{r.page}</code> in the address bar.</div> : null}
      <ol className="bs-steps">
        {steps.map((s, i) => (
          <li key={i}>
            <div className="bs-step-pic" aria-hidden="true">
              {i === 0 ? <div className="bs-pic-bar"><span className="bs-dot" /><span className="bs-dot" /><span className="bs-dot" /><span className="bs-url">{firefox ? 'about:debugging' : def.page}</span></div> : null}
              {i === 1 && !firefox ? <div className="bs-pic-top"><span className="muted">Extensions</span><span className="bs-pic-dev">Developer mode <span className="bs-switch on" /></span></div> : null}
              {i === 1 && firefox ? <div className="bs-pic-top"><span className="muted">Temporary Extensions</span><span className="bs-pic-btn hl">Load Temporary Add-on…</span></div> : null}
              {i === 2 && !firefox ? <div className="bs-pic-top"><span className="bs-pic-btn hl">Load unpacked</span><span className="bs-pic-btn">Pack extension</span><span className="bs-pic-btn">Update</span></div> : null}
              {i === 2 && firefox ? <div className="bs-pic-top"><Icon name="document" size={14} /><span>manifest.json</span></div> : null}
            </div>
            <div>
              <div className="bs-step-t"><span className="bs-num">{i + 1}</span>{s.title}</div>
              <div className="muted small">{s.detail}</div>
              {i === 0 ? <button className="btn sm ghost" onClick={again}>Open it again</button> : null}
              {i === 2 && r.folder ? (
                <div className="bs-folder">
                  <code>{r.folder}</code>
                  <button className="btn sm ghost" onClick={() => copy(r.folder!)}><Icon name="copy" size={12} /> Copy</button>
                  <button className="btn sm ghost" onClick={reveal}><Icon name="reveal" size={12} /> Show</button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <Waiting name={def.name} />
    </div>
  );
}

function Waiting({ name }: { name: string }) {
  return <div className="bs-wait small muted" role="status"><span className="bs-spin" aria-hidden="true" />Waiting for {name}… your tabs appear here as soon as the extension connects.</div>;
}
