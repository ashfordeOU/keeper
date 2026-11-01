// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Files on another computer, beside the terminal: an SSH host (SFTP) or an FTP
// server. Download, upload (button or drag and drop), new folder, rename, delete.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { formatBytes, relativeTime } from '../../core/format';
import type { RemoteTargetSpec } from '../../core/api-terminal';
import type { RemoteEntry, SshHost } from '../../core/terminal/types';
import { useStore } from '../state';
import { useTT } from './strings';

export function FilesPanel({ hosts, initial }: { hosts: SshHost[]; initial?: string }) {
  const tt = useTT();
  const { toast } = useStore();
  const [protocol, setProtocol] = useState<RemoteTargetSpec['protocol']>('sftp');
  const [target, setTarget] = useState(initial ?? hosts[0]?.alias ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [conn, setConn] = useState<RemoteTargetSpec | null>(null);
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (initial) setTarget(initial);
  }, [initial]);

  const load = async (c: RemoteTargetSpec, d?: string) => {
    setBusy(true);
    try {
      const r = await api.terminal.remoteList(c, d);
      setDir(r.dir);
      setEntries(r.entries);
      setConn(c);
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    if (!target.trim()) return;
    const c: RemoteTargetSpec = { protocol, target: target.trim(), password: password || undefined };
    if (password && remember) await api.terminal.remoteSavePassword({ protocol, target: c.target }, password);
    setPassword('');
    await load(c);
  };

  const up = () => {
    if (!conn || dir === '/') return;
    void load(conn, dir.replace(/\/[^/]+\/?$/, '') || '/');
  };

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    if (!conn) return;
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
      await load(conn, dir);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (!conn) {
    return (
      <div className="tfiles-panel">
        <div className="panel-title">{tt('files')}</div>
        <div className="seg" style={{ marginBottom: 8 }}>
          {(['sftp', 'ftp', 'ftps'] as const).map((p) => <button key={p} className={protocol === p ? 'on' : ''} onClick={() => setProtocol(p)}>{p.toUpperCase()}</button>)}
        </div>
        <input className="input" list="term-hosts" placeholder={protocol === 'sftp' ? 'host alias, user@host or user@host:port' : 'user@ftp.example.com:21'} value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void connect()} />
        <datalist id="term-hosts">{hosts.map((h) => <option key={h.alias} value={h.alias}>{h.host}</option>)}</datalist>
        <input className="input" type="password" placeholder={`${tt('password')} (${protocol === 'sftp' ? 'optional: keys and the SSH agent are tried first' : 'optional'})`} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void connect()} style={{ marginTop: 6 }} />
        <label className="row small muted" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember the password in the system keychain</label>
        <button className="btn primary" style={{ marginTop: 10, width: '100%' }} disabled={busy || !target.trim()} onClick={() => void connect()}>{busy ? <div className="spinner" /> : <Icon name="server" size={13} />} {tt('connect')}</button>
        {hosts.length ? (
          <div style={{ marginTop: 14 }}>
            <div className="small muted" style={{ marginBottom: 4 }}>{tt('sshHosts')}</div>
            {hosts.slice(0, 20).map((h) => (
              <button key={h.alias} className="tremote-row" onClick={() => { setProtocol('sftp'); setTarget(h.alias); void load({ protocol: 'sftp', target: h.alias }); }}>
                <Icon name="server" size={13} /> <span className="grow ellipsis">{h.alias}</span> <span className="small muted ellipsis">{h.user ? `${h.user}@` : ''}{h.host ?? ''}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`tfiles-panel ${over ? 'drop' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files].map((f) => api.files.pathOf?.(f)).filter((x): x is string => !!x);
        if (files.length) void act(() => api.terminal.remoteUpload(conn, files, dir), `Uploaded ${files.length} file${files.length === 1 ? '' : 's'}`);
      }}
    >
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <span className="badge">{conn.protocol.toUpperCase()}</span>
        <span className="ellipsis grow" style={{ fontWeight: 600 }}>{conn.target}</span>
        <button className="btn ghost sm icon" title="Disconnect" aria-label="Disconnect" onClick={() => { void api.terminal.remoteDisconnect(conn); setConn(null); }}><Icon name="eject" size={12} /></button>
      </div>
      <div className="row" style={{ gap: 4, marginBottom: 6 }}>
        <button className="btn ghost sm icon" title={tt('up')} aria-label={tt('up')} onClick={up}><Icon name="arrowUp" size={12} /></button>
        <input className="input sm grow" value={dir} onChange={(e) => setDir(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load(conn, dir)} />
        <button className="btn ghost sm icon" title="Reload" aria-label="Reload" onClick={() => void load(conn, dir)}>{busy ? <div className="spinner" /> : <Icon name="refresh" size={12} />}</button>
      </div>
      <div className="row" style={{ gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => void api.settings.pickFiles({ title: tt('upload') }).then((f) => void (f.length && act(() => api.terminal.remoteUpload(conn, f, dir), `Uploaded ${f.length}`)))}><Icon name="arrowUp" size={12} /> {tt('upload')}</button>
        <button className="btn sm" disabled={!sel} onClick={() => sel && void api.terminal.remoteDownload(conn, [sel]).then((out) => { toast(`Saved to ${out[0]}`); void api.files.reveal(out[0]); }).catch((e) => toast(String(e)))}><Icon name="down" size={12} /> {tt('download')}</button>
        <button className="btn sm" onClick={() => { const n = prompt(tt('newFolder')); if (n) void act(() => api.terminal.remoteMkdir(conn, `${dir.replace(/\/$/, '')}/${n}`)); }}><Icon name="folder" size={12} /> {tt('newFolder')}</button>
      </div>
      <div className="tremote-list">
        {entries.map((e) => (
          <div
            key={e.path}
            className={`tremote-row ${sel === e.path ? 'on' : ''}`}
            onClick={() => setSel(e.path)}
            onDoubleClick={() => (e.isDir ? void load(conn, e.path) : void api.terminal.remoteDownload(conn, [e.path]).then((out) => void api.files.open(out[0])))}
            onContextMenu={(ev) => {
              ev.preventDefault();
              setSel(e.path);
              const action = prompt(`${e.name}\n\nType a new name to rename, or DELETE to delete it.`);
              if (action === 'DELETE') void act(() => api.terminal.remoteRemove(conn, e.path, e.isDir), `Deleted ${e.name}`);
              else if (action && action !== e.name) void act(() => api.terminal.remoteRename(conn, e.path, `${dir.replace(/\/$/, '')}/${action}`));
            }}
          >
            <Icon name={e.isDir ? 'folder' : 'document'} size={13} />
            <span className="grow ellipsis">{e.name}</span>
            <span className="small muted">{e.isDir ? '' : formatBytes(e.size)}</span>
            <span className="small muted" style={{ width: 70, textAlign: 'right' }}>{e.mtime ? relativeTime(e.mtime) : ''}</span>
          </div>
        ))}
        {!entries.length && !busy ? <div className="muted small">This folder is empty.</div> : null}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>Drop files here to upload them into this folder.</div>
    </div>
  );
}
