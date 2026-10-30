// SPDX-License-Identifier: AGPL-3.0-or-later
// App updates in the interface: the Settings panel (how updates happen, check
// now, release notes), a banner when a new version is out, and "What's new"
// once after Keeper has been updated.

import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'react';
import type { UpdateStatus } from '../../core/api-x';
import { formatBytes, relativeTime } from '../../core/format';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Modal, Toggle } from './ui';
import '../styles/updates.css';

/** Live update status, pushed by the main process and polled as a fallback. */
export function useUpdateStatus(): [UpdateStatus | null, (s: UpdateStatus) => void] {
  const [s, setS] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void api.appInfo.updateStatus().then((x) => alive && setS(x));
    load();
    const off = api.on('update-status' as 'navigate', ((x: unknown) => alive && setS(x as UpdateStatus)) as never);
    const h = setInterval(load, 15_000);
    return () => { alive = false; off(); clearInterval(h); };
  }, []);
  return [s, setS];
}

/** Release notes are written in Markdown; links open in the browser and nothing remote loads. */
function Notes({ md }: { md: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(md || 'No notes for this version.', { async: false, gfm: true }) as string;
    // Strip anything active; images would load from the network, so they become their alt text.
    return raw
      .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
      .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '$1')
      .replace(/<img[^>]*>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '');
  }, [md]);
  return (
    <div
      className="release-notes"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (a?.href) {
          e.preventDefault();
          void api.system.openExternal(a.href);
        }
      }}
    />
  );
}

function actionLabel(s: UpdateStatus): string {
  if (s.state === 'ready') return s.method === 'package' ? 'Install now' : 'Restart and update';
  if (!s.canInstall) return 'Download';
  return 'Download and install';
}

function Primary({ s, onChange }: { s: UpdateStatus; onChange: (s: UpdateStatus) => void }) {
  if (s.state === 'ready') return <button className="btn primary" onClick={() => void api.appInfo.installUpdate()}><Icon name="refresh" size={14} /> {actionLabel(s)}</button>;
  if (s.state === 'available') {
    return (
      <button className="btn primary" onClick={async () => onChange(await api.appInfo.downloadUpdate())}>
        <Icon name="down" size={14} /> {actionLabel(s)}{s.size ? ` (${formatBytes(s.size)})` : ''}
      </button>
    );
  }
  return null;
}

/** Settings → Updates. */
export function UpdatesPanel() {
  const { settings, updateSettings, info } = useStore();
  const [s, setS] = useUpdateStatus();
  const [notesOpen, setNotesOpen] = useState(false);
  if (!settings) return null;
  const mode = settings.updateMode ?? 'auto';
  const busy = s?.state === 'checking' || s?.state === 'downloading' || s?.state === 'installing';
  const headline =
    !s ? 'Updates' :
    s.state === 'available' ? `Keeper ${s.version} is available` :
    s.state === 'downloading' ? `Downloading Keeper ${s.version}…` :
    s.state === 'ready' ? `Keeper ${s.version} is ready` :
    s.state === 'installing' ? 'Installing…' :
    s.state === 'checking' ? 'Checking for updates…' :
    s.state === 'none' ? 'Keeper is up to date' :
    s.state === 'error' ? 'Could not check for updates' : 'Updates';

  return (
    <div className="updates">
      <div className={`update-card ${s?.state ?? ''}`}>
        <div className="update-icon"><Icon name={s?.state === 'available' || s?.state === 'ready' ? 'sparkle' : s?.state === 'error' ? 'warning' : 'check'} size={20} /></div>
        <div className="grow">
          <div className="update-title">{headline}</div>
          <div className="small muted">
            You have {info?.appVersion ?? s?.current ?? ''}
            {s?.publishedAt && s.version ? ` · ${s.version} released ${relativeTime(Date.parse(s.publishedAt))}` : ''}
            {s?.checkedAt ? ` · checked ${relativeTime(s.checkedAt)}` : ''}
          </div>
          {s?.message ? <div className="small" style={{ marginTop: 4 }}>{s.message}</div> : null}
          {s?.state === 'downloading' ? <div className="progress" style={{ marginTop: 8 }}><i style={{ width: `${s.percent ?? 0}%` }} /></div> : null}
        </div>
        <div className="btn-row">
          {s ? <Primary s={s} onChange={setS} /> : null}
          <button className="btn" disabled={busy} onClick={async () => setS(await api.appInfo.checkForUpdates())}>
            {s?.state === 'checking' ? <div className="spinner" /> : <Icon name="refresh" size={14} />} Check now
          </button>
        </div>
      </div>

      {s?.notes && (s.state === 'available' || s.state === 'ready' || s.state === 'downloading') ? (
        <div className="card" style={{ marginTop: 10 }}>
          <button className="notes-toggle" onClick={() => setNotesOpen(!notesOpen)}>
            <Icon name={notesOpen ? 'chevronDown' : 'chevronRight'} size={13} /> What’s new in {s.version}
          </button>
          {notesOpen ? <Notes md={s.notes} /> : null}
        </div>
      ) : null}

      <div className="update-modes">
        {([
          ['auto', 'Install updates automatically', 'New versions download in the background and install the next time Keeper quits. You can always restart sooner.'],
          ['ask', 'Ask before installing', 'Keeper tells you when a new version is out and shows what changed; you decide when to download and install it.'],
          ['off', 'Only when I check', 'Keeper never looks on its own. Press “Check now” whenever you like.'],
        ] as const).map(([value, title, desc]) => (
          <label key={value} className={`update-mode ${mode === value ? 'on' : ''}`}>
            <input type="radio" name="updateMode" checked={mode === value} onChange={() => void updateSettings({ updateMode: value })} />
            <div>
              <div className="update-mode-title">{title}</div>
              <div className="small muted">{desc}</div>
            </div>
          </label>
        ))}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>Include beta versions</div>
          <div className="small muted">Try new features early. Betas may have rough edges.</div>
        </div>
        <Toggle on={!!settings.updateBeta} onChange={(v) => void updateSettings({ updateBeta: v })} />
      </div>
      <div className="small muted" style={{ marginTop: 12 }}>
        {s?.method === 'package'
          ? 'Installed with your system’s package manager: Keeper downloads the new package and asks for your password to install it.'
          : s?.method === 'manual'
            ? 'This copy cannot replace itself (portable or unpacked). Keeper tells you about new versions and opens the download for you.'
            : 'Updates come from Keeper’s releases on GitHub. Only the version list and the installer are downloaded; nothing about you is sent.'}{' '}
        <button className="link-like" onClick={() => void api.appInfo.releasesPage()}>All releases</button>
      </div>
    </div>
  );
}

/** A slim banner at the top of the window when a new version is out or ready. */
export function UpdateBanner() {
  const { go, settings } = useStore();
  const [s, setS] = useUpdateStatus();
  const [hidden, setHidden] = useState<string | null>(() => {
    try {
      return localStorage.getItem('update.dismissed');
    } catch {
      return null;
    }
  });
  if (!s || !s.version || (s.state !== 'available' && s.state !== 'ready' && s.state !== 'downloading')) return null;
  // In automatic mode the download is quiet; only "ready" is worth a banner.
  if (settings?.updateMode === 'auto' && s.state !== 'ready' && s.canInstall) return null;
  const key = `${s.version}:${s.state}`;
  if (hidden === key) return null;
  const dismiss = () => {
    setHidden(key);
    try {
      localStorage.setItem('update.dismissed', key);
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <div className="update-banner" role="status">
      <Icon name="sparkle" size={15} />
      <span className="grow">
        {s.state === 'ready' ? <>Keeper <b>{s.version}</b> is ready. {s.message}</> : s.state === 'downloading' ? <>Downloading Keeper <b>{s.version}</b>… {s.percent ?? 0}%</> : <>Keeper <b>{s.version}</b> is available.</>}
      </span>
      <button className="btn sm ghost" onClick={() => go({ name: 'settings', arg: 'updates' })}>What’s new</button>
      {s.state !== 'downloading' ? <Primary s={s} onChange={setS} /> : null}
      <button className="btn sm ghost icon" title="Later" onClick={dismiss}><Icon name="close" size={13} /></button>
    </div>
  );
}

/** Shown once after Keeper has been updated. */
export function WhatsNew() {
  const [n, setN] = useState<{ version: string; notes: string; url: string } | null>(null);
  useEffect(() => {
    void api.appInfo.whatsNew().then(setN).catch(() => undefined);
  }, []);
  if (!n) return null;
  return (
    <Modal title={<span className="row" style={{ gap: 8 }}><Icon name="sparkle" size={18} /> What’s new in Keeper {n.version}</span>} onClose={() => setN(null)}>
      {n.notes ? <Notes md={n.notes} /> : <p className="muted">Keeper has been updated to {n.version}.</p>}
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" onClick={() => void api.system.openExternal(n.url)}><Icon name="external" size={13} /> Release page</button>
        <button className="btn primary" onClick={() => setN(null)}>Got it</button>
      </div>
    </Modal>
  );
}
