// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Everywhere, Recents and a tag: files from the library, wherever they live.
// Everywhere has the "By type" chips (Documents, Pictures… with counts); a type
// is a filter, not a folder, so the page says so and groups its files under
// the folders they are in, each with a way into the real folder. The same
// list (useTypeList) shows a type inside one folder (Browse).

import { useEffect, useMemo, useState } from 'react';
import { chipQuery, routeChip, typeLabel, type TypeFilter, type TypeQuery } from '../../core/file-types';
import { formatBytes } from '../../core/format';
import { countFolders, groupByFolder, kindIntro, prettyFolder } from '../../core/folder-view';
import { sourceName } from '../../core/sources';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { TypeChips } from '../components/TypeChips';
import { Empty, Files, HiddenToggle, PageHead, ViewControls } from '../components/ui';
import type { FileEntry } from '../../core/types';
import { useAsync, useStore } from '../state';
import '../styles/screens-a.css';

export type SortKey = 'name' | 'date' | 'size' | 'kind';
export type Sort = { key: SortKey; desc: boolean };

const GROUP_KEY = 'library.groupByFolder';
function loadGrouping(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(GROUP_KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; }
}

/**
 * A library list (a type Everywhere or in a folder, Recents, a tag) with
 * "Group by folder", remembered per list (`scope`), and each group's header.
 */
export function useTypeList(opts: TypeQuery & { tag?: string; limit?: number }, scope: string, groupByDefault: boolean, sort: Sort, canGroup = true, skip = false) {
  const { version, info, go } = useStore();
  const [grouping, setGrouping] = useState(loadGrouping);
  const key = JSON.stringify(opts);
  const files = useAsync(() => (skip ? Promise.resolve(undefined) : api.library.list({ ...opts, sort: sort.key, desc: sort.desc })), [key, sort.key, sort.desc, version, skip]);
  const list = files.data;
  const grouped = canGroup && (grouping[scope] ?? groupByDefault);
  const setGrouped = (on: boolean) => {
    const next = { ...grouping, [scope]: on };
    setGrouping(next);
    try { localStorage.setItem(GROUP_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  const groups = useMemo(() => (grouped && list ? groupByFolder(list) : null), [grouped, list]);
  const shown = useMemo(() => (groups ? groups.flatMap((g) => g.files) : list), [groups, list]);
  const firstOf = useMemo(() => new Map((groups ?? []).map((g) => [g.files[0].path, g])), [groups]);
  const folders = useMemo(() => (list ? countFolders(list) : 0), [list]);
  const total = list?.reduce((n, f) => n + f.size, 0) ?? 0;
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
  return { list, shown, header: groups ? header : undefined, grouped, setGrouped, folders, total, canGroup };
}

export function GroupToggle({ grouped, onChange }: { grouped: boolean; onChange: (on: boolean) => void }) {
  return (
    <button className={`btn sm group-toggle ${grouped ? 'on' : ''}`} data-testid="group-by-folder" aria-pressed={grouped} onClick={() => onChange(!grouped)} title="Show the files under the folders they are in">
      <Icon name="folder" size={13} /> Group by folder
    </button>
  );
}

/** Screenshots: the text inside them, copied in one go. */
export function CopyTextButton({ list }: { list?: FileEntry[] }) {
  const { selection, toast } = useStore();
  const copyText = async () => {
    const paths = selection.length ? selection : (list ?? []).map((f) => f.path);
    const r = await api.library.readText(paths);
    const text = r.map((x) => x.text).filter(Boolean).join('\n\n');
    if (!text) return toast('No text found in these screenshots');
    await api.files.copyText(text);
    toast(`Copied text from ${r.filter((x) => x.text).length} screenshot${r.length === 1 ? '' : 's'}`);
  };
  return (
    <button className="btn sm" onClick={() => void copyText()} title="Copy the text inside the selected screenshots">
      <Icon name="text" size={13} /> {selection.length ? 'Copy text from selected' : 'Copy text from all'}
    </button>
  );
}

/** The empty state of a type, Everywhere or in a folder: what it holds and the one next step. */
export function TypeEmpty({ chip, inFolder }: { chip: TypeFilter; inFolder?: string }) {
  const { go } = useStore();
  const what = chip === 'all' ? 'files' : typeLabel(chip).toLowerCase();
  const icon = chip === 'all' ? 'folder' : chip === 'web' ? 'down' : chip;
  return inFolder ? (
    <Empty icon={icon} title={`No ${what} in ${inFolder}`} action={<button className="btn" data-testid="empty-everywhere" onClick={() => go(chip === 'all' ? { name: 'library' } : { name: 'library', arg: chip })}><Icon name="search" size={13} /> Look everywhere</button>}>
      Keeper can look in every folder it reads instead.
    </Empty>
  ) : (
    <Empty icon={icon} title={`No ${what} yet`} action={<button className="btn" onClick={() => go({ name: 'settings', arg: 'files' })}><Icon name="folder" size={13} /> Choose folders</button>}>
      Files show up here as Keeper finds them in your folders.
    </Empty>
  );
}

export function Library() {
  const { route, info, view } = useStore();
  const [sort, setSort] = useState<Sort>({ key: 'date', desc: true });
  useEffect(() => setSort({ key: 'date', desc: true }), [route.name, route.arg]);

  const everywhere = route.name === 'library';
  const chip = routeChip(route);
  const source = everywhere && chip === 'web' ? route.q : undefined;
  const opts = everywhere ? chipQuery(chip, { source }) : route.name === 'tag' ? { tag: route.arg } : { limit: 300 };
  // A type groups by folder unless the person says otherwise; every file at once starts as one list.
  const t = useTypeList(opts, `${route.name}:${route.arg ?? ''}`, everywhere && chip !== 'all', sort, route.name !== 'recents');
  const list = t.list;
  const title = everywhere ? 'Everywhere' : route.name === 'tag' ? `#${route.arg}` : 'Recents';
  const sub = !list ? ' '
    : source ? `${list.length.toLocaleString()} file${list.length === 1 ? '' : 's'} from ${sourceName(source)} · ${formatBytes(t.total)}`
    : everywhere ? <span data-testid="kind-intro">{kindIntro(chip, list.length, t.folders, info?.platform)}</span>
    : `${list.length.toLocaleString()} item${list.length === 1 ? '' : 's'} · ${formatBytes(t.total)}`;

  return (
    <div>
      <PageHead title={title} sub={sub}>
        {chip === 'screenshot' ? <CopyTextButton list={list} /> : null}
        {t.canGroup ? <GroupToggle grouped={t.grouped} onChange={t.setGrouped} /> : null}
        <HiddenToggle compact />
        <ViewControls sort={sort} onSort={setSort} />
      </PageHead>
      {everywhere ? <TypeChips active={chip} source={source} /> : null}
      <Files
        files={t.shown}
        header={t.header}
        showFolder={!t.header && view === 'list' && route.name !== 'recents'}
        sort={sort}
        onSort={(k) => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== 'name' }))}
        showSource={route.name === 'recents' || chip === 'web'}
        empty={everywhere ? <TypeEmpty chip={chip} /> : <Empty icon="folder" title="Nothing here yet">Files show up here as Keeper finds them in your folders.</Empty>}
      />
    </div>
  );
}
