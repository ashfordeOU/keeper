// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The bar over a file list: where you are looking (this folder, or Everywhere)
// and "By type" chips with counts (Documents, Pictures, Videos…). A type is a
// filter on what you see, never a place of its own (core/file-types.ts).

import { useRef, type KeyboardEvent } from 'react';
import { chipRoute, shortCount, TYPE_CHIPS, visibleChips, type TypeCounts, type TypeFilter } from '../../core/file-types';
import { formatBytes } from '../../core/format';
import { api } from '../api';
import { useHiddenRoutes } from '../features';
import { useAsync, useStore, type Route } from '../state';
import { Icon } from './Icon';
import '../styles/filetypes.css';

/** The folder last looked at, for Everywhere's way back (Home folder until there is one). */
let lastFolder: string | undefined;
export function rememberFolder(dir: string) {
  if (dir) lastFolder = dir;
}

const color = (c: string) => (c === 'web' ? 'var(--c-installer)' : `var(--c-${c})`);
const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

/** ←/→ (and Home/End) move between the buttons of a group; Tab leaves it. */
function arrows(e: KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  const i = all.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  const next = e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
  e.preventDefault();
  next?.focus();
}

export function TypeChips({ folder, active, source, counts: given }: {
  /** the folder being looked at; undefined for Everywhere */
  folder?: string;
  active: TypeFilter;
  /** a download source chosen within From the web */
  source?: string;
  /** counts worked out by the page (a folder Keeper does not read) */
  counts?: TypeCounts;
}) {
  const { go, version, info } = useStore();
  const hidden = useHiddenRoutes();
  const ref = useRef<HTMLDivElement>(null);
  const loaded = useAsync(() => (given ? Promise.resolve(given) : api.library.typeCounts(folder)), [folder, version, given]);
  const counts = given ?? loaded.data;
  const everywhere = folder === undefined;
  // From the web needs "Where downloads came from" (Settings → Features).
  const chips = visibleChips(counts, active).filter((c) => c.id !== 'web' || !hidden.has('downloads'));
  const pick = (chip: TypeFilter) => go(chipRoute({ folder }, chip === active && chip !== 'all' ? 'all' : chip) as Route);
  const back = lastFolder ?? info?.home ?? '';
  const sources = useAsync(() => (active === 'web' && everywhere ? api.library.bySource() : Promise.resolve([])), [active, everywhere, version]);
  const where = everywhere ? 'everywhere' : `in ${baseName(folder ?? '')}`;

  return (
    <div className="type-bar" data-testid="type-bar">
      <div className="seg type-scope" role="radiogroup" aria-label="Where to look" onKeyDown={arrows}>
        <button role="radio" aria-checked={!everywhere} className={!everywhere ? 'on' : ''} data-testid="scope-folder" title={everywhere ? `Back to ${baseName(back)}` : `Only ${baseName(folder ?? '')} and the folders in it`}
          disabled={everywhere && !back} onClick={() => everywhere && go(chipRoute({ folder: back }, active) as Route)}>
          <Icon name="folder" size={13} /><span className="ellipsis">{everywhere ? baseName(back) : baseName(folder ?? '')}</span>
        </button>
        <button role="radio" aria-checked={everywhere} className={everywhere ? 'on' : ''} data-testid="scope-everywhere" title="Every file Keeper reads, whichever folder it is in"
          onClick={() => !everywhere && go(chipRoute({}, active) as Route)}>
          <Icon name="search" size={13} />Everywhere
        </button>
      </div>
      <div className="type-chips" role="group" aria-label="Show only" ref={ref} onKeyDown={arrows}>
        <button className={`type-chip ${active === 'all' ? 'on' : ''}`} aria-pressed={active === 'all'} data-testid="chip-all" data-chip="all" onClick={() => pick('all')}
          title={counts ? `Every file ${where}: ${counts.all.count.toLocaleString()} · ${formatBytes(counts.all.size)}` : `Every file ${where}`}>
          All{counts ? <span className="n">{shortCount(counts.all.count)}</span> : null}
        </button>
        {chips.map((c) => {
          const n = counts?.[c.id];
          const on = active === c.id;
          return (
            <button key={c.id} className={`type-chip ${on ? 'on' : ''}`} aria-pressed={on} data-testid={`chip-${c.id}`} data-chip={c.id} onClick={() => pick(c.id)}
              aria-label={`${c.label}${n ? `, ${n.count.toLocaleString()}` : ''}`}
              title={`${c.tip}${n ? ` · ${n.count.toLocaleString()} ${where} · ${formatBytes(n.size)}` : ''}${on ? '\nClick again to show every file' : ''}`}>
              <i style={{ background: color(c.color) }} aria-hidden />{c.label}{n ? <span className="n" aria-hidden>{shortCount(n.count)}</span> : null}
            </button>
          );
        })}
        {active !== 'all' && !TYPE_CHIPS.some((c) => c.id === active) ? (
          <button className="type-chip on" aria-pressed data-chip={active} onClick={() => pick('all')} title="Click to show every file">{active === 'code' ? 'Code' : 'Other files'}</button>
        ) : null}
      </div>
      {/* From the web, Everywhere: the sites and apps files came from (once "Download Sources"). */}
      {sources.data?.length ? (
        <div className="type-chips type-sources" role="group" aria-label="Came from" onKeyDown={arrows} data-testid="type-sources">
          {sources.data.slice(0, 12).map((s) => (
            <button key={s.id} className={`type-chip sm ${source === s.id ? 'on' : ''}`} aria-pressed={source === s.id} onClick={() => go(chipRoute({}, 'web', source === s.id ? undefined : s.id) as Route)}
              title={`${s.count.toLocaleString()} file${s.count === 1 ? '' : 's'} from ${s.name} · ${formatBytes(s.size)}`}>
              {s.name}<span className="n" aria-hidden>{shortCount(s.count)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
