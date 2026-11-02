// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The small "Software Update" window: checking, up to date, a new version with
// its notes (Install and Relaunch / Later / Skip this version), the download,
// Relaunch Now, or what went wrong. It follows the updater's status as the main
// process pushes it (no polling); core/update-window.ts decides what each state says.

import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../core/api-x';
import { UPDATE_KEYCHAIN_NOTE } from '../../core/keychain';
import { noteBlocks, updateWindowView, type NoteInline, type UpdateWindowAction } from '../../core/update-window';
import { wantsBeta } from '../../core/updates';
import { api } from '../api';
import { OwlMark } from '../components/OwlMark';
import { useStore } from '../state';
import '../styles/update-window.css';

function Inline({ c }: { c: NoteInline[] }) {
  return (
    <>
      {c.map((n, i) =>
        n.t === 'strong' ? <strong key={i}>{n.s}</strong>
        : n.t === 'em' ? <em key={i}>{n.s}</em>
        : n.t === 'code' ? <code key={i}>{n.s}</code>
        : n.t === 'link' ? <a key={i} href={n.href} title={n.href} onClick={(e) => { e.preventDefault(); void api.system.openExternal(n.href); }}>{n.s}</a>
        : <span key={i}>{n.s}</span>,
      )}
    </>
  );
}

/** Release notes as plain formatted text: built from Markdown into elements, never inserted as HTML. */
export function ReleaseNotes({ md }: { md: string }) {
  const blocks = noteBlocks(md);
  if (!blocks.length) return <p className="muted">No notes for this version.</p>;
  return (
    <>
      {blocks.map((b, i) =>
        b.t === 'h' ? <div key={i} className={`upw-h upw-h${Math.min(b.level, 3)}`}><Inline c={b.c} /></div>
        : b.t === 'p' ? <p key={i}><Inline c={b.c} /></p>
        : b.t === 'pre' ? <pre key={i}>{b.s}</pre>
        : b.t === 'ol' ? <ol key={i}>{b.items.map((it, j) => <li key={j}><Inline c={it} /></li>)}</ol>
        : <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline c={it} /></li>)}</ul>,
      )}
    </>
  );
}

export function UpdateWindow() {
  const { settings, updateSettings, info } = useStore();
  const [s, setS] = useState<UpdateStatus | null>(null);
  const [last, setLast] = useState<'check' | 'install'>('check');
  const [copied, setCopied] = useState(false);
  const [keychainAsks, setKeychainAsks] = useState(false);
  useEffect(() => { void api.keychain?.status().then((k) => setKeychainAsks(!!k.updateAsks)).catch(() => undefined); }, []);
  useEffect(() => {
    document.title = 'Software Update';
    let alive = true;
    void api.appInfo.updateStatus().then((x) => alive && setS((cur) => cur ?? x)).catch(() => undefined);
    const off = api.on('update-status' as 'navigate', ((x: unknown) => alive && setS(x as UpdateStatus)) as never);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') window.close(); };
    window.addEventListener('keydown', esc);
    return () => { alive = false; off(); window.removeEventListener('keydown', esc); };
  }, []);

  const current = (info?.appVersion ?? s?.current ?? '').replace(/\s.*$/, '');
  const beta = wantsBeta(current, settings?.updateBeta, settings?.updateBetaChosen);
  const v = updateWindowView(s, { current, beta, last });
  const auto = (settings?.updateMode ?? 'auto') === 'auto';

  const act = (id: UpdateWindowAction) => {
    // Long calls (a download) report through the pushed status, so their results are not waited for here.
    const quietly = (p: Promise<unknown>) => void p.catch(() => undefined);
    if (id === 'install' || id === 'relaunch') {
      setLast('install');
      quietly(api.appInfo.installAndRelaunch());
    } else if (id === 'download') quietly(api.appInfo.downloadUpdate());
    else if (id === 'copy' && s?.manager?.command) quietly(navigator.clipboard.writeText(s.manager.command).then(() => setCopied(true)));
    else if (id === 'retry') {
      setLast('check');
      quietly(api.appInfo.checkForUpdates());
    } else window.close();
  };

  const showNotes = (v.kind === 'available' || v.kind === 'downloading' || v.kind === 'ready') && v.notes !== undefined;
  return (
    <div className={`upw upw-${v.kind}`} data-testid="update-window" data-state={v.kind}>
      <div className="upw-top">
        <OwlMark tile size={48} title="Keeper" />
        <div className="upw-head">
          <div className="upw-title" role="status" aria-live="polite">{v.title}</div>
          {v.detail && v.kind !== 'downloading' ? <div className="upw-detail">{v.detail}</div> : null}
          {v.kind === 'downloading' ? (
            <div className="upw-progress">
              <div className="progress"><i style={{ width: `${v.percent ?? 0}%` }} /></div>
              <span className="tabular">{v.percent ?? 0}%</span>
            </div>
          ) : null}
          {v.note ? <div className="upw-note">{v.note}</div> : null}
          {/* Before restarting into the new version: the macOS keychain question that follows is expected. */}
          {keychainAsks && (v.kind === 'available' || v.kind === 'downloading' || v.kind === 'ready') ? <div className="upw-note" data-testid="update-keychain-note">{UPDATE_KEYCHAIN_NOTE}</div> : null}
        </div>
      </div>

      {showNotes ? <div className="upw-notes" data-testid="update-notes" tabIndex={0}><ReleaseNotes md={v.notes ?? ''} /></div> : <div className="upw-fill">{v.kind === 'checking' || v.kind === 'installing' ? <div className="spinner upw-spinner" role="progressbar" aria-label={v.title} /> : null}</div>}

      <div className="upw-links">
        <label className="upw-auto" title="Settings → Updates has more choices">
          <input type="checkbox" checked={auto} disabled={!settings} onChange={(e) => void updateSettings({ updateMode: e.target.checked ? 'auto' : 'ask' })} />
          Install updates automatically
        </label>
        <span className="grow" />
        <button className="link-like" onClick={() => void api.appInfo.openUpdateSettings()}>Settings…</button>
      </div>
      <div className="upw-foot">
        {v.skip && s?.version ? <button className="link-like" onClick={() => void api.appInfo.skipVersion(s.version!)}>Skip this version</button> : null}
        {v.releases ? <button className="link-like" onClick={() => void api.appInfo.releasesPage()}>Open the releases page</button> : null}
        <span className="grow" />
        {[...v.actions].reverse().map((a) => (
          <button key={a.id} className={`btn ${a.primary ? 'primary' : ''}`} autoFocus={a.primary} onClick={() => act(a.id)}>
            {a.id === 'copy' && copied ? 'Copied' : a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
