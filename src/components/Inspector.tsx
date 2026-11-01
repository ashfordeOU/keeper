// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The right-hand panel: a big preview and everything Keeper knows about a file.

import { Fragment, useEffect, useState } from 'react';
import { KIND_SINGULAR } from '../../core/classify';
import { formatBytes, formatDate, formatDuration, relativeTime } from '../../core/format';
import type { FileEntry } from '../../core/types';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import { InspectorAi } from './InspectorAi';
import { FileVersions } from '../screens/Sync';
import '../styles/screens-a.css';
import { FilePreview } from '../preview/Preview';
import { openQuickLook } from '../preview/QuickLook';

function Preview({ file }: { file: FileEntry }) {
  // The universal previewer: images, video, audio, PDFs, documents, code, archives, fonts, 3D and more.
  // Space opens the same viewer full-window.
  return (
    <div className="preview pv-host" onDoubleClick={() => openQuickLook([{ path: file.path, name: file.name }])} title="Double-click or press Space for Quick Look">
      <FilePreview key={file.path} path={file.path} mode="inline" />
    </div>
  );
}

export function Inspector() {
  const { focused, selection, setFocused, trash, toast, refresh, info, play } = useStore();
  const [file, setFile] = useState<FileEntry | null>(focused);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');

  // Follow the selection; fetch fresh details (text, source) for the focused file.
  useEffect(() => {
    const path = focused?.path ?? selection[0];
    if (!path) { setFile(null); return; }
    if (focused && focused.path === path) setFile(focused);
    let alive = true;
    void api.library.inspect(path).then(async (f) => {
      if (!alive || !f) return;
      setFile(f);
      // PDFs: count pages when the index does not know yet.
      if (f.ext === 'pdf' && !f.meta?.pages && api.convert?.pageCount) {
        const pages = await api.convert.pageCount(f.path).catch(() => null);
        if (alive && pages) setFile({ ...f, meta: { ...f.meta, pages } });
      }
    });
    return () => { alive = false; };
  }, [focused, selection]);

  if (!file) {
    return (
      <aside className="inspector">
        <div className="empty" style={{ padding: '80px 10px' }}>
          <Icon name="info" size={34} stroke={1.3} />
          <div className="small">Select a file to see its details.</div>
        </div>
      </aside>
    );
  }

  if (selection.length > 1) {
    return (
      <aside className="inspector">
        <h3>{selection.length} items selected</h3>
        <div className="insp-actions">
          <button className="btn sm" onClick={() => void api.island.addToShelf(selection)}><Icon name="island" size={12} /> Add to Shelf</button>
          <button className="btn sm" onClick={() => void api.files.copyPaths(selection)}><Icon name="copy" size={12} /> Copy</button>
          <button className="btn sm danger" onClick={() => void trash(selection)}><Icon name="trash" size={12} /> Trash</button>
        </div>
      </aside>
    );
  }

  const m = file.meta;
  const dir = file.path.slice(0, file.path.length - file.name.length - 1);
  const rows: [string, React.ReactNode][] = [
    ['Kind', file.screenshot ? 'Screenshot' : `${file.ext ? file.ext.toUpperCase() + ' ' : ''}${KIND_SINGULAR[file.kind]}`],
    ['Size', formatBytes(file.size)],
    ['Modified', `${formatDate(file.mtime)} · ${relativeTime(file.mtime)}`],
    ['Created', formatDate(file.btime)],
    ...(file.atime ? [['Opened', relativeTime(file.atime)] as [string, string]] : []),
    ...(m?.width && m.height ? [['Dimensions', `${m.width} × ${m.height}`] as [string, string]] : []),
    ...(m?.durationSec ? [['Duration', formatDuration(m.durationSec)] as [string, string]] : []),
    ...(m?.camera ? [['Camera', m.camera] as [string, string]] : []),
    ...(m?.pages ? [['Pages', String(m.pages)] as [string, string]] : []),
    ...(m?.artist ? [['Artist', m.artist] as [string, string]] : []),
    ...(m?.album ? [['Album', m.album] as [string, string]] : []),
    ['Where', <span key="w" className="mono" style={{ fontSize: 11.5 }}>{info?.home && dir.startsWith(info.home) ? '~' + dir.slice(info.home.length) : dir}</span>],
    ...(file.source ? [['From', (
      <span key="s">
        {file.source.name}
        {file.source.referrer || file.source.url ? (
          <><br /><a href="#" className="small" onClick={(e) => { e.preventDefault(); void api.system.openExternal(file.source!.referrer ?? file.source!.url!); }}>{(file.source.referrer ?? file.source.url!).slice(0, 60)}</a></>
        ) : null}
      </span>
    )] as [string, React.ReactNode]] : []),
  ];

  const setTags = async (tags: string[]) => {
    await api.library.setTags(file.path, tags);
    const next = { ...file, tags };
    setFile(next);
    setFocused(next);
    refresh();
  };

  return (
    <aside className="inspector">
      <Preview file={file} />
      {renaming ? (
        <input
          className="input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={async (e) => {
            if (e.key === 'Escape') setRenaming(false);
            if (e.key === 'Enter' && name.trim() && name !== file.name) {
              try {
                const to = await api.files.rename(file.path, name.trim());
                setFocused({ ...file, path: to, name: name.trim() });
                refresh();
              } catch (err) {
                toast(err instanceof Error ? err.message : 'Could not rename');
              }
              setRenaming(false);
            }
          }}
        />
      ) : (
        <div className="insp-name" title="Double-click to rename" onDoubleClick={() => { setName(file.name); setRenaming(true); }}>{file.name}</div>
      )}

      <div className="insp-actions">
        <button className="btn sm" onClick={() => (file.kind === 'audio' ? play(file) : void api.files.open(file.path))}><Icon name={file.kind === 'audio' ? 'play' : 'external'} size={12} /> {file.kind === 'audio' ? 'Play' : 'Open'}</button>
        <button className="btn sm" onClick={() => void api.files.reveal(file.path)}><Icon name="reveal" size={12} /> Show</button>
        <button className="btn sm" onClick={() => void api.island.addToShelf([file.path]).then(() => toast('Added to the Shelf'))}><Icon name="island" size={12} /> Shelf</button>
        <button className="btn sm danger icon" title="Move to Trash" onClick={() => void trash([file.path])}><Icon name="trash" size={12} /></button>
      </div>

      <dl className="kv">
        {rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
      </dl>

      {file.text ? (
        <div className="col">
          <div className="row"><h3 className="grow">Text in this {file.kind === 'image' ? 'image' : 'file'}</h3>
            <button className="btn sm" onClick={() => { void api.files.copyText(file.text!); toast('Text copied'); }}><Icon name="copy" size={12} /> Copy</button>
          </div>
          <div className="ocr-text">{file.text}</div>
        </div>
      ) : null}

      <InspectorAi file={file} onRenamed={(to, n) => { const next = { ...file, path: to, name: n }; setFile(next); setFocused(next); }} />

      <FileVersions path={file.path} />

      <div className="col">
        <h3>Tags</h3>
        <div className="tags">
          {(file.tags ?? []).map((t) => (
            <span key={t} className="chip">#{t}<button onClick={() => void setTags((file.tags ?? []).filter((x) => x !== t))} aria-label={`Remove ${t}`}><Icon name="close" size={10} stroke={2.4} /></button></span>
          ))}
          <input
            className="tag-input"
            placeholder="+ Add tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tag.trim()) {
                void setTags([...(file.tags ?? []), tag.trim().replace(/^#/, '').toLowerCase()]);
                setTag('');
              }
            }}
          />
        </div>
      </div>
    </aside>
  );
}
