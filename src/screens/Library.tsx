// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One shelf of the library: a kind of file, recents, screenshots, a download
// source or a tag. A kind ("All Documents") is every such file on the
// computer, wherever it lives: not a folder. It says so, and it groups its
// files under the folders they are in, each with a way into the real folder.

import { useEffect, useMemo, useState } from 'react';
import { KIND_LABEL } from '../../core/classify';
import { formatBytes } from '../../core/format';
import { countFolders, groupByFolder, kindIntro, prettyFolder } from '../../core/folder-view';
import { useT } from '../i18n';
import { sourceName } from '../../core/sources';
import type { FileKind } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Files, HiddenToggle, PageHead, ViewControls } from '../components/ui';
import type { FileEntry } from '../../core/types';
import { useAsync, useStore } from '../state';
import '../styles/screens-a.css';

type SortKey = 'name' | 'date' | 'size' | 'kind';

const GROUP_KEY = 'library.groupByFolder';
function loadGrouping(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(GROUP_KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; }
}

export function Library() {
  const { route, version, selection, toast, info, go, view } = useStore();
  const t = useT();
  const [grouping, setGrouping] = useState(loadGrouping);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true });

  useEffect(() => setSort({ key: 'date', desc: true }), [route.name, route.arg]);

  const opts = (() => {
    switch (route.name) {
      case 'library': return { kind: route.arg as FileKind };
      case 'screenshots': return { screenshot: true };
      case 'source': return { source: route.arg };
      case 'tag': return { tag: route.arg };
      default: return { limit: 300 };
    }
  })();

  const files = useAsync(() => api.library.list({ ...opts, sort: sort.key, desc: sort.desc }), [route.name, route.arg, sort.key, sort.desc, version]);

  // A collection of every file of a kind: "All Documents", not a second "Documents" folder.
  const kind = route.name === 'library' ? route.arg ?? '' : route.name === 'screenshots' ? 'screenshot' : '';
  const isKind = kind === 'screenshot' || (!!kind && !!KIND_LABEL[kind as FileKind]);
  const title =
    isKind ? t(`kindAll.${kind}`)
    : route.name === 'library' ? 'Library'
    : route.name === 'source' ? `From ${sourceName((route.arg ?? '').replace(/^web:/, ''))}`
    : route.name === 'tag' ? `#${route.arg}`
    : 'Recents';

  const list = files.data;
  const total = list?.reduce((n, f) => n + f.size, 0) ?? 0;

  // Group by folder: on by default for a kind, remembered per collection.
  const scope = `${route.name}:${route.arg ?? ''}`;
  const canGroup = route.name !== 'recents';
  const grouped = canGroup && (grouping[scope] ?? isKind);
  const setGrouped = (on: boolean) => {
    const next = { ...grouping, [scope]: on };
    setGrouping(next);
    try { localStorage.setItem(GROUP_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  const groups = useMemo(() => (grouped && list ? groupByFolder(list) : null), [grouped, list]);
  const shown = useMemo(() => (groups ? groups.flatMap((g) => g.files) : list), [groups, list]);
  const firstOf = useMemo(() => new Map((groups ?? []).map((g) => [g.files[0].path, g])), [groups]);
  const folders = useMemo(() => (list ? countFolders(list) : 0), [list]);
  const header = (f: FileEntry) => {
    const g = firstOf.get(f.path);
    if (!g) return null;
    return (
      <div className="group-head" title={g.dir}>
        <Icon name="folder" size={14} />
        <span className="ellipsis grow">{prettyFolder(g.dir, info?.home)}</span>
        <span className="small muted">{g.files.length.toLocaleString()} item{g.files.length === 1 ? '' : 's'}</span>
        <button className="btn ghost sm" onClick={() => go({ name: 'browse', arg: g.dir })} title={`Open ${g.dir}`}>Show in folder</button>
      </div>
    );
  };

  const copyText = async () => {
    const paths = selection.length ? selection : (list ?? []).map((f) => f.path);
    const r = await api.library.readText(paths);
    const text = r.map((x) => x.text).filter(Boolean).join('\n\n');
    if (!text) return toast('No text found in these screenshots');
    await api.files.copyText(text);
    toast(`Copied text from ${r.filter((x) => x.text).length} screenshot${r.length === 1 ? '' : 's'}`);
  };

  return (
    <div>
      <PageHead
        title={title}
        sub={!list ? ' ' : isKind ? <span data-testid="kind-intro">{kindIntro(kind, list.length, folders, info?.platform)}</span> : `${list.length.toLocaleString()} item${list.length === 1 ? '' : 's'} · ${formatBytes(total)}`}
      >
        {route.name === 'screenshots' ? (
          <button className="btn" onClick={() => void copyText()} title="Copy the text inside the selected screenshots">
            <Icon name="text" size={14} /> {selection.length ? 'Copy text from selected' : 'Copy text from all'}
          </button>
        ) : null}
        {canGroup ? (
          <button className={`btn sm group-toggle ${grouped ? 'on' : ''}`} data-testid="group-by-folder" aria-pressed={grouped} onClick={() => setGrouped(!grouped)} title="Show the files under the folders they are in">
            <Icon name="folder" size={13} /> Group by folder
          </button>
        ) : null}
        <HiddenToggle compact />
        <ViewControls sort={sort} onSort={setSort} />
      </PageHead>
      <Files
        files={shown}
        header={groups ? header : undefined}
        showFolder={!groups && view === 'list' && route.name !== 'recents'}
        sort={sort}
        onSort={(k) => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== 'name' }))}
        showSource={route.name === 'recents' || route.name === 'source'}
        empty={<Empty icon={route.name === 'screenshots' ? 'screenshot' : 'folder'} title="Nothing here yet">Files show up here as Keeper finds them in your folders.</Empty>}
      />
    </div>
  );
}
