// SPDX-License-Identifier: AGPL-3.0-or-later
// The clipboard picker: a small window over any app. Type to filter, arrows to
// choose, Return pastes into the app you were in, 1–9 paste instantly.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { IslandState } from '../../core/api';
import type { ClipItem, ClipKind } from '../../core/island';
import { relativeTime } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { mod } from '../state';
import '../styles/widgets.css';

const KINDS: { id: ClipKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'text', label: 'Text' }, { id: 'link', label: 'Links' }, { id: 'code', label: 'Code' },
  { id: 'color', label: 'Colours' }, { id: 'image', label: 'Images' }, { id: 'file', label: 'Files' },
];

export const KIND_ICON: Record<ClipKind, string> = { text: 'text', link: 'globe', code: 'code', color: 'palette', image: 'image', file: 'document' };

/** Pinned first, then newest; text, notes, titles, text in images and the source app all count. */
export function filterClips(items: ClipItem[], q: string, kind: ClipKind | 'all', collection?: string): ClipItem[] {
  const needle = q.trim().toLowerCase();
  return items
    .filter((c) => (kind === 'all' || c.kind === kind) && (!collection || c.collections?.includes(collection)))
    .filter((c) => !needle || [c.text, c.note, c.title, c.ocr, c.source].some((x) => x?.toLowerCase().includes(needle)))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at);
}

export function ClipPicker() {
  const [state, setState] = useState<IslandState | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ClipKind | 'all'>('all');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => {
      void api.island.state().then(setState);
      setQ('');
      setIndex(0);
      input.current?.focus();
    };
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const off = api.on('island-changed', () => void api.island.state().then(setState));
    return () => { off(); window.removeEventListener('focus', onFocus); };
  }, []);

  const items = useMemo(() => filterClips(state?.clips ?? [], q, kind), [state, q, kind]);
  useEffect(() => setIndex(0), [q, kind]);
  useEffect(() => {
    list.current?.querySelector('.cp-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const paste = (c?: ClipItem) => {
    if (!c) return;
    void api.island.pasteClip(c.id, true);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); api.island.closeClips(); window.close?.(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) void api.island.copyClip(items[index].id).then(() => api.island.closeClips()); else paste(items[index]); }
    else if (/^[1-9]$/.test(e.key) && (e.metaKey || e.ctrlKey || !q)) { e.preventDefault(); paste(items[Number(e.key) - 1]); }
    else if (e.key === 'Tab') { e.preventDefault(); const i = KINDS.findIndex((k) => k.id === kind); setKind(KINDS[(i + (e.shiftKey ? KINDS.length - 1 : 1)) % KINDS.length].id); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p' && items[index]) { e.preventDefault(); void api.island.pinClip(items[index].id); }
  };

  return (
    <div className="cp" onKeyDown={onKey}>
      <div className="cp-head">
        <Icon name="clipboard" size={17} />
        <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search what you copied — text, notes, apps, words in images" />
      </div>
      <div className="cp-kinds">
        {KINDS.map((k) => <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => { setKind(k.id); input.current?.focus(); }}>{k.label}</button>)}
      </div>
      <div className="cp-list" ref={list}>
        {items.length === 0 ? <div className="muted" style={{ padding: 24, textAlign: 'center' }}>{state ? 'Nothing matches.' : 'Loading…'}</div> : null}
        {items.slice(0, 200).map((c, i) => (
          <div key={c.id} className={`cp-row ${i === index ? 'on' : ''}`} onMouseMove={() => setIndex(i)} onClick={() => paste(c)} title={c.text}>
            <span className="k">{i < 9 ? i + 1 : ''}</span>
            {c.kind === 'color' && c.text ? <span className="sw" style={{ background: c.text }} /> : c.image ? <img src={c.image} alt="" /> : <Icon name={KIND_ICON[c.kind] ?? 'text'} size={14} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t">{c.kind === 'code' ? <code>{c.text}</code> : c.kind === 'link' && c.title ? c.title : c.kind === 'image' && c.ocr ? `${c.text} — ${c.ocr.slice(0, 60)}` : c.text}</div>
              <div className="muted small t">{[c.source, relativeTime(c.at), c.note, ...(c.collections ?? [])].filter(Boolean).join(' · ')}</div>
            </div>
            {c.pinned ? <Icon name="pin" size={12} /> : null}
          </div>
        ))}
      </div>
      <div className="cp-foot">
        <span>↩ paste</span><span>{mod}↩ copy only</span><span>1–9 quick paste</span><span>Tab kind</span><span>{mod}P pin</span><span>esc close</span>
      </div>
    </div>
  );
}
