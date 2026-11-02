// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Downloaded From: every download grouped by the site or service it came from.

import { formatBytes, relativeTime } from '../../core/format';
import { api } from '../api';
import { Empty, FileList, Loading, PageHead } from '../components/ui';
import { useAsync, useStore } from '../state';
import '../styles/screens-a.css';

const PALETTE = ['#f0617a', '#8b5cf6', '#f59e0b', '#3b82f6', '#14b8a6', '#10b981', '#ec4899', '#6366f1', '#0ea5e9', '#84cc16'];

function colorFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Downloads() {
  const { go, version } = useStore();
  const sources = useAsync(() => api.library.bySource(), [version]);
  const recent = useAsync(() => api.library.recent(50, 'download'), [version]);

  return (
    <div>
      <PageHead title="Download Sources" sub="Where your downloads came from, as recorded by your browser and system." />
      {sources.loading && !sources.data ? <Loading /> : sources.data?.length ? (
        <div className="source-grid">
          {sources.data.map((s) => (
            <button key={s.id} className="card hover source-card" onClick={() => go({ name: 'source', arg: s.id })}>
              <span className="avatar" style={{ background: colorFor(s.id) }}>{s.name.charAt(0).toUpperCase()}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="ellipsis" style={{ display: 'block', fontWeight: 600 }}>{s.name}</span>
                <span className="small muted">{s.count} file{s.count === 1 ? '' : 's'} · {formatBytes(s.size)} · {relativeTime(s.latest)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Empty icon="down" title="No download sources yet">Keeper reads where a file came from when your browser recorded it. New downloads show up here automatically.</Empty>
      )}

      <div className="section">
        <div className="section-head"><h2>Recent downloads</h2></div>
        {recent.data ? (recent.data.length ? <FileList files={recent.data} showSource /> : <Empty icon="down" title="Your Downloads folder is empty" />) : <Loading />}
      </div>
    </div>
  );
}
