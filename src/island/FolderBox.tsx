// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A folder box on the desktop: the folder's name and how many items, its files
// as icons (folders first, then by kind, name, date or size), double-click or
// Enter to open one, and a button that rolls the box up to its title bar.

import { useEffect, useState } from 'react';
import { BOX_GROUPS, boxTitle, ROLLED_HEIGHT, shortName, type BoxItem } from '../../core/folder-boxes';
import type { WidgetConfig } from '../../core/widgets';
import { api } from '../api';
import { Icon } from '../components/Icon';

const ICON: Record<string, string> = { folder: 'folder', image: 'image', video: 'video', audio: 'audio', document: 'document', archive: 'archive', installer: 'installer', app: 'app', code: 'code', other: 'other' };

export function FolderBoxWidget({ w, preview }: { w: WidgetConfig; preview?: boolean }) {
  const [items, setItems] = useState<BoxItem[] | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const folder = w.options.folder ?? '';
  const rolled = !!w.options.rolled;
  useEffect(() => {
    if (!folder) { setItems([]); return undefined; }
    let live = true;
    const load = () => void api.boxes.list(folder, w.options.sort, w.options.show).then((l) => { if (live) { setItems(l); setError(''); } }, (e: unknown) => { if (live) setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)); });
    load();
    // A box looks at its folder again every half minute, and when it is clicked.
    const t = setInterval(load, 30_000);
    window.addEventListener('focus', load);
    return () => { live = false; clearInterval(t); window.removeEventListener('focus', load); };
  }, [folder, w.options.sort, w.options.show]);

  const roll = () => {
    const full = w.options.fullHeight ?? (w.bounds.height > ROLLED_HEIGHT ? w.bounds.height : 260);
    void api.widgets.save({ ...w, options: { ...w.options, rolled: !rolled, fullHeight: full }, bounds: { ...w.bounds, height: rolled ? full : ROLLED_HEIGHT } });
  };
  const title = boxTitle(folder, w.options.title);
  const show = w.options.show && w.options.show !== 'all' ? BOX_GROUPS.find((g) => g.id === w.options.show)?.name : undefined;
  return (
    <div className={`fbox${rolled ? ' rolled' : ''}`} data-testid="folder-box">
      <div className="fbox-head">
        <Icon name="folder" size={14} />
        <span className="fbox-title" title={folder}>{title}</span>
        <span className="fbox-count">{items ? `${items.length}${show ? ` ${show.toLowerCase()}` : ''}` : ''}</span>
        {!preview ? (
          <button className="fbox-roll" onClick={roll} aria-label={rolled ? `Unroll ${title}` : `Roll up ${title}`} title={rolled ? 'Unroll' : 'Roll up'} aria-expanded={!rolled}>
            <Icon name={rolled ? 'chevronDown' : 'minus'} size={12} />
          </button>
        ) : null}
      </div>
      {rolled ? null : !folder ? (
        <div className="fbox-empty">Choose a folder for this box on the Widgets page.</div>
      ) : error ? (
        <div className="fbox-empty">{error}</div>
      ) : items && !items.length ? (
        <div className="fbox-empty">Nothing here yet. Files you put in this folder show up here.</div>
      ) : (
        <div className="fbox-grid" role="list" aria-label={title}>
          {(items ?? []).map((it) => (
            <button key={it.path} role="listitem" className={`fbox-item${sel === it.path ? ' sel' : ''}`} title={it.name}
              onClick={() => setSel(it.path)}
              onDoubleClick={() => void api.boxes.open(it.path)}
              onKeyDown={(e) => { if (e.key === 'Enter') void api.boxes.open(it.path); }}
              onContextMenu={(e) => { e.preventDefault(); void api.boxes.reveal(it.path); }}>
              <span className={`fbox-icon k-${it.kind}`}><Icon name={ICON[it.kind] ?? 'other'} size={20} /></span>
              <span className="fbox-name">{shortName(it.name, 18)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
