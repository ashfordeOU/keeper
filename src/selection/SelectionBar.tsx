// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The selection bar: a small window beside the pointer for text selected in
// any app. Copy, Search, Translate, Rewrite, Define, Open link; AI results
// show here with Replace (paste over the selection) and Copy. Keys: the
// first letter of an action, Enter for the first one, Esc closes.

import { useEffect, useRef, useState } from 'react';
import { SELECTION_ACTIONS, type SelectionActionId, type SelectionView } from '../../core/selection';
import { api } from '../api';
import { Icon } from '../components/Icon';
import '../styles/launcher.css';

const ICON: Record<SelectionActionId, string> = { copy: 'copy', plain: 'text', search: 'search', translate: 'globe', rewrite: 'sparkle', shorter: 'minus', define: 'note', open: 'external', mail: 'mail' };
const LABEL = Object.fromEntries(SELECTION_ACTIONS.map((a) => [a.id, a.label])) as Record<SelectionActionId, string>;

export function SelectionBar() {
  const [view, setView] = useState<SelectionView | null>(null);
  const [busy, setBusy] = useState<SelectionActionId | null>(null);
  const [result, setResult] = useState<{ action: SelectionActionId; text: string } | null>(null);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => {
      setResult(null);
      setError('');
      setBusy(null);
      void api.selection.current().then((v) => { setView(v); setTimeout(() => (root.current?.querySelector('.sb-actions button') as HTMLButtonElement | null)?.focus(), 30); });
    };
    load();
    const off = api.on('selection-changed' as 'navigate', load as never);
    return () => off();
  }, []);

  // The window fits what it shows.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => void api.selection.resize(Math.ceil(el.getBoundingClientRect().height) + 12);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, result, error, busy]);

  const run = async (a: SelectionActionId) => {
    setError('');
    setBusy(a);
    try {
      const r = await api.selection.run(a);
      if (r.result) setResult({ action: a, text: r.result });
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); if (result) setResult(null); else void api.selection.close(); return; }
    if (!view || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (result && e.key === 'Enter') { e.preventDefault(); void api.selection.replace(result.text); return; }
    const hit = view.actions.find((a) => LABEL[a][0].toLowerCase() === e.key.toLowerCase());
    if (hit) { e.preventDefault(); void run(hit); }
  };

  if (!view) return <div className="selbar" ref={root} />;
  const empty = !view.text.trim();
  const ai = view.ai;
  return (
    <div className="selbar" ref={root} role="dialog" aria-label="Actions for the selected text" onKeyDown={onKey} data-testid="selection-bar">
      <div className="sb-text">
        <Icon name="text" size={12} />
        <span className="grow ellipsis" title={view.text}>{empty ? 'No text is selected. Select some text, then press the shortcut again.' : `“${view.text.replace(/\s+/g, ' ').slice(0, 90)}${view.text.length > 90 ? '…' : ''}”`}</span>
        {view.app ? <span className="small">{view.app}</span> : null}
      </div>
      {!empty ? (
        <div className="sb-actions" role="toolbar" aria-label="Actions">
          {view.actions.map((a) => (
            <button key={a} data-testid={`sel-${a}`} aria-pressed={result?.action === a} disabled={!!busy} onClick={() => void run(a)} title={`${LABEL[a]} (${LABEL[a][0]})`}>
              <Icon name={busy === a ? 'refresh' : ICON[a]} size={14} /> {a === 'translate' ? `Translate to ${view.language}` : LABEL[a]}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <div className="sb-foot sb-error" role="alert">{error}</div> : null}
      {result ? (
        <div className="sb-result" data-testid="sel-result">
          <div className="out" tabIndex={0} aria-label={`${LABEL[result.action]} result`}>{result.text}</div>
          <div className="row">
            <span className="grow small muted">{ai ? `${ai.label}${ai.local ? ', on this computer' : ''}` : ''}</span>
            <button className="btn sm" onClick={() => void api.selection.copy(result.text)}><Icon name="copy" size={12} /> Copy</button>
            {result.action !== 'define' ? <button className="btn sm primary" data-testid="sel-replace" onClick={() => void api.selection.replace(result.text)}>Replace ↩</button> : null}
          </div>
        </div>
      ) : !empty ? (
        <div className="sb-foot">{ai ? `Translate, rewrite and define ask ${ai.label}${ai.local ? ' on this computer' : ' over the internet'} only when you press them.` : 'Set up an AI in Settings → AI to translate, rewrite and define.'}</div>
      ) : null}
    </div>
  );
}
