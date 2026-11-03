// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The reader: feeds by folder with unread counts, Read later, the list of
// articles, and a clean, calm article view that works offline.

import { useCallback, useEffect, useState } from 'react';
import type { ReaderArticle, ReaderItem, ReaderOverview, ReaderView } from '../../core/api-reader';
import { readingMinutes } from '../../core/reader';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, PageHead } from '../components/ui';
import { useStore } from '../state';
import '../styles/reader.css';

type Source = { view: ReaderView; feed?: string; folder?: string };
const same = (a: Source, b: Source) => a.view === b.view && a.feed === b.feed && a.folder === b.folder;

function ago(t?: number): string {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function Reader() {
  const { toast } = useStore();
  const [ov, setOv] = useState<ReaderOverview | null>(null);
  const [src, setSrc] = useState<Source>({ view: 'unread' });
  const [items, setItems] = useState<ReaderItem[]>([]);
  const [open, setOpen] = useState<ReaderArticle | null>(null);
  const [loading, setLoading] = useState('');
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setOv(await api.reader.overview());
    setItems(await api.reader.items(src));
  }, [src]);
  useEffect(() => {
    void load();
    return api.on('reader-changed', () => void load());
  }, [load]);

  const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e));
  const read = async (it: ReaderItem) => {
    setLoading(it.key);
    try { setOpen(await api.reader.article(it.key)); } catch (e) { fail(e); } finally { setLoading(''); }
  };
  const add = async () => {
    const a = addr.trim();
    if (!a) return;
    setBusy(true);
    try {
      if (src.view === 'later') { const it = await api.reader.saveForLater(a); toast(`Saved for later: ${it.title}`); }
      else { const f = await api.reader.addFeed(a); toast(`Following ${f.title}`); setSrc({ view: 'all', feed: f.id }); }
      setAddr('');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  if (!ov) return <div className="page"><PageHead title="Reader" /></div>;
  const titleOf = src.feed ? ov.feeds.find((f) => f.id === src.feed)?.title ?? 'Feed' : src.folder ?? (src.view === 'unread' ? 'Unread' : src.view === 'starred' ? 'Starred' : src.view === 'later' ? 'Read later' : 'All articles');
  const feedErr = src.feed ? ov.feeds.find((f) => f.id === src.feed)?.error : undefined;
  const Row = ({ s, icon, label, n }: { s: Source; icon: string; label: string; n?: number }) => (
    <button className={`rd-src${same(src, s) ? ' on' : ''}`} aria-current={same(src, s) ? 'true' : undefined} onClick={() => { setSrc(s); setOpen(null); }}>
      <Icon name={icon} size={14} /> <span className="rd-src-name">{label}</span>{n ? <span className="rd-count">{n}</span> : null}
    </button>
  );
  const byFolder = [...ov.folders.map((f) => ({ folder: f as string | undefined, feeds: ov.feeds.filter((x) => x.folder === f) })), { folder: undefined, feeds: ov.feeds.filter((x) => !x.folder) }].filter((g) => g.feeds.length);

  return (
    <div className="page rd-page" data-testid="reader-page">
      <PageHead title="Reader" sub="The sites you follow and the pages you saved, in a calm view that works offline. Only what you add is fetched.">
        <button className="btn" disabled={ov.refreshing || !ov.feeds.length} onClick={() => void api.reader.refresh().then(setOv, fail)} data-testid="rd-refresh"><Icon name="refresh" size={14} /> {ov.refreshing ? 'Looking…' : 'Refresh'}</button>
        <button className="btn" onClick={() => void api.reader.importOpml().then((r) => { if (r.added || r.skipped) toast(`${r.added} feed${r.added === 1 ? '' : 's'} added${r.skipped ? `, ${r.skipped} already there` : ''}`); }, fail)}>Import</button>
        <button className="btn" disabled={!ov.feeds.length} onClick={() => void api.reader.exportOpml().then((r) => { if (r.saved) toast(`Saved ${r.path}`); }, fail)}>Export</button>
      </PageHead>
      <div className="rd-layout">
        <nav className="rd-side" aria-label="Feeds">
          <Row s={{ view: 'unread' }} icon="inbox" label="Unread" n={ov.counts.unread} />
          <Row s={{ view: 'all' }} icon="list" label="All articles" />
          <Row s={{ view: 'starred' }} icon="star" label="Starred" n={ov.counts.starred} />
          <Row s={{ view: 'later' }} icon="clock" label="Read later" n={ov.counts.later} />
          {byFolder.map((g) => (
            <div key={g.folder ?? '-'} className="rd-folder">
              {g.folder ? <button className={`rd-folder-name${src.folder === g.folder ? ' on' : ''}`} onClick={() => { setSrc({ view: 'all', folder: g.folder }); setOpen(null); }}>{g.folder}</button> : ov.folders.length ? <div className="rd-folder-name static">Other</div> : null}
              {g.feeds.map((f) => <Row key={f.id} s={{ view: 'all', feed: f.id }} icon={f.error ? 'warning' : 'rss'} label={f.title} n={f.unread} />)}
            </div>
          ))}
        </nav>
        <section className="rd-list" aria-label={titleOf}>
          <form className="rd-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <input className="input" value={addr} onChange={(e) => setAddr(e.target.value)} disabled={busy} data-testid="rd-add-input"
              placeholder={src.view === 'later' ? 'Save a page: paste its address' : 'Follow a site: its address or its feed'} aria-label={src.view === 'later' ? 'Address of a page to save for later' : 'Address of a site or feed to follow'} />
            <button className="btn primary" type="submit" disabled={busy || !addr.trim()}>{busy ? '…' : src.view === 'later' ? 'Save' : 'Follow'}</button>
          </form>
          <div className="rd-list-head">
            <b>{titleOf}</b>
            {src.view !== 'later' && items.some((i) => !i.read) ? <button className="btn sm ghost" onClick={() => void api.reader.markAllRead({ feed: src.feed, folder: src.folder }).then(setOv)}>Mark all read</button> : null}
            {src.feed ? <button className="btn sm ghost" aria-label="Stop following this feed" onClick={() => { if (confirm('Stop following this feed? Starred and saved articles stay.')) void api.reader.removeFeed(src.feed!).then((o) => { setOv(o); setSrc({ view: 'unread' }); }); }}><Icon name="trash" size={13} /></button> : null}
          </div>
          {feedErr ? <p className="rd-err small" role="status"><Icon name="warning" size={12} /> {feedErr}</p> : null}
          {items.length ? (
            <ul className="rd-items" data-testid="rd-items">
              {items.map((it) => (
                <li key={it.key}>
                  <button className={`rd-item${it.read ? ' read' : ''}${open?.key === it.key ? ' on' : ''}`} onClick={() => void read(it)} aria-busy={loading === it.key}>
                    {it.image && ov.settings.images ? <img src={it.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                    <span className="rd-item-text">
                      <span className="rd-item-title">{!it.read ? <i className="rd-dot" aria-label="Unread" /> : null}{it.title}</span>
                      <span className="muted small">{it.source}{it.published ? ` · ${ago(it.published)}` : ''}{it.starred ? ' · ★' : ''}</span>
                      {it.excerpt ? <span className="rd-excerpt small">{it.excerpt}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : !ov.feeds.length && src.view !== 'later' ? (
            <Empty icon="rss" title="Follow your first site">Paste a site’s address above (Keeper finds its feed), or import a list of feeds (OPML) from another reader.</Empty>
          ) : <p className="muted small rd-none">{src.view === 'later' ? 'Pages you save for later appear here, kept to read offline. In your browser, right-click a page → Save for later in Keeper.' : 'Nothing here.'}</p>}
        </section>
        <article className="rd-article" aria-label="Article" data-testid="rd-article">
          {open ? (
            <>
              <div className="rd-tools">
                <button className="btn sm ghost" aria-pressed={open.starred} onClick={async () => { await api.reader.setStarred(open.key, !open.starred); setOpen({ ...open, starred: !open.starred }); }}><Icon name="star" size={13} /> {open.starred ? 'Starred' : 'Star'}</button>
                <button className="btn sm ghost" aria-pressed={open.later} onClick={async () => { if (open.later) await api.reader.removeLater(open.key); else await api.reader.saveForLater(open.url, open.title).catch(fail); setOpen({ ...open, later: !open.later }); }}><Icon name="clock" size={13} /> {open.later ? 'In Read later' : 'Read later'}</button>
                <button className="btn sm ghost" onClick={async () => { await api.reader.setRead([open.key], false); setOpen(null); }}>Mark unread</button>
                <span className="grow" />
                {open.url ? <button className="btn sm" onClick={() => void api.system.openExternal(open.url)}><Icon name="external" size={13} /> Original</button> : null}
              </div>
              <div className="rd-body" data-testid="rd-body">
                <h1>{open.title}</h1>
                <p className="muted small">{[open.source, open.byline, open.published ? new Date(open.published).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : '', open.words ? `${readingMinutes(open.words)} min read` : ''].filter(Boolean).join(' · ')}{open.offline ? ' · kept offline' : ''}</p>
                {open.note ? <p className="rd-err small">{open.note}</p> : null}
                <div className="rd-content" dangerouslySetInnerHTML={{ __html: open.html || '<p>This article has no text in its feed. Open the original to read it.</p>' }} />
              </div>
            </>
          ) : <div className="rd-placeholder muted"><Icon name="document" size={28} /><p>Choose an article to read it here.</p></div>}
        </article>
      </div>
    </div>
  );
}
