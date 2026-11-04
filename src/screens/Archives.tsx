// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Archives: open a zip, 7z, RAR or tar file and walk around inside it without
// unpacking it, Quick Look any file in it, take out what you tick (or all of
// it), and pack files into a ZIP or 7z with a password. What works on this
// computer is one click away under "What works here".

import { useEffect, useMemo, useState } from 'react';
import type { ArchiveEntry } from '../../core/archive';
import { crumbs, folderView, FORMAT_LABEL, type CreateFormat, type OpenedArchive, type SupportRow } from '../../core/archives';
import { formatBytes } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Check, Empty, Modal, PageHead } from '../components/ui';
import { openQuickLook } from '../preview/QuickLook';
import { useStore } from '../state';
import '../styles/archives.css';

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
const pathsFromDrop = (e: React.DragEvent) => [...e.dataTransfer.files].map((f) => api.files.pathOf?.(f) ?? (f as File & { path?: string }).path).filter((p): p is string => !!p);

export function Archives({ initial }: { initial?: string }) {
  const { toast } = useStore();
  const [arc, setArc] = useState<OpenedArchive | null>(null);
  const [dir, setDir] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [password, setPassword] = useState<string | undefined>();
  const [asking, setAsking] = useState<string | null>(null);
  const [making, setMaking] = useState<string[] | null>(null);
  const [support, setSupport] = useState<{ rows: SupportRow[]; sevenZip: boolean; hint: string } | null>(null);
  const [showSupport, setShowSupport] = useState(false);
  const [filter, setFilter] = useState('');

  const openPath = async (p: string, pw?: string) => {
    setBusy('Opening…');
    try {
      const a = await api.archives.open(p, pw);
      if (a.needsPassword && !pw) { setAsking(p); setArc(a); return; }
      setArc(a); setDir(''); setSel(new Set()); setPassword(pw); setAsking(null);
    } catch (e) {
      toast(errText(e));
      if (pw) setAsking(p);
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (!initial) return;
    try {
      const x = JSON.parse(initial) as { make?: string[] };
      if (Array.isArray(x.make)) { setMaking(x.make); return; }
    } catch { /* a plain path */ }
    void openPath(initial);
  }, [initial]);
  useEffect(() => { if (showSupport && !support) void api.archives.support().then(setSupport); }, [showSupport]);

  const view = useMemo(() => (arc ? folderView(arc.entries, dir) : null), [arc, dir]);
  const shown = useMemo(() => {
    if (!view) return null;
    const q = filter.trim().toLowerCase();
    if (!q) return view;
    // A search looks through the whole archive, not only this folder.
    const files = arc!.entries.filter((e) => !e.dir && e.name.toLowerCase().includes(q)).map((e) => ({ ...e, base: e.name }));
    return { ...view, folders: [], files };
  }, [view, filter, arc]);
  const toggle = (name: string) => setSel((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const extract = async (picked: string[] | null) => {
    if (!arc) return;
    if (arc.encrypted && !password) { setAsking(arc.path); return; }
    setBusy(picked ? `Taking out ${picked.length}…` : 'Taking everything out…');
    try {
      const r = await api.archives.extract(arc.path, picked, { password });
      if (r) toast(`${r.files} file${r.files === 1 ? '' : 's'} taken out to ${r.dest.split(/[\\/]/).pop()}${r.skipped.length ? ` · ${r.skipped.length} unsafe name${r.skipped.length === 1 ? '' : 's'} skipped` : ''}`);
      setSel(new Set());
    } catch (e) {
      const m = errText(e);
      toast(m);
      if (/password/i.test(m)) setAsking(arc.path);
    } finally {
      setBusy(null);
    }
  };
  const peek = async (e: ArchiveEntry) => {
    if (!arc) return;
    try {
      const p = await api.archives.peek(arc.path, e.name, password);
      openQuickLook([{ path: p, name: e.name.split('/').pop() ?? e.name }]);
    } catch (err) { toast(errText(err)); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const paths = pathsFromDrop(e);
    if (!paths.length) return;
    if (paths.length === 1 && /\.(zip|zipx|7z|rar|tar|tgz|txz|tzst|tbz2?|gz|xz|zst|bz2|iso|cab|jar)$/i.test(paths[0])) void openPath(paths[0]);
    else setMaking(paths);
  };

  return (
    <div className="page arc-page" data-testid="archives-page" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <PageHead title="Archives" sub="Look inside, take out what you need, or pack files with a password.">
        <button className="btn ghost" data-testid="arc-make" onClick={() => setMaking([])}><Icon name="zip" size={13} /> Make an archive</button>
        <button className="btn" data-testid="arc-open" onClick={() => void api.archives.pick().then((p) => { if (p) void openPath(p); })}><Icon name="folder" size={13} /> Open archive…</button>
      </PageHead>

      {!arc ? (
        <div className="card arc-empty">
          <Empty icon="archive" title="Open an archive" action={<button className="btn primary" onClick={() => void api.archives.pick().then((p) => { if (p) void openPath(p); })}>Open archive…</button>} hint="Or drop a .zip, .7z, .rar or .tar file here · drop other files to pack them">
            See what is inside before you unpack anything.
          </Empty>
        </div>
      ) : (
        <div className="card arc-card">
          <div className="arc-head">
            <div className="arc-title">
              <Icon name="archive" size={18} />
              <div>
                <div className="arc-name" data-user-text data-testid="arc-name">{arc.name}</div>
                <div className="muted small">{FORMAT_LABEL[arc.format]} · {formatBytes(arc.size)}{arc.entries.length ? ` · ${arc.entries.filter((e) => !e.dir).length} files` : ''}{arc.encrypted ? ' · protected with a password' : ''}</div>
              </div>
            </div>
            <input className="input arc-filter" placeholder="Find in archive" aria-label="Find in archive" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {arc.note && !arc.entries.length ? (
            <Empty icon="warning" compact title="Can’t look inside here" action={<button className="btn" onClick={() => setShowSupport(true)}>What works here</button>}>{arc.note}</Empty>
          ) : arc.needsPassword && !arc.entries.length ? (
            <Empty icon="lock" compact title="Protected with a password" action={<button className="btn primary" onClick={() => setAsking(arc.path)}>Enter password</button>}>Even the names inside are hidden until you enter it.</Empty>
          ) : shown ? (
            <>
              <nav className="arc-crumbs" aria-label="Folder in the archive">
                <button className={dir ? '' : 'on'} onClick={() => setDir('')}>{arc.name}</button>
                {crumbs(dir).map((c) => <span key={c.path}><Icon name="chevronRight" size={11} /><button className={c.path === dir ? 'on' : ''} onClick={() => setDir(c.path)} data-user-text>{c.name}</button></span>)}
              </nav>
              <div className="arc-list" role="list" data-testid="arc-list">
                {shown.folders.map((f) => (
                  <div className={`arc-row${sel.has(f.path) ? ' on' : ''}`} role="listitem" key={f.path} onDoubleClick={() => setDir(f.path)}>
                    <Check on={sel.has(f.path)} onChange={() => toggle(f.path)} label={`Choose ${f.name}`} />
                    <button className="arc-open-row" onClick={() => setDir(f.path)}><Icon name="folder" size={15} /><span data-user-text>{f.name}</span></button>
                    <span className="muted small num">{f.files} file{f.files === 1 ? '' : 's'}</span>
                    <span className="muted small num">{formatBytes(f.size)}</span>
                  </div>
                ))}
                {shown.files.map((f) => (
                  <div className={`arc-row${sel.has(f.name) ? ' on' : ''}`} role="listitem" key={f.name} onDoubleClick={() => void peek(f)}>
                    <Check on={sel.has(f.name)} onChange={() => toggle(f.name)} label={`Choose ${f.base}`} />
                    <button className="arc-open-row" onClick={() => void peek(f)} title="Quick Look"><Icon name={f.encrypted ? 'lock' : 'document'} size={15} /><span data-user-text>{f.base}</span></button>
                    <span className="muted small num">{f.mtime ? new Date(f.mtime).toLocaleDateString() : ''}</span>
                    <span className="muted small num">{formatBytes(f.size)}</span>
                  </div>
                ))}
                {!shown.folders.length && !shown.files.length ? <div className="muted arc-none">{filter ? 'Nothing matches.' : 'This folder is empty.'}</div> : null}
              </div>
            </>
          ) : null}
        </div>
      )}

      {arc && arc.entries.length ? (
        <div className="arc-bar" role="toolbar" aria-label="Take files out">
          <span className="muted small">{busy ?? (sel.size ? `${sel.size} chosen` : 'Nothing is unpacked until you choose · On this computer')}</span>
          {sel.size ? <button className="btn ghost sm" onClick={() => setSel(new Set())}>Clear</button> : null}
          {sel.size ? <button className="btn sm" data-testid="arc-extract-some" disabled={!!busy} onClick={() => void extract([...sel])}>Take out {sel.size}</button> : null}
          <button className="btn primary sm" data-testid="arc-extract-all" disabled={!!busy} onClick={() => void extract(null)}>{busy && busy.startsWith('Taking') ? <span className="spinner" aria-hidden /> : null}Take everything out</button>
        </div>
      ) : busy ? <div className="arc-bar"><span className="spinner" aria-hidden /><span className="muted small">{busy}</span></div> : null}

      <button className="btn ghost sm arc-support-toggle" aria-expanded={showSupport} data-testid="arc-support-toggle" onClick={() => setShowSupport(!showSupport)}><Icon name={showSupport ? 'chevronDown' : 'chevronRight'} size={12} /> What works here</button>
      {showSupport ? (
        <div className="card arc-support" data-testid="arc-support">
          {support ? (
            <>
              <table>
                <thead><tr><th>Kind</th><th>Open and take out</th><th>Make</th></tr></thead>
                <tbody>{support.rows.map((r) => <tr key={r.format}><td><b>{r.format}</b></td><td className={r.ok ? '' : 'warn'}>{r.open}</td><td className="muted">{r.create}</td></tr>)}</tbody>
              </table>
              {!support.sevenZip ? <div className="muted small arc-hint"><Icon name="info" size={12} /> {support.hint}</div> : null}
            </>
          ) : <div className="muted">Looking…</div>}
        </div>
      ) : null}

      {asking ? <PasswordSheet name={asking.split(/[\\/]/).pop() ?? ''} onCancel={() => setAsking(null)} onOk={(pw) => { setAsking(null); void openPath(asking, pw); }} /> : null}
      {making ? <MakeSheet initial={making} onClose={() => setMaking(null)} onMade={(p) => { setMaking(null); toast(`Made ${p.split(/[\\/]/).pop()}`); void openPath(p); }} /> : null}
    </div>
  );
}

function PasswordSheet({ name, onOk, onCancel }: { name: string; onOk(pw: string): void; onCancel(): void }) {
  const [pw, setPw] = useState('');
  return (
    <Modal title="Enter the password" onClose={onCancel} width={420} testId="arc-password">
      <form className="arc-form" onSubmit={(e) => { e.preventDefault(); if (pw) onOk(pw); }}>
        <div className="muted small" data-user-text>{name}</div>
        <input className="input" type="password" autoFocus aria-label="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <div className="btn-row"><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button><button className="btn primary" type="submit" disabled={!pw}>Open</button></div>
      </form>
    </Modal>
  );
}

/** Pack files and folders into a ZIP or 7z, with an optional AES-256 password. */
function MakeSheet({ initial, onClose, onMade }: { initial: string[]; onClose(): void; onMade(p: string): void }) {
  const { toast } = useStore();
  const [items, setItems] = useState<string[]>(initial);
  const [format, setFormat] = useState<CreateFormat>('zip');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [usePw, setUsePw] = useState(false);
  const [busy, setBusy] = useState(false);
  const mismatch = usePw && pw2.length > 0 && pw !== pw2;
  const ready = items.length > 0 && (!usePw || (pw.length >= 4 && pw === pw2));
  const make = async () => {
    setBusy(true);
    try { onMade(await api.archives.create(items, { format, password: usePw ? pw : undefined })); } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Make an archive" onClose={onClose} width={520} testId="arc-make-sheet">
      <div className="arc-form" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const p = pathsFromDrop(e); if (p.length) setItems((x) => [...new Set([...x, ...p])]); }}>
        <div className="arc-items" data-testid="arc-items">
          {items.length ? items.map((p) => (
            <div key={p} className="arc-item"><Icon name="document" size={13} /><span data-user-text title={p}>{p.split(/[\\/]/).pop()}</span><button className="btn ghost sm" aria-label={`Leave out ${p.split(/[\\/]/).pop()}`} onClick={() => setItems(items.filter((x) => x !== p))}><Icon name="close" size={11} /></button></div>
          )) : <div className="muted small">Drop files and folders here, or choose them.</div>}
          <button className="btn sm" onClick={() => void api.archives.pickItems().then((p) => p.length && setItems((x) => [...new Set([...x, ...p])]))}><Icon name="plus" size={12} /> Choose files…</button>
        </div>
        <div className="arc-field">
          <span className="kicker">Kind</span>
          <div className="seg" role="radiogroup" aria-label="Kind of archive">
            {(['zip', '7z'] as const).map((f) => <button key={f} role="radio" aria-checked={format === f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)}>{f === 'zip' ? 'ZIP · opens everywhere' : '7z · smaller'}</button>)}
          </div>
        </div>
        <label className="arc-check"><Check on={usePw} onChange={setUsePw} label="Protect with a password" /> Protect with a password</label>
        {usePw ? (
          <div className="arc-field">
            <input className="input" type="password" aria-label="Password" placeholder="Password (4 or more letters)" value={pw} onChange={(e) => setPw(e.target.value)} />
            <input className="input" type="password" aria-label="Password again" placeholder="Password again" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            <div className={`small ${mismatch ? 'warn-text' : 'muted'}`}>{mismatch ? 'The two passwords differ.' : format === 'zip' ? 'AES-256. Opens in Keeper and most archive apps, not in the system’s own zip opener.' : 'AES-256, names hidden too.'} Keeper doesn’t keep it.</div>
          </div>
        ) : null}
        <div className="btn-row arc-actions">
          <span className="muted small">Saved next to the first item · Originals stay</span>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" data-testid="arc-make-go" disabled={!ready || busy} onClick={() => void make()}>{busy ? 'Packing…' : 'Make archive'}</button>
        </div>
      </div>
    </Modal>
  );
}
