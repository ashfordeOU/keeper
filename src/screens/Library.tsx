// SPDX-License-Identifier: AGPL-3.0-or-later
// One shelf of the library: a kind of file, recents, screenshots, a download
// source or a tag.

import { useEffect, useState } from 'react';
import { KIND_LABEL } from '../../core/classify';
import { formatBytes } from '../../core/format';
import { sourceName } from '../../core/sources';
import type { FileKind } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Files, PageHead, ViewControls } from '../components/ui';
import { useAsync, useStore } from '../state';
import '../styles/screens-a.css';

type SortKey = 'name' | 'date' | 'size' | 'kind';

export function Library() {
  const { route, version, selection, toast } = useStore();
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

  const title =
    route.name === 'library' ? KIND_LABEL[route.arg as FileKind] ?? 'Library'
    : route.name === 'screenshots' ? 'Screenshots'
    : route.name === 'source' ? `From ${sourceName((route.arg ?? '').replace(/^web:/, ''))}`
    : route.name === 'tag' ? `#${route.arg}`
    : 'Recents';

  const list = files.data;
  const total = list?.reduce((n, f) => n + f.size, 0) ?? 0;

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
      <PageHead title={title} sub={list ? `${list.length.toLocaleString()} item${list.length === 1 ? '' : 's'} · ${formatBytes(total)}` : ' '}>
        {route.name === 'screenshots' ? (
          <button className="btn" onClick={() => void copyText()} title="Copy the text inside the selected screenshots">
            <Icon name="text" size={14} /> {selection.length ? 'Copy text from selected' : 'Copy text from all'}
          </button>
        ) : null}
        <ViewControls sort={sort} onSort={setSort} />
      </PageHead>
      <Files
        files={list}
        sort={sort}
        onSort={(k) => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== 'name' }))}
        showSource={route.name === 'recents' || route.name === 'source'}
        empty={<Empty icon={route.name === 'screenshots' ? 'screenshot' : 'folder'} title="Nothing here yet">Files show up here as Keeper finds them in your folders.</Empty>}
      />
    </div>
  );
}
