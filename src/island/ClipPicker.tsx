// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The clipboard picker: a small window over any app. Type to filter, arrows to
// choose, Return pastes into the app you were in, 1–9 paste instantly. Sets
// (named lists such as "Addresses") are chips above the list; ⌘S / Ctrl+S
// files a clip in one. Space (or ⌘L / Ctrl+L) lines clips up to paste one by
// one: each paste then takes the next, and the Island shows how many are left.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { IslandState } from '../../core/api';
import type { ClipItem, ClipKind } from '../../core/island';
import { relativeTime } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { mod } from '../state';
import '../styles/widgets.css';
import '../styles/launcher.css';

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

/** The sets clips are filed in, by name. */
export function clipSets(items: ClipItem[]): string[] {
  return [...new Set(items.flatMap((c) => c.collections ?? []))].sort((a, b) => a.localeCompare(b));
}

export function ClipPicker() {
  const [state, setState] = useState<IslandState | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ClipKind | 'all'>('all');
  const [set, setSet] = useState('');
  const [index, setIndex] = useState(0);
  // Clips lined up to paste one by one, in the order chosen.
  const [lined, setLined] = useState<string[]>([]);
  // The "file in a set" menu for one clip, and a new set's name being typed.
  const [menu, setMenu] = useState<string | null>(null);
  const [naming, setNaming] = useState<'' | 'chip' | 'menu'>('');
  const [newName, setNewName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => {
      void api.island.state().then(setState);
      setQ('');
      setIndex(0);
      setLined([]);
      setMenu(null);
      setNaming('');
      input.current?.focus();
    };
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const off = api.on('island-changed', () => void api.island.state().then(setState));
    return () => { off(); window.removeEventListener('focus', onFocus); };
  }, []);

  const all = useMemo(() => state?.clips ?? [], [state]);
  const sets = useMemo(() => clipSets(all), [all]);
  const items = useMemo(() => filterClips(all, q, kind, set || undefined), [all, q, kind, set]);
  const queue = state?.pasteQueue;
  useEffect(() => setIndex(0), [q, kind, set]);
  useEffect(() => {
    list.current?.querySelector('.cp-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const close = () => { api.island.closeClips(); window.close?.(); };
  const paste = (c?: ClipItem) => {
    if (!c) return;
    void api.island.pasteClip(c.id, true);
  };
  const toggleLine = (c?: ClipItem) => {
    if (!c) return;
    setLined((l) => (l.includes(c.id) ? l.filter((x) => x !== c.id) : [...l, c.id]));
  };
  const startQueue = (ids: string[]) => void api.island.queueStart(ids);
  const file = (c: ClipItem, name: string) => void api.island.toggleClipCollection(c.id, name).then(() => api.island.state().then(setState));
  const current = items[index];

  const onKey = (e: React.KeyboardEvent) => {
    if (naming) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { e.preventDefault(); if (menu) { setMenu(null); input.current?.focus(); } else if (lined.length) setLined([]); else close(); }
    else if (menu) return;
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && lined.length) { e.preventDefault(); startQueue(lined); }
    else if (e.key === 'Enter') { e.preventDefault(); if (cmd && current) void api.island.copyClip(current.id).then(() => api.island.closeClips()); else paste(current); }
    else if ((e.key === ' ' && !q) || (cmd && e.key.toLowerCase() === 'l')) { e.preventDefault(); toggleLine(current); }
    else if (/^[1-9]$/.test(e.key) && (cmd || !q)) { e.preventDefault(); paste(items[Number(e.key) - 1]); }
    else if (e.key === 'Tab') { e.preventDefault(); const i = KINDS.findIndex((k) => k.id === kind); setKind(KINDS[(i + (e.shiftKey ? KINDS.length - 1 : 1)) % KINDS.length].id); }
    else if (cmd && e.key.toLowerCase() === 'p' && current) { e.preventDefault(); void api.island.pinClip(current.id); }
    else if (cmd && e.key.toLowerCase() === 's' && current) { e.preventDefault(); setMenu(current.id); }
  };

  const menuClip = menu ? all.find((c) => c.id === menu) : undefined;
  const addSet = (name: string) => {
    const n = name.trim();
    const where = naming;
    setNaming('');
    setNewName('');
    if (!n) return;
    if (where === 'menu' && menuClip) file(menuClip, n);
    else if (current) { file(current, n); setSet(n); }
    input.current?.focus();
  };

  return (
    <div className="cp" onKeyDown={onKey} data-testid="clip-picker">
      <div className="cp-head">
        <Icon name="clipboard" size={17} />
        <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search what you copied" placeholder="Search what you copied — text, notes, apps, words in images" />
      </div>
      <div className="cp-kinds" role="tablist" aria-label="Kinds">
        {KINDS.map((k) => <button key={k.id} role="tab" aria-selected={kind === k.id} className={kind === k.id ? 'on' : ''} onClick={() => { setKind(k.id); input.current?.focus(); }}>{k.label}</button>)}
      </div>
      <div className="cp-sets" role="toolbar" aria-label="Sets" data-testid="clip-sets">
        <button className={!set ? 'on' : ''} aria-pressed={!set} onClick={() => { setSet(''); input.current?.focus(); }}>Everything</button>
        {sets.map((n) => <button key={n} className={set === n ? 'on' : ''} aria-pressed={set === n} onClick={() => { setSet(set === n ? '' : n); input.current?.focus(); }}>{n}</button>)}
        {naming === 'chip'
          ? <input autoFocus aria-label="New set name" placeholder="Name the set" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSet(newName); else if (e.key === 'Escape') { e.stopPropagation(); setNaming(''); input.current?.focus(); } }} onBlur={() => setNaming('')} />
          : <button className="new" disabled={!current} title={current ? 'Start a new set with the chosen clip' : 'Choose a clip first'} onClick={() => setNaming('chip')}>+ New set</button>}
      </div>
      <div className="cp-list" ref={list} role="listbox" aria-label="Clipboard history">
        {items.length === 0 ? <div className="muted" style={{ padding: 24, textAlign: 'center' }}>{state ? (set ? `Nothing in “${set}” yet. Press ${mod}S on a clip to file it here.` : 'Nothing matches.') : 'Loading…'}</div> : null}
        {items.slice(0, 200).map((c, i) => {
          const pos = lined.indexOf(c.id);
          return (
            <div key={c.id} role="option" aria-selected={i === index} data-testid="clip-row" className={`cp-row ${i === index ? 'on' : ''}`} onMouseMove={() => setIndex(i)} onClick={() => (lined.length ? toggleLine(c) : paste(c))} onContextMenu={(e) => { e.preventDefault(); setIndex(i); setMenu(c.id); }} title={c.text}>
              {pos >= 0 ? <span className="cp-q" aria-label={`Number ${pos + 1} to paste`}>{pos + 1}</span> : <span className="k">{i < 9 ? i + 1 : ''}</span>}
              {c.kind === 'color' && c.text ? <span className="sw" style={{ background: c.text }} /> : c.image ? <img src={c.image} alt="" /> : <Icon name={KIND_ICON[c.kind] ?? 'text'} size={14} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t">{c.kind === 'code' ? <code>{c.text}</code> : c.kind === 'link' && c.title ? c.title : c.kind === 'image' && c.ocr ? `${c.text} — ${c.ocr.slice(0, 60)}` : c.text}</div>
                <div className="muted small t">{[c.source, relativeTime(c.at), c.note, ...(c.collections ?? [])].filter(Boolean).join(' · ')}</div>
              </div>
              {c.pinned ? <Icon name="pin" size={12} /> : null}
            </div>
          );
        })}
      </div>
      {menuClip ? (
        <div className="cp-menu" role="menu" aria-label="File in a set" data-testid="clip-menu" style={{ bottom: 80 }}>
          {sets.map((n) => (
            <button key={n} role="menuitemcheckbox" aria-checked={!!menuClip.collections?.includes(n)} onClick={() => file(menuClip, n)}>
              {menuClip.collections?.includes(n) ? '✓ ' : ''}{n}
            </button>
          ))}
          {naming === 'menu'
            ? <input className="input" autoFocus aria-label="New set name" placeholder="Name the set" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSet(newName); else if (e.key === 'Escape') { e.stopPropagation(); setNaming(''); } }} />
            : <button role="menuitem" onClick={() => setNaming('menu')}>New set…</button>}
          <div className="sep" />
          <button role="menuitem" onClick={() => { void api.island.pinClip(menuClip.id); setMenu(null); }}>{menuClip.pinned ? 'Unpin' : 'Pin'}</button>
          {menuClip.source ? <button role="menuitem" data-testid="clip-never" onClick={() => void api.island.neverKeepFrom(menuClip.source!).then(() => { setMenu(null); input.current?.focus(); })}>Never keep copies from {menuClip.source}</button> : null}
          <button role="menuitem" onClick={() => { setMenu(null); input.current?.focus(); }}>Close</button>
        </div>
      ) : null}
      {queue ? (
        <div className="cp-bar" role="status" data-testid="clip-queue-running">
          <Icon name="clipboard" size={14} />
          <span className="grow">{queue.collecting ? `Collecting: ${queue.left} so far. Copy more, then paste.` : `Pasting one by one: ${queue.left} left`}</span>
          {queue.left ? <button onClick={() => void api.island.queueNext()}>Paste next</button> : null}
          <button className="ghost" onClick={() => void api.island.queueStop()}>Stop</button>
        </div>
      ) : lined.length ? (
        <div className="cp-bar" role="status" data-testid="clip-queue-bar">
          <span className="grow">{lined.length} lined up. Each paste takes the next.</span>
          <button onClick={() => startQueue(lined)}>Paste one by one</button>
          <button className="ghost" onClick={() => setLined([])}>Clear</button>
        </div>
      ) : set && items.length > 1 ? (
        <div className="cp-bar" role="status">
          <span className="grow">“{set}”: {items.length} clips</span>
          <button onClick={() => startQueue([...items].reverse().map((c) => c.id))}>Paste this set one by one</button>
        </div>
      ) : null}
      <div className="cp-foot">
        <span title={`${mod}↩ copies only · 1–9 paste at once · Tab changes the kind · ${mod}P pins`}>↩ paste</span><span>Space line up</span><span>{mod}S add to a set</span><span>esc close</span>
        <button className="cp-collect" data-testid="clip-collect" onClick={() => startQueue([])} title="Copy several things, then each paste takes the next one">Collect to paste</button>
      </div>
    </div>
  );
}
