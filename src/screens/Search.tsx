// SPDX-License-Identifier: AGPL-3.0-or-later
// Search results: how Keeper read the words (editable chips), matches found
// inside files, and the files themselves.

import { useEffect, useState } from 'react';
import { queryToText, removeChip } from '../../core/query/parse';
import type { ParsedQuery, SearchHit } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { copyFullText, Empty, Files, Loading, Modal, Thumb, ViewControls } from '../components/ui';
import { useStore } from '../state';
import '../styles/screens-a.css';

const EXAMPLES = [
  'pdfs from last week over 5 MB',
  'screenshots with wifi password',
  'videos from my iphone in august',
  'zips bigger than 1gb older than 6 months',
  'pdfs from gmail',
  'biggest files in downloads',
  'photos taken yesterday',
  'duplicate photos',
];

function highlight(text: string, words: string[]) {
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export function Search() {
  const { route, go, settings, updateSettings, version, toast, setSelection, setFocused } = useStore();
  const q = route.q ?? (route.arg ? settings?.savedSearches.find((s) => s.id === route.arg)?.text : '') ?? '';
  const [result, setResult] = useState<{ parsed: ParsedQuery; hits: SearchHit[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!q.trim()) {
      setResult(null);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      void api.library.search(q, 500).then((r) => {
        if (alive) { setResult(r); setLoading(false); }
      });
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [q, version]);

  const saved = settings?.savedSearches.find((s) => s.id === route.arg || s.text === q);

  if (!q.trim()) {
    return (
      <Empty icon="search" title="Search the way you talk">
        Type what you remember — a kind of file, when, how big, where it came from, or words inside it.
        <div className="examples">
          {EXAMPLES.map((e) => <button key={e} className="chip" style={{ paddingRight: 10 }} onClick={() => go({ name: 'search', q: e })}>{e}</button>)}
        </div>
      </Empty>
    );
  }

  const words = result ? [...result.parsed.query.terms, ...result.parsed.query.phrases] : [];
  const snippets = result?.hits.filter((h) => h.snippet).slice(0, 4) ?? [];
  const files = result?.hits.map((h) => h.file);

  return (
    <div>
      <div className="page-head">
        <div className="col" style={{ minWidth: 0 }}>
          <h1>{saved ? saved.name : 'Search'}</h1>
          {result ? <div className="sub small">{result.parsed.explanation}</div> : null}
        </div>
        <div className="btn-row">
          {saved ? (
            <button className="btn" onClick={() => { void updateSettings({ savedSearches: settings!.savedSearches.filter((s) => s.id !== saved.id) }); toast('Saved search removed'); go({ name: 'search', q }); }}>
              <Icon name="trash" size={14} /> Delete
            </button>
          ) : (
            <button className="btn" onClick={() => { setName(q.length > 28 ? q.slice(0, 28) + '…' : q); setSaving(true); }}><Icon name="star" size={14} /> Save search</button>
          )}
          <ViewControls />
        </div>
      </div>

      {result?.parsed.chips.length ? (
        <div className="chips" style={{ marginBottom: 14 }}>
          {result.parsed.chips.map((c, i) => (
            <span key={`${c.field}-${c.value}-${i}`} className="chip" title={`Remove “${c.label}”`}>
              {c.label}
              <button onClick={() => go({ name: 'search', q: queryToText(removeChip(result.parsed.query, c)) || ' ' })} aria-label={`Remove ${c.label}`}>
                <Icon name="close" size={10} stroke={2.4} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {snippets.length ? (
        <div className="snippets">
          <div className="small muted">Found inside files</div>
          {snippets.map((h) => (
            <div key={h.file.path} className="snippet" onClick={() => { setSelection([h.file.path]); setFocused(h.file); }} onDoubleClick={() => void api.files.open(h.file.path)}>
              <div style={{ width: 34, height: 34, borderRadius: 7, overflow: 'hidden', background: 'var(--bg-sunk)', flex: 'none', display: 'grid', placeItems: 'center' }}><Thumb file={h.file} size={96} /></div>
              <div className="grow">
                <div className="small" style={{ fontWeight: 600 }}>{h.file.name}</div>
                <div className="small sub">{highlight(h.snippet!, words)}</div>
              </div>
              {h.file.text ? <button className="btn sm" onClick={(e) => { e.stopPropagation(); void copyFullText(h.file).then(() => toast('Text copied')); }}><Icon name="copy" size={12} /> Copy text</button> : null}
            </div>
          ))}
        </div>
      ) : null}

      {loading && !result ? <Loading label="Searching…" /> : (
        <Files files={files} showSource empty={<Empty icon="search" title="No matches">Try fewer words, or remove a filter above.</Empty>} />
      )}

      {saving ? (
        <Modal title="Save search" onClose={() => setSaving(false)} width={420}>
          <div className="col">
            <span className="small muted">It appears in the sidebar and updates as files change.</span>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.parentElement?.querySelector('.btn.primary') as HTMLButtonElement)?.click()} />
            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn" onClick={() => setSaving(false)}>Cancel</button>
              <button className="btn primary" disabled={!name.trim()} onClick={() => {
                const id = `s${Date.now().toString(36)}`;
                void updateSettings({ savedSearches: [...(settings?.savedSearches ?? []), { id, name: name.trim(), text: q, createdAt: Date.now() }] });
                setSaving(false);
                toast('Saved to the sidebar');
              }}>Save</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
